/*:
 * @target MZ
 * @plugindesc Alchemistry Menu System (Data/Logic), Project & Step Management v2.0
 * @author Omni-Lex
 *
 * @help AlchemistryMenu.js
 *
 * Business logic only: project data, recipe loading/matching, the processing
 * timer, and the plugin command. All DOM / scene rendering lives in
 * AlchemistryMenuUI.js, which MUST be listed AFTER this file in the Plugin
 * Manager.
 *
 * Exposes on window:
 *   window.Scene_Alchemistry  , the scene constructor (UI extends it)
 *   window.AlchemistryI18n()  , the Alchemistry namespace, read live
 *   window.AlchemistryActions , action definitions (key -> needs item)
 *
 * @command openMenu
 * @text Open Alchemistry Menu
 * @desc Opens the Alchemistry menu scene.
 */

(() => {
    'use strict';

    // =========================================================================
    // Static data shared with the UI layer
    // =========================================================================

    // Action keys are internal identifiers (never translated). `needsItem`
    // marks actions that prompt for a reagent before the step is added.
    const ALCHEMISTRY_ACTIONS = [
        { key: 'combine', needsItem: true  },
        { key: 'heat',    needsItem: false },
        { key: 'distill', needsItem: false },
        { key: 'filter',  needsItem: false },
        { key: 'wash',    needsItem: true  },
        { key: 'dry',     needsItem: false }
    ];



    // =========================================================================
    // Default project data initialization
    // =========================================================================

    function ensureAlchemistryProjects() {
        if (!$gameSystem._alchemistryProjects) {
            $gameSystem._alchemistryProjects = [1, 2, 3, 4, 5].map(n => ({
                name: T('Alchemistry.projectName', { n: n }), steps: [],
            }));
            $gameSystem._currentAlchemistryProjectIndex = 0;
        }
    }

    // Lazy initialization of data when the main menu opens
    const _Scene_Menu_create = Scene_Menu.prototype.create;
    Scene_Menu.prototype.create = function () {
        ensureAlchemistryProjects();
        _Scene_Menu_create.call(this);
    };

    // =========================================================================
    // Scene_Alchemistry (base), logic only; DOM lives in the UI file
    // =========================================================================

    function Scene_Alchemistry() {
        this.initialize(...arguments);
    }

    Scene_Alchemistry.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_Alchemistry.prototype.constructor = Scene_Alchemistry;

    Scene_Alchemistry.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_Alchemistry.prototype.create = function () {
        ensureAlchemistryProjects();
        Scene_MenuBase.prototype.create.call(this);
        // Name the skill this menu runs on while it is open.
        if (window.SpecBadge) window.SpecBadge.show('Alchemy');  // i18n-ignore  Specialization.json id

        if ($gameSystem && $gameSystem._isSandboxMode && !$gameSystem._alchemistryRecipesLoaded) {
            this.loadRecipesToProjects();
        }
    };

    // Convert a <Formula: ...> note tag into a subscript-rendered string.
    Scene_Alchemistry.prototype.getItemFormula = function (item) {
        if (!item || !item.note) return '';
        const match = item.note.match(/<Formula:\s*(.*?)>/);
        if (!match) return '';
        const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
        return match[1].replace(/\d/g, d => subscripts[parseInt(d, 10)]);
    };

    // Cache the parsed recipe book so it is fetched from disk only once per
    // session instead of on every loadRecipesToProjects/executeProject call.
    let _alchemistryRecipeCache = null;
    function loadAlchemistryRecipes() {
        if (_alchemistryRecipeCache) return Promise.resolve(_alchemistryRecipeCache);
        return fetch('js/db/Items/Alchemistry.json')
            .then(response => response.json())
            .then(recipes => {
                _alchemistryRecipeCache = recipes;
                return recipes;
            });
    }

    Scene_Alchemistry.prototype.loadRecipesToProjects = function () {
        const hasDoctor   = $gameParty.members().some(a => a._classId === 41);
        const hasArchmage = $gameParty.members().some(a => a._classId === 27);
        const isSandbox   = $gameSystem && $gameSystem._isSandboxMode;

        return loadAlchemistryRecipes()
            .then(recipes => {
                $gameSystem._alchemistryProjects = [];
                for (let i = 0; i < recipes.length; i++) {
                    const recipe = recipes[i];

                    if (!isSandbox) {
                        const isMundane = recipe.mundane === true;
                        if (isMundane && !hasDoctor) continue;
                        if (!isMundane && !hasArchmage) continue;
                    }

                    const steps = recipe.steps.map(s => ({
                        action: s.action,
                        ingredients: s.ingredients || [],
                        duration: s.duration || 10,
                        temperature: s.temperature || 25
                    }));
                    $gameSystem._alchemistryProjects.push({
                        name: recipe.name,
                        steps: steps,
                        required_ingredients: recipe.required_ingredients || [],
                        target_item_id: recipe.target_item_id
                    });
                }
                $gameSystem._alchemistryRecipesLoaded = true;
                if (this.onRecipesLoaded) this.onRecipesLoaded();
            })
            .catch(err => console.error('Failed to load recipes', err));
    };

    // Resolve the running project's steps against the recipe book.
    Scene_Alchemistry.prototype.findMatchingRecipe = function (steps, recipes) {
        for (const recipe of recipes) {
            if (recipe.steps.length !== steps.length) continue;
            let match = true;
            for (let i = 0; i < steps.length; i++) {
                const recipeStep  = recipe.steps[i];
                const projectStep = steps[i];

                if (recipeStep.action !== projectStep.action) { match = false; break; }

                const rIngs = recipeStep.ingredients || [];
                const pIngs = projectStep.ingredients || [];
                if (rIngs.length !== pIngs.length) { match = false; break; }

                for (let j = 0; j < rIngs.length; j++) {
                    if (rIngs[j].item_id !== pIngs[j].item_id) { match = false; break; }
                }
                if (!match) break;
            }
            if (match) return recipe;
        }
        return null;
    };

    // Kick off processing: returns a promise resolving with { match, totalDuration }.
    Scene_Alchemistry.prototype.executeProject = function (project) {
        return loadAlchemistryRecipes()
            .then(recipes => {
                const match = this.findMatchingRecipe(project.steps, recipes);
                const totalDuration = project.steps.reduce((sum, step) => sum + (step.duration || 0), 0);

                $gameSystem._alchemistryTimer = totalDuration * 60;
                $gameSystem._alchemistryCurrentMatch = match;
                $gameSystem._alchemistryActiveProjectIndex = $gameSystem._currentAlchemistryProjectIndex;

                return { match, totalDuration };
            });
    };

    Scene_Alchemistry.prototype.addStepToCurrentProject = function (action, itemId) {
        const index   = $gameSystem._currentAlchemistryProjectIndex;
        const project = $gameSystem._alchemistryProjects[index];
        project.steps.push({
            action: action.toUpperCase(),
            ingredients: itemId ? [{ item_id: itemId, quantity: 1 }] : [],
            duration: 10,
            temperature: 25
        });
    };

    // =========================================================================
    // Background processing timer
    // =========================================================================

    const _Scene_Base_update = Scene_Base.prototype.update;
    Scene_Base.prototype.update = function () {
        _Scene_Base_update.call(this);
        if ($gameSystem && $gameSystem._alchemistryTimer > 0) {
            $gameSystem._alchemistryTimer--;
            if ($gameSystem._alchemistryTimer === 0) {
                $gameSystem.completeAlchemistryProject();
            }
        }
    };

    Game_System.prototype.completeAlchemistryProject = function () {
        const match        = this._alchemistryCurrentMatch;
        const projectIndex = this._alchemistryActiveProjectIndex;

        const XP = window.SpecializationXP;
        if (match) {
            if (match.target_item_id && $dataItems[match.target_item_id]) {
                // A practised alchemist gets a second draught out of the same
                // reagents often enough to be worth the study (Alchemy, 309).
                const bonusChance = XP ? (XP.partyLevel('Alchemy') /* i18n-ignore: Specialization.json id */ - 1) * 0.10 : 0;
                const qty = 1 + (Math.random() < bonusChance ? 1 : 0);
                $gameParty.gainItem($dataItems[match.target_item_id], qty);
            }
            if (SceneManager._scene instanceof Scene_Map) {
                $gameMessage.add(T('Alchemistry.successCreated', { item: match.name }));
            }
            SoundManager.playOk();
            if (XP) XP.awardCapped('Alchemy', 2); // i18n-ignore: Specialization.json id

            if (this._alchemistryProjects[projectIndex]) {
                this._alchemistryProjects[projectIndex].steps = [];
            }
        } else {
            if (SceneManager._scene instanceof Scene_Map) {
                $gameMessage.add(T('Alchemistry.failed'));
            }
            SoundManager.playBuzzer();
            // A ruined batch still teaches something about the reagents.
            if (XP) XP.awardCapped('Alchemy', 1); // i18n-ignore: Specialization.json id
        }

        this._alchemistryTimer = 0;
        this._alchemistryCurrentMatch = null;
        this._alchemistryActiveProjectIndex = null;
    };

    // =========================================================================
    // Exports + plugin command
    // =========================================================================

    window.Scene_Alchemistry  = Scene_Alchemistry;
    // A live read of the namespace, so the panel follows a language switch.
    window.AlchemistryI18n    = () => T.obj('Alchemistry');
    window.AlchemistryActions = ALCHEMISTRY_ACTIONS;

    PluginManager.registerCommand('AlchemistryMenu', 'openMenu', () => {
        SceneManager.push(Scene_Alchemistry);
    });
})();
