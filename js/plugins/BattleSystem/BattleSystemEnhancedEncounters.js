// ============================================================================
// Battle System Enhanced - Encounters & Spawning Engine
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0 Encounter module: archetypes, time-based spawning, movement.
 * @author Combined by Claude, modified by OmniLex
 * @pluginName BattleSystemEnhancedEncounters
 *
 * @help
 * ============================================================================
 * BattleSystemEnhancedEncounters, Sub-module
 * ============================================================================
 *
 * Requires BattleSystemEnhanced.js (Core) to be loaded first.
 * Provides encounter/spawning engine: archetype arrays, time-based shifts,
 * procedural generation scaling limits, tile map validation, and enemy movement.
 *
 * ----------------------------------------------------------------------------
 * Enemy spawn modes (Options -> Enemy Spawn, ConfigManager.enemySpawnMode)
 * ----------------------------------------------------------------------------
 *   Balanced (0, default)
 *     Roaming enemies stay at or below the party's median level. Exactly one
 *     high-level encounter is placed per world map tile: a boss much stronger
 *     than the party (party+10 or party*1.5, whichever is higher) and never
 *     above level 100.
 *
 *   Realistic (1)
 *     Party level is ignored. The spawnable level band is derived from the
 *     biome's danger tier (safe / wild / hostile / deadly) and the world map
 *     distance to the Omega Tower: the further from the tower, the higher the
 *     levels, reaching the ceiling around 200 tiles out. No per-tile boss.
 *
 * Both modes keep the nation-seeded distribution intact: the country the player
 * is in still decides which enemies of the biome are absent, rare, normal or
 * common, and the mode only restricts the level range of that weighted pool.
 *
 * ----------------------------------------------------------------------------
 * Spawn era (in-game year, applies to both modes and to the sandbox)
 * ----------------------------------------------------------------------------
 *   2001-2009  levels capped at 100, nothing else changes.
 *   2010+      the cap stays at 100, but a quarter of the roaming enemies is
 *              drawn from a level 80-100 pool.
 *   2012+      the cap is lifted and two fifths of the roaming enemies are
 *              drawn from a level 100+ pool.
 * These high-level spawns ignore the party level and the distance from the
 * Omega Tower, and appear alongside the normally levelled fauna. The sandbox
 * lifts the cap at any year, and scales enemy stats instead (SandboxMode.js).
 *
 * ----------------------------------------------------------------------------
 * Reinforcements (Scene_Battle fights only)
 * ----------------------------------------------------------------------------
 * A fight started against a map "Enemy" event drags in every other roaming
 * monster of the SAME enemy type standing less than JOIN_RANGE (8) tiles from
 * the party, up to a total of BATTLE_MAX_MEMBERS (3) fighters across the whole
 * battle (base troop + joiners). Joiners are taken nearest-first. Their troops
 * are appended to the one the battle was started with and the combined troop is
 * written into a single scratch $dataTroops slot, reused for every reinforced
 * battle. Each joiner's map event is settled the way the triggering one is:
 * deleted on a win or a recruit, locked with its wounds kept on a flee. Enemies
 * that died before a flee are turned into map corpses on return. A tactical map
 * battle (MapBattleMode.js) already fights everyone where they stand and is
 * never reinforced this way.
 *
 * Loading order:
 *   1. BattleSystemEnhanced.js (Core)
 *   2. BattleSystemEnhancedEncounters.js (THIS PLUGIN)
 *   3. BattleSystemEnhancedState.js
 *   4. BattleSystemEnhancedDeath.js
 *   5. BattleSystemEnhancedMechanics.js
 *   6. BattleSystemEnhancedLevelDisplay.js
 */

(() => {
    'use strict';

    // Ensure core namespace exists
    if (!window.BattleSystemEnhanced) {
        console.error('BattleSystemEnhancedEncounters: Core plugin not loaded!');
        return;
    }
    const BSE = window.BattleSystemEnhanced;

    // ========================================================================
    // 1a. ECOLOGY (predator / prey / hunter food-web behaviour)
    // ========================================================================
    // Each map "Enemy" event carries an ecology role in its enemy note
    // (<Hunter>, <Predator>, <Prey> or <Neutral>). Roles drive who hunts whom
    // on the overworld and who tends to win when two enemy events meet.

    // Awareness radius (tiles) for hunting / fleeing
    BSE.Data.ECOLOGY_AWARENESS = 6;

    // Who each role actively hunts (moves toward and tries to kill)
    const ECO_TARGETS = {
        Hunter:   ['Predator', 'Prey'],
        Predator: ['Hunter', 'Prey', 'Neutral'],
        Prey:     [],
        Neutral:  []
    };

    // Combat dominance: who tends to win when two roles fight
    const ECO_DOMINATES = {
        Hunter:   ['Predator', 'Prey', 'Neutral'],
        Predator: ['Prey', 'Neutral'],
        Prey:     [],
        Neutral:  []
    };

    BSE.Helpers.getEnemyEcology = function(enemyData) {
        if (!enemyData) return 'Neutral';
        // Notes are immutable at runtime; parse the regex once and cache on the
        // shared $dataEnemies object. This is called from per-frame ecology
        // movement/combat scans, so the regex-per-call cost adds up fast.
        if (enemyData._bseEcology !== undefined) return enemyData._bseEcology;
        let v = 'Neutral';
        if (enemyData.note) {
            const m = enemyData.note.match(/<(Hunter|Predator|Prey|Neutral)>/i);
            if (m) {
                const s = m[1].toLowerCase();
                v = s.charAt(0).toUpperCase() + s.slice(1);
            }
        }
        enemyData._bseEcology = v;
        return v;
    };

    BSE.Helpers.getEventEcology = function(event) {
        if (!event || !event._fixedTroopId) return null;
        // Cache the resolved role on the event, keyed on the troop id so it
        // recomputes if the event is ever re-fixed to a different troop.
        if (event._bseEcoTroop === event._fixedTroopId) return event._bseEcoRole;
        const troop = $dataTroops[event._fixedTroopId];
        let role = null;
        if (troop && troop.members.length) {
            const enemy = $dataEnemies[troop.members[0].enemyId];
            role = enemy ? BSE.Helpers.getEnemyEcology(enemy) : 'Neutral';
        }
        event._bseEcoTroop = event._fixedTroopId;
        event._bseEcoRole = role;
        return role;
    };

    // does role a actively hunt role b?
    BSE.Helpers.ecologyChases = function(a, b) {
        return !!(a && b && ECO_TARGETS[a] && ECO_TARGETS[a].indexOf(b) >= 0);
    };
    // does role a dominate role b in a straight fight?
    BSE.Helpers.ecologyDominates = function(a, b) {
        return !!(a && b && ECO_DOMINATES[a] && ECO_DOMINATES[a].indexOf(b) >= 0);
    };

    // A live, battle-ready "Enemy" event
    function isLiveEnemyEvent(ev) {
        // A monster taking part in a map battle (MapBattleMode.js) is off limits
        // to the ecology sim: it is being fought by the party right now, and a
        // wildlife brawl resolving in the background could erase it (and its
        // battler's map position) out from under the fight.
        if (ev && ev._mbmCombatant) return false;
        return !!(ev && !ev._erased && ev.event() &&
            ev.event().name === "Enemy" && ev._fixedTroopId > 0);
    }

    // ========================================================================
    // 1. ARCHETYPE LISTS
    // ========================================================================

    // Aquatic Enemy Archetype List - Only spawn in water, move freely in water at normal speed
    BSE.Data.AQUATIC_ENEMY_ARCHETYPES = [
        'Octopus', 'AquaticFish', 'SeaCreature', 'TentacledCreature',
        'DeepSea', 'Coral', 'Whale', 'Shark', 'Jellyfish', 'Crab',
        'Lobster', 'Seahorse', 'Starfish', 'Eel', 'Dolphin', 'Manta',
        'Squid', 'Kraken', 'Leviathan', 'Merfolk', 'Siren', 'WaterElemental',
    ];

    // Amphibious Enemy Archetype List - Spawn on land, faster in water, slower on land
    BSE.Data.AMPHIBIOUS_ENEMY_ARCHETYPES = [
        'Crocodile', 'Penguin', 'Frog', 'SeaTurtle', 'Slime'
    ];

    // Flying Enemy Archetype List - Ignore terrain restrictions, move freely everywhere at normal speed
    BSE.Data.FLYING_ENEMY_ARCHETYPES = [
        'Bird', 'Elemental', 'Ghost',
    ];

    const AQUATIC  = BSE.Data.AQUATIC_ENEMY_ARCHETYPES;
    const AMPHIB   = BSE.Data.AMPHIBIOUS_ENEMY_ARCHETYPES;
    const FLYING   = BSE.Data.FLYING_ENEMY_ARCHETYPES;

    // ========================================================================
    // 2. ARCHETYPE CHECK FUNCTIONS
    // ========================================================================

    BSE.Helpers.getAquaticArchetype = function(archetype) {
        return archetype ? AQUATIC.includes(archetype) : false;
    };

    BSE.Helpers.getAmphibiousArchetype = function(archetype) {
        return archetype ? AMPHIB.includes(archetype) : false;
    };

    BSE.Helpers.getFlyingArchetype = function(archetype) {
        return archetype ? FLYING.includes(archetype) : false;
    };

    /**
     * Is (x, y) part of the road surface or its dashed center line in the
     * current procedural road biome? Roaming enemies keep off the carriageway.
     */
    BSE.Helpers.isRoadFeatureTile = function(x, y) {
        const roads = window.ProcGenRoads;
        return !!(roads && roads.isRoadFeatureTileAt && roads.isRoadFeatureTileAt(x, y));
    };

    // ========================================================================
    // 3. TIME-BASED ENEMY SPAWNING SYSTEM
    // ========================================================================

    /**
     * Get current game time in 24-hour format
     */
    BSE.Helpers.getCurrentGameTime = function() {
        const totalMinutes = $gameVariables.value(114) || 0;
        const hour = Math.floor((totalMinutes / 60) % 24);
        const minute = Math.floor(totalMinutes % 60);
        return { hour, minute, totalMinutes };
    };

    /**
     * Determine time period
     * Dawn: 5-7, Dusk: 17-19, Day: 7-17, Night: 19-5
     */
    BSE.Helpers.getTimeOfDay = function() {
        const { hour } = BSE.Helpers.getCurrentGameTime();
        if (hour >= 5 && hour < 7) return 'dawn';
        if (hour >= 7 && hour < 17) return 'day';
        if (hour >= 17 && hour < 19) return 'dusk';
        if (hour >= 19 || hour < 5) return 'night';
    };

    /**
     * Get which activity patterns should spawn at current time
     */
    BSE.Helpers.getApplicableActivityPatterns = function() {
        const timeOfDay = BSE.Helpers.getTimeOfDay();
        switch (timeOfDay) {
            case 'day':
                return ['Diurnal', 'Crepuscular'];
            case 'night':
                return ['Nocturnal', 'Crepuscular'];
            case 'dawn': {
                const rand = Math.random();
                return rand < 0.7 ? ['Crepuscular'] : ['Crepuscular', 'Diurnal'];
            }
            case 'dusk': {
                const rand = Math.random();
                return rand < 0.7 ? ['Crepuscular'] : ['Crepuscular', 'Nocturnal'];
            }
        }
        return ['Crepuscular'];
    };

    /**
     * Get activity pattern from enemy note
     */
    BSE.Helpers.getEnemyActivityPattern = function(enemyData) {
        if (!enemyData || !enemyData.note) return null;
        if (enemyData.note.includes('<Nocturnal>')) return 'Nocturnal';
        if (enemyData.note.includes('<Diurnal>')) return 'Diurnal';
        if (enemyData.note.includes('<Crepuscular>')) return 'Crepuscular';
        return null;
    };

    /**
     * Check if a troop can spawn at current time
     */
    BSE.Helpers.canTroopSpawnAtCurrentTime = function(troopId) {
        const troop = $dataTroops[troopId];
        if (!troop || !troop.members.length) return true;
        const applicablePatterns = BSE.Helpers.getApplicableActivityPatterns();
        let hasTimeRestriction = false;
        for (const member of troop.members) {
            const enemyData = $dataEnemies[member.enemyId];
            if (!enemyData) continue;
            const activityPattern = BSE.Helpers.getEnemyActivityPattern(enemyData);
            if (!activityPattern) continue;
            hasTimeRestriction = true;
            if (applicablePatterns.includes(activityPattern)) return true;
        }
        // Troops with no time-restricted members may spawn at any time; troops
        // with restrictions only spawn when a member's pattern matches now.
        return !hasTimeRestriction;
    };

    /**
     * Filter encounter list by current time
     */
    BSE.Helpers.filterEncountersByTime = function(encounterList) {
        if (!encounterList || !encounterList.length) return encounterList;
        const validTroops = encounterList.filter(enc =>
            BSE.Helpers.canTroopSpawnAtCurrentTime(enc.troopId)
        );
        return validTroops.length > 0 ? validTroops : encounterList;
    };

    // ========================================================================
    // 3b. NATION-SEEDED SPAWN FREQUENCY & LEVEL CAP
    // ========================================================================
    // This section builds the base candidate pool, shared by both spawn modes
    // (see section 4b, which then narrows it by level). Every enemy of the
    // current biome is eligible across its full level range; the only bias
    // applied here is the current nation. The nation
    // the player is in (Variable 86, the country id) seeds a stable per-enemy
    // frequency class: in one nation a given enemy may be absent, in another
    // rare, common, or abundant. The same (enemy, nation) pair always resolves
    // to the same class, so each nation keeps a consistent local fauna.
    //
    // The level gate is the spawn era (see BSE.Helpers.getSpawnEra): a hard cap
    // that keeps the world at level 100 until the in-game year reaches 2010,
    // plus, from that same year, a high-level pool that is mixed in among the
    // normally levelled fauna no matter which spawn mode is selected.

    const SPAWN_START_YEAR = 2001; // TimeDateSystem epoch (Jan 1 2001)
    const ERA_HIGH_LEVEL_YEAR = 2010; // level 80-100 monsters start roaming
    const ERA_COLLAPSE_YEAR   = 2012; // the paradox completes: level 100+ roam

    // Share of the roaming enemies on a map drawn from the era's high-level
    // pool instead of from the spawn mode's own level logic.
    const ERA_HIGH_LEVEL_SHARE = 0.25;
    const ERA_COLLAPSE_SHARE   = 0.40;

    // Current in-game year as a fractional number, derived from Variable 114
    // (total game minutes since the Jan 1 2001 epoch used by TimeDateSystem).
    BSE.Helpers.getCurrentGameYear = function() {
        const totalMinutes = $gameVariables.value(114) || 0;
        const minutesPerYear = 365.25 * 24 * 60;
        return SPAWN_START_YEAR + (totalMinutes / minutesPerYear);
    };

    // The spawn era of the current in-game year:
    //   cap        - hard level ceiling every troop pool is filtered by
    //   eliteMin   - lowest level of the era's high-level pool (0 = no pool)
    //   eliteMax   - highest level of that pool
    //   eliteShare - fraction of the roaming enemies drawn from it
    //
    // As the Squishing accelerates the fauna gets out of hand: from 2010 the
    // world starts fielding level 80-100 monsters, and from 2012 level 100+
    // ones. They turn up alongside the normally levelled enemies and are picked
    // without consulting the party level or the distance from the Omega Tower,
    // so they appear in both spawn modes alike.
    BSE.Helpers.getSpawnEra = function() {
        const year = BSE.Helpers.getCurrentGameYear();
        let era;
        if (year >= ERA_COLLAPSE_YEAR) {
            era = { key: 'collapse', cap: Infinity, eliteMin: 100,
                    eliteMax: Infinity, eliteShare: ERA_COLLAPSE_SHARE };
        } else if (year >= ERA_HIGH_LEVEL_YEAR) {
            era = { key: 'highLevel', cap: 100, eliteMin: 80,
                    eliteMax: 100, eliteShare: ERA_HIGH_LEVEL_SHARE };
        } else {
            era = { key: 'early', cap: 100, eliteMin: 0,
                    eliteMax: 0, eliteShare: 0 };
        }
        // The sandbox always reaches the whole roster: its enemies are stat
        // scaled to the sandbox rival level rather than held back by the year.
        if ($gameSystem && $gameSystem._isSandboxMode) era.cap = Infinity;
        era.year = year;
        return era;
    };

    // Highest spawnable enemy level right now (see getSpawnEra).
    BSE.Helpers.getSpawnLevelCap = function() {
        return BSE.Helpers.getSpawnEra().cap;
    };

    // Current nation id: the country the player is standing in (Variable 86).
    // This is the seed for all per-enemy spawn-frequency rolls.
    BSE.Helpers.getNationId = function() {
        return ($gameVariables && $gameVariables.value(86)) || 0;
    };

    // Deterministic 0..1 hash of a (nation seed, enemy id) pair.
    function nationEnemyHash(nationId, enemyId) {
        let h = (Math.imul(nationId | 0, 73856093) ^ Math.imul(enemyId | 0, 19349663)) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    // Frequency class -> relative spawn weight. Tuned so a nation sees a slice
    // of enemies it never encounters, a rare tier, a normal core, and a few
    // common ones.
    function nationFrequencyWeight(r) {
        if (r < 0.15) return 0;    // absent in this nation
        if (r < 0.45) return 0.25; // rare
        if (r < 0.85) return 1.0;  // normal
        return 3.0;                // common
    }

    // Relative spawn weight for a single enemy in the current nation.
    BSE.Helpers.getNationEnemyWeight = function(enemyId) {
        return nationFrequencyWeight(nationEnemyHash(BSE.Helpers.getNationId(), enemyId));
    };

    // Max enemy level in a troop (0 if none / invalid).
    BSE.Helpers.getTroopMaxLevel = function(troopId) {
        const troop = $dataTroops[troopId];
        if (!troop || !troop.members.length) return 0;
        return Math.max(...troop.members.map(m => {
            const ed = $dataEnemies[m.enemyId];
            return ed ? BSE.Helpers.getEnemyLevel(ed.note) : 0;
        }));
    };

    // Is a troop spawnable under the current level cap?
    BSE.Helpers.troopWithinLevelCap = function(troopId) {
        return BSE.Helpers.getTroopMaxLevel(troopId) <= BSE.Helpers.getSpawnLevelCap();
    };

    // Nation-seeded spawn weight for a troop (its first member is the
    // representative enemy). Returns 0 for troops the current nation never
    // spawns or that exceed the current level cap.
    BSE.Helpers.getTroopSpawnWeight = function(troopId) {
        const troop = $dataTroops[troopId];
        if (!troop || !troop.members.length) return 0;
        // The reinforced-battle scratch slot (section 5b) is not a fauna entry.
        if (troop._bseReinforced) return 0;
        if (!BSE.Helpers.troopWithinLevelCap(troopId)) return 0;
        return BSE.Helpers.getNationEnemyWeight(troop.members[0].enemyId);
    };

    // The nations where an enemy is most likely to be encountered (for the
    // Bestiary). Ranks every country by this enemy's frequency class, drops
    // nations where it is absent, and returns up to `count` {id, name} entries.
    BSE.Helpers.getTopNationsForEnemy = function(enemyId, count) {
        count = count || 3;
        const countries = (window.WorldGen && window.WorldGen.Countries) || [];
        const scored = [];
        for (const c of countries) {
            const r = nationEnemyHash(c.id, enemyId);
            const w = nationFrequencyWeight(r);
            if (w <= 0) continue;
            scored.push({ id: c.id, name: c.country, weight: w, r });
        }
        // higher frequency first; hash as a stable tie-breaker
        scored.sort((a, b) => (b.weight - a.weight) || (b.r - a.r));
        return scored.slice(0, count);
    };

    // ========================================================================
    // 4. MAP BIOME & PROCEDURAL HELPERS
    // ========================================================================

    // The layout variants of a biome are the same habitat as far as the fauna
    // is concerned: "Road cross" and "Road t-left" are a road, "River vertical"
    // is a river, and an island reads as a beach. Enemies are tagged with the
    // base name only, so without this the variants match no troop at all and
    // the map falls back to its own (single-entry) encounter list.
    // Mirrors biomeKey() in ErisDateSystem.js.
    BSE.Helpers.normalizeBiomeName = function(name) {
        if (!name) return name;
        let n = String(name).trim();
        n = n.replace(/\s+(vertical|horizontal|cross|t-(?:up|down|left|right)|corner-(?:up|down)-(?:left|right))$/i, '');
        if (/^Island$/i.test(n)) n = 'Beach';
        return n;
    };

    /**
     * Extract biome from map note or procedural map data
     */
    BSE.Helpers.getMapBiome = function() {
        const norm = BSE.Helpers.normalizeBiomeName;
        if ($gameMap && $gameMap.mapId() === 636) {
            if ($gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.currentBiome) {
                if ($gameSystem._procGenData.displayAsIsland) return "Beach";
                if ($gameSystem._procGenData.displayAsBeach) return "Beach";
                return norm($gameSystem._procGenData.currentBiome);
            }
        }
        if (!$dataMap || !$dataMap.note) return null;
        const biomeMatch = $dataMap.note.match(/<Biome:\s*(.+?)>/i);
        return biomeMatch ? norm(biomeMatch[1].trim()) : null;
    };

    /**
     * Simple seeded random number generator
     */
    BSE.Helpers.createSeededRandom = function(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    };

    /**
     * Get world coordinates from procedural map data
     */
    BSE.Helpers.getWorldCoordinates = function() {
        if ($gameMap && $gameMap.mapId() === 636) {
            if ($gameSystem && $gameSystem._procGenData) {
                return {
                    x: $gameSystem._procGenData.originX || 0,
                    y: $gameSystem._procGenData.originY || 0
                };
            }
        }
        return null;
    };

    /**
     * Check if currently underground
     */
    BSE.Helpers.isUnderground = function() {
        if ($gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.biomeLayerStack) {
            return $gameSystem._procGenData.biomeLayerStack.length > 0;
        }
        return false;
    };

    /**
     * Get all boss troops (containing at least one enemy level 70+)
     */
    BSE.Helpers.getBossTroops = function(targetBiome) {
        const bossTroops = [];
        for (let i = 1; i < $dataTroops.length; i++) {
            const troop = $dataTroops[i];
            if (!troop || !troop.members.length || troop._bseReinforced) continue;
            const hasHighLevel = troop.members.some(member => {
                const enemyData = $dataEnemies[member.enemyId];
                if (!enemyData) return false;
                return BSE.Helpers.getEnemyLevel(enemyData.note) >= 70;
            });
            if (!hasHighLevel) continue;
            if (targetBiome && !BSE.Helpers.troopMatchesBiome(i, targetBiome)) continue;
            if (!BSE.Helpers.troopWithinLevelCap(i)) continue; // respect level cap
            bossTroops.push(i);
        }
        return bossTroops;
    };

    // Deterministically pick one troop id from a list, seeded on the current
    // world tile so the same procedural map always resolves to the same troop.
    BSE.Helpers.pickSeededTroop = function(troopIds) {
        if (!troopIds || troopIds.length === 0) return null;
        const worldCoords = BSE.Helpers.getWorldCoordinates();
        let seed = 12345;
        if (worldCoords) {
            const underground = BSE.Helpers.isUnderground() ? 1 : 0;
            seed = worldCoords.x + worldCoords.y * 1000 + underground * 1000000;
        }
        const seededRandom = BSE.Helpers.createSeededRandom(seed);
        const randomIndex = Math.floor(seededRandom() * troopIds.length);
        return troopIds[randomIndex];
    };

    /**
     * Get a seeded boss troop for the first enemy event
     */
    BSE.Helpers.getSeededBossTroop = function(targetBiome) {
        return BSE.Helpers.pickSeededTroop(BSE.Helpers.getBossTroops(targetBiome));
    };

    // The era's high-level pool: every troop whose level falls inside the era
    // band (80-100 from 2010, 100+ from 2012), as weighted {troopId, weight}
    // entries ready for the same weighted pick the encounter list uses.
    //
    // Neither the party level nor the distance from the Omega Tower is
    // consulted, which is the whole point of these spawns. Troops matching the
    // local biome are preferred so the monsters still belong to the place they
    // turn up in, and the fallback is limited to biome-tagged fauna so bosses
    // and alien species never leak into a roaming spawn. The nation frequency
    // survives as a soft weight with a floor: these are not local fauna, so a
    // nation never suppresses them entirely.
    BSE.Helpers.getEraElitePool = function(targetBiome, era) {
        era = era || BSE.Helpers.getSpawnEra();
        if (!era.eliteMin) return [];
        const biomeMatched = [];
        const anyFauna = [];
        for (let i = 1; i < $dataTroops.length; i++) {
            const troop = $dataTroops[i];
            if (!troop || !troop.members.length || troop._bseReinforced) continue;
            const lvl = BSE.Helpers.getTroopMaxLevel(i);
            if (lvl < era.eliteMin || lvl > era.eliteMax) continue;
            const lead = $dataEnemies[troop.members[0].enemyId];
            if (!lead || !lead.note || !/<Biome:/i.test(lead.note)) continue;
            const entry = {
                troopId: i,
                weight: Math.max(0.25, BSE.Helpers.getNationEnemyWeight(troop.members[0].enemyId)),
                regionId: 0
            };
            if (targetBiome && BSE.Helpers.troopMatchesBiome(i, targetBiome)) {
                biomeMatched.push(entry);
            }
            anyFauna.push(entry);
        }
        return biomeMatched.length > 0 ? biomeMatched : anyFauna;
    };

    // ========================================================================
    // 4b. SPAWN MODE (level selection on top of the nation-weighted pool)
    // ========================================================================
    // Spawn mode (ConfigManager.enemySpawnMode): 0 = Balanced (default),
    // 1 = Realistic.
    //
    //   Balanced  - roaming enemies stay at or below the party's level and a
    //               single much-higher boss (capped at level 100) is placed
    //               once per world map tile.
    //   Realistic - the party level is ignored entirely. The level band comes
    //               from the biome's danger tier and the world-map distance to
    //               the Omega Tower: the further out, the deadlier the fauna.
    //
    // Both modes keep the nation-seeded per-biome distribution: the country the
    // player is in still decides which enemies are absent / rare / common, and
    // the mode only narrows the level range of that weighted pool.
    // ------------------------------------------------------------------
    BSE.Helpers.getSpawnMode = function() {
        return (window.ConfigManager && ConfigManager.enemySpawnMode === 1)
            ? 'realistic' : 'balanced';
    };

    // Median party level (>= 1) used as the balanced-mode reference level.
    BSE.Helpers.getPartyReferenceLevel = function() {
        const party = $gameParty ? $gameParty.members() : [];
        if (!party.length) return 1;
        return Math.max(1, Math.round(BSE.Helpers.getMedianLevel(party)));
    };

    // Balanced mode: from an encounter list, keep only troops at or below the
    // reference level. If none qualify, fall back to the lowest-level troops
    // available so a map is never left without spawnable enemies.
    BSE.Helpers.filterTroopsAtOrBelowLevel = function(encList, maxLevel) {
        if (!encList || !encList.length) return encList;
        const atOrBelow = encList.filter(enc =>
            BSE.Helpers.getTroopMaxLevel(enc.troopId) <= maxLevel);
        if (atOrBelow.length > 0) return atOrBelow;
        // None at/below the cap: keep the ones closest from above (lowest level).
        let minLvl = Infinity;
        encList.forEach(enc => {
            const lvl = BSE.Helpers.getTroopMaxLevel(enc.troopId);
            if (lvl < minLvl) minLvl = lvl;
        });
        return encList.filter(enc => BSE.Helpers.getTroopMaxLevel(enc.troopId) === minLvl);
    };

    // TempleInside structure biome: keep only troops far above the party's
    // median level (at least +10 or 1.5x, capped at 100), in either spawn
    // mode. Relaxes the threshold in steps so a map is never left without
    // spawnable enemies.
    BSE.Helpers.filterTroopsWellAboveLevel = function(encList, refLevel) {
        if (!encList || !encList.length) return encList;
        const HARD_CAP = 100;
        const levels = encList.map(enc => BSE.Helpers.getTroopMaxLevel(enc.troopId));
        const thresholds = [
            Math.min(HARD_CAP, Math.max(refLevel + 10, Math.ceil(refLevel * 1.5))),
            refLevel + 5,
            refLevel + 1
        ];
        for (const t of thresholds) {
            const above = encList.filter((enc, i) => levels[i] >= t && levels[i] <= HARD_CAP);
            if (above.length > 0) return above;
        }
        return encList;
    };

    // Balanced mode: the single boss for a proc map — a troop "much higher"
    // than the party level, capped at level 100. Seeded on the world tile so
    // the boss is stable for a given procedural map.
    BSE.Helpers.getBalancedBossTroop = function(targetBiome, partyLevel) {
        const HARD_CAP = 100; // bosses never exceed level 100 in balanced mode
        // "Much higher" than the party: at least +10 levels or 1.5x, capped.
        const minBoss = Math.min(HARD_CAP,
            Math.max(partyLevel + 10, Math.ceil(partyLevel * 1.5)));

        const collect = (minLvl, requireBiome) => {
            const out = [];
            for (let i = 1; i < $dataTroops.length; i++) {
                const troop = $dataTroops[i];
                if (!troop || !troop.members.length || troop._bseReinforced) continue;
                const lvl = BSE.Helpers.getTroopMaxLevel(i);
                if (lvl < minLvl || lvl > HARD_CAP) continue;
                if (requireBiome && targetBiome &&
                    !BSE.Helpers.troopMatchesBiome(i, targetBiome)) continue;
                out.push(i);
            }
            return out;
        };

        // Prefer biome-matched bosses above the threshold, then relax the biome
        // requirement, then relax the "much higher" threshold to any troop
        // above the party level, before giving up.
        let candidates = collect(minBoss, true);
        if (!candidates.length) candidates = collect(minBoss, false);
        if (!candidates.length) candidates = collect(partyLevel + 1, false);
        return BSE.Helpers.pickSeededTroop(candidates);
    };

    // ------------------------------------------------------------------
    // Realistic mode: biome danger + distance from the Omega Tower
    // ------------------------------------------------------------------
    // The Omega Tower is the safe heart of the world map. Enemy levels scale
    // with the straight-line world-map distance from it, then get pushed up or
    // down by how hostile the local biome is. Party level plays no part.

    const OMEGA_TOWER_FALLBACK = { x: 79, y: 125 }; // world map (315) tile
    const REALISTIC_FULL_RANGE = 200;  // tiles from the tower at which the ceiling is reached
    const REALISTIC_CURVE      = 1.2;  // >1 keeps the tower's neighbourhood gentle

    // Top of the gradient: the highest level any biome-tagged enemy reaches.
    // Read from the database rather than hardcoded so retuning enemy levels
    // retunes the curve with them. Enemies without a <Biome:> tag (bosses,
    // alien species) are excluded, they never enter a biome encounter list.
    let _biomeRosterCeiling = 0;
    function biomeRosterCeiling() {
        if (_biomeRosterCeiling > 0) return _biomeRosterCeiling;
        let max = 0;
        for (let i = 1; i < $dataEnemies.length; i++) {
            const e = $dataEnemies[i];
            if (!e || !e.note || !/<Biome:/i.test(e.note)) continue;
            const lv = BSE.Helpers.getEnemyLevel(e.note);
            if (lv > max) max = lv;
        }
        _biomeRosterCeiling = max > 0 ? max : 100;
        return _biomeRosterCeiling;
    }

    // World map position of the Omega Tower, read from the shared destination
    // table so moving it there moves the difficulty gradient with it.
    BSE.Helpers.getOmegaTowerCoords = function() {
        const dest = window.WorkSystem && window.WorkSystem.Destinations;
        const tower = dest && dest['Omega Tower'];
        const base = tower && tower.base;
        if (base && typeof base.x === 'number' && typeof base.y === 'number') return base;
        return OMEGA_TOWER_FALLBACK;
    };

    // Where the party sits on the world map (map 315 tile coordinates).
    // Procedural maps carry their origin tile; everywhere else falls back to
    // the world coordinates FastTravelSystem keeps in Variables 43 / 44.
    BSE.Helpers.getWorldPosition = function() {
        const procCoords = BSE.Helpers.getWorldCoordinates();
        if (procCoords && (procCoords.x || procCoords.y)) return procCoords;
        if ($gameMap && $gameMap.mapId() === 315) {
            return { x: $gamePlayer.x, y: $gamePlayer.y };
        }
        return {
            x: ($gameVariables && $gameVariables.value(43)) || 0,
            y: ($gameVariables && $gameVariables.value(44)) || 0
        };
    };

    // Straight-line world-map distance (in tiles) from the Omega Tower.
    BSE.Helpers.getOmegaTowerDistance = function() {
        const here = BSE.Helpers.getWorldPosition();
        const tower = BSE.Helpers.getOmegaTowerCoords();
        // An unset world position (0,0) would read as "as far as possible";
        // treat it as standing at the tower instead of as the deadliest corner.
        if (!here || (!here.x && !here.y)) return 0;
        return Math.sqrt(Math.pow(here.x - tower.x, 2) + Math.pow(here.y - tower.y, 2));
    };

    // Biome danger tiers. `mult` scales the distance-derived level, `floor` is
    // the lowest level the biome ever produces (a crypt is never trivial, even
    // in the tower's back yard). Anything unlisted is "wild" (the default).
    const BIOME_DANGER_TIERS = {
        safe:    { mult: 0.45, floor: 1 },
        wild:    { mult: 1.00, floor: 2 },
        hostile: { mult: 1.35, floor: 6 },
        deadly:  { mult: 1.80, floor: 12 }
    };

    const BIOME_TIER_BY_NAME = {};
    const assignTier = (tier, names) => names.forEach(n => {
        BIOME_TIER_BY_NAME[n.toLowerCase()] = tier;
    });
    // Settled, patrolled or paved: the tamest fauna in the world.
    assignTier('safe', [
        'Beach', 'Bridge', 'Burg', 'BurgDesert', 'BurgIce', 'ChurchInside',
        'City', 'CityDesert', 'CityIce', 'Docks', 'Farm', 'Fields', 'Highway',
        'Houses', 'HousesInside', 'Meadows', 'Metro', 'Office', 'Park', 'Road',
        'Train',
        'Villa', 'Village', 'VillageDesert', 'VillageIce', 'VillageMountain',
        'VillageRiver', 'VillageSea',
        'LootCellar', 'PatronVault'
    ]);
    // Wilderness that bites back: rough terrain, ruins, worked-out industry.
    assignTier('hostile', [
        'Abandoned', 'AbandonedInside', 'Arena', 'Badlands', 'Canyon', 'Castle',
        'CastleInside', 'Cave', 'CaveFlooded', 'CaveIce', 'Factory',
        'FactoryInside', 'Graveyard', 'Jungle', 'Laboratory', 'Landfill',
        'Mines', 'Mountain', 'MountainDesert', 'MountainIce', 'Ruins', 'Sewer',
        'Swamp', 'Temple', 'TempleShinto', 'CaveDen'
    ]);
    // Outright lethal: the deep underworld, the otherworlds, the anomalies.
    assignTier('deadly', [
        'Abstract', 'AlienPlanet', 'Crypt', 'Crystals', 'Digital', 'Dreamscape',
        'Dungeon', 'Eldritch', 'Fairy', 'Heaven', 'Hell', 'Lair', 'Limbo',
        'OmegaTower', 'SeaBed', 'Space', 'SpiritWoods', 'Underdark', 'Volcano',
        'TempleInside'
    ]);

    // Danger tier of a biome name. Road / River variants ("Road cross",
    // "River vertical", ...) resolve through their leading token.
    BSE.Helpers.getBiomeDanger = function(biome) {
        if (!biome) return BIOME_DANGER_TIERS.wild;
        const key = String(biome).toLowerCase().trim();
        let tier = BIOME_TIER_BY_NAME[key];
        if (!tier) {
            const head = key.split(/[\s-]/)[0];
            tier = BIOME_TIER_BY_NAME[head];
        }
        return BIOME_DANGER_TIERS[tier] || BIOME_DANGER_TIERS.wild;
    };

    // The level window realistic mode spawns from at the current location.
    BSE.Helpers.getRealisticLevelBand = function(biome) {
        const ceiling = Math.min(BSE.Helpers.getSpawnLevelCap(), biomeRosterCeiling());
        const dist = BSE.Helpers.getOmegaTowerDistance();
        const t = Math.max(0, Math.min(1, dist / REALISTIC_FULL_RANGE));
        const base = 1 + Math.pow(t, REALISTIC_CURVE) * (ceiling - 1);
        const danger = BSE.Helpers.getBiomeDanger(biome);
        const center = Math.max(danger.floor, Math.min(ceiling, base * danger.mult));
        return {
            center: center,
            min: Math.max(1, Math.floor(center * 0.55)),
            max: Math.min(ceiling, Math.ceil(center * 1.35) + 3)
        };
    };

    // Realistic mode: keep only the troops whose level falls inside the band.
    // The band widens if the (nation-weighted, biome-matched) pool has nothing
    // in range, and finally falls back to whatever sits closest to its centre,
    // so a map is never left without spawnable enemies.
    BSE.Helpers.filterTroopsInLevelBand = function(encList, band) {
        if (!encList || !encList.length || !band) return encList;
        const levels = encList.map(enc => BSE.Helpers.getTroopMaxLevel(enc.troopId));
        for (let pass = 0; pass < 3; pass++) {
            const grow = 1 + pass * 0.5;
            const lo = Math.max(1, band.center - (band.center - band.min) * grow);
            const hi = band.max + (band.max - band.center) * pass;
            const inBand = encList.filter((enc, i) => levels[i] >= lo && levels[i] <= hi);
            if (inBand.length > 0) return inBand;
        }
        let bestDist = Infinity;
        levels.forEach(lvl => {
            const d = Math.abs(lvl - band.center);
            if (d < bestDist) bestDist = d;
        });
        return encList.filter((enc, i) => Math.abs(levels[i] - band.center) === bestDist);
    };

    /**
     * Check if a troop has any enemies that match the given biome
     */
    BSE.Helpers.troopMatchesBiome = function(troopId, targetBiome) {
        if (!targetBiome) return false;
        const troop = $dataTroops[troopId];
        if (!troop || !troop.members.length) return false;
        const targetBiomeLower = targetBiome.toLowerCase().trim();
        for (const member of troop.members) {
            const enemyData = $dataEnemies[member.enemyId];
            if (!enemyData || !enemyData.note) continue;
            const biomeMatch = enemyData.note.match(/<Biome:\s*(.+?)>/i);
            if (!biomeMatch) continue;
            const enemyBiomes = biomeMatch[1].split(',').map(b => b.trim().toLowerCase());
            if (enemyBiomes.includes(targetBiomeLower)) return true;
        }
        return false;
    };

    /**
     * Can troop spawn in region
     */
    BSE.Helpers.canTroopSpawnInRegion = function(troopId, regionId, x, y) {
        const troop = $dataTroops[troopId];
        if (!troop || !troop.members.length) return true;
        const firstMember = troop.members[0];
        if (!firstMember) return true;
        const enemyData = $dataEnemies[firstMember.enemyId];
        if (!enemyData) return true;
        const archetype = BSE.Helpers.getEnemyArchetype(enemyData);
        if (!archetype) return true;
        if (BSE.Helpers.getAquaticArchetype(archetype)) return regionId === 99;
        if (x !== undefined && y !== undefined && $gameMap) {
            const regionId2 = $gameMap.regionId(x, y);
            const isWater = regionId2 === 99 ||
                (window.MovementSystem && window.MovementSystem.isWaterTile && window.MovementSystem.isWaterTile(x, y));
            if (isWater && !BSE.Helpers.getAmphibiousArchetype(archetype)) return false;
        }
        return true;
    };

    /**
     * Ensure troops array with weighted distribution
     */
    BSE.Helpers.ensureTroops = function(troops, party, dataEnemies) {
        const pool = $dataTroops
            .slice(1)
            .map((t, i) => ({ troop: t, id: i + 1 }))
            .filter(x => x.troop && x.troop.members.length)
            .map(x => ({ ...x, weight: BSE.Helpers.getTroopSpawnWeight(x.id) }))
            .filter(x => x.weight > 0); // drop nation-absent & over-cap troops
        if (!pool.length) return; // no valid troops: leave troops array untouched
        for (let i = 0; i < 4 && pool.length > 0; i++) {
            const totalWeight = pool.reduce((sum, x) => sum + x.weight, 0);
            let random = Math.random() * totalWeight;
            for (let j = 0; j < pool.length; j++) {
                random -= pool[j].weight;
                if (random <= 0) {
                    troops.push(pool[j].id);
                    pool.splice(j, 1);
                    break;
                }
            }
        }
    };

    // ========================================================================
    // 5. SPAWN ENEMIES FROM ENCOUNTERS (Core overworld hook)
    // ========================================================================

    // The per-event troop / position / defeated caches keep a procedural map
    // stable while the player walks it and while battles come and go. They are
    // keyed by event id only, and every world tile reuses the same map 636
    // event ids, so they have to be dropped whenever the tile (or the
    // underground layer, or the biome) changes. Otherwise the very first
    // procedural map the player ever loads would freeze that tile's fauna in
    // place for the whole world, and neither the biome roster nor the spawn
    // mode's level band would ever be consulted again.
    BSE.Helpers.syncProcGenEnemyCache = function() {
        if ($gameMap.mapId() !== 636) return;
        const wc = BSE.Helpers.getWorldCoordinates() || { x: 0, y: 0 };
        const stack = $gameSystem._procGenData && $gameSystem._procGenData.biomeLayerStack;
        const depth = stack ? stack.length : 0;
        const key = `${wc.x},${wc.y},${depth},${BSE.Helpers.getMapBiome() || ''}`;
        if ($gameSystem._procGenEnemyCacheKey === key) return;
        $gameSystem._procGenEnemyCacheKey = key;
        $gameSystem._procGenEnemyTroops = {};
        $gameSystem._procGenEnemyPositions = {};
        $gameSystem._procGenDefeatedEnemies = [];
    };

    Scene_Map.prototype.spawnEnemiesFromEncounters = function() {
        BSE.Helpers.syncProcGenEnemyCache();

        let encounterList = $gameMap.encounterList();
        if (!encounterList || !encounterList.length) {
            const fallbackIds = [];
            const party = $gameParty.members();
            BSE.Helpers.ensureTroops(fallbackIds, party, $dataEnemies);
            encounterList = fallbackIds.map(id => ({ troopId: id, weight: 1 }));
        }

        const allEnemyEvents = $gameMap.events().filter(ev => {
            const eventData = ev.event();
            return eventData && eventData.name === "Enemy";
        });

        let enemyEvents = allEnemyEvents;
        if ($gameMap.mapId() === 636) {
            if ($gameSystem._procGenDefeatedEnemies) {
                enemyEvents = allEnemyEvents.filter(ev =>
                    !$gameSystem._procGenDefeatedEnemies.includes(ev.eventId())
                );
                const defeatedEvents = allEnemyEvents.filter(ev =>
                    $gameSystem._procGenDefeatedEnemies.includes(ev.eventId())
                );
                defeatedEvents.forEach(ev => ev.erase());
            }
        }

        if (!enemyEvents.length) return;

        // Urban / Road Biome Population Cap
        // Settled and travel biomes (City, Village, Burg, Road) keep only a
        // couple of roaming enemies. The proc map template carries many "Enemy"
        // events; placing all of them in these tight, event-dense maps crowds
        // tiles and makes colliding into an enemy fail to start a battle. Cull
        // to 2 so the few that remain stay cleanly interactable.
        // Per-biome enemy population caps. The proc map template carries many
        // "Enemy" events; some biomes should stay sparsely populated:
        //   - Urban / Road (tight, event-dense): 2
        //   - Cave (exploration, rare loot):      3
        //   - Dungeon / Crypt / Sewer:            4
        //   - LootCellar: at most 1 lurking guard; TempleInside: 4 guardians;
        //     CaveDen: packed with its resident species (8).
        const currentBiome = BSE.Helpers.getMapBiome();
        const lowerBiomeName = (currentBiome || '').toLowerCase();
        // Structure biomes (entered through terrain features) have no enemies
        // tagged with their own biome name, so they borrow a fitting roster.
        const STRUCTURE_ENEMY_BIOME = { lootcellar: 'Sewer', templeinside: 'Crypt', caveden: 'Cave', patronvault: 'Sewer' };
        const isLootCellar = lowerBiomeName === 'lootcellar';
        // A patron's vault is a hoard, not a dungeon: two keepers, no boss.
        const isPatronVault = lowerBiomeName === 'patronvault';
        const isTempleVault = lowerBiomeName === 'templeinside';
        const isCaveDen = lowerBiomeName === 'caveden';
        const encounterBiome = STRUCTURE_ENEMY_BIOME[lowerBiomeName] || currentBiome;
        if (currentBiome) {
            const lowerBiome = lowerBiomeName;
            let enemyCap = -1;
            if (isLootCellar) {
                // A cellar CAN hold a single lurking guard - seeded coin flip
                // per world tile + cellar layout, so a given cellar is always
                // either guarded or safe.
                const wc = BSE.Helpers.getWorldCoordinates() || { x: 0, y: 0 };
                const genData = $gameSystem._procGenData && $gameSystem._procGenData.generatedMapData;
                const sx = (genData && genData.spawnX) || 0;
                const sy = (genData && genData.spawnY) || 0;
                const srng = BSE.Helpers.createSeededRandom(wc.x * 7349 + wc.y * 131 + sx * 97 + sy + 17);
                enemyCap = srng() < 0.55 ? 1 : 0;
            } else if (isPatronVault) {
                enemyCap = 2;
            } else if (isCaveDen) {
                enemyCap = 8;
            } else if (isTempleVault) {
                enemyCap = 4;
            } else if (lowerBiome.includes('city') || lowerBiome.includes('burg') ||
                lowerBiome.includes('village') || lowerBiome.includes('road')) {
                enemyCap = 2;
            } else if (lowerBiome.includes('cave')) {
                enemyCap = 3;
            } else if (lowerBiome.startsWith('dungeon') || lowerBiome.startsWith('crypt') ||
                lowerBiome.startsWith('sewer')) {
                enemyCap = 4;
            }
            if (enemyCap >= 0 && enemyEvents.length > enemyCap) {
                const excessEvents = enemyEvents.splice(enemyCap);
                excessEvents.forEach(ev => ev.erase());
            }
        }

        // If map has only 1 encounter and has enemy events, generate random encounter list
        if (encounterList.length === 1 && enemyEvents.length > 0) {
            const party = $gameParty.members();
            if (party.length > 0) {
                // Structure biomes match troops against their borrowed roster
                // (LootCellar -> Sewer, TempleInside -> Crypt, CaveDen -> Cave).
                const mapBiome = encounterBiome;
                const biomeTroops = [];
                const nonBiomeTroops = [];
                for (let i = 1; i < $dataTroops.length; i++) {
                    const troop = $dataTroops[i];
                    if (!BSE.Helpers.isSpawnableTroopData(troop)) continue;
                    if (mapBiome && BSE.Helpers.troopMatchesBiome(i, mapBiome)) {
                        biomeTroops.push(i);
                    } else {
                        nonBiomeTroops.push(i);
                    }
                }

                // Build the encounter list from the candidate troops, weighting
                // each by the current nation's per-enemy frequency and dropping
                // troops the nation never spawns or that exceed the level cap.
                const buildFromTroops = candidateIds => {
                    const list = [];
                    candidateIds.forEach(id => {
                        const weight = BSE.Helpers.getTroopSpawnWeight(id);
                        if (weight > 0) list.push({ troopId: id, weight, regionId: 0 });
                    });
                    return list;
                };

                if (mapBiome && biomeTroops.length > 0) {
                    const list = buildFromTroops(biomeTroops);
                    if (list.length > 0) encounterList = list;
                } else if (!mapBiome && nonBiomeTroops.length > 0) {
                    const list = buildFromTroops(nonBiomeTroops);
                    if (list.length > 0) encounterList = list;
                }
            }
        }

        // Apply time-based filtering
        encounterList = BSE.Helpers.filterEncountersByTime(encounterList);

        // Critical event locations (transfer/door events to exclude spawns near)
        const criticalEventLocations = $gameMap.events()
            .filter(ev => {
                const eventData = ev.event();
                return eventData && (eventData.name === "Transfer" || eventData.name === "Door");
            })
            .map(ev => ({ x: ev.x, y: ev.y }));
        const exclusionRadius = 3;

        const spawnTiles = [];
        const w = $gameMap.width(), h = $gameMap.height();

        // Region 109 anchors - if present, restrict spawns to within radius of them
        const region109Tiles = [];
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                if ($gameMap.regionId(x, y) === 109) region109Tiles.push({ x, y });
            }
        }
        const region109Radius = 5;

        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                if ($gameMap.regionId(x, y) === 10 || $gameMap.regionId(x, y) === 103) continue;
                if (region109Tiles.length > 0) {
                    const nearRegion109 = region109Tiles.some(loc =>
                        Math.sqrt(Math.pow(x - loc.x, 2) + Math.pow(y - loc.y, 2)) <= region109Radius
                    );
                    if (!nearRegion109) continue;
                }
                let tooClose = false;
                for (const loc of criticalEventLocations) {
                    const distance = Math.sqrt(Math.pow(x - loc.x, 2) + Math.pow(y - loc.y, 2));
                    if (distance <= exclusionRadius) { tooClose = true; break; }
                }
                if (tooClose) continue;
                const terrainTag = $gameMap.terrainTag(x, y);
                const regionId = $gameMap.regionId(x, y);
                const isWaterTile = regionId === 99;
                if (!isWaterTile && !$gameMap.isPassable(x, y, 2)) continue;
                if (terrainTag === 0 || terrainTag === 4 || terrainTag === 7) continue;
                if ($gameMap.events().some(ev => ev.x === x && ev.y === y && !enemyEvents.includes(ev))) continue;
                spawnTiles.push({ x, y, regionId });
            }
        }

        // Road biomes: spawn off the carriageway, since enemies refuse to walk
        // onto road / dashed-line tiles and would be stranded there. Falls back
        // to the unfiltered list if the road leaves no roadside tile at all.
        const offRoadTiles = spawnTiles.filter(t => !BSE.Helpers.isRoadFeatureTile(t.x, t.y));
        if (offRoadTiles.length > 0 && offRoadTiles.length < spawnTiles.length) {
            spawnTiles.length = 0;
            spawnTiles.push(...offRoadTiles);
        }

        const selectWeightedRandom = list => {
            const total = list.reduce((sum, it) => sum + it.weight, 0);
            let rnd = Math.random() * total;
            for (const it of list) {
                rnd -= it.weight;
                if (rnd <= 0) return it;
            }
            return list[0];
        };

        let isFirstEnemyEvent = true;
        // CaveDen: the whole den is inhabited by ONE species, resolved once
        // (seeded on the world tile) and reused for every enemy event.
        let denTroopId = null;

        // Enemy spawn mode (see BSE.Helpers.getSpawnMode). Balanced holds
        // roaming enemies at or below the party's level and places a single
        // much-higher boss (capped at 100) as the first enemy event of the
        // world tile. Realistic ignores the party and draws from a level band
        // set by the biome's danger tier and the distance to the Omega Tower.
        const spawnMode = BSE.Helpers.getSpawnMode();
        const partyRefLevel = BSE.Helpers.getPartyReferenceLevel();
        const realisticBand = spawnMode === 'realistic'
            ? BSE.Helpers.getRealisticLevelBand(currentBiome)
            : null;

        // The era's high-level fauna (level 80-100 from 2010, 100+ from 2012)
        // rides on top of whichever mode is selected: a share of the roaming
        // enemies is drawn from this pool instead of from the mode's own level
        // logic, so both modes end up mixing them in with normal spawns.
        const spawnEra = BSE.Helpers.getSpawnEra();
        const eraElitePool = spawnEra.eliteShare > 0
            ? BSE.Helpers.getEraElitePool(encounterBiome, spawnEra)
            : [];

        for (const ev of enemyEvents) {
            if (spawnTiles.length) {
                const isProcGenMap = $gameMap.mapId() === 636;
                let loc;
                let idx = -1;
                if (isProcGenMap) {
                    if (!$gameSystem._procGenEnemyPositions) $gameSystem._procGenEnemyPositions = {};
                    const savedPos = $gameSystem._procGenEnemyPositions[ev.eventId()];
                    if (savedPos) idx = spawnTiles.findIndex(tile => tile.x === savedPos.x && tile.y === savedPos.y);
                }
                if (idx !== -1) {
                    loc = spawnTiles.splice(idx, 1)[0];
                } else {
                    // The boss (first enemy event, Balanced mode) is biased into
                    // the room farthest from the dungeon entrance when the
                    // current layout provides one (Dungeon/Crypt/Sewer BSP/room
                    // layouts); every other roaming enemy stays purely random.
                    let pickIdx = Math.floor(Math.random() * spawnTiles.length);
                    if (isProcGenMap && spawnMode === 'balanced' && isFirstEnemyEvent) {
                        const genData = $gameSystem._procGenData && $gameSystem._procGenData.generatedMapData;
                        const hint = genData && genData.bossRoomHint;
                        if (hint) {
                            let bestDist = Infinity;
                            spawnTiles.forEach((t, ti) => {
                                const d = Math.abs(t.x - hint.x) + Math.abs(t.y - hint.y);
                                if (d < bestDist) { bestDist = d; pickIdx = ti; }
                            });
                        }
                    }
                    loc = spawnTiles.splice(pickIdx, 1)[0];
                    if (isProcGenMap) {
                        if (!$gameSystem._procGenEnemyPositions) $gameSystem._procGenEnemyPositions = {};
                        $gameSystem._procGenEnemyPositions[ev.eventId()] = { x: loc.x, y: loc.y };
                    }
                }

                ev.locate(loc.x, loc.y);
                const currentRegion = loc.regionId;
                let validTroops = encounterList.filter(enc =>
                    BSE.Helpers.canTroopSpawnInRegion(enc.troopId, currentRegion, loc.x, loc.y)
                );

                let chosenTroopId = null;
                if (isProcGenMap) {
                    if (!$gameSystem._procGenEnemyTroops) $gameSystem._procGenEnemyTroops = {};
                    const savedTroopId = $gameSystem._procGenEnemyTroops[ev.eventId()];
                    if (savedTroopId && $dataTroops[savedTroopId]) chosenTroopId = savedTroopId;
                }

                if (chosenTroopId === null) {
                    if (spawnMode === 'balanced' && isProcGenMap &&
                        isFirstEnemyEvent && currentRegion !== 99 &&
                        !isLootCellar && !isCaveDen && !isPatronVault) {
                        // Balanced mode only: the single high-level encounter of
                        // this world map tile, much higher than the party and
                        // capped at 100. Realistic mode has no such exception,
                        // every enemy comes out of the location's level band.
                        // LootCellar (single median-level guard) and CaveDen
                        // (uniform resident species) never get a boss.
                        const bossTroopId = BSE.Helpers.getBalancedBossTroop(encounterBiome, partyRefLevel);
                        if (bossTroopId !== null) chosenTroopId = bossTroopId;
                    }

                    // Era high-level spawn: from 2010 a quarter of the roaming
                    // enemies (and from 2012 two fifths of them) come out of the
                    // era band regardless of the spawn mode, the party level and
                    // the distance from the Omega Tower. CaveDen is exempt, its
                    // whole population is one resident species by design.
                    if (chosenTroopId === null && eraElitePool.length > 0 &&
                        !isCaveDen && Math.random() < spawnEra.eliteShare) {
                        const eliteHere = eraElitePool.filter(enc =>
                            BSE.Helpers.canTroopSpawnInRegion(enc.troopId, currentRegion, loc.x, loc.y)
                        );
                        if (eliteHere.length > 0) {
                            chosenTroopId = selectWeightedRandom(eliteHere).troopId;
                        }
                    }

                    if (chosenTroopId === null) {
                        if (validTroops.length === 0) {
                            if (currentRegion === 99) { ev.erase(); continue; }
                            else validTroops = encounterList;
                        }
                        // Narrow the (already nation-weighted) candidates to the
                        // mode's level range: at or below the party in Balanced,
                        // inside the biome/Omega-distance band in Realistic.
                        // TempleInside overrides both modes: its guardians are
                        // always far above the party's median level.
                        let pickList = validTroops;
                        if (pickList.length > 0) {
                            if (isTempleVault) {
                                pickList = BSE.Helpers.filterTroopsWellAboveLevel(pickList, partyRefLevel);
                            } else {
                                pickList = spawnMode === 'balanced'
                                    ? BSE.Helpers.filterTroopsAtOrBelowLevel(pickList, partyRefLevel)
                                    : BSE.Helpers.filterTroopsInLevelBand(pickList, realisticBand);
                            }
                        }
                        if (pickList.length > 0) {
                            if (isCaveDen) {
                                // One species per den: seeded pick, then reused
                                // for every other enemy event on this map.
                                if (denTroopId === null ||
                                    !pickList.some(enc => enc.troopId === denTroopId)) {
                                    denTroopId = BSE.Helpers.pickSeededTroop(pickList.map(enc => enc.troopId));
                                }
                                chosenTroopId = denTroopId;
                            } else {
                                // The encounter list is already weighted by the current
                                // nation's per-enemy frequency, so a straight weighted
                                // pick spawns from the (mode-filtered) candidates.
                                chosenTroopId = selectWeightedRandom(pickList).troopId;
                            }
                        }
                    }

                    if (isProcGenMap && chosenTroopId !== null) {
                        if (!$gameSystem._procGenEnemyTroops) $gameSystem._procGenEnemyTroops = {};
                        $gameSystem._procGenEnemyTroops[ev.eventId()] = chosenTroopId;
                    }
                }
                isFirstEnemyEvent = false;

                if (chosenTroopId !== null) {
                    ev._fixedTroopId = chosenTroopId;
                    ev._isAquaticEnemy = undefined;
                    ev._isAmphibiousEnemy = undefined;
                    const troop = $dataTroops[chosenTroopId];
                    if (troop && troop.members.length > 0) {
                        const firstEnemy = $dataEnemies[troop.members[0].enemyId];
                        if (firstEnemy && firstEnemy.note) {
                            const note = firstEnemy.note;
                            const speedMatch = note.match(/<Speed:\s*([1-6])>/i);
                            if (speedMatch) ev.setMoveSpeed(Number(speedMatch[1]));
                            const moveMatch = note.match(/<Movement:\s*(Approach|Random|Fixed|Fleeing)>/i);
                            if (moveMatch) {
                                const type = moveMatch[1].toLowerCase();
                                // Peaceful mode: roaming enemies never chase the player.
                                // An "approach" (follow) note is downgraded to random wandering.
                                const peaceful = $gameSystem && $gameSystem._peacefulMode;
                                if (type === 'fixed') ev._moveType = 0;
                                else if (type === 'random') ev._moveType = 1;
                                else if (type === 'approach') ev._moveType = peaceful ? 1 : 2;
                            }
                        }
                    }
                    ev.updateCharacterSprite();
                    ev.setOpacity(255);
                    ev.setThrough(false);
                } else {
                    ev.erase();
                }
            } else {
                ev.erase();
            }
        }
    };

    // ========================================================================
    // 5b. REINFORCEMENTS - the monsters standing nearby pile into the fight
    // ========================================================================
    // A fight on the overworld is not fought in a bubble: every other roaming
    // monster within JOIN_RANGE tiles of the party joins the troop the battle
    // is set up with, up to JOIN_MAX of them, nearest first. Their map events
    // are held in BSE.State.joinedEnemyEvents for the whole battle so the state
    // module can delete them on a win and hand their HP back on a flee.
    //
    // This applies to Scene_Battle fights only. A tactical map battle
    // (MapBattleMode.js) already fights on the live map with everyone standing
    // where they stand, and startPersistentBattle redirects to it before ever
    // reaching this code.

    BSE.Data.JOIN_RANGE = 8;  // tiles; a monster closer than this joins in
    BSE.Data.JOIN_MAX   = 2;  // at most this many extra troops per battle
    BSE.Data.BATTLE_MAX_MEMBERS = 3; // hard cap: base + joiners combined

    // The scratch $dataTroops slot the combined troop is written into. One slot
    // is reserved per session and rewritten for every reinforced battle rather
    // than growing the database a troop at a time. $dataTroops is rebuilt from
    // disk on every load, so the marker doubles as a "is my slot still mine".
    let _reinforcedSlot = 0;
    function reinforcedTroopSlot() {
        const held = $dataTroops[_reinforcedSlot];
        if (_reinforcedSlot > 0 && held && held._bseReinforced) return _reinforcedSlot;
        _reinforcedSlot = $dataTroops.length;
        $dataTroops.push({
            id: _reinforcedSlot, name: '', members: [], pages: [], _bseReinforced: true
        });
        return _reinforcedSlot;
    }

    // The scratch slot is a battle fixture, never a spawnable troop: it must be
    // skipped by every candidate scan that walks $dataTroops.
    BSE.Helpers.isSpawnableTroopData = function(troop) {
        return !!(troop && troop.members && troop.members.length && !troop._bseReinforced);
    };

    // The enemy events that join a battle started against `triggerEventId`.
    // Only same-troop-type enemies within JOIN_RANGE tiles join. Joiners are
    // capped so the total troop-member count (base + all joiners) never
    // exceeds BATTLE_MAX_MEMBERS. Nearest first.
    BSE.Functions.getJoiningEnemyEvents = function(triggerEventId) {
        if (!$gameMap || !$gamePlayer) return [];
        const range = BSE.Data.JOIN_RANGE;
        const maxMembers = BSE.Data.BATTLE_MAX_MEMBERS || 3;

        // Get the base troop so we can match type and count its members.
        const triggerEvent = $gameMap.event(triggerEventId);
        const baseTroopId  = triggerEvent ? triggerEvent._fixedTroopId : 0;
        const baseTroop    = baseTroopId ? $dataTroops[baseTroopId] : null;
        if (!baseTroop || !baseTroop.members.length) return [];

        // The lead enemy species of the triggering troop — only events whose
        // first enemy matches join (same-enemy-type grouping).
        const baseTroopFirstEnemyId = baseTroop.members[0].enemyId;

        let usedSlots = baseTroop.members.length; // slots already occupied by base
        const near = [];
        for (const ev of $gameMap.events()) {
            if (!ev || ev.eventId() === triggerEventId) continue;
            if (!isLiveEnemyEvent(ev)) continue;
            const troop = $dataTroops[ev._fixedTroopId];
            if (!troop || !troop.members.length) continue;
            // Only same-type troops join (matching lead enemy id).
            if (troop.members[0].enemyId !== baseTroopFirstEnemyId) continue;
            const dx = ev.x - $gamePlayer.x, dy = ev.y - $gamePlayer.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= range) continue;
            near.push({ event: ev, dist: dist, memberCount: troop.members.length });
        }
        near.sort((a, b) => a.dist - b.dist);

        // Pick nearest joiners until the battle cap is reached.
        const joiners = [];
        for (const n of near) {
            if (joiners.length >= BSE.Data.JOIN_MAX) break;
            if (usedSlots + n.memberCount > maxMembers) break;
            joiners.push(n.event);
            usedSlots += n.memberCount;
        }
        return joiners;
    };

    // Evenly spread ALL members of a combined troop (base + joiners) across the
    // 2D battle field so they never overlap. `totalMembers` is the final count,
    // `slot` is this member's index (0-based). Each slot gets a fixed horizontal
    // pitch centred on the screen.
    function joinerPosition(baseMembers, slot, totalMembers) {
        const w  = Graphics.boxWidth  || 816;
        const h  = Graphics.boxHeight || 624;
        const cy = h * 0.50;
        const n  = totalMembers || (baseMembers.length + 1);
        // Distribute across 80 % of the screen width, centred.
        const usable = w * 0.80;
        const pitch  = n > 1 ? usable / (n - 1) : 0;
        const startX = (w - usable) / 2;
        const x = n > 1 ? startX + slot * pitch : w / 2;
        // Stagger depth slightly on alternating slots.
        const y = cy + (slot % 2 === 0 ? -28 : 28);
        return {
            x: Math.max(64, Math.min(w - 64, Math.round(x))),
            y: Math.max(120, Math.min(h - 80, Math.round(y)))
        };
    }

    // Build the troop the battle actually runs on: the triggering troop plus
    // every joining event's troop, and the bookkeeping the state module needs
    // to put each joiner's map event back the way the battle left it.
    // Returns { troopId, joined: [{ eventId, mapId, persistentId, memberIndexes }] }.
    BSE.Functions.buildReinforcedTroop = function(baseTroopId, joinEvents, mapId) {
        const base = $dataTroops[baseTroopId];
        if (!base || !joinEvents || !joinEvents.length) {
            return { troopId: baseTroopId, joined: [] };
        }

        // Count total members so joinerPosition can spread everyone evenly.
        let totalMembers = base.members.length;
        for (const ev of joinEvents) {
            const t = $dataTroops[ev._fixedTroopId];
            if (t) totalMembers += t.members.filter(m => $dataEnemies[m.enemyId]).length;
        }

        // Assign evenly-spread 2D positions across ALL members (base included).
        const members = base.members.map((m, i) => {
            const pos = joinerPosition(base.members, i, totalMembers);
            return Object.assign({}, m, { x: pos.x, y: pos.y });
        });
        // Species keys ride along per member: a reinforced troop can mix two
        // procedural alien species, which one key on the troop cannot express.
        const speciesKeys = members.map(() => base._alienSpeciesKey || null);
        const joined = [];
        let slot = base.members.length; // joiner slots start after base members

        for (const ev of joinEvents) {
            const troop = $dataTroops[ev._fixedTroopId];
            if (!troop || !troop.members.length) continue;
            const memberIndexes = [];
            for (const m of troop.members) {
                if (!$dataEnemies[m.enemyId]) continue;
                const pos = joinerPosition(base.members, slot++, totalMembers);
                memberIndexes.push(members.length);
                members.push({ enemyId: m.enemyId, x: pos.x, y: pos.y, hidden: false });
                speciesKeys.push(troop._alienSpeciesKey || null);
            }
            if (!memberIndexes.length) continue;
            joined.push({
                eventId: ev.eventId(),
                mapId: mapId,
                persistentId: `${mapId}_${ev.eventId()}`,
                memberIndexes: memberIndexes
            });
        }
        if (!joined.length) return { troopId: baseTroopId, joined: [] };

        const slotId = reinforcedTroopSlot();
        const scratch = $dataTroops[slotId];
        scratch.name = base.name;
        scratch.members = members;
        // The battle event pages belong to the troop that started the fight; a
        // page addressing "enemy #2" would otherwise land on a newcomer.
        scratch.pages = base.pages;
        scratch._alienSpeciesKeys = speciesKeys.some(k => k) ? speciesKeys : null;
        return { troopId: slotId, joined: joined };
    };

    // ========================================================================
    // 6. Game_Event - Movement & Setup Overrides
    // ========================================================================

    Game_Event.prototype.setupFleeingMovement = function() {
        const route = {
            list: [
                { code: 32 },
                { code: 0 }
            ],
            repeat: true,
            skippable: true,
            wait: false
        };
        this.forceMoveRoute(route);
        this._fleeingMovement = true;
    };

    Game_Event.prototype.isFleeingMovement = function() {
        return this._fleeingMovement || false;
    };

    const _Game_Event_initialize = Game_Event.prototype.initialize;
    Game_Event.prototype.initialize = function(mapId, eventId) {
        _Game_Event_initialize.call(this, mapId, eventId);
        this.selectFixedTroopIdFromNote();
        this._movementLocked = false;
        this._movementLockTimer = 0;
        this._fleeingMovement = false;
        this._isAquaticEnemy = false;
        this.updateCharacterSprite();
    };

    Game_Event.prototype.getMaxHpForEvent = function() {
        if (!this._fixedTroopId) return 100;
        const troop = $dataTroops[this._fixedTroopId];
        if (!troop || !troop.members.length) return 100;
        const enemy = $dataEnemies[troop.members[0].enemyId];
        return enemy ? enemy.params[0] : 100;
    };

    Game_Event.prototype.selectFixedTroopIdFromNote = function() {
        if (this.event().name === "Enemy") {
            this._fixedTroopId = 0;
            return;
        }
        const note = this.event().note || "";
        if (note.includes('?')) {
            const validTroopIds = $dataTroops.slice(1)
                .map((t, i) => t ? i + 1 : 0)
                .filter(id => id > 0 && $dataTroops[id].members.length > 0);
            if (validTroopIds.length > 0) {
                this._fixedTroopId = validTroopIds[Math.floor(Math.random() * validTroopIds.length)];
            }
        } else {
            const troopIds = note.split(',').map(id => parseInt(id.trim())).filter(id => id > 0);
            if (troopIds.length > 0) {
                this._fixedTroopId = troopIds[Math.floor(Math.random() * troopIds.length)];
            } else {
                this._fixedTroopId = 0;
            }
        }
        if (this._fixedTroopId > 0) {
            // _fixedTroopId is a troop id; the <Movement:...> tag lives on the
            // troop's first enemy member, not on an enemy with that same id.
            const troop = $dataTroops[this._fixedTroopId];
            const enemyData = (troop && troop.members.length > 0)
                ? $dataEnemies[troop.members[0].enemyId]
                : null;
            if (enemyData && enemyData.note) {
                const moveMatch = enemyData.note.match(/<Movement:\s*(Approach|Random|Fixed|Fleeing)>/i);
                if (moveMatch) {
                    const type = moveMatch[1].toLowerCase();
                    // Peaceful mode: an "approach" (follow) note becomes random wandering
                    // so roaming enemies never chase the player.
                    const peaceful = $gameSystem && $gameSystem._peacefulMode;
                    if (type === 'fixed') this._moveType = 0;
                    else if (type === 'random') this._moveType = 1;
                    else if (type === 'approach') this._moveType = peaceful ? 1 : 2;
                }
            }
            const persistentId = `${this._mapId}_${this._eventId}`;
            if (!BSE.State.persistentEnemyData[persistentId]) {
                BSE.State.persistentEnemyData[persistentId] = {
                    troopId: this._fixedTroopId,
                    enemyHp: {}
                };
            }
        }
    };

    // ========================================================================
    // 7. Game_Event - Archetype checks
    // ========================================================================

    Game_Event.prototype.isAquaticEnemy = function() {
        if (this._isAquaticEnemy !== undefined && this._isAquaticEnemy !== false) return this._isAquaticEnemy === true;
        if (!this._fixedTroopId || this._fixedTroopId <= 0) { this._isAquaticEnemy = false; return false; }
        const troop = $dataTroops[this._fixedTroopId];
        if (!troop || !troop.members.length) { this._isAquaticEnemy = false; return false; }
        const enemyData = $dataEnemies[troop.members[0].enemyId];
        if (!enemyData) { this._isAquaticEnemy = false; return false; }
        const archetype = BSE.Helpers.getEnemyArchetype(enemyData);
        this._isAquaticEnemy = BSE.Helpers.getAquaticArchetype(archetype);
        return this._isAquaticEnemy;
    };

    Game_Event.prototype.isAmphibiousEnemy = function() {
        if (this._isAmphibiousEnemy !== undefined && this._isAmphibiousEnemy !== false) return this._isAmphibiousEnemy === true;
        if (!this._fixedTroopId || this._fixedTroopId <= 0) { this._isAmphibiousEnemy = false; return false; }
        const troop = $dataTroops[this._fixedTroopId];
        if (!troop || !troop.members.length) { this._isAmphibiousEnemy = false; return false; }
        const enemyData = $dataEnemies[troop.members[0].enemyId];
        if (!enemyData) { this._isAmphibiousEnemy = false; return false; }
        const archetype = BSE.Helpers.getEnemyArchetype(enemyData);
        this._isAmphibiousEnemy = BSE.Helpers.getAmphibiousArchetype(archetype);
        return this._isAmphibiousEnemy;
    };

    // ========================================================================
    // 8. Game_Event - canPass override
    // ========================================================================

    const _Game_Event_canPass = Game_Event.prototype.canPass;
    Game_Event.prototype.canPass = function(x, y, d) {
        if (this.event().name === "Enemy" && this._fixedTroopId && this._fixedTroopId > 0) {
            // Road biomes: never step onto the carriageway or its dashed center
            // lines. An enemy that somehow starts on a road tile is still free to
            // move (otherwise it would be frozen there for good).
            if (!BSE.Helpers.isRoadFeatureTile(x, y)) {
                const rx = $gameMap.roundXWithDirection(x, d);
                const ry = $gameMap.roundYWithDirection(y, d);
                if (BSE.Helpers.isRoadFeatureTile(rx, ry)) return false;
            }
            const troop = $dataTroops[this._fixedTroopId];
            if (troop && troop.members.length > 0) {
                const firstMember = troop.members[0];
                const enemyData = $dataEnemies[firstMember.enemyId];
                if (enemyData) {
                    const archetype = BSE.Helpers.getEnemyArchetype(enemyData);
                    const destRegionId = $gameMap.regionId(x, y);

                    // Flying enemies ignore all terrain restrictions
                    if (BSE.Helpers.getFlyingArchetype(archetype)) {
                        return !$gameMap.events().some(ev => ev !== this && ev.x === x && ev.y === y && !ev.isThrough());
                    }

                    const isAquatic = BSE.Helpers.getAquaticArchetype(archetype);
                    const isAmphibious = BSE.Helpers.getAmphibiousArchetype(archetype);

                    if (isAquatic) {
                        const srcIsWater = $gameMap.regionId(x, y) === 99;
                        if (!srcIsWater) return false;
                        const x2 = $gameMap.roundXWithDirection(x, d);
                        const y2 = $gameMap.roundYWithDirection(y, d);
                        if (!$gameMap.isValid(x2, y2)) return false;
                        const destIsWater = $gameMap.regionId(x2, y2) === 99;
                        if (!destIsWater) return false;
                        return !$gameMap.events().some(ev => ev !== this && ev.x === x2 && ev.y === y2 && !ev.isThrough());
                    }

                    const srcIsWater = BSE.Helpers.isAquaticTile(x, y);
                    if (srcIsWater) {
                        if (!isAmphibious) return false;
                        const x2 = $gameMap.roundXWithDirection(x, d);
                        const y2 = $gameMap.roundYWithDirection(y, d);
                        if (!$gameMap.isValid(x2, y2)) return false;
                        return !$gameMap.events().some(ev => ev !== this && ev.x === x2 && ev.y === y2 && !ev.isThrough());
                    }

                    if (destRegionId === 7) return false;
                    const hasClimbTag = BSE.Helpers.enemyHasClimb(enemyData);
                    if (!hasClimbTag && destRegionId === 4) return false;
                }
            }
        }
        window._currentlyCheckingCharacter = this;
        const result = _Game_Event_canPass.call(this, x, y, d);
        window._currentlyCheckingCharacter = null;
        return result;
    };

    // ========================================================================
    // 9. Game_Event - realMoveSpeed override
    // ========================================================================

    const _Game_Event_realMoveSpeed = Game_Event.prototype.realMoveSpeed;
    Game_Event.prototype.realMoveSpeed = function() {
        let speed = _Game_Event_realMoveSpeed.call(this);
        if (this.event() && this.event().name === "Enemy" && this._fixedTroopId && this._fixedTroopId > 0) {
            const troop = $dataTroops[this._fixedTroopId];
            if (troop && troop.members.length > 0) {
                const enemyData = $dataEnemies[troop.members[0].enemyId];
                if (enemyData) {
                    const archetype = BSE.Helpers.getEnemyArchetype(enemyData);
                    const currentIsWater = BSE.Helpers.isAquaticTile(this.x, this.y);
                    const regionId = $gameMap.regionId(this.x, this.y);
                    if (BSE.Helpers.getFlyingArchetype(archetype)) return speed;
                    if (BSE.Helpers.getAquaticArchetype(archetype)) return speed;
                    if (BSE.Helpers.getAmphibiousArchetype(archetype)) {
                        return currentIsWater ? speed * 1.5 : speed * 0.67;
                    }
                    const hasClimbTag = BSE.Helpers.enemyHasClimb(enemyData);
                    if (hasClimbTag && regionId === 4) return speed * 0.33;
                    if (currentIsWater) return speed * 0.5;
                }
            }
        }
        return speed;
    };

    // ========================================================================
    // 10. Game_Event - updateCharacterSprite
    // ========================================================================

    Game_Event.prototype.updateCharacterSprite = function() {
        if (this._fixedTroopId && this._fixedTroopId > 0) {
            const troop = $dataTroops[this._fixedTroopId];
            if (!troop) return;
            const member = troop.members[0];
            const enemyId = member ? member.enemyId : null;
            if (!enemyId) return;
            const spriteData = BSE.Data._enemyCharSprites;
            if (spriteData[enemyId]) {
                this.setImage("Monsters/" + spriteData[enemyId], this._characterIndex);
                const hue = ($dataEnemies[enemyId] && $dataEnemies[enemyId].battlerHue) || 0;
                this._characterHue = hue;
            }
        }
    };

    // ========================================================================
    // 11. Game_Player - checkEventTriggerTouch (vehicle hit)
    // ========================================================================

    const _Game_Player_checkTriggerTouch = Game_Player.prototype.checkEventTriggerTouch;
    Game_Player.prototype.checkEventTriggerTouch = function(x, y) {
        if (this.isInVehicle()) {
            const events = $gameMap.eventsXy(x, y);
            for (const event of events) {
                if (event._fixedTroopId > 0 && !event._erased) {
                    if (!event.isJumping()) { event.performVehicleHit(); return true; }
                }
            }
        }
        return _Game_Player_checkTriggerTouch.call(this, x, y);
    };

    Game_Event.prototype.performVehicleHit = function() {
        const playerDir = $gamePlayer.direction();
        let jx = 0, jy = 0;
        const jumpPower = 3;
        const sway = Math.random() < 0.5 ? 1 : -1;
        switch (playerDir) {
            case 2: jy = jumpPower; jx = sway; break;
            case 4: jx = -jumpPower; jy = sway; break;
            case 6: jx = jumpPower; jy = sway; break;
            case 8: jy = -jumpPower; jx = sway; break;
        }
        this.jump(jx, jy);
    };

    // ========================================================================
    // 12. Game_Map - setupEvents
    // ========================================================================

    const _Game_Map_setupEvents = Game_Map.prototype.setupEvents;
    Game_Map.prototype.setupEvents = function() {
        _Game_Map_setupEvents.call(this);
        this.events().forEach(event => {
            if (event.event().name !== "Enemy") {
                event.selectFixedTroopIdFromNote();
                event.updateCharacterSprite();
            }
        });
        // Resprite persistent enemies flagged on save/load (see section 15).
        this.events().forEach(event => {
            const persistentId = `${this._mapId}_${event._eventId}`;
            const pData = BSE.State.persistentEnemyData[persistentId];
            if (pData && pData.needsResprite) {
                event._fixedTroopId = pData.troopId;
                event.updateCharacterSprite();
                pData.needsResprite = false;
            }
        });
    };

    // ========================================================================
    // 13. Movement Lock
    // ========================================================================

    Game_Event.prototype.lockMovement = function(duration) {
        this._movementLocked = true;
        this._movementLockTimer = duration || 60;
    };

    const _Game_Event_updateSelfMovement = Game_Event.prototype.updateSelfMovement;
    Game_Event.prototype.updateSelfMovement = function() {
        if (this._movementLocked) return;
        if (this.updateEcologyMovement()) return;
        _Game_Event_updateSelfMovement.call(this);
    };

    // Hunters / predators chase nearby targets at their own speed; prey and
    // neutral creatures flee from anything hunting them. Returns true when this
    // override took over movement for the frame.
    Game_Event.prototype.updateEcologyMovement = function() {
        if ((this._ecoTick = ((this._ecoTick || 0) + 1) % 10) !== 0) return false;
        if (!isLiveEnemyEvent(this)) return false;
        if (this.isMoving() || !this.isNearTheScreen()) return false;
        const myEco = BSE.Helpers.getEventEcology(this);
        if (!myEco) return false;

        const range = BSE.Data.ECOLOGY_AWARENESS;
        let prey = null, preyDist = Infinity;     // nearest thing I hunt
        let threat = null, threatDist = Infinity; // nearest hunter I cannot fight back

        const events = $gameMap.events();
        for (const ev of events) {
            if (ev === this || !isLiveEnemyEvent(ev)) continue;
            const dist = Math.abs(ev.x - this.x) + Math.abs(ev.y - this.y);
            if (dist > range) continue;
            const otherEco = BSE.Helpers.getEventEcology(ev);
            if (BSE.Helpers.ecologyChases(myEco, otherEco)) {
                if (dist < preyDist) { prey = ev; preyDist = dist; }
            } else if (BSE.Helpers.ecologyChases(otherEco, myEco)) {
                // only flee when I don't hunt it back (pure prey/neutral reaction)
                if (dist < threatDist) { threat = ev; threatDist = dist; }
            }
        }

        if (prey) {
            this.moveTowardCharacter(prey);
            this.resetStopCount();
            return true;
        }
        if (threat) {
            this.moveAwayFromCharacter(threat);
            this.resetStopCount();
            return true;
        }
        return false;
    };

    Game_Event.prototype.updateMovementLock = function() {
        if (this._movementLocked && this._movementLockTimer > 0) {
            this._movementLockTimer--;
            if (this._movementLockTimer <= 0) this._movementLocked = false;
        }
    };

    // Cached trimmed split-screen P2 name, refreshed only when the raw value changes.
    let _p2EventNameRaw = undefined;
    let _p2EventNameTrimmed = "Player 2";

    const _Game_Event_update = Game_Event.prototype.update;
    Game_Event.prototype.update = function() {
        _Game_Event_update.call(this);
        this.updateMovementLock();
        if (window.$gameSplitScreen && window.$gameSplitScreen.active) {
            if (window.$gameSplitScreen.p2EventName !== _p2EventNameRaw) {
                _p2EventNameRaw = window.$gameSplitScreen.p2EventName;
                _p2EventNameTrimmed = (_p2EventNameRaw || "Player 2").trim();
            }
            if (this._trimmedEventName === undefined) {
                this._trimmedEventName = (this.event().name || "").trim();
            }
            const myName = this._trimmedEventName;
            if (myName === _p2EventNameTrimmed) this.updateP2EncounterCheck();
            else if (myName === "Enemy" && this._fixedTroopId > 0) this.updateEnemyTouchP2Check();
        }
    };

    Game_Event.prototype.updateP2EncounterCheck = function() {
        if ($gameSystem.getBattleCooldown() > 0) return;
        if ($gameMap.isEventRunning() || SceneManager.isSceneChanging()) return;
        const x = this.x, y = this.y, d = this.direction();
        const x2 = $gameMap.roundXWithDirection(x, d);
        const y2 = $gameMap.roundYWithDirection(y, d);
        const targets = [...$gameMap.eventsXy(x, y), ...$gameMap.eventsXy(x2, y2)];
        for (const target of targets) {
            if (target !== this && (target.event().name || "").trim() === "Enemy" && target._fixedTroopId > 0) {
                const persistentId = `${$gameMap.mapId()}_${target.eventId()}`;
                window._battleActivatorOverride = "p2";
                BSE.Functions.startPersistentBattle(target._fixedTroopId, persistentId, target.eventId(), $gameMap.mapId());
                break;
            }
        }
    };

    Game_Event.prototype.updateEnemyTouchP2Check = function() {
        if ($gameSystem.getBattleCooldown() > 0) return;
        if ($gameMap.isEventRunning() || SceneManager.isSceneChanging()) return;
        const p2 = window.$gameSplitScreen.p2Event;
        if (!p2) return;
        if (this.x === p2.x && this.y === p2.y) {
            const persistentId = `${$gameMap.mapId()}_${this.eventId()}`;
            window._battleActivatorOverride = "p2";
            BSE.Functions.startPersistentBattle(this._fixedTroopId, persistentId, this.eventId(), $gameMap.mapId());
        }
    };

    // ========================================================================
    // 14. Enemy vs Enemy Combat
    // ========================================================================

    const _Scene_Map_update_BSE = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update_BSE.call(this);
        // Map Battle Mode (MapBattleMode.js) freezes world time: the map only
        // moves at the world step between rounds. Wildlife still roams (in that
        // step-time), but resolving their brawls on real frames would let a
        // minute of the player reading menus wipe out the local ecosystem.
        if (window.MapBattleMode && window.MapBattleMode.isActive()) return;
        if (this.isActive()) this.updateEnemyVsEnemyCombat();
    };

    const ECO_FIGHT_INTERVAL = 60;
    // The pairing scan below is O(n^2) over all live enemy events. A new fight
    // starting a few frames late is imperceptible, so only run the scan
    // periodically instead of every frame; fight resolution still ticks each frame.
    const ECO_PAIR_SCAN_INTERVAL = 20;

    function lvOf(event) {
        return (window.getEnemyLevelFromEvent ? window.getEnemyLevelFromEvent(event) : 1) || 1;
    }

    Scene_Map.prototype.updateEnemyVsEnemyCombat = function() {
        if (!$gameSystem._enemyFights) $gameSystem._enemyFights = {};
        const fights = $gameSystem._enemyFights;

        // 1. Pair up touching / adjacent enemies that have a reason to fight.
        //    Throttled: the O(n^2) scan + event filter only runs every
        //    ECO_PAIR_SCAN_INTERVAL frames.
        this._bseEcoPairTick = (this._bseEcoPairTick || 0) + 1;
        if (this._bseEcoPairTick >= ECO_PAIR_SCAN_INTERVAL) {
            this._bseEcoPairTick = 0;
            const enemies = $gameMap.events().filter(isLiveEnemyEvent);
            for (let i = 0; i < enemies.length; i++) {
                for (let j = i + 1; j < enemies.length; j++) {
                    const a = enemies[i], b = enemies[j];
                    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
                    if (Math.max(dx, dy) > 1) continue; // not touching or adjacent

                    const ecoA = BSE.Helpers.getEventEcology(a);
                    const ecoB = BSE.Helpers.getEventEcology(b);
                    const ecoRel = BSE.Helpers.ecologyChases(ecoA, ecoB) ||
                                   BSE.Helpers.ecologyChases(ecoB, ecoA);
                    // keep legacy behaviour: differing archetypes brawl when overlapping
                    const archA = BSE.Helpers.getEventArchetype(a);
                    const archB = BSE.Helpers.getEventArchetype(b);
                    const sameTileDiffArch = dx === 0 && dy === 0 && archA && archB && archA !== archB;
                    if (!ecoRel && !sameTileDiffArch) continue;

                    const key = a.eventId() < b.eventId()
                        ? `${a.eventId()}_${b.eventId()}`
                        : `${b.eventId()}_${a.eventId()}`;
                    if (!fights[key]) {
                        if (a.enemyHp === undefined) a.enemyHp = a.getMaxHpForEvent();
                        if (b.enemyHp === undefined) b.enemyHp = b.getMaxHpForEvent();
                        fights[key] = { fighters: [a.eventId(), b.eventId()], timer: ECO_FIGHT_INTERVAL };
                    }
                }
            }
        }

        // 2. Resolve ongoing fights (HP attrition, biased by level + ecology)
        for (const key in fights) {
            const fight = fights[key];
            if (--fight.timer > 0) continue;
            fight.timer = ECO_FIGHT_INTERVAL;

            const e1 = $gameMap.event(fight.fighters[0]);
            const e2 = $gameMap.event(fight.fighters[1]);
            if (!isLiveEnemyEvent(e1) || !isLiveEnemyEvent(e2) ||
                Math.max(Math.abs(e1.x - e2.x), Math.abs(e1.y - e2.y)) > 1) {
                delete fights[key];
                continue;
            }

            const lv1 = lvOf(e1), lv2 = lvOf(e2);
            const eco1 = BSE.Helpers.getEventEcology(e1);
            const eco2 = BSE.Helpers.getEventEcology(e2);

            // attacker weight = level, tripled when ecologically dominant
            let w1 = lv1, w2 = lv2;
            if (BSE.Helpers.ecologyDominates(eco1, eco2)) w1 *= 3;
            if (BSE.Helpers.ecologyDominates(eco2, eco1)) w2 *= 3;

            let attacker, defender, atkLv;
            if (Math.random() < w1 / (w1 + w2)) { attacker = e1; defender = e2; atkLv = lv1; }
            else { attacker = e2; defender = e1; atkLv = lv2; }

            const damage = 5 + Math.floor(atkLv / 2) + Math.floor(Math.random() * 6);
            if (defender.enemyHp === undefined) defender.enemyHp = defender.getMaxHpForEvent();
            defender.enemyHp -= damage;

            const spriteset = SceneManager._scene && SceneManager._scene._spriteset;
            if (spriteset && spriteset._characterSprites) {
                const ds = spriteset._characterSprites.find(s => s._character === defender);
                if (ds) { ds.setBlendColor([255, 64, 64, 160]); ds._flashDuration = 12; }
            }

            if (defender.enemyHp <= 0) {
                BSE.Functions.killEnemyEventLeaveCorpse(defender, atkLv);
                delete fights[key];
            }
        }
    };

    // ------------------------------------------------------------------------
    // Kill a map enemy event and leave a harvestable corpse, possibly with
    // body parts torn off / destroyed depending on the killer's level and RNG.
    // ------------------------------------------------------------------------
    BSE.Functions.killEnemyEventLeaveCorpse = function(ev, killerLevel) {
        if (!ev || ev._erased) return;
        const troop = ev._fixedTroopId ? $dataTroops[ev._fixedTroopId] : null;
        const enemyId = (troop && troop.members.length) ? troop.members[0].enemyId : 0;
        const enemyData = enemyId ? $dataEnemies[enemyId] : null;

        applyMapDeathPartDamage(enemyId, enemyData, killerLevel);

        const corpse = {
            mapId: $gameMap.mapId(),
            x: ev.x,
            y: ev.y,
            spriteName: ev._characterName,
            spriteIndex: ev._characterIndex,
            hue: ev._characterHue || 0,
            bloodColor: BSE.Helpers.getCorpseBloodColor
                ? BSE.Helpers.getCorpseBloodColor(enemyData)
                : [200, 20, 20],
            enemyId: enemyId
        };
        if (BSE.State.mapCorpses) BSE.State.mapCorpses.push(corpse);

        const spriteset = SceneManager._scene && SceneManager._scene._spriteset;
        if (spriteset && spriteset.addCorpseSprite) spriteset.addCorpseSprite(corpse);

        ev.enemyHp = 0;
        $gameMap.eraseEvent(ev.eventId());
    };

    function applyMapDeathPartDamage(enemyId, enemyData, killerLevel) {
        if (!enemyId || !enemyData || !BSE.State.enemyPartDamage) return;
        const archetypeName = BSE.Helpers.getEnemyArchetype(enemyData);
        const archetypes = window.Health && window.Health.EnemyArchetypes;
        const archetype = archetypeName && archetypes ? archetypes[archetypeName] : null;
        if (!archetype || !archetype.parts) return;

        const victimLevel = BSE.Helpers.getEnemyLevel(enemyData.note) || 1;
        const mhp = (enemyData.params && enemyData.params[0]) ? enemyData.params[0] : 100;

        // chance per part to be missing/destroyed: always some, more when outmatched
        let brutality = 0.25 + (killerLevel - victimLevel) / 25;
        brutality = Math.max(0.1, Math.min(0.8, brutality));

        const parts = {};
        for (const key in archetype.parts) {
            const basePart = archetype.parts[key];
            const maxHp = Math.max(1, Math.round(mhp * (basePart.hpPercent || 100) / 100));
            const destroyed = Math.random() < brutality;
            parts[key] = {
                currentHp: destroyed ? 0 : maxHp,
                maxHp: maxHp,
                destroyed: destroyed,
                appliedStatEffect: destroyed
            };
        }
        BSE.State.enemyPartDamage[enemyId] = {
            parts: parts,
            statModifiers: {},
            disabledActions: [],
            archetypeName: archetypeName,
            def: (enemyData.params && enemyData.params[3]) ? enemyData.params[3] : 0
        };
    }

    // ========================================================================
    // 15. Game_Map.setupEvents - resprited on load
    // ========================================================================
    // Persistent-enemy resprite is handled in the section 12 setupEvents alias
    // above to avoid aliasing Game_Map.setupEvents twice in this file.

    // ========================================================================
    // 16. Alien planet life gating (GalaxySim)
    // ------------------------------------------------------------------------
    // A landed alien planet (proc map 636 from an "Alien*" biome) either hosts
    // life -> spawn totally random enemies, or is barren -> no enemies at all.
    // The life flag is decided at landing (GalaxySim.currentAlienHasLife).
    // ========================================================================
    function alienSurfaceState() {
        const GS = window.GalaxySim;
        if (!GS || typeof GS.isAlienSurface !== 'function' || !GS.isAlienSurface()) return null;
        return { hasLife: !!(GS.currentAlienHasLife && GS.currentAlienHasLife()) };
    }

    // A "totally random" encounter list for living alien worlds: random valid
    // troops with no biome / nation weighting.
    function randomAlienEncounterList(count) {
        const ids = [];
        for (let i = 1; i < $dataTroops.length; i++) {
            if (BSE.Helpers.isSpawnableTroopData($dataTroops[i])) ids.push(i);
        }
        if (!ids.length) return [];
        const pool = ids.slice();
        const n = Math.min(count || 6, pool.length);
        const list = [];
        for (let i = 0; i < n && pool.length; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            list.push({ troopId: pool.splice(idx, 1)[0], weight: 1, regionId: 0 });
        }
        return list;
    }

    // Session-local synthetic troops, one per procedural alien species. Each is a
    // 1-3 pack of the species' base enemy id (its 3D look) tagged with the species
    // key; rebuilt on demand because $dataTroops is transient across save/load.
    const _alienTroopCache = {}; // speciesKey -> troopId (valid for this session)
    function speciesTroopId(sp) {
        const cached = _alienTroopCache[sp.key];
        if (cached && $dataTroops[cached] && $dataTroops[cached]._alienSpeciesKey === sp.key) {
            return cached;
        }
        const troopId = $dataTroops.length;
        const nMembers = 1 + Math.floor(Math.random() * 3);
        const members = [];
        for (let m = 0; m < nMembers; m++) {
            members.push({ enemyId: sp.enemyId, x: 320 + m * 180, y: 300, hidden: false });
        }
        $dataTroops.push({ id: troopId, members, name: sp.name, pages: [], _alienSpeciesKey: sp.key });
        _alienTroopCache[sp.key] = troopId;
        return troopId;
    }
    // Encounter list drawn from the world's species roster (procedural aliens).
    function alienSpeciesEncounterList() {
        const GS = window.GalaxySim;
        const roster = (GS && GS.alienSpeciesRoster) ? GS.alienSpeciesRoster() : [];
        if (!roster.length) return randomAlienEncounterList(6);
        return roster.map((sp) => ({ troopId: speciesTroopId(sp), weight: 1, regionId: 0 }));
    }

    // Living alien world -> the world's procedural species; barren world -> no
    // encounters at all (empty list also disables step-based random battles).
    const _BSE_Game_Map_encounterList = Game_Map.prototype.encounterList;
    Game_Map.prototype.encounterList = function () {
        const st = alienSurfaceState();
        if (st) return st.hasLife ? alienSpeciesEncounterList() : [];
        return _BSE_Game_Map_encounterList.call(this);
    };

    // On battle setup, tag every enemy of a species troop with its procedural
    // name (so it shows in battle) and record the species as discovered. A
    // reinforced troop (section 5b) can mix two species, so it carries one key
    // per member instead of one for the whole troop.
    const _BSE_Game_Troop_setup = Game_Troop.prototype.setup;
    Game_Troop.prototype.setup = function (troopId) {
        _BSE_Game_Troop_setup.call(this, troopId);
        const troop = $dataTroops[troopId];
        const GS = window.GalaxySim;
        if (!troop || !GS || !GS.findAlienSpecies) return;
        const keys = troop._alienSpeciesKeys ||
            (troop._alienSpeciesKey ? this.members().map(() => troop._alienSpeciesKey) : null);
        if (!keys) return;
        this.members().forEach((e, i) => {
            const sp = keys[i] ? GS.findAlienSpecies(keys[i]) : null;
            if (!sp) return;
            if (GS.discoverAlienSpecies) GS.discoverAlienSpecies(sp);
            e._alienSpeciesName = sp.name;
        });
    };

    // A tagged enemy reports the species name in battle. originalName (not the
    // raw $dataEnemies name the 3D battler resolves its model from) is overridden,
    // so the look stays the species' base-enemy model while the label changes.
    const _BSE_Game_Enemy_originalName = Game_Enemy.prototype.originalName;
    Game_Enemy.prototype.originalName = function () {
        if (this._alienSpeciesName) return this._alienSpeciesName;
        return _BSE_Game_Enemy_originalName.call(this);
    };

    // Barren alien world -> erase every roaming "Enemy" event so nothing spawns.
    const _BSE_spawnEnemiesFromEncounters = Scene_Map.prototype.spawnEnemiesFromEncounters;
    Scene_Map.prototype.spawnEnemiesFromEncounters = function () {
        const st = alienSurfaceState();
        if (st && !st.hasLife) {
            $gameMap.events().forEach((ev) => {
                const ed = ev.event();
                if (ed && ed.name === 'Enemy') ev.erase();
            });
            return;
        }
        _BSE_spawnEnemiesFromEncounters.call(this);
    };

})();