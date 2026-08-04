//=============================================================================
// WorldManager.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Dwarf Fortress-style world folders: world history, NPC status, artifacts, dungeon layout and public state live in per-world JSON files; savegames stay minimal.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @param timeVariableId
 * @text Game Time Variable ID
 * @desc Variable holding total elapsed game minutes (TimeDateSystem). The world clock is the max value reached by any save.
 * @type variable
 * @default 114
 *
 * @param sharedVariables
 * @text World-Shared Variable IDs
 * @desc Comma-separated variable ids shared by every savegame of a world (stored in variables.json). Seeds each world's manifest.
 * @type string
 * @default 2,53,61,113,114
 *
 * @param privateSwitches
 * @text Per-Save (Private) Switch IDs
 * @desc Comma-separated switch ids that stay per-savegame. Switches are world-shared by default; list exceptions here.
 * @type string
 * @default
 *
 * @help
 * WorldManager.js
 * ============================================================================
 * Implements a Dwarf Fortress-style "world folder" save layout:
 *
 *   save/worlds/<WorldName>/
 *     world.json      - world info (name, seed, world clock, timestamps)
 *     history.json    - generated world history (events, hyperpowers, the
 *                       century's epidemics, ...)
 *     artifacts.json  - generated artifact items/weapons/armors
 *     npcs.json       - NPC society / status / factions for the NPC systems,
 *                       plus the outbreaks currently burning (EpidemicSystem)
 *     dungeon.json    - generated dungeon structure (DungeonFloorSystem)
 *     conversations.json - NPC↔NPC dialogue log (NPCConversation, last 20 per NPC)
 *     state.json      - public switches shared by the world
 *     variables.json  - world-shared game variables (manifest + values)
 *     market.json     - world-shared market prices (stock history, ...)
 *     terrain.json    - procedural-map terrain the players changed (dismantled
 *                       features, lit torches)
 *     plants.json     - procedural-map crop plots (PlantGrowthSystem)
 *     saves/          - binary savegames (file0..N, global, fog_*, ...)
 *
 * - $gameSystem world-scoped fields (_historical*, _npc*, _dungeon*, etc.)
 *   are redirected to the world files through prototype accessors, so they
 *   never get serialized into the binary savegame.
 * - Switches are PUBLIC (world-shared, stored in state.json) by default. A
 *   switch id listed in WORLD_PRIVATE_SWITCHES stays per-savegame.
 * - Variables are PRIVATE (per-savegame) by default. Only the ids named in
 *   the world's variables.json "sharedVarIds" manifest are world-shared;
 *   their values live in variables.json and are applied on top of every
 *   savegame of the world. (This replaces the old "*"-prefix naming
 *   convention: the manifest is now an explicit id allowlist.)
 * - The world clock (time variable) is monotonic across savegames: loading
 *   any save continues at the latest date reached in the world.
 * - The world folder is never left empty: on boot, with no world at all, a
 *   randomly named world is created with the default seed and the canonical
 *   January 2001 starting date, then activated.
 * - A world is generated once, up front, not piecemeal as it is explored.
 *   Systems owning world data register a step through
 *   WorldManager.registerWorldInitializer(key, order, fn); every step a world
 *   still owes is run when the world is created (or, for the world made
 *   automatically at boot, when the first game is started in it) and recorded
 *   in world.json under "initialized". Current steps, in order: history,
 *   worldgen manifests, the NPC roster (people, homes, jobs), shop counter
 *   rotas, the dungeon layout, politics, the settlement web, the continental
 *   epidemics and Eris's defence bar.
 *
 * World data files are written whenever a savegame is written.
 * ============================================================================
 */

(() => {
    "use strict";

    const pluginName = "WorldManager";
    const params = PluginManager.parameters(pluginName);
    const TIME_VARIABLE_ID = Number(params.timeVariableId) || 114;
    // Save names that stay outside the world folder (shared by all worlds)
    const GLOBAL_SAVE_NAMES = ["config"];

    // Default world seed, stored as the named word "esoteric": every RNG
    // (history sim, procedural maps, NPCs, loot) normalizes it to a uint32, so
    // a default world is the reproducible "esoteric" world rather than a random
    // one. Shared with the creation UI through WorldManager.DEFAULT_SEED.
    const DEFAULT_WORLD_SEED = "esoteric";
    // Canonical world starting date: 1 January 2001, 10:00, which is minute 0
    // of the world clock (the TimeDateSystem epoch).
    const DEFAULT_START_YEAR = 2001;
    const DEFAULT_START_MONTH = 1;

    // Parses a "1, 2 ,3" CSV of ids into an array of positive integers.
    function parseIdList(csv) {
        return String(csv || "")
            .split(",")
            .map(s => parseInt(s.trim(), 10))
            .filter(n => Number.isInteger(n) && n > 0);
    }

    // Variables shared by every savegame of a world. The per-world
    // variables.json "sharedVarIds" manifest is seeded from this list and is
    // authoritative once written, so the set can evolve without breaking
    // existing worlds. Configured via the "sharedVariables" plugin parameter.
    //   2   Maximum dungeon floor reached (DungeonFloorSystem; unlocks floor list)
    //   53  SOUL tendency / median / fuel-base / shop-tax (world market signal)
    //   61  World Temperature (climate)
    //   113 Date (world calendar)
    //   114 MinutesPassed (world clock; also monotonic below)
    const DEFAULT_SHARED_VARS = (() => {
        const ids = parseIdList(params.sharedVariables);
        return ids.length ? ids : [2, 53, 61, 113, 114];
    })();

    // Switches that stay per-savegame. Switches are world-shared by default;
    // list exceptions in the "privateSwitches" plugin parameter.
    //
    // Everything character creation turns on belongs to the playthrough that
    // made those choices, never to the world: a world where one savegame played
    // Em must not hand Em's switch to every other savegame of that world.
    //   9        Permadeath (difficulty step)
    //   10,13,33 Class selected / character created / creation complete
    //   45,46    Card mode / Monster mode (battle-system step)
    //   48,49,58 Em / Bubba / Selene, set by their dossier
    //   50       SkipEmEvent, set by the Em and Bubba dossiers
    //   51,64    Camper / Car unlocked (a dossier can park one; the parked spot
    //            itself already lives per-save in $gameSystem)
    //   77,78,79 Player 1/2/3 is a creature
    const DEFAULT_PRIVATE_SWITCHES = [9, 10, 13, 33, 45, 46, 48, 49, 50, 51, 58, 64, 77, 78, 79];
    const WORLD_PRIVATE_SWITCHES = new Set((() => {
        const ids = parseIdList(params.privateSwitches);
        return ids.length ? ids : DEFAULT_PRIVATE_SWITCHES;
    })());

    //=========================================================================
    // World data file layout: which $gameSystem fields live in which file
    //=========================================================================

    const SYSTEM_FIELD_MAP = {
        world: {
            // Pre-made characters already played in this world. A preset can be
            // picked only once per world, so the list is world-scoped rather
            // than per-savegame (CharacterCreationPresets.js).
            _usedCharacterPresets: "usedCharacterPresets",
            // Party members retired ("set inactive") from the Dynamics menu.
            // They become pickable dossiers in character creation, so they have
            // to outlive the savegame that retired them and be visible to every
            // playthrough of this world (CharacterCreationPresets.js).
            _retiredCharacterPresets: "retiredCharacters",
            // How many Ems this world has already taken. The endless dossier is
            // never spent, but each incarnation is a different one and her
            // hometown is her number, so the count belongs to the world rather
            // than to one savegame (CharacterCreationPresets.js).
            _emIncarnations: "emIncarnations"
        },
        history: {
            _historicalEvents: "events",
            _historicalHyperpowers: "hyperpowers",
            _historicalFactions: "factions",
            _historicalDeadLeaders: "deadLeaders",
            _historicalStartYear: "startYear",
            _historySeed: "seed",
            // The century's epidemics (HistorySimulator). World-shared: every
            // savegame of a world lived through the same plagues and panics.
            _historicalEpidemics: "epidemics"
        },
        artifacts: {
            _generatedArtifacts: "generated"
        },
        npcs: {
            _npcSociety: "society",
            _npcSocialRegistry: "socialRegistry",
            _npcBuildingOccupants: "buildingOccupants",
            _npcGroupAssignments: "groupAssignments",
            _npcGroupMemory: "groupMemory",
            _npcJobAssignments: "jobAssignments",
            _npcJobAssignedGroups: "jobAssignedGroups",
            _npcShopAssignments: "shopAssignments",
            _npcShopReservedNames: "shopReservedNames",
            _npcMapGroups: "mapGroups",
            _npcMapSizes: "mapSizes",
            _npcMapTags: "mapTags",
            _npcMapLastVisitAt: "mapLastVisitAt",
            _npcPoolCache: "poolCache",
            _npcLastMapId: "lastMapId",
            _npcLastNeedsTick: "lastNeedsTick",
            _npcLastOpinionDecayDay: "lastOpinionDecayDay",
            _npcLastSeenMinute: "lastSeenMinute",
            _npcSystemCurrentMapGroup: "systemCurrentMapGroup",
            _currentNpcGroup: "currentNpcGroup",
            _npcTimeSkipped: "timeSkipped",
            _npcLifeRecords: "lifeRecords",
            _npcLifeLastSimMinute: "lifeLastSimMinute",
            _npcPastPartyMembers: "pastPartyMembers",
            _npcPolitics: "politics",
            _npcWorldWeb: "worldWeb",
            // Live outbreaks (Health_DiseaseSystem / window.EpidemicSystem).
            // Shared like the world web: an epidemic burning through Milano is
            // burning through it in every savegame of that world.
            _epidemics: "epidemics",
            _npcRecruitedProcCitizens: "recruitedProcCitizens",
            // The five advocates practising before Eris's bench. Seeded from the
            // world seed, but the strike-off list (a lawyer recruited into some
            // party, and so replaced) has to outlive the savegame that recruited
            // them so every playthrough of this world briefs the same bar
            // (ErisTrial.js, window.ErisLawyers).
            _erisLawyers: "erisLawyers",
            // Who stands which of the three 8-hour shifts behind each <Shop>
            // counter in the world, keyed "mapId_eventId" (ShopShiftManager,
            // NPCSimulationCore.js). The rota is decided once for the whole
            // world rather than per map visit, so the same face is behind the
            // same counter in every savegame of the world.
            _npcShopPersonas: "shopPersonas",
            // The slice of each group's job-less locals reserved as counter
            // staff. Drawn from the same seeded shuffle as the job assignments
            // next to it, so it belongs to the world exactly as they do
            // (JobShiftManager, NPCSimulationCore.js).
            _npcShopkeeperPool: "shopkeeperPool"
        },
        dungeon: {
            _dungeonFloors: "floors",
            _dungeonGenerated: "generated",
            _stairLocations: "stairLocations",
            _elevatorSpawnPoints: "elevatorSpawnPoints",
            _eventPositions: "eventPositions",
            _treasureRoomPositions: "treasureRoomPositions"
        },
        conversations: {
            _npcConversations: "log"
        }
    };

    const DATA_FILE_KEYS = ["world", "history", "artifacts", "npcs", "dungeon", "state", "variables", "market", "conversations", "terrain", "plants"];

    //=========================================================================
    // Storage backend (NW.js filesystem, localStorage fallback for browser)
    //=========================================================================

    const isNwjs = Utils.isNwjs();
    const LS_PREFIX = "hyperworlds.";

    const Backend = isNwjs ? {
        _fs: require("fs"),
        _path: require("path"),
        baseDir() {
            const base = this._path.dirname(process.mainModule.filename);
            return this._path.join(base, "save", "worlds");
        },
        worldDir(name) {
            return this._path.join(this.baseDir(), name);
        },
        savesDir(name) {
            return this._path.join(this.worldDir(name), "saves");
        },
        ensureDir(dir) {
            if (!this._fs.existsSync(dir)) this._fs.mkdirSync(dir, { recursive: true });
        },
        worldExists(name) {
            return this._fs.existsSync(this._path.join(this.worldDir(name), "world.json"));
        },
        listWorlds() {
            const base = this.baseDir();
            if (!this._fs.existsSync(base)) return [];
            return this._fs.readdirSync(base).filter(entry => {
                try {
                    return this._fs.statSync(this._path.join(base, entry)).isDirectory() &&
                        this.worldExists(entry);
                } catch (e) {
                    return false;
                }
            });
        },
        readFile(name, fileKey) {
            const filePath = this._path.join(this.worldDir(name), fileKey + ".json");
            if (!this._fs.existsSync(filePath)) return null;
            try {
                let text = this._fs.readFileSync(filePath, "utf8");
                if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                return text;
            } catch (e) {
                console.error(`[WorldManager] Failed to read ${filePath}`, e);
                return null;
            }
        },
        writeFile(name, fileKey, text) {
            this.ensureDir(this.worldDir(name));
            const filePath = this._path.join(this.worldDir(name), fileKey + ".json");
            this._fs.writeFileSync(filePath, text, "utf8");
        },
        _removeDirRecursive(dir) {
            const fs = this._fs;
            const path = this._path;
            if (!fs.existsSync(dir)) return;
            // Newer Node (>=14.14) exposes fs.rmSync; older NW.js builds only
            // have rmdirSync (recursive added in Node 12) or neither. Fall back
            // to a manual depth-first delete so worlds always get removed.
            if (typeof fs.rmSync === "function") {
                fs.rmSync(dir, { recursive: true, force: true });
                return;
            }
            try {
                fs.rmdirSync(dir, { recursive: true });
                if (!fs.existsSync(dir)) return;
            } catch (e) {
                // fall through to manual recursion
            }
            for (const entry of fs.readdirSync(dir)) {
                const full = path.join(dir, entry);
                if (fs.statSync(full).isDirectory()) {
                    this._removeDirRecursive(full);
                } else {
                    fs.unlinkSync(full);
                }
            }
            fs.rmdirSync(dir);
        },
        removeWorld(name) {
            this._removeDirRecursive(this.worldDir(name));
        },
        readActive() {
            const filePath = this._path.join(this.baseDir(), "active.json");
            if (!this._fs.existsSync(filePath)) return null;
            try {
                return JSON.parse(this._fs.readFileSync(filePath, "utf8")).active || null;
            } catch (e) {
                return null;
            }
        },
        writeActive(name) {
            this.ensureDir(this.baseDir());
            const filePath = this._path.join(this.baseDir(), "active.json");
            this._fs.writeFileSync(filePath, JSON.stringify({ active: name }), "utf8");
        }
    } : {
        _index() {
            try {
                return JSON.parse(localStorage.getItem(LS_PREFIX + "index")) || [];
            } catch (e) {
                return [];
            }
        },
        _setIndex(list) {
            localStorage.setItem(LS_PREFIX + "index", JSON.stringify(list));
        },
        ensureDir() {},
        worldExists(name) {
            return this._index().includes(name);
        },
        listWorlds() {
            return this._index();
        },
        readFile(name, fileKey) {
            return localStorage.getItem(LS_PREFIX + name + "." + fileKey);
        },
        writeFile(name, fileKey, text) {
            if (!this.worldExists(name)) this._setIndex(this._index().concat([name]));
            localStorage.setItem(LS_PREFIX + name + "." + fileKey, text);
        },
        removeWorld(name) {
            this._setIndex(this._index().filter(n => n !== name));
            DATA_FILE_KEYS.forEach(key => localStorage.removeItem(LS_PREFIX + name + "." + key));
        },
        readActive() {
            return localStorage.getItem(LS_PREFIX + "active") || null;
        },
        writeActive(name) {
            if (name) {
                localStorage.setItem(LS_PREFIX + "active", name);
            } else {
                localStorage.removeItem(LS_PREFIX + "active");
            }
        }
    };

    //=========================================================================
    // WorldManager
    //=========================================================================

    const WorldManager = {
        activeWorldName: null,
        // In-memory cache of world data files. With no active world this acts
        // as a session-only scratch store, so sandbox play still works.
        _cache: {},

        // Defaults for a freshly created world, read by the creation UI so the
        // form and the auto-created world always agree.
        DEFAULT_SEED: DEFAULT_WORLD_SEED,
        DEFAULT_START_YEAR: DEFAULT_START_YEAR,
        DEFAULT_START_MONTH: DEFAULT_START_MONTH,

        isValidName(name) {
            return typeof name === "string" && /^[A-Za-z0-9 _-]{1,40}$/.test(name.trim());
        },

        // Generates a random, valid world name not colliding with an existing
        // world. Used to pre-fill the creation form so players on a controller
        // (no keyboard) can create a world without typing.
        randomWorldName() {
            const adjectives = T.list("WorldManager.randomName.adjectives");
            const nouns = T.list("WorldManager.randomName.nouns");
            const pick = arr => arr[Math.floor(Math.random() * arr.length)];
            // Prefer a short single-word name first.
            for (let tries = 0; tries < 40; tries++) {
                const name = pick(nouns);
                if (!this.worldExists(name)) return name;
            }
            // Fall back to a two-word name if single words are exhausted.
            for (let tries = 0; tries < 40; tries++) {
                const name = `${pick(adjectives)} ${pick(nouns)}`;
                if (name.length <= 40 && !this.worldExists(name)) return name;
            }
            // Fallback: guarantee uniqueness with a numeric suffix.
            let n = 1;
            let name;
            do { name = T('WorldManager.randomName.fallback', { n: n++ }); } while (this.worldExists(name));
            return name;
        },

        listWorlds() {
            return Backend.listWorlds().map(name => {
                let info = {};
                try {
                    const text = Backend.readFile(name, "world");
                    if (text) info = JSON.parse(text);
                } catch (e) { /* corrupted world.json, still list the folder */ }
                return Object.assign({ name }, info, { name });
            });
        },

        worldExists(name) {
            return Backend.worldExists(name);
        },

        createWorld(name, options = {}) {
            name = String(name).trim();
            if (!this.isValidName(name)) throw new Error("Invalid world name"); // i18n-ignore: diagnostic
            if (this.worldExists(name)) throw new Error("World already exists"); // i18n-ignore: diagnostic
            const info = {
                name: name,
                createdAt: Date.now(),
                lastPlayed: null,
                seed: options.seed !== undefined ? options.seed : DEFAULT_WORLD_SEED,
                historyYears: options.historyYears !== undefined ? options.historyYears : null,
                worldTimeMinutes: options.worldTimeMinutes || 0,
                startYear: options.startYear !== undefined ? options.startYear : DEFAULT_START_YEAR,
                startMonth: options.startMonth !== undefined ? options.startMonth : DEFAULT_START_MONTH
            };
            Backend.writeFile(name, "world", JSON.stringify(info, null, 2));
            return info;
        },

        // The world a fresh install starts in: a random name, the default seed
        // and the canonical January 2001 starting date (world clock minute 0).
        // History is generated by HistorySimulator once the database loads.
        createDefaultWorld() {
            return this.createWorld(this.randomWorldName(), {
                seed: DEFAULT_WORLD_SEED,
                startYear: DEFAULT_START_YEAR,
                startMonth: DEFAULT_START_MONTH,
                worldTimeMinutes: 0
            });
        },

        deleteWorld(name) {
            const wasActive = this.activeWorldName === name;
            // When deleting the active world, fall back to the world immediately
            // before it in the list (or the new first world if it was first), so a
            // world is always active as long as one remains.
            let replacement = null;
            if (wasActive) {
                const names = Backend.listWorlds();
                const idx = names.indexOf(name);
                const remaining = names.filter(n => n !== name);
                if (remaining.length > 0) {
                    replacement = (idx > 0) ? names[idx - 1] : remaining[0];
                }
                // Deactivate first (without flushing) so the cached world data
                // doesn't get written back to disk after the folder is removed.
                this.activeWorldName = null;
                this._cache = {};
                Backend.writeActive(null);
            }
            Backend.removeWorld(name);
            if (wasActive && replacement) {
                this.setActiveWorld(replacement);
            }
        },

        // persist=false keeps the activation session-only (playtest Test world).
        setActiveWorld(name, persist = true) {
            if (this.activeWorldName && this.activeWorldName !== name) {
                this.flush();
            }
            this.activeWorldName = name || null;
            this._cache = {};
            // Another world's failures say nothing about this one's.
            this._initAttempts = {};
            if (persist) Backend.writeActive(this.activeWorldName);
            if (this.activeWorldName && isNwjs) {
                Backend.ensureDir(Backend.savesDir(this.activeWorldName));
            }
        },

        savesDirFor(name) {
            return Backend.savesDir(name);
        },

        // Reads a data file belonging to ANY world (not just the active one),
        // bypassing the cache. Used by UI screens that inspect inactive worlds.
        readWorldFile(name, fileKey) {
            const text = Backend.readFile(name, fileKey);
            if (!text) return null;
            try {
                return JsonEx.parse(text);
            } catch (e) {
                console.error(`[WorldManager] Failed to read '${fileKey}' for world '${name}'`, e);
                return null;
            }
        },

        // Counts binary savegame files for the given world. Returns null when
        // the count cannot be determined (browser/localStorage backend).
        countSaves(name) {
            if (!isNwjs) return null;
            const dir = Backend.savesDir(name);
            if (!Backend._fs.existsSync(dir)) return 0;
            try {
                return Backend._fs.readdirSync(dir).filter(f => f.endsWith(".rmmzsave")).length;
            } catch (e) {
                return 0;
            }
        },

        // --- world data files -----------------------------------------------

        // Lazily loads a data file into the cache. Files are JsonEx-encoded
        // JSON so class instances (e.g. Game_Factions) survive the roundtrip.
        getFile(fileKey) {
            if (!this._cache[fileKey]) {
                let data = null;
                if (this.activeWorldName) {
                    const text = Backend.readFile(this.activeWorldName, fileKey);
                    if (text) {
                        try {
                            data = JsonEx.parse(text);
                        } catch (e) {
                            console.error(`[WorldManager] Corrupted world file '${fileKey}'`, e);
                        }
                    }
                }
                this._cache[fileKey] = data || {};
            }
            return this._cache[fileKey];
        },

        getField(fileKey, prop) {
            return this.getFile(fileKey)[prop];
        },

        setField(fileKey, prop, value) {
            this.getFile(fileKey)[prop] = value;
        },

        worldInfo() {
            return this.getFile("world");
        },

        hasHistory() {
            const events = this.getField("history", "events");
            return Array.isArray(events) && events.length > 0;
        },

        // Latest date reached anywhere in this world (max of the stored world
        // clock and the in-session time variable).
        worldClockMinutes() {
            const stored = this.worldInfo().worldTimeMinutes || 0;
            let current = 0;
            if (typeof $gameVariables !== "undefined" && $gameVariables) {
                current = Number($gameVariables.value(TIME_VARIABLE_ID)) || 0;
            }
            return Math.max(stored, current);
        },

        // Writes every loaded data file to the active world folder. World data
        // can be mutated in place through the accessors, so all cached files
        // are flushed rather than tracking dirtiness.
        flush() {
            if (!this.activeWorldName) return;
            for (const fileKey of Object.keys(this._cache)) {
                try {
                    const encoded = JsonEx.stringify(this._cache[fileKey]);
                    const pretty = JSON.stringify(JSON.parse(encoded), null, 2);
                    Backend.writeFile(this.activeWorldName, fileKey, pretty);
                } catch (e) {
                    console.error(`[WorldManager] Failed to write world file '${fileKey}'`, e);
                }
            }
        },

        // --- one-time world initialization -----------------------------------

        // A world used to be little more than a folder with a name: every
        // system owning world-shared data (the history, the NPC roster and
        // where everybody lives and works, the shop rotas, the dungeon
        // layout, the politics, the epidemics burning through the continent)
        // generated its own the first time the player happened to walk into
        // it. That left a brand new world half-empty until it was explored,
        // and made the same world read differently depending on the order the
        // maps were visited.
        //
        // Each owning plugin registers its own step here; WorldManager runs
        // every step the world has not run yet, exactly once, and records
        // which ran in world.json ("initialized"). Steps carry an order
        // because the later ones read what the earlier ones wrote: the shop
        // rota draws on the NPC roster, which needs the map-group manifests,
        // which need the world seed the history run fixes.
        _initSteps: [],
        _initializing: false,
        // Failures per step for this session only. A step that keeps throwing
        // (a data file that never arrives) is given a few tries and then left
        // alone, so a broken generator cannot cost a retry on every map load.
        _initAttempts: {},
        INIT_MAX_ATTEMPTS: 3,

        registerWorldInitializer(key, order, fn) {
            if (!key || typeof fn !== "function") return;
            const step = { key, order: Number(order) || 100, fn };
            const at = this._initSteps.findIndex(s => s.key === key);
            if (at >= 0) this._initSteps[at] = step;
            else this._initSteps.push(step);
        },

        // The steps this world has already run, kept in world.json so a step
        // added later is picked up by worlds created before it existed.
        worldInitState() {
            const info = this.worldInfo();
            if (!info.initialized || typeof info.initialized !== "object") info.initialized = {};
            return info.initialized;
        },

        isWorldInitialized(key) {
            return !!this.worldInitState()[key];
        },

        // True while the world still owes at least one step, i.e. one failed
        // (a data table that had not finished loading) and is worth retrying.
        hasPendingWorldInit() {
            if (!this.activeWorldName) return false;
            const done = this.worldInitState();
            return this._initSteps.some(step =>
                !done[step.key] && (this._initAttempts[step.key] || 0) < this.INIT_MAX_ATTEMPTS);
        },

        // Runs every registered step this world still owes. Pass
        // { force: true } to rebuild a world's generated data from scratch.
        // Safe to call repeatedly: a completed step is skipped, so the normal
        // cost after the first run is nothing.
        initializeWorld(options = {}) {
            if (!this.activeWorldName || this._initializing) return false;
            if (options.force) this._initAttempts = {};
            else if (!this.hasPendingWorldInit()) return false;
            // The steps write through the $gameSystem world accessors, so the
            // game objects have to exist. Creating a world from the title
            // screen happens before any of them do; New Game builds its own
            // set from scratch afterwards, so the throwaway ones cost nothing.
            if (typeof $gameSystem === "undefined" || !$gameSystem) {
                DataManager.createGameObjects();
            }
            // The generators that simulate forward (politics, the settlement
            // web, the epidemics) read the clock, so it has to be standing at
            // the world's own starting date and not at zero. Already done when
            // the call comes from setupNewGame, and idempotent, so it costs
            // nothing there.
            this.applyPublicState();
            const done = this.worldInitState();
            const steps = this._initSteps.slice().sort((a, b) => a.order - b.order);
            let ran = 0;
            this._initializing = true;
            try {
                for (const step of steps) {
                    if (done[step.key] && !options.force) continue;
                    if ((this._initAttempts[step.key] || 0) >= this.INIT_MAX_ATTEMPTS) continue;
                    this._initAttempts[step.key] = (this._initAttempts[step.key] || 0) + 1;
                    const startedAt = Date.now();
                    try {
                        step.fn();
                        done[step.key] = true;
                        ran++;
                        console.log(`[WorldManager] World '${this.activeWorldName}': initialized '${step.key}' (${Date.now() - startedAt}ms).`);
                    } catch (e) {
                        // A failed step stays unmarked, so it is retried on the
                        // next run instead of leaving the world permanently
                        // short of that data.
                        console.error(`[WorldManager] World initializer '${step.key}' failed`, e);
                    }
                }
            } finally {
                this._initializing = false;
            }
            if (ran) this.flush();
            return ran > 0;
        },

        // --- public switches / variables -------------------------------------

        // The world's shared-variable manifest. Read from variables.json;
        // seeded from DEFAULT_SHARED_VARS the first time and persisted so old
        // worlds keep a stable set even if the default list later changes.
        sharedVarIds() {
            const vfile = this.getFile("variables");
            if (!Array.isArray(vfile.sharedVarIds)) {
                vfile.sharedVarIds = DEFAULT_SHARED_VARS.slice();
            }
            // One-time migration: variable 2 (max dungeon floor reached) became
            // world-shared after some worlds already had a persisted manifest,
            // so force it in rather than relying on the "seeded once" default.
            if (!vfile.sharedVarIds.includes(2)) {
                vfile.sharedVarIds.push(2);
            }
            return vfile.sharedVarIds;
        },

        isWorldSharedVariable(id) {
            return this.sharedVarIds().indexOf(Number(id)) !== -1;
        },

        // Switches are world-shared by default; only WORLD_PRIVATE_SWITCHES
        // stay per-savegame.
        isPrivateSwitch(id) {
            return WORLD_PRIVATE_SWITCHES.has(Number(id));
        },

        // Variables are per-savegame by default; only ids in the manifest are
        // world-shared.
        isPrivateVariable(id) {
            return !this.isWorldSharedVariable(id);
        },

        // Copies the current public switches into state.json, the world-shared
        // variables into variables.json, and advances the monotonic world clock.
        exportPublicState() {
            const state = this.getFile("state");
            const vfile = this.getFile("variables");
            const switches = {};
            const variables = {};
            const swData = $gameSwitches._data || [];
            for (let id = 1; id < swData.length; id++) {
                if (swData[id] !== undefined && swData[id] !== null && !this.isPrivateSwitch(id)) {
                    switches[id] = swData[id];
                }
            }
            const varData = $gameVariables._data || [];
            for (const id of this.sharedVarIds()) {
                const v = varData[id];
                if (v !== undefined && v !== null) variables[id] = v;
            }
            state.switches = switches;
            vfile.values = variables;

            const info = this.worldInfo();
            const minutes = Number($gameVariables.value(TIME_VARIABLE_ID)) || 0;
            info.worldTimeMinutes = Math.max(info.worldTimeMinutes || 0, minutes);
            info.lastPlayed = Date.now();
        },

        // Applies the world's public state on top of the (private-only) game
        // switches/variables, then continues the world clock at the latest
        // date reached by any savegame of this world.
        applyPublicState() {
            const state = this.getFile("state");
            const vfile = this.getFile("variables");
            if (state.switches) {
                for (const id of Object.keys(state.switches)) {
                    const numId = Number(id);
                    if (!this.isPrivateSwitch(numId)) {
                        $gameSwitches._data[numId] = state.switches[id];
                    }
                }
            }
            // Back-compat: worlds written before the split kept shared vars in
            // state.variables. Fold any such values into variables.json once.
            if (state.variables && !vfile.values) {
                vfile.values = {};
                for (const id of this.sharedVarIds()) {
                    if (state.variables[id] !== undefined) vfile.values[id] = state.variables[id];
                }
                delete state.variables;
            }
            if (vfile.values) {
                for (const id of this.sharedVarIds()) {
                    if (vfile.values[id] !== undefined) {
                        $gameVariables._data[id] = vfile.values[id];
                    }
                }
            }
            const worldMinutes = this.worldInfo().worldTimeMinutes || 0;
            const current = Number($gameVariables.value(TIME_VARIABLE_ID)) || 0;
            if (worldMinutes > current) {
                $gameVariables._data[TIME_VARIABLE_ID] = worldMinutes;
            }
            if ($gameMap) $gameMap.requestRefresh();
        },

        // A savegame written before a switch became private never stored that
        // switch in its binary: its value only ever existed in the world's
        // state.json, which applyPublicState now refuses to hand out. Adopt the
        // world value once, for private switches the binary has nothing to say
        // about, so an existing playthrough keeps the settings it was made with.
        // From the next save on, the value travels in the binary and the world
        // copy is dropped, so this runs at most once per savegame.
        adoptLegacyPrivateSwitches() {
            const state = this.getFile("state");
            if (!state.switches) return;
            for (const id of WORLD_PRIVATE_SWITCHES) {
                const stored = state.switches[id];
                if (stored === undefined) continue;
                const current = $gameSwitches._data[id];
                if (current === undefined || current === null) {
                    $gameSwitches._data[id] = stored;
                }
            }
        },

        // Old saves carry world-scoped data as own properties on $gameSystem
        // (shadowing the prototype accessors). Adopt them into the world store
        // when it is still empty, then remove them from the instance.
        migrateLegacySystemFields() {
            if (!$gameSystem) return;
            for (const fileKey of Object.keys(SYSTEM_FIELD_MAP)) {
                const fields = SYSTEM_FIELD_MAP[fileKey];
                for (const key of Object.keys(fields)) {
                    if (Object.prototype.hasOwnProperty.call($gameSystem, key)) {
                        const legacy = $gameSystem[key];
                        delete $gameSystem[key];
                        if (this.getField(fileKey, fields[key]) === undefined && legacy !== undefined) {
                            this.setField(fileKey, fields[key], legacy);
                        }
                    }
                }
            }
        }
    };

    window.WorldManager = WorldManager;

    //=========================================================================
    // Game_System accessors: world-scoped fields live in the world store
    //=========================================================================

    for (const fileKey of Object.keys(SYSTEM_FIELD_MAP)) {
        const fields = SYSTEM_FIELD_MAP[fileKey];
        for (const key of Object.keys(fields)) {
            const prop = fields[key];
            Object.defineProperty(Game_System.prototype, key, {
                get() { return WorldManager.getField(fileKey, prop); },
                set(value) { WorldManager.setField(fileKey, prop, value); },
                configurable: true
            });
        }
    }

    //=========================================================================
    // StorageManager: redirect savegames into the active world folder
    //=========================================================================

    const _StorageManager_filePath = StorageManager.filePath;
    StorageManager.filePath = function (saveName) {
        if (isNwjs && WorldManager.activeWorldName && !GLOBAL_SAVE_NAMES.includes(saveName)) {
            const dir = Backend.savesDir(WorldManager.activeWorldName);
            Backend.ensureDir(dir);
            return Backend._path.join(dir, saveName + ".rmmzsave");
        }
        return _StorageManager_filePath.call(this, saveName);
    };

    const _StorageManager_forageKey = StorageManager.forageKey;
    StorageManager.forageKey = function (saveName) {
        if (!isNwjs && WorldManager.activeWorldName && !GLOBAL_SAVE_NAMES.includes(saveName)) {
            const gameId = $dataSystem.advanced.gameId;
            return "rmmzsave." + gameId + ".world." + WorldManager.activeWorldName + "." + saveName;
        }
        return _StorageManager_forageKey.call(this, saveName);
    };

    //=========================================================================
    // DataManager: keep binaries minimal, share public state, flush world data
    //=========================================================================

    function makePrivateOnly(source, klass, isPrivate) {
        const stripped = new klass();
        const data = source._data || [];
        for (let id = 1; id < data.length; id++) {
            if (isPrivate(id) && data[id] !== undefined && data[id] !== null) {
                stripped._data[id] = data[id];
            }
        }
        return stripped;
    }

    const _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _DataManager_makeSaveContents.call(this);
        // Without an active world there is no state.json to hold the public
        // values, so the full switch/variable data must stay in the binary.
        if (WorldManager.activeWorldName) {
            WorldManager.exportPublicState();
            contents.switches = makePrivateOnly($gameSwitches, Game_Switches,
                id => WorldManager.isPrivateSwitch(id));
            contents.variables = makePrivateOnly($gameVariables, Game_Variables,
                id => WorldManager.isPrivateVariable(id));
            contents.worldName = WorldManager.activeWorldName;
            // Marks a save whose binary already carries the private switches,
            // so loading it skips adoptLegacyPrivateSwitches.
            contents.privateSwitchSchema = 1;
        }
        return contents;
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        WorldManager.migrateLegacySystemFields();
        if (WorldManager.activeWorldName) {
            WorldManager.applyPublicState();
            if (!contents.privateSwitchSchema) {
                WorldManager.adoptLegacyPrivateSwitches();
            }
        }
    };

    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        _DataManager_setupNewGame.call(this);
        // A new game in an existing world inherits the world's public state
        // and continues at the world clock.
        if (WorldManager.activeWorldName) {
            WorldManager.applyPublicState();
            // Generate whatever this world still owes (see
            // registerWorldInitializer). This is where the world created for
            // an empty world folder at boot gets populated: it is made before
            // the database is even loaded, so the work waits for the first
            // game started in it. A world created from the world screen has
            // already been through this and skips every step.
            WorldManager.initializeWorld();
        }
    };

    //=========================================================================
    // Retry: a step can fail because a table it reads had not finished loading
    // when the new game started (the NPC society tables fetch their i18n half
    // asynchronously). Anything still owed is attempted again on map load,
    // where every data source is certainly up. Costs one boolean per load once
    // the world is complete, which is the normal case.
    //=========================================================================

    const _Scene_Map_onMapLoaded_worldInit = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
        _Scene_Map_onMapLoaded_worldInit.call(this);
        if (WorldManager.hasPendingWorldInit()) WorldManager.initializeWorld();
    };

    // Every savegame write also persists the world data files.
    const _DataManager_saveGame = DataManager.saveGame;
    DataManager.saveGame = function (savefileId) {
        return _DataManager_saveGame.call(this, savefileId).then(result => {
            WorldManager.flush();
            return result;
        });
    };

    //=========================================================================
    // Boot: resolve the active world. The last active world wins; failing that
    // any existing world is adopted; and if the world folder is empty a default
    // world is created (random name, default seed, January 2001). Playtest runs
    // the same way, it just does not persist the choice into active.json.
    //=========================================================================

    (function resolveActiveWorld() {
        const persist = !Utils.isOptionValid("test");

        const active = Backend.readActive();
        if (active && WorldManager.worldExists(active)) {
            WorldManager.setActiveWorld(active, false);
            console.log(`[WorldManager] Active world: ${active}`);
            return;
        }

        const existing = Backend.listWorlds();
        if (existing.length > 0) {
            WorldManager.setActiveWorld(existing[0], persist);
            console.log(`[WorldManager] Active world: ${existing[0]}`);
            return;
        }

        try {
            const info = WorldManager.createDefaultWorld();
            WorldManager.setActiveWorld(info.name, persist);
            console.log(`[WorldManager] Empty world folder: created default world '${info.name}'.`);
        } catch (e) {
            console.error("[WorldManager] Failed to create the default world", e);
        }
    })();
})();
