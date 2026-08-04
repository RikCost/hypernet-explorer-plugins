/*:
 * @target MZ
 * @plugindesc Tech Tree (Data) v2.1.0 - world-shared discoveries, material-gated research, discoverer tracking
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help
 * ============================================================================
 * Tech Tree - Data layer
 * ============================================================================
 *
 * Seven research trees, one per discipline, defined in js/db/TechTree/*.json
 * and loaded through DataService as window.TechTree.<File>:
 *
 *   Social Sciences, Alchemistry, Technomagica, Physics, Arcane,
 *   Mathematics, Astronomy, Theotecnical.
 *
 * The db files hold structure only. A tree's title and blurb and every node's
 * name and description live in the i18n namespace TechTree<TreeId>
 * (js/i18n/<lang>/plugins/TechTreePhysics.json and friends), keyed by the node
 * id, so the id carried in the db IS the i18n key. Read them through
 * window.ProceduralTechTree.treeName / treeBlurb / nodeName / nodeDesc, never
 * off the object.
 *
 * Each tree is a directed acyclic graph of discovery nodes. Real-science
 * trees follow the actual arc of progress from 2001 to 2012; the Arcane and
 * Technomagica trees follow the in-world rediscovery of lost magic and the
 * fusion of magic with technology by Esoteric Heavy Industries, and the
 * Theotecnical tree follows the Holy Vatican Empire rebuilding its citadel,
 * its mission field and its dogma around machinery. Every tree
 * also carries a handful of "fringe" pseudoscientific side-nodes and a handful
 * of procedural nodes seeded from the WorldManager world seed.
 *
 * WORLD-SHARED DISCOVERIES
 * ------------------------
 * A discovery belongs to the WORLD, not to a single savegame. Completed nodes
 * (and the party leader who discovered each one first) live in the world folder
 * (save/worlds/<World>/techtree.json), so every savegame of that world shares
 * the same tech tree. The permanent stat buffs are reconciled onto the party in
 * every save, so all saves benefit from anything discovered anywhere in the
 * world. The one-off item / weapon / armor / gold / EXP rewards go only to the
 * save whose party discovered the node first. Without an active world the state
 * falls back to the savegame ($gameSystem).
 *
 * Researching a node consumes the crafting materials it lists (the same base
 * materials used by ThinkerMenu, ids 849-871), then returns most of that cost
 * back as refined byproduct materials (see materialPayout) so research feeds
 * the crafting economy rather than draining it. This file is data/logic only;
 * ProceduralTechTreeUI.js draws the book.
 *
 * @param menuName
 * @text Menu Name
 * @desc Label for the main-menu command.
 * @default Research
 *
 * @param showInMenu
 * @text Show in Main Menu
 * @desc Add the tech tree to the main menu.
 * @type boolean
 * @default true
 *
 * @command openTechTree
 * @text Open Tech Tree
 * @desc Opens the tech tree interface.
 *
 * @command resetProgress
 * @text Reset Research Progress
 * @desc Clears all completed research for the active world (does not refund materials).
 */

(() => {
    'use strict';

    const pluginName = 'ProceduralTechTree';
    const parameters = PluginManager.parameters(pluginName);
    const MENU_NAME = T.param(parameters['menuName'], 'TechTree.menuName');
    const SHOW_IN_MENU = parameters['showInMenu'] !== 'false';

    // Tab order (horizontal tabs). Matches the db_manifest listing.
    // i18n-ignore-start  tree ids, matched against js/db/TechTree file names
    const TREE_ORDER = [
        'SocialSciences', 'Alchemistry', 'Technomagica',
        'Physics', 'Arcane', 'Mathematics', 'Astronomy',
        'Theotecnical'
    ];
    // i18n-ignore-end

    // Correct material item ids (verified against data/Items.json). Same base
    // reagents ThinkerMenu crafts with.
    const MAT_POOL = {
        tech:       [851, 852, 853, 854],
        synthetic:  [855, 856, 857, 867],
        metals:     [863, 864, 865],
        arcane:     [849, 850, 866],
        organic:    [858, 859, 860, 861, 868],
        alchemical: [862, 869, 870, 871]
    };

    const STAT_BUFFS = ['mhp', 'mmp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk'];

    // Which party/troop stat governs the passive production rate of each
    // material pool (Army/ArmyManager.js "scientist" workforce troops, see
    // workforceDailyOutput below): raw/metal labor leans STR, precision
    // electronics and arcana lean INT, fine synthetics lean DEX, and
    // alchemical reagents lean WIS.
    const POOL_STAT = {
        tech:       'mat',
        synthetic:  'agi',
        metals:     'atk',
        arcane:     'mat',
        organic:    'atk',
        alchemical: 'mdf'
    };
    function materialStat(itemId) {
        for (const poolName in MAT_POOL) {
            if (MAT_POOL[poolName].indexOf(itemId) !== -1) return POOL_STAT[poolName] || 'atk';
        }
        return 'atk';
    }

    // Word banks live in the namespace: a procedural node's name is composed
    // per language, because Italian puts the head noun first.
    const PROC_THEME = {
        Physics: { pools: ['tech', 'synthetic', 'metals'], stats: ['mat', 'mmp', 'def', 'agi'] },
        Astronomy: { pools: ['tech', 'synthetic', 'metals'], stats: ['mmp', 'mhp', 'luk', 'mat'] },
        Mathematics: { pools: ['tech', 'synthetic'], stats: ['mat', 'luk', 'mdf'] },
        Alchemistry: { pools: ['alchemical', 'metals', 'organic'], stats: ['mdf', 'mhp', 'atk', 'def'] },
        SocialSciences: { pools: ['organic', 'tech'], stats: ['luk', 'agi', 'mdf', 'mat'] },
        Arcane: { pools: ['arcane', 'organic'], stats: ['mmp', 'mat', 'mdf', 'luk'] },
        Technomagica: { pools: ['tech', 'arcane', 'synthetic'], stats: ['mat', 'mmp', 'atk'] },
        Theotecnical: { pools: ['metals', 'tech', 'arcane'], stats: ['def', 'mdf', 'atk', 'mhp'] }
    };

    // --------------------------------------------------------------- seeding
    function worldSeed() {
        try {
            if (window.ProcGenUtils && typeof window.ProcGenUtils.getWorldSeed === 'function') {
                return window.ProcGenUtils.getWorldSeed();
            }
            if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
                const s = window.HistoryManager.getSeed();
                if (typeof s === 'number') return s >>> 0;
            }
        } catch (e) { /* fall through */ }
        return 19002001;
    }

    function makeRng(seed) {
        if (window.ProcGenUtils && typeof window.ProcGenUtils.createSeededRandom === 'function') {
            return window.ProcGenUtils.createSeededRandom(seed >>> 0);
        }
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
        };
    }

    function hashStr(str) {
        let h = 0x811c9dc5;
        str = String(str);
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }

    // ------------------------------------------------------------- db access
    function readTreeFile(fileKey) {
        // 1) DataService populated window.TechTree.<File> at boot.
        if (window.TechTree && window.TechTree[fileKey]) return window.TechTree[fileKey];
        function cache(data) { if (!window.TechTree) window.TechTree = {}; window.TechTree[fileKey] = data; return data; }
        // 2) NW.js desktop: read straight off disk (robust even if DataService
        //    skipped the folder).
        try {
            if (typeof Utils !== 'undefined' && Utils.isNwjs && Utils.isNwjs() && typeof require === 'function') {
                const fs = require('fs'); const path = require('path');
                const base = path.dirname(process.mainModule.filename);
                const fp = path.join(base, 'js', 'db', 'TechTree', fileKey + '.json');
                if (fs.existsSync(fp)) {
                    let txt = fs.readFileSync(fp, 'utf8');
                    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
                    return cache(JSON.parse(txt));
                }
            }
        } catch (e) {
            console.error('[TechTree] fs read failed for ' + fileKey, e);
        }
        // 3) Browser: synchronous XHR.
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'js/db/TechTree/' + fileKey + '.json', false);
            xhr.send();
            if (xhr.status === 200 || xhr.status === 0) {
                return cache(JSON.parse(xhr.responseText));
            }
        } catch (e) {
            console.error('[TechTree] failed to load ' + fileKey, e);
        }
        return null;
    }

    // ------------------------------------------------------------ tree text
    // The db files under js/db/TechTree carry structure only: ids, phases,
    // prerequisites, materials, buffs and rewards. Every readable string lives
    // in the namespace TechTree<TreeId> (js/i18n/<lang>/plugins/), keyed by the
    // node id, so a node's own id IS its i18n key. Resolution happens on read
    // rather than at build time, because the built trees are cached per world
    // seed and would otherwise freeze the language they were built under.
    // Procedural nodes are the exception: their names are composed from the
    // world seed at build time and carried literally on the node.
    // The prefixes are written out one per tree rather than pasted together
    // from the tree id, so the key checker (tools/i18n/check-keys.js) can see
    // that these subtrees are in use.
    const TREE_KEY = {
        SocialSciences: k => 'TechTreeSocialSciences.' + k,
        Alchemistry:    k => 'TechTreeAlchemistry.' + k,
        Technomagica:   k => 'TechTreeTechnomagica.' + k,
        Physics:        k => 'TechTreePhysics.' + k,
        Arcane:         k => 'TechTreeArcane.' + k,
        Mathematics:    k => 'TechTreeMathematics.' + k,
        Astronomy:      k => 'TechTreeAstronomy.' + k,
        Theotecnical:   k => 'TechTreeTheotecnical.' + k
    };
    function treeKey(treeId, sub) {
        const build = TREE_KEY[treeId];
        return build ? build(sub) : 'TechTree' + treeId + '.' + sub;
    }
    function treeName(tree) { return tree ? T(treeKey(tree.id, 'name')) : ''; }
    function treeBlurb(tree) { return tree ? T(treeKey(tree.id, 'blurb')) : ''; }
    function nodeName(node) {
        if (!node) return '';
        return node._nameKey ? T(node._nameKey) : (node.name || '');
    }
    function nodeDesc(node) {
        if (!node) return '';
        return node._descKey ? T(node._descKey) : (node.desc || '');
    }

    // ---------------------------------------------------------- tree builder
    let _builtSeed = null;
    let _builtTrees = null;

    function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

    function generateProcNodes(tree, realNodes, seed) {
        const count = Number(tree.procCount) || 0;
        if (count <= 0) return [];
        // i18n-ignore-start  tree ids
        const theme = PROC_THEME[tree.id] || PROC_THEME.Physics;
        const themeKey = PROC_THEME[tree.id] ? tree.id : 'Physics';
        // i18n-ignore-end
        const bank = (part) => T.pool('TechTree.theme.' + themeKey + '.' + part);
        const rng = makeRng((seed >>> 0) ^ hashStr('proc:' + tree.id));
        const anchors = realNodes.filter(n => !n.fringe && (n.requires || []).length > 0);
        const anchorPool = anchors.length ? anchors : realNodes.filter(n => !n.fringe);
        const out = [];
        const usedNames = new Set(realNodes.map(n => nodeName(n)));
        for (let i = 0; i < count && anchorPool.length; i++) {
            const anchor = pick(rng, anchorPool);
            let name, tries = 0;
            do {
                name = T('TechTree.procName', {
                    a: pick(rng, bank('a')),
                    b: pick(rng, bank('b')),
                    c: pick(rng, bank('c'))
                });
                tries++;
            } while (usedNames.has(name) && tries < 24);
            usedNames.add(name);

            const depthHint = anchor._depth || 1;
            const nMats = 2 + (i % 2);
            const materials = [];
            const usedMat = new Set();
            for (let m = 0; m < nMats; m++) {
                const pool = MAT_POOL[pick(rng, theme.pools)] || MAT_POOL.tech;
                let id = pick(rng, pool), guard = 0;
                while (usedMat.has(id) && guard++ < 8) id = pick(rng, pool);
                usedMat.add(id);
                const qty = 80 + Math.floor(rng() * (100 + depthHint * 60));
                materials.push({ id: id, qty: qty });
            }
            const buffs = {};
            const nBuffs = 1 + Math.floor(rng() * 2);
            for (let b = 0; b < nBuffs; b++) {
                const stat = pick(rng, theme.stats);
                const base = (stat === 'mhp' || stat === 'mmp') ? 10 + Math.floor(rng() * 15) : 1 + Math.floor(rng() * 3);
                buffs[stat] = (buffs[stat] || 0) + base;
            }
            out.push({
                id: 'proc_' + tree.id + '_' + i,
                name: name,
                phase: 'Speculative',  // i18n-ignore  phase id, resolved for display
                year: tree.real ? (2001 + (i % 12)) : undefined,
                requires: [anchor.id],
                desc: T('TechTree.procDesc'),
                materials: materials,
                buffs: buffs,
                procedural: true
            });
        }
        return out;
    }

    function computeDepths(nodes) {
        const byId = {};
        nodes.forEach(n => { byId[n.id] = n; });
        const memo = {};
        function depth(id, stack) {
            if (memo[id] !== undefined) return memo[id];
            const n = byId[id];
            if (!n) return 0;
            const reqs = (n.requires || []).filter(r => byId[r]);
            if (!reqs.length) { memo[id] = 0; return 0; }
            if (stack.has(id)) { memo[id] = 0; return 0; }
            stack.add(id);
            let d = 0;
            for (const r of reqs) d = Math.max(d, depth(r, stack) + 1);
            stack.delete(id);
            memo[id] = d;
            return d;
        }
        nodes.forEach(n => { n._depth = depth(n.id, new Set()); });
    }

    function buildTree(fileKey, seed) {
        const raw = readTreeFile(fileKey);
        if (!raw) return null;
        const nodes = raw.nodes.map(n => Object.assign({}, n, {
            requires: (n.requires || []).slice(),
            materials: (n.materials || []).map(m => ({ id: m.id, qty: m.qty })),
            buffs: Object.assign({}, n.buffs || {}),
            _nameKey: treeKey(raw.id, 'nodes.' + n.id + '.name'),
            _descKey: treeKey(raw.id, 'nodes.' + n.id + '.desc')
        }));
        computeDepths(nodes);
        const proc = generateProcNodes(raw, nodes, seed);
        const all = nodes.concat(proc);
        computeDepths(all);
        const byId = {};
        all.forEach(n => { byId[n.id] = n; });
        return {
            id: raw.id,
            fileKey: fileKey,
            icon: raw.icon || 0,
            accent: raw.accent || '#8b5a2b',
            real: !!raw.real,
            nodes: all,
            byId: byId
        };
    }

    function buildAllTrees() {
        const seed = worldSeed();
        if (_builtTrees && _builtSeed === seed) return _builtTrees;
        _builtSeed = seed;
        _builtTrees = [];
        for (const key of TREE_ORDER) {
            const t = buildTree(key, seed);
            if (t) _builtTrees.push(t);
        }
        return _builtTrees;
    }

    // ================================================================ state
    // World-shared store when a world is active, else per-savegame fallback.
    function usingWorld() {
        return !!(window.WorldManager && window.WorldManager.activeWorldName);
    }

    function techStore() {
        if (usingWorld()) {
            const f = window.WorldManager.getFile('techtree');
            if (!f.completed) f.completed = {};
            if (!f.discoverers) f.discoverers = {};
            if (!f.feed) f.feed = [];
            // One-time migration of any legacy per-save progress into the world.
            const legacy = $gameSystem && $gameSystem._techTreeState;
            if (legacy && legacy.completed && Object.keys(f.completed).length === 0) {
                Object.assign(f.completed, legacy.completed);
                if (legacy.discoverers) Object.assign(f.discoverers, legacy.discoverers);
            }
            return f;
        }
        if (!$gameSystem._techTreeState) $gameSystem._techTreeState = { completed: {}, discoverers: {}, feed: [] };
        const s = $gameSystem._techTreeState;
        if (!s.discoverers) s.discoverers = {};
        if (!s.feed) s.feed = [];
        return s;
    }

    function key(treeId, nodeId) { return treeId + ':' + nodeId; }

    function isCompleted(treeId, nodeId) {
        return !!techStore().completed[key(treeId, nodeId)];
    }
    function discovererOf(treeId, nodeId) {
        return techStore().discoverers[key(treeId, nodeId)] || null;
    }

    function currentLeaderName() {
        try {
            const leader = $gameParty && $gameParty.leader && $gameParty.leader();
            if (leader && leader.name) return leader.name();
            const a1 = $gameActors && $gameActors.actor(1);
            if (a1) return a1.name();
        } catch (e) { /* ignore */ }
        return T('TechTree.unknownDiscoverer');
    }

    function recordCompletion(treeId, node) {
        const store = techStore();
        const k = key(treeId, node.id);
        store.completed[k] = true;
        const leader = currentLeaderName();
        const minute = (typeof $gameVariables !== 'undefined' && $gameVariables) ? Number($gameVariables.value(114)) || 0 : 0;
        const date = (typeof $gameVariables !== 'undefined' && $gameVariables) ? Number($gameVariables.value(113)) || 0 : 0;
        store.discoverers[k] = { leader: leader, minute: minute, date: date };
        // Discovery feed (capped) drives NPC gossip.
        store.feed.unshift({
            treeId: treeId, nodeId: node.id, name: nodeName(node),
            leader: leader, nobel: !!node.nobelWorthy, fringe: !!node.fringe,
            procedural: !!node.procedural, minute: minute
        });
        if (store.feed.length > 60) store.feed.length = 60;
        return store.discoverers[k];
    }

    function prereqsMet(tree, node) {
        return (node.requires || []).every(r => !tree.byId[r] || isCompleted(tree.id, r));
    }
    function materialsSatisfied(node) {
        if ($gameSystem && $gameSystem._isSandboxMode) return true;
        return (node.materials || []).every(m => {
            const item = $dataItems[m.id];
            return item && $gameParty.numItems(item) >= m.qty;
        });
    }
    function isAvailable(tree, node) {
        return !isCompleted(tree.id, node.id) && prereqsMet(tree, node);
    }
    function canResearch(tree, node) {
        return isAvailable(tree, node) && materialsSatisfied(node);
    }

    function nodeRewards(node) {
        const depth = (node._depth || 0) + 1;
        let scale = node.fringe ? 0.5 : 1;
        if (node.nobelWorthy) scale *= 1.4; // Nobel-worthy work pays out a bit more.
        return {
            exp: Math.floor(15 * depth * scale),
            gold: Math.floor(35 * depth * scale)
        };
    }

    // Researching a node returns most of what it consumed as refined byproduct
    // materials, so the tech tree feeds the crafting economy instead of being a
    // pure sink. Fringe "science" wastes half its inputs; Nobel-worthy work
    // recovers a bit more.
    function materialPayout(node) {
        let mult = node.fringe ? 0.5 : 0.85;
        if (node.nobelWorthy) mult += 0.15;
        return (node.materials || []).map(m => ({ id: m.id, qty: Math.max(1, Math.round(m.qty * mult)) }));
    }
    function rewardDbEntry(reward) {
        if (!reward) return null;
        if (reward.kind === 'weapon') return $dataWeapons[reward.id];
        if (reward.kind === 'armor') return $dataArmors[reward.id];
        return $dataItems[reward.id];
    }

    // ---------------------------------------------------- workforce (Army)
    // "Scientist" role troops (Army/ArmyManager.js, recruited from any
    // faction's roster) never join a battle, they instead work the party's
    // active research project every game day. Per-save, not world-shared:
    // it is about which node THIS party's workforce is grinding on.
    function isScientistTroop(t) {
        return /scientist/i.test(String((t && t.role) || ''));
    }
    function workforceScientistTroops() {
        try {
            if (typeof $gameArmy !== 'undefined' && $gameArmy && typeof $gameArmy.getTroops === 'function') {
                return $gameArmy.getTroops().filter(isScientistTroop);
            }
        } catch (e) { /* ignore */ }
        return [];
    }

    function getActiveProject() {
        if (typeof $gameSystem === 'undefined' || !$gameSystem) return null;
        const p = $gameSystem._ttActiveProject;
        if (!p) return null;
        const tree = buildAllTrees().find(t => t.id === p.treeId);
        const node = tree && tree.byId[p.nodeId];
        if (!node || isCompleted(p.treeId, p.nodeId)) { $gameSystem._ttActiveProject = null; return null; }
        return { treeId: p.treeId, nodeId: p.nodeId };
    }
    function setActiveProject(treeId, nodeId) {
        if (typeof $gameSystem === 'undefined' || !$gameSystem) return false;
        const tree = buildAllTrees().find(t => t.id === treeId);
        const node = tree && tree.byId[nodeId];
        if (!node || isCompleted(treeId, nodeId)) return false;
        $gameSystem._ttActiveProject = { treeId: treeId, nodeId: nodeId };
        return true;
    }
    function clearActiveProject() {
        if (typeof $gameSystem !== 'undefined' && $gameSystem) $gameSystem._ttActiveProject = null;
    }

    // One line per material the node requires, scaled off the current
    // workforce's scientist troops and the stat their pool favours. All of a
    // project's materials are generated in parallel (not one at a time), so
    // the workforce advances every requirement simultaneously.
    function workforceDailyOutput(node) {
        if (!node) return [];
        const scientists = workforceScientistTroops();
        return (node.materials || []).map(m => {
            const stat = materialStat(m.id);
            const total = scientists.reduce((sum, t) => sum + (Number(t[stat]) || 0), 0);
            return { id: m.id, qty: Math.floor(total / 10), stat: stat };
        });
    }

    // The world's start year (2001-2012), chosen at world creation. A 2001
    // world begins with nothing discovered; a 2012 world begins with almost
    // everything already known. Falls back to 2001 for worlds/saves that predate
    // the stored field (so nothing is auto-granted, which is the safe default).
    function worldStartYear() {
        try {
            if (window.WorldManager && typeof window.WorldManager.worldInfo === 'function') {
                const y = window.WorldManager.worldInfo().startYear;
                if (y !== null && y !== undefined && !isNaN(y)) {
                    return Math.min(2012, Math.max(2001, Number(y)));
                }
            }
        } catch (e) { /* ignore */ }
        return 2001;
    }

    // Marks every real-science node dated at or before the world's start year as
    // already discovered, so the tech tree opens in a state that matches the era.
    // These pre-existing discoveries grant their permanent buffs (through the
    // reconcile below) but no one-off item/gold/EXP rewards and no NPC gossip:
    // they are ambient historical knowledge, not the party's own breakthrough.
    // Magical trees (no year) and fringe/procedural nodes are never auto-unlocked.
    function preUnlockByYear() {
        const startYear = worldStartYear();
        const store = techStore();
        let changed = false;
        for (const t of buildAllTrees()) {
            if (!t.real) continue;
            for (const n of t.nodes) {
                if (n.fringe || n.procedural) continue;
                // Strictly before the start year: a 2001 world unlocks nothing,
                // a 2012 world unlocks everything except the 2012 capstones.
                if (typeof n.year !== 'number' || n.year >= startYear) continue;
                const k = key(t.id, n.id);
                if (store.completed[k]) continue;
                store.completed[k] = true;
                if (!store.discoverers[k]) {
                    store.discoverers[k] = { leader: null, preexisting: true, year: n.year };
                }
                changed = true;
            }
        }
        if (changed) reconcileBuffs();
        return changed;
    }

    // Reconcile the total tech-tree stat bonus onto the protagonist trio from
    // the world-completed set. Overwrite semantics (not additive) so every
    // savegame of the world converges on the same, correct totals.
    function reconcileBuffs() {
        const trees = buildAllTrees();
        const totals = {};
        const completed = techStore().completed;
        for (const t of trees) {
            for (const n of t.nodes) {
                if (!completed[key(t.id, n.id)]) continue;
                for (const [stat, v] of Object.entries(n.buffs || {})) {
                    const pi = STAT_BUFFS.indexOf(stat);
                    if (pi >= 0) totals[pi] = (totals[pi] || 0) + v;
                }
            }
        }
        for (let id = 1; id <= 3; id++) {
            const actor = $gameActors && $gameActors.actor(id);
            if (!actor) continue;
            actor._techTreeParamBonus = Object.assign({}, totals);
            actor.refresh();
        }
    }

    // Performs the research. Returns { ok, reason, ... }.
    function research(treeId, nodeId) {
        const tree = buildAllTrees().find(t => t.id === treeId);
        if (!tree) return { ok: false, reason: 'notree' };
        const node = tree.byId[nodeId];
        if (!node) return { ok: false, reason: 'nonode' };
        if (isCompleted(treeId, nodeId)) return { ok: false, reason: 'done' };
        if (!prereqsMet(tree, node)) return { ok: false, reason: 'locked' };
        if (!materialsSatisfied(node)) return { ok: false, reason: 'materials' };

        // Consume materials unless in sandbox mode. One-time cost, paid by the
        // discovering party.
        if (!($gameSystem && $gameSystem._isSandboxMode)) {
            for (const m of (node.materials || [])) {
                const item = $dataItems[m.id];
                if (item) $gameParty.loseItem(item, m.qty);
            }
        }

        const disc = recordCompletion(treeId, node);
        reconcileBuffs();

        // One-off rewards go only to the discovering save/party.
        const rw = nodeRewards(node);
        $gameParty.gainGold(rw.gold);
        const a1 = $gameActors && $gameActors.actor(1);
        if (a1) a1.gainExp(rw.exp);

        // Byproduct materials flow back into the crafting economy.
        const materialsGranted = [];
        if (!($gameSystem && $gameSystem._isSandboxMode)) {
            for (const m of materialPayout(node)) {
                const item = $dataItems[m.id];
                if (item) { $gameParty.gainItem(item, m.qty); materialsGranted.push({ id: m.id, qty: m.qty }); }
            }
        }

        let rewardEntry = null;
        if (node.reward) {
            rewardEntry = rewardDbEntry(node.reward);
            if (rewardEntry) $gameParty.gainItem(rewardEntry, node.reward.qty || 1);
        }

        // Let other systems (NPC gossip, news) react to the discovery.
        dispatchDiscovery(tree, node, disc);

        return {
            ok: true, exp: rw.exp, gold: rw.gold,
            rewardEntry: rewardEntry, rewardQty: node.reward ? (node.reward.qty || 1) : 0,
            materialsGranted: materialsGranted,
            nobel: !!node.nobelWorthy, discoverer: disc
        };
    }

    // A short headline clause for NPC gossip ("Did you hear? <headline>").
    function discoveryHeadline(tree, node) {
        const n = nodeName(node);
        if (node.fringe) return T('TechTree.news.fringe', { name: n });
        if (node.procedural) return T('TechTree.news.procedural', { name: n });
        let base;
        // i18n-ignore-start  tree ids
        if (tree.id === 'Arcane') base = T('TechTree.news.arcane', { name: n });
        else if (tree.id === 'Technomagica') base = T('TechTree.news.technomagica', { name: n });
        else if (tree.id === 'Theotecnical') base = T('TechTree.news.theotecnical', { name: n });
        // i18n-ignore-end
        else base = T('TechTree.news.generic', { name: n });
        if (node.nobelWorthy) base += T('TechTree.news.nobelSuffix');
        return base;
    }

    function discoveryNews(tree, node, who) {
        const h = discoveryHeadline(tree, node);
        const cap = h.charAt(0).toUpperCase() + h.slice(1) + '.';
        return who ? cap + T('TechTree.news.credit', { who: who }) : cap;
    }

    // Weave the discovery into NPC small-talk and the news reader.
    // The NPC World-Web log ($gameSystem._npcWorldWeb) is itself world-shared
    // through WorldManager, so the gossip is consistent across the world's saves.
    function announceDiscovery(tree, node, disc) {
        const headline = discoveryHeadline(tree, node);
        try {
            const ww = window.NPCWorldWeb;
            const state = $gameSystem && $gameSystem._npcWorldWeb;
            if (ww && state && Array.isArray(state.log)) {
                const minute = (typeof $gameVariables !== 'undefined' && $gameVariables)
                    ? Number($gameVariables.value(114)) || 0 : (state.lastSimMinute || 0);
                const mkEntry = (group) => ({ minute: minute, date: '', group: group || '', type: 'discovery', desc: headline });
                const groups = (typeof ww.listGroups === 'function') ? (ww.listGroups() || []) : [];
                if (groups.length) groups.forEach(g => state.log.unshift(mkEntry(g)));
                else state.log.unshift(mkEntry(''));
                if (state.log.length > 200) state.log.length = 200;
            }
        } catch (e) { console.error('[TechTree] worldweb announce failed', e); }

        try {
            if (window.$newsManager && Array.isArray(window.$newsManager.newsHistory)) {
                const who = disc && disc.leader ? disc.leader : null;
                const full = discoveryNews(tree, node, who);
                let ts = null; try { ts = new Date(); } catch (e) { /* ignore */ }
                window.$newsManager.newsHistory.unshift({
                    text: full, fullText: full, location: '', category: 'neutral',
                    type: 'worldWeb', timestamp: ts, priceEffect: 1, occupancyEffect: 1, isRealNews: false
                });
                if (window.$newsManager.newsHistory.length > 300) window.$newsManager.newsHistory.length = 300;
            }
        } catch (e) { /* ignore */ }
    }

    // Broadcast a discovery so NPC/news systems can weave it into dialogue.
    function dispatchDiscovery(tree, node, disc) {
        announceDiscovery(tree, node, disc);
        try {
            if (typeof window.TechTreeNPCHook === 'function') {
                window.TechTreeNPCHook(tree, node, disc);
            }
        } catch (e) {
            console.error('[TechTree] discovery hook failed', e);
        }
    }

    function treeCounts(tree) {
        let done = 0;
        tree.nodes.forEach(n => { if (isCompleted(tree.id, n.id)) done++; });
        return { done: done, total: tree.nodes.length };
    }

    // The world discovery feed (most recent first), for NPC dialogue.
    function discoveryFeed() {
        return techStore().feed.slice();
    }

    // ------------------------------------------------------------- commands
    function openScene() {
        if (window.Scene_TechTree) { SceneManager.push(window.Scene_TechTree); return; }
        console.error('[TechTree] Scene_TechTree is not defined - is ProceduralTechTreeUI.js enabled and loaded after ProceduralTechTree.js?');
    }
    PluginManager.registerCommand(pluginName, 'openTechTree', openScene);
    PluginManager.registerCommand(pluginName, 'resetProgress', () => {
        if (usingWorld()) {
            const f = window.WorldManager.getFile('techtree');
            f.completed = {}; f.discoverers = {}; f.feed = [];
        }
        if ($gameSystem) $gameSystem._techTreeState = { completed: {}, discoverers: {}, feed: [] };
        reconcileBuffs();
        if ($gameMessage) $gameMessage.add(T('TechTree.progressCleared'));
    });

    // ------------------------------------------------------- main menu entry
    if (SHOW_IN_MENU) {
        // Match the working ThinkerMenu hook (addMainCommands + setHandler); the
        // project's CustomMainMenuLayout renders whatever is in the command list.
        const _addMainCommands = Window_MenuCommand.prototype.addMainCommands;
        Window_MenuCommand.prototype.addMainCommands = function () {
            _addMainCommands.call(this);
            this.addCommand(MENU_NAME, 'techTree', true, 79);
        };
        const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function () {
            _Scene_Menu_createCommandWindow.call(this);
            this._commandWindow.setHandler('techTree', () => SceneManager.push(window.Scene_TechTree));
        };
    }

    // ------------------------------------------------------- system storage
    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        _Game_System_initialize.call(this);
        this._techTreeState = { completed: {}, discoverers: {}, feed: [] };
        this._ttActiveProject = null;
    };

    // Permanent stat bonuses. Two independent buckets: _permanentParamBonus is
    // the generic one shared with other plugins; _techTreeParamBonus is the
    // reconciled world tech-tree total (overwritten, never accumulated).
    const _Game_Actor_paramBase = Game_Actor.prototype.paramBase;
    Game_Actor.prototype.paramBase = function (paramId) {
        let value = _Game_Actor_paramBase.call(this, paramId);
        if (this._permanentParamBonus && this._permanentParamBonus[paramId]) {
            value += this._permanentParamBonus[paramId];
        }
        if (this._techTreeParamBonus && this._techTreeParamBonus[paramId]) {
            value += this._techTreeParamBonus[paramId];
        }
        return value;
    };

    Game_Actor.prototype.addParam = function (paramId, value) {
        if (!this._permanentParamBonus) this._permanentParamBonus = {};
        if (!this._permanentParamBonus[paramId]) this._permanentParamBonus[paramId] = 0;
        this._permanentParamBonus[paramId] += value;
        this.refresh();
    };

    // Reconcile world tech buffs onto the party whenever a map starts (covers
    // new game, load, and re-entering the field after another save advanced the
    // world). Cheap and idempotent.
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start.call(this);
        try { preUnlockByYear(); reconcileBuffs(); } catch (e) { /* actors not ready */ }
    };

    // --------------------------------------------------------------- export
    window.ProceduralTechTree = {
        TREE_ORDER,
        STAT_BUFFS,
        MAT_POOL,
        trees: buildAllTrees,
        rebuild() { _builtSeed = null; return buildAllTrees(); },
        treeById(id) { return buildAllTrees().find(t => t.id === id) || null; },
        treeName,
        treeBlurb,
        nodeName,
        nodeDesc,
        isCompleted,
        discovererOf,
        prereqsMet,
        materialsSatisfied,
        isAvailable,
        canResearch,
        nodeRewards,
        materialPayout,
        rewardDbEntry,
        research,
        reconcileBuffs,
        preUnlockByYear,
        worldStartYear,
        treeCounts,
        discoveryFeed,
        openScene,
        matItem(id) { return $dataItems[id]; },
        materialStat,
        getActiveProject,
        setActiveProject,
        clearActiveProject,
        workforceDailyOutput
    };
})();
