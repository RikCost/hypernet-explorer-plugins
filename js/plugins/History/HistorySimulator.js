/*:
 * @target MZ
 * @plugindesc Dwarf Fortress-inspired Europe Alternate History Generator (1900-2001).
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @param startYear
 * @text Start Year
 * @type number
 * @default 1900
 * @desc The year the simulation starts.
 *
 * @param endYear
 * @text End Year
 * @type number
 * @default 2001
 * @desc The year the simulation ends.
 *
 * @param autoRunOnNewGame
 * @text Auto-run on New Game
 * @type boolean
 * @default true
 * @desc If true, runs a fresh simulation when a new game starts.
 *
 * @command runSimulation
 * @text Run Simulation
 * @desc Runs a fresh simulation of history. WARNING: Clears existing history.
 *
 * @command getHistoricalFact
 * @text Get Historical Fact
 * @desc Gets a random historical fact and stores it in a variable.
 * @arg variableId
 * @type variable
 * @desc The variable ID to store the fact string in.
 * @arg year
 * @type number
 * @desc Optional: Specify a year. 0 for random.
 * @default 0
 *
 * @command showHistoryLog
 * @text Show History Log
 * @desc Opens a window displaying the generated timeline.
 *
 * @help
 * HistorySimulator.js
 * ============================================================================
 * This plugin simulates a century of geopolitical shifts, ideologies, and 
 * conflicts in a procedural Europe (1900-2001).
 *
 * It generates a persistent timeline of events including:
 * - Political coups, elections, purges and assassinations
 * - Wars, sieges, mutinies and territorial conquests
 * - Paranormal anomalies (50 kinds), occult rites and "The Squishing"
 * - Scientific expeditions, natural disasters and organised crime
 * - Economic shifts and technological breakthroughs
 *
 * Categories are drawn with the weights in CATEGORY_WEIGHTS, which favour the
 * paranormal and occult strands over mundane background noise.
 *
 * History is stored in the active world's history store via window.WorldManager
 * (falling back to $gameSystem._historical* when no world is active). Always
 * read/write it through window.HistoryManager (getEvents/getHyperpowers/etc.)
 * so every consumer sees the same data regardless of which store is active.
 *
 * Integration:
 * - Use 'Get Historical Fact' to flavor NPC dialogue or item descriptions.
 * - The simulation affects hidden 'stats' for factions and hyperpowers which
 *   can be used by other plugins or conditional branches.
 * ============================================================================
 */

(function () {
    'use strict';

    const pluginName = "HistorySimulator";
    const params = PluginManager.parameters(pluginName);
    const START_YEAR = Number(params.startYear || 1900);
    const END_YEAR = Number(params.endYear || 2001);
    const AUTO_RUN = params.autoRunOnNewGame === "true";
    const CANON_END_YEAR = 2001; // The true end year of the canon timeline

    //=============================================================================
    // Data Constants (Ported from HistorySimulator.html)
    //=============================================================================

    const fs = require('fs');
    const path = require('path');

    let HYPERPOWERS = {};
    let FACTIONS = {};

    // Module-level JSON reader. Everything the simulator needs is normally
    // already on window (DataService loads the db folder); this is the fallback
    // for a run that happens before that, and is NW.js-only by nature.
    function loadJsonFile(relPath) {
        try {
            const fullPath = path.join(process.cwd(), relPath);
            if (!fs.existsSync(fullPath)) return null;
            return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        } catch (e) {
            console.error('[HistorySimulator] Failed to read', relPath, e);
            return null;
        }
    }

    (function loadWorldGenData() {
        function loadJson(relPath) {
            const fullPath = path.join(process.cwd(), relPath);
            if (!fs.existsSync(fullPath)) return null;
            try { return JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
            catch (e) { console.error('[HistorySimulator] Failed to parse', relPath, e); return null; }
        }

        try {
            const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || 'en';
            const hpData       = loadJson('js/db/WorldGen/Hyperpowers.json');
            const leadersData  = loadJson('js/db/WorldGen/Leaders.json');
            const factionsData = loadJson('js/db/WorldGen/Factions.json');
            const ideologyI18n = loadJson(`js/i18n/${lang}/ideology.json`) || loadJson('js/i18n/en/ideology.json') || {};
            const factionI18n  = loadJson(`js/i18n/${lang}/faction.json`)  || loadJson('js/i18n/en/faction.json')  || {};
            const personalI18n = loadJson(`js/i18n/${lang}/personality.json`) || loadJson('js/i18n/en/personality.json') || {};

            function resolveLeader(id) {
                if (!leadersData) return null;
                const raw = leadersData[id];
                if (!raw) return null;
                const rawKey = raw.ideology || raw.personality || '';
                let ideology;
                if (rawKey.startsWith('ideology.')) {
                    ideology = ideologyI18n[rawKey] || rawKey.replace('ideology.', '').replace(/_/g, ' ');
                } else if (rawKey.startsWith('personalities.')) {
                    const pKey = rawKey.split('.')[1];
                    ideology = (personalI18n.personality && personalI18n.personality[pKey] && personalI18n.personality[pKey].name) || rawKey.replace('personalities.', '').replace(/_/g, ' ');
                } else {
                    ideology = rawKey;
                }
                return { name: raw.name, ideology, years: raw.years || [1900, 2012], protected: raw.protected === true };
            }

            if (hpData && hpData.hyperpowers) {
                for (const [name, data] of Object.entries(hpData.hyperpowers)) {
                    const leaders = (data.leaders || []).map(resolveLeader).filter(Boolean);
                    const holyLeaders = (data.holy_leaders || []).map(resolveLeader).filter(Boolean);
                    HYPERPOWERS[name] = {
                        leaders,
                        holy_leaders: holyLeaders.length ? holyLeaders : undefined,
                        population:  data.population  || 10000000,
                        economy:     data.economy     || 100,
                        military:    data.military    || 100,
                        information: data.information || 50,
                        arcane:      data.arcane      || 20
                    };
                }
            }

            if (factionsData && Array.isArray(factionsData)) {
                factionsData.forEach(f => {
                    if (!f.name) return;
                    const key = f.name.split('.')[1] || f.name.split('.')[0];
                    let realName = key;
                    if (factionI18n.factions && factionI18n.factions[key] && factionI18n.factions[key].name) {
                        realName = factionI18n.factions[key].name;
                    }
                    if (!FACTIONS[realName]) {
                        const leaders = (f.leaders || []).map(resolveLeader).filter(Boolean);
                        if (leaders.length === 0) {
                            // Deleted again by exportProperNouns; the label a player
                            // ever sees is History.leader.unknown.
                            leaders.push({ name: 'Unknown Leader', ideology: 'Unknown', years: [1900, 2012] });  // i18n-ignore  placeholder leader id
                        }
                        FACTIONS[realName] = {
                            leaders,
                            arcane:      f.arcane      || 50,
                            tech:        f.velocity    || f.tech || 50,
                            information: f.information || 50
                        };
                    }
                });
            }

            if (Object.keys(HYPERPOWERS).length === 0) {
                console.warn('[HistorySimulator] No hyperpower data loaded; simulation will be empty.');
            }
        } catch (e) {
            console.error('[HistorySimulator] Failed to load WorldGen data:', e);
        }
    })();

    // i18n-ignore-start  country, controller and faction ids. They are matched
    // against WorldGen data and FactionDataManager, and every display of them
    // goes through those systems' own labels.
    const COUNTRIES = {
        'Italy': { controller: 'Holy Vatican Empire', faction: 'The Gods' },
        'United Kingdom': { controller: 'Britannia', faction: 'Mages Guild' },
        'Norway': { controller: 'Goblin Horde', faction: 'Neutral' },
        'Russia': { controller: 'Soviet Union', faction: 'Archive Foundation' },
        'Turkey': { controller: 'Ottoman Empire', faction: 'Neutral' },
        'Netherlands': { controller: 'Neutral', faction: 'Hypercapitalist Collective' },
        'Belgium': { controller: 'Neutral', faction: 'Neutral' },
        'Switzerland': { controller: 'Neutral', faction: 'Neutral' },
        'Austria': { controller: 'Neutral', faction: 'Neutral' },
        'Poland': { controller: 'Neutral', faction: 'Neutral' },
        'Czechoslovakia': { controller: 'Neutral', faction: 'Neutral' },
        'Hungary': { controller: 'Neutral', faction: 'Neutral' },
        'Romania': { controller: 'Neutral', faction: 'Neutral' },
        'Bulgaria': { controller: 'Neutral', faction: 'Neutral' },
        'Yugoslavia': { controller: 'Neutral', faction: 'Neutral' },
        'Greece': { controller: 'Neutral', faction: 'Neutral' },
        'Denmark': { controller: 'Neutral', faction: 'Neutral' },
        'Sweden': { controller: 'Neutral', faction: 'Neutral' },
        'Finland': { controller: 'Neutral', faction: 'Neutral' },
        'Ireland': { controller: 'Neutral', faction: 'Neutral' },
        'Albania': { controller: 'Neutral', faction: 'Neutral' },
        'Estonia': { controller: 'Neutral', faction: 'Neutral' },
        'Latvia': { controller: 'Neutral', faction: 'Neutral' },
        'Lithuania': { controller: 'Neutral', faction: 'Neutral' }
    };
    // i18n-ignore-end

    // i18n-ignore-start  event type ids: stored on every event record and used
    // as the lookup key into History.event.basic / History.event.weird
    const EVENT_TYPES = {
        political: [
            'assassination attempt', 'election', 'coup attempt', 'reforms', 'scandal',
            'purge', 'treaty signing', 'constitutional crisis', 'mass exile',
            'secret police expansion', 'referendum', 'state funeral', 'propaganda campaign',
            'censorship decree', 'party schism', 'border treaty', 'amnesty', 'show trial'
        ],
        military: [
            'border skirmish', 'naval encounter', 'weapon development', 'military parade',
            'siege', 'aerial bombardment', 'mutiny', 'blockade', 'armistice talks',
            'conscription drive', 'fortification project', 'mercenary contract',
            'submarine incident', 'proxy war', 'airship disaster', 'cavalry charge',
            'chemical trial', 'high defection'
        ],
        economic: [
            'market crash', 'trade agreement', 'industrial growth', 'resource discovery',
            'famine', 'currency reform', 'general strike', 'bank collapse', 'smuggling ring',
            'gold rush', 'rationing', 'monopoly formed', 'hyperinflation', 'trade embargo',
            'railway boom', 'harvest failure', 'guild charter'
        ],
        social: [
            'plague outbreak', 'technological breakthrough', 'cultural festival', 'religious event',
            'mass migration', 'university founded', 'sporting triumph', 'great fire',
            'public execution', 'medical discovery', 'literary movement', 'riot',
            'temperance crusade', 'quarantine', 'census', 'cinema opens', 'radio craze',
            'schism of faith'
        ],
        paranormal: [
            'StrangeLightsInSky', 'MysteriousDisappearances', 'PropheticDreams', 'CryptidSighting',
            'ThoughtTransmittedDisease', 'TimeAnomaly', 'RainOfFish', 'BleedingStatues',
            'SpontaneousCombustion', 'GhostTrain', 'MirrorPlague', 'DoppelgangerEpidemic',
            'SleepwalkingPilgrimage', 'GravityInversion', 'SecondMoon', 'WhisperingWells',
            'LivingShadows', 'MemoryFog', 'HollowChildren', 'SoulHarvest', 'DimensionalRift',
            'ReverseRain', 'SingingStones', 'ClockworkPossession', 'PoltergeistUprising',
            'MassHallucination', 'AngelicSighting', 'DemonicIncursion', 'LeyLineSurge',
            'NumberStation', 'GeometryFailure', 'LanguageDecay', 'ThePaleVisitor', 'WeepingSky',
            'InfiniteStaircase', 'TelepathicPlague', 'ColorLoss', 'MoonSickness', 'SkyLeviathan',
            'ChronoEcho', 'CorpseAwakening', 'FleshTelegraph', 'StaticSermon', 'DreamQuarantine',
            'ShadowTax', 'UnbornChoir', 'GlassRain', 'CompassFailure', 'AnimalCouncil', 'NameTheft'
        ],
        occult: [
            'grimoire recovered', 'coven exposed', 'ritual sacrifice', 'summoning gone wrong',
            'relic consecration', 'ley survey', 'public exorcism', 'alchemical breakthrough',
            'necromantic scandal', 'blood moon rite', 'oracle installed', 'curse laid',
            'canonization', 'heresy trial', 'astrological decree', 'spirit binding',
            'occult academy founded', 'forbidden translation'
        ],
        scientific: [
            'polar expedition', 'observatory built', 'particle experiment', 'vaccine trial',
            'archaeological dig', 'failed prototype', 'radio anomaly research',
            'cryptozoological survey', 'deep drilling', 'flight record', 'vivisection scandal',
            'element isolated', 'seismic study', 'surgical first', 'computing engine', 'rocket test'
        ],
        disaster: [
            'earthquake', 'flood', 'volcanic eruption', 'mine collapse', 'shipwreck', 'firestorm',
            'blizzard', 'meteor strike', 'dam failure', 'train wreck', 'landslide', 'drought',
            'locust swarm', 'bridge collapse'
        ],
        criminal: [
            'heist', 'serial killer', 'smuggling bust', 'assassin guild', 'black market',
            'kidnapping', 'forgery scandal', 'prison break', 'arson ring', 'body snatching',
            'counterfeit relics', 'gang war'
        ],
        royal: [
            'royal wedding', 'succession crisis', 'royal scandal', 'coronation', 'abdication',
            'royal birth', 'dynastic pact', 'regicide', 'jubilee', 'royal exile', 'pretender emerges'
        ]
    };
    // i18n-ignore-end

    // Relative frequency of each category in the monthly random-event roll.
    // The paranormal and occult strands carry the setting, so they are drawn
    // more often than the mundane political/economic background noise.
    const CATEGORY_WEIGHTS = {
        political: 12,
        military: 12,
        economic: 9,
        social: 11,
        paranormal: 24,
        occult: 11,
        scientific: 8,
        disaster: 6,
        criminal: 6,
        royal: 5
    };

    const ICONS = {
        political: 191,
        military: 115,
        economic: 187,
        social: 127,
        paranormal: 245,
        occult: 249,
        scientific: 79,
        disaster: 64,
        criminal: 217,
        royal: 145,
        epidemic: 177,
        conquest: 97,
        war: 223,
        peace: 237,
        internal: 212
    };

    // Form of government a nation adopts while under a given hyperpower's
    // control. Mirrors NPCPolitics' ARCHETYPES so the wiki shows the same
    // labels whether the data comes from history or the live simulation.
    // i18n-ignore-start  controller ids in, government ids out. The label for a
    // government id is History.government.<id>, resolved by governmentFor().
    const HYPERPOWER_GOVS = {
        'Holy Vatican Empire': 'Theocracy',
        'USSR': 'Single-Party State',
        'Soviet Union': 'Single-Party State',
        'Britannia': 'Parliamentary Monarchy',
        'Archive Foundation': 'Technocracy',
        'Ottoman Empire': 'Sultanate',
        'The Gods': 'Divine Pantheon',
        'San Marino Republic': 'Serene Republic',
        'Hypercapitalist Collective': 'Corporatocracy',
        'Goblin Horde': 'Warband Confederacy',
        'Free States of Midwest': 'Free Confederation',
        'Cascadia Protectorate': 'Crown Protectorate',
        'Eastern Seaboard': 'Punitive Colony Regime'
    };

    // Independent (Neutral) nations get a stable, name-seeded flavor of
    // self-rule that they return to whenever they break free.
    const NEUTRAL_GOVS = [
        'Parliamentary Republic', 'Constitutional Monarchy', 'Federal Republic',
        'Confederation of Cantons', 'City-State Council', 'Crowned Republic'
    ];
    // i18n-ignore-end

    // The transfer action is an id ('stole' is tested for by name below); the
    // wording a player reads is History.artifact.action.<id>.
    const ARTIFACT_TRANSFER_ACTIONS = ['seized', 'purchased', 'inherited', 'stole', 'was gifted'];  // i18n-ignore  transfer action ids

    // Which events move which statistic. This used to be decided by searching the
    // finished sentence for English words, which stopped working the moment the
    // sentence could be written in another language, so it keys off the event's
    // own type id instead.
    // i18n-ignore-start  event type ids, matched against the event record
    const EFFECT_TYPES = {
        ecoCrash: ['market crash', 'bank collapse', 'hyperinflation', 'trade embargo',
                   'general strike', 'smuggling ring'],
        ecoBoom:  ['industrial growth', 'railway boom', 'trade agreement', 'monopoly formed',
                   'gold rush', 'resource discovery'],
        popLoss:  ['plague outbreak', 'famine', 'drought', 'locust swarm', 'quarantine',
                   'ThoughtTransmittedDisease', 'TelepathicPlague', 'DreamQuarantine',
                   'MoonSickness', 'SoulHarvest'],
        ecoDamage: ['earthquake', 'flood', 'volcanic eruption', 'firestorm', 'blizzard',
                    'landslide', 'mine collapse', 'bridge collapse', 'dam failure',
                    'great fire', 'shipwreck', 'train wreck', 'meteor strike'],
        infoGain: ['technological breakthrough', 'medical discovery', 'element isolated',
                   'observatory built', 'particle experiment', 'radio anomaly research',
                   'seismic study', 'computing engine', 'archaeological dig',
                   'cryptozoological survey', 'ley survey', 'census'],
        techGain: ['TimeAnomaly', 'DimensionalRift', 'LeyLineSurge', 'GravityInversion',
                   'ChronoEcho', 'GeometryFailure', 'rocket test', 'flight record'],
        arcaneGain: ['ritual sacrifice', 'grimoire recovered', 'summoning gone wrong',
                     'oracle installed', 'curse laid', 'public exorcism', 'relic consecration',
                     'spirit binding', 'blood moon rite', 'forbidden translation',
                     'occult academy founded', 'coven exposed', 'necromantic scandal',
                     'canonization', 'heresy trial', 'astrological decree',
                     'alchemical breakthrough'],
        militaryGain: ['conscription drive', 'military parade', 'fortification project',
                       'mercenary contract', 'weapon development', 'siege'],
    };
    // i18n-ignore-end

    // A government id's display label. Unknown ids read as themselves so a
    // government added to the data files still shows something sensible.
    function governmentLabel(id) {
        const key = 'History.government.' + String(id || '');
        return T.has(key) ? T(key) : String(id || '');
    }

    //=============================================================================
    // Localizable descriptions
    //=============================================================================
    // A timeline is world-shared: it is written once and then read by every
    // savegame of that world, in whatever language each of them is played in.
    // So an event never stores only its finished prose. It stores the i18n key
    // and the params it was written from (`descKey` / `descParams`) and the
    // sentence is rebuilt on read, the same way NPCSociety writes out a bio.
    // A param may itself be a translated fragment, in which case it is stored
    // as a nested key descriptor `{ $k, $p }` rather than as finished text.

    function LK(key, params) { return { $k: String(key), $p: params || null }; }
    function isLK(v) { return !!v && typeof v === 'object' && typeof v.$k === 'string'; }

    // A faction-data label (ideology, personality): its copy lives in
    // FactionDataManager, not in History.json, so it carries its own marker.
    function FD(id) { return { $fd: String(id) }; }
    function isFD(v) { return !!v && typeof v === 'object' && typeof v.$fd === 'string'; }
    function renderFD(id) {
        return FactionDataManager.instance ? FactionDataManager.instance.t(id) : id;
    }

    // An artifact's name is composed per language by generateArtifacts and
    // re-injected into the database every session, so an event names the
    // artifact by record rather than by the name it happened to carry when the
    // century was simulated. The stored name is the fallback for a database
    // that no longer holds it.
    function AR(kind, id, name) { return { $art: kind + ':' + id, $n: name }; }
    function isAR(v) { return !!v && typeof v === 'object' && typeof v.$art === 'string'; }
    function renderAR(v) {
        const [kind, id] = String(v.$art).split(':');
        const db = kind === 'weapon' ? $dataWeapons : kind === 'armor' ? $dataArmors : $dataItems;
        const rec = db && db[Number(id)];
        return (rec && rec.name) || v.$n || '';
    }

    function renderParam(v) {
        if (isLK(v)) return renderLK(v.$k, v.$p);
        if (isFD(v)) return renderFD(v.$fd);
        if (isAR(v)) return renderAR(v);
        return v;
    }

    function renderLK(key, params) {
        if (!key) return '';
        let resolved = params;
        if (params) {
            resolved = {};
            for (const k of Object.keys(params)) resolved[k] = renderParam(params[k]);
        }
        return T(key, resolved);
    }

    // The fields an event record carries for one description. Spread in place
    // of a plain `description:` line.
    function descOf(key, params) {
        return { description: renderLK(key, params), descKey: String(key), descParams: params || null };
    }

    // The sentence for a stored record in the active language, falling back to
    // the prose a world simulated before descriptions were keyed.
    function renderRecord(rec) {
        if (!rec) return '';
        return rec.descKey ? renderLK(rec.descKey, rec.descParams) : String(rec.description || '');
    }

    // Which written-out field each kind of record rebuilds, and the key/params
    // fields it rebuilds it from: [plain, key, params].
    const LOC_FIELDS = {
        event:    [['description', 'descKey', 'descParams']],
        nation:   [['government', 'governmentKey', null], ['reason', 'reasonKey', 'reasonParams']],
        death:    [['cause', 'causeKey', 'causeParams']],
        epidemic: [['name', 'nameKey', 'nameParams']],
        // An artifact record owns a provenance list, so its pass carries on
        // into the holders underneath it.
        artifact: [['action', 'actionKey', 'actionParams']],
        holder:   [['how', 'howKey', 'howParams']],
    };

    // Rewrites the keyed fields of a list of records when the active language
    // is not the one it was last written in. The stamp lives on the array
    // object itself, so a read costs one comparison and nothing reaches the
    // world's JSON files. A record with no key keeps the prose it was saved
    // with, which is what a world simulated before this carries.
    function localizeList(list, kind) {
        if (!Array.isArray(list)) return list;
        const lang = (window.T && typeof T.language === 'function') ? T.language() : 'en';
        if (list.__i18nLang === lang) return list;
        const specs = LOC_FIELDS[kind] || LOC_FIELDS.event;
        for (const rec of list) {
            if (!rec) continue;
            for (const [plain, keyField, paramsField] of specs) {
                const key = rec[keyField];
                if (key) rec[plain] = renderLK(key, paramsField ? rec[paramsField] : null);
            }
            if (kind === 'artifact') {
                // The name too: generateArtifacts recomposes it every session.
                rec.name = renderAR(AR(rec.kind || 'item', rec.id, rec.name));
                localizeList(rec.holders, 'holder');
            }
        }
        try {
            Object.defineProperty(list, '__i18nLang',
                { value: lang, configurable: true, writable: true, enumerable: false });
        } catch (err) {
            // Sealed array: the pass simply runs again on the next read.
        }
        return list;
    }

    // Same pass over a map of records (leader deaths, artifact records).
    function localizeMap(map, kind) {
        if (!map || typeof map !== 'object') return map;
        const lang = (window.T && typeof T.language === 'function') ? T.language() : 'en';
        if (map.__i18nLang === lang) return map;
        localizeList(Object.values(map), kind);
        try {
            Object.defineProperty(map, '__i18nLang',
                { value: lang, configurable: true, writable: true, enumerable: false });
        } catch (err) { /* see localizeList */ }
        return map;
    }

    function getRandomHighMpSkill(rand) {
        const rnd = typeof rand === 'function' ? rand : Math.random;
        if (typeof $dataSkills === 'undefined' || !$dataSkills) return "PropheticDreams";
        const highMpSkills = $dataSkills.filter(s => s && s.mpCost >= 100);
        if (highMpSkills.length === 0) return "PropheticDreams";
        const skill = highMpSkills[Math.floor(rnd() * highMpSkills.length)];
        return skill.name;
    }

    //=============================================================================
    // History Manager Class
    //=============================================================================

    // Coerce any seed (number, numeric string, or a named word such as the
    // default "esoteric") into a uint32 RNG root. The simulation and every
    // downstream consumer (procgen, loot, etc.) does arithmetic on the seed, so
    // it must always be stored as a number. Reuses ProcGenUtils.normalizeSeed
    // when available so named seeds hash identically everywhere.
    function normalizeHistorySeed(value) {
        if (window.ProcGenUtils && typeof window.ProcGenUtils.normalizeSeed === "function") {
            return window.ProcGenUtils.normalizeSeed(value);
        }
        if (typeof value === "number" && isFinite(value)) return value >>> 0;
        const str = String(value == null ? "" : value);
        if (/^\d+$/.test(str)) return Number(str) >>> 0;
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }

    // Build a seeded RNG for a simulation run. Prefers NPCShared.Rng (canonical
    // xorshift32); falls back to an identical inline xorshift if NPCShared has
    // not loaded yet (load order places it after this plugin). Threading a
    // single seeded stream through the whole run is what makes "same seed, same
    // world" actually hold; raw Math.random() would break determinism.
    function makeRng(seed) {
        // Treat 0 as a valid seed: remap a 0 root to a fixed nonzero constant
        // distinct from real seed 1, so the xorshift stream never collapses and
        // seed 0 and seed 1 do not silently share a stream.
        const root = normalizeHistorySeed(seed) || 0x9E3779B9;
        if (window.NPCShared && window.NPCShared.Rng) {
            return new window.NPCShared.Rng(root);
        }
        let s = root >>> 0;
        return {
            next() {
                let x = s;
                x ^= x << 13; x >>>= 0;
                x ^= x >> 17;
                x ^= x << 5;  x >>>= 0;
                s = x;
                return x / 4294967296;
            },
            int(min, max)     { return min + Math.floor(this.next() * (max - min + 1)); },
            nextInt(min, max) { return min + Math.floor(this.next() * (max - min)); },
            pick(arr)         { return arr[Math.floor(this.next() * arr.length)]; }
        };
    }

    class HistoryManager {
        constructor() {
            this.reset();
        }

        // Current simulation RNG. Always seeded from the world seed before a run;
        // _rand() falls back to a fresh seeded stream if somehow called first.
        _rand() {
            if (!this._rng) this._rng = makeRng(this.getSeed());
            return this._rng.next();
        }

        setSeed(seed) {
            seed = normalizeHistorySeed(seed);
            this._seed = seed;
            if (window.WorldManager) {
                window.WorldManager.setField("history", "seed", seed);
            } else if ($gameSystem) {
                $gameSystem._historySeed = seed;
            }
        }

        getSeed() {
            // The world store wins: setSeed() always writes it, and it stays
            // correct when the active world changes within a session.
            if (window.WorldManager) {
                const seed = window.WorldManager.getField("history", "seed");
                if (seed !== undefined) return seed;
            }
            if (this._seed !== undefined) return this._seed;
            if (typeof $gameSystem !== "undefined" && $gameSystem && $gameSystem._historySeed !== undefined) {
                return $gameSystem._historySeed;
            }
            return 19002001; // Canon default seed
        }

        reset() {
            // Note: _seed is intentionally preserved so a seed chosen via
            // setSeed() right before runSimulation() is not lost.
            this._events = [];
            this._deadLeaders = new Set();
            this._currentLeaders = {};
            this._currentHolyLeaders = {};  // for powers with holy_leaders dual-track (e.g. Holy Vatican Empire)
            this._currentFactionLeaders = {};
            this._nationHistory = {};   // country → [{date, controller, government, reason}]
            this._artifactRecords = {}; // "kind:id" → {name, date, action, holders:[...]}
            this._leaderDeaths = {};    // leader name → {date, cause}
            this._epidemics = [];       // the century's plagues and panics

            const fdm = FactionDataManager.instance;
            const useFdm = fdm && fdm._ready;
            this._currentHyperpowers = useFdm ? JSON.parse(JSON.stringify(fdm._hyperpowers)) : JSON.parse(JSON.stringify(HYPERPOWERS));
            this._currentFactions = useFdm ? JSON.parse(JSON.stringify(fdm._historicalFactions)) : JSON.parse(JSON.stringify(FACTIONS));
            this._currentCountries = useFdm ? JSON.parse(JSON.stringify(fdm._countries)) : JSON.parse(JSON.stringify(COUNTRIES));

            // Ensure every leader has a valid years range. FactionDataManager's
            // hyperpower/faction data may omit it, which would crash the
            // active-leader filters (l.years[0]) during simulation.
            const normalizeLeaders = (collection) => {
                if (!collection) return;
                for (const key in collection) {
                    const entry = collection[key];
                    if (!entry) continue;
                    [entry.leaders, entry.holy_leaders].forEach(list => {
                        if (!Array.isArray(list)) return;
                        list.forEach((l, i) => {
                            // Unresolved entries may still be raw string keys; wrap them.
                            if (typeof l === 'string') {
                                l = list[i] = { name: l };
                            }
                            if (l && (!Array.isArray(l.years) || l.years.length < 2)) {
                                l.years = [1900, 2012];
                            }
                        });
                    });
                }
            };
            normalizeLeaders(this._currentHyperpowers);
            normalizeLeaders(this._currentFactions);
        }

        generateArtifacts() {
            if (!this._seed) this._seed = normalizeHistorySeed(this.getSeed());
            // Derive a dedicated seeded stream so artifact identity is a pure
            // function of the world seed (independent of any prior sim rolls).
            const artRng = makeRng(this._seed);
            function sRand() { return artRng.next(); }

            // Word banks per language. Italian puts the noun first and agrees the
            // adjective with it, so the feminine forms sit in their own list and
            // the nouns that need them are named in `nounGender`.
            const adjectives = T.list('History.artifactName.adjectives');
            const adjectivesFem = T.list('History.artifactName.adjectivesFem');
            const nounGender = T.obj('History.artifactName.nounGender') || {};
            const itemNouns = T.list('History.artifactName.itemNouns');
            const weaponNouns = T.list('History.artifactName.weaponNouns');
            const armorNouns = T.list('History.artifactName.armorNouns');

            const generated = { items: [], weapons: [], armors: [] };

            function createArtifact(id, nounList, isWeapon, isArmor) {
                const adjIdx = Math.floor(sRand() * adjectives.length);
                const noun = nounList[Math.floor(sRand() * nounList.length)];
                const adj = (nounGender[noun] === 'f' ? adjectivesFem[adjIdx] : null)
                    || adjectives[adjIdx];
                const obj = {
                    id: id,
                    name: T('History.artifactName.template', { adj: adj, noun: noun }),
                    description: T('History.artifactDescription'),
                    note: '<category: artifact>',
                    price: 2500000 + Math.floor(sRand() * 500000),
                    iconIndex: 245
                };
                if (isWeapon) {
                    obj.wtypeId = 1 + Math.floor(sRand() * 12);
                    obj.params = [0, 0, 150 + Math.floor(sRand()*100), 0, 150 + Math.floor(sRand()*100), 0, 0, 0];
                    obj.traits = [];
                } else if (isArmor) {
                    obj.atypeId = 1 + Math.floor(sRand() * 5);
                    obj.etypeId = 2 + Math.floor(sRand() * 3); // 2: shield, 3: head, 4: body
                    obj.params = [0, 0, 0, 150 + Math.floor(sRand()*100), 0, 150 + Math.floor(sRand()*100), 0, 0];
                    obj.traits = [];
                } else {
                    obj.itypeId = 1;
                    obj.consumable = false;
                    obj.effects = [];
                }
                return obj;
            }

            for (let i = 0; i < 13; i++) {
                generated.items.push(createArtifact(1501 + i, itemNouns, false, false));
                generated.weapons.push(createArtifact(1501 + i, weaponNouns, true, false));
                generated.armors.push(createArtifact(1501 + i, armorNouns, false, true));
            }

            if (window.WorldManager) {
                window.WorldManager.setField("artifacts", "generated", generated);
            } else if (typeof $gameSystem !== 'undefined' && $gameSystem) {
                $gameSystem._generatedArtifacts = generated;
            }
            this.injectArtifacts(generated);
        }

        injectArtifacts(generated) {
            if (!generated) return;
            if (typeof $dataItems !== 'undefined' && generated.items) {
                generated.items.forEach(a => $dataItems[a.id] = a);
            }
            if (typeof $dataWeapons !== 'undefined' && generated.weapons) {
                generated.weapons.forEach(a => $dataWeapons[a.id] = a);
            }
            if (typeof $dataArmors !== 'undefined' && generated.armors) {
                generated.armors.forEach(a => $dataArmors[a.id] = a);
            }
        }

        runSimulation(years = null) {
            this.reset();
            // Seed the deterministic stream for the whole run from the world
            // seed, so a given seed always regenerates the same history.
            this._seed = normalizeHistorySeed(this.getSeed());
            this._rng = makeRng(this._seed);
            let startYear = START_YEAR;
            let endYear = END_YEAR;
            if (years !== null && years < 100) {
                startYear = endYear - years;
            } else if (years !== null) {
                endYear = startYear + years;
            }
            this._startYear = startYear;

            this.generateArtifacts();
            this.initNationRecords(startYear);

            const artifactEvents = [];
            const generated = window.WorldManager
                ? window.WorldManager.getField("artifacts", "generated")
                : ((typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._generatedArtifacts) ? $gameSystem._generatedArtifacts : null);
            if (generated) {
                const totalMonths = (endYear - startYear + 1) * 12;
                const allArtifacts = [
                    ...(generated.items   || []).map(item => ({ kind: 'item',   item })),
                    ...(generated.weapons || []).map(item => ({ kind: 'weapon', item })),
                    ...(generated.armors  || []).map(item => ({ kind: 'armor',  item }))
                ];
                allArtifacts.forEach(({ kind, item }) => {
                    const monthOffset = Math.floor(this._rand() * totalMonths);
                    const eYear = startYear + Math.floor(monthOffset / 12);
                    const eMonth = monthOffset % 12;
                    const dateStr = `${eYear}-${String(eMonth + 1).padStart(2, '0')}`;
                    artifactEvents.push({ dateKey: dateStr, item, kind });
                });
            }

            let date = new Date(startYear, 0, 1);
            const endDate = new Date(endYear, 0, 1);

            while (date <= endDate) {
                const year = date.getFullYear();
                this.updateActiveLeaders(date);

                // Monthly check for events
                this.handleFixedEvents(date);
                this.handleEpidemics(date);
                this.handleInternalPolitics(date, false);
                this.handleInternalPolitics(date, true);
                this.handleNationPolitics(date);
                this.handleArtifactTransfers(date);

                if (this._rand() < 0.15) {
                    const event = this.generateRandomEvent(date);
                    if (event) this._events.push(event);
                }

                const dateKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const plannedArtifacts = artifactEvents.filter(e => e.dateKey === dateKey);
                plannedArtifacts.forEach(planned => {
                    const artEvent = this.generateSpecificArtifactEvent(date, planned.item, planned.kind);
                    if (artEvent) this._events.push(artEvent);
                });

                // Advance one month
                date.setMonth(date.getMonth() + 1);
            }

            this.saveToGameSystem();
            console.log(`[HistorySimulator] Simulation complete. ${this._events.length} events generated.`);
        }

        // Stable, name-seeded government label for a nation under a controller.
        governmentFor(controller, country) {
            return governmentLabel(this.governmentIdFor(controller, country));
        }

        // The same choice, left as its id so an event can store it as a key
        // descriptor instead of freezing the label at simulation time.
        governmentIdFor(controller, country) {
            if (controller && controller !== 'Neutral') {  // i18n-ignore  controller id
                return HYPERPOWER_GOVS[controller] || 'Puppet Government';  // i18n-ignore  government id
            }
            let h = 0;
            const s = String(country);
            for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
            return NEUTRAL_GOVS[h % NEUTRAL_GOVS.length];
        }

        // A government id as a nested description param: it resolves to the
        // label when the sentence is written out, and to the raw id when the
        // data files carry no copy for it.
        _govParam(id) {
            const key = this._govKey(id);
            return key ? LK(key) : String(id || '');
        }

        // The i18n key a government id reads through, or null for an id the
        // data files carry no copy for.
        _govKey(id) {
            const key = 'History.government.' + String(id || '');
            return T.has(key) ? key : null;
        }

        initNationRecords(startYear) {
            this._nationHistory = {};
            for (const [name, info] of Object.entries(this._currentCountries || {})) {
                const controller = info.controller || 'Neutral';  // i18n-ignore  controller id
                const govId = this.governmentIdFor(controller, name);
                this._nationHistory[name] = [{
                    date: `${startYear}-01`,
                    controller,
                    government: governmentLabel(govId),
                    governmentId: govId,
                    governmentKey: this._govKey(govId),
                    reason: T('History.reason.dawn'),
                    reasonKey: 'History.reason.dawn',
                    reasonParams: null
                }];
            }
        }

        // `reason` is passed as a key descriptor so the ledger re-reads in the
        // language it is opened in; a plain string is still accepted.
        recordNationChange(name, dateStr, controller, reason) {
            const recs = this._nationHistory[name] || (this._nationHistory[name] = []);
            const govId = this.governmentIdFor(controller, name);
            recs.push({
                date: dateStr, controller,
                government: governmentLabel(govId),
                governmentId: govId,
                governmentKey: this._govKey(govId),
                reason: isLK(reason) ? renderLK(reason.$k, reason.$p) : reason,
                reasonKey: isLK(reason) ? reason.$k : null,
                reasonParams: isLK(reason) ? reason.$p : null
            });
        }

        // Monthly chance that one nation changes hands: a hyperpower annexes /
        // conquers it (its government becomes the conqueror's archetype), or a
        // controlled nation wins independence and restores its own government.
        // Every change is appended to the nation's permanent government history.
        handleNationPolitics(date) {
            const nations = Object.keys(this._currentCountries || {});
            const powers = Object.keys(this._currentHyperpowers || {});
            if (!nations.length || !powers.length) return;
            if (this._rand() > 0.035) return;

            const nation = nations[Math.floor(this._rand() * nations.length)];
            const info = this._currentCountries[nation];
            const current = info.controller || 'Neutral';  // i18n-ignore  controller id
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const prevRecs = this._nationHistory[nation];
            const prevRec = prevRecs && prevRecs.length ? prevRecs[prevRecs.length - 1] : null;
            // A record written before governments were keyed keeps its label.
            const prevGov = prevRec
                ? (prevRec.governmentId ? this._govParam(prevRec.governmentId) : prevRec.government)
                : this._govParam('old order');  // i18n-ignore  government id

            if (current !== 'Neutral' && this._rand() < 0.35) {  // i18n-ignore  controller id
                info.controller = 'Neutral';  // i18n-ignore  controller id
                const gov = this._govParam(this.governmentIdFor('Neutral', nation));  // i18n-ignore  controller id
                this.recordNationChange(nation, dateStr, 'Neutral',  // i18n-ignore  controller id
                    LK('History.reason.independence', { power: current }));
                this._events.push({
                    date: dateStr, category: 'conquest', type: 'independence',
                    ...descOf('History.conquest.independence',
                        { nation: nation, power: current, prevGov: prevGov, gov: gov }),
                    iconIndex: ICONS.peace
                });
                return;
            }

            const candidates = powers.filter(p => p !== current);
            if (!candidates.length) return;
            let total = 0;
            const weights = candidates.map(p => {
                const w = Math.max(1, this._currentHyperpowers[p].military || 50);
                total += w;
                return w;
            });
            let r = this._rand() * total;
            let conqueror = candidates[0];
            for (let i = 0; i < candidates.length; i++) {
                if ((r -= weights[i]) <= 0) { conqueror = candidates[i]; break; }
            }

            info.controller = conqueror;
            const newGov = this._govParam(this.governmentIdFor(conqueror, nation));
            const neutral = current === 'Neutral';  // i18n-ignore  controller id
            const reason = neutral
                ? LK('History.reason.annexation')
                : LK('History.reason.conquest', { power: current });
            this.recordNationChange(nation, dateStr, conqueror, reason);
            this._events.push({
                date: dateStr, category: 'conquest', type: 'conquest',
                ...(neutral
                    ? descOf('History.conquest.annex',
                        { conqueror: conqueror, nation: nation, prevGov: prevGov, gov: newGov })
                    : descOf('History.conquest.wrest',
                        { conqueror: conqueror, nation: nation, power: current,
                          prevGov: prevGov, gov: newGov })),
                iconIndex: ICONS.conquest
            });
            this._currentHyperpowers[conqueror].military = (this._currentHyperpowers[conqueror].military || 100) + 5;
        }

        // --- Epidemics --------------------------------------------------------
        // The century gets its own plagues and panics, drawn from the same
        // disease library the live epidemic engine uses (Diseases.json). Each
        // one names the towns it burned through, so an NPC from one of those
        // towns can carry it in their medical record before the player ever
        // meets them (Health_DiseaseSystem._applyHistoricalEpidemics).
        _epidemicDiseases() {
            if (this._epidemicPool) return this._epidemicPool;
            let diseases = [];
            if (window.DiseaseSystem && window.DiseaseSystem.all) {
                diseases = window.DiseaseSystem.all() || [];
            }
            if (!diseases.length) {
                const data = (window.Health && window.Health.Diseases) || loadJsonFile('js/db/Health/Diseases.json');
                diseases = (data && data.diseases) || [];
            }
            this._epidemicPool = diseases.filter(d => d && d.epidemic);
            return this._epidemicPool;
        }

        // Towns people actually live in. The live engine already knows which
        // named map tiles are landmarks rather than populations, so borrow its
        // list; the raw destination keys are the fallback.
        _epidemicTowns() {
            if (this._epidemicTownList) return this._epidemicTownList;
            const ES = window.EpidemicSystem;
            if (ES && ES.places) {
                const places = ES.places().filter(p => p.isDestination).map(p => p.key);
                if (places.length) { this._epidemicTownList = places; return places; }
            }
            const dest = (window.WorkSystem && window.WorkSystem.Destinations)
                || loadJsonFile('js/db/WorkSystem/Destinations.json') || {};
            // Same exclusions the engine applies: a shrine, a gauntlet, a tavern
            // and a borehole are places on the map, not places with a population.
            const notTowns = /^(super sacred shrine|maxgauntlet|maxtavern|dark tower|petrocave|kola superdeep borehole|tritunnel (east|ovest)|abandoned shack|moonlit station)$/i;
            this._epidemicTownList = Object.keys(dest).filter(k => !notTowns.test(k));
            return this._epidemicTownList;
        }

        handleEpidemics(date) {
            // Roughly one remembered epidemic every four years.
            if (this._rand() > 0.021) return;
            const pool = this._epidemicDiseases();
            const towns = this._epidemicTowns();
            if (!pool.length || !towns.length) return;

            // A century remembers its panics as clearly as its plagues, so the
            // kind is chosen first and the strain only within it (otherwise the
            // far larger medical library would crowd hysteria out entirely).
            const wantHysteria = this._rand() < 0.42;
            let kindPool = pool.filter(d => ((d.kind || 'medical') === 'hysteria') === wantHysteria);
            if (!kindPool.length) kindPool = pool;

            // Rare strains stay rare across a whole century, too.
            const weights = { common: 6, uncommon: 3, rare: 1 };
            let total = 0;
            const w = kindPool.map(d => { const v = weights[d.rarity] || 3; total += v; return v; });
            let r = this._rand() * total;
            let disease = kindPool[kindPool.length - 1];
            for (let i = 0; i < kindPool.length; i++) {
                if ((r -= w[i]) <= 0) { disease = kindPool[i]; break; }
            }

            const hysteria = (disease.kind || 'medical') === 'hysteria';
            // Towns are recorded by their Destinations.json key (that is what
            // the epidemic ledger matches on); the chronicle names them the way
            // that entry reads.
            const townName = key => (window.WorkSystem && window.WorkSystem.destinationName)
                ? window.WorkSystem.destinationName(key) : key;
            const origin = towns[Math.floor(this._rand() * towns.length)];
            const reach = 1 + Math.floor(this._rand() * (hysteria ? 5 : 7));
            const places = [origin];
            for (let i = 1; i < reach; i++) {
                const town = towns[Math.floor(this._rand() * towns.length)];
                if (!places.includes(town)) places.push(town);
            }

            const months = 1 + Math.floor(this._rand() * (hysteria ? 8 : 14));
            const end = new Date(date.getFullYear(), date.getMonth() + months, 1);
            const infected = Math.round((900 + this._rand() * 26000) * places.length *
                (disease.r0 > 4 ? 1.8 : 1));
            const deaths = Math.round(infected * (disease.cfr || 0) * (0.35 + this._rand() * 0.5));
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
            const nameKey = hysteria ? 'History.epidemic.hysteriaName' : 'History.epidemic.medicalName';
            const nameParams = { disease: disease.name, origin: townName(origin), year: date.getFullYear() };

            this._epidemics.push({
                id: `HEP-${this._epidemics.length + 1}`,
                name: T(nameKey, nameParams), nameKey, nameParams,
                diseaseId: disease.id, diseaseName: disease.name,
                kind: hysteria ? 'hysteria' : 'medical',
                origin, places, startDate: dateStr, endDate: endStr,
                months, infected, deaths, historical: true,
            });

            const spread = places.length > 1
                ? LK('History.epidemic.spread', { places: places.slice(1).map(townName).join(', ') })
                : '';
            // Thousands separators written explicitly: toLocaleString would
            // follow the host locale and print "162.610" on half the machines.
            const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            this._events.push({
                date: dateStr,
                category: 'epidemic',
                type: hysteria ? 'mass hysteria' : 'epidemic',  // i18n-ignore  event type ids
                ...descOf(hysteria ? 'History.epidemic.hysteria' : 'History.epidemic.medical',
                    { disease: disease.name, origin: townName(origin), infected: num(infected),
                      deaths: num(deaths), months: months, spread: spread }),
                iconIndex: hysteria ? ICONS.paranormal : ICONS.epidemic
            });
        }

        // Already-discovered artifacts occasionally change hands; every holder
        // is appended to the artifact's permanent provenance record.
        handleArtifactTransfers(date) {
            for (const rec of Object.values(this._artifactRecords)) {
                if (this._rand() > 0.002) continue;
                const isFaction = this._rand() < 0.5;
                const pool = isFaction ? this._currentFactionLeaders : this._currentLeaders;
                const actors = Object.keys(pool).filter(a => pool[a]);
                if (!actors.length) continue;
                const actor = actors[Math.floor(this._rand() * actors.length)];
                const holderName = pool[actor] ? pool[actor].name : actor;
                const last = rec.holders[rec.holders.length - 1];
                if (last && last.holder === holderName) continue;
                const action = ARTIFACT_TRANSFER_ACTIONS[Math.floor(this._rand() * ARTIFACT_TRANSFER_ACTIONS.length)];
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const howKey = 'History.artifact.action.' + action;
                rec.holders.push({ holder: holderName, power: actor, since: dateStr,
                    how: T(howKey), howKey, howParams: null });
                this._events.push({
                    date: dateStr, category: 'paranormal', type: 'artifact',
                    ...descOf('History.artifact.transfer', {
                        holder: holderName,
                        action: LK('History.artifact.action.' + action),
                        artifact: AR(rec.kind, rec.id, rec.name),
                        from: last ? LK('History.artifact.from', { holder: last.holder }) : ''
                    }),
                    iconIndex: 245
                });
            }
        }

        // `cause` is a key descriptor so a leader's obituary re-reads in the
        // language the world is opened in; a plain string is still accepted.
        _markLeaderDead(name, date, cause) {
            this._leaderDeaths[name] = {
                date: date.toISOString().split('T')[0],
                cause: isLK(cause) ? renderLK(cause.$k, cause.$p) : (cause || null),
                causeKey: isLK(cause) ? cause.$k : null,
                causeParams: isLK(cause) ? cause.$p : null
            };
        }

        updateActiveLeaders(date) {
            const year = date.getFullYear();
            const month = date.getMonth();
            for (let power in this._currentHyperpowers) {
                const hp = this._currentHyperpowers[power];
                // Political leaders
                const available = (hp.leaders || []).filter(l => {
                    if (power === 'Goblin Horde' && (year < 1970 || (year === 1970 && month < 4))) {  // i18n-ignore  hyperpower id
                        return false;
                    }
                    return year >= l.years[0] && year <= l.years[1] && !this._deadLeaders.has(l.name);
                });
                if (!this._currentLeaders[power] || !available.includes(this._currentLeaders[power])) {
                    this._currentLeaders[power] = available[0] || null;
                }
                // Holy leaders (dual-track system, e.g. Holy Vatican Empire)
                if (hp.holy_leaders) {
                    const holyAvail = hp.holy_leaders.filter(l =>
                        year >= l.years[0] && year <= l.years[1] && !this._deadLeaders.has(l.name)
                    );
                    if (!this._currentHolyLeaders[power] || !holyAvail.includes(this._currentHolyLeaders[power])) {
                        if (year < 1978) {
                            // Before 1978: randomize papacy duration, pick randomly from available
                            // and add inertia so leaders can serve variable lengths
                            if (!this._currentHolyLeaders[power]) {
                                this._currentHolyLeaders[power] = holyAvail.length > 0 ? holyAvail[Math.floor(this._rand() * holyAvail.length)] : null;
                            } else if (holyAvail.length > 0 && this._rand() < 0.1) {
                                // 10% chance per year of a transition (simulating variable-length papacies)
                                const withoutCurrent = holyAvail.filter(l => l.name !== this._currentHolyLeaders[power].name);
                                if (withoutCurrent.length > 0 && this._rand() < 0.5) {
                                    this._currentHolyLeaders[power] = withoutCurrent[Math.floor(this._rand() * withoutCurrent.length)];
                                }
                            }
                        } else {
                            this._currentHolyLeaders[power] = holyAvail[0] || null;
                        }
                    }
                }
            }
            for (let faction in this._currentFactions) {
                const available = this._currentFactions[faction].leaders.filter(l =>
                    year >= l.years[0] && year <= l.years[1] && !this._deadLeaders.has(l.name)
                );
                if (!this._currentFactionLeaders[faction] || !available.includes(this._currentFactionLeaders[faction])) {
                    this._currentFactionLeaders[faction] = available[0] || null;
                }
            }
        }

        handleFixedEvents(date) {
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const fixed = this.getFixedEvent(dateStr);
            if (fixed) {
                this._events.push({
                    date: dateStr,
                    category: fixed.type,
                    type: 'fixed',
                    // The copy the player reads is keyed by the date itself, so
                    // the record needs nothing beyond it.
                    ...descOf('History.fixed.' + dateStr, null),
                    iconIndex: ICONS[fixed.type] || 0
                });
                if (fixed.callback) {
                    // Fixed-event callbacks hardcode canonical power/faction names
                    // (e.g. 'Soviet Union'). Alternate datasets (FactionDataManager)
                    // may not contain those keys, so a missing entry must skip the
                    // flavor stat-tweak rather than abort the whole simulation.
                    try {
                        fixed.callback(this);
                    } catch (e) {
                        console.warn(`[HistorySimulator] Fixed event ${dateStr} callback skipped:`, e.message);
                    }
                }
            }
        }

        getFixedEvent(dateStr) {
            // i18n-ignore-start  hyperpower, faction and leader ids. A fixed
            // event carries no copy of its own: the line the player reads is
            // History.fixed.<yyyy-mm>, keyed by the date handleFixedEvents
            // looked it up with.
            const events = {
                '1914-07': {
                    type: 'military',
                    callback: (mgr) => { for (let h in mgr._currentHyperpowers) mgr._currentHyperpowers[h].military += 30; }
                },
                '1917-10': {
                    type: 'political',
                    callback: (mgr) => {
                        mgr._currentHyperpowers['Soviet Union'].military += 50;
                        mgr._currentFactions['Archive Foundation'].information += 40;
                    }
                },
                '1918-11': {
                    type: 'peace',
                    callback: (mgr) => { mgr._currentHyperpowers['Ottoman Empire'].economy -= 20; }
                },
                '1939-09': {
                    type: 'military',
                    callback: (mgr) => { mgr._currentHyperpowers['Britannia'].military += 100; }
                },
                '1945-05': {
                    type: 'peace',
                    callback: (mgr) => {
                        mgr._currentHyperpowers['Soviet Union'].economy += 50;
                        mgr._currentHyperpowers['Britannia'].economy += 50;
                    }
                },
                '1970-05': {
                    type: 'paranormal',
                    callback: (mgr) => { mgr._currentHyperpowers['Goblin Horde'].military += 200; }
                },
                '1978-10': {
                    type: 'political',
                    callback: (mgr) => {
                        const hps = mgr._currentHyperpowers;
                        const hve = hps['Holy Vatican Empire'];
                        if (hve && hve.holy_leaders) {
                            const jp2 = hve.holy_leaders.find(l => l.name === 'Pope John Paul II');
                            if (jp2) {
                                mgr._currentHolyLeaders['Holy Vatican Empire'] = jp2;
                            }
                        }
                    }
                },
                '1981-05': {
                    type: 'political',
                    callback: (mgr) => {
                        const hps = mgr._currentHyperpowers;
                        const hve = hps['Holy Vatican Empire'];
                        if (hve && hve.holy_leaders) {
                            const petrus = hve.holy_leaders.find(l => l.name === 'Pope Petrus II');
                            if (petrus) {
                                mgr._currentHolyLeaders['Holy Vatican Empire'] = petrus;
                            }
                        }
                    }
                },
                '1992-01': {
                    type: 'paranormal',
                    callback: (mgr) => { for (let f in mgr._currentFactions) mgr._currentFactions[f].arcane += 10; }
                },
                '2001-09': {
                    type: 'military',
                    callback: (mgr) => {
                        mgr._currentHyperpowers['Britannia'].information += 80;
                        for (let f in mgr._currentFactions) mgr._currentFactions[f].information *= 0.7;
                    }
                }
            };
            // i18n-ignore-end
            return events[dateStr];
        }

        handleInternalPolitics(date, isFaction) {
            const year = date.getFullYear();
            const actors = isFaction ? this._currentFactions : this._currentHyperpowers;
            const currentActors = isFaction ? this._currentFactionLeaders : this._currentLeaders;
            const actorNames = Object.keys(actors);

            actorNames.forEach(actor => {
                if (this._rand() > 0.02) return; // Rare check

                const available = (isFaction ? this._currentFactions[actor] : this._currentHyperpowers[actor]).leaders.filter(l =>
                    year >= l.years[0] && year <= l.years[1] && !this._deadLeaders.has(l.name)
                );

                if (available.length > 1) {
                    const active = currentActors[actor];
                    if (!active) return;
                    const rivals = available.filter(l => l.name !== active.name);
                    const rival = rivals[Math.floor(this._rand() * rivals.length)];
                    if (!rival) return;

                    const struggleType = ['election', 'coup', 'assassination', 'alliance'][Math.floor(this._rand() * 4)];
                    let outcome = null;

                    switch (struggleType) {
                        case 'election':
                            if (this._rand() > 0.5) {
                                currentActors[actor] = rival;
                                outcome = LK('History.internal.electionWin',
                                    { winner: rival.name, place: actor, loser: active.name });
                            } else {
                                outcome = LK('History.internal.electionHold',
                                    { leader: active.name, place: actor });
                            }
                            break;
                        case 'coup':
                            if (this._rand() > 0.4) {
                                currentActors[actor] = rival;
                                outcome = LK('History.internal.coupWin',
                                    { winner: rival.name, place: actor, loser: active.name });
                            } else {
                                outcome = LK('History.internal.coupFail',
                                    { rival: rival.name, place: actor });
                            }
                            break;
                        case 'assassination':
                            if (this._rand() > 0.7) {
                                if (active.protected) {
                                    outcome = LK('History.internal.plotFailedOddly',
                                        { leader: active.name, place: actor });
                                } else {
                                    this._deadLeaders.add(active.name);
                                    this._markLeaderDead(active.name, date,
                                        LK('History.leaderDeath.assassinated', { place: actor }));
                                    currentActors[actor] = rival;
                                    outcome = LK('History.internal.assassinated',
                                        { leader: active.name, rival: rival.name, place: actor });
                                }
                            } else {
                                if (rival.protected) {
                                    outcome = LK('History.internal.plotFailedEscape',
                                        { leader: active.name, place: actor, rival: rival.name });
                                } else {
                                    this._deadLeaders.add(rival.name);
                                    this._markLeaderDead(rival.name, date,
                                        LK('History.leaderDeath.executed', { place: actor }));
                                    outcome = LK('History.internal.plotFailedExecuted',
                                        { leader: active.name, rival: rival.name });
                                }
                            }
                            break;
                        case 'alliance':
                            outcome = LK('History.internal.alliance',
                                { leader: active.name, rival: rival.name, place: actor });
                            break;
                    }

                    if (outcome) {
                        this._events.push({
                            date: date.toISOString().split('T')[0],
                            category: 'internal',
                            type: struggleType,
                            ...descOf(outcome.$k, outcome.$p),
                            iconIndex: ICONS['internal'] || 0
                        });
                    }
                }
            });
        }

        // Weighted category draw (see CATEGORY_WEIGHTS); falls back to a flat
        // draw if a category ever loses its weight entry.
        pickCategory() {
            const names = Object.keys(EVENT_TYPES);
            let total = 0;
            const weights = names.map(n => {
                const w = CATEGORY_WEIGHTS[n] || 1;
                total += w;
                return w;
            });
            let r = this._rand() * total;
            for (let i = 0; i < names.length; i++) {
                if ((r -= weights[i]) <= 0) return names[i];
            }
            return names[names.length - 1];
        }

        generateRandomEvent(date) {
            const year = date.getFullYear();
            const category = this.pickCategory();
            const type = EVENT_TYPES[category][Math.floor(this._rand() * EVENT_TYPES[category].length)];

            // Anything arcane is a faction affair; the mundane strands are
            // mostly state business.
            const isFaction = category === 'paranormal' || category === 'occult' || this._rand() < 0.3;
            const actorPool = isFaction ? Object.keys(this._currentFactions) : Object.keys(this._currentHyperpowers);
            const actor = actorPool[Math.floor(this._rand() * actorPool.length)];
            const leader = isFaction ? this._currentFactionLeaders[actor] : this._currentLeaders[actor];

            if (!leader) return null;

            const desc = this.getEventDescriptor(category, type, actor, leader, year);
            const results = this.applyEffects(actor, isFaction, type);

            return {
                date: date.toISOString().split('T')[0],
                category: category,
                type: type,
                ...descOf(desc.$k, desc.$p),
                results: results,
                iconIndex: ICONS[category] || 0
            };
        }

        // Which line the event is told with, and the params to tell it with,
        // left unresolved so the record can be re-read in any language. The
        // copy lives in js/i18n/<lang>/plugins/History.json under `event.basic`
        // and `event.weird`, keyed by the same category and type ids the event
        // record stores. The draws made here are unchanged, so a seed still
        // writes the same century.
        getEventDescriptor(category, type, actor, leader, year) {
            const rawIdeology = leader.ideology || leader.personality;
            // FactionDataManager.t returns the path verbatim when it has no
            // entry, so the placeholder needs resolving here rather than there.
            const ideology = rawIdeology === 'Unknown'   // i18n-ignore: placeholder ideology id
                ? LK('History.leader.unknownIdeology')
                : FD(rawIdeology);
            // The placeholder leader keeps its English id in the record (it is
            // matched by exportProperNouns), so its label resolves here.
            const leaderName = leader.name === 'Unknown Leader'   // i18n-ignore: placeholder leader id
                ? LK('History.leader.unknown')
                : leader.name;
            const params = { actor: actor, leader: leaderName, ideology: ideology };

            const weirdKey = 'History.event.weird.' + category + '.' + type;
            const basicKey = 'History.event.basic.' + category + '.' + type;
            let key = 'History.event.generic';
            let p = { type: type, actor: actor };
            if (year >= 1992 && T.has(weirdKey) && this._rand() < 0.4) {
                key = weirdKey; p = params;
            } else if (T.has(basicKey)) {
                key = basicKey; p = params;
            }

            // `skill` stays lazy: rolling it up front would consume one extra
            // number from the seeded RNG on every event and rewrite the history
            // of every existing world. Once rolled it is stored as a param, so
            // re-reading the record never rolls again.
            if (renderLK(key, p).indexOf('{skill}') >= 0) {
                p = Object.assign({}, p, { skill: getRandomHighMpSkill(this._rand.bind(this)) });
            }
            return LK(key, p);
        }

        // The finished sentence, for anything that wants text rather than a
        // record. The event log itself stores the descriptor.
        getEventDescription(category, type, actor, leader, year) {
            const d = this.getEventDescriptor(category, type, actor, leader, year);
            return renderLK(d.$k, d.$p);
        }

        applyEffects(actor, isFaction, type) {
            const stats = isFaction ? this._currentFactions[actor] : this._currentHyperpowers[actor];
            if (!stats) return "";

            const results = [];
            // Hyperpowers and factions carry different stat sets (no 'tech' on a
            // hyperpower, no 'economy'/'population' on a faction), so only touch
            // fields the actor actually has, or the value turns into NaN.
            const scale = (key, factor, label) => {
                if (typeof stats[key] !== 'number') return;
                stats[key] *= factor;
                results.push(label);
            };
            const add = (key, amount, label) => {
                if (typeof stats[key] !== 'number') return;
                stats[key] += amount;
                results.push(label);
            };
            const is = group => EFFECT_TYPES[group].indexOf(type) >= 0;

            if (is('ecoCrash'))     scale('economy', 0.8, T('History.effect.ecoCrash'));
            if (is('ecoBoom'))      scale('economy', 1.15, T('History.effect.ecoBoom'));
            if (is('popLoss'))      scale('population', 0.95, T('History.effect.popLoss'));
            if (is('ecoDamage'))    scale('economy', 0.93, T('History.effect.ecoDamage'));
            if (is('infoGain'))     add('information', 20, T('History.effect.infoGain'));
            if (is('techGain'))     add('tech', 20, T('History.effect.techGain'));
            if (is('arcaneGain'))   add('arcane', 10, T('History.effect.arcaneGain'));
            if (is('militaryGain')) add('military', 10, T('History.effect.militaryGain'));

            if (typeof stats.arcane === 'number') stats.arcane += 2;
            if (typeof stats.population === 'number') stats.population *= 1.0001;

            return results.join(', ');
        }

        saveToGameSystem() {
            // The history lives in the active world folder (history.json), not
            // in the binary savegame. WorldManager keeps a session-only scratch
            // store when no world is active.
            if (window.WorldManager) {
                const WM = window.WorldManager;
                WM.setField("history", "events", this._events);
                WM.setField("history", "hyperpowers", this._currentHyperpowers);
                WM.setField("history", "factions", this._currentFactions);
                WM.setField("history", "deadLeaders", Array.from(this._deadLeaders));
                WM.setField("history", "startYear", this._startYear || START_YEAR);
                WM.setField("history", "countries", this._currentCountries);
                WM.setField("history", "nationHistory", this._nationHistory);
                WM.setField("history", "artifactRecords", this._artifactRecords);
                WM.setField("history", "leaderDeaths", this._leaderDeaths);
                WM.setField("history", "holyLeaders", this._currentHolyLeaders);
                WM.setField("history", "epidemics", this._epidemics);
                if (this._seed !== undefined) {
                    WM.setField("history", "seed", this._seed);
                }
                WM.flush();
            } else if ($gameSystem) {
                // Keep this fallback branch symmetric with the WorldManager
                // branch above: persist every key readers may consult so a
                // WM-absent save/reload does not silently lose history.
                $gameSystem._historicalEvents = this._events;
                $gameSystem._historicalHyperpowers = this._currentHyperpowers;
                $gameSystem._historicalFactions = this._currentFactions;
                $gameSystem._historicalDeadLeaders = Array.from(this._deadLeaders);
                $gameSystem._historicalStartYear = this._startYear || START_YEAR;
                $gameSystem._historicalCountries = this._currentCountries;
                $gameSystem._historicalNationHistory = this._nationHistory;
                $gameSystem._historicalArtifactRecords = this._artifactRecords;
                $gameSystem._historicalLeaderDeaths = this._leaderDeaths;
                $gameSystem._historicalHolyLeaders = this._currentHolyLeaders;
                $gameSystem._historicalEpidemics = this._epidemics;
                if (this._seed !== undefined) {
                    $gameSystem._historySeed = this._seed;
                }
            }
        }

        // --- Wiki / lookup API ------------------------------------------------
        // All readers prefer the active world's history.json (WorldManager) and
        // fall back to the in-memory simulation state.

        _histField(prop, fallback) {
            if (window.WorldManager) {
                const v = window.WorldManager.getField("history", prop);
                if (v !== undefined) return v;
            } else if ($gameSystem) {
                // WM-absent fallback: read the mirrored $gameSystem fields that
                // saveToGameSystem persists, so saved history stays readable.
                const map = {
                    events: "_historicalEvents",
                    hyperpowers: "_historicalHyperpowers",
                    factions: "_historicalFactions",
                    deadLeaders: "_historicalDeadLeaders",
                    startYear: "_historicalStartYear",
                    countries: "_historicalCountries",
                    nationHistory: "_historicalNationHistory",
                    artifactRecords: "_historicalArtifactRecords",
                    leaderDeaths: "_historicalLeaderDeaths",
                    holyLeaders: "_historicalHolyLeaders",
                    epidemics: "_historicalEpidemics",
                    seed: "_historySeed"
                };
                const key = map[prop];
                if (key && $gameSystem[key] !== undefined) return $gameSystem[key];
            }
            return fallback;
        }

        // Every epidemic and mass hysteria the century recorded, newest last.
        getEpidemics() {
            return localizeList(this._histField("epidemics", this._epidemics) || [], 'epidemic');
        }

        // The ones that reached a given town, for a person's medical record.
        getEpidemicsAt(town) {
            const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const key = norm(town);
            return this.getEpidemics().filter(e => (e.places || []).some(p => norm(p) === key));
        }

        getNationsState() {
            return this._histField("countries", this._currentCountries) || {};
        }

        getNationState(country) {
            return this.getNationsState()[country] || null;
        }

        getNationHistory(country) {
            const all = this._histField("nationHistory", this._nationHistory) || {};
            return localizeList(all[country] || [], 'nation');
        }

        getArtifactRecords() {
            return localizeMap(this._histField("artifactRecords", this._artifactRecords) || {}, 'artifact');
        }

        getArtifactRecord(key) {
            return this.getArtifactRecords()[key] || null;
        }

        getLeaderDeaths() {
            return localizeMap(this._histField("leaderDeaths", this._leaderDeaths) || {}, 'death');
        }

        getDeadLeaders() {
            const v = this._histField("deadLeaders", Array.from(this._deadLeaders || []));
            return Array.isArray(v) ? v : [];
        }

        getHyperpowers() {
            return this._histField("hyperpowers", this._currentHyperpowers) || {};
        }

        getHistoricalFactions() {
            return this._histField("factions", this._currentFactions) || {};
        }

        // Every event, with its keyed descriptions written out in the language
        // the game is being played in right now.
        getEvents() {
            const v = this._histField("events", this._events);
            return Array.isArray(v) ? localizeList(v, 'event') : [];
        }

        // The sentence a stored record reads as, for anything holding a
        // snapshot of an event rather than the event itself.
        describeRecord(rec) {
            return renderRecord(rec);
        }

        getEventsAbout(name, limit = 20) {
            const needle = String(name || "");
            if (!needle) return [];
            return this.getEvents()
                .filter(e => e && typeof e.description === "string" && e.description.includes(needle))
                .slice(-limit);
        }

        generateSpecificArtifactEvent(date, item, kind) {
            const isFaction = this._rand() < 0.5;
            const actorPool = isFaction ? Object.keys(this._currentFactions) : Object.keys(this._currentHyperpowers);
            if (actorPool.length === 0) return null;
            const actor = actorPool[Math.floor(this._rand() * actorPool.length)];
            const leader = isFaction ? this._currentFactionLeaders[actor] : this._currentLeaders[actor];

            const actorName = leader ? leader.name : actor;

            const actions = ['discovered', 'crafted', 'exhumed', 'stole'];
            const action = actions[Math.floor(this._rand() * actions.length)];

            let actionLK;
            if (action === 'stole') {
                const targets = actorPool.filter(a => a !== actor);
                if (targets.length > 0) {
                    const target = targets[Math.floor(this._rand() * targets.length)];
                    const targetLeader = isFaction ? this._currentFactionLeaders[target] : this._currentLeaders[target];
                    const targetName = targetLeader ? targetLeader.name : target;
                    actionLK = LK('History.artifact.stoleFrom', { holder: targetName });
                } else {
                    actionLK = LK('History.artifact.discovered');
                }
            } else {
                actionLK = LK('History.artifact.action.' + action);
            }
            const actionStr = renderLK(actionLK.$k, actionLK.$p);

            const dateStr = date.toISOString().split('T')[0];

            if (kind) {
                this._artifactRecords[`${kind}:${item.id}`] = {
                    id: item.id, kind, name: item.name,
                    date: dateStr, action: actionStr,
                    actionKey: actionLK.$k, actionParams: actionLK.$p,
                    origin: actorName, originPower: actor,
                    holders: [{ holder: actorName, power: actor, since: dateStr, how: actionStr,
                                howKey: actionLK.$k, howParams: actionLK.$p }]
                };
            }

            return {
                date: dateStr,
                category: 'paranormal',
                type: 'artifact',
                ...descOf('History.artifact.found',
                    { holder: actorName, action: actionLK, artifact: AR(kind || 'item', item.id, item.name) }),
                iconIndex: 245
            };
        }

        getHistoricalFact(year = 0) {
            const all = this.getEvents();
            if (!all || all.length === 0) return T('History.log.blank');

            // The NPC life log (addMinorEvent) shares this array; it is gossip,
            // not history, so it never counts as a historical fact.
            const events = all.filter(e => e && e.type !== 'npc_life' && !/^\s*\[/.test(String(e.description || "")));
            if (events.length === 0) return T('History.log.blank');

            let pool = events;
            if (year > 0) {
                pool = events.filter(e => String(e.date || "").startsWith(String(year)));
            }
            if (pool.length === 0) return T('History.log.noEra');

            const event = pool[Math.floor(Math.random() * pool.length)];
            return T('History.log.fact', { date: event.date, description: event.description });
        }
    }

    // NPCSimulationCore hook, appends NPC world events into the history log
    HistoryManager.prototype.addMinorEvent = function ({ date, actor, desc }) {
      let events = this._events;
      if (window.WorldManager) {
        events = window.WorldManager.getField("history", "events");
        if (!events) {
          events = [];
          window.WorldManager.setField("history", "events", events);
        }
      }
      if (!events) return;
      events.push({
        date: String(date || "?"),
        category: "social",
        type: "npc_life",
        description: `[${actor}] ${desc}`,
        results: [],
        icon: "",
      });
      // Keep log bounded (max 5000 entries)
      if (events.length > 5000) events.shift();
    };

    // Initializes the active world's history according to the given options
    // ({canon: true} or {years: 10|50|100, seed}) and marks the world as
    // initialized so it only ever happens once per world.
    HistoryManager.prototype.initializeWorldHistory = function (options = {}) {
        const WM = window.WorldManager;
        if (!WM || !WM.activeWorldName) return;
        const info = WM.worldInfo();
        const canon = options.canon === true;
        // Non-canon worlds derive their seed deterministically from the world
        // name (not Math.random), so "same world, same history" holds and a
        // world regenerates identically. Canon always uses the fixed seed.
        const seed = options.seed !== undefined
            ? options.seed
            : (canon ? 19002001 : normalizeHistorySeed(WM.activeWorldName));
        this.setSeed(seed);
        if (canon) {
            this.generateArtifacts();
        } else {
            this.runSimulation(options.years || null);
        }
        info.seed = seed;
        info.historyYears = canon ? null : (options.years || null);
        info.historyInitialized = true;
        info.historyKeyed = true;
        WM.flush();
        console.log(`[HistorySimulator] World '${WM.activeWorldName}' history initialized (${canon ? "canon" : (options.years ? options.years + " years" : "full timeline")}, seed ${seed}).`);
    };

    // A world simulated before descriptions carried their i18n key froze its
    // timeline in the language it was generated in, which is what made an
    // Italian NPC bio quote an English coup. The century is deterministic in
    // the world's seed, so it is re-run once: the same events come back, this
    // time carrying the keys that let them be read in any language. The NPC
    // life log the same array collects (addMinorEvent) is gossip, not
    // simulation output, so it is carried across rather than regenerated.
    HistoryManager.prototype.migrateKeyedHistory = function () {
        const WM = window.WorldManager;
        if (!WM || !WM.activeWorldName) return false;
        const info = WM.worldInfo();
        if (!info.historyInitialized || info.historyKeyed) return false;

        const events = WM.getField("history", "events");
        const simulated = Array.isArray(events)
            ? events.filter(e => e && e.type !== "npc_life")
            : [];
        // Nothing to re-key: an empty or already keyed timeline just gets the
        // flag so this never runs again.
        if (simulated.length && !simulated.some(e => e.descKey)) {
            const gossip = events.filter(e => e && e.type === "npc_life");
            console.log(`[HistorySimulator] Re-running world '${WM.activeWorldName}' history to key its descriptions for translation.`);
            this.setSeed(info.seed !== undefined ? info.seed : normalizeHistorySeed(WM.activeWorldName));
            this.runSimulation(info.historyYears || null);
            if (gossip.length) {
                const merged = WM.getField("history", "events");
                if (Array.isArray(merged)) merged.push(...gossip);
            }
        }
        info.historyKeyed = true;
        WM.flush();
        return true;
    };

    // Initialize global manager
    const manager = new HistoryManager();
    window.HistoryManager = manager;
    window.HistorySimulator_COUNTRIES = COUNTRIES;
    window.HistorySimulator_ICONS     = ICONS;

    // Proper nouns that must stay capitalized wherever history text is reflowed
    // (e.g. NPC bio generation): country names, hyperpower/controller names,
    // faction names, and every leader / holy-leader name.
    (function exportProperNouns() {
        const nouns = new Set();
        for (const [country, info] of Object.entries(COUNTRIES)) {
            nouns.add(country);
            if (info.controller && info.controller !== 'Neutral') nouns.add(info.controller);  // i18n-ignore  controller id
        }
        const addLeaders = (group) => {
            for (const data of Object.values(group)) {
                (data.leaders || []).forEach(l => l && l.name && nouns.add(l.name));
                (data.holy_leaders || []).forEach(l => l && l.name && nouns.add(l.name));
            }
        };
        for (const name of Object.keys(HYPERPOWERS)) nouns.add(name);
        for (const name of Object.keys(FACTIONS)) nouns.add(name);
        addLeaders(HYPERPOWERS);
        addLeaders(FACTIONS);
        nouns.delete('Neutral');  // i18n-ignore  controller id
        nouns.delete('Unknown Leader');  // i18n-ignore  placeholder leader id
        window.HistorySimulator_PROPER_NOUNS = Array.from(nouns).filter(Boolean);
    })();

    //=============================================================================
    // Plugin Commands
    //=============================================================================

    PluginManager.registerCommand(pluginName, "runSimulation", async args => {
        const years = args.years ? Number(args.years) : null;
        if (FactionDataManager.instance && FactionDataManager.instance._readyPromise) {
            await FactionDataManager.instance._readyPromise;
        }
        manager.runSimulation(years);
    });

    PluginManager.registerCommand(pluginName, "getHistoricalFact", args => {
        const varId = Number(args.variableId);
        const year = Number(args.year);
        const fact = manager.getHistoricalFact(year);
        $gameVariables.setValue(varId, fact);
    });

    PluginManager.registerCommand(pluginName, "showHistoryLog", args => {
        SceneManager.push(window.Scene_History);
    });

    //=============================================================================
    // Integration with Game System
    //=============================================================================

    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        _DataManager_setupNewGame.call(this);
        if (AUTO_RUN) {
            // manager.runSimulation();
            console.log("[HistorySimulator] Auto-run delayed. Call 'Run Simulation' plugin command when ready.");
        }
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _DataManager_extractSaveContents.call(this, contents);
        if (typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._generatedArtifacts) {
            manager.injectArtifacts($gameSystem._generatedArtifacts);
        }
    };

    // World initialization step: the century has to exist before anything else
    // a world owns, since the seed it fixes is what every other generator
    // derives from. Runs first (order 0) and is a no-op when the world screen
    // (or the boot hook below) already simulated it.
    if (window.WorldManager && window.WorldManager.registerWorldInitializer) {
        window.WorldManager.registerWorldInitializer("history", 0, () => {
            const info = window.WorldManager.worldInfo();
            if (info.historyInitialized) { manager.migrateKeyedHistory(); return; }
            manager.initializeWorldHistory({ years: info.historyYears || null, seed: info.seed });
        });
    }

    const _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
    DataManager.isDatabaseLoaded = function() {
        if (!_DataManager_isDatabaseLoaded.call(this)) return false;
        if (!this._historySimulatorArtifactsGenerated) {
            this._historySimulatorArtifactsGenerated = true;
            const WM = window.WorldManager;
            if (WM && WM.activeWorldName) {
                const info = WM.worldInfo();
                if (!info.historyInitialized) {
                    // Uninitialized world (e.g. the default world WorldManager
                    // creates on an empty world folder): generate history now.
                    manager.initializeWorldHistory({ years: null, seed: info.seed });
                } else {
                    manager.migrateKeyedHistory();
                    const generated = WM.getField("artifacts", "generated");
                    if (generated) {
                        manager.injectArtifacts(generated);
                    } else {
                        manager.generateArtifacts();
                        WM.flush();
                    }
                }
            } else {
                // No world active: generate canon artifacts so they are
                // available in sandbox sessions without a simulation run.
                const tempSeed = manager._seed;
                manager._seed = 19002001; // Canon seed
                manager.generateArtifacts();
                manager._seed = tempSeed;
            }
        }
        return true;
    };

})();
