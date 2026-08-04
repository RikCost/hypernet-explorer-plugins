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

    // ---- Database-spanning helpers (items + weapons + armors are all craftable) ----
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

    function isEquipment(item) {
        return DataManager.isWeapon(item) || DataManager.isArmor(item);
    }

    let _allEntriesCache = null;
    let _allEntriesSource = null;
    function allCraftableEntries() {
        // Database arrays are static after load; rebuild only if they were reloaded
        if (_allEntriesCache && _allEntriesSource === $dataItems) return _allEntriesCache;
        const out = [];
        for (const x of $dataItems) if (isRealEntry(x)) out.push(x);
        for (const x of $dataWeapons) if (isRealEntry(x)) out.push(x);
        for (const x of $dataArmors) if (isRealEntry(x)) out.push(x);
        _allEntriesCache = out;
        _allEntriesSource = $dataItems;
        return out;
    }

    // Crafting / salvaging weapons & armor requires a Blacksmith (trait 141) in the party
    const BLACKSMITH_TRAIT_ID = 141;
    function partyHasBlacksmith() {
        if ($gameSystem && $gameSystem._isSandboxMode) return true;
        const members = ($gameParty && $gameParty.allMembers) ? $gameParty.allMembers() : [];
        return members.some(actor => {
            const ts = actor && actor._selectedTraits;
            if (!Array.isArray(ts)) return false;
            return ts.some(tr => (typeof tr === 'number' ? tr : (tr && tr.id)) === BLACKSMITH_TRAIT_ID);
        });
    }

    // Whether the player may assemble/disassemble this entry right now
    function canWorkEntry(item) {
        if (!isEquipment(item)) return true;
        return partyHasBlacksmith();
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

    // Get all available categories with craftable counts
    function getAvailableCategories() {
        const categories = {};
        for (const item of allCraftableEntries()) {
            if (!parseRecipe(item) || isUncraftable(item)) continue;

            const category = parseCategory(item);
            if (!categories[category]) {
                categories[category] = {
                    total: 0,
                    craftable: 0
                };
            }

            categories[category].total++;
            if (canCraft(parseRecipe(item))) {
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

            this._lastRenderedMode = null;
            this._lastRenderedCategory = null;
            this._forceListRebuild = true;

            this.initUIThinkerLayout();
            this.refreshUIThinker();
        }

        update() {
            this.updateUIThinkerInput();
            super.update();
        }

        terminate() {
            const container = document.getElementById("thinker-container");
            if (container) container.remove();
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
                            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
                                <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                                    ${backBtnText}
                                </div>
                                <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${t.title}</h2>
                            </div>
                            
                            <!-- Tab buttons container -->
                            <div id="tabs-container"></div>
                            
                            <!-- List viewport -->
                            <div class="list-viewport"></div>
                        </div>
                        
                        <div class="right-page">
                            <h2 class="title">${t.workbench}</h2>
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
                        this._forceListRebuild = true;
                        this.refreshUIThinker();
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
                        this._forceListRebuild = true;
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
                        this._forceListRebuild = true;
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
            const tabsContainer = spread.querySelector("#tabs-container");
            if (tabsContainer) {
                tabsContainer.innerHTML = `
                    <div class="mode-tabs">
                        <div class="tab-btn ${this._mode === 'assemble' ? 'active' : ''} ${this._activeArea === 'modes' && this._modeIndex === 0 ? 'focused' : ''}" data-idx="0">${t.assemble}</div>
                        <div class="tab-btn ${this._mode === 'disassemble' ? 'active' : ''} ${this._activeArea === 'modes' && this._modeIndex === 1 ? 'focused' : ''}" data-idx="1">${t.disassemble}</div>
                    </div>
                `;
            }

            // 3. Render Success Overlay
            const successOverlayContainer = spread.querySelector("#success-overlay-container");
            if (successOverlayContainer) {
                if (this._successOverlayTimer > 0 && this._successOverlayData) {
                    const isSalvage = this._successOverlayData.mode === 'disassemble';
                    const successTitle = isSalvage ? t.extractSuccess : t.success;
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
                            <div class="cauldron-animation" style="font-size: 80px;"></div>
                            <h2 class="success-title">${successTitle}</h2>
                            <span class="success-obtained-label">${t.obtained}</span>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                ${itemsHTML}
                            </div>
                        </div>
                    `;
                } else {
                    successOverlayContainer.innerHTML = "";
                }
            }

            // 4. Render Left Page List Viewport (with smart rebuilding to preserve scroll position)
            const listViewport = spread.querySelector(".list-viewport");
            if (listViewport) {
                const needsRebuild = this._lastRenderedMode !== this._mode ||
                    this._lastRenderedCategory !== this._selectedCategory ||
                    this._forceListRebuild;

                if (needsRebuild) {
                    this._lastRenderedMode = this._mode;
                    this._lastRenderedCategory = this._selectedCategory;
                    this._forceListRebuild = false;

                    let leftListHTML = "";

                    if (this._mode === 'assemble') {
                        if (this._selectedCategory === null) {
                            // Category list
                            leftListHTML += `
                                <div class="left-header">
                                    <span class="category-name">${t.categories}</span>
                                </div>
                            `;

                            const categories = getAvailableCategories();
                            const sortedCategories = Object.keys(categories).sort();

                            if (sortedCategories.length === 0) {
                                leftListHTML += `<div class="workbench-empty">${T('Thinker.noCategories')}</div>`;
                            } else {
                                this._categoryIndex = Math.max(0, Math.min(sortedCategories.length - 1, this._categoryIndex));

                                sortedCategories.forEach((cat, idx) => {
                                    const isFocused = idx === this._categoryIndex && this._activeArea === 'categories';
                                    const data = categories[cat];
                                    const iconIdx = getCategoryIcon(cat);
                                    const iconStyle = `
                                        background: url('img/system/IconSet.png') -${(iconIdx % 16) * 24}px -${Math.floor(iconIdx / 16) * 24}px no-repeat;
                                        background-size: 384px auto;
                                    `;

                                    leftListHTML += `
                                        <div class="category-row ${isFocused ? 'focused' : ''}" data-cat="${cat}" data-idx="${idx}">
                                            <div class="category-meta-left">
                                                <div class="category-icon" style="${iconStyle}"></div>
                                                <span class="category-name">${categoryLabel(cat)}</span>
                                            </div>
                                            <span class="category-count">${data.craftable} / ${data.total}</span>
                                        </div>
                                    `;
                                });
                            }
                        } else {
                            // Item list in category
                            leftListHTML += `
                                <div class="left-header">
                                    <span class="category-name">${categoryLabel(this._selectedCategory)}</span>
                                    <span class="back-btn" id="back-categories">◀ ${t.back}</span>
                                </div>
                            `;

                            const categoryItems = allCraftableEntries().filter(item => {
                                if (!parseRecipe(item) || isUncraftable(item)) return false;
                                return parseCategory(item) === this._selectedCategory;
                            });

                            categoryItems.sort((a, b) => {
                                const canA = canCraft(parseRecipe(a));
                                const canB = canCraft(parseRecipe(b));
                                if (canA && !canB) return -1;
                                if (!canA && canB) return 1;
                                return 0;
                            });

                            if (categoryItems.length === 0) {
                                leftListHTML += `<div class="workbench-empty">${T('Thinker.noRecipes')}</div>`;
                            } else {
                                this._itemIndex = Math.max(0, Math.min(categoryItems.length - 1, this._itemIndex));

                                categoryItems.forEach((item, idx) => {
                                    const isFocused = idx === this._itemIndex && this._activeArea === 'items';
                                    const isSelected = this._selectedItem && this._selectedItem.id === item.id;

                                    let rowClasses = "blueprint-row";
                                    if (isFocused) rowClasses += " focused";
                                    if (isSelected) rowClasses += " active";

                                    const hasCrafted = $gameSystem.hasCrafted(item.id);

                                    let itemMetaHTML = "";
                                    if (hasCrafted) {
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
                                            <span class="blueprint-name-locked" style="font-style:italic;">${t.blueprintLocked}</span>
                                        `;
                                    }

                                    const canAssemble = canCraft(parseRecipe(item));
                                    const craftColor = canAssemble ? "#27ae60" : "#c0392b";
                                    const ownedCount = $gameParty.numItems(item);

                                    leftListHTML += `
                                        <div class="${rowClasses}" data-item-id="${item.id}" data-db="${dbKindOf(item)}" data-idx="${idx}">
                                            <div class="blueprint-meta">
                                                ${itemMetaHTML}
                                            </div>
                                            <span class="blueprint-count" style="color: ${craftColor}; font-weight: bold;">(x${ownedCount})</span>
                                        </div>
                                    `;
                                });
                            }
                        }
                    } else {
                        // Disassemble list
                        leftListHTML += `
                            <div class="left-header">
                                <span class="category-name">${t.disassemble}</span>
                            </div>
                        `;

                        const salvageItems = allCraftableEntries().filter(item => {
                            if (isUncraftable(item) || !parseRecipe(item)) return false;
                            return $gameParty.numItems(item) > 0;
                        });

                        if (salvageItems.length === 0) {
                            leftListHTML += `<div class="workbench-empty" style="margin-top: 24px;">${t.noOwned}</div>`;
                        } else {
                            this._itemIndex = Math.max(0, Math.min(salvageItems.length - 1, this._itemIndex));

                            salvageItems.forEach((item, idx) => {
                                const isFocused = idx === this._itemIndex && this._activeArea === 'items';
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

                                leftListHTML += `
                                    <div class="${rowClasses}" data-item-id="${item.id}" data-db="${dbKindOf(item)}" data-idx="${idx}">
                                        <div class="blueprint-meta">
                                            <div class="blueprint-icon" style="${iconStyle}"></div>
                                            <span class="blueprint-name" style="color: ${rarity.colorCode}">${item.name}</span>
                                        </div>
                                        <span class="blueprint-count" style="font-weight: bold; color: #5c2c16;">x${ownedCount}</span>
                                    </div>
                                `;
                            });
                        }
                    }

                    listViewport.innerHTML = leftListHTML;
                } else {
                    // Update only selected and focused states of existing rows (FLICKER FREE & KEEPS SCROLL POSITION!)
                    if (this._mode === 'assemble') {
                        if (this._selectedCategory === null) {
                            // Category focus
                            const rows = listViewport.querySelectorAll(".category-row");
                            rows.forEach((row, idx) => {
                                if (idx === this._categoryIndex && this._activeArea === 'categories') {
                                    row.classList.add("focused");
                                } else {
                                    row.classList.remove("focused");
                                }
                            });
                        } else {
                            // Blueprint focus
                            const rows = listViewport.querySelectorAll(".blueprint-row");
                            rows.forEach((row, idx) => {
                                const isFocused = idx === this._itemIndex && this._activeArea === 'items';
                                const isSelected = this._selectedItem && parseInt(row.getAttribute("data-item-id")) === this._selectedItem.id && (row.getAttribute("data-db") || 'i') === dbKindOf(this._selectedItem);

                                if (isFocused) row.classList.add("focused");
                                else row.classList.remove("focused");

                                if (isSelected) row.classList.add("active");
                                else row.classList.remove("active");
                            });
                        }
                    } else {
                        // Disassemble focus
                        const rows = listViewport.querySelectorAll(".blueprint-row");
                        rows.forEach((row, idx) => {
                            const isFocused = idx === this._itemIndex && this._activeArea === 'items';
                            const isSelected = this._selectedItem && parseInt(row.getAttribute("data-item-id")) === this._selectedItem.id;

                            if (isFocused) row.classList.add("focused");
                            else row.classList.remove("focused");

                            if (isSelected) row.classList.add("active");
                            else row.classList.remove("active");
                        });
                    }
                }
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
                    const hasCrafted = $gameSystem.hasCrafted(item.id);
                    const sandboxBadge = ($gameSystem && $gameSystem._isSandboxMode) ? `<div class="sandbox-badge">${t.sandboxMode}</div>` : "";

                    let nameHTML = "";
                    let descHTML = "";

                    if (this._mode === 'assemble' && !hasCrafted) {
                        nameHTML = `<span class="workbench-item-name" style="color: #7f7360;">??? (${t.blueprintLocked})</span>`;
                        const lockedDesc = T('Thinker.lockedRecipeHint');
                        descHTML = `<p class="workbench-desc">${lockedDesc}</p>`;
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
                                <div class="reagent-row" style="opacity: ${satisfied ? 1 : 0.6};">
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

                    // Weapons & armor need a Blacksmith (trait 141) in the party
                    const blacksmithOK = canWorkEntry(item);
                    const blacksmithNotice = !blacksmithOK
                        ? `<div class="sandbox-badge" style="background:rgba(160,40,40,0.18); border-color:#a02828; color:#a02828;">${t.needBlacksmith}</div>`
                        : "";

                    let btnText = "";
                    let btnEnabled = false;

                    if (this._mode === 'assemble') {
                        btnText = t.transmute;
                        btnEnabled = satisfiesAll && blacksmithOK;
                    } else {
                        btnText = t.salvage;
                        btnEnabled = $gameParty.numItems(item) > 0 && blacksmithOK;
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
                            ${blacksmithNotice}
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

            // Weapons & armor require a Blacksmith (trait 141) in the party
            if (isEquipment(item) && !partyHasBlacksmith()) {
                SoundManager.playBuzzer();
                return;
            }

            if (this._mode === 'assemble') {
                if (!recipe || !canCraft(recipe)) {
                    SoundManager.playBuzzer();
                    return;
                }

                // Consume reagents if not in sandbox
                if (!($gameSystem && $gameSystem._isSandboxMode)) {
                    for (const [ingId, qty] of Object.entries(recipe)) {
                        $gameParty.loseItem($dataItems[parseInt(ingId)], qty);
                    }
                }

                // Reward item
                $gameParty.gainItem(item, 1);
                $gameSystem.addCraftedItem(item.id);

                // Show Workbench Reaction Flash
                this._successOverlayData = { mode: 'assemble', items: [item] };
                this._successOverlayTimer = 110; // ~1.8 seconds overlay

                SoundManager.playUseItem();
                this._forceListRebuild = true;
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

                // Reclaim random reagents
                const materials = Object.keys(recipe);
                const numReturned = Math.floor(Math.random() * 2) + 1; // 1-2 materials
                const returnedList = [];

                for (let i = 0; i < numReturned && i < materials.length; i++) {
                    const matId = materials[Math.floor(Math.random() * materials.length)];
                    const matItem = $dataItems[parseInt(matId)];
                    $gameParty.gainItem(matItem, 1);
                    returnedList.push(matItem);
                }

                // Show salvage success flash
                this._successOverlayData = { mode: 'disassemble', items: returnedList };
                this._successOverlayTimer = 110;

                SoundManager.playUseItem();
                this._forceListRebuild = true;
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
            const key = this._mode + '|' + (this._selectedCategory || '');
            if (!this._thinkerItemsDirty && this._thinkerItemsList && this._thinkerItemsKey === key) {
                return this._thinkerItemsList;
            }
            let itemsList = [];
            if (this._mode === 'assemble') {
                itemsList = allCraftableEntries().filter(item => {
                    if (!parseRecipe(item) || isUncraftable(item)) return false;
                    return parseCategory(item) === this._selectedCategory;
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
                    this._forceListRebuild = true;
                    this.refreshUIThinker();
                } else if (Input.isTriggered('left')) {
                    this._modeIndex = 0;
                    this._mode = 'assemble';
                    this._selectedCategory = null;
                    this._selectedItem = null;
                    this._activeArea = 'categories';
                    this._categoryIndex = 0;
                    SoundManager.playCursor();
                    this._forceListRebuild = true;
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
                const categories = getAvailableCategories();
                const sortedCategories = Object.keys(categories).sort();

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
                        this._forceListRebuild = true;
                        this.refreshUIThinker();
                    }
                } else if (cancelTriggered) {
                    this._activeArea = 'modes';
                    SoundManager.playCancel();
                    this._forceListRebuild = true;
                    this.refreshUIThinker();
                }
            } else if (this._activeArea === 'items') {
                const itemsList = this.thinkerItemsList();

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
                            this._forceListRebuild = true;
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
                            craftPossible = canCraft(recipe) && canWorkEntry(item);
                        } else {
                            craftPossible = $gameParty.numItems(item) > 0 && canWorkEntry(item);
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
                    this._forceListRebuild = true;
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