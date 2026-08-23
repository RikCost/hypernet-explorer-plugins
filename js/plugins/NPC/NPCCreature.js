/*:
 * @target MZ
 * @plugindesc NPCCreature v1.0.0, creature identity for NPCs and party members
 * @author Omni-Lex
 * @help
 * ============================================================================
 * NPCCreature, who in this world is an animal rather than a person
 * ============================================================================
 * A share of every settlement is not people. In a monster world it is ALL of
 * them; in an ordinary one it is the stray dog on the corner and the thing in
 * the cellar, one face in twelve. This plugin is the single place that decides
 * who, and what they are once decided:
 *
 * The sprite is dealt FIRST and everything else follows from it, so what is
 * minted is always a body the wardrobe actually has art for:
 *
 *   , a walking sprite out of the creature wardrobe, which is the `creature`
 *     and `animal` entries of js/db/WorldGen/NPCs.json (the Creatures/ and
 *     Animals/ folders) and nothing else. The Monsters/ folder is what a
 *     battle is drawn with and is NOT dealt here: a beast wearing an enemy
 *     sheet on a town street reads as a monster the party failed to notice.
 *     Those sheets come back only in a monster world, where the confusion
 *     costs nothing because everything walking about IS a monster.
 *     A monster world deals the two halves of that wardrobe EVENLY, the half
 *     first and the sheet inside it second: half of its crowd is a `creature`
 *     sheet (the Monsters/ ones with them) and half is an `animal` one.
 *   , the archetype that sprite carries in its own NPCs.json entry, plus a
 *     second one crossed into it on a 5% roll (25% in a monster world)
 *   , a class out of that SHEET's own `classes` array, never out of the
 *     archetype's roster: the sheet is the authority and the archetype (a
 *     crossed-in second one included) never changes the answer. It is one of
 *     the creature classes the sheet lists (Feral, Mimic, Monster, Mana
 *     Cyborg, Ghost, Zombie, Mutant, Drone , ids 63-70) on 95% of rolls (50%
 *     in a monster world) and one of the civilised 1-62 it lists on the rest.
 *     Only a sheet with no entry to read (a Monsters/ one) falls back to the
 *     archetype rosters, since it has nothing else to be.
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
 *   hybridChance() / nonSentientChance()
 *   rollIdentity(rng, exterior)   { archetypes, archetype, spriteKey,
 *                                   bustIndex, classId }, exterior (default
 *                                   true) gates the Animals/ half of the
 *                                   wardrobe to NPCs standing outside
 *   isCreatureProfile(profile)
 *   archetypeKeysOf(source)       profile | actor | "A / B" -> ["A", "B"]
 *   archetypeLabel(source)        display names, joined
 *   isNonSentientClassId(id)
 *   isNonSentientProfile(profile)
 *   isNonSentientActor(actor)
 *   isNonSentientByName(name)    party actor first, society profile second
 *   creatureWardrobe()            [{ spriteKey, archetype, busts, half }] to
 *                                 deal from, `half` being "creature"/"animal"
 *   spritesForArchetypes(keys)    walking sprites both archetypes support
 *   enemyForArchetypes(keys, seed) a $dataEnemies entry of that archetype
 *   modelForArchetypes(keys, seed) { key, enemyData } for Battler3D.create
 *   modelKeyForSprite(spriteKey) / modelForSprite(spriteKey)
 *                                 the model an NPCs.json sheet names outright
 *
 * Load order: after NPCShared, before NPCSociety.
 */

(() => {
  "use strict";

  // How much of a population is not people. A monster world is ALL of them,
  // and there the two halves of the wardrobe are dealt evenly: half of what
  // walks about is a `creature` sheet and half is an `animal` one (see
  // rollIdentity). Everywhere else they are the exception that makes a street
  // feel alive, one face in twelve, and the halves are dealt flat.
  const CREATURE_CHANCE_MONSTER = 1.0;
  const CREATURE_CHANCE_NORMAL  = 0.08;
  // The monster world's even split between the two halves of the wardrobe.
  const MONSTER_CREATURE_HALF = 0.5;
  // Of those, how many are a second archetype crossed into the first. A hybrid
  // is a curiosity in an ordinary world and an everyday sight in a monster one.
  const HYBRID_CHANCE_MONSTER = 0.25;
  const HYBRID_CHANCE_NORMAL  = 0.05;
  // And how many are dealt one of their own creature classes rather than one
  // of the civilised ones their archetype also supports. It is not a flat draw
  // over the two rosters: an archetype offers up to 62 civilised classes
  // against a handful of creature ones, so a flat draw would make nearly every
  // creature a talking one. A stray dog is a dog. In a monster world the split
  // is even, because there a talking beast is half the population.
  const NONSENTIENT_CHANCE_MONSTER = 0.50;
  const NONSENTIENT_CHANCE_NORMAL  = 0.95;

  // Everything from Feral (63) upward is a creature class. Kept in step with
  // CreatureClasses.sentientMax(), which owns the number; this is the fallback
  // for the load-order window before CharacterCreationShared has run.
  const NONSENTIENT_CLASS_MIN = 63;

  const DEFAULT_ARCHETYPE = "Humanoid";

  function archetypes() {
    return (window.Health && window.Health.Archetypes) || {};
  }

  function sentientMax() {
    const CC = window.CreatureClasses;
    return CC && CC.sentientMax ? CC.sentientMax() : NONSENTIENT_CLASS_MIN - 1;
  }

  // The one question every share below is asked of. A monster world is the only
  // place the battle sheets are worn in the street and the only place a talking
  // beast is unremarkable, so both answers hang off it.
  function isMonsterWorld() {
    const WM = window.WorldManager;
    return !!(WM && typeof WM.isMonsterWorld === "function" && WM.isMonsterWorld());
  }

  function hybridChance() {
    return isMonsterWorld() ? HYBRID_CHANCE_MONSTER : HYBRID_CHANCE_NORMAL;
  }

  function nonSentientChance() {
    return isMonsterWorld() ? NONSENTIENT_CHANCE_MONSTER : NONSENTIENT_CHANCE_NORMAL;
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

  // ---------------------------------------------------------------------------
  // The creature wardrobe
  // ---------------------------------------------------------------------------
  // What a creature NPC may actually be seen wearing, as
  // [{ spriteKey, archetype, busts }]. Ordinarily it is the Creatures/ and
  // Animals/ halves of the NPCs.json catalogue and nothing else, so a beast met
  // in the street is drawn from the same wardrobe every other inhabitant is and
  // is never confused with an enemy on the map.
  //
  // A monster world adds the Monsters/ sheets on top, one entry per archetype
  // that lists the sheet, so the battle art walks about there too. That is the
  // one setting where it cannot mislead: everything in it is a monster.
  //
  // Cached per world flavour, since the answer changes with the population mode
  // and the magic level and a world can be switched inside one session.
  let _wardrobe = null;
  let _wardrobeArchetypes = null;
  let _wardrobeSlot = "";

  function npcData() {
    return (window.WorldGen && window.WorldGen.NPCs) || {};
  }

  function wardrobeSlot(exterior) {
    const magic = (window.MagicNature && window.MagicNature.level)
      ? window.MagicNature.level() : "normal";
    return (isMonsterWorld() ? "monster" : "normal") + ":" + magic + ":" + (exterior ? "ext" : "int");
  }

  // The catalogue half: every `creature` / `animal` entry the world allows.
  // SpriteCatalog owns the wardrobe and answers this when it is loaded; the
  // fallback reads the same file directly for the load-order window before
  // DataService has run.
  //
  // `exterior` (default true, permissive) gates the Animals/ half only: a
  // stray dog belongs on the street, not the landing of somebody's staircase.
  // The Creatures/ half (Mimic, Ghost, Zombie...) is unaffected, those are as
  // much at home behind a door as anywhere else.
  function catalogueKeys(exterior = true) {
    const SC = window.SpriteCatalog;
    if (SC && typeof SC.creatureKeys === "function") return SC.creatureKeys({ exterior });
    const data = npcData();
    return Object.keys(data).filter((k) => {
      const e = data[k];
      if (!e || e.npc !== true) return false;
      if (e.creature === true) return true;
      return e.animal === true && exterior;
    });
  }

  function creatureWardrobe(exterior = true) {
    const slot = wardrobeSlot(exterior);
    if (_wardrobe && _wardrobeSlot === slot) return _wardrobe;
    _wardrobeSlot = slot;

    const data = npcData();
    const known = archetypes();
    const out = [];
    for (const key of catalogueKeys(exterior)) {
      const entry = data[key];
      const archetype = (entry && entry.Archetype) || "";
      // An entry naming an archetype the health tables never heard of has no
      // class roster and no anatomy to be built from, so it is not dealt.
      if (!archetype || !known[archetype]) continue;
      // Which half of the wardrobe the sheet came out of, the `creature` or
      // the `animal` one. A monster world deals the two evenly and needs to be
      // able to tell them apart after the fact.
      out.push({
        spriteKey: key,
        archetype,
        busts: (entry.busts || []).length,
        half: entry.animal === true ? "animal" : "creature"
      });
    }

    if (isMonsterWorld()) {
      const seen = new Set(out.map((e) => e.spriteKey));
      for (const archetype of Object.keys(known)) {
        for (const spriteKey of spritesForArchetypes([archetype])) {
          if (seen.has(spriteKey)) continue;
          seen.add(spriteKey);
          // A Monsters/ sheet is one character wide and carries no bust of
          // its own; the panel draws its 3D model instead. It counts as the
          // creature half: a bestiary sheet is a monster by construction, and
          // the 32 `creature` entries alone would repeat themselves all day.
          out.push({ spriteKey, archetype, busts: 0, half: "creature" });
        }
      }
    }

    _wardrobe = out;
    _wardrobeArchetypes = [...new Set(out.map((e) => e.archetype))];
    return _wardrobe;
  }

  // The archetypes a creature NPC may be minted as: the ones some sheet in the
  // wardrobe actually wears, since an NPC with no sprite has no body to stand
  // in the street with. Built with the wardrobe and cached with it, the hybrid
  // roll asks for it on every cross.
  function archetypePool(exterior = true) {
    creatureWardrobe(exterior);
    return _wardrobeArchetypes || [];
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
    return isMonsterWorld() ? CREATURE_CHANCE_MONSTER : CREATURE_CHANCE_NORMAL;
  }

  // Deals one creature identity off `rng` (anything with next()/nextInt()).
  // Returns null when the wardrobe has nothing to dress one in, so a caller
  // with no catalogue loaded simply mints an ordinary person.
  //
  // The order matters and is the whole point: the SHEET is drawn first, and the
  // archetype is read off the sheet rather than the sheet hunted for the
  // archetype. A creature is therefore always something the wardrobe has a
  // picture of, and what it is called is always what it looks like.
  function rollIdentity(rng, exterior = true) {
    const wardrobe = creatureWardrobe(exterior);
    if (!wardrobe.length) return null;

    // 1. The body. A monster world picks the HALF first and the sheet inside
    //    it second, so its crowd is half creatures and half animals however
    //    lopsided the two halves are in the file. Everywhere else a creature
    //    is rare enough that a flat draw over the whole wardrobe is what makes
    //    a stray dog the commonest one, which is the point.
    let pool = wardrobe;
    if (isMonsterWorld()) {
      const half = rng.next() < MONSTER_CREATURE_HALF ? "creature" : "animal";
      const side = wardrobe.filter((e) => e.half === half);
      if (side.length) pool = side;
    }
    const worn = pool[rng.nextInt(0, pool.length)];
    const first = worn.archetype;

    // 2. The second half, on the world's hybrid share. Drawn from the
    //    archetypes the wardrobe itself covers, so a cross is always between
    //    two things this world has bodies for.
    let second = null;
    if (rng.next() < hybridChance()) {
      const pool = archetypePool(exterior);
      if (pool.length > 1) {
        for (let tries = 0; tries < 8 && !second; tries++) {
          const pick = pool[rng.nextInt(0, pool.length)];
          if (pick !== first) second = pick;
        }
      }
    }
    const keys = second ? [first, second] : [first];

    return {
      archetypes: keys,
      archetype: keys.join(" / "),
      spriteKey: worn.spriteKey,
      // A catalogue sheet carries its own faces; a Monsters/ sheet is one
      // character wide and has none.
      bustIndex: worn.busts > 1 ? rng.nextInt(0, worn.busts) : 0,
      classId: rollClassId(worn.spriteKey, keys, rng),
    };
  }

  // A class off the SHEET's own roster, the `classes` array of its NPCs.json
  // entry, weighted so a creature is usually the thing it looks like. The
  // sheet is the authority and the archetype never overrides it: a body is a
  // body, and crossing a second archetype into it (the hybrid roll above) is
  // not allowed to turn a stray dog into somebody else's profession. Every
  // `creature` entry carries both halves for exactly this: its own creature
  // classes (Feral, Mimic, Ghost...) and the civilised ones a talking one of
  // its kind may hold. An `animal` entry carries the creature half alone.
  //
  // Only a sheet with no entry of its own to read (a Monsters/ bestiary sheet,
  // dealt in a monster world) falls back to the archetype rosters, since there
  // is nothing else for it to be, and to the flat Monster class after that.
  function rollClassId(spriteKey, keys, rng) {
    const entry = npcData()[spriteKey];
    const own = Array.isArray(entry && entry.classes) ? entry.classes : [];
    let creature = own.filter((id) => isNonSentientClassId(id));
    let sentient = own.filter((id) => !isNonSentientClassId(id));
    const CC = window.CreatureClasses;
    if (!own.length) {
      if (!CC) return NONSENTIENT_CLASS_MIN + 2;
      const groups = CC.groupsForArchetypes(keys[0], keys[1]);
      creature = groups.creature || [];
      sentient = groups.sentient || [];
    }
    const wantCreature = rng.next() < nonSentientChance();
    const first = wantCreature ? creature : sentient;
    const second = wantCreature ? sentient : creature;
    const list = first.length ? first : second;
    if (!list.length) return CC ? CC.fallbackId() : NONSENTIENT_CLASS_MIN + 2;
    return list[rng.nextInt(0, list.length)];
  }

  // ---------------------------------------------------------------------------
  // 3D model
  // ---------------------------------------------------------------------------
  // The models are registered per Battler3D archetype key and resolved from a
  // $dataEnemies entry (its <Archetype:> note and its name), which is exactly
  // how the Bestiary picks one. So rather than guess a registry key from an
  // Archetypes key, look for an enemy that IS one of these archetypes and
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

  // The model a sprite sheet is portrayed by when its own catalogue entry names
  // one. Every `animal` and `creature` entry in js/db/WorldGen/NPCs.json now
  // carries a `model` field naming a registered Battler3D key, so a hen is
  // drawn as a bird and a lich as a lich rather than as whatever the archetype
  // lookup below happened to land on. Returns null when the sheet names no
  // model, or names one nothing is registered under (which would draw an empty
  // frame), and the archetype lookup answers instead.
  function modelKeyForSprite(spriteKey) {
    if (!spriteKey) return null;
    const data = npcData();
    let entry = data[spriteKey];
    if (!entry) {
      const base = String(spriteKey).split("/").pop();
      for (const key of Object.keys(data)) {
        if (key.split("/").pop() === base) { entry = data[key]; break; }
      }
    }
    const key = entry && entry.model ? String(entry.model).toLowerCase() : "";
    if (!key) return null;
    const B = window.Battler3D;
    if (!B || !B.create || !B.list) return null;
    return B.list().indexOf(key) < 0 ? null : key;
  }

  // The same answer as { key, enemyData }, ready for Battler3D.create. The
  // stand-in enemy carries an id hashed off the model key, since the id is what
  // the model's colours are rolled from: every hen is the same hen, and stays
  // that hen when the panel is closed and opened again.
  function modelForSprite(spriteKey) {
    const key = modelKeyForSprite(spriteKey);
    if (!key) return null;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    }
    return { key, enemyData: { id: (h % 900000) + 1000, name: key, note: "", meta: {} } };
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
    creatureChance, hybridChance, nonSentientChance,
    rollIdentity, rollClassId,
    isCreatureProfile, isNonSentientClassId, isNonSentientProfile, isNonSentientActor,
    isNonSentientByName,
    archetypeKeysOf, archetypeLabel,
    creatureWardrobe, spritesForArchetypes, spritePathFor, archetypePool,
    enemyForArchetypes, modelForArchetypes,
    modelKeyForSprite, modelForSprite,
  };
})();
