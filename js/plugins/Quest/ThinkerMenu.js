/*:
 * @target MZ
 * @plugindesc ThinkerMenu v1.2.0 (D&D Parchment Crafting Edition)
 * @author Omni-Lex
 * @help
 * ============================================================================
 * ThinkerMenu Plugin for RPGMaker MZ - Parchment Edition
 * ============================================================================
 *
 * This plugin adds a premium alchemical crafting menu accessible from the main menu 
 * with Assemble (Crafting) and Disassemble (Salvaging) options.
 *
 * Items can have recipes defined in their note tags:
 * <Recipe: 869x2, 858x1>
 *
 * Items can have categories defined in their note tags:
 * <Category: Food>
 *
 * Items can be excluded from crafting with:
 * <Uncraftable>
 *
 * An item can name the trade it is made in, overriding the one its category
 * would answer for, with the forge's own tag:
 * <Craft: Blacksmithing>
 *
 * An item everybody already knows how to make - legible and buildable at any
 * level of that trade, from the first morning - is marked:
 * <StarterRecipe>
 *
 * Where 869 is the item ID and x2 is the quantity required.
 *
 * NOTE: Items without a <Recipe> tag or with the <Uncraftable> tag cannot
 * be assembled or disassembled.
 *
 * @param menuName
 * @text Menu Name
 * @desc The name displayed in the main menu
 * @default Thinker
 * 
 * @param showInMenu
 * @text Show in Menu
 * @desc Show the Thinker option in the main menu
 * @type boolean
 * @default true
 * 
 * @command openThinkerMenu
 * @text Open Thinker Menu
 * @desc Opens the Thinker crafting menu
 */

(() => {
    'use strict';

    const pluginName = 'ThinkerMenu';
    const parameters = PluginManager.parameters(pluginName);
    const menuName = parameters['menuName'] || 'Thinker';
    const showInMenu = parameters['showInMenu'] === 'true';

    // Copy lives in js/i18n/<lang>/plugins/Thinker.json; read live so a
    // language switch reaches the next redraw.
    const thinkerText = () => T.obj('Thinker');



    // Category icon mapping
    function getCategoryIcon(category) {
        // i18n-ignore-start: <category:> note-tag ids; the label the player sees
        // comes from categoryLabel()
        switch (category) {
            case "Arctic": return 67;
            case "Artisan": return 188;
            case "Combat": return 334;
            case "Collectibles": return 210;
            case "Component": return 83;
            case "Counterfeits": return 306;
            case "Enhancers": return 179;
            case "Espionage": return 130;
            case "Essentials": return 83;
            case "Food": return 265;
            case "Homeopathy": return 273;
            case "Jungle": return 277;
            case "Lifestyle": return 84;
            case "Magic": return 176;
            case "Medical": return 32;
            case "Monsters": return 293;
            case "Plants": return 182;
            case "Recovery": return 180;
            case "Survival": return 208;
            case "Trash": return 289;
            case "Weapons": return 96;
            case "Armor": return 128;
            case "Misc": return 245;
            default: return 245;
        }
        // i18n-ignore-end
    }

    // The word for a crafting category. The id stays as written, so an
    // unlisted (modded) category still reads.
    function categoryLabel(category) {
        const key = 'Thinker.category.' + String(category || '');
        return T.has(key) ? T(key) : String(category || '');
    }

    // Parse recipe from item note (cached: notes are static, so parse each entry once)
    const _recipeCache = new Map();
    function parseRecipe(item) {
        if (!item || !item.note) return null;
        if (_recipeCache.has(item)) return _recipeCache.get(item);
        const match = item.note.match(/<Recipe:\s*(.+?)>/i);
        if (!match) {
            _recipeCache.set(item, null);
            return null;
        }

        const recipe = {};
        const parts = match[1].split(',');

        for (const part of parts) {
            const [id, qty] = part.trim().split('x');
            recipe[parseInt(id)] = parseInt(qty) || 1;
        }

        _recipeCache.set(item, recipe);
        return recipe;
    }

    // Parse category from item note
    function parseCategory(item) {
        // i18n-ignore-start: <Category:> note-tag id, named by categoryLabel()
        if (!item || !item.note) return "Misc";
        const match = item.note.match(/<Category:\s*(.+?)>/i);
        return match ? match[1].trim() : "Misc";
        // i18n-ignore-end
    }

    // Check if item is uncraftable
    function isUncraftable(item) {
        if (!item || !item.note) return false;
        return /<Uncraftable>/i.test(item.note);
    }

    // The recipes a party already has on the first morning. A starter recipe is
    // not learned from anybody and not read off a trade: it is the sort of thing
    // everyone in this world grew up watching being made, so it is legible and
    // buildable at Untrained and stays that way at Master. Written on the entry
    // itself as <StarterRecipe>, so what is common knowledge is a property of the
    // thing rather than a list some plugin has to keep in step.
    function isStarterRecipe(item) {
        if (!item || !item.note) return false;
        return /<StarterRecipe>/i.test(item.note);
    }

    // ---- Database-spanning helpers (items + weapons are craftable here; armor
    // is Blacksmithing's alone) ----
    function isRealEntry(x) {
        return x && x.name && x.name.trim() && !x.name.includes('-->');
    }

    function dbKindOf(item) {
        if (DataManager.isWeapon(item)) return 'w';
        if (DataManager.isArmor(item)) return 'a';
        return 'i';
    }

    function getDbEntry(db, id) {
        if (db === 'w') return $dataWeapons[id];
        if (db === 'a') return $dataArmors[id];
        return $dataItems[id];
    }

    let _allEntriesCache = null;
    let _allEntriesSource = null;
    function allCraftableEntries() {
        // Database arrays are static after load; rebuild only if they were reloaded
        if (_allEntriesCache && _allEntriesSource === $dataItems) return _allEntriesCache;
        const out = [];
        for (const x of $dataItems) if (isRealEntry(x)) out.push(x);
        for (const x of $dataWeapons) if (isRealEntry(x)) out.push(x);
        _allEntriesCache = out;
        _allEntriesSource = $dataItems;
        return out;
    }

    // Check if player has materials for recipe
    function canCraft(recipe) {
        if ($gameSystem && $gameSystem._isSandboxMode) return true;
        if (!recipe) return false;

        for (const [itemId, required] of Object.entries(recipe)) {
            const item = $dataItems[parseInt(itemId)];
            if (!item) return false;
            if ($gameParty.numItems(item) < required) {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------------
    // Fabrication - the specialization the workbench runs on
    // ------------------------------------------------------------------------
    // The Thinker is the one menu whose contents are gated by a skill. Every
    // recipe is weighted by how much of a job it is (how many different things
    // go into it, and how many of them), and that weight sorts it into one of
    // five tiers. A party can only assemble up to the tier it has trained to,
    // so the workbench opens up as it is used: bigger recipes, more materials.
    //
    // Below Master an assembly can also botch, which is what makes the early
    // tiers worth training out of rather than a formality. A botch eats half
    // the reagents and still teaches a point.
    const FAB_SPEC = 'Fabrication';  // i18n-ignore  Specialization.json id
    // Upper weight bound of tiers 1-4; anything heavier is tier 5.
    const TIER_WEIGHTS = [8, 10, 14, 20];
    // Botch chance at each Fabrication level, 1 (Untrained) to 5 (Master).
    const FAIL_BY_LEVEL = [0, 0.30, 0.18, 0.10, 0.04, 0];
    const TIER_RISK = 0.2;    // ...multiplied by this much per tier above the first
    const FAIL_CAP = 0.6;
    // What a finished assembly teaches, by tier. A tier-5 build is a lesson.
    const TIER_POINTS = [0, 1, 2, 3, 5, 8];
    const BOTCH_POINTS = 1;
    const SALVAGE_POINTS = 1;
    // A hand that knows the trade wastes less of it: the chance each unit of a
    // reagent is handed back off a finished assembly, by the level of the trade
    // the recipe belongs to (1 Untrained to 5 Master). Read off the trade, not
    // off Fabrication: knowing where a bench is does not save you leather.
    const RECLAIM_BY_LEVEL = [0, 0, 0.10, 0.20, 0.32, 0.45];

    function isSandbox() {
        return !!($gameSystem && $gameSystem._isSandboxMode);
    }

    // 2 x (distinct ingredients) + (total units), cached per entry: notes are
    // static, so a recipe's tier never changes at runtime.
    const _tierCache = new Map();
    function recipeTier(item) {
        if (_tierCache.has(item)) return _tierCache.get(item);
        const recipe = parseRecipe(item);
        let tier = 1;
        if (recipe) {
            const ids = Object.keys(recipe);
            let units = 0;
            for (const id of ids) units += recipe[id] || 1;
            const weight = ids.length * 2 + units;
            tier = TIER_WEIGHTS.findIndex(max => weight <= max) + 1;
            if (tier === 0) tier = TIER_WEIGHTS.length + 1;
        }
        _tierCache.set(item, tier);
        return tier;
    }

    // The member the workbench's party switcher has at the bench. Everything
    // the workbench decides - which tiers are open, how likely a botch is, how
    // much a teardown gives back - is read off THEM, not off the party's best.
    function benchActor() {
        const scene = SceneManager._scene;
        if (scene && typeof scene.fabActor === 'function') {
            const actor = scene.fabActor();
            if (actor) return actor;
        }
        return ($gameParty && $gameParty.leader) ? $gameParty.leader() : null;
    }

    function fabLevel() {
        if (!window.SpecializationXP) return 1;
        return window.SpecializationXP.levelOf(benchActor(), FAB_SPEC);
    }

    // Whether the party is trained enough to attempt this recipe at all. A
    // starter recipe asks for no training at any tier: everybody can already
    // make one.
    function tierMet(item) {
        return isSandbox() || isStarterRecipe(item) || fabLevel() >= recipeTier(item);
    }

    // The name of the tier a recipe wants, for the notice on a locked one.
    function tierLevelName(item) {
        const db = window.Specializations;
        return db && db.levelName ? db.levelName(recipeTier(item)) : String(recipeTier(item));
    }

    function botchChance(item) {
        if (isSandbox()) return 0;
        const base = FAIL_BY_LEVEL[Math.max(1, Math.min(5, fabLevel()))] || 0;
        if (!base) return 0;
        return Math.min(FAIL_CAP, base * (1 + TIER_RISK * (recipeTier(item) - 1)));
    }

    // ------------------------------------------------------------------------
    // What the bench can already read
    // ------------------------------------------------------------------------
    // A blueprint used to be legible only once it had been built, so the book
    // was a record of what the party had done rather than of what they know how
    // to do, and a trained smith opened it on a page of question marks.
    // Training reads it too: every crafting category is one trade, and someone
    // who has trained that trade recognises its work on sight. No two
    // categories answer to the same trade, so a cook reads the food page and
    // nothing else, and how much of their own page they read is their level in
    // it against each recipe's tier: a Beginner recognises tier 1 work, an
    // Intermediate tier 2, a Master the whole page. Training therefore opens
    // the book gradually, exactly as it opens the bench.
    //
    // The names are specialization ids from js/db/Skills/Specialization.json;
    // a category with no entry of its own falls back to Misc's, and weapons and
    // armor answer to the forge whatever category they were filed under.
    // i18n-ignore-start
    const CATEGORY_SPECS = {
        Arctic: 'Igloo Building',
        Armor: 'Armor Smithing',
        Artisan: 'Woodcarving',
        Books: 'Bookbinding',
        Collectibles: 'Antique Restoration',
        Combat: 'Improvised Explosives',
        Component: 'Electronics',
        Counterfeits: 'Counterfeiting',
        Enhancers: 'Alchemy',
        Espionage: 'Electronics',
        Essentials: 'Fabrication',
        Farming: 'Farming',
        Food: 'Cooking',
        Homeopathy: 'Naturopathy',
        Jungle: 'Foraging',
        Lifestyle: 'Carpentry',
        Magic: 'Runecrafting',
        Medical: 'Pharmacology',
        Monsters: 'Taxidermy',
        Plants: 'Herbalism',
        Recovery: 'First Aid',
        Survival: 'Survival',
        Tools: 'Metalworking',
        Trash: 'Maintenance',
        Vehicles: 'Mechanics',
        Weapons: 'Weaponsmithing',
        Misc: 'Manual Tooling'
    };
    const WEAPON_SPEC = 'Weaponsmithing';
    const ARMOR_SPEC = 'Armor Smithing';
    // i18n-ignore-end

    // A category page asks for hundreds of rows and every ask walks the
    // member's class and traits, so levels are read once per redraw.
    let _readCache = new Map();
    function clearRecipeKnowledgeCache() {
        _readCache = new Map();
    }

    function readLevel(specName) {
        if (!window.SpecializationXP) return 1;
        if (_readCache.has(specName)) return _readCache.get(specName);
        const level = window.SpecializationXP.levelOf(benchActor(), specName) || 1;
        _readCache.set(specName, level);
        return level;
    }

    // The one trade a recipe belongs to. An entry may name it outright with the
    // forge's own <Craft:> tag, which is how a thing filed on one shelf is made
    // at another bench: a lockpick sits under Espionage with the rest of the
    // burglar's kit, but it is two bits of steel and a smith makes it. Failing
    // that, the shelf answers for it.
    function recipeSpec(item) {
        const declared = item && item.meta && item.meta.Craft;
        if (declared) return String(declared).trim();
        if (DataManager.isWeapon(item)) return WEAPON_SPEC;
        if (DataManager.isArmor(item)) return ARMOR_SPEC;
        return CATEGORY_SPECS[parseCategory(item)] || CATEGORY_SPECS.Misc;
    }

    // The trade the member reads this recipe with and how far along in it they
    // are, whether or not that is far enough to make anything of the page.
    function readingSpec(item) {
        const name = recipeSpec(item);
        return { name, level: readLevel(name) };
    }

    // How far along the trade a pair of hands has to be before this recipe is
    // legible on sight. A tier is not enough by itself: Untrained is where
    // everyone starts, and a level everyone has cannot be what distinguishes a
    // recipe they recognise from one they do not, so the whole book used to open
    // on its tier-1 half already read. Untrained therefore reveals nothing, and
    // the first tier is a Beginner's to recognise. What the party can make on
    // the first morning is only what is marked <StarterRecipe>.
    function revealLevel(item) {
        return Math.max(2, recipeTier(item));
    }

    // The training that puts this recipe on the page, or null when it does not
    // reach that far.
    function revealingSpec(item) {
        const trade = readingSpec(item);
        return trade.level >= revealLevel(item) ? trade : null;
    }

    // Whether the blueprint reads at all: common knowledge, built once before,
    // or recognised off the trade it belongs to.
    function knowsRecipe(item) {
        if (isSandbox()) return true;
        if (isStarterRecipe(item)) return true;
        if ($gameSystem && $gameSystem.hasCrafted(item.id)) return true;
        return !!revealingSpec(item);
    }

    // A specialization's name as the player reads it.
    function specLabel(name) {
        return (typeof window.translateText === 'function') ? window.translateText(name) : name;
    }

    // ── Shared recipe service ────────────────────────────────────────────────
    // What the workbench knows about a blueprint, offered to any other menu that
    // wants to ask the same questions (the main menu's search page lists what the
    // party could make right now). Every answer is the workbench's own, so the
    // two can never disagree about whether a recipe reads or a sack covers it.
    window.CraftRecipes = {
        // Every item/weapon entry the bench could ever make.
        entries: allCraftableEntries,
        parseRecipe,
        isUncraftable,
        categoryOf: parseCategory,
        tier: recipeTier,
        // The bill is covered by what the party carries.
        hasMaterials: (item) => canCraft(parseRecipe(item)),
        // The blueprint reads at all: common knowledge, built before, or
        // recognised off the trade.
        knows: knowsRecipe,
        // Known to everybody from the first morning, whatever their training.
        isStarter: isStarterRecipe,
        // Trained far enough to attempt it.
        tierMet,
        // Reading, making, and holding the reagents for it, all at once.
        canMakeNow: (item) => {
            const recipe = parseRecipe(item);
            if (!recipe || isUncraftable(item)) return false;
            return knowsRecipe(item) && tierMet(item) && canCraft(recipe);
        },
        // The trade a recipe belongs to, as the player reads it.
        tradeName: (item) => specLabel(recipeSpec(item)),
        clearKnowledgeCache: clearRecipeKnowledgeCache
    };

    function levelLabel(level) {
        const db = window.Specializations;
        return (db && db.levelName) ? db.levelName(level) : String(level);
    }

    // The chance each unit of a reagent survives the assembly and is handed
    // back. Sandbox spends nothing in the first place, so it never applies.
    function reclaimChance(item) {
        if (isSandbox()) return 0;
        return RECLAIM_BY_LEVEL[Math.max(1, Math.min(5, readingSpec(item).level))] || 0;
    }

    // How many pieces come back off a teardown: a practised hand takes a thing
    // apart without ruining half of it, and knowing the trade it was made in
    // is worth as much again as knowing the bench.
    function salvageYield(item) {
        const trade = item ? readingSpec(item).level : 1;
        return 1 + Math.floor(Math.random() * 2)
            + Math.floor((fabLevel() - 1) / 2)
            + Math.floor((trade - 1) / 2);
    }

    // Safe item rarity helper
    function getItemRarity(item) {
        if (window.ItemSystemUtils && typeof window.ItemSystemUtils.getItemRarity === 'function') {
            return window.ItemSystemUtils.getItemRarity(item);
        }
        // i18n-ignore-start: rarity tier ids, mirroring ItemSystemUtils
        if (!item) return { name: "Common", colorCode: "#FFFFFF" };
        const price = item.price || 0;
        if (price >= 1000000) return { name: "Legendary", colorCode: "#FF8000" };
        if (price >= 100000) return { name: "Epic", colorCode: "#8000FF" };
        if (price >= 10000) return { name: "Rare", colorCode: "#0080FF" };
        if (price >= 1000) return { name: "Uncommon", colorCode: "#1AFF1A" };
        return { name: "Common", colorCode: "#FFFFFF" };
        // i18n-ignore-end
    }

    // Whether an entry belongs on the page the player is reading: the Learned
    // book holds only what this member can read, the All book holds everything.
    function passesFilter(item, filter) {
        return filter === 'all' || knowsRecipe(item);
    }

    // Get all available categories with craftable counts, under the filter the
    // book is open at. A category nobody in the party can read yet is left off
    // the Learned page entirely rather than opening onto an empty one.
    function getAvailableCategories(filter) {
        const categories = {};
        for (const item of allCraftableEntries()) {
            if (!parseRecipe(item) || isUncraftable(item)) continue;
            if (!passesFilter(item, filter)) continue;

            const category = parseCategory(item);
            if (!categories[category]) {
                categories[category] = {
                    total: 0,
                    craftable: 0
                };
            }

            categories[category].total++;
            // "Craftable" means the party has the materials AND the training:
            // a recipe above its Fabrication tier does not count.
            if (canCraft(parseRecipe(item)) && tierMet(item)) {
                categories[category].craftable++;
            }
        }
        return categories;
    }

    // Plugin command
    PluginManager.registerCommand(pluginName, 'openThinkerMenu', args => {
        SceneManager.push(Scene_Thinker);
    });

    // Add to main menu
    if (showInMenu) {
        const _Window_MenuCommand_addMainCommands = Window_MenuCommand.prototype.addMainCommands;
        Window_MenuCommand.prototype.addMainCommands = function () {
            _Window_MenuCommand_addMainCommands.call(this);

            this.addCommand(menuName, 'thinker', true, 186);
        };

        const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function () {
            _Scene_Menu_createCommandWindow.call(this);
            this._commandWindow.setHandler('thinker', this.commandThinker.bind(this));
        };

        Scene_Menu.prototype.commandThinker = function () {
            SceneManager.push(Scene_Thinker);
        };
    }

    // Save crafted items Progress array
    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        _Game_System_initialize.call(this);
        this._craftedItems = [];
    };

    Game_System.prototype.addCraftedItem = function (itemId) {
        if (!this._craftedItems) this._craftedItems = [];
        if (!this._craftedItems.includes(itemId)) {
            this._craftedItems.push(itemId);
        }
    };

    Game_System.prototype.hasCrafted = function (itemId) {
        if ($gameSystem && $gameSystem._isSandboxMode) return true;
        if (!this._craftedItems) this._craftedItems = [];
        return this._craftedItems.includes(itemId);
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        if ($gameSystem && !$gameSystem._craftedItems) {
            $gameSystem._craftedItems = [];
        }
    };

    // =============================================================================
    // Scene_Thinker - Parchment D&D Crafting UI
    // =============================================================================

    class Scene_Thinker extends Scene_MenuBase {
        create() {
            super.create();

            // Hide parent canvas helper windows
            if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }

            this._mode = 'assemble'; // 'assemble' or 'disassemble'
            this._activeArea = 'modes'; // 'modes', 'categories', 'items', 'workbench'

            this._selectedCategory = null;
            this._modeIndex = 0; // 0: Assemble, 1: Disassemble
            this._categoryIndex = 0;
            this._itemIndex = 0;

            this._selectedItem = null;
            this._successOverlayTimer = 0;
            this._successOverlayData = null;

            // Which book is open: 'learned' (only what this member can read)
            // or 'all' (every recipe in the game, unread ones included). A
            // party that has neither built nor trained anything would open on a
            // blank page, so the first look is the whole book.
            this._recipeFilter = 'learned';
            clearRecipeKnowledgeCache();
            if (!Object.keys(getAvailableCategories('learned')).length) {
                this._recipeFilter = 'all';
            }


            this._fabActorIndex = 0;

            // The shared search + filter strip (UI/MenuSearchBar.js), in the
            // bench's vocabulary: recipes have a category and a weight and a
            // price, and no level or cast cost.
            this._thinkerBar = window.MenuSearchBar ? window.MenuSearchBar.create({
                id: 'thinker',
                placeholder: T('Thinker.searchPlaceholder'),
                sorts: ['name', 'weight', 'price'],
                onChange: () => {
                    this._itemIndex = 0;
                    this._thinkerItemsDirty = true;
                    this.refreshUIThinker();
                    if (this._thinkerBar) this._thinkerBar.restoreFocus();
                }
            }) : null;

            this.initUIThinkerLayout();
            this.refreshUIThinker();
            if (window.CharSwitcher) {
                window.CharSwitcher.installTabKey(this, (dir) => this.cycleFabActor(dir));
            }
        }

        // Who is at the bench. Everything the workbench decides is read off
        // them, so switching member re-tiers the whole recipe list.
        fabMembers() {
            return ($gameParty && $gameParty.members) ? $gameParty.members() : [];
        }

        fabActor() {
            const members = this.fabMembers();
            if (!members.length) return null;
            const idx = Math.max(0, Math.min(members.length - 1, this._fabActorIndex || 0));
            return members[idx];
        }

        selectFabActor(index) {
            const members = this.fabMembers();
            if (!members.length) return;
            const next = ((index % members.length) + members.length) % members.length;
            if (next === this._fabActorIndex) return;
            this._fabActorIndex = next;
            SoundManager.playCursor();
            // A different pair of hands opens (or closes) whole tiers, so the
            // category counts and the workbench both have to be rebuilt.
            this._thinkerItemsDirty = true;
            this.refreshUIThinker();
        }

        cycleFabActor(dir) {
            this.selectFabActor((this._fabActorIndex || 0) + dir);
        }

        // Which of the two books is open. Changing it re-counts the categories
        // and re-cuts the list, so both caches go with it.
        setRecipeFilter(filter) {
            if (filter === this._recipeFilter) return;
            this._recipeFilter = filter;
            this._selectedItem = null;
            this._itemIndex = 0;
            this._categoryIndex = 0;
            SoundManager.playCursor();
            this._thinkerItemsDirty = true;
            this.refreshUIThinker();
        }

        toggleRecipeFilter() {
            this.setRecipeFilter(this._recipeFilter === 'learned' ? 'all' : 'learned');
        }

        update() {
            // A focused search field owns the keyboard (UI/MenuSearchBar.js).
            if (!(window.MenuSearchBar && window.MenuSearchBar.isTyping())) {
                this.updateUIThinkerInput();
            }
            super.update();
        }

        terminate() {
            if (this._thinkerBar) { this._thinkerBar.dispose(); this._thinkerBar = null; }
            const container = document.getElementById("thinker-container");
            if (container) container.remove();
            if (window.SpecBadge) window.SpecBadge.hide();
            if (window.CharSwitcher) window.CharSwitcher.removeTabKey(this);
            super.terminate();
        }

        initUIThinkerLayout() {
            if (!document.getElementById("thinker-container")) {
                const container = document.createElement("div");
                container.id = "thinker-container";
                document.body.appendChild(container);
            }
        }

        refreshUIThinker() {
            const container = document.getElementById("thinker-container");
            if (!container) return;

            // A page asks for hundreds of levels and a level walks the member's
            // class and traits; they cannot change inside one redraw, so they
            // are read once for it.
            clearRecipeKnowledgeCache();

            const t = thinkerText();

            // 1. Initial Render of Book Structure if not present
            let spread = container.querySelector(".book-spread");
            if (!spread) {
                const backBtnText = T('Thinker.back');

                container.innerHTML = `
                    <div class="book-spread">
                        <!-- Success Overlay Container -->
                        <div id="success-overlay-container"></div>
                        
                        <div class="left-page">
                            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%">
                                <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; font-family: 'Lora', serif; font-size: 0.96rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); display: inline-flex; height: fit-content">
                                    ${backBtnText}
                                </div>
                                <h2 class="title" style="border: none; margin: 0; padding: 0">${t.title}</h2>
                            </div>
                            
                            <!-- Tab buttons container -->
                            <!-- Search + filter strip (UI/MenuSearchBar.js) -->
                            <div id="thinker-search-slot"></div>

                            <div id="tabs-container"></div>

                            <!-- List viewport -->
                            <div class="list-viewport"></div>
                        </div>
                        
                        <div class="right-page">
                            <div id="thinker-companion-row" class="companion-switcher companion-switcher--header"></div>
                            <div class="workbench"></div>
                        </div>
                    </div>
                `;
                spread = container.querySelector(".book-spread");

                // Bind single delegated click handler (Event Delegation)
                spread.addEventListener("click", (e) => {
                    // Back button
                    const backBtn = e.target.closest("#back-categories");
                    if (backBtn) {
                        this._selectedCategory = null;
                        this._selectedItem = null;
                        this._activeArea = 'categories';
                        SoundManager.playCancel();
                        this.refreshUIThinker();
                        return;
                    }

                    // Learned / All books (checked first: they are tab buttons too)
                    const filterBtn = e.target.closest(".filter-btn");
                    if (filterBtn) {
                        this.setRecipeFilter(filterBtn.getAttribute("data-filter"));
                        return;
                    }

                    // Tabs
                    const tabBtn = e.target.closest(".tab-btn");
                    if (tabBtn) {
                        const idx = parseInt(tabBtn.getAttribute("data-idx"));
                        this._mode = idx === 0 ? 'assemble' : 'disassemble';
                        this._selectedCategory = null;
                        this._selectedItem = null;
                        this._modeIndex = idx;
                        // Jump straight into the relevant list area
                        this._activeArea = (idx === 0) ? 'categories' : 'items';
                        this._categoryIndex = 0;
                        this._itemIndex = 0;
                        SoundManager.playOk();
                        this.refreshUIThinker();
                        return;
                    }

                    // Category rows
                    const catRow = e.target.closest(".category-row");
                    if (catRow) {
                        const catName = catRow.getAttribute("data-cat");
                        const idx = parseInt(catRow.getAttribute("data-idx"));
                        this._selectedCategory = catName;
                        this._categoryIndex = idx;
                        this._activeArea = 'items';
                        this._itemIndex = 0;
                        this._selectedItem = null;
                        SoundManager.playOk();
                        this.refreshUIThinker();
                        return;
                    }

                    // Blueprint / salvage rows
                    const itemRow = e.target.closest(".blueprint-row");
                    if (itemRow) {
                        const itemId = parseInt(itemRow.getAttribute("data-item-id"));
                        const db = itemRow.getAttribute("data-db") || 'i';
                        const idx = parseInt(itemRow.getAttribute("data-idx"));
                        this._selectedItem = getDbEntry(db, itemId);
                        this._itemIndex = idx;
                        this._activeArea = 'items';
                        SoundManager.playOk();
                        this.refreshUIThinker();
                        return;
                    }

                    // Workbench action button
                    const actionBtn = e.target.closest("#transmute-action");
                    if (actionBtn && actionBtn.classList.contains("enabled")) {
                        this._activeArea = 'workbench';
                        this.executeCrucibleTransmutation();
                        return;
                    }
                });
            }

            // 2. Render Tabs (if state changed or first load)
            // The party switcher heads the right page: whoever it names
            // is the one working the bench, and their Fabrication is what the
            // whole menu is measured against.
            const compRow = spread.querySelector("#thinker-companion-row");
            if (compRow && window.CharSwitcher) {
                // The switcher heads the page in place of its old title, so it
                // is drawn even for a party of one: the single name says whose
                // hands the skill badge underneath is reporting.
                const members = this.fabMembers();
                let tabs = "";
                members.forEach((m, idx) => {
                    const sel = idx === (this._fabActorIndex || 0) ? "selected" : "";
                    tabs += `<div class="companion-tab ${sel}" onclick="SceneManager._scene.selectFabActor(${idx})">${m.name()}</div>`;
                });
                compRow.innerHTML = window.CharSwitcher.inner(
                    `<div class="companion-tabs-row">${tabs}</div>`, members.length);
            }
            if (window.SpecBadge) window.SpecBadge.show(FAB_SPEC, { actor: this.fabActor() });

            // The strip is rebuilt in place and handed its caret back, so
            // typing into it never loses the cursor mid-word.
            const searchSlot = spread.querySelector("#thinker-search-slot");
            if (searchSlot && this._thinkerBar) {
                searchSlot.innerHTML = this._thinkerBar.html();
                this._thinkerBar.restoreFocus();
            }

            const tabsContainer = spread.querySelector("#tabs-container");
            if (tabsContainer) {
                // The second row is the book itself: the recipes this member
                // can read, or every recipe there is. It heads the assemble
                // side only - a teardown is of a thing already in the pack, so
                // there is nothing there to have read about first.
                const filterRow = this._mode === 'assemble' ? `
                    <div class="mode-tabs filter-tabs">
                        <div class="tab-btn filter-btn ${this._recipeFilter === 'learned' ? 'active' : ''}" data-filter="learned">${T('Thinker.filterLearned')}</div>
                        <div class="tab-btn filter-btn ${this._recipeFilter === 'all' ? 'active' : ''}" data-filter="all">${T('Thinker.filterAll')}</div>
                    </div>
                ` : '';
                tabsContainer.innerHTML = `
                    <div class="mode-tabs">
                        <div class="tab-btn ${this._mode === 'assemble' ? 'active' : ''} ${this._activeArea === 'modes' && this._modeIndex === 0 ? 'focused' : ''}" data-idx="0">${t.assemble}</div>
                        <div class="tab-btn ${this._mode === 'disassemble' ? 'active' : ''} ${this._activeArea === 'modes' && this._modeIndex === 1 ? 'focused' : ''}" data-idx="1">${t.disassemble}</div>
                    </div>
                    ${filterRow}
                `;
            }

            // 3. Render Success Overlay
            const successOverlayContainer = spread.querySelector("#success-overlay-container");
            if (successOverlayContainer) {
                if (this._successOverlayTimer > 0 && this._successOverlayData) {
                    const isSalvage = this._successOverlayData.mode === 'disassemble';
                    const isBotch = this._successOverlayData.mode === 'botched';
                    const successTitle = isBotch ? T('Thinker.botchTitle')
                        : (isSalvage ? t.extractSuccess : t.success);
                    const itemsList = this._successOverlayData.items;

                    let itemsHTML = "";
                    itemsList.forEach(obj => {
                        const iconIdx = obj.iconIndex;
                        const iconStyle = `
                            background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;
                            width: 32px; height: 32px; display: inline-block;
                        `;
                        const rarity = getItemRarity(obj);
                        itemsHTML += `
                            <div class="success-item-row">
                                <span class="icon" style="${iconStyle}"></span>
                                <span style="font-weight:bold; color: ${rarity.colorCode}">${obj.name}</span>
                            </div>
                        `;
                    });

                    successOverlayContainer.innerHTML = `
                        <div class="success-overlay">
                            <div class="cauldron-animation" style="font-size: 88px"></div>
                            <h2 class="success-title">${successTitle}</h2>
                            ${isBotch
                            ? `<span class="success-obtained-label">${T('Thinker.botchNote')}</span>`
                            : `<span class="success-obtained-label">${t.obtained}</span>
                            <div style="display:flex; flex-direction:column; gap:8px">
                                ${itemsHTML}
                            </div>`}
                        </div>
                    `;
                } else {
                    successOverlayContainer.innerHTML = "";
                }
            }

            // 4. Render Left Page List Viewport, as a window onto the lines
            // rather than the whole shelf (UI/MenuVirtualList.js). Each line is
            // a closure, so the work a row costs — reading its recipe, counting
            // what the sack holds — is only paid for the rows on screen. Clicks
            // are read off the spread by delegation, so a row swapped in
            // mid-scroll needs no wiring of its own.
            const listViewport = spread.querySelector(".list-viewport");
            if (listViewport) {
                const lines = [];
                let focusedLine = -1;

                if (this._mode === 'assemble') {
                    if (this._selectedCategory === null) {
                        // Category list
                        lines.push(() => `
                            <div class="left-header">
                                <span class="category-name">${t.categories}</span>
                            </div>
                        `);

                        const categories = getAvailableCategories(this._recipeFilter);
                        const sortedCategories = Object.keys(categories).sort();

                        if (sortedCategories.length === 0) {
                            lines.push(() => `<div class="workbench-empty">${T('Thinker.noCategories')}</div>`);
                        } else {
                            this._categoryIndex = Math.max(0, Math.min(sortedCategories.length - 1, this._categoryIndex));

                            sortedCategories.forEach((cat, idx) => {
                                const isFocused = idx === this._categoryIndex && this._activeArea === 'categories';
                                if (isFocused) focusedLine = lines.length;
                                lines.push(() => {
                                    const data = categories[cat];
                                    const iconIdx = getCategoryIcon(cat);
                                    const iconStyle = `
                                        background: url('img/system/IconSet.png') -${(iconIdx % 16) * 24}px -${Math.floor(iconIdx / 16) * 24}px no-repeat;
                                        background-size: 384px auto;
                                    `;
                                    // The trade this shelf is written in, and how
                                    // far along in it these hands are: the whole
                                    // answer to why half the page is question marks.
                                    const trade = CATEGORY_SPECS[cat] || CATEGORY_SPECS.Misc;
                                    const tradeLine = T('Thinker.tradeLabel', {
                                        spec: specLabel(trade),
                                        level: levelLabel(readLevel(trade))
                                    });
                                    return `
                                    <div class="category-row ${isFocused ? 'focused' : ''}" data-cat="${cat}" data-idx="${idx}">
                                        <div class="category-meta-left">
                                            <div class="category-icon" style="${iconStyle}"></div>
                                            <span class="category-name">${categoryLabel(cat)}
                                                <span class="category-trade">${tradeLine}</span>
                                            </span>
                                        </div>
                                        <span class="category-count">${data.craftable} / ${data.total}</span>
                                    </div>
                                `;
                                });
                            });
                        }
                    } else {
                        // Item list in category
                        lines.push(() => `
                            <div class="left-header">
                                <span class="category-name">${categoryLabel(this._selectedCategory)}</span>
                                <span class="back-btn" id="back-categories">◀ ${t.back}</span>
                            </div>
                        `);

                        // One list for the page and for the cursor: they are
                        // indexed against each other, so they cannot be cut
                        // or sorted twice.
                        const categoryItems = this.thinkerItemsList();

                        if (categoryItems.length === 0) {
                            lines.push(() => `<div class="workbench-empty">${T('Thinker.noRecipes')}</div>`);
                        } else {
                            this._itemIndex = Math.max(0, Math.min(categoryItems.length - 1, this._itemIndex));

                            categoryItems.forEach((item, idx) => {
                                const isFocused = idx === this._itemIndex && this._activeArea === 'items';
                                if (isFocused) focusedLine = lines.length;
                                lines.push(() => {
                                    const isSelected = this._selectedItem && this._selectedItem.id === item.id;

                                    let rowClasses = "blueprint-row";
                                    if (isFocused) rowClasses += " focused";
                                    if (isSelected) rowClasses += " active";

                                    const known = knowsRecipe(item);

                                    let itemMetaHTML = "";
                                    if (known) {
                                        const iconIdx = item.iconIndex;
                                        const iconStyle = `
                                            background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;
                                        `;
                                        const rarity = getItemRarity(item);

                                        itemMetaHTML = `
                                            <div class="blueprint-icon" style="${iconStyle}"></div>
                                            <span class="blueprint-name" style="color: ${rarity.colorCode}">${item.name}</span>
                                        `;
                                    } else {
                                        itemMetaHTML = `
                                            <div class="blueprint-icon-locked">?</div>
                                            <span class="blueprint-name-locked">${t.blueprintLocked}</span>
                                        `;
                                    }

                                    const canAssemble = canCraft(parseRecipe(item));
                                    const craftColor = canAssemble ? "#27ae60" : "#c0392b";
                                    const ownedCount = $gameParty.numItems(item);

                                    return `
                                    <div class="${rowClasses}" data-item-id="${item.id}" data-db="${dbKindOf(item)}" data-idx="${idx}">
                                        <div class="blueprint-meta">
                                            ${itemMetaHTML}
                                        </div>
                                        <span class="blueprint-count" style="color: ${craftColor}; font-weight: bold">(x${ownedCount})</span>
                                    </div>
                                `;
                                });
                            });
                        }
                    }
                } else {
                    // Disassemble list
                    lines.push(() => `
                        <div class="left-header">
                            <span class="category-name">${t.disassemble}</span>
                        </div>
                    `);

                    const salvageItems = this.thinkerItemsList();

                    if (salvageItems.length === 0) {
                        lines.push(() => `<div class="workbench-empty" style="margin-top: 24px">${t.noOwned}</div>`);
                    } else {
                        this._itemIndex = Math.max(0, Math.min(salvageItems.length - 1, this._itemIndex));

                        salvageItems.forEach((item, idx) => {
                            const isFocused = idx === this._itemIndex && this._activeArea === 'items';
                            if (isFocused) focusedLine = lines.length;
                            lines.push(() => {
                                const isSelected = this._selectedItem && this._selectedItem.id === item.id;

                                let rowClasses = "blueprint-row";
                                if (isFocused) rowClasses += " focused";
                                if (isSelected) rowClasses += " active";

                                const iconIdx = item.iconIndex;
                                const iconStyle = `
                                    background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;
                                `;
                                const rarity = getItemRarity(item);
                                const ownedCount = $gameParty.numItems(item);

                                return `
                                <div class="${rowClasses}" data-item-id="${item.id}" data-db="${dbKindOf(item)}" data-idx="${idx}">
                                    <div class="blueprint-meta">
                                        <div class="blueprint-icon" style="${iconStyle}"></div>
                                        <span class="blueprint-name" style="color: ${rarity.colorCode}">${item.name}</span>
                                    </div>
                                    <span class="blueprint-count" style="font-weight: bold; color: #5c2c16">x${ownedCount}</span>
                                </div>
                            `;
                            });
                        });
                    }
                }

                window.MenuVirtualList.render(listViewport, {
                    key: `${this._mode}|${this._selectedCategory}|${this._recipeFilter}|${this._thinkerBar ? this._thinkerBar.query : ''}`,
                    count: lines.length,
                    renderItem: idx => lines[idx]()
                });
                if (focusedLine >= 0) window.MenuVirtualList.scrollToIndex(listViewport, focusedLine);
            }

            // 5. Render Right Page Workbench
            const workbench = spread.querySelector(".workbench");
            if (workbench) {
                let rightPageHTML = "";

                if (!this._selectedItem) {
                    const emptyPrompt = this._mode === 'assemble' ? t.placeItem : t.selectSalvage;
                    rightPageHTML = `
                        <div class="workbench-empty">
                            <div class="cauldron-animation"></div>
                            <div>${emptyPrompt}</div>
                        </div>
                    `;
                } else {
                    const item = this._selectedItem;
                    const recipe = parseRecipe(item);
                    const known = knowsRecipe(item);
                    const trade = readingSpec(item);
                    const sandboxBadge = ($gameSystem && $gameSystem._isSandboxMode) ? `<div class="sandbox-badge">${t.sandboxMode}</div>` : "";

                    let nameHTML = "";
                    let descHTML = "";

                    if (this._mode === 'assemble' && !known) {
                        nameHTML = `<span class="workbench-item-name" style="color: #7f7360">??? (${t.blueprintLocked})</span>`;
                        // Say what would read it: the trade it is written in and
                        // how far along that trade these hands would have to be.
                        const lockedDesc = T('Thinker.lockedRecipeHint');
                        const revealHint = T('Thinker.revealHint', {
                            spec: specLabel(trade.name),
                            level: levelLabel(revealLevel(item))
                        });
                        descHTML = `<p class="workbench-desc">${lockedDesc}</p>
                            <p class="workbench-desc">${revealHint}</p>`;
                    } else {
                        const rarity = getItemRarity(item);
                        const iconIdx = item.iconIndex;
                        const iconStyle = `
                            background: url('img/system/IconSet.png') -${(iconIdx % 16) * 32}px -${Math.floor(iconIdx / 16) * 32}px no-repeat;
                            width: 32px; height: 32px; display: inline-block;
                        `;

                        nameHTML = `
                            <span class="icon" style="${iconStyle}"></span>
                            <span class="workbench-item-name" style="color: ${rarity.colorCode}">${item.name}</span>
                        `;
                        descHTML = `<p class="workbench-desc">${item.description || "Nessuna descrizione."}</p>`;
                    }

                    let reagentsHTML = "";
                    let satisfiesAll = true;

                    if (recipe && this._mode === 'disassemble') {
                        // Disassemble: show the materials that can be reclaimed
                        reagentsHTML += `
                            <h4 class="reagents-header">${t.salvageYields}</h4>
                            <div class="reagents-list">
                        `;

                        Object.keys(recipe).forEach(ingId => {
                            const reagent = $dataItems[parseInt(ingId)];
                            if (!reagent) return;

                            const iconIdx = reagent.iconIndex;
                            const iconStyle = `
                                background: url('img/system/IconSet.png') -${(iconIdx % 16) * 24}px -${Math.floor(iconIdx / 16) * 24}px no-repeat;
                                background-size: 384px auto;
                                width: 24px; height: 24px; display: inline-block;
                            `;

                            reagentsHTML += `
                                <div class="reagent-row">
                                    <div class="reagent-meta">
                                        <span class="icon" style="${iconStyle}"></span>
                                        <span class="reagent-name">${(typeof window.translateText === 'function') ? window.translateText(reagent.name) : reagent.name}</span>
                                    </div>
                                </div>
                            `;
                        });

                        reagentsHTML += `</div>`;
                    } else if (recipe) {
                        reagentsHTML += `
                            <h4 class="reagents-header">${t.reagents}</h4>
                            <div class="reagents-list">
                        `;

                        const ingredients = Object.entries(recipe);

                        ingredients.forEach(([ingId, neededQty]) => {
                            const reagent = $dataItems[parseInt(ingId)];
                            if (!reagent) return;

                            const owned = $gameParty.numItems(reagent);
                            const satisfied = ($gameSystem && $gameSystem._isSandboxMode) || (owned >= neededQty);
                            if (!satisfied) satisfiesAll = false;

                            const iconIdx = reagent.iconIndex;
                            const iconStyle = `
                                background: url('img/system/IconSet.png') -${(iconIdx % 16) * 24}px -${Math.floor(iconIdx / 16) * 24}px no-repeat;
                                background-size: 384px auto;
                                width: 24px; height: 24px; display: inline-block;
                            `;
                            const statusIndicator = satisfied
                                ? `<span class="reagent-status-indicator satisfied">✔</span>`
                                : `<span class="reagent-status-indicator deficient">✖</span>`;

                            reagentsHTML += `
                                <div class="reagent-row" style="opacity: ${satisfied ? 1 : 0.6}">
                                    <div class="reagent-meta">
                                        <span class="icon" style="${iconStyle}"></span>
                                        <span class="reagent-name">${(typeof window.translateText === 'function') ? window.translateText(reagent.name) : reagent.name}</span>
                                    </div>
                                    <div class="reagent-count-box">
                                        <span>${owned}/${neededQty}</span>
                                        ${statusIndicator}
                                    </div>
                                </div>
                            `;
                        });

                        reagentsHTML += `</div>`;
                    }

                    // What the workbench itself thinks of the job: which tier it
                    // is, whether the party is trained to it, and how likely the
                    // whole thing is to come apart in their hands. Under it, the
                    // trade the recipe belongs to and what being good at it buys
                    // on this side of the bench.
                    let skillNotice = "";
                    if (recipe && this._mode === 'assemble') {
                        const trained = tierMet(item);
                        const starter = isStarterRecipe(item);
                        const risk = Math.round(botchChance(item) * 100);
                        const reclaim = Math.round(reclaimChance(item) * 100);
                        // A starter recipe has no tier to be measured against, so
                        // the line that would report one says the truth instead:
                        // anybody can make this.
                        skillNotice = `<div class="workbench-skill ${trained ? '' : 'locked'}">
                            <span>${starter
                                ? T('Thinker.starterRecipe')
                                : T('Thinker.tierLabel', { tier: recipeTier(item), level: tierLevelName(item) })}</span>
                            ${trained && risk > 0 ? `<span class="workbench-risk">${T('Thinker.botchRisk', { pct: risk })}</span>` : ''}
                        </div>`;
                        skillNotice += `<div class="workbench-skill">
                            <span>${T('Thinker.tradeLabel', { spec: specLabel(trade.name), level: levelLabel(trade.level) })}</span>
                            ${reclaim > 0 ? `<span class="workbench-reclaim">${T('Thinker.reclaimChance', { pct: reclaim })}</span>` : ''}
                        </div>`;
                        if (known && !starter && !$gameSystem.hasCrafted(item.id) && !isSandbox()) {
                            skillNotice += `<div class="workbench-skill"><span>${T('Thinker.knownBySkill', { spec: specLabel(trade.name), level: levelLabel(trade.level) })}</span></div>`;
                        }
                        if (!trained) {
                            skillNotice += `<div class="sandbox-badge" style="background:rgba(160,40,40,0.18); border-color:#a02828; color:#a02828">${T('Thinker.needFabrication', { level: tierLevelName(item) })}</div>`;
                        }
                    } else if (recipe) {
                        skillNotice = `<div class="workbench-skill">
                            <span>${T('Thinker.tradeLabel', { spec: specLabel(trade.name), level: levelLabel(trade.level) })}</span>
                        </div>`;
                    }

                    let btnText = "";
                    let btnEnabled = false;

                    if (this._mode === 'assemble') {
                        btnText = t.transmute;
                        btnEnabled = satisfiesAll && tierMet(item);
                    } else {
                        btnText = t.salvage;
                        btnEnabled = $gameParty.numItems(item) > 0;
                    }

                    const btnClasses = `transmute-btn ${btnEnabled ? 'enabled' : 'disabled'} ${this._activeArea === 'workbench' ? 'focused' : ''}`;

                    rightPageHTML = `
                        <div class="workbench-active">
                            ${sandboxBadge}
                            <div class="workbench-item-header">
                                ${nameHTML}
                            </div>
                            ${descHTML}
                            ${reagentsHTML}
                            ${skillNotice}
                            <div class="${btnClasses}" id="transmute-action">${btnText}</div>
                        </div>
                    `;
                }

                workbench.innerHTML = rightPageHTML;
            }
        }

        executeCrucibleTransmutation() {
            if (!this._selectedItem) return;

            const item = this._selectedItem;
            const recipe = parseRecipe(item);

            if (this._mode === 'assemble') {
                if (!recipe || !canCraft(recipe) || !tierMet(item)) {
                    SoundManager.playBuzzer();
                    return;
                }

                // The hands do the work before anyone knows how it went: an
                // unpractised party ruins the job often enough that the first
                // tiers of Fabrication are worth training out of.
                const botched = Math.random() < botchChance(item);

                // Consume reagents if not in sandbox. A botch eats half of them
                // (rounded up, so a single-unit reagent is always lost) rather
                // than the lot. A hand that knows the trade hands units back off
                // a clean job: cut-offs, the second nail out of a pair, the
                // measure of solder that was never needed.
                const reclaimed = [];
                if (!isSandbox()) {
                    const saveOdds = botched ? 0 : reclaimChance(item);
                    for (const [ingId, qty] of Object.entries(recipe)) {
                        const reagent = $dataItems[parseInt(ingId)];
                        const spent = botched ? Math.ceil(qty / 2) : qty;
                        $gameParty.loseItem(reagent, spent);
                        if (!saveOdds || !reagent) continue;
                        let saved = 0;
                        for (let i = 0; i < spent; i++) {
                            if (Math.random() < saveOdds) saved++;
                        }
                        if (saved > 0) {
                            $gameParty.gainItem(reagent, saved);
                            reclaimed.push({ item: reagent, count: saved });
                        }
                    }
                }

                if (botched) {
                    // Nothing to show off, but the workbench still taught
                    // something: a ruined batch is how anybody learns.
                    this._successOverlayData = { mode: 'botched', items: [] };
                    this._successOverlayTimer = 110;
                    SoundManager.playBuzzer();
                    if (window.SpecializationXP) window.SpecializationXP.award(FAB_SPEC, BOTCH_POINTS, { actor: benchActor() });
                    if (window.ParchmentToast) {
                        window.ParchmentToast.show(T('Thinker.botched', { item: item.name }), { severity: 'warning' });
                    }
                } else {
                    // Reward item
                    $gameParty.gainItem(item, 1);
                    $gameSystem.addCraftedItem(item.id);

                    // Show Workbench Reaction Flash
                    this._successOverlayData = { mode: 'assemble', items: [item] };
                    this._successOverlayTimer = 110; // ~1.8 seconds overlay

                    SoundManager.playUseItem();
                    if (window.SpecializationXP) {
                        const points = TIER_POINTS[recipeTier(item)] || 1;
                        // The bench and the trade both learn from the job: the
                        // trade is what put the recipe on the page in the first
                        // place, so working it is what opens the rest of it.
                        window.SpecializationXP.award(FAB_SPEC, points, { actor: benchActor() });
                        window.SpecializationXP.award(recipeSpec(item), points, { actor: benchActor() });
                    }
                    if (reclaimed.length && window.ParchmentToast) {
                        const list = reclaimed.map(r => `${r.item.name} x${r.count}`).join(', ');
                        window.ParchmentToast.show(T('Thinker.reclaimed', { items: list }));
                    }
                }

                this._thinkerItemsDirty = true;
                this.refreshUIThinker();
            } else {
                // Disassemble (deconstruct)
                if ($gameParty.numItems(item) <= 0 || !recipe || isUncraftable(item)) {
                    SoundManager.playBuzzer();
                    return;
                }

                // Consume Item
                $gameParty.loseItem(item, 1);

                // Reclaim random reagents. How many come back is what training
                // buys on this side of the workbench: 1-2 pieces untrained, and
                // up to 6 for someone who knows both the bench and the trade the
                // thing was made in. A teardown can never hand back more than
                // went into it, so the recipe's own unit count is the ceiling
                // rather than its number of distinct materials.
                const materials = Object.keys(recipe);
                const totalUnits = materials.reduce((sum, id) => sum + (recipe[id] || 1), 0);
                const numReturned = Math.min(salvageYield(item), totalUnits);
                const returnedList = [];

                for (let i = 0; i < numReturned; i++) {
                    const matId = materials[Math.floor(Math.random() * materials.length)];
                    const matItem = $dataItems[parseInt(matId)];
                    if (!matItem) continue;
                    $gameParty.gainItem(matItem, 1);
                    returnedList.push(matItem);
                }

                // Show salvage success flash
                this._successOverlayData = { mode: 'disassemble', items: returnedList };
                this._successOverlayTimer = 110;

                SoundManager.playUseItem();
                if (window.SpecializationXP) {
                    window.SpecializationXP.award(FAB_SPEC, SALVAGE_POINTS, { actor: benchActor() });
                    window.SpecializationXP.award(recipeSpec(item), SALVAGE_POINTS, { actor: benchActor() });
                }
                this._thinkerItemsDirty = true;

                // If item is completely exhausted, clean selection
                if ($gameParty.numItems(item) === 0) {
                    this._selectedItem = null;
                    this._activeArea = 'items';
                }

                this.refreshUIThinker();
            }
        }

        // Cached items-pane list: rebuilt only when the mode/category changes or the
        // inventory changes (crafting/salvaging), instead of every frame.
        thinkerItemsList() {
            const key = this._mode + '|' + (this._selectedCategory || '') + '|' + this._recipeFilter;
            if (!this._thinkerItemsDirty && this._thinkerItemsList && this._thinkerItemsKey === key) {
                return this._thinkerItemsList;
            }
            let itemsList = [];
            if (this._mode === 'assemble') {
                itemsList = allCraftableEntries().filter(item => {
                    if (!parseRecipe(item) || isUncraftable(item)) return false;
                    if (parseCategory(item) !== this._selectedCategory) return false;
                    return passesFilter(item, this._recipeFilter);
                });
                const craftable = new Map();
                for (const item of itemsList) {
                    craftable.set(item, canCraft(parseRecipe(item)));
                }
                itemsList.sort((a, b) => {
                    const canA = craftable.get(a);
                    const canB = craftable.get(b);
                    if (canA && !canB) return -1;
                    if (!canA && canB) return 1;
                    return 0;
                });
            } else {
                itemsList = allCraftableEntries().filter(item => {
                    if (isUncraftable(item) || !parseRecipe(item)) return false;
                    return $gameParty.numItems(item) > 0;
                });
            }
            // Last word goes to the search strip, so the page and the cursor
            // are indexed against the same, already-filtered list.
            if (this._thinkerBar) {
                itemsList = this._thinkerBar.apply(itemsList, item => ({
                    name: item.name,
                    category: parseCategory(item),
                    weight: (window.ItemSystemUtils && window.ItemSystemUtils.getItemWeight
                        ? window.ItemSystemUtils.getItemWeight(item) : 0) / 1000,
                    price: (item.price || 0) / 100
                }));
            }

            this._thinkerItemsList = itemsList;
            this._thinkerItemsKey = key;
            this._thinkerItemsDirty = false;
            return itemsList;
        }

        // =============================================================================
        // Keyboard & Gamepad Input Overrides
        // =============================================================================
        updateUIThinkerInput() {
            if (this._successOverlayTimer > 0) {
                // Pressing Continue (ok), cancel, or a click skips the overlay immediately (issue #172).
                const skipOverlay = Input.isTriggered('ok') || Input.isTriggered('cancel') || TouchInput.isTriggered() || TouchInput.isCancelled();
                if (skipOverlay) {
                    this._successOverlayTimer = 0;
                    this._successOverlayData = null;
                    this.refreshUIThinker();
                    return; // Consume this press so it does not also trigger menu actions
                }
                this._successOverlayTimer--;
                if (this._successOverlayTimer === 0) {
                    this._successOverlayData = null;
                    this.refreshUIThinker();
                }
                return; // Suppress input during reactions overlays
            }

            const t = thinkerText();

            // Shoulder buttons hand the bench to another member, wherever the
            // cursor is (TAB does the same on a keyboard, through CharSwitcher).
            if (Input.isTriggered('pagedown')) { this.cycleFabActor(1); return; }
            if (Input.isTriggered('pageup')) { this.cycleFabActor(-1); return; }

            // Shift turns the assemble side between the two books, wherever the
            // cursor is standing.
            if (this._mode === 'assemble' && Input.isTriggered('shift')) {
                this.toggleRecipeFilter();
                return;
            }

            // Right-click (TouchInput) counts as cancel just like keyboard cancel
            const cancelTriggered = Input.isTriggered('cancel') || TouchInput.isCancelled();

            if (this._activeArea === 'modes') {
                if (Input.isTriggered('right')) {
                    this._modeIndex = 1;
                    this._mode = 'disassemble';
                    this._selectedCategory = null;
                    this._selectedItem = null;
                    this._activeArea = 'items';
                    this._itemIndex = 0;
                    SoundManager.playCursor();
                    this.refreshUIThinker();
                } else if (Input.isTriggered('left')) {
                    this._modeIndex = 0;
                    this._mode = 'assemble';
                    this._selectedCategory = null;
                    this._selectedItem = null;
                    this._activeArea = 'categories';
                    this._categoryIndex = 0;
                    SoundManager.playCursor();
                    this.refreshUIThinker();
                } else if (Input.isRepeated('down')) {
                    if (this._mode === 'assemble') {
                        this._activeArea = 'categories';
                        this._categoryIndex = 0;
                    } else {
                        this._activeArea = 'items';
                        this._itemIndex = 0;
                    }
                    SoundManager.playCursor();
                    this.refreshUIThinker();
                } else if (cancelTriggered) {
                    this.popScene();
                    SoundManager.playCancel();
                }
            } else if (this._activeArea === 'categories') {
                const categories = getAvailableCategories(this._recipeFilter);
                const sortedCategories = Object.keys(categories).sort();

                if (!sortedCategories.length) {
                    if (cancelTriggered) {
                        this._activeArea = 'modes';
                        SoundManager.playCancel();
                        this.refreshUIThinker();
                    }
                    return;
                }

                if (Input.isRepeated('down')) {
                    this._categoryIndex = (this._categoryIndex + 1) % sortedCategories.length;
                    SoundManager.playCursor();
                    this.refreshUIThinker();
                } else if (Input.isRepeated('up')) {
                    if (this._categoryIndex === 0) {
                        this._activeArea = 'modes';
                    } else {
                        this._categoryIndex = (this._categoryIndex - 1 + sortedCategories.length) % sortedCategories.length;
                    }
                    SoundManager.playCursor();
                    this.refreshUIThinker();
                } else if (Input.isTriggered('ok')) {
                    const catName = sortedCategories[this._categoryIndex];
                    if (catName) {
                        this._selectedCategory = catName;
                        this._activeArea = 'items';
                        this._itemIndex = 0;
                        this._selectedItem = null;
                        SoundManager.playOk();
                        this.refreshUIThinker();
                    }
                } else if (cancelTriggered) {
                    this._activeArea = 'modes';
                    SoundManager.playCancel();
                    this.refreshUIThinker();
                }
            } else if (this._activeArea === 'items') {
                const itemsList = this.thinkerItemsList();

                // An empty shelf (a category with nothing legible in the
                // Learned book, or nothing owned to tear down) still has to let
                // the cursor back out.
                if (!itemsList.length) {
                    if (Input.isRepeated('up') || cancelTriggered) {
                        if (this._mode === 'assemble') {
                            this._selectedCategory = null;
                            this._selectedItem = null;
                            this._activeArea = 'categories';
                        } else {
                            this._selectedItem = null;
                            this._activeArea = 'modes';
                        }
                        SoundManager.playCancel();
                        this.refreshUIThinker();
                    }
                    return;
                }

                if (Input.isRepeated('down')) {
                    this._itemIndex = (this._itemIndex + 1) % itemsList.length;
                    SoundManager.playCursor();
                    this.refreshUIThinker();

                    const container = document.getElementById("thinker-container");
                    if (container) {
                        const focused = container.querySelector(".blueprint-row.focused");
                        if (focused) focused.scrollIntoView({ block: "nearest" });
                    }
                } else if (Input.isRepeated('up')) {
                    if (this._itemIndex === 0) {
                        if (this._mode === 'assemble') {
                            this._selectedCategory = null;
                            this._selectedItem = null;
                            this._activeArea = 'categories';
                        } else {
                            this._activeArea = 'modes';
                        }
                    } else {
                        this._itemIndex = (this._itemIndex - 1 + itemsList.length) % itemsList.length;
                    }
                    SoundManager.playCursor();
                    this.refreshUIThinker();

                    const container = document.getElementById("thinker-container");
                    if (container) {
                        const focused = container.querySelector(".blueprint-row.focused");
                        if (focused) focused.scrollIntoView({ block: "nearest" });
                    }
                } else if (Input.isTriggered('ok')) {
                    const item = itemsList[this._itemIndex];
                    if (item) {
                        this._selectedItem = item;
                        SoundManager.playOk();

                        // Check if Action Button can be focused
                        const recipe = parseRecipe(item);
                        let craftPossible = false;
                        if (this._mode === 'assemble') {
                            craftPossible = canCraft(recipe);
                        } else {
                            craftPossible = $gameParty.numItems(item) > 0;
                        }

                        if (craftPossible) {
                            this._activeArea = 'workbench';
                        }
                        this.refreshUIThinker();
                    }
                } else if (cancelTriggered) {
                    if (this._mode === 'assemble') {
                        this._selectedCategory = null;
                        this._selectedItem = null;
                        this._activeArea = 'categories';
                    } else {
                        this._selectedItem = null;
                        this._activeArea = 'modes';
                    }
                    SoundManager.playCancel();
                    this.refreshUIThinker();
                }
            } else if (this._activeArea === 'workbench') {
                if (Input.isTriggered('ok')) {
                    this.executeCrucibleTransmutation();
                } else if (cancelTriggered) {
                    this._activeArea = 'items';
                    SoundManager.playCancel();
                    this.refreshUIThinker();
                }
            }
        }
    }

    window.Scene_Thinker = Scene_Thinker;
})();