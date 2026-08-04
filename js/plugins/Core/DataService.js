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

    // ── SpritesAssociation → NPCs.json canonical migration ──────────────────
    // NPCs.json (window.WorldGen.NPCs) is the single source of truth for sprite↔bust mapping.
    // All bust plugins use: SpritesAssociation[spriteName][characterIndex] → bustName
    // NPCs.json stores:    { spriteName: { busts: ["bust0","bust1",...], npc, Archetype, Gender } }
    // Rebuild window.Sprites.SpritesAssociation from NPCs.json busts arrays so all bust
    // plugins transparently read from NPCs.json without any code changes in those plugins.
    if (window.WorldGen && window.WorldGen.NPCs && window.Sprites) {
        const rebuilt = {};
        for (const [key, val] of Object.entries(window.WorldGen.NPCs)) {
            rebuilt[key] = Array.isArray(val) ? val : (val.busts || []);
        }
        window.Sprites.SpritesAssociation = rebuilt;
        console.log("DataService: SpritesAssociation rebuilt from NPCs.json (" +
                    Object.keys(rebuilt).length + " entries).");
    }

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
})();
