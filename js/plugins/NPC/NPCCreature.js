/*:
 * @target MZ
 * @plugindesc NPCCreature v1.0.0, creature identity for NPCs and party members
 * @author Omni-Lex
 * @help
 * ============================================================================
 * NPCCreature, who in this world is an animal rather than a person
 * ============================================================================
 * A share of every settlement is not people. In a monster world it is most of
 * them; in an ordinary one it is the stray dog on the corner and the thing in
 * the cellar. This plugin is the single place that decides who, and what they
 * are once decided:
 *
 *   , one or two archetypes out of js/db/Health/EnemyArchetypes.json
 *   , a walking sprite from those archetypes' own `sprites` roster, so what
 *     walks the street is a body the archetype actually has
 *   , a class from those archetypes' rosters (see window.CreatureClasses),
 *     which is either one of the creature classes (Feral, Mimic, Monster,
 *     Mana Cyborg, Ghost, Zombie, Mutant, Drone , ids 63-70) or one of the
 *     civilised 1-62 the archetype supports
 *   , a 3D model resolved from a $dataEnemies entry tagged with one of those
 *     same archetypes, so the model is always one the archetype supports
 *
 * A creature on a CREATURE class is non-sentient. It holds no conversation
 * (NPCConversation answers for it in growls), holds no political allegiance
 * (NPCPolitics skips it), never saves toward a better house and never moves
 * (NPCSimulationCore / NPCLifeSimulator), and starts with no money at all.
 * A creature on a civilised class is a person shaped like an animal and is
 * treated as one everywhere.
 *
 * window.NPCCreature:
 *   creatureChance()              share of new NPCs minted as creatures
 *   rollIdentity(rng)             { archetypes, archetype, spriteKey, classId }
 *   isCreatureProfile(profile)
 *   archetypeKeysOf(source)       profile | actor | "A / B" -> ["A", "B"]
 *   archetypeLabel(source)        display names, joined
 *   isNonSentientClassId(id)
 *   isNonSentientProfile(profile)
 *   isNonSentientActor(actor)
 *   isNonSentientByName(name)    party actor first, society profile second
 *   spritesForArchetypes(keys)    walking sprites both archetypes support
 *   enemyForArchetypes(keys, seed) a $dataEnemies entry of that archetype
 *   modelForArchetypes(keys, seed) { key, enemyData } for Battler3D.create
 *
 * Load order: after NPCShared, before NPCSociety.
 */

(() => {
  "use strict";

  // How much of a population is not people. A monster world is mostly them;
  // everywhere else they are the exception that makes a street feel alive.
  const CREATURE_CHANCE_MONSTER = 0.70;
  const CREATURE_CHANCE_NORMAL  = 0.05;
  // Of those, how many are a second archetype crossed into the first.
  const HYBRID_CHANCE = 0.25;
  // And how many are dealt one of their own creature classes rather than one
  // of the civilised ones their archetype also supports. Without this the roll
  // would be swamped: an archetype offers up to 62 civilised classes against a
  // handful of creature ones, so a flat draw would make nearly every creature
  // a talking one.
  const NONSENTIENT_CHANCE = 0.60;

  // Everything from Feral (63) upward is a creature class. Kept in step with
  // CreatureClasses.sentientMax(), which owns the number; this is the fallback
  // for the load-order window before CharacterCreationShared has run.
  const NONSENTIENT_CLASS_MIN = 63;

  const DEFAULT_ARCHETYPE = "Humanoid";

  function archetypes() {
    return (window.Health && window.Health.EnemyArchetypes) || {};
  }

  function sentientMax() {
    const CC = window.CreatureClasses;
    return CC && CC.sentientMax ? CC.sentientMax() : NONSENTIENT_CLASS_MIN - 1;
  }

  // ---------------------------------------------------------------------------
  // Walking sprites
  // ---------------------------------------------------------------------------
  // Every file in img/characters/Monsters is a single-character sheet and is
  // named "$Name.png"; an archetype's `sprites` roster lists the bare names.
  // The directory is read once and cached, so a roster entry whose art was
  // never shipped is dropped rather than left to draw as a blank event. When
  // the directory cannot be read at all (a browser build with no fs), the
  // roster is trusted as written , the sheets are what it was authored from.
  let _spriteFiles = null;

  function spriteFileIndex() {
    if (_spriteFiles) return _spriteFiles;
    _spriteFiles = {};
    try {
      const fs = require("fs");
      const path = require("path");
      const dir = path.join(
        path.dirname(process.mainModule.filename), "img/characters/Monsters/");
      for (const file of fs.readdirSync(dir)) {
        if (!/\.(png|jpg|jpeg)$/i.test(file)) continue;
        const name = file.replace(/\.(png|jpg|jpeg)$/i, "");
        _spriteFiles[name.replace(/^[$!]+/, "")] = name;
      }
    } catch (e) {
      _spriteFiles = null; // unreadable: fall back to trusting the roster
    }
    return _spriteFiles;
  }

  // The sheet name for one roster entry ("Beetle" -> "Monsters/$Beetle"), or
  // null when the art is missing.
  function spritePathFor(name) {
    if (!name) return null;
    const index = spriteFileIndex();
    if (!index) return "Monsters/$" + name;
    const file = index[name];
    return file ? "Monsters/" + file : null;
  }

  // Every walking sprite the given archetypes support. A hybrid draws on both
  // rosters rather than their intersection: it is one body built out of two,
  // and either half is a fair likeness of it.
  function spritesForArchetypes(keys) {
    const data = archetypes();
    const out = [];
    const seen = new Set();
    for (const key of keys || []) {
      const entry = data[key];
      for (const name of (entry && entry.sprites) || []) {
        if (seen.has(name)) continue;
        seen.add(name);
        const path = spritePathFor(name);
        if (path) out.push(path);
      }
    }
    return out;
  }

  // The archetypes a creature NPC may be minted as: the ones that have a
  // walking sprite on disk, since an NPC with no sprite has no body to stand
  // in the street with.
  let _pool = null;
  function archetypePool() {
    if (_pool) return _pool;
    const data = archetypes();
    _pool = Object.keys(data).filter((key) => spritesForArchetypes([key]).length > 0);
    return _pool;
  }

  // ---------------------------------------------------------------------------
  // Archetype reading
  // ---------------------------------------------------------------------------
  // An archetype is stored the way Health_Core stores it: "A" for one, "A / B"
  // for a hybrid. Accepts the stored string, a society profile, or an actor.
  function archetypeKeysOf(source) {
    if (!source) return [];
    let stored = source;
    if (typeof source !== "string") {
      stored = source._currentArchetype || source.archetype || "";
    }
    return String(stored)
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function archetypeLabel(source) {
    const HC = window.HealthCore;
    const keys = archetypeKeysOf(source);
    if (!keys.length) return "";
    return keys
      .map((k) => (HC && HC.getArchetypeDisplayName ? HC.getArchetypeDisplayName(k) : k))
      .join(" / ");
  }

  // ---------------------------------------------------------------------------
  // Sentience
  // ---------------------------------------------------------------------------
  function isNonSentientClassId(classId) {
    const id = Number(classId) || 0;
    return id > sentientMax();
  }

  function isCreatureProfile(profile) {
    return !!(profile && profile.isCreature);
  }

  function isNonSentientProfile(profile) {
    if (!profile) return false;
    return isNonSentientClassId(profile.assignedClassId);
  }

  function isNonSentientActor(actor) {
    if (!actor) return false;
    const id = (actor.currentClass && actor.currentClass()?.id) ?? actor._classId ?? 0;
    return isNonSentientClassId(id);
  }

  // The same question asked of a NAME, which is how the simulation layers refer
  // to everybody. A party member's truth is the class on the actor, not the one
  // on the society profile that shadows them (the profile is written by the
  // creation panel and can lag a class change), so the actor is checked first
  // and the profile answers for everybody who is not in the party.
  function isNonSentientByName(name) {
    if (!name) return false;
    if (typeof $gameParty !== "undefined" && $gameParty) {
      const member = ($gameParty.members() || []).find((m) => m && m.name() === name);
      if (member) return isNonSentientActor(member);
    }
    const profile = (typeof $gameSystem !== "undefined" && $gameSystem &&
      $gameSystem._npcSociety) ? $gameSystem._npcSociety[name] : null;
    return isNonSentientProfile(profile);
  }

  // ---------------------------------------------------------------------------
  // Minting
  // ---------------------------------------------------------------------------
  function creatureChance() {
    const WM = window.WorldManager;
    if (WM && typeof WM.isMonsterWorld === "function" && WM.isMonsterWorld()) {
      return CREATURE_CHANCE_MONSTER;
    }
    return CREATURE_CHANCE_NORMAL;
  }

  // Deals one creature identity off `rng` (anything with next()/nextInt()).
  // Returns null when there is no archetype data to build one from, so a
  // caller with no EnemyArchetypes loaded simply mints an ordinary person.
  function rollIdentity(rng) {
    const pool = archetypePool();
    if (!pool.length) return null;

    const first = pool[rng.nextInt(0, pool.length)];
    let second = null;
    if (rng.next() < HYBRID_CHANCE && pool.length > 1) {
      for (let tries = 0; tries < 8 && !second; tries++) {
        const pick = pool[rng.nextInt(0, pool.length)];
        if (pick !== first) second = pick;
      }
    }
    const keys = second ? [first, second] : [first];

    const sprites = spritesForArchetypes(keys);
    if (!sprites.length) return null;
    const spriteKey = sprites[rng.nextInt(0, sprites.length)];

    return {
      archetypes: keys,
      archetype: keys.join(" / "),
      spriteKey,
      classId: rollClassId(keys, rng),
    };
  }

  // A class out of the archetypes' own rosters, weighted so a creature is
  // usually the thing it looks like. Falls through to the fallback (Monster)
  // when CreatureClasses has not loaded.
  function rollClassId(keys, rng) {
    const CC = window.CreatureClasses;
    if (!CC) return NONSENTIENT_CLASS_MIN + 2;
    const groups = CC.groupsForArchetypes(keys[0], keys[1]);
    const wantCreature = rng.next() < NONSENTIENT_CHANCE;
    const first = wantCreature ? groups.creature : groups.sentient;
    const second = wantCreature ? groups.sentient : groups.creature;
    const list = (first && first.length) ? first : second;
    if (!list || !list.length) return CC.fallbackId();
    return list[rng.nextInt(0, list.length)];
  }

  // ---------------------------------------------------------------------------
  // 3D model
  // ---------------------------------------------------------------------------
  // The models are registered per Battler3D archetype key and resolved from a
  // $dataEnemies entry (its <Archetype:> note and its name), which is exactly
  // how the Bestiary picks one. So rather than guess a registry key from an
  // EnemyArchetypes key, look for an enemy that IS one of these archetypes and
  // let Battler3D resolve its own: whatever comes back is a model the
  // archetype supports by construction.
  let _enemiesByArchetype = null;

  function enemyIndex() {
    if (_enemiesByArchetype) return _enemiesByArchetype;
    _enemiesByArchetype = {};
    if (typeof $dataEnemies === "undefined" || !$dataEnemies) return _enemiesByArchetype;
    for (const enemy of $dataEnemies) {
      if (!enemy || !enemy.name) continue;
      const match = /<Archetype:\s*(.*?)>/i.exec(enemy.note || "");
      if (!match) continue;
      const key = match[1].trim();
      if (!key) continue;
      (_enemiesByArchetype[key] = _enemiesByArchetype[key] || []).push(enemy);
    }
    return _enemiesByArchetype;
  }

  // One enemy of these archetypes, chosen by `seed` so the same creature is
  // portrayed by the same body every time the panel is opened. Only enemies
  // Battler3D actually has a model for are considered; the picture is the
  // whole point, and an entry that resolves to nothing would draw an empty
  // frame.
  function enemyForArchetypes(keys, seed) {
    const index = enemyIndex();
    const B = window.Battler3D;
    const candidates = [];
    for (const key of keys || []) {
      for (const enemy of index[key] || []) {
        if (!B || !B.resolveKey || B.resolveKey(enemy)) candidates.push(enemy);
      }
    }
    if (!candidates.length) return null;
    const n = (Math.abs(Number(seed) || 0)) % candidates.length;
    return candidates[n];
  }

  // { key, enemyData } ready for Battler3D.create(key, 0, 0, fakeBattler), or
  // null when nothing of these archetypes can be modelled.
  function modelForArchetypes(keys, seed) {
    const B = window.Battler3D;
    if (!B || !B.create) return null;
    const list = (keys && keys.length) ? keys : [DEFAULT_ARCHETYPE];
    const enemyData = enemyForArchetypes(list, seed);
    if (enemyData) {
      const key = B.resolveKey ? B.resolveKey(enemyData) : null;
      if (key) return { key, enemyData };
    }
    return modelFromArchetypeName(list, seed);
  }

  // A handful of archetypes (Scarecrow, Dwarf, Horse, Unicorn) have a walking
  // sprite and a model but no enemy in the database tagged with them, so the
  // lookup above finds nothing to resolve through. Battler3D resolves a key
  // off a NAME as well as off a notebox, and its aliases are exactly these
  // words, so ask it with the archetype's own name. The stand-in carries a
  // stable id hashed from the key, since the id is what the model's colours
  // are rolled from and the same creature must not change colour on reopening.
  function modelFromArchetypeName(keys, seed) {
    const B = window.Battler3D;
    if (!B || !B.resolveKey) return null;
    for (const name of keys) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < name.length; i++) {
        h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
      }
      const stand = { id: (h % 900000) + 1000, name, note: "", meta: {} };
      const key = B.resolveKey(stand);
      if (key) return { key, enemyData: stand };
    }
    return null;
  }

  window.NPCCreature = {
    CREATURE_CHANCE_MONSTER, CREATURE_CHANCE_NORMAL,
    creatureChance, rollIdentity, rollClassId,
    isCreatureProfile, isNonSentientClassId, isNonSentientProfile, isNonSentientActor,
    isNonSentientByName,
    archetypeKeysOf, archetypeLabel,
    spritesForArchetypes, spritePathFor, archetypePool,
    enemyForArchetypes, modelForArchetypes,
  };
})();
