/*:
 * @target MZ
 * @plugindesc Blacksmithing v1.1.0 - the forge: every weapon and armor recipe in the game, gated by the trade that makes it, and every piece that leaves it one of a kind.
 * @author Esoteric Heavy Industries
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @param menuName
 * @text Menu Name
 * @desc Label for the main-menu command.
 * @default Blacksmithing
 *
 * @param showInMenu
 * @text Show in Main Menu
 * @desc Add the forge to the main menu.
 * @type boolean
 * @default true
 *
 * @command openBlacksmithing
 * @text Open Blacksmithing
 * @desc Opens the forge (an anvil, a workshop, a smithy event).
 *
 * @help BlacksmithingMenu.js
 * ============================================================================
 * The forge
 * ============================================================================
 *
 * The Thinker's workbench with the opposite philosophy. Where the Thinker
 * hides a recipe until it has been made once, the forge hides nothing: every
 * weapon and armor in the game is on the board from the first visit, and what
 * changes as the party trains is which of them their hands can actually make.
 *
 *   Smithable       - everything the selected member can make right now,
 *                     trade trained far enough and the whole bill in the sack
 *   Need materials  - everything their hands can make but the sack cannot
 *                     supply, with how many lines of the bill are short
 *   Too complex     - everything the trade has not been trained far enough
 *                     for, with the tier it is waiting for
 *   Forged          - what this party has already beaten out, one row per
 *                     piece, since no two of them are the same piece
 *
 * The board opens on the first of those that has anything on it, so a party
 * carrying no ore is shown what it could make rather than a blank page.
 *
 * ONE OF A KIND
 * -------------
 * Nothing leaves this anvil as a copy of a catalogue entry. Each finished piece
 * is registered as its own database entry with its own id (from 2001 up), which
 * is what stops the backpack merging two of them into a stack, and it carries a
 * sheet nobody else's copy has. Three things decide that sheet and one of them
 * is luck: how far past the required tier the smith's trade is trained, how rich
 * the bill that went into the crucible was, and the heat on the day. Every
 * parameter then drifts on its own around it, and the price follows, so a
 * masterwork climbs the rarity ladder by itself.
 *
 * The records live on $gameSystem, not the entries: data/Weapons.json is read
 * fresh on every load, so the entries are written back out of the records the
 * moment a save is read.
 *
 * FINISHES
 * --------
 * The skins the 3D weapon models are already drawn with
 * (Weapon/WeaponSystemProcedural.js) are offered as a strip of swatches on the
 * anvil page. Picking one writes `<ForgeTexture:>` onto the finished piece, and
 * the preview is a promise rather than a suggestion: the seed the model is
 * turned under is rolled once, shown, and then kept on the piece as
 * `<ForgeSeed:>`. A piece with no 3D model of its own wears its finish as the
 * cloth it is laid on.
 *
 * THE CRUCIBLE
 * ------------
 * The Smelt button melts a piece the party is carrying back down into its
 * materials: half the bill, and more than that from a piece that was well made.
 * The recovered amounts are printed against the bill itself, so what the fire
 * gives back is read on the same lines that say what it costs.
 *
 * WHAT AN ENTRY NEEDS
 * -------------------
 * Written onto the entry itself in data/Weapons.json / data/Armors.json, so
 * the item is the authority and no lookup table has to agree with it:
 *
 *   <Recipe: 865x13, 863x5, 866x5, 864x6>   what it is made of
 *   <Craft: Bladesmithing>                  the trade that makes it
 *   <CraftLevel: 5>                         the tier of that trade it needs
 *
 * One trade per entry, always: a thing is made by a smith or by a tailor, not
 * by a committee. `<CraftLevel:>` is derived from price (an entry under 5000
 * gold is tier 1, which anybody Untrained can make) and the three tags are
 * regenerated together by tools/forge/balance_forge_recipes.py.
 *
 * Around 31 trades are in play, so the board is not all hammers: a robe is
 * Tailoring, a wig is Wig Making, a costume is Cosplay, a ring is Jewelry
 * Making, a rifle is Gunsmithing, a circuit-woven coat is Electronics.
 *
 * WHOSE HANDS
 * -----------
 * The party switcher on the right page names who is at the anvil. Everything
 * is read off THEM: which tab an entry falls into, whether the Forge button
 * lights, and who earns the specialization points for the work. Switching
 * member re-sorts the whole board.
 */

(() => {
    'use strict';

    const pluginName = 'BlacksmithingMenu';
    const parameters = PluginManager.parameters(pluginName);
    const menuName = parameters['menuName'] || 'Blacksmithing';
    const showInMenu = parameters['showInMenu'] !== 'false';

    const bsText = () => T.obj('Blacksmith');
    const tr = (name) => (typeof window.translateText === 'function' ? window.translateText(name) : name);

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // What a finished piece teaches its maker, by the tier it demanded.
    const TIER_POINTS = [0, 1, 2, 4, 6, 9];

    // The sides of the board, in the order they are drawn: what can be made
    // this minute, what the hands can make but the sack cannot supply, what the
    // trade has not been trained far enough for, and finally the pieces this
    // party has already beaten out on the anvil.
    const TABS = ['ready', 'materials', 'locked', 'forged'];

    // Runtime ids for forged pieces start past everything the database and the
    // artifact generator (Crafting/ArctifactGenerator.js, which owns 1501-1600)
    // can ever hand out, and grow one per piece from there.
    const FORGE_ID_BASE = 2001;

    // How much of a bill melting a piece down gives back.
    const SMELT_RATE = 0.5;

    // ------------------------------------------------------------------------
    // Reading the entries
    // ------------------------------------------------------------------------
    function isRealEntry(x) {
        return x && x.name && x.name.trim() && !x.name.includes('-->');
    }

    const _recipeCache = new WeakMap();
    function parseRecipe(item) {
        if (!item || !item.note) return null;
        if (_recipeCache.has(item)) return _recipeCache.get(item);
        const match = item.note.match(/<Recipe:\s*(.+?)>/i);
        let recipe = null;
        if (match) {
            recipe = {};
            for (const part of match[1].split(',')) {
                const [id, qty] = part.trim().split('x');
                const mid = parseInt(id);
                if (mid) recipe[mid] = parseInt(qty) || 1;
            }
        }
        _recipeCache.set(item, recipe);
        return recipe;
    }

    // The trade, as the entry itself declares it.
    function craftSpecName(item) {
        const raw = item && item.meta && item.meta.Craft;
        return raw ? String(raw).trim() : '';
    }

    function craftSpec(item) {
        const name = craftSpecName(item);
        if (!name || !window.Specializations || !window.Specializations.ready) return null;
        return window.Specializations.byName.get(name) || null;
    }

    function craftTier(item) {
        const raw = item && item.meta && item.meta.CraftLevel;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 1 ? Math.min(5, Math.round(n)) : 1;
    }

    let _entriesCache = null;
    let _entriesSource = null;
    function forgeEntries() {
        if (_entriesCache && _entriesSource === $dataWeapons) return _entriesCache;
        const out = [];
        // A forged piece carries its base entry's whole note, recipe and trade
        // included, so it has to be kept off the catalogue explicitly: the board
        // lists what CAN be made, and its own tab lists what already was.
        const catalogue = (x) => isRealEntry(x) && !isForged(x) && parseRecipe(x) && craftSpecName(x);
        for (const x of $dataWeapons) if (catalogue(x)) out.push(x);
        for (const x of $dataArmors) if (catalogue(x)) out.push(x);
        _entriesCache = out;
        _entriesSource = $dataWeapons;
        return out;
    }

    function isSandbox() {
        return !!($gameSystem && $gameSystem._isSandboxMode);
    }

    function hasMaterials(recipe) {
        if (isSandbox()) return true;
        if (!recipe) return false;
        for (const [id, need] of Object.entries(recipe)) {
            const mat = $dataItems[parseInt(id)];
            if (!mat || $gameParty.numItems(mat) < need) return false;
        }
        return true;
    }

    // How many lines of the bill the party cannot cover.
    function missingCount(recipe) {
        if (!recipe || isSandbox()) return 0;
        let short = 0;
        for (const [id, need] of Object.entries(recipe)) {
            const mat = $dataItems[parseInt(id)];
            if (!mat || $gameParty.numItems(mat) < need) short++;
        }
        return short;
    }

    function levelName(level) {
        const db = window.Specializations;
        return (db && db.levelName) ? db.levelName(level) : String(level);
    }

    // The trade level a given pair of hands has in what an entry asks for.
    function levelInFor(actor, item) {
        const spec = craftSpec(item);
        if (!spec || !window.SpecializationXP) return 1;
        return window.SpecializationXP.levelOf(actor, spec);
    }

    // ── Shared forge service ─────────────────────────────────────────────────
    // The anvil's own answers about a piece, for any menu that wants to ask them
    // (the main menu's search page lists what the party could forge right now).
    // Armor is the forge's alone, so window.CraftRecipes cannot answer for it.
    window.ForgeRecipes = {
        entries: forgeEntries,
        parseRecipe,
        hasMaterials: (item) => hasMaterials(parseRecipe(item)),
        missingCount: (item) => missingCount(parseRecipe(item)),
        tier: craftTier,
        tradeName: craftSpecName,
        // Trained far enough in the trade the piece declares. Sandbox makes
        // anything, the same way the forge itself does.
        canMake: (actor, item) => isSandbox() || levelInFor(actor, item) >= craftTier(item),
        canMakeNow: (actor, item) => (isSandbox() || levelInFor(actor, item) >= craftTier(item)) &&
            hasMaterials(parseRecipe(item))
    };

    // ── Forged pieces ────────────────────────────────────────────────────────
    // Everything that comes off this anvil is one of a kind. Rather than adding
    // to the stack of the catalogue entry it was made from, a forged piece is
    // registered as its own database entry with its own id, so the backpack can
    // never merge two of them and each keeps the sheet it was beaten out with.
    //
    // The record, not the entry, is what the save holds: $dataWeapons is rebuilt
    // from data/ on every load, so the entries are written back into it from the
    // records the moment a save is read.

    function isForged(item) {
        return !!(item && item.meta && item.meta.Forged);
    }

    // A forged piece's name was already written in the player's language when
    // the record was turned into an entry, so running it through the translator
    // a second time could only corrupt it.
    function displayName(item) {
        if (!item) return '';
        return isForged(item) ? item.name : tr(item.name);
    }

    // What this world's smiths have beaten out, kept in the world folder
    // (Dwarf-Fortress style, WorldManager.js) rather than on one save: a piece
    // forged here is an artifact of THIS world, seen by every save of it, the
    // same as its history and its NPCs.
    const FORGE_WORLD_FILE = 'forgedGear';

    function forgeStore() {
        if (window.WorldManager && WorldManager.hasActiveWorld && WorldManager.hasActiveWorld()) {
            const file = WorldManager.getFile(FORGE_WORLD_FILE);
            if (!Array.isArray(file.pieces)) file.pieces = [];
            // A save made before pieces moved into the world folder still
            // carries its own copy on $gameSystem; folded in once so nothing
            // forged before this change is lost, then never read again.
            if ($gameSystem && Array.isArray($gameSystem._forgedPieces) && $gameSystem._forgedPieces.length) {
                const known = new Set(file.pieces.map(r => r.kind + ':' + r.id));
                for (const rec of $gameSystem._forgedPieces) {
                    if (!known.has(rec.kind + ':' + rec.id)) file.pieces.push(rec);
                }
                $gameSystem._forgedPieces = [];
            }
            return file.pieces;
        }
        // No active world yet (title screen previews and the like): fall back
        // to the save so nothing here has to null-check its caller.
        if (!$gameSystem) return [];
        if (!$gameSystem._forgedPieces) $gameSystem._forgedPieces = [];
        return $gameSystem._forgedPieces;
    }

    // The database arrays are indexed by id, and a hole read as `undefined`
    // breaks every plugin that walks them expecting null for an empty slot.
    function padSlots(arr, upTo) {
        while (arr.length <= upTo) arr.push(null);
    }

    function nextForgeId(kind) {
        let max = FORGE_ID_BASE - 1;
        for (const rec of forgeStore()) {
            if (rec.kind === kind && rec.id > max) max = rec.id;
        }
        return max + 1;
    }

    // How many pieces this smith has already stamped with this same base entry,
    // so their sixth knife is not called the same thing as their first.
    function markNumber(rec) {
        let n = 0;
        for (const other of forgeStore()) {
            if (other.kind === rec.kind && other.baseId === rec.baseId && other.smith === rec.smith) n++;
        }
        return n;
    }

    // A forged sheet, in words: five bands across the roll's whole range.
    const QUALITY_BANDS = ['crude', 'sound', 'fine', 'superb', 'masterwork'];
    function qualityBand(quality) {
        const q = Number(quality) || 1;
        if (q < 1.0) return QUALITY_BANDS[0];
        if (q < 1.2) return QUALITY_BANDS[1];
        if (q < 1.4) return QUALITY_BANDS[2];
        if (q < 1.6) return QUALITY_BANDS[3];
        return QUALITY_BANDS[4];
    }
    const qualityLabel = (quality) => T('Blacksmith.quality.' + qualityBand(quality));

    function forgedDisplayName(base, rec) {
        const key = rec.mark > 1 ? 'Blacksmith.forgedNameNumbered' : 'Blacksmith.forgedName';
        // A weapon that was given a name of its own at the anvil wears that
        // instead of its catalogue name; armor still reads as the piece it is.
        const name = (rec.customName && rec.customName.trim()) ? rec.customName.trim() : tr(base.name);
        return T(key, { name, smith: rec.smith, mark: rec.mark });
    }

    // Write one record back into the database as a live entry.
    function materialize(rec) {
        const src = rec.kind === 'w' ? $dataWeapons : $dataArmors;
        const base = src[rec.baseId];
        if (!base || isForged(base)) return null;

        const entry = JSON.parse(JSON.stringify(base));
        entry.id = rec.id;
        entry.params = (rec.params || base.params || []).slice();
        entry.price = rec.price;
        entry.name = forgedDisplayName(base, rec);
        // <Restricted> is the database's word for a row exactly one system
        // hands out (ItemSystemUtils.isRestrictedEntry): every pool builder in
        // the game asks before it accepts a row, so a loot roll, a shop shelf,
        // a vending machine or a picked pocket can never produce a second copy
        // of a piece that is supposed to be the only one of itself.
        entry.note = String(base.note || '') +
            '\n<Restricted>' +
            `\n<Forged: ${rec.smith}>` +
            `\n<ForgeQuality: ${rec.quality}>` +
            `\n<ForgeSeed: ${rec.seed || 0}>` +
            // Lets WeaponSystemProcedural.dispatchIdFor still find a bespoke
            // model or a house finish keyed on the entry this piece was
            // forged from, since materializing gave it a brand new id.
            `\n<ForgeBaseId: ${rec.baseId}>` +
            (rec.texture ? `\n<ForgeTexture: ${rec.texture}>` : '');
        entry.description = String(base.description || '').trim();
        const line = T('Blacksmith.forgedDesc', { smith: rec.smith, quality: qualityLabel(rec.quality) });
        entry.description = entry.description ? entry.description + '\n' + line : line;
        DataManager.extractMetadata(entry);

        padSlots(src, rec.id);
        src[rec.id] = entry;
        return entry;
    }

    function rebuildForged() {
        for (const rec of forgeStore()) materialize(rec);
    }

    // What a piece is worth in materials once the fire has had its share. A
    // forged piece gives back in proportion to how well it was made.
    function smeltYield(item) {
        const recipe = parseRecipe(item);
        if (!recipe) return null;
        const q = isForged(item) ? (Number(item.meta.ForgeQuality) || 1) : 1;
        const out = {};
        let any = false;
        for (const [id, need] of Object.entries(recipe)) {
            const back = Math.min(need, Math.floor(need * SMELT_RATE * q));
            if (back > 0) { out[id] = back; any = true; }
        }
        // A bill of single units rounds away to nothing, which makes the
        // crucible look broken. One unit of the cheapest line always survives
        // the fire, so melting a piece down is a loss and never a waste. No
        // recipe in the game is a single line of one, so this can never hand
        // back everything that went in.
        if (!any) {
            let cheapest = null;
            for (const id of Object.keys(recipe)) {
                const mat = $dataItems[parseInt(id)];
                if (!mat) continue;
                if (!cheapest || (mat.price || 0) < (cheapest.price || 0)) cheapest = mat;
            }
            if (cheapest) out[cheapest.id] = 1;
        }
        return out;
    }

    // How rich the bill is, averaged over every unit that goes in: a blade beaten
    // out of crystal and titanium starts better than one beaten out of bone.
    function materialRichness(recipe) {
        let worth = 0;
        let units = 0;
        for (const [id, need] of Object.entries(recipe || {})) {
            const mat = $dataItems[parseInt(id)];
            if (!mat) continue;
            worth += (mat.price || 0) * need;
            units += need;
        }
        if (!units) return 0;
        return Math.max(0, Math.min(1, (worth / units) / 500));
    }

    // The sheet a piece comes off the anvil with. Factors: crafting specialization,
    // weapon proficiency, material richness, and the D20 forge strike roll.
    async function rollQuality(actor, item) {
        const mastery = Math.max(0, Math.min(4, levelInFor(actor, item) - craftTier(item)));
        const richness = materialRichness(parseRecipe(item));
        const wpnProf = (window.WeaponProficiency && DataManager.isWeapon(item) && actor)
            ? window.WeaponProficiency.levelFor(actor, item) : 1;
        const statMod = actor ? Math.floor(((actor.atk || 10) - 10) / 2) : 0;

        let rollVal = 10;
        let nat1 = false;
        let nat20 = false;

        if (window.Dice3D) {
            const res = await window.Dice3D.rollD20({
                actionName: 'Anvil Forging',
                statName: 'STR/CRAFT',
                modifier: mastery + statMod
            });
            rollVal = res.roll;
            nat1 = res.nat1;
            nat20 = res.nat20;
        } else {
            rollVal = Math.floor(Math.random() * 20) + 1;
            nat1 = (rollVal === 1);
            nat20 = (rollVal === 20);
        }

        if (nat1) {
            // Automatic Critical Failure: flawed/cracked forge
            return 0.68;
        }
        if (nat20) {
            // Automatic Critical Success: Masterwork piece
            return Math.round((1.40 + 0.08 * mastery + 0.15 * richness) * 100) / 100;
        }

        const q = 0.80 + 0.07 * mastery + 0.04 * (wpnProf - 1) + 0.15 * richness + (rollVal / 20) * 0.28;
        return Math.round(q * 100) / 100;
    }

    // Every parameter drifts on its own around that sheet, so two pieces off the
    // same bill by the same hands are still not the same piece.
    function rollParams(item, quality) {
        const out = (item.params || []).slice();
        // Scaling alone is invisible on the low end of the catalogue, where a
        // knife's whole sheet is a 1 and a 3 and a fifteen percent roll rounds
        // straight back to where it started. The grade is a flat point or four
        // on top, so a masterwork reads as one at every tier.
        const grade = Math.max(0, Math.round((quality - 1) * 5));
        for (let i = 0; i < out.length; i++) {
            const v = out[i] || 0;
            if (!v) continue;
            const drift = quality * (0.92 + Math.random() * 0.16);
            const rolled = Math.round(v * drift) + (v > 0 ? grade : -grade);
            out[i] = rolled || (v > 0 ? 1 : -1);
        }
        return out;
    }

    // ── Finishes ─────────────────────────────────────────────────────────────
    // The skins the 3D weapon models are already drawn with
    // (Weapon/WeaponSystemProcedural.js), offered as a choice at the anvil. The
    // class-specific run comes first, then everything else, so the swatches a
    // sword usually wears are the ones under the thumb.
    function finishClass(item) {
        if (!DataManager.isWeapon(item)) return 'default';
        const w = item.wtypeId || 1;
        if (w === 9 || w === 8) return 'gun';
        if (w === 1 || w === 2 || w === 10) return 'blade';
        if (w === 3 || w === 4) return 'heavy';
        if (w === 6) return 'magic';
        if (w === 7 || w === 12) return 'wood';
        return 'default';
    }

    function finishesFor(item) {
        const P = window.WeaponSystemProcedural;
        if (!P || !P.getTexturesForType) return [];
        const seen = new Set();
        const out = [];
        // The class run first, then the dream bank: the strange sheets are a
        // choice a smith makes on purpose, so they sit at the end of the tray
        // rather than in among the marbles.
        for (const f of P.getTexturesForType(finishClass(item)) || []) {
            if (!seen.has(f)) { seen.add(f); out.push(f); }
        }
        for (const f of P.getTexturesForType('dream') || []) {
            if (!seen.has(f)) { seen.add(f); out.push(f); }
        }
        return out;
    }

    function finishSrc(filename) {
        const P = window.WeaponSystemProcedural;
        if (P && P.texturePath) return P.texturePath(filename);
        return `img/textures/${filename}`;
    }

    // ── Names ────────────────────────────────────────────────────────────────
    // A weapon coming off the anvil earns its own name, not a found relic's:
    // separate banks from the artifact generator's (Crafting/ArctifactGenerator.js),
    // picked by the same class the finish picker uses (finishClass), so a blade
    // reads like a blade and a gun like a gun.
    function randomForgedName(item) {
        const cls = finishClass(item);
        const prefixes = T.pool('Blacksmith.nameBank.' + cls + '.prefix');
        const nouns = T.pool('Blacksmith.nameBank.' + cls + '.noun');
        if (!prefixes.length || !nouns.length) return '';
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${prefix} ${noun}`;
    }

    // Records outlive the database entries built from them, so a loaded save has
    // to put its forged pieces back before anything asks the party what it holds.
    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        rebuildForged();
    };

    window.ForgedPieces = {
        all: forgeStore,
        isForged,
        rebuild: rebuildForged,
        quality: (item) => (isForged(item) ? (Number(item.meta.ForgeQuality) || 1) : 0),
        smeltYield
    };

    function rarityOf(item) {
        if (window.ItemSystemUtils && window.ItemSystemUtils.getItemRarity) {
            return window.ItemSystemUtils.getItemRarity(item);
        }
        return { name: '', colorCode: '#bba16d' };  // i18n-ignore  fallback tint
    }

    // Money is always euros, the same split MoneyFormatter draws.
    function money(gold) {
        if (window.ParchmentToast && window.ParchmentToast.money) return window.ParchmentToast.money(gold);
        return String(Math.round(gold || 0));
    }

    function iconStyle(iconIndex, size) {
        const idx = Number(iconIndex) || 0;
        const s = size || 32;
        return `background:url('img/system/IconSet.png') -${(idx % 16) * s}px -${Math.floor(idx / 16) * s}px no-repeat;` +
            (s !== 32 ? `background-size:${s * 16}px auto;` : '') +
            `width:${s}px;height:${s}px;display:inline-block;`;
    }

    // ========================================================================
    // Scene_Blacksmithing
    // ========================================================================
    class Scene_Blacksmithing extends Scene_MenuBase {
        create() {
            super.create();
            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }

            this._tab = 'ready';          // 'ready' | 'materials' | 'locked'
            this._activeArea = 'tabs';    // 'tabs' | 'trades' | 'items' | 'forge'
            this._tabIndex = 0;
            this._tradeIndex = 0;
            this._itemIndex = 0;
            this._selectedTrade = null;
            this._selectedItem = null;
            this._smithIndex = 0;
            this._overlayTimer = 0;
            this._overlayData = null;
            this._listDirty = true;
            this._finishes = {};          // base entry -> chosen skin, this visit
            this._finishIndex = 0;

            // The shared search + filter strip (UI/MenuSearchBar.js), in the
            // anvil's vocabulary: pieces belong to trades and carry a weight and
            // a price; nothing here has a level or a cast cost.
            this._forgeBar = window.MenuSearchBar ? window.MenuSearchBar.create({
                id: 'forge',
                placeholder: T('Blacksmith.searchPlaceholder'),
                sorts: ['name', 'weight', 'price'],
                onChange: () => {
                    this._itemIndex = 0;
                    this._listDirty = true;
                    this._selectedItem = this.itemsForTrade()[0] || null;
                    this.refreshForge();
                    if (this._forgeBar) this._forgeBar.restoreFocus();
                }
            }) : null;

            // Opening on Smithable left the board blank for any party that
            // happened not to be carrying ore, which reads as a forge with no
            // recipes in it at all. Open on the first side that has something.
            this._tab = this.firstFilledTab();
            this._tabIndex = TABS.indexOf(this._tab);

            this.createLayout();
            this.refreshForge();
            if (window.CharSwitcher) {
                window.CharSwitcher.installTabKey(this, (dir) => this.cycleSmith(dir));
            }
        }

        update() {
            // A focused search field or the name box owns the keyboard.
            const typing = (window.MenuSearchBar && window.MenuSearchBar.isTyping()) ||
                (document.activeElement && document.activeElement.id === 'forge-name-input');
            if (!typing) this.updateForgeInput();
            super.update();
        }

        terminate() {
            if (this._forgeBar) { this._forgeBar.dispose(); this._forgeBar = null; }
            this.dispose3D();
            const c = document.getElementById('blacksmith-container');
            if (c) c.remove();
            if (window.CharSwitcher) window.CharSwitcher.removeTabKey(this);
            if (window.SpecBadge) window.SpecBadge.hide();
            super.terminate();
        }

        // -------------------------------------------------- who is at the anvil
        smithMembers() {
            return ($gameParty && $gameParty.members) ? $gameParty.members() : [];
        }

        smith() {
            const members = this.smithMembers();
            if (!members.length) return null;
            return members[Math.max(0, Math.min(members.length - 1, this._smithIndex || 0))];
        }

        selectSmith(index) {
            const members = this.smithMembers();
            if (!members.length) return;
            const next = ((index % members.length) + members.length) % members.length;
            if (next === this._smithIndex) return;
            this._smithIndex = next;
            SoundManager.playCursor();
            // Another pair of hands re-sorts the whole board: a piece this
            // member cannot make has moved to the other tab, and a whole trade
            // can leave the open tab with it.
            this._listDirty = true;
            this._selectedItem = null;
            this._itemIndex = 0;
            if (this._selectedTrade && !this.trades().some(r => r.name === this._selectedTrade)) {
                this._selectedTrade = null;
                this._activeArea = 'trades';
            } else {
                this._selectedItem = this.itemsForTrade()[this._itemIndex] || null;
            }
            this.refreshForge();
        }

        cycleSmith(dir) { this.selectSmith((this._smithIndex || 0) + dir); }

        // The selected member's level in the trade an entry needs.
        levelIn(item) {
            const spec = craftSpec(item);
            if (!spec || !window.SpecializationXP) return 1;
            return window.SpecializationXP.levelOf(this.smith(), spec);
        }

        canMake(item) {
            return isSandbox() || this.levelIn(item) >= craftTier(item);
        }

        // -------------------------------------------------------------- listing
        // Which side of the board a piece falls on: the trade decides first
        // (untrained hands cannot start it at all), the sack decides second.
        bucketOf(item) {
            if (!this.canMake(item)) return 'locked';
            return hasMaterials(parseRecipe(item)) ? 'ready' : 'materials';
        }

        // The pieces this party is carrying that came off an anvil, newest
        // first, so the last thing made is the first thing on the board.
        forgedOwned() {
            const out = [];
            for (const rec of forgeStore()) {
                const src = rec.kind === 'w' ? $dataWeapons : $dataArmors;
                const entry = src[rec.id];
                if (entry && $gameParty.numItems(entry) > 0) out.push(entry);
            }
            return out.reverse();
        }

        entriesForTab() {
            if (this._tab === 'forged') return this.forgedOwned();
            return forgeEntries().filter(e => this.bucketOf(e) === this._tab);
        }

        firstFilledTab() {
            for (const key of TABS) {
                if (key === 'forged') { if (this.forgedOwned().length) return key; continue; }
                if (forgeEntries().some(e => this.bucketOf(e) === key)) return key;
            }
            return 'ready';
        }

        trades() {
            if (!this._listDirty && this._tradesCache && this._tradesKey === this._tab) {
                return this._tradesCache;
            }
            const map = new Map();
            for (const entry of this.entriesForTab()) {
                const name = craftSpecName(entry);
                if (!map.has(name)) map.set(name, { name, total: 0 });
                map.get(name).total++;
            }
            this._tradesCache = Array.from(map.values()).sort((a, b) => tr(a.name).localeCompare(tr(b.name)));
            this._tradesKey = this._tab;
            this._listDirty = false;
            return this._tradesCache;
        }

        itemsForTrade() {
            if (!this._selectedTrade) return [];
            const pieces = this.entriesForTab()
                .filter(e => craftSpecName(e) === this._selectedTrade)
                .sort((a, b) => (a.price || 0) - (b.price || 0));
            // Last word goes to the search strip, so the page and the cursor are
            // indexed against the same, already-filtered list.
            if (!this._forgeBar) return pieces;
            return this._forgeBar.apply(pieces, item => ({
                name: displayName(item),
                category: craftSpecName(item),
                weight: (window.ItemSystemUtils && window.ItemSystemUtils.getItemWeight
                    ? window.ItemSystemUtils.getItemWeight(item) : 0) / 1000,
                price: (item.price || 0) / 100
            }));
        }

        // ----------------------------------------------------------------- DOM
        createLayout() {
            if (!document.getElementById('blacksmith-container')) {
                const el = document.createElement('div');
                el.id = 'blacksmith-container';
                document.body.appendChild(el);
            }
        }

        refreshForge() {
            const container = document.getElementById('blacksmith-container');
            if (!container) return;
            const t = bsText();

            let spread = container.querySelector('.book-spread');
            if (!spread) {
                container.innerHTML = `
                    <div class="book-spread">
                        <div id="forge-overlay-container"></div>
                        <div class="left-page">
                            <div class="forge-header">
                                <div class="back-button focusable" id="forge-back">${escapeHtml(T('Blacksmith.back'))}</div>
                                <h2 class="title">${escapeHtml(t.title)}</h2>
                            </div>
                            <div id="forge-search-slot"></div>
                            <div id="forge-tabs"></div>
                            <div class="list-viewport" id="forge-list"></div>
                        </div>
                        <div class="right-page">
                            <div id="forge-companion-row" class="companion-switcher companion-switcher--header"></div>
                            <div class="workbench" id="forge-detail"></div>
                        </div>
                    </div>`;
                spread = container.querySelector('.book-spread');
                spread.addEventListener('click', (e) => this.onSpreadClick(e));
                // The name field is typed into directly, so its value is read
                // off the DOM as it changes rather than pushed through a
                // re-render, which would blow away the cursor position mid-word.
                spread.addEventListener('input', (e) => {
                    if (e.target && e.target.id === 'forge-name-input' && this._selectedItem) {
                        this.setName(this._selectedItem, e.target.value);
                    }
                });
                // The wheel turns whichever page the pointer is over: the recipe
                // list on the left, the dossier on the right. Sending every
                // wheel event to the list is what left the anvil page stuck.
                container.addEventListener('wheel', (e) => {
                    const under = e.target && e.target.closest
                        ? e.target.closest('.list-viewport, .workbench') : null;
                    const target = under || container.querySelector('.list-viewport');
                    if (target) target.scrollTop += e.deltaY;
                });
            }

            this.renderSwitcher();
            this.renderTabs();
            this.renderList();
            this.renderDetail();
            this.renderOverlay();

            if (window.SpecBadge) {
                const spec = this._selectedItem ? craftSpec(this._selectedItem) : null;
                if (spec) window.SpecBadge.show(spec, { actor: this.smith() });
                else window.SpecBadge.hide();
            }
        }

        renderSwitcher() {
            const row = document.getElementById('forge-companion-row');
            if (!row || !window.CharSwitcher) return;
            // The switcher heads the page in place of its old title, so it is
            // drawn even for a party of one: the single name says whose hands
            // the skill badge underneath is reporting.
            const members = this.smithMembers();
            let tabs = '';
            members.forEach((m, idx) => {
                const sel = idx === (this._smithIndex || 0) ? 'selected' : '';
                tabs += `<div class="companion-tab ${sel}" data-smith="${idx}">${escapeHtml(m.name())}</div>`;
            });
            row.innerHTML = window.CharSwitcher.inner(
                `<div class="companion-tabs-row">${tabs}</div>`, members.length);
        }

        renderTabs() {
            const el = document.getElementById('forge-tabs');
            if (!el) return;
            const t = bsText();
            const counts = { ready: 0, materials: 0, locked: 0, forged: this.forgedOwned().length };
            for (const entry of forgeEntries()) counts[this.bucketOf(entry)]++;
            const labels = {
                ready: t.smithable, materials: t.needMaterials,
                locked: t.tooComplex, forged: t.forgedTab
            };
            const tab = (key, idx) => {
                const active = this._tab === key ? 'active' : '';
                const focused = (this._activeArea === 'tabs' && this._tabIndex === idx) ? 'focused' : '';
                return `<div class="tab-btn ${active} ${focused}" data-tab="${key}">${escapeHtml(labels[key])} (${counts[key]})</div>`;
            };
            el.innerHTML = `<div class="mode-tabs">${TABS.map(tab).join('')}</div>`;

            // The search strip is redrawn with the tabs above it (the trades on
            // offer change with the open tab), then handed its caret back.
            const searchSlot = document.getElementById('forge-search-slot');
            if (searchSlot && this._forgeBar) {
                searchSlot.innerHTML = this._forgeBar.html();
                this._forgeBar.restoreFocus();
            }
        }

        // The list is a flat run of lines — its heading, then either the trades
        // or one row per piece — mounted in a window, so a smith with the whole
        // catalogue open only ever builds the rows on screen
        // (UI/MenuVirtualList.js). Row clicks are read off the spread by
        // delegation (onSpreadClick), so a row swapped in mid-scroll needs no
        // wiring of its own.
        renderList() {
            const el = document.getElementById('forge-list');
            if (!el) return;
            const t = bsText();
            const lines = [];
            let focusedLine = -1;

            if (this._selectedTrade === null) {
                lines.push(() => `<div class="left-header"><span class="category-name">${escapeHtml(t.trades)}</span></div>`);
                const trades = this.trades();
                if (!trades.length) {
                    lines.push(() => `<div class="workbench-empty">${escapeHtml(t.noTrades)}</div>`);
                } else {
                    this._tradeIndex = Math.max(0, Math.min(trades.length - 1, this._tradeIndex));
                    trades.forEach((row, idx) => {
                        const focused = (this._activeArea === 'trades' && idx === this._tradeIndex) ? 'focused' : '';
                        if (focused) focusedLine = lines.length;
                        lines.push(() => `
                            <div class="category-row ${focused}" data-trade="${escapeHtml(row.name)}" data-idx="${idx}">
                                <div class="category-meta-left">
                                    <span class="category-name">${escapeHtml(tr(row.name))}</span>
                                </div>
                                <span class="category-count">${row.total}</span>
                            </div>`);
                    });
                }
            } else {
                lines.push(() => `
                    <div class="left-header">
                        <span class="category-name">${escapeHtml(tr(this._selectedTrade))}</span>
                        <span class="back-btn" id="forge-back-trades">&#9664; ${escapeHtml(t.back)}</span>
                    </div>`);
                const items = this.itemsForTrade();
                if (!items.length) {
                    lines.push(() => `<div class="workbench-empty">${escapeHtml(t.noRecipes)}</div>`);
                } else {
                    this._itemIndex = Math.max(0, Math.min(items.length - 1, this._itemIndex));
                    items.forEach((item, idx) => {
                        const focused = (this._activeArea === 'items' && idx === this._itemIndex) ? 'focused' : '';
                        if (focused) focusedLine = lines.length;
                        lines.push(() => {
                            const rarity = rarityOf(item);
                            // Each tab already says why a piece is on it, so the
                            // mark answers the question the tab leaves open: the
                            // tier a locked piece waits for, how much of the bill
                            // a short one is missing, a plain tick for the rest.
                            let mark;
                            if (this._tab === 'forged') {
                                mark = `<span class="forge-quality-mark">${escapeHtml(qualityLabel(item.meta.ForgeQuality))}</span>`;
                            } else if (this._tab === 'locked') {
                                mark = `<span class="forge-tier-need">${escapeHtml(levelName(craftTier(item)))}</span>`;
                            } else if (this._tab === 'materials') {
                                mark = `<span class="forge-mat-state short">&#10006; ${missingCount(parseRecipe(item))}</span>`;
                            } else {
                                mark = `<span class="forge-mat-state ok">&#10004;</span>`;
                            }
                            return `
                            <div class="category-row forge-row ${focused}" data-item="${item.id}" data-kind="${DataManager.isWeapon(item) ? 'w' : 'a'}" data-idx="${idx}">
                                <div class="category-meta-left">
                                    <span class="icon" style="${iconStyle(item.iconIndex, 24)}"></span>
                                    <span class="blueprint-name" style="color:${rarity.colorCode}">${escapeHtml(displayName(item))}</span>
                                </div>
                                ${mark}
                            </div>`;
                        });
                    });
                }
            }

            window.MenuVirtualList.render(el, {
                key: `${this._selectedTrade || ''}|${this._tab}|${this._forgeBar ? this._forgeBar.query : ''}`,
                count: lines.length,
                renderItem: idx => lines[idx]()
            });
            if (focusedLine >= 0) window.MenuVirtualList.scrollToIndex(el, focusedLine);
        }

        // ------------------------------------------------------ the anvil page
        renderDetail() {
            const el = document.getElementById('forge-detail');
            if (!el) return;
            const t = bsText();
            const item = this._selectedItem;

            if (!item) {
                this.dispose3D();
                el.innerHTML = `<div class="workbench-empty">${escapeHtml(t.selectHint)}</div>`;
                return;
            }

            const rarity = rarityOf(item);
            const spec = craftSpec(item);
            const tier = craftTier(item);
            const level = this.levelIn(item);
            const forged = isForged(item);
            const makeable = !forged && this.canMake(item);
            const recipe = parseRecipe(item);
            const stocked = hasMaterials(recipe);
            const owned = $gameParty.numItems(item);
            const smeltable = owned > 0;
            const yields = smeltable ? (smeltYield(item) || {}) : {};

            // --- what it is
            let head = `
                <div class="workbench-item-header">
                    <span class="icon" style="${iconStyle(item.iconIndex, 32)}"></span>
                    <span class="workbench-item-name" style="color:${rarity.colorCode}">${escapeHtml(displayName(item))}</span>
                </div>`;
            if (item.description && String(item.description).trim()) {
                const desc = (forged ? String(item.description) : tr(String(item.description)))
                    .replace(/\s*\n\s*/g, ' ').trim();
                head += `<p class="workbench-desc">${escapeHtml(desc)}</p>`;
            }

            // --- the trade and the tier it asks for. A piece already made says
            //     instead whose hands made it and how it came out.
            const skillHTML = forged
                ? `<div class="forge-skill forge-made">
                        <span>${escapeHtml(T('Blacksmith.madeBy', { smith: String(item.meta.Forged).trim() }))}</span>
                        <span class="forge-skill-have">${escapeHtml(qualityLabel(item.meta.ForgeQuality))}</span>
                   </div>`
                : `<div class="forge-skill ${makeable ? '' : 'locked'}">
                    <span>${escapeHtml(T('Blacksmith.needs', {
                        trade: spec ? window.Specializations.displayName(spec) : craftSpecName(item),
                        level: levelName(tier)
                    }))}</span>
                    <span class="forge-skill-have">${escapeHtml(T('Blacksmith.have', {
                        who: (this.smith() && this.smith().name()) || '',
                        level: levelName(level)
                    }))}</span>
                </div>`;

            // --- the same metadata the equip menu shows
            const statsHTML = this.metadataHTML(item);

            // --- the bill of materials, with what the crucible gives back on
            //     the same line when melting it down is on the table
            let matRows = '';
            for (const [id, need] of Object.entries(recipe || {})) {
                const mat = $dataItems[parseInt(id)];
                if (!mat) continue;
                const held = $gameParty.numItems(mat);
                const ok = isSandbox() || held >= need;
                const back = yields[id] || 0;
                matRows += `
                    <div class="reagent-row" style="opacity:${ok || smeltable ? 1 : 0.6}">
                        <div class="reagent-meta">
                            <span class="icon" style="${iconStyle(mat.iconIndex, 24)}"></span>
                            <span class="reagent-name">${escapeHtml(tr(mat.name))}</span>
                        </div>
                        <div class="reagent-count-box">
                            ${back ? `<span class="reagent-recover">+${back}</span>` : ''}
                            <span>${held}/${need}</span>
                            <span class="reagent-status-indicator ${ok ? 'satisfied' : 'deficient'}">${ok ? '&#10004;' : '&#10006;'}</span>
                        </div>
                    </div>`;
            }
            // A piece with no bill at all (one already off the anvil) is not
            // given an empty box under its blurb.
            const matHTML = matRows
                ? `<h4 class="reagents-header">${escapeHtml(t.materials)}</h4>` +
                  `<div class="reagents-list reagents-list--grid">${matRows}</div>`
                : '';

            // --- the buttons
            const enabled = makeable && stocked;
            const btnClass = `transmute-btn ${enabled ? 'enabled' : 'disabled'} ${this._activeArea === 'forge' ? 'focused' : ''}`;
            const btnLabel = forged ? t.alreadyForged
                : (!makeable ? t.tooComplexShort : (stocked ? t.forge : t.noMaterials));
            const smeltClass = `transmute-btn ${smeltable ? 'enabled' : 'disabled'} ${this._activeArea === 'smelt' ? 'focused' : ''}`;
            const smeltLabel = smeltable ? T('Blacksmith.smeltHeld', { n: owned }) : t.smeltNone;

            // What it will look like and what it will be called come first, since
            // that is what the smith is actually deciding at the anvil; whether
            // the trade and the sack can back that up comes after, and the full
            // spec sheet is reference material at the bottom.
            el.innerHTML = `
                <div class="workbench-active">
                    ${head}
                    ${this.previewHTML(item)}
                    ${this.nameHTML(item)}
                    ${this.finishHTML(item)}
                    ${skillHTML}
                    ${matHTML}
                    ${statsHTML}
                    <div class="forge-button-row">
                        ${forged ? '' : `<div class="${btnClass}" id="forge-action">${escapeHtml(btnLabel)}</div>`}
                        <div class="${smeltClass}" id="forge-smelt">${escapeHtml(smeltLabel)}</div>
                    </div>
                </div>`;

            // The dossier is taller than the page, so the button a keyboard
            // player has just moved onto has to be brought into view.
            if (this._activeArea === 'forge' || this._activeArea === 'smelt' || this._activeArea === 'finish') {
                const focus = el.querySelector('.transmute-btn.focused, .forge-swatch.focused');
                if (focus) focus.scrollIntoView({ block: 'nearest' });
            }

            this.mount3D(item);
        }

        // ------------------------------------------------- the finish picker
        // Which skin the piece comes off the fire wearing. The models are
        // already drawn with these bitmaps (Weapon/WeaponSystemProcedural.js);
        // the anvil simply lets the smith pick instead of letting the seed pick.
        finishKey(item) {
            return `${DataManager.isWeapon(item) ? 'w' : 'a'}${item.id}`;
        }

        chosenFinish(item) {
            return this._finishes[this.finishKey(item)] || '';
        }

        setFinish(item, filename) {
            this._finishes[this.finishKey(item)] = filename || '';
        }

        // The look the piece will keep, held steady while it is on the page, so
        // the preview is a promise rather than a suggestion.
        pendingSeed(item) {
            const key = this.finishKey(item);
            if (!this._seeds) this._seeds = {};
            if (this._seeds[key] === undefined) {
                this._seeds[key] = (Math.random() * 0xFFFFFFFF) >>> 0;
            }
            return this._seeds[key];
        }

        // ------------------------------------------------- the name picker
        // A weapon rolls a name for itself the moment it is looked at, kept
        // steady while it is on the page, exactly like its finish; typing over
        // it or hitting the dice replaces only that piece's roll.
        pendingName(item) {
            const key = this.finishKey(item);
            if (!this._names) this._names = {};
            if (this._names[key] === undefined) {
                this._names[key] = randomForgedName(item);
            }
            return this._names[key];
        }

        setName(item, name) {
            if (!this._names) this._names = {};
            this._names[this.finishKey(item)] = String(name == null ? '' : name).slice(0, 60);
        }

        rerollName(item) {
            if (!this._names) this._names = {};
            this._names[this.finishKey(item)] = randomForgedName(item);
        }

        // What the 3D card is asked to draw: the entry itself once it has been
        // forged, and a stand-in wearing this visit's choices before that.
        previewItem(item) {
            if (isForged(item)) return item;
            const finish = this.chosenFinish(item);
            const seed = this.pendingSeed(item);
            return Object.assign({}, item, {
                note: String(item.note || '') + `\n<ForgeSeed: ${seed}>` +
                    (finish ? `\n<ForgeTexture: ${finish}>` : ''),
                meta: Object.assign({}, item.meta, {
                    ForgeSeed: String(seed),
                    ForgeTexture: finish || undefined
                })
            });
        }

        // A weapon rolls its own name the moment it is looked at (pendingName),
        // typed over freely and rerolled on demand; armor keeps the plain
        // "{smith}'s {piece}" naming, since only a weapon was asked for this.
        nameHTML(item) {
            if (isForged(item) || !DataManager.isWeapon(item)) return '';
            const name = this.pendingName(item);
            return `
                <h4 class="reagents-header">${escapeHtml(T('Blacksmith.nameHeader'))}</h4>
                <div class="forge-name-row">
                    <input type="text" id="forge-name-input" class="forge-name-input"
                           value="${escapeHtml(name)}" maxlength="60"
                           placeholder="${escapeHtml(T('Blacksmith.namePlaceholder'))}">
                    <div class="forge-name-reroll" id="forge-name-reroll" title="${escapeHtml(T('Blacksmith.nameReroll'))}">&#8635;</div>
                </div>`;
        }

        finishHTML(item) {
            // A piece already beaten out wears what it was given; only what is
            // still on the bill can still be chosen for.
            if (isForged(item)) return '';
            const list = finishesFor(item);
            if (!list.length) return '';
            const chosen = this.chosenFinish(item);
            const focused = this._activeArea === 'finish';
            // The cursor is read off the piece's own choice, so moving between
            // pieces never leaves it pointing at somebody else's swatch.
            const at = chosen ? list.indexOf(chosen) : -1;
            this._finishIndex = at >= 0 ? at + 1 : 0;

            let swatches = `
                <div class="forge-swatch forge-swatch--auto ${chosen ? '' : 'selected'} ${focused && this._finishIndex === 0 ? 'focused' : ''}"
                     data-finish="" title="${escapeHtml(T('Blacksmith.finishAuto'))}">
                    <span>${escapeHtml(T('Blacksmith.finishAuto'))}</span>
                </div>`;
            let broke = false;
            list.forEach((file, idx) => {
                const sel = chosen === file ? 'selected' : '';
                const foc = (focused && this._finishIndex === idx + 1) ? 'focused' : '';
                if (!broke && String(file).startsWith('dream/')) {
                    broke = true;
                    swatches += `<div class="forge-swatch-divider">${escapeHtml(T('Blacksmith.finishStrange'))}</div>`;
                }
                swatches += `<div class="forge-swatch ${sel} ${foc}" data-finish="${escapeHtml(file)}" data-fidx="${idx + 1}">
                     <img src="${escapeHtml(finishSrc(file))}" alt="" loading="lazy" decoding="async"></div>`;
            });

            return `
                <h4 class="reagents-header">${escapeHtml(T('Blacksmith.finish'))}</h4>
                <div class="forge-swatches" id="forge-finishes">${swatches}</div>`;
        }

        // Everything the custom equip menu puts on screen for a piece of gear,
        // read straight off the entry rather than off a wearer: its parameters,
        // its slot and type, what it is worth and what it weighs.
        metadataHTML(item) {
            const t = bsText();
            const et = T.obj('Equip');
            const rows = [];

            const PARAMS = [
                ['hp', 0], ['mp', 1], ['str', 2], ['con', 3],
                ['int', 4], ['wis', 5], ['dex', 6], ['psi', 7]
            ];
            let statsGrid = '';
            for (const [key, idx] of PARAMS) {
                const v = (item.params && item.params[idx]) || 0;
                if (!v) continue;
                const cls = v > 0 ? 'positive' : 'negative';
                statsGrid += `
                    <div class="stat-row">
                        <span class="stat-label">${escapeHtml(et[key] || key)}</span>
                        <span class="stat-diff ${cls}">${v > 0 ? '+' : ''}${v}</span>
                    </div>`;
            }

            const sys = $dataSystem || {};
            if (DataManager.isWeapon(item)) {
                const wt = (sys.weaponTypes || [])[item.wtypeId];
                if (wt) rows.push([t.weaponType, tr(wt)]);
            } else {
                const at = (sys.armorTypes || [])[item.atypeId];
                if (at) rows.push([t.armorType, tr(at)]);
            }
            const slot = (sys.equipTypes || [])[item.etypeId];
            if (slot) rows.push([t.slot, tr(slot)]);
            const rarity = rarityOf(item);
            if (rarity && rarity.name) rows.push([t.rarity, tr(rarity.name)]);
            rows.push([t.value, money(item.price || 0)]);
            if (window.ItemSystemUtils && window.ItemSystemUtils.getItemWeight) {
                rows.push([t.weight, window.ItemSystemUtils.formatWeight(
                    window.ItemSystemUtils.getItemWeight(item))]);
            }
            // Anything else the entry declares (Range, Movement, Level, ...) is
            // shown as written, so a note tag added later surfaces by itself.
            // Bookkeeping the smith wrote on the piece, and the model it is
            // drawn with, are not properties of the thing itself.
            const SKIP = /^(Recipe|Craft|CraftLevel|Category|Lore|Weight|Forge\w*|Forged|model3d|3DModel)$/i;
            for (const key of Object.keys(item.meta || {})) {
                if (SKIP.test(key)) continue;
                const val = item.meta[key];
                rows.push([key, val === true ? T('Blacksmith.yes') : String(val)]);
            }

            let table = '';
            for (const [label, val] of rows) {
                table += `<div class="stat-row"><span class="stat-label">${escapeHtml(label)}</span>` +
                    `<span class="inspect-spec-value">${escapeHtml(val)}</span></div>`;
            }

            let lore = '';
            if (window.ItemSystemUtils && window.ItemSystemUtils.loreFor) {
                const text = window.ItemSystemUtils.loreFor(item);
                if (text) lore = `<div class="equip-lore">${escapeHtml(text)}</div>`;
            }

            const head = (label) => `<h4 class="reagents-header">${escapeHtml(label)}</h4>`;
            return (statsGrid ? head(T('Blacksmith.bonuses')) + `<div class="stats-grid">${statsGrid}</div>` : '') +
                (table ? head(T('Blacksmith.specs')) + `<div class="stats-grid forge-meta">${table}</div>` : '') +
                lore;
        }

        // -------------------------------------------------- weapon preview
        // The same card the equip menu uses, for one entry instead of a
        // wearer's two hands: the weapon's real 3D model. An armor, or a
        // runtime without three.js, gets the icon on its rarity ring instead.
        previewHTML(item) {
            const canThree = typeof THREE !== 'undefined' && DataManager.isWeapon(item);
            let html = '<div class="weapon-previews-container">';
            if (canThree) {
                html += `<div class="weapon-preview-card weapon-preview-card--single"><canvas id="forge-preview-canvas" width="640" height="440"></canvas></div>`;
            } else {
                const rarity = rarityOf(item);
                // Nothing here is drawn in three dimensions, so the finish the
                // smith picked is shown as the cloth the piece is laid on.
                const finish = isForged(item)
                    ? (item.meta.ForgeTexture ? String(item.meta.ForgeTexture).trim() : '')
                    : this.chosenFinish(item);
                const skin = finish
                    ? ` style="background-image:url('${escapeHtml(finishSrc(finish))}'); background-size:cover; background-position:center"`
                    : '';
                const inner = `<div class="weapon-preview-icon-wrapper"><div class="weapon-preview-icon-circle" style="border:2.5px solid ${rarity.colorCode}"><div class="item-icon" style="${iconStyle(item.iconIndex, 32)}"></div></div></div>`;
                html += `<div class="weapon-preview-card weapon-preview-card--single"${skin}>${inner}</div>`;
            }
            return html + '</div>';
        }

        mount3D(baseItem) {
            this.dispose3D();
            if (typeof THREE === 'undefined' || !DataManager.isWeapon(baseItem)) return;
            const item = this.previewItem(baseItem);
            const canvas = document.getElementById('forge-preview-canvas');
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const width = rect.width || 400;
            const height = rect.height || 440;
            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            renderer.setSize(width, height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            const scene = new THREE.Scene();
            scene.add(new THREE.AmbientLight(0xffffff, 0.95));
            const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(3, 5, 4); scene.add(key);
            const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-3, -5, -4); scene.add(fill);
            const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 50);
            camera.position.set(0, 0, 2.7);

            const state = { renderer, scene, camera, model: null, raf: null };
            this._preview = state;

            const place = (m) => {
                const box = new THREE.Box3().setFromObject(m);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                m.position.sub(center);
                const fit = 1.85 / (Math.max(size.x, size.y, size.z) || 1);
                m.scale.set(fit, fit, fit);
                m.rotation.set(0.1, -0.4, 0.35);
                if (window.PSXShader) window.PSXShader.applyToObject(m);
                scene.add(m);
                state.model = m;
            };

            if (item.meta && item.meta.model3d && THREE.GLTFLoader) {
                new THREE.GLTFLoader().load(`models/${item.meta.model3d}`, g => place(g.scene), undefined,
                    err => console.error('[Blacksmithing] model load failed', err));
            } else if (window.WeaponSystemProcedural && WeaponSystemProcedural.createModel) {
                const model = WeaponSystemProcedural.createModel(item);
                if (model) place(model);
            }

            // Drag slides the view over the piece and the wheel leans in and
            // out. The piece itself never turns: a finish is picked off a still
            // object, and a swatch chosen against a spinning one is a guess.
            let dragging = false;
            let prev = { x: 0, y: 0 };
            const down = (e) => {
                dragging = true;
                prev = { x: e.clientX || 0, y: e.clientY || 0 };
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
            };
            const move = (e) => {
                if (!dragging) return;
                const dx = (e.clientX || 0) - prev.x;
                const dy = (e.clientY || 0) - prev.y;
                const pan = 0.0022 * camera.position.z;
                camera.position.x -= dx * pan;
                camera.position.y += dy * pan;
                prev = { x: e.clientX || 0, y: e.clientY || 0 };
            };
            const up = () => { dragging = false; canvas.style.cursor = ''; };
            const wheel = (e) => {
                e.preventDefault();
                camera.position.z = Math.max(0.35, Math.min(6, camera.position.z + e.deltaY * 0.0015));
            };
            canvas.addEventListener('mousedown', down);
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
            canvas.addEventListener('wheel', wheel, { passive: false });
            state.listeners = { canvas, down, move, up, wheel };

            const tick = () => {
                if (!state.renderer) return;
                // Moving parts the procedural model declares for itself.
                if (state.model && window.WeaponSystemProcedural) {
                    WeaponSystemProcedural.tickModelParts(state.model, 16);
                }
                state.renderer.render(state.scene, state.camera);
                state.raf = requestAnimationFrame(tick);
            };
            tick();
        }

        dispose3D() {
            const s = this._preview;
            if (!s) return;
            if (s.raf) cancelAnimationFrame(s.raf);
            if (s.listeners) {
                s.listeners.canvas.removeEventListener('mousedown', s.listeners.down);
                window.removeEventListener('mousemove', s.listeners.move);
                window.removeEventListener('mouseup', s.listeners.up);
                s.listeners.canvas.removeEventListener('wheel', s.listeners.wheel);
            }
            if (s.renderer) {
                s.renderer.dispose();
                // dispose() frees this preview's geometries and textures but
                // leaves the WebGL context itself alive, and renderDetail()
                // hands mount3D a brand new canvas for every recipe the cursor
                // lands on. The browser caps how many contexts may live at once
                // and force-loses the OLDEST past the cap, which is the game's
                // own canvas: a couple of dozen recipes into the forge, PIXI is
                // handed a restored context it cannot rebuild the tilemap and
                // the uploaded textures on, and the picture stays corrupted
                // with stale fragments for the rest of the session. Release it
                // here, and retire the canvas, since a lost context never comes
                // back on the element it was taken from.
                try { if (s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) {}
                const canvas = s.renderer.domElement;
                if (canvas && canvas.parentNode) {
                    canvas.parentNode.replaceChild(canvas.cloneNode(false), canvas);
                }
            }
            this._preview = null;
        }

        // ------------------------------------------------------------ overlay
        renderOverlay() {
            const el = document.getElementById('forge-overlay-container');
            if (!el) return;
            if (this._overlayTimer > 0 && this._overlayData) {
                const item = this._overlayData.item;
                const rarity = rarityOf(item);
                const smelted = this._overlayData.smelted;
                let rows = `
                        <div class="success-item-row">
                            <span class="icon" style="${iconStyle(item.iconIndex, 32)}"></span>
                            <span style="font-weight:bold; color:${rarity.colorCode}">${escapeHtml(displayName(item))}</span>
                        </div>`;
                if (smelted) {
                    for (const got of smelted) {
                        rows += `
                        <div class="success-item-row">
                            <span class="icon" style="${iconStyle(got.item.iconIndex, 24)}"></span>
                            <span>${escapeHtml(tr(got.item.name))} &times;${got.qty}</span>
                        </div>`;
                    }
                } else if (this._overlayData.quality) {
                    rows += `<div class="success-item-row"><span>${escapeHtml(qualityLabel(this._overlayData.quality))}</span></div>`;
                }
                el.innerHTML = `
                    <div class="success-overlay">
                        <div class="cauldron-animation" style="font-size:88px"></div>
                        <h2 class="success-title">${escapeHtml(smelted ? bsText().smelted : bsText().forged)}</h2>
                        ${rows}
                    </div>`;
            } else {
                el.innerHTML = '';
            }
        }

        // ------------------------------------------------------------- action
        async forgeSelected() {
            const item = this._selectedItem;
            if (!item) return;
            const recipe = parseRecipe(item);
            if (!this.canMake(item) || !hasMaterials(recipe)) {
                SoundManager.playBuzzer();
                return;
            }
            if (!isSandbox()) {
                for (const [id, qty] of Object.entries(recipe)) {
                    $gameParty.loseItem($dataItems[parseInt(id)], qty);
                }
            }
            // Nothing leaves this anvil as a copy of a catalogue entry. The
            // piece is registered as its own database entry with its own id, so
            // it stacks with nothing and keeps the sheet it was beaten out with.
            const made = await this.registerForged(item);
            if (!made) { SoundManager.playBuzzer(); return; }
            $gameParty.gainItem(made, 1);
            // What came off the anvil, in the party's diary (Diary.js).
            if (window.Diary) window.Diary.onCrafted('forge', made.name, 1);

            const spec = craftSpec(item);
            if (spec && window.SpecializationXP) {
                window.SpecializationXP.award(spec, TIER_POINTS[craftTier(item)] || 1, { actor: this.smith() });
            }

            this._overlayData = { item: made, quality: made.meta.ForgeQuality };
            this._overlayTimer = 110;
            this._listDirty = true;
            // Spending the last of the bill moves the piece off the smithable
            // tab and onto the one that needs materials, so the cursor is put
            // back on whatever now holds its place rather than left pointing
            // at a row that has gone.
            const items = this.itemsForTrade();
            const idx = items.indexOf(item);
            if (idx >= 0) {
                this._itemIndex = idx;
            } else {
                this._itemIndex = Math.max(0, Math.min(this._itemIndex, items.length - 1));
                this._selectedItem = items[this._itemIndex] || null;
                this._activeArea = this._selectedItem ? 'items' : 'trades';
                if (!this._selectedItem) this._selectedTrade = null;
            }
            SoundManager.playUseItem();
            this.refreshForge();
        }

        // One piece, one entry, one id. The record is what the save keeps; the
        // entry is rebuilt from it every time the game is loaded.
        async registerForged(base) {
            const kind = DataManager.isWeapon(base) ? 'w' : 'a';
            const smith = String((this.smith() && this.smith().name()) || '')
                .replace(/[<>\r\n]/g, '').trim();
            const quality = await rollQuality(this.smith(), base);
            const rec = {
                id: nextForgeId(kind),
                kind,
                baseId: base.id,
                smith,
                quality,
                texture: this.chosenFinish(base) || '',
                seed: this.pendingSeed(base),
                customName: (this._names && this._names[this.finishKey(base)] || '').trim(),
                params: rollParams(base, quality),
                price: Math.max(1, Math.round((base.price || 0) * quality * quality)),
                mark: 0
            };
            rec.mark = markNumber(rec) + 1;
            forgeStore().push(rec);
            const entry = materialize(rec);
            if (!entry) { forgeStore().pop(); return null; }
            // The look and the name the smith previewed went into the record
            // with the piece, so the next one off the same bill rolls its own.
            if (this._seeds) delete this._seeds[this.finishKey(base)];
            if (this._names) delete this._names[this.finishKey(base)];
            return entry;
        }

        // ------------------------------------------------------------- smelt
        // Back into the crucible. Half the bill comes out, a well-made piece
        // gives back more, and a piece that was worn down to nothing gives back
        // nothing at all.
        smeltSelected() {
            const item = this._selectedItem;
            if (!item || $gameParty.numItems(item) <= 0) {
                SoundManager.playBuzzer();
                return;
            }
            const yields = smeltYield(item);
            if (!yields) { SoundManager.playBuzzer(); return; }

            $gameParty.loseItem(item, 1);
            const got = [];
            for (const [id, qty] of Object.entries(yields)) {
                const mat = $dataItems[parseInt(id)];
                if (!mat || qty <= 0) continue;
                $gameParty.gainItem(mat, qty);
                got.push({ item: mat, qty });
            }

            this._overlayData = { item, smelted: got };
            this._overlayTimer = 110;
            this._listDirty = true;

            // Melting the last one down takes the piece off the forged board,
            // so the cursor is put back on whatever now holds its place.
            const items = this.itemsForTrade();
            const idx = items.indexOf(item);
            if (idx >= 0) {
                this._itemIndex = idx;
            } else {
                this._itemIndex = Math.max(0, Math.min(this._itemIndex, items.length - 1));
                this._selectedItem = items[this._itemIndex] || null;
                this._activeArea = this._selectedItem ? 'items' : 'trades';
                if (!this._selectedItem) this._selectedTrade = null;
            }
            SoundManager.playUseItem();
            this.refreshForge();
        }

        // -------------------------------------------------------------- input
        onSpreadClick(e) {
            const smith = e.target.closest('[data-smith]');
            if (smith) { this.selectSmith(parseInt(smith.dataset.smith)); return; }

            if (e.target.closest('#forge-back')) { SoundManager.playCancel(); this.popScene(); return; }

            if (e.target.closest('#forge-back-trades')) {
                this._selectedTrade = null;
                this._selectedItem = null;
                this._activeArea = 'trades';
                SoundManager.playCancel();
                this.refreshForge();
                return;
            }

            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) { this.setTab(tabBtn.dataset.tab); return; }

            const tradeRow = e.target.closest('[data-trade]');
            if (tradeRow) {
                this._selectedTrade = tradeRow.dataset.trade;
                this._tradeIndex = parseInt(tradeRow.dataset.idx) || 0;
                this._itemIndex = 0;
                this._activeArea = 'items';
                this._selectedItem = this.itemsForTrade()[0] || null;
                SoundManager.playOk();
                this.refreshForge();
                return;
            }

            const itemRow = e.target.closest('[data-item]');
            if (itemRow) {
                const idx = parseInt(itemRow.dataset.idx) || 0;
                this._itemIndex = idx;
                this._selectedItem = this.itemsForTrade()[idx] || null;
                this._activeArea = 'items';
                SoundManager.playCursor();
                this.refreshForge();
                return;
            }

            if (e.target.closest('#forge-name-reroll')) {
                if (this._selectedItem) this.rerollName(this._selectedItem);
                SoundManager.playCursor();
                this.refreshForge();
                return;
            }

            const swatch = e.target.closest('[data-finish]');
            if (swatch) {
                this.setFinish(this._selectedItem, swatch.dataset.finish);
                this._finishIndex = parseInt(swatch.dataset.fidx) || 0;
                this._activeArea = 'finish';
                SoundManager.playCursor();
                this.refreshForge();
                return;
            }

            if (e.target.closest('#forge-action')) { this.forgeSelected(); return; }
            if (e.target.closest('#forge-smelt')) { this.smeltSelected(); return; }
        }

        setTab(key) {
            if (this._tab === key || TABS.indexOf(key) < 0) return;
            this._tab = key;
            this._tabIndex = TABS.indexOf(key);
            this._selectedTrade = null;
            this._selectedItem = null;
            this._tradeIndex = 0;
            this._itemIndex = 0;
            this._activeArea = 'trades';
            this._listDirty = true;
            SoundManager.playOk();
            this.refreshForge();
        }

        updateForgeInput() {
            if (this._overlayTimer > 0) {
                if (Input.isTriggered('ok') || Input.isTriggered('cancel') || TouchInput.isTriggered()) {
                    this._overlayTimer = 0;
                    this._overlayData = null;
                    this.refreshForge();
                    return;
                }
                if (--this._overlayTimer === 0) {
                    this._overlayData = null;
                    this.refreshForge();
                }
                return;
            }

            // Shoulder buttons hand the anvil to another member.
            if (Input.isTriggered('pagedown')) { this.cycleSmith(1); return; }
            if (Input.isTriggered('pageup')) { this.cycleSmith(-1); return; }

            const cancel = Input.isTriggered('cancel') || TouchInput.isCancelled();

            if (this._activeArea === 'tabs') {
                const step = Input.isTriggered('right') ? 1 : (Input.isTriggered('left') ? -1 : 0);
                if (step && this._tabIndex + step >= 0 && this._tabIndex + step < TABS.length) {
                    this.setTab(TABS[this._tabIndex + step]);
                    this._activeArea = 'tabs';
                    this.refreshForge();
                } else if (Input.isTriggered('ok') || Input.isTriggered('down')) {
                    this._activeArea = 'trades';
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel) { SoundManager.playCancel(); this.popScene(); }
                return;
            }

            if (this._activeArea === 'trades') {
                const trades = this.trades();
                if (Input.isRepeated('down') && this._tradeIndex < trades.length - 1) {
                    this._tradeIndex++; SoundManager.playCursor(); this.refreshForge();
                } else if (Input.isRepeated('up')) {
                    if (this._tradeIndex > 0) { this._tradeIndex--; SoundManager.playCursor(); this.refreshForge(); }
                    else { this._activeArea = 'tabs'; SoundManager.playCursor(); this.refreshForge(); }
                } else if (Input.isTriggered('ok') && trades.length) {
                    this._selectedTrade = trades[this._tradeIndex].name;
                    this._itemIndex = 0;
                    this._selectedItem = this.itemsForTrade()[0] || null;
                    this._activeArea = 'items';
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel) { SoundManager.playCancel(); this.popScene(); }
                return;
            }

            if (this._activeArea === 'items') {
                const items = this.itemsForTrade();
                if (Input.isRepeated('down') && this._itemIndex < items.length - 1) {
                    this._itemIndex++;
                    this._selectedItem = items[this._itemIndex];
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (Input.isRepeated('up') && this._itemIndex > 0) {
                    this._itemIndex--;
                    this._selectedItem = items[this._itemIndex];
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (Input.isTriggered('ok')) {
                    this._activeArea = this.hasFinishes() ? 'finish' : this.firstButtonArea();
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel) {
                    this._selectedTrade = null;
                    this._selectedItem = null;
                    this._activeArea = 'trades';
                    SoundManager.playCancel();
                    this.refreshForge();
                }
                return;
            }

            // The swatch strip: left and right walk it, OK takes the one under
            // the cursor and drops down to the buttons.
            if (this._activeArea === 'finish') {
                const list = finishesFor(this._selectedItem);
                const last = list.length;   // slot 0 is 'as it falls'
                const step = Input.isRepeated('right') ? 1 : (Input.isRepeated('left') ? -1 : 0);
                if (step) {
                    this._finishIndex = Math.max(0, Math.min(last, this._finishIndex + step));
                    this.setFinish(this._selectedItem, this._finishIndex ? list[this._finishIndex - 1] : '');
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (Input.isTriggered('ok') || Input.isTriggered('down')) {
                    this._activeArea = this.firstButtonArea();
                    SoundManager.playOk();
                    this.refreshForge();
                } else if (cancel || Input.isTriggered('up')) {
                    this._activeArea = 'items';
                    SoundManager.playCancel();
                    this.refreshForge();
                }
                return;
            }

            if (this._activeArea === 'forge') {
                if (Input.isTriggered('ok')) this.forgeSelected();
                else if (Input.isTriggered('right')) {
                    this._activeArea = 'smelt';
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (cancel || Input.isTriggered('up')) {
                    this._activeArea = this.hasFinishes() ? 'finish' : 'items';
                    SoundManager.playCancel();
                    this.refreshForge();
                }
                return;
            }

            if (this._activeArea === 'smelt') {
                if (Input.isTriggered('ok')) this.smeltSelected();
                else if (Input.isTriggered('left') && !isForged(this._selectedItem)) {
                    this._activeArea = 'forge';
                    SoundManager.playCursor();
                    this.refreshForge();
                } else if (cancel || Input.isTriggered('up')) {
                    this._activeArea = this.hasFinishes() ? 'finish' : 'items';
                    SoundManager.playCancel();
                    this.refreshForge();
                }
            }
        }

        hasFinishes() {
            return !!this._selectedItem && !isForged(this._selectedItem) && finishesFor(this._selectedItem).length > 0;
        }

        // A piece already made has no Forge button, so the cursor lands on the
        // crucible instead.
        firstButtonArea() {
            return isForged(this._selectedItem) ? 'smelt' : 'forge';
        }
    }

    window.Scene_Blacksmithing = Scene_Blacksmithing;

    // ========================================================================
    // Entry points
    // ========================================================================
    PluginManager.registerCommand(pluginName, 'openBlacksmithing', () => {
        SceneManager.push(Scene_Blacksmithing);
    });
    PluginManager.registerCommand('Crafting/BlacksmithingMenu', 'openBlacksmithing', () => {
        SceneManager.push(Scene_Blacksmithing);
    });

    if (showInMenu) {
        const _addMainCommands = Window_MenuCommand.prototype.addMainCommands;
        Window_MenuCommand.prototype.addMainCommands = function () {
            _addMainCommands.call(this);
            this.addCommand(T.has('Blacksmith.title') ? T('Blacksmith.title') : menuName, 'blacksmithing', true, 108);
        };

        const _createCommandWindow = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function () {
            _createCommandWindow.call(this);
            this._commandWindow.setHandler('blacksmithing', () => SceneManager.push(Scene_Blacksmithing));
        };
    }
})();
