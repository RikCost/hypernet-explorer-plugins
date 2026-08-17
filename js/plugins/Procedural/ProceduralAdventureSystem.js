/*:
 * @target MZ
 * @plugindesc Procedural Adventure System - branching (CYOA) encounters, on alien worlds and on Earth's own biomes
 * @author Omni-Lex + Nocoldiz
 * @help
 * ============================================================================
 * ProceduralAdventureSystem.js
 * ============================================================================
 * One engine, two places it is played:
 *
 *   SPACE   Every star system that holds planets carries at least one anomalous
 *           world, marked with a "?" in the star map. Holding orbit over it
 *           offers Investigate, once and once only. (Lifted out of
 *           GalaxySim_Core.js, which still reaches it as GalaxySim.Anomaly.)
 *
 *   EARTH   One square per biome on the world map (315) carries a "???" marker.
 *           Standing on it and choosing Investigate in the travel menu plays the
 *           adventure written for that biome. WorldMapReturn.js draws the
 *           markers and offers the choice; everything behind it is here.
 *
 * Either way it is the same shape: a branching encounter where every choice
 * leads somewhere and the last node pays out - a relic, a fight with something
 * native, salvage, or the walk back with nothing. The party leader is the one
 * who goes down there.
 *
 * ----------------------------------------------------------------------------
 * Content (js/i18n/<lang>/plugins/Anomaly.json)
 * ----------------------------------------------------------------------------
 * One merged namespace, so a translation overrides the prose and inherits every
 * structural field:
 *
 *   Anomaly.tokens.<bank>            shared word banks
 *   Anomaly.biomes.<Biome>           alien surfaces: { label, scenarios, tokens }
 *   Anomaly.earth.tokens.<bank>      word banks for the Earth adventures
 *   Anomaly.earth.aliases.<Biome>    biome -> the biome whose adventure it plays
 *   Anomaly.earth.biomes.<Biome>     { scenarios: [id], tokens, openers, markers }
 *   Anomaly.earth.places.<Name>      one Destinations.json place has its own
 *                                    adventures (Paris, the Vatican Citadel...)
 *   Anomaly.earth.countries.<Name>   one Countries.json country has its own
 *   Anomaly.earth.powers.<Name>      every country a hyperpower holds or controls
 *   Anomaly.earth.fallbackScenarios  played on a biome nothing was written for
 *   Anomaly.scenarios.<id>           { title, start, nodes: { <id>: node } }
 *   node                             { text, choices: [{ text, to }] }
 *   terminal node                    { text, outcome: { kind, mag } }
 *
 * outcome.kind: artifact | gear | loot | gold | schrodingerite | harm | heal |
 *               battle (with `reward` naming what winning pays, `fail` what
 *               losing or running costs) | minigame (`game` names it, `reward`
 *               pays for a win, `fail` for a loss) | date (an evening with Eris,
 *               handed to ErisDateSystem) | reputation | none
 *
 * Any outcome may also carry:
 *   rep: { <factionSlug>: delta }    standing moved with one or more factions
 *   kp / stars                       what the ending is worth in Knowledge
 *                                    (SkillMaster's KP, on the quest curve)
 *
 * Every marker is one square of the world map, and the set is redrawn once a
 * day: a biome carries as many as it has ground to spread them over, and a
 * named place, a country, or a hyperpower's territory carries its own on top of
 * that. A square answered is answered for good, whichever day it came round on.
 *
 * ----------------------------------------------------------------------------
 * API
 * ----------------------------------------------------------------------------
 *   ProceduralAdventure.Space          the star-map encounter (= GalaxySim.Anomaly)
 *   ProceduralAdventure.Earth.tiles()          Set of "x,y" carrying a marker
 *   ProceduralAdventure.Earth.isPendingAt(x,y) is there one to play here?
 *   ProceduralAdventure.Earth.beginAt(x,y)     play it (drives the map messages)
 *   ProceduralAdventure.Earth.markerAt(x,y)    what kind of marker stands there
 * ============================================================================
 */

(() => {
  "use strict";

  // ==========================================================================
  // Shared plumbing
  // ==========================================================================

  const WORLD_MAP_ID = 315;

  // Deterministic 32-bit hash of a string, mixed with the world seed, so every
  // per-place roll (which world is signalling, which square carries a marker,
  // which story it tells) is the same in every savegame of the same world.
  function worldSeed() {
    try {
      if (window.HistoryManager && window.HistoryManager.getSeed) {
        return window.HistoryManager.getSeed() >>> 0;
      }
    } catch (e) { /* history not loaded yet */ }
    return 19002001;
  }
  function seededHash(key, salt) {
    let h = (2166136261 ^ worldSeed() ^ (salt || 0)) >>> 0;
    const s = String(key || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15;
    return h >>> 0;
  }
  function seededFloat(key, salt) { return seededHash(key, salt) / 4294967296; }

  // Crafting materials, the "loot" ending's currency (GalaxySim owns the table).
  function materials() {
    return (window.GalaxySim && window.GalaxySim.MAT) || {};
  }
  function matItem(id) { return typeof $dataItems !== "undefined" ? $dataItems[id] : null; }
  function matName(id) {
    const it = matItem(id);
    return it ? String(it.name).trim() : "#" + id;
  }
  function matGive(id, qty) {
    const it = matItem(id);
    if (it && $gameParty && qty > 0) $gameParty.gainItem(it, qty);
  }

  const ANOM_FALLBACK_BIOME = "AlienIce";   // i18n-ignore: biome id

  let _anomDB = null, _anomDBLang = null;
  function anomalyDB() {
    const lang = (window.T && T.language) ? T.language() : "en";
    if (_anomDB && _anomDBLang === lang) return _anomDB;
    _anomDB = (window.T && T.obj) ? (T.obj("Anomaly") || {}) : {};
    _anomDBLang = lang;
    return _anomDB;
  }

  function anomText(key, params) { return T("Anomaly." + key, params); }

  function anomalyBiomeKey(planet) {
    const PT = (window.GalaxySim && window.GalaxySim.PlanetTypes) || {};
    const b = PT[planet && planet.type] && PT[planet.type].biome;
    const db = anomalyDB().biomes || {};
    return (b && db[b]) ? b : ANOM_FALLBACK_BIOME;
  }

  // The pack a session is written out of: the alien surfaces, or Earth's own
  // biomes. Both hang their scenarios off the same `scenarios` map.
  function packOf(session) {
    return session && session.earth ? (anomalyDB().earth || {}) : anomalyDB();
  }
  function biomeEntry(session) {
    const pack = packOf(session);
    return (pack.biomes && pack.biomes[session.biome]) || {};
  }

  // An Earth square can belong to something narrower than its biome: a named
  // place (Paris), a country (France), or the territory of a hyperpower (every
  // country the Holy Vatican Empire holds). That entry, when there is one, owns
  // the square's adventures and its word banks; the biome underneath still
  // contributes its own banks behind it.
  const EARTH_SCOPES = ["places", "countries", "powers"];   // i18n-ignore: pack section ids
  function exclusiveEntry(session) {
    if (!session || !session.earth || !session.scope) return null;
    const pack = packOf(session);
    const section = pack[session.scope];
    return (section && section[session.scopeId]) || null;
  }
  // Where a session's scenarios and banks come from, narrowest first.
  function contentEntries(session) {
    const out = [];
    const ex = exclusiveEntry(session);
    if (ex) out.push(ex);
    out.push(biomeEntry(session));
    return out;
  }

  // ---- Factions -----------------------------------------------------------
  // Content names a faction by the slug in its Factions.json i18n key
  // ("hexorcistscorp"), which is the only stable id it has: the numeric ids are
  // positional and the display names are translated.
  function factionIndexBySlug(slug) {
    const FDM = window.FactionDataManager && window.FactionDataManager.instance;
    const list = FDM && FDM._factions;
    if (!Array.isArray(list)) return -1;
    const want = String(slug || "").toLowerCase();
    for (let i = 0; i < list.length; i++) {
      const key = String((list[i] && list[i].name) || "");
      const m = /^factions\.([^.]+)\.name$/.exec(key);
      if (m && m[1].toLowerCase() === want) return i;
    }
    return -1;
  }
  function factionDisplayName(index) {
    const FDM = window.FactionDataManager && window.FactionDataManager.instance;
    const entry = FDM && FDM._factions && FDM._factions[index];
    if (!entry) return "";
    return FDM.t ? FDM.t(entry.name) : String(entry.name || "");
  }

  // ---- Knowledge ----------------------------------------------------------
  // Adventures pay Knowledge on the same curve quest contracts do (the star
  // rating is the pay grade, and anything fought along the way is measured
  // against the party's own level), so what an afternoon out here teaches is
  // worth what a board contract of the same weight teaches.
  function anomStars(out) {
    if (out && out.stars > 0) return Math.max(1, Math.min(5, Math.round(out.stars)));
    const mag = out && out.mag;
    if (mag === "large") return 4;
    if (mag === "small") return 1;
    return 2;
  }

  // Which worlds in a system are signalling. Deterministic from the world seed:
  // every system with a landable planet has one, a crowded one can have two.
  const _anomBySystem = {};   // session cache, keyed by system name
  function anomalyPlanetNames(system) {
    const sysKey = String((system && system.name) || "?");
    if (_anomBySystem[sysKey]) return _anomBySystem[sysKey];
    const all = ((system && system.planets) || [])
      .filter((p) => p && p.name && p.type && !p.artificial && !p.noLanding);
    // A world with hand-authored landing sites is a known, documented place
    // (Earth and its spaceports): it only carries the signal if the system has
    // nothing else to hang it on.
    const unknown = all.filter((p) => !(p.landingLocations && p.landingLocations.length));
    const usable = unknown.length ? unknown : all;
    const names = [];
    if (usable.length) {
      const first = Math.floor(seededFloat(sysKey, 6151) * usable.length) % usable.length;
      names.push(usable[first].name);
      if (usable.length >= 5 && seededFloat(sysKey, 6173) < 0.34) {
        const step = 1 + Math.floor(seededFloat(sysKey, 6197) * (usable.length - 1));
        const second = (first + step) % usable.length;
        if (usable[second].name !== names[0]) names.push(usable[second].name);
      }
    }
    _anomBySystem[sysKey] = names;
    return names;
  }

  function anomalyKey(system, body) {
    return String((system && system.name) || "?") + "|" + String((body && body.name) || "?");
  }

  // Answered encounters, keyed by place, on both packs. WorldManager persists
  // this into the world folder (artifacts.json's neighbour, "anomalies"): what
  // happened out there happened to the world, not to the save file.
  function anomalyStore() {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return {};
    if (!$gameSystem._gsAnomalies) $gameSystem._gsAnomalies = {};
    return $gameSystem._gsAnomalies;
  }

  // ---- Text ---------------------------------------------------------------
  // The same passes the TV transmissions use: inline {a|b|c} alternation first,
  // then {token} substitution out of the biome's banks. A token resolved once is
  // pinned for the rest of the encounter, so the place the party walked into in
  // the first paragraph is the place they are standing in at the last.
  function anomAlt(rng, text) {
    let s = String(text || "");
    for (let depth = 0; depth < 12; depth++) {
      if (s.indexOf("|") < 0) break;
      const next = s.replace(/\{([^{}]*\|[^{}]*)\}/g, (m, body) => {
        const opts = body.split("|");
        return opts[Math.floor(rng() * opts.length)];
      });
      if (next === s) break;
      s = next;
    }
    return s;
  }

  const ANOM_SOUNDS_VOWEL = /^(hour|honest|honou?r|heir)/i;
  const ANOM_SOUNDS_CONSONANT = /^(uni|use|user|euro|one|once|ubiquit)/i;
  function anomFixIndefinite(text) {
    return String(text).replace(/\b([Aa]n?)(\s+)([A-Za-z][\w'-]*)/g, (m, art, gap, word) => {
      if (word.length > 1 && word === word.toUpperCase()) return m;
      const needsAn = (/^[aeiou]/i.test(word) && !ANOM_SOUNDS_CONSONANT.test(word))
        || ANOM_SOUNDS_VOWEL.test(word);
      if (needsAn === (art.length === 2)) return m;
      const upper = art[0] === "A";
      return (needsAn ? (upper ? "An" : "an") : (upper ? "A" : "a")) + gap + word;
    });
  }

  // Italian fuses a preposition with the article that follows it, and a bank
  // entry carries its own article, so "in la fossa" has to come back as "nella
  // fossa". Obligatory and exceptionless, which is why it is done here instead
  // of asking every written line to guess which token it is about to take.
  const ANOM_IT_PREPS = {
    di: { il: "del", lo: "dello", la: "della", i: "dei", gli: "degli", le: "delle", "l'": "dell'" },
    a: { il: "al", lo: "allo", la: "alla", i: "ai", gli: "agli", le: "alle", "l'": "all'" },
    da: { il: "dal", lo: "dallo", la: "dalla", i: "dai", gli: "dagli", le: "dalle", "l'": "dall'" },
    "in": { il: "nel", lo: "nello", la: "nella", i: "nei", gli: "negli", le: "nelle", "l'": "nell'" },
    su: { il: "sul", lo: "sullo", la: "sulla", i: "sui", gli: "sugli", le: "sulle", "l'": "sull'" },
  };
  function anomFixItalian(text) {
    return String(text).replace(/\b(di|a|da|in|su)\s+(il|lo|la|i|gli|le|l')(?=\s|$|[a-zàèéìòù])/gi, (m, prep, art) => {
      const joined = ANOM_IT_PREPS[prep.toLowerCase()] && ANOM_IT_PREPS[prep.toLowerCase()][art.toLowerCase()];
      if (!joined) return m;
      return prep[0] === prep[0].toUpperCase() ? joined[0].toUpperCase() + joined.slice(1) : joined;
    });
  }

  // A bank entry lands at the head of a sentence as often as not, and a place
  // name written to sit mid-line would otherwise be read out lowercase there.
  function anomCapitalize(text) {
    return String(text).replace(/(^|[^.][.!?]["')\]]?\s+)([a-z])/g, (m, pre, c) => pre + c.toUpperCase());
  }

  function anomTidy(text) {
    return String(text)
      .replace(/\s{2,}/g, " ")
      .replace(/ +([,.;:!?])/g, "$1")
      .replace(/([?!])\.(?!\.)/g, "$1")
      .trim();
  }

  // Narrowest bank first (the place, then the biome), then the pack's own shared
  // bank, then the global one. A country that writes its own {stranger} list
  // therefore replaces the biome's without having to restate anything else.
  function anomBanks(session) {
    const db = anomalyDB();
    const pack = packOf(session);
    const banks = contentEntries(session).map((e) => e.tokens || {});
    banks.push(pack.tokens || {}, db.tokens || {});
    return banks;
  }

  function anomResolve(session, tpl) {
    const rng = anomRng(session);
    let s = anomAlt(rng, String(tpl || ""));
    const banks = anomBanks(session);
    for (let pass = 0; pass < 6; pass++) {
      let hit = false;
      s = s.replace(/\{(\w+)\}/g, (m, key) => {
        if (session.ctx[key] !== undefined) { hit = true; return session.ctx[key]; }
        // A numbered token ({place2}) draws from the same bank as its base but
        // pins separately, so two different places can stand in one sentence.
        const base = /^([a-z_]+?)\d+$/i.exec(key);
        const bankName = base ? base[1] : key;
        for (const bank of banks) {
          const list = bank[bankName];
          if (Array.isArray(list) && list.length) {
            const v = list[Math.floor(rng() * list.length)];
            session.ctx[key] = v;
            hit = true;
            return v;
          }
        }
        return m;
      });
      if (!hit) break;
      s = anomAlt(rng, s);
    }
    // Anything still unresolved would be read out verbatim.
    s = anomTidy(s.replace(/\{(\w+)\}/g, (m, k) => k.replace(/_/g, " ")));
    const italian = (window.T && T.language && T.language() === "it");
    return anomCapitalize(italian ? anomFixItalian(s) : anomFixIndefinite(s));
  }

  // The encounter's own random stream. Seeded from the world seed and the place,
  // so the same marker always tells the same story, and advanced across the
  // whole encounter (the cursor is saved with the session).
  function anomRng(session) {
    return function () {
      session.roll = (Math.imul(session.roll || 1, 1664525) + 1013904223) >>> 0;
      return session.roll / 4294967296;
    };
  }

  // ---- Rewards ------------------------------------------------------------
  function anomPartyLevel() {
    const m = ($gameParty && $gameParty.members) ? $gameParty.members() : [];
    if (!m.length) return 1;
    const lv = m.map((a) => a.level).sort((a, b) => a - b);
    return lv[Math.floor(lv.length / 2)] || 1;
  }

  const ANOM_MAG = { small: 1, medium: 2.4, large: 5 };
  function anomMag(out) { return ANOM_MAG[out && out.mag] || ANOM_MAG.medium; }

  // The free row in the artifact band (items 1501-1600). "Empty ..." is the
  // sentinel ArctifactGenerator writes into an unused slot; a row the history
  // simulator or the generator has already claimed is never overwritten.
  function anomFreeArtifactId() {
    if (typeof $dataItems === "undefined") return 0;
    for (let id = 1501; id <= 1600; id++) {
      const it = $dataItems[id];
      if (!it || (typeof it.name === "string" && it.name.indexOf("Empty ") === 0)) return id;
    }
    return 0;
  }

  // Mint a relic and file it with the world's own artifacts, so it survives in
  // the world folder (artifacts.json) exactly like a historical one.
  function anomMakeArtifact(session) {
    const id = anomFreeArtifactId();
    if (!id) return null;
    const rng = anomRng(session);
    const pick = (bank) => {
      const list = (anomalyDB().relic && anomalyDB().relic[bank]) || [];
      return list.length ? list[Math.floor(rng() * list.length)] : "";
    };
    const name = anomText("relic.nameTemplate", {
      prefix: pick("prefix"), noun: pick("noun"), of: session.placeName,
    });
    const item = {
      id,
      name,
      description: anomText(session.earth ? "relic.descriptionEarth" : "relic.description",
        { planet: session.placeName }),
      note: "<Category: Artifact>\n<Procedural: true>",   // i18n-ignore: note tags
      iconIndex: 245,
      price: 250000 + Math.floor(rng() * 2000000),
      itypeId: 1,
      consumable: false,
      occasion: 3,
      scope: 0,
      effects: [],
      params: [0, 0, 0, 0, 0, 0, 0, 0],
      isGenerated: true,
    };
    $dataItems[id] = item;
    // File it with the world's artifacts (HistorySimulator re-injects this list
    // on every load, and WorldManager persists it into the world folder).
    const gen = ($gameSystem._generatedArtifacts =
      $gameSystem._generatedArtifacts || { items: [], weapons: [], armors: [] });
    if (!Array.isArray(gen.items)) gen.items = [];
    gen.items.push(item);
    if (window.WorldManager && window.WorldManager.setField) {
      window.WorldManager.setField("artifacts", "generated", gen);
    }
    if ($gameParty) $gameParty.gainItem(item, 1);
    return item;
  }

  // A piece of kit off the shelf, priced into the party's league.
  function anomRandomGear(session, kind) {
    const db = kind === "armor" ? $dataArmors : $dataWeapons;
    if (!db) return null;
    const level = anomPartyLevel();
    const lo = 200 + level * 120, hi = 4000 + level * 2600;
    const pool = [];
    for (let i = 1; i < db.length && i < 1501; i++) {
      const e = db[i];
      if (e && e.name && e.price >= lo && e.price <= hi) pool.push(e);
    }
    if (!pool.length) return null;
    const rng = anomRng(session);
    const gear = pool[Math.floor(rng() * pool.length)];
    if ($gameParty) $gameParty.gainItem(gear, 1);
    return gear;
  }

  function anomGiveMaterials(session, kinds, qty) {
    const rng = anomRng(session);
    const MAT = materials();
    const ids = Object.keys(MAT).map((k) => MAT[k]);
    if (!ids.length) return [];
    const out = [];
    const used = {};
    for (let i = 0; i < kinds; i++) {
      let id = ids[Math.floor(rng() * ids.length)];
      if (used[id]) continue;
      used[id] = true;
      const n = Math.max(1, qty + Math.floor(rng() * qty));
      matGive(id, n);
      out.push(matName(id) + " x" + n);
    }
    return out;
  }

  // Standing moved by an ending. `rep` is { slug: delta }, so one ending can
  // please the Hexorcists and cost the party the Guild in the same breath.
  function anomApplyReputation(out, lines) {
    const rep = out && out.rep;
    if (!rep || typeof $gameFactions === "undefined" || !$gameFactions) return;
    Object.keys(rep).forEach((slug) => {
      const delta = Math.round(Number(rep[slug]) || 0);
      if (!delta) return;
      const index = factionIndexBySlug(slug);
      if (index < 0) return;
      $gameFactions.changeReputation(index, delta);
      const name = factionDisplayName(index) || slug;
      lines.push(anomText(delta > 0 ? "reward.reputation" : "reward.reputationLost",
        { faction: name, amount: Math.abs(delta) }));
    });
  }

  // Knowledge, on the quest curve. Anything the ending had the party fight is
  // priced into it, which is why a battle ending teaches more than a walk.
  function anomAwardKnowledge(out, lines) {
    if (!window.KnowledgePoints || typeof $gameSystem === "undefined" || !$gameSystem) return;
    if (!$gameSystem.addKnowledge) return;
    if (out && out.kp === 0) return;
    const levels = [];
    if (out && out.enemyLevel > 0) levels.push(out.enemyLevel);
    let kp = out && out.kp > 0
      ? Math.round(out.kp)
      : window.KnowledgePoints.forQuest(anomStars(out), levels, anomPartyLevel());
    if (!(kp > 0)) return;
    $gameSystem.addKnowledge(kp);
    lines.push(anomText("reward.knowledge", { kp: kp }));
  }

  // Everything a terminal node can hand over. Returns the lines the panel and
  // the toasts read out; a battle instead arms the handover (see startBattle).
  function anomApplyOutcome(session, out) {
    const lines = [];
    const kind = (out && out.kind) || "none";
    const mag = anomMag(out);
    const level = anomPartyLevel();
    const spec = (name, pts) => {
      if (window.SpecializationXP) window.SpecializationXP.award(name, pts);
    };

    if (kind === "artifact") {
      const item = anomMakeArtifact(session);
      if (item) {
        lines.push(anomText("reward.artifact", { name: item.name }));
      } else {
        // The artifact band (items 1501-1600) is full: pay the ending out in
        // kit and coin rather than leaving the party with a story and nothing.
        const gear = anomRandomGear(session, "weapon");
        if (gear) lines.push(anomText("reward.gear", { name: gear.name }));
        const gold = Math.round(1800 * mag * (1 + level / 24));
        if ($gameParty) $gameParty.gainGold(gold);
        lines.push(anomText("reward.gold", { amount: (gold / 100).toFixed(2) }));
      }
      spec(session.earth ? "Archaeology" : "UFOlogy", 3);   // i18n-ignore: specialization id
      spec("Anthropology", 2);       // i18n-ignore: specialization id
    } else if (kind === "gear") {
      const gear = anomRandomGear(session, out.slot === "armor" ? "armor" : "weapon");
      if (gear) lines.push(anomText("reward.gear", { name: gear.name }));
      spec("Survival", 2);           // i18n-ignore: specialization id
    } else if (kind === "schrodingerite") {
      const dm = $gameSystem && $gameSystem.starMapData;
      const units = Math.max(1, Math.round(mag / 2));
      if (dm && dm.getSchrodingerite) dm.setSchrodingerite(dm.getSchrodingerite() + units);
      lines.push(anomText("reward.schrodingerite", { units: units }));
      spec("Quantum Cryptography", 2);   // i18n-ignore: specialization id
    } else if (kind === "loot") {
      const mats = anomGiveMaterials(session, Math.max(1, Math.round(mag / 1.6)), Math.round(2 * mag));
      if (mats.length) lines.push(anomText("reward.materials", { list: mats.join(", ") }));
      spec("Survival", 2);           // i18n-ignore: specialization id
    } else if (kind === "gold") {
      const gold = Math.round(900 * mag * (1 + level / 24));
      if ($gameParty) $gameParty.gainGold(gold);
      lines.push(anomText("reward.gold", { amount: (gold / 100).toFixed(2) }));
    } else if (kind === "harm") {
      const pct = Math.min(0.6, 0.08 * mag);
      ($gameParty ? $gameParty.members() : []).forEach((a) => {
        a.setHp(Math.max(1, Math.floor(a.hp - a.mhp * pct)));
      });
      lines.push(anomText("reward.harm", { pct: Math.round(pct * 100) }));
    } else if (kind === "heal") {
      ($gameParty ? $gameParty.members() : []).forEach((a) => {
        a.setHp(a.mhp); a.setMp(a.mmp); a.clearStates();
      });
      lines.push(anomText("reward.heal"));
    }

    // Every ending teaches the away team something, even the empty ones.
    const exp = Math.round((out && out.exp != null ? out.exp : 10) * mag * level);
    if (exp > 0 && $gameParty) {
      $gameParty.allMembers().forEach((a) => a.gainExp(exp));
      lines.push(anomText("reward.exp", { exp: exp }));
    }
    // What was worked out down there is worth Knowledge as well as levels: the
    // skill masters charge KP for everything they teach, and an afternoon spent
    // on something nobody has written up is exactly how it is earned.
    anomAwardKnowledge(out, lines);
    anomApplyReputation(out, lines);
    if (kind === "none") spec(session.earth ? "Survival" : "Astrobiology", 1);   // i18n-ignore: specialization id
    return lines;
  }

  // ---- Handovers ----------------------------------------------------------
  // Three endings finish somewhere this engine cannot reach from where it is
  // standing: a fight (which cannot start inside the star map), a minigame, and
  // an evening with Eris. Each arms a pending handover, and the presenter runs
  // it once the last message has closed.
  let _anomPendingBattle = null;
  let _anomPendingMinigame = null;
  let _anomPendingDate = null;
  let _anomMinigameSettle = null;   // a contest being played right now

  // An ending that was not reached: the party ran, or the party lost. It pays
  // what the node's `fail` says (an ordinary outcome, usually harm or a
  // standing lost) and never pays what winning promised.
  function anomApplyFailure(session, out) {
    const fail = out && out.fail;
    const lines = [anomText("reward.failed")];
    if (fail && typeof fail === "object") {
      // The failure branch is an outcome in its own right, minus its own
      // experience: nothing was learned that the walk back did not teach.
      anomApplyOutcome(session, Object.assign({ exp: 0, kp: 0 }, fail))
        .forEach((l) => lines.push(l));
    }
    if (session) session.failed = true;
    return lines;
  }

  // ---- Minigames ----------------------------------------------------------
  // The scene each `game` id opens, looked up late: a minigame plugin that is
  // switched off simply is not there, and the ending falls back to paying out.
  const ANOM_MINIGAMES = {   // i18n-ignore-start: minigame ids and scene names
    bowling: "Scene_BowlingMinigame",
    pool: "Scene_Pool",
    chess: "Scene_Chess",
    basketball: "Scene_BasketballMinigame",
    target: "Scene_TargetRange",
    fishing: "Scene_FishingMinigame",
    surfing: "Scene_SurfingGame",
    tetris: "Scene_HexphoneTetris",
    cards: "Scene_Tarot",
    horses: "Scene_HorseRace",
  };   // i18n-ignore-end

  function minigameScene(game) {
    const name = ANOM_MINIGAMES[game];
    const ctor = name ? window[name] : null;
    return (typeof ctor === "function") ? ctor : null;
  }

  // How the party did, read off the shared MinigameFun hook every minigame in
  // the game already calls on its way out. Wrapping it is what lets one engine
  // score bowling, chess, the range and the rest without knowing anything about
  // any of them. The FIRST decisive call is the answer, so a fishing trip that
  // lands a second fish does not overwrite the first.
  let _anomMinigameResult = null;   // "won" | "lost" | "draw"
  let _anomMinigameHook = null;

  function hookMinigameResult() {
    const MF = window.MinigameFun;
    if (!MF || _anomMinigameHook) return;
    _anomMinigameResult = null;
    _anomMinigameHook = { won: MF.won, lost: MF.lost, draw: MF.draw };
    ["won", "lost", "draw"].forEach((kind) => {   // i18n-ignore: result ids
      MF[kind] = function () {
        if (_anomMinigameResult === null) _anomMinigameResult = kind;
        return _anomMinigameHook[kind].apply(this, arguments);
      };
    });
  }

  function unhookMinigameResult() {
    const MF = window.MinigameFun;
    if (MF && _anomMinigameHook) {
      MF.won = _anomMinigameHook.won;
      MF.lost = _anomMinigameHook.lost;
      MF.draw = _anomMinigameHook.draw;
    }
    _anomMinigameHook = null;
    const result = _anomMinigameResult;
    _anomMinigameResult = null;
    return result;
  }

  // A synthetic troop of 1-3 of whatever lives out here, picked from the enemies
  // whose <Level:> sits nearest the party's own. Session-local: $dataTroops is
  // rebuilt from the database on every load, so nothing is persisted.
  function anomBuildTroop(session, count) {
    if (typeof $dataEnemies === "undefined" || typeof $dataTroops === "undefined") return 0;
    const level = anomPartyLevel();
    const lvOf = (e) => (window.BSE && window.BSE.Helpers)
      ? (window.BSE.Helpers.getEnemyLevel(e.note) || 0) : 0;
    const pool = [];
    for (let i = 1; i < $dataEnemies.length; i++) {
      const e = $dataEnemies[i];
      if (!e || !e.name || !e.battlerName) continue;
      const lv = lvOf(e);
      if (lv > 0 && Math.abs(lv - level) <= Math.max(6, level * 0.25)) pool.push(i);
    }
    if (!pool.length) {
      for (let i = 1; i < $dataEnemies.length; i++) {
        if ($dataEnemies[i] && $dataEnemies[i].battlerName) pool.push(i);
      }
    }
    if (!pool.length) return 0;
    const rng = anomRng(session);
    const enemyId = pool[Math.floor(rng() * pool.length)];
    const n = Math.max(1, Math.min(3, count || 1));
    const members = [];
    for (let m = 0; m < n; m++) {
      members.push({ enemyId, x: 320 + m * 180, y: 300, hidden: false });
    }
    const troopId = $dataTroops.length;
    $dataTroops.push({ id: troopId, members, name: $dataEnemies[enemyId].name, pages: [] });
    return troopId;
  }

  // A terminal node, resolved. Most endings pay out here and now; the three
  // that finish somewhere else arm their handover and say so, and the presenter
  // runs it once the prose has been read.
  function anomArm(session, outcome) {
    if (!outcome) return [];
    if (outcome.kind === "battle") {
      const troopId = anomBuildTroop(session, outcome.count);
      if (troopId) {
        _anomPendingBattle = { troopId, outcome, key: session.key };
        return [anomText("reward.battle")];
      }
      // No enemy could be built (a database this thin should not happen, but an
      // ending has to pay out something).
      return anomApplyOutcome(session, Object.assign({}, outcome,
        { kind: outcome.reward || "loot" }));
    }
    if (outcome.kind === "minigame") {
      if (minigameScene(outcome.game)) {
        _anomPendingMinigame = { outcome, key: session.key };
        return [anomText("reward.minigame")];
      }
      // The minigame is not installed: the contest is taken as won, since the
      // party was never given the chance to lose it.
      return anomApplyOutcome(session, Object.assign({}, outcome,
        { kind: outcome.reward || "gold" }));
    }
    if (outcome.kind === "date") {
      // What the evening itself is worth is Eris's business. The ending still
      // pays its own way first, so a date that never opens is not a dead end.
      const lines = anomApplyOutcome(session, Object.assign({}, outcome,
        { kind: outcome.reward || "none" }));
      if (window.ErisDateSystem && window.ErisDateSystem.start) {
        _anomPendingDate = {
          mood: outcome.mood || null,
          biome: outcome.dateBiome || session.rawBiome || session.biome || null,
        };
        lines.push(anomText("reward.date"));
      }
      return lines;
    }
    if (outcome.kind === "reputation") {
      return anomApplyOutcome(session, Object.assign({}, outcome, { kind: "none" }));
    }
    return anomApplyOutcome(session, outcome);
  }

  // ---- The encounter itself ----------------------------------------------
  // The adventures a square can tell, narrowest first: what its place, country
  // or hyperpower wrote, and the biome's own only when nothing narrower did.
  function anomScenarioList(session) {
    const db = anomalyDB();
    const pack = packOf(session);
    let list = null;
    for (const entry of contentEntries(session)) {
      if (entry.scenarios && entry.scenarios.length) { list = entry.scenarios; break; }
    }
    if (!list) list = pack.fallbackScenarios || [];
    return list.filter((id) => db.scenarios && db.scenarios[id]);
  }

  function anomScenarioFor(session) {
    const usable = anomScenarioList(session);
    if (!usable.length) return null;
    const idx = Math.floor(seededFloat(session.key, 7717) * usable.length) % usable.length;
    return usable[idx];
  }

  // The line the encounter opens on, ahead of the scenario's own first
  // paragraph: where the party is standing, what the weather is doing, who else
  // is about. Written per biome and per place, drawn from the same banks and
  // resolved through the same passes, so the same adventure played on two
  // squares does not open the same way twice.
  function anomOpener(session) {
    let bank = null;
    for (const entry of contentEntries(session)) {
      if (Array.isArray(entry.openers) && entry.openers.length) { bank = entry.openers; break; }
    }
    if (!bank) {
      const pack = packOf(session);
      bank = Array.isArray(pack.openers) ? pack.openers : null;
    }
    if (!bank || !bank.length) return "";
    const rng = anomRng(session);
    return anomResolve(session, bank[Math.floor(rng() * bank.length)]);
  }

  // Resolve the node the session is sitting on into the panel's view. Resolved
  // once and cached on the session, so a re-render never re-rolls the prose.
  function anomBuildView(session) {
    const db = anomalyDB();
    const sc = db.scenarios && db.scenarios[session.scenario];
    const node = sc && sc.nodes && sc.nodes[session.node];
    if (!node) {
      session.view = { title: session.placeName, text: anomText("ui.signalLost"), choices: [], done: true };
      return session.view;
    }
    let text = anomResolve(session, node.text);
    if (session.node === sc.start) {
      // Resolved once and pinned: a re-render of the opening node (a reload, a
      // panel redraw) must not roll a different afternoon.
      if (session.opener === undefined) session.opener = anomOpener(session);
      if (session.opener) text = session.opener + "\n" + text;
    }
    const view = {
      title: session.title || anomResolve(session, sc.title || ""),
      text,
      choices: [],
      done: !!node.outcome,
      rewards: [],
    };
    session.title = view.title;
    if (node.outcome) {
      view.rewards = session.rewards || [];
    } else {
      view.choices = (node.choices || []).map((c) => ({
        text: anomResolve(session, c.text), to: c.to,
      }));
    }
    session.view = view;
    return view;
  }

  // Open a session on a key that has never been answered. Marks the place the
  // moment it is opened, not when it ends, which is what makes the answer final:
  // walking out of the encounter is one of the ways to answer it.
  function anomOpen(session) {
    const db = anomalyDB();
    session.ctx.leader = ($gameParty && $gameParty.leader()) ? $gameParty.leader().name() : "";
    session.scenario = anomScenarioFor(session);
    if (!session.scenario) return null;
    const sc = db.scenarios[session.scenario];
    session.node = sc.start || Object.keys(sc.nodes || {})[0];
    anomalyStore()[session.key] = { started: true };
    $gameSystem._gsAnomalySession = session;
    anomBuildView(session);
    return session;
  }

  const Anomaly = {
    // Is this body the one signalling in its system?
    isAnomalous(system, body) {
      if (!system || !body || !body.name) return false;
      return anomalyPlanetNames(system).indexOf(body.name) >= 0;
    },
    key: anomalyKey,
    // Answered, whichever way it went.
    isResolved(system, body) {
      const rec = anomalyStore()[anomalyKey(system, body)];
      return !!(rec && rec.done);
    },
    // The "?" and the Investigate button both follow this: a world that has
    // never been touched, or the one the party is halfway through. An encounter
    // walked away from mid-branch is spent, like any other answer.
    isPending(system, body) {
      if (!Anomaly.isAnomalous(system, body)) return false;
      const rec = anomalyStore()[anomalyKey(system, body)];
      if (!rec) return true;
      if (rec.done) return false;
      return Anomaly.hasSessionOn(system, body);
    },
    session() {
      return (typeof $gameSystem !== "undefined" && $gameSystem)
        ? ($gameSystem._gsAnomalySession || null) : null;
    },
    // Is there a half-finished encounter on this exact body?
    hasSessionOn(system, body) {
      const s = Anomaly.session();
      return !!(s && s.key === anomalyKey(system, body));
    },
    // Open (or resume) the encounter on an alien world.
    begin(system, planet) {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
      const key = anomalyKey(system, planet);
      const live = Anomaly.session();
      // Resuming: hand back the view as it was written, rather than resolving
      // the same node again and re-rolling every {a|b} in it.
      if (live && live.key === key) {
        if (!live.view) anomBuildView(live);
        return live;
      }
      if (anomalyStore()[key]) return null;   // answered, or walked away from
      const session = {
        key,
        biome: anomalyBiomeKey(planet),
        placeName: planet.name,
        systemName: (system && (system.label || system.name)) || "",
        roll: seededHash(key, 8191) || 1,
        ctx: {},
        rewards: [],
        node: null,
        scenario: null,
      };
      session.ctx.planet = session.placeName;
      session.ctx.system = session.systemName;
      const biome = (anomalyDB().biomes || {})[session.biome] || {};
      // Anomaly.json names the surfaces it writes for; anything it does not
      // cover falls back to the biome's own declared name, never the raw id.
      session.ctx.biome = biome.label ||
        (window.BiomeNames ? window.BiomeNames.display(session.biome) : session.biome);
      return anomOpen(session);
    },
    view() {
      const s = Anomaly.session();
      return s ? (s.view || anomBuildView(s)) : null;
    },
    // Take a branch. Returns the new view; a terminal node applies its outcome
    // first, so the view already carries the reward lines.
    choose(index) {
      const s = Anomaly.session();
      if (!s || !s.view || s.view.done) return null;
      const choice = s.view.choices[index];
      if (!choice) return null;
      s.node = choice.to;
      const db = anomalyDB();
      const sc = db.scenarios && db.scenarios[s.scenario];
      const node = sc && sc.nodes && sc.nodes[s.node];
      if (node && node.outcome) s.rewards = anomArm(s, node.outcome);
      return anomBuildView(s);
    },
    // Close the encounter for good and record how it ended.
    end() {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return;
      const s = Anomaly.session();
      if (s) {
        anomalyStore()[s.key] = {
          started: true, done: true, scenario: s.scenario, failed: !!s.failed,
        };
      }
      $gameSystem._gsAnomalySession = null;
    },
    // A fight was the answer. The star map pops back to the map, then calls this.
    hasPendingBattle() { return !!(_anomPendingBattle && _anomPendingBattle.troopId); },
    startBattle() {
      const pend = _anomPendingBattle;
      _anomPendingBattle = null;
      if (!pend || !pend.troopId) return false;
      const session = Anomaly.session();
      // No map to fight on (a load that never streamed one in): close the
      // encounter rather than leaving it half-open forever.
      if (!$dataMap || typeof $dataMap.width !== "number") { Anomaly.end(); return false; }
      // Escapable and losable both: what is down there is an adventure, not a
      // sentence. Running from it and being beaten by it are the same answer -
      // the party does not get what they came for, and the square is spent.
      BattleManager.setup(pend.troopId, true, true);
      BattleManager.setEventCallback((result) => {
        // Victory pays what the ending promised; running or losing fails it.
        if (session) {
          const lines = result === 0
            ? anomApplyOutcome(session, Object.assign({}, pend.outcome,
                { kind: pend.outcome.reward || "loot" }))
            : anomApplyFailure(session, pend.outcome);
          anomToast(lines, result === 0);
        }
        Anomaly.end();
      });
      SceneManager.push(Scene_Battle);
      return true;
    },
    // A contest was the answer: the party plays the game itself, and the ending
    // pays out on the result the minigame reports.
    hasPendingMinigame() { return !!_anomPendingMinigame; },
    startMinigame() {
      const pend = _anomPendingMinigame;
      _anomPendingMinigame = null;
      if (!pend) return false;
      const Scene = minigameScene(pend.outcome.game);
      const session = Anomaly.session();
      if (!Scene) {
        // Between arming and running, the minigame went away. Pay the win.
        if (session) {
          anomToast(anomApplyOutcome(session, Object.assign({}, pend.outcome,
            { kind: pend.outcome.reward || "gold" })), true);
        }
        Anomaly.end();
        return false;
      }
      _anomMinigameSettle = { outcome: pend.outcome };
      hookMinigameResult();
      SceneManager.push(Scene);
      return true;
    },
    // Called on the way back to the map, once the minigame's scene is gone.
    settleMinigame() {
      const pend = _anomMinigameSettle;
      const result = unhookMinigameResult();
      if (!pend) return false;
      _anomMinigameSettle = null;
      const session = Anomaly.session();
      if (session) {
        // Anything but a loss is taken as good enough: a draw is not a defeat,
        // and a game closed without a verdict was not lost either.
        const won = result !== "lost";   // i18n-ignore: result id
        const lines = won
          ? anomApplyOutcome(session, Object.assign({}, pend.outcome,
              { kind: pend.outcome.reward || "gold" }))
          : anomApplyFailure(session, pend.outcome);
        anomToast(lines, won);
      }
      Anomaly.end();
      return true;
    },
    // An evening was the answer. Handed to ErisDateSystem, which owns
    // everything about it from here.
    hasPendingDate() { return !!_anomPendingDate; },
    startDate() {
      const pend = _anomPendingDate;
      _anomPendingDate = null;
      if (!pend) return false;
      Anomaly.end();
      const EDS = window.ErisDateSystem;
      if (!EDS || !EDS.start || EDS.isActive()) return false;
      try { return !!EDS.start(pend.biome, pend.mood); } catch (e) {
        console.error("[ProceduralAdventure] date failed", e);
        return false;
      }
    },
  };

  // What a handover pays is reported after the fact, on the map the party is
  // standing on rather than in the encounter's own message window: by the time
  // it is known, the encounter has closed.
  function anomToast(lines, good) {
    if (!window.ParchmentToast || !lines || !lines.length) return;
    window.ParchmentToast.group(lines.map((l) => ({
      text: l, severity: good ? "good" : "bad",
    })));
  }

  // ==========================================================================
  // EARTH: one adventure per biome, on the world map's "???" squares
  // --------------------------------------------------------------------------
  // Where the star map hangs its encounters off worlds, Earth hangs them off
  // biomes: exactly one square per biome present on map 315 carries a marker,
  // picked deterministically from the world seed (so it is the same square in
  // every session of the same world) out of the biome coordinate cache. Once
  // that square has been answered the marker is gone for good and the biome has
  // no other - one adventure per biome, per world.
  // ==========================================================================

  function earthDB() { return anomalyDB().earth || {}; }

  function earthKey(x, y) { return "earth|" + x + "," + y; }   // i18n-ignore: store key

  // The biome whose adventure a world-map biome plays. A biome nothing was
  // written for reads its alias ("Road horizontal" -> "Road"), and anything
  // still unknown falls through to the pack's own fallback scenarios.
  function earthBiomeKey(biomeName) {
    const name = String(biomeName || "").trim();
    if (!name) return null;
    const pack = earthDB();
    const biomes = pack.biomes || {};
    if (biomes[name]) return name;
    const alias = (pack.aliases || {})[name];
    if (alias && biomes[alias]) return alias;
    return null;
  }

  // The biome of a world-map square, road and river squares reporting the
  // terrain they are painted over (a road across Fields is a Fields adventure).
  function earthBiomeAt(x, y) {
    if (typeof $gameSystem === "undefined" || !$gameSystem) return null;
    let name = null;
    try {
      if ($gameSystem.getBiomeFromWorldCoordinates) {
        name = $gameSystem.getBiomeFromWorldCoordinates(x, y);
      }
    } catch (e) { return null; }
    if (name && !earthBiomeKey(name) && $gameSystem.getUnderBiomeFromWorldCoordinates) {
      try {
        const under = $gameSystem.getUnderBiomeFromWorldCoordinates(x, y);
        if (under && earthBiomeKey(under)) return under;
      } catch (e) { /* road with nothing under it */ }
    }
    return name;
  }

  // The world-map coordinates the biome cache holds for each biome. Built by
  // ProceduralMapUtils (from BiomesMap.json, or by scanning map 315 once).
  function biomeCoordinateCache() {
    const pg = (typeof $gameSystem !== "undefined" && $gameSystem) ? $gameSystem._procGenData : null;
    return (pg && pg.biomeCoordinateCache) || null;
  }

  // Can the party stand on this world-map square, and is it free of events
  // (teleports, vehicles) that already own the OK button there?
  function isFreeWorldTile(x, y) {
    if (typeof $gameMap === "undefined" || !$gameMap) return false;
    if ($gameMap.mapId() !== WORLD_MAP_ID) return false;
    if (!$gameMap.isValid(x, y)) return false;
    if ($gameMap.terrainTag(x, y) === 4) return false;                 // wall
    if ($gameMap.eventsXy(x, y).length) return false;
    return $gameMap.isPassable(x, y, 2) || $gameMap.isPassable(x, y, 4) ||
           $gameMap.isPassable(x, y, 6) || $gameMap.isPassable(x, y, 8);
  }

  // Countries.json by the region id painted on the world map. Built once, because
  // the daily rebuild asks this of every square the biome cache holds and the
  // stock lookup walks the whole country list every time it is asked.
  let _earthCountryById = null;
  function earthCountriesById() {
    if (_earthCountryById) return _earthCountryById;
    const list = (window.WorldGen && window.WorldGen.Countries) || [];
    if (!list.length) return null;   // not loaded yet: do not cache the emptiness
    _earthCountryById = {};
    // Duplicated ids (Albania/Montenegro, Germany/Portugal) resolve to the first
    // match, exactly as getCountryFromWorldCoordinates does.
    list.forEach((c) => {
      if (c && c.id && _earthCountryById[c.id] === undefined) _earthCountryById[c.id] = c;
    });
    return _earthCountryById;
  }

  // The country a square belongs to. A country entry names two hyperpowers: the
  // one whose banner flies over it (`faction`) and the one occupying it
  // (`controller`), and an adventure written for either is at home there.
  function earthCountryAt(x, y) {
    try {
      if (!$gameSystem) return null;
      const byId = earthCountriesById();
      if (byId && $gameSystem.getWorldRegionId) {
        const id = $gameSystem.getWorldRegionId(x, y);
        return id ? (byId[id] || null) : null;
      }
      return $gameSystem.getCountryFromWorldCoordinates
        ? $gameSystem.getCountryFromWorldCoordinates(x, y) : null;
    } catch (e) { return null; }
  }
  const EARTH_NO_POWER = ["Neutral", "None", ""];   // i18n-ignore: Countries.json sentinels
  function earthPowersOf(country) {
    if (!country) return [];
    return [country.faction, country.controller]
      .filter((p) => p && EARTH_NO_POWER.indexOf(String(p)) < 0);
  }

  let _earthTiles = null;      // Map<"x,y", marker> for this world, today
  let _earthTilesRev = null;   // the world and the day the set was built for

  // Which calendar day it is. The marker set is drawn fresh at midnight: what is
  // worth walking out to look at is a different set of squares this morning than
  // it was yesterday, and a square the party never got to is not lost, it simply
  // comes round again.
  //
  // The clock (Variable 114) counts minutes from 10:00 on 1 January 2001, so the
  // minute count alone rolls over at ten in the morning. The date it resolves to
  // is what the day is taken from, and that turns at midnight.
  const CLOCK_VAR = 114;
  const CLOCK_EPOCH_MINUTES = 10 * 60;   // 1 Jan 2001 10:00, TimeDateSystem's zero
  function clockMinutes() {
    try {
      if (window.TimeDateSystem && window.TimeDateSystem.getGameTimeMinutes) {
        return window.TimeDateSystem.getGameTimeMinutes() || 0;
      }
    } catch (e) { /* clock not up yet */ }
    if (typeof $gameVariables !== "undefined" && $gameVariables) {
      return $gameVariables.value(CLOCK_VAR) || 0;
    }
    return 0;
  }
  function dayIndex() {
    return Math.floor((clockMinutes() + CLOCK_EPOCH_MINUTES) / 1440);
  }

  // The token that identifies the set standing on the map right now: the world,
  // and the day. WorldMapReturn watches this to know when to redraw.
  function earthRevision() { return worldSeed() + "|" + dayIndex(); }   // i18n-ignore: cache key

  // How many squares one entry is worth on any given day. Explicitly written
  // markers win; otherwise it goes on how much of that ground the map paints.
  const EARTH_MARKERS_CAP = 10;
  const EARTH_MARKERS_SPREAD = 10;   // squares two markers of one entry keep apart
  function markerCount(entry, coordCount) {
    if (entry && entry.markers > 0) return Math.min(entry.markers, EARTH_MARKERS_CAP);
    const byArea = Math.max(1, Math.round(Math.sqrt(coordCount / 16)));
    return Math.max(1, Math.min(EARTH_MARKERS_CAP, byArea));
  }

  // Walk a coordinate list from a seeded offset in a stride that is coprime with
  // nothing in particular, and take squares the party can stand on, keeping them
  // apart so one biome's markers are not all in one valley. Ground too small to
  // spread them over takes them anyway on a second pass: a district of four
  // village squares still gets its adventure.
  function claimTiles(tiles, coords, want, salt, marker) {
    if (!coords || !coords.length || want <= 0) return 0;
    const day = salt + "|" + dayIndex();   // i18n-ignore: seed salt
    const start = Math.floor(seededFloat(day, 5443) * coords.length) % coords.length;
    const taken = [];
    for (let pass = 0; pass < 2 && taken.length < want; pass++) {
      const spread = pass === 0 ? EARTH_MARKERS_SPREAD : 0;
      for (let i = 0; i < coords.length && taken.length < want; i++) {
        const c = coords[(start + i * 7919) % coords.length];
        if (!c || typeof c.x !== "number") continue;
        const key = c.x + "," + c.y;   // i18n-ignore: coordinate key
        if (tiles.has(key)) continue;
        if (spread && taken.some((t) => Math.abs(t.x - c.x) + Math.abs(t.y - c.y) < spread)) continue;
        if (!isFreeWorldTile(c.x, c.y)) continue;
        taken.push(c);
        tiles.set(key, Object.assign({ biome: marker.biome }, marker));
      }
    }
    return taken.length;
  }

  // The square a named place's own adventure stands on: as close to the place
  // as the map allows, since the place itself is a teleport event and cannot
  // carry a marker.
  const EARTH_PLACE_RADIUS = 6;
  function tileNearPlace(tiles, base) {
    for (let r = 1; r <= EARTH_PLACE_RADIUS; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = base.x + dx, y = base.y + dy;
          const key = x + "," + y;   // i18n-ignore: coordinate key
          if (tiles.has(key)) continue;
          if (!isFreeWorldTile(x, y)) continue;
          return { x, y };
        }
      }
    }
    return null;
  }

  // Everything the world map carries, narrowest claim first: a place's own
  // adventure beats the country's, the country's beats its hyperpower's, and
  // the biomes fill in what is left.
  function buildEarthTiles() {
    const tiles = new Map();
    const cache = biomeCoordinateCache();
    if (!cache) return tiles;
    const pack = earthDB();
    if (!Object.keys(pack.biomes || {}).length) return tiles;

    // ---- Named places (Destinations.json) ----------------------------------
    const places = pack.places || {};
    const destinations = (window.WorkSystem && window.WorkSystem.Destinations) || {};
    Object.keys(places).sort().forEach((name) => {
      const dest = destinations[name];
      const base = dest && dest.base;
      if (!base || typeof base.x !== "number") return;
      const spot = tileNearPlace(tiles, base);
      if (!spot) return;
      tiles.set(spot.x + "," + spot.y, {   // i18n-ignore: coordinate key
        scope: "places", scopeId: name,    // i18n-ignore: pack section id
        biome: earthBiomeKey(earthBiomeAt(spot.x, spot.y)),
        place: name,
      });
    });

    // ---- Biome squares, grouped by the adventure they play ------------------
    // (Road variants do not each claim a marker of their own.) The same pass
    // groups every square by its country, which is what the country and
    // hyperpower adventures are placed out of.
    const byAdventure = {};
    const byCountry = {};
    Object.keys(cache).forEach((biome) => {
      const coords = cache[biome];
      if (!Array.isArray(coords) || !coords.length) return;
      const key = earthBiomeKey(biome);
      coords.forEach((c) => {
        if (!c || typeof c.x !== "number") return;
        if (key) (byAdventure[key] = byAdventure[key] || []).push(c);
        const country = earthCountryAt(c.x, c.y);
        if (country && country.country) {
          (byCountry[country.country] = byCountry[country.country] || []).push(c);
        }
      });
    });

    // ---- Countries, then hyperpowers ---------------------------------------
    const countries = pack.countries || {};
    Object.keys(countries).sort().forEach((name) => {
      claimTiles(tiles, byCountry[name], markerCount(countries[name], (byCountry[name] || []).length),
        "country|" + name,   // i18n-ignore: seed salt
        { scope: "countries", scopeId: name, country: name, biome: null });   // i18n-ignore: pack section id
    });

    const powers = pack.powers || {};
    const list = (window.WorldGen && window.WorldGen.Countries) || [];
    Object.keys(powers).sort().forEach((power) => {
      const held = list.filter((c) => c && earthPowersOf(c).indexOf(power) >= 0);
      if (!held.length) return;
      // Spread over the countries the power holds rather than filling one of
      // them: the Empire's business is the Empire's business everywhere.
      const want = markerCount(powers[power], held.length * 40);
      let placed = 0;
      const order = held.slice().sort((a, b) =>
        seededFloat(power + "|" + a.country, 3323) - seededFloat(power + "|" + b.country, 3323));
      for (let pass = 0; pass < 2 && placed < want; pass++) {
        for (const country of order) {
          if (placed >= want) break;
          placed += claimTiles(tiles, byCountry[country.country], 1,
            "power|" + power + "|" + country.country + "|" + pass,   // i18n-ignore: seed salt
            { scope: "powers", scopeId: power, power, country: country.country, biome: null });   // i18n-ignore: pack section id
        }
      }
    });

    // ---- The biomes themselves ---------------------------------------------
    Object.keys(byAdventure).sort().forEach((biome) => {
      const coords = byAdventure[biome];
      claimTiles(tiles, coords, markerCount((pack.biomes || {})[biome], coords.length),
        biome, { biome });
    });

    // A marker placed before the biome pass knows where it is standing only
    // now: fill in what it is painted on, for the word banks underneath.
    tiles.forEach((marker, key) => {
      if (marker.biome) return;
      const parts = key.split(",");
      marker.biome = earthBiomeKey(earthBiomeAt(Number(parts[0]), Number(parts[1])));
    });
    return tiles;
  }

  function earthTiles() {
    const rev = earthRevision();
    if (_earthTiles && _earthTilesRev === rev) return _earthTiles;
    if (typeof $gameMap === "undefined" || !$gameMap || $gameMap.mapId() !== WORLD_MAP_ID) {
      return _earthTiles || new Map();
    }
    const built = buildEarthTiles();
    // The biome coordinate cache is built on the first world-map load and may
    // not be there yet on the frame this is first asked. An empty answer is
    // never cached, so the markers appear as soon as it is.
    if (!built.size) return built;
    _earthTiles = built;
    _earthTilesRev = rev;
    return _earthTiles;
  }

  const Earth = {
    // Squares that still carry a marker: the built set, minus everything the
    // party has already answered.
    tiles() {
      const out = new Set();
      const store = anomalyStore();
      earthTiles().forEach((marker, key) => {
        const rec = store[earthKey.apply(null, key.split(","))];
        if (rec && rec.done) return;
        out.add(key);
      });
      return out;
    },
    biomeAt(x, y) { return earthBiomeAt(x, y); },
    // Changes whenever the set on the map does, which is once a day (and on a
    // change of world). Anything drawing the markers redraws when this moves.
    revision() { return earthRevision(); },
    // What kind of marker stands here: a biome's, a place's, a country's or a
    // hyperpower's. Null on a square that never carried one.
    markerAt(x, y) {
      return earthTiles().get(x + "," + y) || null;   // i18n-ignore: coordinate key
    },
    // Is there an adventure to play on this square? Answered squares say no,
    // and so does every square that never carried one.
    isPendingAt(x, y) {
      const key = x + "," + y;   // i18n-ignore: coordinate key
      if (!earthTiles().has(key)) return false;
      const rec = anomalyStore()[earthKey(x, y)];
      return !rec || !rec.done;
    },
    // Open the adventure written for this square and hand it to the map
    // presenter. Returns false when there was nothing to play.
    beginAt(x, y) {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return false;
      if (!Earth.isPendingAt(x, y)) return false;
      const key = earthKey(x, y);
      const live = Anomaly.session();
      if (live && live.key === key) { MapPlay.start(live); return true; }
      const marker = Earth.markerAt(x, y) || {};
      const biomeName = earthBiomeAt(x, y) || marker.biome;
      const biome = earthBiomeKey(biomeName) || marker.biome;
      const display = window.BiomeNames
        ? window.BiomeNames.display(biomeName || biome) : String(biomeName || biome);
      const country = earthCountryAt(x, y);
      const region = (country && country.country) || null;
      const session = {
        key,
        earth: true,
        biome: biome || "",
        rawBiome: biomeName || biome || "",
        // The narrower pack this square belongs to, if any: its place, its
        // country, or the hyperpower whose ground it is.
        scope: marker.scope || null,
        scopeId: marker.scopeId || null,
        // What a relic lifted here is named after: the place if this is one of
        // theirs, the country if the world map knows one, the biome otherwise.
        placeName: marker.place || region || display,
        roll: seededHash(key, 8191) || 1,
        ctx: {},
        rewards: [],
        node: null,
        scenario: null,
      };
      session.ctx.biome = display;
      session.ctx.place = marker.place || display;
      session.ctx.region = region || display;
      session.ctx.country = region || display;
      const powers = earthPowersOf(country);
      if (marker.power) session.ctx.power = marker.power;
      else if (powers.length) session.ctx.power = powers[0];
      if (marker.place) session.ctx.city = marker.place;
      if (!anomOpen(session)) return false;
      MapPlay.start(session);
      return true;
    },
  };

  // ==========================================================================
  // MAP PRESENTER
  // --------------------------------------------------------------------------
  // On Earth there is no star-map panel to draw the encounter into, so it is
  // played through the ordinary message window: the node's prose across as many
  // pages as it needs, then its branches as a choice list. Steps are queued and
  // run one per frame from Scene_Map.update, because a choice callback fires
  // while its own message is still closing and cannot open the next one itself.
  // ==========================================================================

  const MAP_LINE_CHARS = 48;   // conservative wrap for the default message font
  const MAP_PAGE_LINES = 4;

  function wrapLine(line, width) {
    const out = [];
    let cur = "";
    String(line).split(/\s+/).forEach((word) => {
      if (!word) return;
      if (!cur) { cur = word; return; }
      if ((cur + " " + word).length <= width) { cur += " " + word; return; }
      out.push(cur);
      cur = word;
    });
    if (cur) out.push(cur);
    return out.length ? out : [""];
  }

  // Prose to message pages: paragraphs wrapped to the window, MAP_PAGE_LINES to
  // a page, never breaking a paragraph across a page when it fits whole.
  function paginate(text) {
    const pages = [];
    let page = [];
    String(text || "").split("\n").forEach((para) => {
      const lines = wrapLine(para, MAP_LINE_CHARS);
      lines.forEach((l) => {
        if (page.length >= MAP_PAGE_LINES) { pages.push(page); page = []; }
        page.push(l);
      });
      if (page.length && page.length >= MAP_PAGE_LINES) { pages.push(page); page = []; }
    });
    if (page.length) pages.push(page);
    return pages.length ? pages : [[""]];
  }

  // A line shown from a plugin has to say that it is already in the player's
  // language. Hendrix_Localization.js routes $gameMessage.add() into a
  // translation buffer that only the event interpreter ever flushes, so prose
  // added from here would never reach the window at all: the branch's choices
  // would open over an empty screen, and the paragraphs would surface later in
  // the middle of somebody else's message. This prose is read out of
  // Anomaly.json, which is translated already.
  function messageAdd(line) {
    const before = window.skipLocalization;
    window.skipLocalization = true;
    try { $gameMessage.add(line); } finally { window.skipLocalization = before; }
  }

  const MapPlay = {
    _steps: [],
    _running: false,

    start(session) {
      this._steps = [];
      this._running = true;
      this.present(session.view || anomBuildView(session));
    },

    stop() {
      this._steps = [];
      this._running = false;
    },

    queue(fn) { this._steps.push(fn); },

    // One node: its prose, then either its branches or its payout.
    present(view) {
      if (!view) { this.finish(); return; }
      const pages = paginate(view.text);
      const title = view.title ? anomText("ui.mapTitle", { title: view.title }) : null;
      pages.forEach((lines, i) => {
        const head = (i === 0 && title) ? [title] : [];
        const last = i === pages.length - 1;
        this.queue(() => {
          head.concat(lines).forEach((l) => messageAdd(l));
          if (last && !view.done) this.askChoices(view);
        });
      });
      if (view.done) this.queue(() => this.payout(view));
    },

    askChoices(view) {
      const labels = view.choices.map((c) => c.text);
      labels.push(anomText("ui.walkAway"));
      const cancel = labels.length - 1;
      $gameMessage.setChoices(labels, 0, cancel);
      $gameMessage.setChoiceCallback((index) => {
        if (index >= view.choices.length) {
          this.queue(() => {
            messageAdd(anomText("ui.walkedAway"));
            this.queue(() => this.finish());
          });
          return;
        }
        const next = Anomaly.choose(index);
        this.present(next);
      });
    },

    // The last node has already applied its outcome (Anomaly.choose did it):
    // this only reads the lines out and hands over to the fight, if the ending
    // was a fight.
    payout(view) {
      const lines = (view.rewards || []).filter((l) => l);
      if (lines.length) {
        paginate(lines.join("\n")).forEach((page) => {
          this.queue(() => page.forEach((l) => messageAdd(l)));
        });
      }
      this.queue(() => this.finish());
    },

    // The prose is read out; whatever the ending owes somewhere else runs now.
    // Each of these closes the encounter itself, once it knows how it went.
    finish() {
      this._running = false;
      this._steps = [];
      if (Anomaly.hasPendingBattle()) {
        try { Anomaly.startBattle(); return; } catch (e) { console.error(e); }
      }
      if (Anomaly.hasPendingMinigame()) {
        try { Anomaly.startMinigame(); return; } catch (e) { console.error(e); }
      }
      if (Anomaly.hasPendingDate()) {
        try { Anomaly.startDate(); return; } catch (e) { console.error(e); }
      }
      Anomaly.end();
    },

    // One step per frame, and only while the window is free.
    update() {
      if (!this._steps.length) return;
      if (typeof $gameMessage === "undefined" || $gameMessage.isBusy()) return;
      if ($gameMap && $gameMap.isEventRunning()) return;
      const step = this._steps.shift();
      try { step(); } catch (e) {
        console.error("[ProceduralAdventure] " + e);
        this._steps = [];
        Anomaly.end();
      }
    },

    isRunning() { return this._running || this._steps.length > 0; },
  };

  // ==========================================================================
  // HOOKS
  // ==========================================================================

  // A branch that ended in a fight leaves the star map and lands here: the map
  // scene is the only place a battle can be pushed from safely. A branch that
  // ended in a contest lands here on the way BACK, once the minigame's own scene
  // has closed and the result it reported can be read.
  const _PAS_Scene_Map_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function () {
    _PAS_Scene_Map_start.call(this);
    try { Anomaly.settleMinigame(); } catch (e) { console.error(e); Anomaly.end(); }
    if (Anomaly.hasPendingBattle() && !this._transfer) {
      try { Anomaly.startBattle(); } catch (e) { console.error(e); Anomaly.end(); }
    }
  };

  const _PAS_Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _PAS_Scene_Map_update.call(this);
    MapPlay.update();
  };

  // An encounter runs across several messages, and the frame between two of them
  // is one the message window is not busy in: without this the party could take
  // a step (and walk off the square they are investigating) in the gap.
  const _PAS_Game_Player_canMove = Game_Player.prototype.canMove;
  Game_Player.prototype.canMove = function () {
    if (MapPlay.isRunning()) return false;
    return _PAS_Game_Player_canMove.call(this);
  };

  // Leaving the map (a battle, a transfer, the title screen) drops whatever was
  // queued: the encounter itself is already recorded as answered.
  const _PAS_Scene_Map_terminate = Scene_Map.prototype.terminate;
  Scene_Map.prototype.terminate = function () {
    MapPlay.stop();
    _PAS_Scene_Map_terminate.call(this);
  };

  // ==========================================================================
  // EXPORTS
  // ==========================================================================

  window.ProceduralAdventure = {
    Space: Anomaly,
    Earth,
    MapPlay,
    isPlaying() { return MapPlay.isRunning(); },
  };

  // GalaxySim_Scene3D / _Overlay / _Bodies still ask for the star-map encounter
  // by its old name.
  window.GalaxySim = window.GalaxySim || {};
  window.GalaxySim.Anomaly = Anomaly;
})();
