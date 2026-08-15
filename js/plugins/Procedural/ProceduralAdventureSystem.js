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
 *   Anomaly.earth.biomes.<Biome>     { scenarios: [id], tokens: {bank} }
 *   Anomaly.earth.fallbackScenarios  played on a biome nothing was written for
 *   Anomaly.scenarios.<id>           { title, start, nodes: { <id>: node } }
 *   node                             { text, choices: [{ text, to }] }
 *   terminal node                    { text, outcome: { kind, mag } }
 *
 * outcome.kind: artifact | gear | loot | gold | schrodingerite | harm | heal |
 *               battle (with `reward` naming what winning pays) | none
 *
 * ----------------------------------------------------------------------------
 * API
 * ----------------------------------------------------------------------------
 *   ProceduralAdventure.Space          the star-map encounter (= GalaxySim.Anomaly)
 *   ProceduralAdventure.Earth.tiles()          Set of "x,y" carrying a marker
 *   ProceduralAdventure.Earth.isPendingAt(x,y) is there one to play here?
 *   ProceduralAdventure.Earth.beginAt(x,y)     play it (drives the map messages)
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

  // Biome bank first, then the pack's own shared bank, then the global one.
  function anomBanks(session) {
    const db = anomalyDB();
    const pack = packOf(session);
    return [biomeEntry(session).tokens || {}, pack.tokens || {}, db.tokens || {}];
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
    if (kind === "none") spec(session.earth ? "Survival" : "Astrobiology", 1);   // i18n-ignore: specialization id
    return lines;
  }

  // ---- Battle handover ----------------------------------------------------
  // A fight cannot start inside the star map, so a battle ending arms this and
  // the scene pops back to the map before calling startBattle(). On Earth the
  // party is already standing on a map, so the presenter starts it directly.
  let _anomPendingBattle = null;

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

  // ---- The encounter itself ----------------------------------------------
  function anomScenarioFor(session) {
    const db = anomalyDB();
    const pack = packOf(session);
    const entry = biomeEntry(session);
    const list = (entry.scenarios && entry.scenarios.length)
      ? entry.scenarios : (pack.fallbackScenarios || []);
    const usable = list.filter((id) => db.scenarios && db.scenarios[id]);
    if (!usable.length) return null;
    const idx = Math.floor(seededFloat(session.key, 7717) * usable.length) % usable.length;
    return usable[idx];
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
    const view = {
      title: session.title || anomResolve(session, sc.title || ""),
      text: anomResolve(session, node.text),
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
      if (node && node.outcome) {
        if (node.outcome.kind === "battle") {
          const troopId = anomBuildTroop(s, node.outcome.count);
          if (troopId) {
            _anomPendingBattle = { troopId, outcome: node.outcome, key: s.key };
            s.rewards = [anomText("reward.battle")];
          } else {
            // No enemy could be built (a database this thin should not happen,
            // but an ending has to pay out something).
            s.rewards = anomApplyOutcome(s, Object.assign({}, node.outcome,
              { kind: node.outcome.reward || "loot" }));
          }
        } else {
          s.rewards = anomApplyOutcome(s, node.outcome);
        }
      }
      return anomBuildView(s);
    },
    // Close the encounter for good and record how it ended.
    end() {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return;
      const s = Anomaly.session();
      if (s) anomalyStore()[s.key] = { started: true, done: true, scenario: s.scenario };
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
      BattleManager.setup(pend.troopId, true, false);
      BattleManager.setEventCallback((result) => {
        // Victory pays what the ending promised; anything else is the walk back.
        if (result === 0 && session) {
          const lines = anomApplyOutcome(session, Object.assign({}, pend.outcome, { kind: pend.outcome.reward || "loot" }));
          if (window.ParchmentToast) {
            window.ParchmentToast.group(lines.map((l) => ({ text: l, severity: "good" })));
          }
        }
        Anomaly.end();
      });
      SceneManager.push(Scene_Battle);
      return true;
    },
  };

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

  let _earthTiles = null;      // Map<"x,y", biome> for this world
  let _earthTilesSeed = null;  // the world the set was built for

  // One square per biome, seeded: walk the biome's own coordinate list from a
  // seeded offset and take the first square the party could actually stand on.
  function buildEarthTiles() {
    const tiles = new Map();
    const cache = biomeCoordinateCache();
    if (!cache) return tiles;
    const pack = earthDB();
    const written = Object.keys(pack.biomes || {});
    if (!written.length) return tiles;
    // Biomes the map actually paints, each resolved to the adventure it plays,
    // so the road variants do not each claim a marker of their own.
    const byAdventure = {};
    Object.keys(cache).forEach((biome) => {
      const coords = cache[biome];
      if (!Array.isArray(coords) || !coords.length) return;
      const key = earthBiomeKey(biome);
      if (!key) return;
      (byAdventure[key] = byAdventure[key] || []).push(...coords);
    });
    Object.keys(byAdventure).sort().forEach((biome) => {
      const coords = byAdventure[biome];
      const start = Math.floor(seededFloat(biome, 5443) * coords.length) % coords.length;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[(start + i * 7919) % coords.length];
        if (!c || typeof c.x !== "number") continue;
        const key = c.x + "," + c.y;   // i18n-ignore: coordinate key
        if (tiles.has(key)) continue;
        if (!isFreeWorldTile(c.x, c.y)) continue;
        tiles.set(key, biome);
        return;
      }
    });
    return tiles;
  }

  function earthTiles() {
    const seed = worldSeed();
    if (_earthTiles && _earthTilesSeed === seed) return _earthTiles;
    if (typeof $gameMap === "undefined" || !$gameMap || $gameMap.mapId() !== WORLD_MAP_ID) {
      return _earthTiles || new Map();
    }
    const built = buildEarthTiles();
    // The biome coordinate cache is built on the first world-map load and may
    // not be there yet on the frame this is first asked. An empty answer is
    // never cached, so the markers appear as soon as it is.
    if (!built.size) return built;
    _earthTiles = built;
    _earthTilesSeed = seed;
    return _earthTiles;
  }

  const Earth = {
    // Squares that still carry a marker: the built set, minus everything the
    // party has already answered.
    tiles() {
      const out = new Set();
      const store = anomalyStore();
      earthTiles().forEach((biome, key) => {
        const rec = store[earthKey.apply(null, key.split(","))];
        if (rec && rec.done) return;
        out.add(key);
      });
      return out;
    },
    biomeAt(x, y) { return earthBiomeAt(x, y); },
    // Is there an adventure to play on this square? Answered squares say no,
    // and so does every square that never carried one.
    isPendingAt(x, y) {
      const key = x + "," + y;   // i18n-ignore: coordinate key
      if (!earthTiles().has(key)) return false;
      const rec = anomalyStore()[earthKey(x, y)];
      return !rec || !rec.done;
    },
    // Open the adventure written for this square's biome and hand it to the
    // map presenter. Returns false when there was nothing to play.
    beginAt(x, y) {
      if (typeof $gameSystem === "undefined" || !$gameSystem) return false;
      if (!Earth.isPendingAt(x, y)) return false;
      const key = earthKey(x, y);
      const live = Anomaly.session();
      if (live && live.key === key) { MapPlay.start(live); return true; }
      const biomeName = earthBiomeAt(x, y) || earthTiles().get(x + "," + y);
      const biome = earthBiomeKey(biomeName) || earthTiles().get(x + "," + y);
      const display = window.BiomeNames
        ? window.BiomeNames.display(biomeName || biome) : String(biomeName || biome);
      const region = earthRegionName(x, y);
      const session = {
        key,
        earth: true,
        biome: biome || "",
        // What a relic lifted here is named after: the country if the world map
        // knows one, the biome itself otherwise.
        placeName: region || display,
        roll: seededHash(key, 8191) || 1,
        ctx: {},
        rewards: [],
        node: null,
        scenario: null,
      };
      session.ctx.biome = display;
      session.ctx.place = display;
      session.ctx.region = region || display;
      if (!anomOpen(session)) return false;
      MapPlay.start(session);
      return true;
    },
  };

  // The country the square belongs to, for the one line of prose that wants to
  // name where in the world this is. Nothing on file: the biome name stands.
  function earthRegionName(x, y) {
    try {
      const c = $gameSystem && $gameSystem.getCountryFromWorldCoordinates
        ? $gameSystem.getCountryFromWorldCoordinates(x, y) : null;
      return (c && c.country) ? c.country : null;
    } catch (e) { return null; }
  }

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
          head.concat(lines).forEach((l) => $gameMessage.add(l));
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
            $gameMessage.add(anomText("ui.walkedAway"));
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
          this.queue(() => page.forEach((l) => $gameMessage.add(l)));
        });
      }
      this.queue(() => this.finish());
    },

    finish() {
      this._running = false;
      this._steps = [];
      if (Anomaly.hasPendingBattle()) {
        try { Anomaly.startBattle(); return; } catch (e) { console.error(e); }
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
  // scene is the only place a battle can be pushed from safely.
  const _PAS_Scene_Map_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function () {
    _PAS_Scene_Map_start.call(this);
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
