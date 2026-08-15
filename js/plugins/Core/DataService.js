/*:
 * @target MZ
 * @plugindesc Automatically registers JSON files from js/db/ to global window objects.
 * @author Omni-Lex
 *
 * @help
 * This plugin scans the js/db/ directory and its subdirectories, loading all .json
 * files and registering them to namespaced window objects.
 *
 * Rules:
 * - Window object name = Folder name (e.g., js/db/Health/ -> window.Health)
 * - Property name = Filename without extension (e.g., BodyParts.json -> window.Health.BodyParts)
 *
 * Example:
 * js/db/WorldGen/Biomes.json -> window.WorldGen.Biomes
 *
 * ----------------------------------------------------------------------------
 * i18n
 * ----------------------------------------------------------------------------
 * This plugin also hosts window.T, the key-based resolver every other plugin
 * uses for its user-facing strings. It lives here because DataService is load
 * slot 2 of 279 and loads synchronously, so plugins that build const tables at
 * load time can already call it.
 *
 *   T('RentSystem.msg.notEnoughGold')          -> string
 *   T('Loot.msg.gained', { amount: 40 })       -> interpolated string
 *   T.list('TVBroadcast.em.refusal')           -> array of strings
 *   T.obj('Bestiary.tabs')                     -> object subtree
 *   T.n('Quest.daysLeft', 3)                   -> .one / .other by count
 *   T.has(key) / T.param(value, key) / T.reload()
 *
 * See docs/workflows/i18n-hardcoded-string-extraction.md.
 */

(() => {
    // Force StorageManager to use web mode if not in real NW.js
    const isRealNwjs = typeof process !== 'undefined' && process.versions && process.versions.nw;
    if (!isRealNwjs) {
        StorageManager.isLocalMode = function() { return false; };
        console.log("DataService: Forced StorageManager to web mode.");
    }

    function loadDatabase() {
        const fs = require('fs');
        const path = require('path');
        const DB_PATH = path.join(process.cwd(), 'js', 'db');

        if (!fs.existsSync(DB_PATH)) {
            console.warn(`DataService: DB path not found: ${DB_PATH}`);
            return;
        }

        const folders = fs.readdirSync(DB_PATH);

        folders.forEach(folder => {
            const folderPath = path.join(DB_PATH, folder);
            if (!fs.statSync(folderPath).isDirectory()) return;

            const windowName = folder;
            window[windowName] = window[windowName] || {};

            const files = fs.readdirSync(folderPath);
            files.forEach(file => {
                if (path.extname(file).toLowerCase() !== '.json') return;

                const filePath = path.join(folderPath, file);
                const fileName = path.basename(file, '.json');

                try {
                    let content = fs.readFileSync(filePath, 'utf8');
                    if (content.charCodeAt(0) === 0xFEFF) {
                        content = content.slice(1);
                    }
                    const data = JSON.parse(content);

                    // Register using the exact filename
                    window[windowName][fileName] = data;

                    console.log(`DataService: Registered window.${windowName}.${fileName}`);
                } catch (e) {
                    console.error(`DataService: Failed to load ${filePath}: ${e.message}`);
                }
            });
        });
    }

    function loadDatabaseBrowser() {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'js/db_manifest.json', false);
            xhr.send();
            if (xhr.status !== 200) {
                console.warn("DataService: Failed to load js/db_manifest.json. Running without pre-loaded DB.");
                return;
            }
            let manifestText = xhr.responseText;
            if (manifestText.charCodeAt(0) === 0xFEFF) {
                manifestText = manifestText.slice(1);
            }
            const manifest = JSON.parse(manifestText);
            
            for (const folder in manifest) {
                window[folder] = window[folder] || {};
                const files = manifest[folder];
                files.forEach(file => {
                    // Guard each file individually so one bad/malformed entry
                    // cannot abort the whole manifest load.
                    try {
                        const xhr2 = new XMLHttpRequest();
                        xhr2.open('GET', `js/db/${folder}/${file}`, false);
                        xhr2.send();
                        if (xhr2.status === 200) {
                            let text = xhr2.responseText;
                            if (text.charCodeAt(0) === 0xFEFF) {
                                text = text.slice(1);
                            }
                            const data = JSON.parse(text);
                            const fileName = file.replace('.json', '');
                            window[folder][fileName] = data;
                            console.log(`DataService: Registered window.${folder}.${fileName} (Browser)`);
                        } else {
                            console.error(`DataService: Failed to load js/db/${folder}/${file}`);
                        }
                    } catch (e) {
                        console.error(`DataService: Failed to load js/db/${folder}/${file}: ${e.message}`);
                    }
                });
            }
        } catch (e) {
            console.error("DataService: Browser loading failed", e);
        }
    }

    if (Utils.isNwjs()) {
        loadDatabase();
    } else {
        loadDatabaseBrowser();
    }

    // ── AlienBiomes.json → merged into window.WorldGen.Biomes ────────────────
    // Alien planet biomes (one per GalaxySim planet type, referencing the
    // recoloured tilesets from id 318 up) live in their own file so they stay
    // separate from the Earth biome catalogue, but the WorldGen biome registry
    // (getBiomeByName, feature parsing, battlebacks) only reads
    // window.WorldGen.Biomes. Append them in place (mutate, don't reassign) so
    // any plugin that already captured the Biomes array reference still sees them.
    if (window.WorldGen && Array.isArray(window.WorldGen.Biomes) &&
        Array.isArray(window.WorldGen.AlienBiomes)) {
        const known = new Set(window.WorldGen.Biomes.map(function (b) { return b.name; }));
        let added = 0;
        window.WorldGen.AlienBiomes.forEach(function (b) {
            if (b && b.name && !known.has(b.name)) {
                window.WorldGen.Biomes.push(b);
                known.add(b.name);
                added++;
            }
        });
        console.log("DataService: merged " + added + " alien biomes into WorldGen.Biomes.");
    }

    // ── window.WorldGen.HardcodedBiomeNames, derived from Destinations.json ──
    // The old js/db/WorldGen/HardcodedBiomeNames.json ("x,y" -> place name) was
    // a hand-maintained duplicate of the footprint every named place already
    // has to declare somewhere: it is retired, and every coordinate it held
    // now lives as that place's own `reservedTiles` array in
    // js/db/WorkSystem/Destinations.json (the same array FastTravelSystem
    // reads to walk a traveller through the place's own `entrance` instead of
    // dropping them on the open world tile). This block rebuilds the old flat
    // "x,y" -> Destinations.json KEY map at load time so every plugin that
    // still reads window.WorldGen.HardcodedBiomeNames[x+','+y] keeps working
    // unchanged.
    if (window.WorkSystem && window.WorkSystem.Destinations) {
        const flat = {};
        let tiles = 0;
        for (const key in window.WorkSystem.Destinations) {
            const entry = window.WorkSystem.Destinations[key];
            const reserved = entry && entry.reservedTiles;
            if (!Array.isArray(reserved)) continue;
            reserved.forEach(function (coord) {
                flat[coord] = key;
                tiles++;
            });
        }
        // A place that declares no `reservedTiles` still occupies the one world
        // square its `base` names - that is the tile the fast-travel system parks
        // a traveller on. Without it the square is anonymous, and everything gated
        // on "is this a named place?" (the "Visit <name>" travel menu above all)
        // skips it: a one-tile village like Lille or Le Havre sits on a Village
        // biome tile, and a plain settlement tile suppresses that menu entirely.
        //
        // Only places WITHOUT a footprint get this. Where `reservedTiles` exists it
        // is the authority and `base` is not dependably inside it (Amsterdam's base
        // is two squares south of its four reserved tiles; Middelburg's reads
        // "85,11" against a reserved "85,114"), so a base fill-in there would name
        // open countryside next door to the town.
        for (const key in window.WorkSystem.Destinations) {
            const entry = window.WorkSystem.Destinations[key];
            if (!entry || Array.isArray(entry.reservedTiles)) continue;
            const base = entry.base;
            if (!base || typeof base.x !== 'number' || typeof base.y !== 'number') continue;
            const coord = base.x + ',' + base.y;
            if (flat[coord]) continue;
            flat[coord] = key;
            tiles++;
        }
        window.WorldGen = window.WorldGen || {};
        window.WorldGen.HardcodedBiomeNames = flat;
        console.log("DataService: derived WorldGen.HardcodedBiomeNames from " +
            tiles + " Destinations.json reservedTiles.");
    }

    // ── The sprite catalogue: NPCs.json ─────────────────────────────────────
    // js/db/WorldGen/NPCs.json (window.WorldGen.NPCs) is the one record of every
    // character sheet the game knows. The old js/db/Sprites/SpritesAssociation.json
    // was folded into it and deleted; its sheets (the historical dossier sprites
    // and their skins) live here as npc:false entries.
    //
    //   { "Skab/!$Adept": { npc, aliens, busts, beta, animations,
    //                       Archetype, Gender, chars, color, classes, markovDB } }
    //
    //   npc        the sheet may be dealt to a procedural inhabitant
    //   aliens     the sheet is not a person of this world. An alien is dealt at
    //              a rate, never out of the ordinary pool, see alienShare below.
    //   beta       the sheet is not in the original folder (img/characters/Skab/
    //              Originals). A beta sheet is browsable in the character grid but
    //              is kept out of every automatic pick unless the world was created
    //              with beta sprites enabled, see window.SpriteCatalog below.
    //   animations the sheet is an animation/pose sheet, not a 3x4 walk sheet
    //
    // Every bust plugin reads SpritesAssociation[spriteName][characterIndex] →
    // bustName, so the flat bust map is rebuilt here from the busts arrays and
    // published as window.Sprites.SpritesAssociation exactly as before.
    if (window.WorldGen && window.WorldGen.NPCs) {
        window.Sprites = window.Sprites || {};
        const rebuilt = {};
        for (const [key, val] of Object.entries(window.WorldGen.NPCs)) {
            rebuilt[key] = Array.isArray(val) ? val : (val.busts || []);
        }
        window.Sprites.SpritesAssociation = rebuilt;
        console.log("DataService: SpritesAssociation rebuilt from NPCs.json (" +
                    Object.keys(rebuilt).length + " entries).");
    }

    // ── window.SpriteCatalog ────────────────────────────────────────────────
    // The one place that answers "which character sheets may this world use?".
    //
    // A beta sheet is one that is not in the original folder: it is drawn, it is
    // in the game, and the character grid offers it, but nothing picks it on the
    // player's behalf. A world can opt in at creation time ("beta sprites",
    // world.json → betaSprites), and only at creation time: the answer decides
    // which faces the world was populated with, so it cannot be taken back or
    // granted later without the world's people changing under it. Turning it on
    // widens the pool for everyone dealt from then on; whoever already has a face
    // keeps it, since a settlement's pool is stored in the world folder
    // (npcs.json → poolCache) once it has been dealt.
    (function () {
        // Pools are rebuilt only when the beta answer changes, which happens at
        // most once per world activation.
        const poolCache = { all: null, stable: null, alienAll: null };

        // How often a rolled face belongs to somebody who is not from here. An
        // alien walking a town street is a rare sight; a travel interior is where
        // they are actually met, so the whole PublicTransport map group (the
        // trains, the bus, the metro, the starship cabin) deals them far more
        // freely; and a hand-authored landing site on another world is their
        // ground, not ours, so there a human face is the rarity. All three are
        // shares of one draw, never a pool an alien sits in.
        const ALIEN_SHARE = 0.01;
        const ALIEN_SHARE_TRANSPORT = 0.25;
        const ALIEN_SHARE_OFFWORLD = 0.90;
        const TRANSPORT_GROUP = "PublicTransport"; // i18n-ignore: MapGroups.json key

        function db() {
            return (window.WorldGen && window.WorldGen.NPCs) || {};
        }

        // ── The retired joined sheets ───────────────────────────────────────
        // The 53 eight-character sheets that used to sit in the root of
        // img/characters were cut into single-character !$ sheets under
        // img/characters/NPCs/ and deleted. Every entry that came out of one
        // records where it came from in its `source` field ("People2#3"), so
        // the cut is its own migration table and nothing has to be listed here.
        //
        // Every map, prefab, actor and plugin parameter in the repository was
        // repointed when the sheets were cut, but a sheet name also travels in
        // things written BEFORE it: a world folder's npcs.json caches a
        // snapshot of each dealt NPC's event pages (poolCache), and a savegame
        // holds the party's own graphics. Those still name the joined sheet and
        // its cell, which is a 404 on every load. legacySheet() answers what a
        // (sheet, cell) pair is called now, and the hooks below apply it at the
        // moment a graphic is set, so stale data renders the right person
        // without the stored file being rewritten under the player.
        //
        // A cell the cut produced nothing for was a deliberately blank cell of
        // the joined sheet, and answers "" (no graphic), which is what it drew.
        let legacyIndex = null;
        function legacyMap() {
            if (legacyIndex) return legacyIndex;
            legacyIndex = {};
            for (const [key, entry] of Object.entries(db())) {
                const src = entry && typeof entry === "object" ? entry.source : null;
                if (typeof src !== "string") continue;
                const cut = src.lastIndexOf("#");
                if (cut <= 0) continue;
                const sheet = src.slice(0, cut);
                const cell = Number(src.slice(cut + 1));
                if (!Number.isFinite(cell)) continue;
                const slots = legacyIndex[sheet] || (legacyIndex[sheet] = {});
                if (slots[cell] === undefined) slots[cell] = key;
            }
            return legacyIndex;
        }

        // ====================================================================
        // window.MagicNature , how much magic this world has
        // ====================================================================
        // Every real entry of Skills, Enemies, Weapons, Armors, Items, Classes
        // and States carries `<Nature: Magical>` or `<Nature: Mundane>` in its
        // notebox; Traits.json carries a `nature` field and NPCs.json a
        // `magical` boolean (all written by tools/nature/gen_nature_tags.js).
        // This is the ONE place that reads them, so no caller has to know the
        // tag's spelling or which of the three shapes a given table uses.
        //
        //   normal   , everything is allowed. `isFiltering()` is false and
        //              every caller short-circuits, so an ordinary world pays
        //              nothing at all for this.
        //   severed  , magic never happened: nothing Magical exists.
        //   unbound  , magic won: nothing Mundane is left.
        //
        // It is a SEPARATE axis from the alternate timeline (populationMode):
        // both are resolved independently and every combination is legal.
        //
        // The two answers are deliberately asymmetric in one place only, and
        // it is stated here rather than at each caller: a thing the party was
        // GIVEN is never taken away. Character creation's starting kit, a
        // quest reward already handed over and anything already in the pack
        // stay exactly as they are; the level decides what the world will
        // OFFER from now on, not what the party is holding.
        const NATURE_RE = /<Nature:\s*([A-Za-z]+)\s*>/i;
        window.MagicNature = {
            // "normal" | "severed" | "unbound"
            level() {
                const WM = window.WorldManager;
                if (!WM || typeof WM.magicalLevel !== "function") return "normal";
                return WM.magicalLevel();
            },

            // False in an ordinary world, which is the fast path every caller
            // tests first.
            isFiltering() {
                return this.level() !== "normal";
            },

            // Is a thing of this nature allowed here? Takes the string, since
            // there are THREE answers and not two:
            //
            //   magical , only in a world that has magic
            //   mundane , only in a world that does not. This is a narrow set
            //             on purpose: it means "could only exist BECAUSE there
            //             is no magic", which in practice is high technology,
            //             the thing a world of working spells never had to
            //             invent.
            //   both    , a rope, a hammer, a horse, a sword, a loaf of bread.
            //             Most of the world is this. It exists either way and
            //             is never filtered out by either level.
            //
            // A boolean is still accepted (true = magical) for the callers
            // that only ever have one.
            allows(nature) {
                const level = this.level();
                if (level === "normal") return true;
                const n = (nature === true) ? "magical"
                        : (nature === false) ? "mundane"
                        : String(nature || "").toLowerCase();
                if (n === "both" || !n) return true;
                return level === "severed" ? n !== "magical" : n !== "mundane";
            },

            // The nature of any RMMZ database entry (anything with a notebox):
            // "magical", "mundane", "both", or null where nothing is tagged,
            // which `allowsData` reads as "no opinion".
            natureOf(data) {
                const m = data && data.note ? String(data.note).match(NATURE_RE) : null;
                if (!m) return null;
                const raw = m[1].toLowerCase();
                if (raw === "magical" || raw === "both") return raw;
                return "mundane";
            },

            isMagicalData(data) {
                return this.natureOf(data) === "magical";
            },

            // The gate for a database entry: an item, weapon, armor, skill,
            // enemy, class or state. Untagged entries are always allowed.
            allowsData(data) {
                if (!this.isFiltering()) return true;
                const nature = this.natureOf(data);
                if (!nature) return true;
                return this.allows(nature);
            },

            // The gate for a trait out of js/db/Health/Traits.json, which
            // carries its answer as a field rather than in a notebox. Also
            // reads a disease, which carries the same `nature` field.
            //
            // ASYMMETRIC ON PURPOSE, and this is the one place it is decided:
            // a SEVERED world hides the magical traits, but an UNBOUND world
            // hides nothing. There are 183 mundane traits against 19 magical
            // ones, so applying the unbound rule here would cut a four-trait
            // character down to a choice of nineteen and make every character
            // in the world read the same. Being ordinary is not a thing magic
            // winning takes away from you.
            allowsTrait(trait) {
                if (this.level() !== "severed") return true;
                if (!trait || trait.nature === undefined) return true;
                return String(trait.nature).toLowerCase() !== "magical";
            },

            // Convenience for the item tables, which are handed ids.
            allowsItemId(id) { return this.allowsData($dataItems && $dataItems[id]); },
            allowsWeaponId(id) { return this.allowsData($dataWeapons && $dataWeapons[id]); },
            allowsArmorId(id) { return this.allowsData($dataArmors && $dataArmors[id]); },
            allowsEnemyId(id) { return this.allowsData($dataEnemies && $dataEnemies[id]); },
            allowsSkillId(id) { return this.allowsData($dataSkills && $dataSkills[id]); },
        };

        window.SpriteCatalog = {
            // What a cell of a retired joined sheet is called now, as
            // { name, index }, or null when the sheet was never one of them
            // (which is every sheet still on disk). The replacement is a
            // single-character !$ sheet, so the index is always 0.
            legacySheet(name, index) {
                if (typeof name !== "string" || !name) return null;
                const slots = legacyMap()[name];
                if (!slots) return null;
                const cell = Number(index);
                const key = slots[Number.isFinite(cell) ? cell : 0];
                return { name: key || "", index: 0 };
            },

            // The full record for a sheet, or null when the sheet is unknown.
            entry(key) {
                const e = db()[key];
                return (e && typeof e === "object" && !Array.isArray(e)) ? e : null;
            },

            busts(key) {
                const e = this.entry(key);
                return (e && e.busts) || [];
            },

            // Not in the original folder: browsable, never dealt automatically
            // unless the world enabled beta sprites.
            isBeta(key) {
                const e = this.entry(key);
                return !!(e && e.beta === true);
            },

            // An animation/pose sheet rather than a walk sheet.
            isAnimated(key) {
                const e = this.entry(key);
                return !!(e && e.animations === true);
            },

            // Not a person of this world. Kept out of npcKeys() entirely: an
            // alien is only ever dealt through pickNpcKey's own roll.
            isAlien(key) {
                const e = this.entry(key);
                return !!(e && e.aliens === true);
            },

            // Whether a character sheet may be worn in this world's magic
            // level. The wardrobe carries a plain `magical` boolean per entry
            // (tools/nature/gen_nature_tags.js); see window.MagicNature.
            allowedInMagic(key, entry) {
                const MN = window.MagicNature;
                if (!MN || !MN.isFiltering()) return true;
                const e = entry || this.entry(key);
                return MN.allows(e && e.magical === true);
            },

            // Whether the active world was created with beta sprites enabled.
            betaEnabled() {
                const WM = window.WorldManager;
                if (!WM || !WM.hasActiveWorld || !WM.hasActiveWorld()) return false;
                const info = WM.worldInfo();
                return !!(info && info.betaSprites === true);
            },

            // Who this world is populated with, answered once at creation
            // (WorldManager.populationMode). Read here rather than stored, so a
            // world switched under a running session is never read stale.
            populationMode() {
                const WM = window.WorldManager;
                if (!WM || typeof WM.populationMode !== "function") return "normal";
                return WM.populationMode();
            },

            // The archetypes a world of PEOPLE is made of. A monster world is
            // defined as everything that is not one of these, so they are named
            // once, here, rather than at each caller: the sprite and bust
            // wardrobe, the creature-creation board and the enemies that roam
            // the map all read this one list. A two-headed one is still a
            // person, which is why DoubleHeadedHumanoid is on it.
            PEOPLE_ARCHETYPES: ["Humanoid", "DoubleHeadedHumanoid", "Elven", "Goblin", "Dwarf"],

            // Whether one wardrobe entry belongs in this world at all. This is
            // the single rule behind both the sprite a procedural inhabitant is
            // dealt and the bust that comes with it (a bust is a field of the
            // sheet's own entry, so gating the sheet gates the face with it).
            //
            //   goblin  , only goblins: the sheet says so in its name or the
            //             entry carries the Goblin archetype outright.
            //   monster , nothing that reads as a person: every archetype
            //             except Humanoid, Elven, Goblin and Dwarf.
            //   normal  , everything, which is every world made before this
            //             option existed.
            //
            // An empty world is not filtered here: nothing is spawned in one at
            // all (NPCSystem refuses the spawn), and narrowing the wardrobe of
            // a world with nobody in it would only hide the player's own
            // character sheets from them.
            allowedInPopulation(key, entry, mode) {
                const m = mode || this.populationMode();
                if (m !== "goblin" && m !== "monster") return true;
                const e = entry || this.entry(key);
                const archetype = (e && e.Archetype) || "";
                if (m === "goblin") {
                    return String(key).toLowerCase().includes("goblin") ||
                           archetype === "Goblin";
                }
                return !this.PEOPLE_ARCHETYPES.includes(archetype);
            },

            // The faces a narrowed world may wear, as a Set of bust names, or
            // null where every bust in the folder is fair game (normal and
            // empty worlds). The bust gallery reads the img/busts folder rather
            // than this file, so it cannot derive the answer itself: a bust
            // belongs to a world when some sheet that world allows lists it.
            // Falls back to null rather than an empty gallery if the wardrobe
            // has nothing to say, so a data gap is never a locked door.
            allowedBustNames(mode) {
                const m = mode || this.populationMode();
                const magic = (window.MagicNature && window.MagicNature.level()) || "normal";
                const narrowed = (m === "goblin" || m === "monster") || magic !== "normal";
                if (!narrowed) return null;
                const slot = "bustNames:" + m + ":" + magic;
                if (!poolCache[slot]) {
                    const data = db();
                    const names = new Set();
                    Object.keys(data).forEach(k => {
                        const e = data[k];
                        if (!e || !this.allowedInMagic(k, e)) return;
                        if (!this.allowedInPopulation(k, e, m)) return;
                        (e.busts || []).forEach(b => { if (b) names.add(String(b)); });
                    });
                    poolCache[slot] = names.size ? names : null;
                }
                return poolCache[slot] || null;
            },

            // Whether one bust file may be worn in this world.
            bustAllowedInPopulation(bustName, mode) {
                const m = mode || this.populationMode();
                const allowed = this.allowedBustNames(m);
                if (!allowed) return true;
                if (allowed.has(String(bustName))) return true;
                // A goblin world also takes any face that says so itself, so a
                // bust drawn for one but never wired to a sheet is still on it.
                return m === "goblin" &&
                       String(bustName).toLowerCase().includes("goblin");
            },

            // Every sheet that may be dealt to a procedural inhabitant. Beta
            // sheets follow the world's answer unless includeBeta says otherwise
            // (the character grid passes true: the player browses everything).
            // Aliens are never in it: they are dealt by pickNpcKey alone.
            // The population mode is part of the cache key: a goblin world and
            // a normal one are two different pools off the same file, and the
            // cache outlives a world switch inside one session.
            npcKeys(options) {
                const includeBeta = (options && options.includeBeta !== undefined)
                    ? !!options.includeBeta
                    : this.betaEnabled();
                const mode = (options && options.populationMode)
                    ? options.populationMode
                    : this.populationMode();
                const magic = (window.MagicNature && window.MagicNature.level()) || "normal";
                const slot = (includeBeta ? "all" : "stable") + ":" + mode + ":" + magic;
                if (!poolCache[slot]) {
                    const data = db();
                    poolCache[slot] = Object.keys(data).filter(k => {
                        const e = data[k];
                        if (!e || e.npc !== true || e.aliens === true) return false;
                        if (!includeBeta && e.beta === true) return false;
                        if (!this.allowedInMagic(k, e)) return false;
                        return this.allowedInPopulation(k, e, mode);
                    });
                }
                return poolCache[slot];
            },

            // The alien half of the same wardrobe. The beta answer does NOT
            // apply here: it exists so a world is not populated with sheets
            // outside the original wardrobe by accident, and an alien is never
            // dealt by accident, only on the declared share below. Three of the
            // six alien sheets sit outside the original folder, and gating them
            // on it would leave two of the three Zeta castes unmeetable in
            // almost every world.
            // The population answer DOES apply here, unlike the beta one: a
            // goblin world is goblins and a monster world has nothing that
            // reads as a person in it, and all six alien sheets are Humanoid,
            // so both modes empty this pool and pickNpcKey deals from the
            // ordinary one alone.
            alienKeys() {
                const mode = this.populationMode();
                const magic = (window.MagicNature && window.MagicNature.level()) || "normal";
                const slot = "alienAll:" + mode + ":" + magic;
                if (!poolCache[slot]) {
                    const data = db();
                    poolCache[slot] = Object.keys(data).filter(k => {
                        const e = data[k];
                        if (!e || e.npc !== true || e.aliens !== true) return false;
                        // Every alien sheet is mundane by decree, so an unbound
                        // world has none of them and a severed one keeps all six.
                        if (!this.allowedInMagic(k, e)) return false;
                        return this.allowedInPopulation(k, e, mode);
                    });
                }
                return poolCache[slot];
            },

            // Is this map one of the travel interiors? The PublicTransport map
            // group is the answer, read from MapGroups.json rather than listed
            // here, so a wagon added to the group is covered without a change.
            isTransportMap(mapId) {
                const id = Number(mapId);
                if (!Number.isFinite(id)) return false;
                const groups = (window.WorldGen && window.WorldGen.MapGroups) || null;
                const maps = groups && groups[TRANSPORT_GROUP] && groups[TRANSPORT_GROUP].maps;
                if (Array.isArray(maps)) return maps.indexOf(id) >= 0;
                return !!(window.NPCSystem && window.NPCSystem.findMapGroupByMap &&
                    window.NPCSystem.findMapGroupByMap(id) === TRANSPORT_GROUP);
            },

            // A hand-authored landing site on a world that is not Earth. Asked
            // of GalaxySim, which is the only thing that knows where the ship
            // set the party down (an authored map says nothing about it itself).
            isOffworldSite(mapId) {
                const GS = window.GalaxySim;
                if (!GS || typeof GS.offworldLandingSite !== "function") return false;
                const site = GS.offworldLandingSite();
                if (!site) return false;
                const id = Number(mapId);
                return !Number.isFinite(id) || site.mapId === id;
            },

            // The share of rolled faces that are alien where this pick is made.
            alienShare(options) {
                const mapId = (options && options.mapId !== undefined)
                    ? options.mapId
                    : (window.$gameMap && $gameMap.mapId ? $gameMap.mapId() : null);
                if (this.isOffworldSite(mapId)) return ALIEN_SHARE_OFFWORLD;
                return this.isTransportMap(mapId) ? ALIEN_SHARE_TRANSPORT : ALIEN_SHARE;
            },

            // Deal one sheet from a single draw r in [0,1). The draw is read as
            // an inverse CDF over the two pools rather than rolled twice, so a
            // caller holding one seeded float (which is every caller: an NPC's
            // face has to be the same face in every savegame of the world) still
            // gets both the exact share and a uniform pick inside the pool.
            // options: { mapId, includeBeta, filter }.
            pickNpcKey(r, options) {
                const opts = options || {};
                let pool = this.npcKeys(opts);
                let aliens = this.alienKeys();
                if (typeof opts.filter === "function") {
                    pool = pool.filter(opts.filter);
                    aliens = aliens.filter(opts.filter);
                }
                if (!pool.length && !aliens.length) return null;
                const draw = (typeof r === "number" && r >= 0 && r < 1) ? r : Math.random();
                const share = aliens.length ? (pool.length ? this.alienShare(opts) : 1) : 0;
                if (draw < share) {
                    return aliens[Math.min(aliens.length - 1, Math.floor((draw / share) * aliens.length))];
                }
                const rest = (draw - share) / (1 - share);
                return pool[Math.min(pool.length - 1, Math.floor(rest * pool.length))];
            },

            // May the spawn systems deal this sheet in this world?
            isSpawnable(key) {
                const e = this.entry(key);
                if (!e || e.npc !== true) return false;
                return e.beta !== true || this.betaEnabled();
            }
        };
    })();

    // ── Retired sheets are repointed the moment a graphic is set ────────────
    // One rule at the two doors every character graphic goes through, so a
    // world folder or a savegame written before the sheets were cut renders
    // the same people it always did. Game_CharacterBase.setImage covers every
    // map character (a transplanted NPC event, the player, a follower, a
    // vehicle) and Game_Actor.setCharacterImage the party's own graphics;
    // characterName() then answers the new name, so the bust lookups that read
    // it resolve too. ImageManager.loadCharacter is the backstop for a caller
    // that draws a stored name without going through either, where the cell is
    // not known and the sheet's first face has to stand for it.
    (function () {
        function repoint(name, index) {
            const SC = window.SpriteCatalog;
            return (SC && SC.legacySheet) ? SC.legacySheet(name, index) : null;
        }

        const _setImage = Game_CharacterBase.prototype.setImage;
        Game_CharacterBase.prototype.setImage = function (characterName, characterIndex) {
            const now = repoint(characterName, characterIndex);
            if (now) return _setImage.call(this, now.name, now.index);
            return _setImage.call(this, characterName, characterIndex);
        };

        const _setCharacterImage = Game_Actor.prototype.setCharacterImage;
        Game_Actor.prototype.setCharacterImage = function (characterName, characterIndex) {
            const now = repoint(characterName, characterIndex);
            if (now) return _setCharacterImage.call(this, now.name, now.index);
            return _setCharacterImage.call(this, characterName, characterIndex);
        };

        const _loadCharacter = ImageManager.loadCharacter;
        ImageManager.loadCharacter = function (filename) {
            const now = repoint(filename, 0);
            return _loadCharacter.call(this, now ? now.name : filename);
        };
    })();

    // ── Destinations.json → display names ───────────────────────────────────
    // Every entry in js/db/WorkSystem/Destinations.json carries a "name" field:
    // the readable form of the place ("GreenWitch" -> "Green Witch"). The object
    // key stays the identity used by every lookup, save record and event name
    // ("Teleport - <key>"), so anything shown to the player resolves the label
    // through here instead of printing the key. Unknown strings pass through, so
    // a place name saved before this field existed still reads correctly, and
    // the result goes through the localization layer like any other data string.
    (function () {
        const destNorm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
        let destIndex = null;

        function buildIndex() {
            if (destIndex) return destIndex;
            destIndex = {};
            const dest = (window.WorkSystem && window.WorkSystem.Destinations) || {};
            for (const [key, data] of Object.entries(dest)) {
                const label = (data && typeof data.name === 'string' && data.name.trim()) || key;
                destIndex[destNorm(key)] = label;
                destIndex[destNorm(label)] = label;
            }
            return destIndex;
        }

        window.WorkSystem = window.WorkSystem || {};

        // Readable name of a destination, from its key or from any spelling of it.
        window.WorkSystem.destinationName = function (key) {
            const raw = String(key == null ? '' : key);
            if (!raw) return raw;
            const label = buildIndex()[destNorm(raw)] || raw;
            return (typeof window.translateText === 'function') ? window.translateText(label) : label;
        };

        // Every destination label, in the order the file declares them.
        window.WorkSystem.destinationNames = function () {
            const dest = (window.WorkSystem && window.WorkSystem.Destinations) || {};
            return Object.keys(dest).map(window.WorkSystem.destinationName);
        };
    })();

    // ── i18n: key-based resolver for plugin strings ─────────────────────────
    // Plugin UI and dialogue strings live in js/i18n/<lang>/plugins/<Name>.json
    // and are addressed by key ("ErisTrial.verdict.guilty"). English is always
    // loaded as the fallback layer, so a missing or blank translation reads as
    // English rather than as a broken key.
    //
    // The plugins/ subfolder is deliberate: Hendrix_Localization discovers
    // js/i18n/<lang>/*.json non-recursively, so these keyed files stay out of
    // its English-source replacement map and cannot rewrite unrelated text.
    //
    // Interpolation substitutes {name} ONLY for names present in `params`.
    // Every other brace group passes through verbatim, which is what lets the
    // procedural grammars ({faction}, {a|b|c}) survive this layer untouched.
    // Namespace roots under js/i18n/<lang>/. `plugins` holds UI and system copy;
    // `conversations` holds the NPC dialogue banks and `lore` the database flavour
    // text (the <Lore:>/<En:> note tags), which are big enough that
    // mixing them into the same folder would bury everything else. Namespaces
    // are merged into one flat map, so a file name must be unique across roots.
    const I18N_SUBS = ['plugins', 'conversations', 'lore'];
    const I18N_FALLBACK = 'en';

    let _i18nBase = {};      // English layer, always present
    let _i18nOver = {};      // active language layer, empty when playing in en
    let _i18nCode = null;    // language the override layer was built from
    let _i18nManifest = null;
    const _i18nMissing = new Set();

    function i18nReadFolderNw(lang) {
        const fs = require('fs');
        const path = require('path');
        const out = {};
        I18N_SUBS.forEach(function (sub) {
            const dir = path.join(process.cwd(), 'js', 'i18n', lang, sub);
            if (!fs.existsSync(dir)) return;
            fs.readdirSync(dir).forEach(function (file) {
                if (path.extname(file).toLowerCase() !== '.json') return;
                const ns = path.basename(file, '.json');
                try {
                    let text = fs.readFileSync(path.join(dir, file), 'utf8');
                    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                    if (out[ns]) console.warn('DataService i18n: namespace "' + ns + '" declared in more than one folder.');
                    out[ns] = JSON.parse(text);
                } catch (e) {
                    console.error('DataService i18n: failed to load ' + lang + '/' + sub + '/' + file + ': ' + e.message);
                }
            });
        });
        return out;
    }

    function i18nManifest() {
        if (_i18nManifest) return _i18nManifest;
        _i18nManifest = {};
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'js/i18n_manifest.json', false);
            xhr.send();
            if (xhr.status === 200) {
                let text = xhr.responseText;
                if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                _i18nManifest = JSON.parse(text);
            }
        } catch (e) {
            console.warn('DataService i18n: no js/i18n_manifest.json, plugin strings will read as keys.');
        }
        return _i18nManifest;
    }

    function i18nReadFolderBrowser(lang) {
        const out = {};
        // Manifest entries carry their folder ("plugins/Titlescreen.json").
        (i18nManifest()[lang] || []).forEach(function (file) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', 'js/i18n/' + lang + '/' + file, false);
                xhr.send();
                if (xhr.status === 200) {
                    let text = xhr.responseText;
                    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                    out[file.replace(/^.*\//, '').replace(/\.json$/i, '')] = JSON.parse(text);
                }
            } catch (e) {
                console.error('DataService i18n: failed to load ' + lang + '/' + file + ': ' + e.message);
            }
        });
        return out;
    }

    const i18nReadFolder = Utils.isNwjs() ? i18nReadFolderNw : i18nReadFolderBrowser;

    // ConfigManager.language is only populated once ConfigManager.load() has run
    // in Scene_Boot, well after this plugin loads. Rather than wire a callback,
    // every lookup compares the active language against the layer it built and
    // rebuilds on change, which also makes runtime language switching automatic.
    function i18nSync() {
        const lang = String((typeof ConfigManager !== 'undefined' && ConfigManager.language) || I18N_FALLBACK);
        if (lang === _i18nCode) return;
        if (_i18nCode === null) _i18nBase = i18nReadFolder(I18N_FALLBACK);
        _i18nOver = (lang === I18N_FALLBACK) ? {} : i18nReadFolder(lang);
        _i18nCode = lang;
        _i18nMissing.clear();
    }

    function i18nDig(root, parts) {
        let cur = root;
        for (let i = 0; i < parts.length; i++) {
            if (cur === null || typeof cur !== 'object') return undefined;
            cur = cur[parts[i]];
        }
        return cur;
    }

    function i18nWarn(key) {
        if (_i18nMissing.has(key)) return;
        _i18nMissing.add(key);
        if (Utils.isOptionValid('test')) {
            console.warn('i18n: missing key "' + key + '"');
        }
    }

    function i18nInterp(text, params) {
        if (!params) return text;
        return text.replace(/\{(\w+)\}/g, function (whole, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
        });
    }

    // Layer the active language over English value by value. A blank string in
    // the override means "not translated yet" and falls through to English, so
    // a freshly cloned language folder is a fully playable English game.
    function i18nMergeValue(base, over) {
        if (over === undefined) return base;
        if (typeof over === 'string') return over.trim() ? over : base;
        if (Array.isArray(over)) {
            const b = Array.isArray(base) ? base : [];
            const len = Math.max(b.length, over.length);
            const out = [];
            for (let i = 0; i < len; i++) out.push(i18nMergeValue(b[i], over[i]));
            return out;
        }
        if (typeof over === 'object') {
            const b = (base && typeof base === 'object' && !Array.isArray(base)) ? base : {};
            const out = {};
            Object.keys(b).forEach(function (k) { out[k] = b[k]; });
            Object.keys(over).forEach(function (k) { out[k] = i18nMergeValue(b[k], over[k]); });
            return out;
        }
        return over;
    }

    function T(key, params) {
        i18nSync();
        const parts = String(key).split('.');
        const over = i18nDig(_i18nOver, parts);
        if (typeof over === 'string' && over.trim()) return i18nInterp(over, params);
        const base = i18nDig(_i18nBase, parts);
        if (typeof base === 'string') return i18nInterp(base, params);
        i18nWarn(key);
        return key;
    }

    // Content banks. Falls back element by element, and honours an override
    // longer than English so a language may carry extra wording variants.
    T.list = function (key, params) {
        i18nSync();
        const parts = String(key).split('.');
        const base = i18nDig(_i18nBase, parts);
        const over = i18nDig(_i18nOver, parts);
        const baseArr = Array.isArray(base) ? base : null;
        const overArr = Array.isArray(over) ? over : null;
        if (!baseArr && !overArr) {
            i18nWarn(key);
            return [];
        }
        const len = Math.max(baseArr ? baseArr.length : 0, overArr ? overArr.length : 0);
        const out = [];
        for (let i = 0; i < len; i++) {
            const o = overArr ? overArr[i] : undefined;
            const b = baseArr ? baseArr[i] : undefined;
            const v = (typeof o === 'string' && o.trim()) ? o : b;
            if (typeof v === 'string') out.push(i18nInterp(v, params));
            else if (v !== undefined) out.push(v);
        }
        return out;
    };

    // A randomised POOL, not a list of distinct slots. Where T.list merges index
    // by index (so a short translation shows English in the gaps), a pool is
    // taken from the active language whole or not at all: a language may offer
    // 40 names where English offers 170 without English ones leaking in.
    // Use this for name banks and phrase pools; use T.list where each index
    // means something specific.
    T.pool = function (key) {
        i18nSync();
        const parts = String(key).split('.');
        const over = i18nDig(_i18nOver, parts);
        if (Array.isArray(over) && over.some(function (v) { return typeof v === 'string' && v.trim(); })) {
            return over.slice();
        }
        const base = i18nDig(_i18nBase, parts);
        if (Array.isArray(base)) return base.slice();
        i18nWarn(key);
        return [];
    };

    T.obj = function (key) {
        i18nSync();
        const parts = String(key).split('.');
        const base = i18nDig(_i18nBase, parts);
        const over = i18nDig(_i18nOver, parts);
        if (base === undefined && over === undefined) {
            i18nWarn(key);
            return {};
        }
        return i18nMergeValue(base, over);
    };

    T.n = function (key, count, params) {
        const p = Object.assign({ count: count }, params || {});
        const sub = count === 1 ? '.one' : '.other';
        return T.has(key + sub) ? T(key + sub, p) : T(key, p);
    };

    T.has = function (key) {
        i18nSync();
        const parts = String(key).split('.');
        return i18nDig(_i18nBase, parts) !== undefined ||
               i18nDig(_i18nOver, parts) !== undefined;
    };

    // Plugin-parameter defaults (js/plugins.js) are user-facing but live outside
    // the code. Pass the parameter value plus the key holding the shipped
    // default: an untouched parameter localises, one a player or mod edited
    // wins as written.
    T.param = function (value, key) {
        i18nSync();
        if (value === undefined || value === null || value === '') return T(key);
        const shipped = i18nDig(_i18nBase, String(key).split('.'));
        return (typeof shipped === 'string' && String(value) === shipped) ? T(key) : String(value);
    };

    T.reload = function () {
        _i18nCode = null;
        _i18nManifest = null;
        i18nSync();
    };

    T.language = function () {
        i18nSync();
        return _i18nCode;
    };

    // Namespaces currently loaded, for the debug console and the key checker.
    T.namespaces = function () {
        i18nSync();
        return Object.keys(_i18nBase).sort();
    };

    window.T = T;
    window.I18N = T;
    i18nSync();
    console.log('DataService: i18n resolver ready (' + T.namespaces().length + ' namespaces).');

    // ── Biome display names ─────────────────────────────────────────────────
    // A biome's `name` in Biomes.json is its identity, not its label: roads,
    // prefabs, enemy <Biome:> tags, battleback folders, map <Biome:> notes and
    // every generator branch match on it, so it can never be reworded. What the
    // player reads is resolved here instead, in this order:
    //
    //   1. a translation under the i18n key "Biomes.<id>", when the game is not
    //      being played in English;
    //   2. the biome's own `displayName` field, which is where an id that does
    //      not read as English is fixed ("ForestTropical" -> "Tropical Forest");
    //   3. the English "Biomes.<id>" entry, so a biome can be named from the
    //      i18n file alone (that file is also the translators' source list);
    //   4. the CamelCase split ("SpiritWoods" -> "Spirit Woods"), which is what
    //      most ids already amount to.
    //
    // `displayName` deliberately outranks the English i18n entry: editing
    // Biomes.json is how a biome is renamed, and an English copy of the name
    // sitting in front of the data file would silently ignore that edit.
    (function () {
        let index = null;
        let indexSize = -1;

        function biomeList() {
            return (window.WorldGen && Array.isArray(window.WorldGen.Biomes))
                ? window.WorldGen.Biomes : [];
        }

        // Rebuilt whenever the catalogue grows: the alien biomes are merged in
        // above, and a mod may append more after this plugin has run.
        function biomeIndex() {
            const list = biomeList();
            if (index && indexSize === list.length) return index;
            index = {};
            list.forEach(function (b) {
                if (b && b.name) index[String(b.name).toLowerCase()] = b;
            });
            indexSize = list.length;
            return index;
        }

        function splitCamel(id) {
            return String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        }

        function translated(id) {
            const key = 'Biomes.' + id;
            return (T.language() !== I18N_FALLBACK && T.has(key)) ? T(key) : null;
        }

        function english(id) {
            const key = 'Biomes.' + id;
            return T.has(key) ? T(key) : null;
        }

        window.BiomeNames = {
            // The readable name of one biome id. An id the catalogue does not
            // know still reads, through the CamelCase split, so a map note or a
            // mod naming an unlisted biome degrades instead of showing nothing.
            display: function (id) {
                const raw = String(id == null ? '' : id).trim();
                if (!raw) return '';
                const entry = biomeIndex()[raw.toLowerCase()];
                const name = entry ? entry.name : raw;
                return translated(name) ||
                       (entry && typeof entry.displayName === 'string' && entry.displayName.trim()
                           ? entry.displayName.trim() : null) ||
                       english(name) ||
                       splitCamel(name);
            },

            // A comma-separated list of ids ("Ice, Permafrost, ForestIce"), the
            // shape the enemy <Biome:> tag stores, resolved name by name.
            displayList: function (ids) {
                return String(ids == null ? '' : ids)
                    .split(',')
                    .map(function (s) { return window.BiomeNames.display(s); })
                    .filter(function (s) { return !!s; })
                    .join(', ');
            },

            // The Biomes.json entry behind an id, or null. Exposed so callers
            // that already need the record do not build a second index.
            entry: function (id) {
                const raw = String(id == null ? '' : id).trim();
                return raw ? (biomeIndex()[raw.toLowerCase()] || null) : null;
            }
        };
    })();
})();
