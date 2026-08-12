/*:
 * @target MZ
 * @plugindesc v3.1.0 Unified skill encyclopedia with training, progression, and procedural spell fusion.
 * @author Omni-Lex
 *
 * @param Variable ID
 * @desc ID of the variable to store the selected skill ID
 * @type variable
 * @default 1
 *
 * @param Encyclopedia Command
 * @desc Command name for the skill system in the menu
 * @type string
 * @default Skill Master
 *
 * @param Add to Menu
 * @desc Add the skill system to the main menu?
 * @type boolean
 * @on Yes
 * @off No
 * @default true
 *
 * @param Battle Progress Points
 * @desc Points gained after winning a battle with the skill selected
 * @type number
 * @min 1
 * @default 3
 *
 * @command openSkillEncyclopedia
 * @desc Opens the unified skill encyclopedia interface.
 *
 * @command openWithSkill
 * @text Open With Skill
 * @desc Opens the encyclopedia and highlights a specific skill
 * @arg skillId
 * @type skill
 * @text Skill
 * @desc The skill to highlight in the encyclopedia
 *
 * @command increaseSkillProgress
 * @desc Manually increases the progress of the currently selected skill.
 * @arg amount
 * @type number
 * @text Amount
 * @desc The amount of progress to add
 * @default 1
 * @min 1
 *
 * @help
 * ============================================================================
 * Skill Master v3.0 - Unified Encyclopedia Interface
 * ============================================================================
 *
 * This plugin provides a comprehensive skill management system with:
 * - Browse all skills organized by category (grid view)
 * - Select skills for training per party member
 * - Track progression individually per actor
 * - Fuse compatible skills to create new ones
 * - Actor-specific category bonuses
 *
 * ============================================================================
 * Actor Bonuses
 * ============================================================================
 *
 * For Actor 1, Primary and Secondary skill categories are defined per class
 * in js/db/Skills/Categories.json under "classSkillCategories" (the single
 * source of truth). Skills from these categories gain progression points at
 * an accelerated rate.
 *
 * Each class id maps to:
 *   "<id>": { "primary": ["Cat1","Cat2","Cat3"], "secondary": ["Cat4","Cat5","Cat6"] }
 *
 * - Primary categories get a 3x multiplier on progression points.
 * - Secondary categories get a 1.5x multiplier on progression points.
 *
 * A class studies only what it studies: the Training encyclopedia lists ONLY
 * the pupil's primary and secondary categories, so a Knight is never offered
 * Necromancy. "All" means the pupil's whole curriculum, not the whole book.
 * A class with no entry in classSkillCategories falls back to every category.
 *
 * ============================================================================
 * The atlas of circles
 * ============================================================================
 *
 * A category is not a list, it is a SPHERE GRID in the manner of Final
 * Fantasy X's: concentric rings of skills joined by short radial spokes, run
 * from the school's weakest working outward to its strongest, with upgrade
 * spurs hanging off the rim that dead-end in its esoteric ones. A pupil may
 * only buy a skill they are standing next to. ONE known neighbour is enough -
 * links are alternative ways in, never joint requirements - and the skills on
 * the innermost ring of the school are always open, so a pupil who knows
 * nothing still has a way in.
 *
 * A school's FORBIDDEN workings are not on the grid at all. They sit alone in
 * the heart of the figure, joined to nothing and to each other least of all:
 * the whole school must be known before any of them opens, and then any one of
 * them may be taken first.
 *
 * The plate is drawn as an ALCHEMICAL CIRCLE: a double rule, a thin ring per
 * tier, a faint guide down every lane, and the squared circle at the heart.
 * ONE school is drawn at a time, alone on the page: a curriculum of six schools
 * is six views, not one crowded field, so a circle is read whole instead of
 * hunted for. The school is changed with the pager on the header bar, or by
 * walking off the rim left or right. The wheel and Shift zoom; dragging pans;
 * choosing a skill opens its sheet as a popup over the circle.
 *
 * A school OUTSIDE the pupil's curriculum is browsable only once they already
 * know a skill in it, has no free entrance (they may only walk outward from
 * what they know), and charges three times the knowledge.
 *
 * The graph is data, authored into each skill's notebox by
 * tools/skills/gen_skill_graph.py (re-runnable; it strips and rewrites its own
 * tags, so hand-tuning survives until the next run):
 *
 *   <Node: ring,lane>     ring is its distance out, lane its bearing
 *   <Link: 12,45,78>      the skills it borders, inside the same category
 *
 * The generator draws the figure exactly as this plugin does and deletes any
 * link that would cross another, so no two links ever overlap on the page.
 * Links are read as symmetric, so a hand-written notebox naming only one side
 * still works. A skill with no <Node:> at all is never on a circle, and is never
 * blocked by one either.
 *
 * ============================================================================
 * Knowledge cost
 * ============================================================================
 *
 * What a skill costs to teach is what it is worth in a fight, not a flat fee.
 * The MP and TP it asks for is the designer's own verdict on it and is the
 * leading term; skillPower() reads that first, then damage scaling, flat
 * damage, repeats, target breadth and applied effects. The plainest skill in
 * the book costs the base price of 50 KP and everything above it rises as a
 * power of that score, to a few hundred for an ordinary skill and a couple of
 * thousand for the strongest ordinary one.
 *
 * The two occult tags are priced apart from all of that, because they are not a
 * matter of degree: an <Esoteric> skill costs TEN times its score and a
 * <Forbidden> one costs a HUNDRED times (every Forbidden skill is Esoteric too;
 * it takes the larger multiplier, never both). A PRIMARY school then halves the
 * price, a secondary school pays full, and nothing is ever cheaper than 50 KP.
 *
 * ============================================================================
 * Skill Categorization
 * ============================================================================
 *
 * To categorize skills, add a category tag to skill notes:
 * <category:EnhancementMagic>
 *
 * ============================================================================
 * Skill Progression
 * ============================================================================
 *
 * Select a skill in the encyclopedia to track its progression per actor.
 * Each party member can train a different skill simultaneously.
 * Progress is gained by:
 * 1. Winning battles (3 points per battle, per actor)
 * 2. Using skills from the same category in battle (2 points per use)
 * 3. Using the increaseSkillProgress plugin command
 *
 * ============================================================================
 * Fuse Spells (procedural fusion)
 * ============================================================================
 *
 * From the Magic page, "Fuse Spells" opens an editor where a pupil combines a
 * DOMINANT spell with a RECESSIVE component into a brand new ability:
 *   - Dominant slot: a known Spell (Magic). Defines the fusion's behaviour
 *     (damage, scope, hit type, icon).
 *   - Recessive slot: a known Spell OR Skill. If it is a Skill, the fused
 *     result becomes a Skill (listed under Skills); otherwise it stays Magic.
 *   - Animation: any named Effekseer animation, previewable in 3D.
 *
 * The fused ability costs the SUM of the components' MP and AP and can be split
 * back into its parts at any time. Component spells/skills are forgotten when
 * fused. Forging is paid in Knowledge: the sum of what teaching the components
 * would cost, plus a 25% premium (minimum 15 KP). Splitting refunds nothing, so
 * re-fusing pays again.
 *
 * A Preview button in the skill detail view shows a zoomable / draggable 3D
 * preview of any skill's animation over an empty target.
 *
 * ============================================================================
*/

(() => {
    'use strict';

    // ── Shared character-switcher hint helper (idempotent across plugins) ──────
    // Shows controller bumper hints (L / R) around a .companion-tabs-row when a
    // gamepad is connected, or a single TAB hint otherwise. Also installs a Tab
    // keyboard shortcut that cycles characters only while no controller is
    // connected (the bumpers / pageup-pagedown handle it when one is).
    if (!window.CharSwitcher) {
        window.CharSwitcher = {
            isControllerConnected() {
                const pads = navigator.getGamepads ? navigator.getGamepads() : [];
                for (let i = 0; i < pads.length; i++) {
                    if (pads[i] && pads[i].connected) return true;
                }
                return false;
            },
            injectStyles() {
                if (document.getElementById('char-switch-hint-styles')) return;
                const style = document.createElement('style');
                style.id = 'char-switch-hint-styles';
                style.textContent = `
                    .companion-switcher { display:flex; align-items:center; gap:6px; }
                    .char-switch-hint {
                        font-family:'Lora',serif; font-size:0.6rem; font-weight:bold;
                        line-height:1; letter-spacing:0.5px; color:var(--text-primary-hover);
                        border:1.5px solid var(--text-primary-hover); border-radius:3px;
                        padding:2px 5px; opacity:0.7; user-select:none; white-space:nowrap;
                        text-transform:uppercase; flex-shrink:0;
                    }
                `;
                document.head.appendChild(style);
            },
            parts(memberCount) {
                this.injectStyles();
                if (!memberCount || memberCount <= 1) return { left: '', right: '' };
                if (this.isControllerConnected()) {
                    return {
                        left: '<span class="char-switch-hint">L</span>',
                        right: '<span class="char-switch-hint">R</span>'
                    };
                }
                return { left: '', right: '<span class="char-switch-hint">TAB</span>' };
            },
            inner(tabsRowHTML, memberCount) {
                const p = this.parts(memberCount);
                return p.left + tabsRowHTML + p.right;
            },
            wrap(tabsRowHTML, memberCount) {
                return `<div class="companion-switcher">${this.inner(tabsRowHTML, memberCount)}</div>`;
            },
            installTabKey(scene, onCycle) {
                if (scene._charSwitchTabListener) return;
                scene._charSwitchTabListener = (e) => {
                    if (e.key !== 'Tab') return;
                    e.preventDefault();
                    if (this.isControllerConnected()) return;
                    onCycle(e.shiftKey ? -1 : 1);
                };
                window.addEventListener('keydown', scene._charSwitchTabListener);
            },
            removeTabKey(scene) {
                if (scene._charSwitchTabListener) {
                    window.removeEventListener('keydown', scene._charSwitchTabListener);
                    scene._charSwitchTabListener = null;
                }
            }
        };
    }

    const pluginName = "SkillMaster";

    // Plugin parameters
    const parameters = PluginManager.parameters(pluginName);
    const variableId = Number(parameters['Variable ID'] || 1);
    const encyclopediaCommand = String(parameters['Encyclopedia Command'] || 'Skill Master');
    const addToMenu = parameters['Add to Menu'] !== 'false';
    const battleProgressPoints = Number(parameters['Battle Progress Points'] || 3);
    const tr = (en, it) => ConfigManager.language === "it" ? it : en;

    let _statsI18n = null;

    const _loadStatsI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/stats.json`;
        try {
            const response = await fetch(url);
            _statsI18n = await response.json();
        } catch (e) {
            console.error('SkillMaster: Failed to load i18n data from ' + url, e);
        }
    };

    const _si18n = (key) => {
        if (_statsI18n && _statsI18n[key]) {
            return _statsI18n[key];
        }
        return key;
    };

    _loadStatsI18n();

    //=============================================================================
    // Category Data ,  loaded from js/db/Skills/Categories.json
    //=============================================================================

    let CATEGORY_DATA = {};

    const _loadCategoryData = async () => {
        const url = 'js/db/Skills/Categories.json';
        try {
            const response = await fetch(url);
            CATEGORY_DATA = await response.json();
        } catch (e) {
            console.error('SkillMaster: Failed to load Categories.json from ' + url, e);
        }
    };

    _loadCategoryData();

    function uncamelCase(str) {
        if (!str) return '';
        const decamel = str
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
        return decamel.split(/\s+/).map(word => {
            if (!word) return '';
            if (word === word.toUpperCase()) return word;
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
    }

    function getCategoryDisplayName(categoryName) {
        const key = 'SkillMaster.category.' + categoryName;
        if (T.has(key)) return T(key);
        const data = CATEGORY_DATA[categoryName];
        if (data) {
            return T.language() === 'it' ? data.name.it : data.name.en;
        }
        return uncamelCase(categoryName);
    }

    function getCategoryIcon(categoryName) {
        const data = CATEGORY_DATA[categoryName];
        return data ? data.icon : 245;
    }

    function getCategoryIconStyle(categoryName) {
        const data = CATEGORY_DATA[categoryName];
        const iconIndex = data ? data.icon : 245;
        const iconSize = 32;
        const cols = 16;
        const x = (iconIndex % cols) * iconSize;
        const y = Math.floor(iconIndex / cols) * iconSize;
        return `background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; image-rendering: pixelated; display: inline-block;`;
    }

    function getSkillIconStyle(iconIndex) {
        const index = iconIndex || 0;
        const iconSize = 32;
        const cols = 16;
        const x = (index % cols) * iconSize;
        const y = Math.floor(index / cols) * iconSize;
        return `background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; image-rendering: pixelated; display: inline-block;`;
    }

    function getSkillCategory(skillId) {
        if (!skillId) return null;
        const skill = $dataSkills[skillId];
        if (!skill) return null;
        const match = skill.note.match(/<category:\s*(.+?)\s*>/i);
        return match ? match[1].trim() : null;
    }

    // <MagicSystem:> (gen_magic_system_tags.js) on a skill and <MagicalSystem:>
    // (gen_class_magic_system_tags.js) on a class: two different tag names on
    // purpose, one per skill and one per class, read the same way.
    function getSkillMagicSystem(skillId) {
        if (!skillId) return null;
        const skill = $dataSkills[skillId];
        if (!skill || !skill.note) return null;
        const match = skill.note.match(/<MagicSystem:\s*([^>]+)>/i);
        return match ? match[1].trim() : null;
    }

    function getActorMagicSystem(actorId) {
        if (!actorId) return null;
        const classId = actorCategoryManager._classIdFor(actorId);
        const cls = classId && $dataClasses[classId];
        if (!cls || !cls.note) return null;
        const match = cls.note.match(/<MagicalSystem:\s*([^>]+)>/i);
        return match ? match[1].trim() : null;
    }

    const actorCategoryManager = {
        _primary: [],
        _secondary: [],
        _initialized: false,
        _actorId: 1,
        _classId: 0,
        _foreign: [],
        _foreignKey: '',

        // Switch the manager to a specific pupil so the KP discounts and the
        // "3.0X / 1.5X KP" badges reflect that actor's class. Recomputes on next use.
        setActor: function (actorId) {
            if (!actorId || actorId === this._actorId) return;
            this._actorId = actorId;
            this._initialized = false;
        },

        _classIdFor: function (actorId) {
            const gameActor = typeof $gameActors !== 'undefined' && $gameActors ? $gameActors.actor(actorId) : null;
            if (gameActor && gameActor.currentClass()) return gameActor.currentClass().id;
            const data = $dataActors && $dataActors[actorId];
            return data ? data.classId : null;
        },

        initialize: function () {
            if (typeof $dataActors === 'undefined' || !$dataActors) return;

            const classId = this._classIdFor(this._actorId);
            if (!classId) return;
            // Re-read whenever the pupil's class changes under us (a class swap,
            // or the manager still holding a stale table for the same actor id).
            if (this._initialized && this._classId === classId) return;
            this._classId = classId;

            // Primary/secondary skill categories are sourced from
            // js/db/Skills/Categories.json (classSkillCategories), the single
            // source of truth, rather than class noteboxes.
            const map = CATEGORY_DATA && CATEGORY_DATA.classSkillCategories;
            if (!map) return; // Categories.json not loaded yet; retry on next call.

            const entry = map[classId] || map[String(classId)];
            this._primary = (entry && Array.isArray(entry.primary)) ? entry.primary.slice() : [];
            this._secondary = (entry && Array.isArray(entry.secondary)) ? entry.secondary.slice() : [];
            this._initialized = true;
        },

        // initialize() is a no-op once the pupil's table is current, so every
        // reader calls it rather than trusting a flag that predates a class swap.
        isPrimary: function (category) {
            this.initialize();
            return this._primary.includes(category);
        },

        isSecondary: function (category) {
            this.initialize();
            return this._secondary.includes(category);
        },

        // A school the pupil's class does NOT study, but in which they already
        // know a skill: a Knight who picked up one necromantic trick from a
        // grimoire, a body part or a level-up can go on down that tree from
        // where they stand. The tree opens, the ordinary adjacency rule still
        // applies (so only neighbours of what they know are buyable), and every
        // skill in it is charged FOREIGN_KP_MULT.
        foreignCategories: function () {
            this.initialize();
            const own = this._primary.concat(this._secondary);
            if (!own.length) return [];   // no table means the whole book is theirs already
            const actor = (typeof $gameActors !== 'undefined' && $gameActors)
                ? $gameActors.actor(this._actorId) : null;
            if (!actor || !actor.skills) return [];
            const known = actor.skills();
            // Every rendered card asks the price, so answer from a cache and
            // rebuild it only when the pupil, their class or their skill list moves.
            const key = `${this._actorId}:${this._classId}:${known.length}`;
            if (this._foreignKey === key) return this._foreign;
            const out = [];
            for (const skill of known) {
                if (!skill) continue;
                const cat = getSkillCategory(skill.id);
                if (!cat || own.includes(cat) || out.includes(cat)) continue;
                out.push(cat);
            }
            this._foreignKey = key;
            this._foreign = out;
            return out;
        },

        // Is this school open to the pupil only because they already know
        // something in it? Those skills are charged triple.
        isForeign: function (category) {
            if (!category) return false;
            if (this.isPrimary(category) || this.isSecondary(category)) return false;
            return this.foreignCategories().includes(category);
        },

        // The categories the pupil can browse: primary first, then secondary,
        // then any school they have a foothold in. The training menu shows
        // nothing outside this list, so a Knight is never offered Necromancy
        // unless they already know a necromantic skill. Returns null when the
        // class has no table at all (or Categories.json has not loaded yet),
        // which means "no restriction" rather than "nothing to learn".
        allowedCategories: function () {
            this.initialize();
            const list = this._primary.concat(this._secondary);
            if (!list.length) return null;
            return list.concat(this.foreignCategories());
        },

        getMultiplier: function (skillId) {
            this.initialize();

            const category = getSkillCategory(skillId);
            if (!category) return 1;

            if (this.isPrimary(category)) {
                return 3;
            }
            if (this.isSecondary(category)) {
                return 1.5;
            }
            return 1;
        }
    };

    //=============================================================================
    // Game_System - Shared Knowledge Points
    //=============================================================================

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        _Game_System_initialize.call(this);
        this._knowledgePoints = 0;
    };

    Game_System.prototype.getKnowledge = function () {
        if (this._knowledgePoints === undefined) this._knowledgePoints = 0;
        if (!this._sandboxKnowledgePointsGiven) {
            const isSandbox = (this._isSandboxMode) || ($gameSystem && $gameSystem._isSandboxMode);
            const isTestPlayer = ($gameParty && $gameParty.allMembers && $gameParty.allMembers().length > 0 && $gameParty.allMembers()[0].name().toLowerCase() === 'test');
            if (isSandbox || isTestPlayer) {
                this._knowledgePoints = 99999;
                this._sandboxKnowledgePointsGiven = true;
            }
        }
        return this._knowledgePoints;
    };

    Game_System.prototype.addKnowledge = function (amount) {
        if (this._knowledgePoints === undefined) this._knowledgePoints = 0;
        this.getKnowledge();
        this._knowledgePoints += amount;
    };

    Game_System.prototype.spendKnowledge = function (amount) {
        if (this._knowledgePoints === undefined) this._knowledgePoints = 0;
        this.getKnowledge();
        this._knowledgePoints = Math.max(0, this._knowledgePoints - amount);
    };

    //=============================================================================
    // Skill power -> Knowledge cost
    //
    // A skill is priced by what it does, not by a flat fee, so the gap between a
    // jab and a world-ending word is a gap in orders of magnitude rather than a
    // few points. skillPower() scores everything the database actually knows
    // about a skill and kpTeachCost() raises that score to a power, which is what
    // turns a linear reading of a skill into an exponential price.
    //
    // The MP and TP a skill asks for LEADS that score: it is the one number the
    // designer set by hand on every skill in the book, and it already separates a
    // 0 MP jab from a 9999 MP working better than any formula reading can.
    //
    //   power 1     -> 50 KP     (the base price: a skill that asks nothing)
    //   power ~2    -> 170 KP    (an ordinary skill)
    //   power ~3.5  -> 460 KP
    //   power ~5    -> 850 KP    (the strongest ordinary skills)
    //
    // Over the 1279 untagged skills in the book that reads 61 KP at the bottom,
    // ~370 median and ~1700 at the very top. The occult tags are then a
    // multiplier on the finished price rather than a term inside the score:
    // Esoteric x10 (roughly 1,100-5,000 KP) and Forbidden x100, which is a price
    // nobody pays by accident.
    //=============================================================================

    const KP_TEACH_BASE = 50;     // the base price: what a power-1 skill costs
    const KP_TEACH_EXP = 1.75;    // how hard power is punished
    const KP_TEACH_MIN = 50;      // no skill is ever cheaper than the base price
    const KP_TEACH_MAX = 250000;  // ceiling, so a broken formula can't price itself out

    // The two occult tags, priced apart from the score. Every <Forbidden> skill
    // carries <Esoteric> as well and takes the larger of the two, never both.
    const KP_ESOTERIC_MULT = 10;
    const KP_FORBIDDEN_MULT = 100;
    // What a school nobody taught them costs: a foothold is not a curriculum.
    const FOREIGN_KP_MULT = 3;

    // A TP point is scarcer than an MP point (TP caps at 100 and is earned in the
    // fight, MP runs to thousands and is carried into it), so it weighs more.
    const KP_TP_WEIGHT = 4;
    const KP_RESOURCE_SOFT = 12;  // MP a skill may ask before the price notices
    const KP_RESOURCE_WEIGHT = 0.55;

    // Stats a damage formula can scale off, biggest multiplier wins. Compiled
    // once: a grid prices every node it draws.
    const KP_FORMULA_STATS = ['a.mhp', 'a.mmp', 'a.atk', 'a.def', 'a.mat', 'a.mdf',
        'a.agi', 'a.luk', 'a.level', 'a.hp', 'a.mp', 'a.tp'].map(stat => ({
            stat: stat,
            re: new RegExp(stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\*\\s*([\\d.]+)')
        }));

    // How much of a threat the target set is, by RMMZ scope id.
    const KP_SCOPE_WEIGHT = {
        0: 0, 1: 0, 2: 0.8, 3: 0.3, 4: 0.45, 5: 0.55, 6: 1.0, 7: 0.15,
        8: 0.6, 9: 0.15, 10: 0.6, 11: 0, 12: 0.6, 13: 0.8, 14: 1.0
    };

    // Reads the damage formula for its steepest stat multiplier and its largest
    // flat term (the 3000 in "3000 + a.mdf * 8" is most of that skill's worth).
    function kpFormulaWeight(formula) {
        if (!formula) return { multiplier: 0, flat: 0 };
        let multiplier = 0;
        for (const entry of KP_FORMULA_STATS) {
            const m = formula.match(entry.re);
            if (m) multiplier = Math.max(multiplier, parseFloat(m[1]) || 0);
            else if (formula.includes(entry.stat)) multiplier = Math.max(multiplier, 1);
        }
        let flat = 0;
        const flatRe = /(?:^|[^.\w])(\d{2,5})(?![.\w])/g;
        let f;
        while ((f = flatRe.exec(formula)) !== null) flat = Math.max(flat, parseInt(f[1], 10));
        return { multiplier: multiplier, flat: flat };
    }

    // Everything the score itself reads. The occult tags are NOT in here: they
    // multiply the finished price (kpTeachCost), so the 10x and the 100x stay
    // exactly what they say they are instead of being bent by the exponent.
    function skillPower(skill) {
        if (!skill) return 1;
        const resource = (skill.mpCost || 0) + (skill.tpCost || 0) * KP_TP_WEIGHT;
        // Resource cost is the designer's own verdict on a skill and leads the
        // score, but it spans 0-9999, so it is read logarithmically, not raw.
        let power = 1 + Math.log2(1 + resource / KP_RESOURCE_SOFT) * KP_RESOURCE_WEIGHT;

        const dmg = skill.damage || {};
        if (dmg.type > 0) {
            const w = kpFormulaWeight(dmg.formula || '');
            power += Math.min(w.multiplier, 25) * 0.07;
            power += Math.min(w.flat / 1000, 2);
        }
        power += Math.max(0, (skill.repeats || 1) - 1) * 0.25;
        power += (KP_SCOPE_WEIGHT[skill.scope] !== undefined ? KP_SCOPE_WEIGHT[skill.scope] : 0.3) * 0.35;

        for (const eff of (skill.effects || [])) {
            if (!eff) continue;
            switch (eff.code) {
                case Game_Action.EFFECT_ADD_STATE:
                case Game_Action.EFFECT_REMOVE_STATE:
                    power += 0.12 * Math.min(1, Math.max(0.2, eff.value1 || 1)); break;
                case Game_Action.EFFECT_ADD_BUFF:
                case Game_Action.EFFECT_ADD_DEBUFF:
                    power += 0.1; break;
                case Game_Action.EFFECT_RECOVER_HP:
                case Game_Action.EFFECT_RECOVER_MP:
                    power += 0.1; break;
                case Game_Action.EFFECT_GAIN_TP: power += 0.06; break;
                case Game_Action.EFFECT_GROW: power += 0.3; break;     // permanent stat growth
                case Game_Action.EFFECT_LEARN_SKILL: power += 0.2; break;
                case Game_Action.EFFECT_SPECIAL: power += 0.12; break;
                case Game_Action.EFFECT_COMMON_EVENT: power += 0.12; break;
            }
        }

        return Math.max(1, power);
    }

    // What the occult tags do to a price. Forbidden wins outright: every
    // Forbidden skill carries Esoteric as well and must not pay both.
    function kpOccultMultiplier(skill) {
        const note = (skill && skill.note) || '';
        if (/<Forbidden>/i.test(note)) return KP_FORBIDDEN_MULT;
        if (/<Esoteric>/i.test(note)) return KP_ESOTERIC_MULT;
        return 1;
    }

    function kpTeachCost(skill) {
        const raw = KP_TEACH_BASE * Math.pow(skillPower(skill), KP_TEACH_EXP)
            * kpOccultMultiplier(skill);
        return Math.max(KP_TEACH_MIN, Math.min(KP_TEACH_MAX, Math.round(raw)));
    }

    // Cost scales with the skill's power; only a PRIMARY school then discounts it
    // (a secondary school is taught at full price). The base price is a floor the
    // discount cannot go under, so the cheapest skill in the book is 50 KP to
    // anybody.
    Game_System.prototype.getSkillKnowledgeCost = function (skillId, actorId) {
        const skill = $dataSkills[skillId];
        if (!skill) return KP_TEACH_MIN;
        // The badges, the discounts and this price all have to be reading the same
        // pupil; every caller names one, so honour it rather than whichever actor
        // the manager happens to be holding.
        if (actorId) actorCategoryManager.setActor(actorId);
        let cost = kpTeachCost(skill);
        const category = getSkillCategory(skillId);
        if (category && actorId) {
            if (actorCategoryManager.isPrimary(category)) cost = Math.floor(cost * 0.5);
            // A school nobody taught them: they are reading it off their own
            // one trick, and it costs them three times over.
            else if (actorCategoryManager.isForeign(category)) cost *= FOREIGN_KP_MULT;
        }
        // A pupil whose class is itself filed under a magic system (Witch's
        // Arcane, Fire Mage's Thermodynamics, ...) reads a spell of that same
        // system half as dear again, on top of whatever the school discount
        // already did: the two are independent coupons, not alternatives.
        if (actorId) {
            const skillSystem = getSkillMagicSystem(skillId);
            if (skillSystem && skillSystem === getActorMagicSystem(actorId)) {
                cost = Math.floor(cost * 0.5);
            }
        }
        return Math.max(KP_TEACH_MIN, cost);
    };

    //=============================================================================
    // Knowledge award curve (shared by battles and quest hand-ins)
    //
    // Knowledge is earned by facing things above your own level: the further
    // above, the steeper the gain. Battles and contracts price off the same
    // curve so a five-star hunt and the fight it asks for stay comparable.
    //
    //   ratio = enemy level / party median level
    //   value = KP_BASE * ratio ^ KP_CURVE, clamped to [KP_MIN, KP_MAX]
    //
    // At parity that is 3 KP; half again the party's level pays ~5.5; double
    // pays ~8.5; quadruple hits the 25 KP ceiling. Teaching a skill costs 50 KP
    // at the base price and a few hundred for an ordinary one
    // (getSkillKnowledgeCost, median ~370 before the school discount), so a
    // skill is a run of fights or a couple of bounties away, while an esoteric
    // working is a campaign's worth of them and a Forbidden one is a lifetime's.
    //=============================================================================

    const KP_BASE = 3;            // value of an exactly level-matched enemy
    const KP_CURVE = 1.5;         // how hard being outlevelled pays
    const KP_MIN = 1;             // even a trivial kill teaches something
    const KP_MAX = 25;            // per-enemy ceiling
    const KP_EXTRA_WEIGHT = 0.35; // every enemy past the strongest counts less
    const KP_ENCOUNTER_CAP = 60;  // ceiling for one whole encounter

    // A five-star contract is worth more than the fight inside it: the stars are
    // the pay grade, and the bounty's own level is added on top by forQuest.
    const KP_QUEST_BASE = { 1: 5, 2: 10, 3: 20, 4: 40, 5: 70 };

    const KP_FUSION_PREMIUM = 1.25; // forging costs more than the parts teach
    const KP_FUSION_MIN = 50;       // the base price: a forging is never cheaper

    function kpForEnemy(enemyLevel, partyLevel) {
        const pl = Math.max(1, partyLevel || 1);
        const el = Math.max(1, enemyLevel || 1);
        const v = KP_BASE * Math.pow(el / pl, KP_CURVE);
        return Math.max(KP_MIN, Math.min(KP_MAX, v));
    }

    // The strongest enemy sets the price; the rest of the troop is a fraction of
    // its own worth, so a swarm of weaklings never out-earns a real threat.
    function kpForEncounter(enemyLevels, partyLevel) {
        const vals = (enemyLevels || [])
            .map(l => kpForEnemy(l, partyLevel))
            .sort((a, b) => b - a);
        if (!vals.length) return 0;
        let total = vals[0];
        for (let i = 1; i < vals.length; i++) total += vals[i] * KP_EXTRA_WEIGHT;
        return Math.max(1, Math.min(KP_ENCOUNTER_CAP, Math.round(total)));
    }

    function kpForQuest(diff, enemyLevels, partyLevel) {
        const stars = Math.max(1, Math.min(5, Math.round(diff || 1)));
        const base = KP_QUEST_BASE[stars] || KP_QUEST_BASE[1];
        const fight = (enemyLevels && enemyLevels.length)
            ? kpForEncounter(enemyLevels, partyLevel) : 0;
        return Math.max(1, Math.round(base + fight));
    }

    // Fusing consumes what the components were worth to teach, plus a premium
    // for the forging itself. Splitting refunds nothing, so re-fusing pays again.
    function kpFusionCost(componentIds, actorId) {
        let sum = 0;
        for (const id of (componentIds || [])) {
            if (!id) continue;
            sum += $gameSystem.getSkillKnowledgeCost(id, actorId);
        }
        if (sum <= 0) return KP_FUSION_MIN;
        return Math.max(KP_FUSION_MIN, Math.round(sum * KP_FUSION_PREMIUM));
    }

    window.KnowledgePoints = {
        forEnemy: kpForEnemy,
        forEncounter: kpForEncounter,
        forQuest: kpForQuest,
        fusionCost: kpFusionCost,
    };

    //=============================================================================
    // Custom (procedural) spells - Fuse Spells
    //
    // Fuse Spells combines a DOMINANT spell with a RECESSIVE spell/skill known by
    // a single pupil into a brand new CamelCase ability that only that actor
    // learns. A Skill recessive makes the result a skill (listed under Skills);
    // otherwise it stays Magic. Component skills are forgotten; the fused ability
    // costs the SUM of the components' MP and AP and can be split back into its
    // parts at any time.
    //
    // Fused abilities live in $gameSystem (so they persist in the save) and are
    // re-injected into $dataSkills on load, since $dataSkills is rebuilt from the
    // static database every boot.
    //=============================================================================

    Game_System.prototype.getCustomSpells = function () {
        if (!this._customSpells) this._customSpells = [];
        return this._customSpells;
    };

    Game_System.prototype.allocCustomSkillId = function () {
        if (!this._nextCustomSkillId) {
            const base = (typeof $dataSkills !== 'undefined' && $dataSkills) ? $dataSkills.length : 3000;
            this._nextCustomSkillId = Math.max(3000, base);
        }
        return this._nextCustomSkillId++;
    };

    Game_System.prototype.addCustomSpell = function (skill) {
        // Its own lane on the maker's plate, so no two fusions land on top of
        // each other. Ring 0 and no <Link:> is what makes it an island.
        const mine = this.getCustomSpells().filter(s => s && s._ownerActorId === skill._ownerActorId);
        skill.note = String(skill.note || '').replace(/\n?<Node:[^>]*>/i, '')
            + '\n<Node: 0,' + mine.length + '>';
        this.getCustomSpells().push(skill);
        if (typeof $dataSkills !== 'undefined' && $dataSkills) $dataSkills[skill.id] = skill;
    };

    Game_System.prototype.removeCustomSpell = function (skillId) {
        const arr = this.getCustomSpells();
        const idx = arr.findIndex(s => s && s.id === skillId);
        if (idx >= 0) arr.splice(idx, 1);
        if (typeof $dataSkills !== 'undefined' && $dataSkills && $dataSkills[skillId]) {
            $dataSkills[skillId] = null;
        }
    };

    // Re-attach every stored fused spell to $dataSkills. Called on save load (the
    // database is freshly reloaded each boot) and defensively when the scene opens.
    function injectAllCustomSpells() {
        if (typeof $gameSystem === 'undefined' || !$gameSystem) return;
        if (typeof $dataSkills === 'undefined' || !$dataSkills) return;
        for (const s of $gameSystem.getCustomSpells()) {
            if (s && s.id) $dataSkills[s.id] = s;
        }
    }

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        injectAllCustomSpells();
    };

    // Build a CamelCase name by stitching the leading letters of each component
    // name together, e.g. "Fire Bolt" + "Ice Shard" + "Quick Slash" -> "FireIceQuic".
    function makeFusedSpellName(names) {
        const parts = names.map(n => {
            const clean = String(n || '').replace(/[^A-Za-z]/g, '');
            if (!clean) return '';
            const chunk = clean.slice(0, 4);
            return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
        }).filter(Boolean);
        return parts.join('') || 'CustomSpell';
    }

    // Fuse a DOMINANT spell + a RECESSIVE spell/skill into a new procedural
    // ability owned by actorId. The DOMINANT component (always components[0])
    // supplies the core template - damage, scope, occasion, hit type and icon.
    // MP/AP are the SUMMED costs of both components, and effects are the union of
    // both components' effects ("a mix").
    //
    // The RESULT TYPE follows the recessive component: when the recessive slot
    // holds a plain Skill (not Magic), the fused ability inherits that skill's
    // skill-type id so it is listed under Skills rather than Magic in the battle
    // menu. When the recessive is a spell, the dominant's magic type is kept.
    function buildFusedSkill(components, actorId, animationId) {
        const clone = obj => JSON.parse(JSON.stringify(obj));
        const dominant = components[0];
        const recessive = components[1];
        const fused = clone(dominant);

        fused.id = $gameSystem.allocCustomSkillId();
        fused.name = makeFusedSpellName(components.map(c => c.name));
        fused.mpCost = components.reduce((sum, c) => sum + (c.mpCost || 0), 0);
        fused.tpCost = components.reduce((sum, c) => sum + (c.tpCost || 0), 0);

        // Core behaviour (damage block, scope/occasion/hit type, icon) is inherited
        // from the dominant component. Only the damage/icon are restated here for
        // clarity; the rest already came through the dominant clone.
        fused.damage = clone(dominant.damage);
        fused.iconIndex = dominant.iconIndex;

        // Type: a Skill recessive turns the whole fusion into a skill (so it is
        // listed in Skills, not Magic); a spell recessive keeps the dominant type.
        const recCat = recessive ? getSkillCategory(recessive.id) : null;
        const recIsSkill = recCat ? getCategoryType(recCat) !== 'Magic' : false;   // i18n-ignore: category id
        fused._resultIsSkill = recIsSkill;
        if (recIsSkill && recessive) {
            fused.stypeId = recessive.stypeId;
        }

        // Effects: a mix of both components' effects.
        fused.effects = [];
        for (const c of components) {
            for (const e of (c.effects || [])) fused.effects.push(clone(e));
        }

        if (animationId && animationId > 0) fused.animationId = animationId;

        const names = components.map(c => c.name).join(' + ');
        fused.description = T(
            recIsSkill ? 'SkillMaster.fusedSkillDesc' : 'SkillMaster.fusedSpellDesc',
            { parts: names, dominant: dominant.name });
        // A fusion is nobody's school but its maker's: it is filed under the
        // Fusion category, which is drawn per pupil, and it stands alone on the
        // plate (ring 0, its own lane, joined to nothing) because it was not
        // walked to - it was made.
        fused.note = '<customSpell>\n<category:' + FUSION_CATEGORY + '>';
        fused.meta = { customSpell: true };
        fused._customSpell = true;
        fused._ownerActorId = actorId;
        fused._components = components.map(c => c.id);
        fused._baseSkillId = dominant.id;
        fused._animationId = fused.animationId;
        return fused;
    }

    //=============================================================================
    // AnimPreview - plays a real Effekseer animation inside its own transparent
    // WebGL canvas. A dedicated Effekseer context (separate GL context from the
    // main renderer) keeps the preview fully isolated, so it can never corrupt the
    // game's rendering state. Used by the Fuse Spells animation picker and the
    // skill-detail 3D preview (drag to rotate, wheel to zoom).
    //=============================================================================

    const AnimPreview = {
        _ctx: null, _gl: null, _canvas: null,
        _effect: null, _handle: null, _effectName: '',
        _rafId: 0, _animId: 0, _dead: false,
        // Orbit camera (reused-from-MonsterTournament free orbit): drag to rotate,
        // wheel to zoom. Defaults reproduce the original front-on 10-unit camera.
        _yaw: 0, _pitch: 0.12, _dist: 10,
        _interactive: false, _dragging: false, _lastX: 0, _lastY: 0,
        _onDown: null, _onMove: null, _onUp: null, _onWheel: null,

        isSupported() { return !!window.effekseer; },

        init(canvas, interactive) {
            if (this._canvas === canvas && this._ctx) return true;
            this.dispose();
            if (!window.effekseer || !canvas) return false;
            const opts = { alpha: true, premultipliedAlpha: true, depth: true, antialias: true };
            const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
            if (!gl) return false;
            let ctx;
            try {
                ctx = window.effekseer.createContext();
                ctx.init(gl, { instanceMaxCount: 4000, squareMaxCount: 8000 });
                ctx.setRestorationOfStatesFlag(true);
            } catch (e) {
                console.error('SkillMaster AnimPreview: Effekseer init failed', e);
                return false;
            }
            this._canvas = canvas; this._gl = gl; this._ctx = ctx; this._dead = false;
            // Reset the orbit each time so a fresh preview always opens front-on.
            this._yaw = 0; this._pitch = 0.12; this._dist = 10;
            this._interactive = !!interactive;
            if (this._interactive) this._bindInput(canvas);
            this._startLoop();
            return true;
        },

        // Drag = orbit (yaw/pitch); wheel = zoom (dolly the camera in/out).
        _bindInput(canvas) {
            const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
            this._onDown = (e) => { this._dragging = true; this._lastX = e.clientX; this._lastY = e.clientY; e.preventDefault(); };
            this._onMove = (e) => {
                if (!this._dragging) return;
                this._yaw -= (e.clientX - this._lastX) * 0.01;
                this._pitch = clamp(this._pitch + (e.clientY - this._lastY) * 0.01, -1.3, 1.3);
                this._lastX = e.clientX; this._lastY = e.clientY;
            };
            this._onUp = () => { this._dragging = false; };
            this._onWheel = (e) => {
                this._dist = clamp(this._dist + (e.deltaY > 0 ? 1 : -1) * 1.2, 4, 26);
                e.preventDefault(); e.stopPropagation();
            };
            canvas.addEventListener('pointerdown', this._onDown);
            window.addEventListener('pointermove', this._onMove);
            window.addEventListener('pointerup', this._onUp);
            canvas.addEventListener('wheel', this._onWheel, { passive: false });
        },

        _unbindInput() {
            if (this._canvas && this._onDown) this._canvas.removeEventListener('pointerdown', this._onDown);
            if (this._onMove) window.removeEventListener('pointermove', this._onMove);
            if (this._onUp) window.removeEventListener('pointerup', this._onUp);
            if (this._canvas && this._onWheel) this._canvas.removeEventListener('wheel', this._onWheel);
            this._onDown = this._onMove = this._onUp = this._onWheel = null;
            this._dragging = false;
        },

        // Column-major lookAt view matrix for the current orbit (target = origin).
        _viewMatrix() {
            const cp = Math.cos(this._pitch), sp = Math.sin(this._pitch);
            const sy = Math.sin(this._yaw), cy = Math.cos(this._yaw);
            const ex = this._dist * cp * sy, ey = this._dist * sp, ez = this._dist * cp * cy;
            // f = normalize(center - eye) = normalize(-eye)
            let fx = -ex, fy = -ey, fz = -ez;
            const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
            // s = normalize(cross(f, up)), up = (0,1,0) -> (-fz, 0, fx)
            let sx = -fz, sy2 = 0, sz = fx;
            const sl = Math.hypot(sx, sy2, sz) || 1; sx /= sl; sy2 /= sl; sz /= sl;
            // u = cross(s, f)
            const ux = sy2 * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy2 * fx;
            return [
                sx, ux, -fx, 0,
                sy2, uy, -fy, 0,
                sz, uz, -fz, 0,
                -(sx * ex + sy2 * ey + sz * ez),
                -(ux * ex + uy * ey + uz * ez),
                (fx * ex + fy * ey + fz * ez),
                1
            ];
        },

        setAnimation(animId) {
            if (!this._ctx) return;
            const anim = (typeof $dataAnimations !== 'undefined') && $dataAnimations[animId];
            this._animId = animId;
            if (!anim || anim.frames || !anim.effectName) {
                // MV animations / empty slots have no Effekseer effect to preview.
                this._stopHandle(); this._effect = null; this._effectName = '';
                return;
            }
            const name = anim.effectName;
            if (name === this._effectName && this._effect) { this._replay(); return; }
            this._stopHandle();
            this._effect = null; this._effectName = name;
            const url = 'effects/' + Utils.encodeURI(name) + '.efkefc';
            try {
                const eff = this._ctx.loadEffect(url, 1,
                    () => { if (this._effectName === name) { this._effect = eff; this._replay(); } },
                    () => { /* load failed - viewbox just shows the character */ });
            } catch (e) { /* ignore */ }
        },

        _replay() {
            if (!this._ctx || !this._effect) return;
            this._stopHandle();
            try {
                this._handle = this._ctx.play(this._effect, 0, 0, 0);
                if (this._handle) { this._handle.setLocation(0, 0, 0); this._handle.setScale(1, 1, 1); }
            } catch (e) { this._handle = null; }
        },

        _stopHandle() {
            if (this._handle) { try { this._handle.stop(); } catch (e) {} this._handle = null; }
        },

        _startLoop() {
            const W = this._canvas.width, H = this._canvas.height;
            const size = Math.min(W, H);
            const p = -(size / H);
            const proj = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, p, 0, 0, 0, 1];
            const vx = Math.floor((W - size) / 2), vy = Math.floor((H - size) / 2);
            const loop = () => {
                if (this._dead) return;
                this._rafId = requestAnimationFrame(loop);
                const gl = this._gl, ctx = this._ctx;
                if (!gl || !ctx) return;
                try {
                    gl.clearColor(0, 0, 0, 0);
                    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    gl.viewport(vx, vy, size, size);
                    ctx.setProjectionMatrix(proj);
                    // Recompute the camera each frame so live drag/zoom is reflected.
                    ctx.setCameraMatrix(this._viewMatrix());
                    ctx.update();
                    if (this._handle && !this._handle.exists && this._effect) this._replay();
                    ctx.beginDraw();
                    if (this._handle) ctx.drawHandle(this._handle);
                    ctx.endDraw();
                } catch (e) {
                    // On any GL error, retire the preview rather than spamming.
                    this._dead = true;
                }
            };
            this._rafId = requestAnimationFrame(loop);
        },

        dispose() {
            this._dead = true;
            this._unbindInput();
            if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
            this._stopHandle();
            // Free the standalone GL context so repeated open/close never exhausts
            // the browser's WebGL context budget.
            if (this._gl) {
                try {
                    const ext = this._gl.getExtension('WEBGL_lose_context');
                    if (ext) ext.loseContext();
                } catch (e) {}
            }
            this._effect = null; this._effectName = '';
            this._ctx = null; this._gl = null; this._canvas = null;
        }
    };

    //=============================================================================
    // Utility Functions
    //=============================================================================

    // Only the categories the pupil's class studies (its primary and secondary
    // schools) are browsable; a class with no table in Categories.json sees the
    // whole book, so the menu is never empty.
    function getAllSkillCategories() {
        const allowed = actorCategoryManager.allowedCategories();
        const categories = new Set();
        categories.add("All");   // i18n-ignore: category id

        // A school whose every skill is of the wrong nature for this world has
        // nothing left to teach, so it is not a school here at all: it leaves
        // the tab list and the atlas rather than opening onto a blank seal.
        const MN = window.MagicNature;
        const filterNature = !!(MN && MN.isFiltering());

        for (const skill of $dataSkills) {
            if (!skill) continue;
            if (skill._customSpell) continue;   // the Fusion school is added below, per pupil
            if (filterNature && !MN.allowsData(skill)) continue;
            const categoryMatch = skill.note.match(/<category:(.+?)>/i);
            if (categoryMatch) {
                if (allowed && !allowed.includes(categoryMatch[1].trim())) continue;
                categories.add(categoryMatch[1]);
            }
        }
        // A pupil who has forged anything gets their own school for it, whatever
        // their class studies.
        if (getSkillsByCategory(FUSION_CATEGORY).length) categories.add(FUSION_CATEGORY);

        return Array.from(categories);
    }

    // Reads the "type" field ("Skill" or "Magic") from Categories.json.
    // "All" and any category missing from the JSON default to "Skill".
    function getCategoryType(category) {
        if (category === 'All') return 'Skill';   // i18n-ignore: category id
        const data = CATEGORY_DATA[category];
        return (data && data.type === 'Magic') ? 'Magic' : 'Skill';   // i18n-ignore: category id
    }

    // Splits the active categories into two alphabetically-sorted columns:
    //   Skill  -> left page (with "All" pinned to the top)
    //   Magic  -> right page
    function getSplitSkillCategories() {
        const all = getAllSkillCategories();
        const skills = [];
        const magic = [];
        for (const cat of all) {
            if (cat === 'All') continue;   // i18n-ignore: category id
            if (getCategoryType(cat) === 'Magic') magic.push(cat);   // i18n-ignore: category id
            else skills.push(cat);
        }
        const byName = (a, b) => getCategoryDisplayName(a).localeCompare(getCategoryDisplayName(b));
        skills.sort(byName);
        magic.sort(byName);
        skills.unshift('All');   // i18n-ignore: category id
        return { Skill: skills, Magic: magic };   // i18n-ignore: category id
    }

    function getSkillsByCategory(category) {
        // The maker's own school: only the focused pupil's fusions, and they are
        // the one place a <customSpell> is ever listed.
        if (category === FUSION_CATEGORY) {
            const actorId = (SceneManager._scene && SceneManager._scene._teachActorId) || 0;
            return $gameSystem.getCustomSpells()
                .filter(s => s && s.name && s._ownerActorId === actorId)
                .map(s => $dataSkills[s.id] || s)
                .filter(Boolean);
        }
        const skills = [];
        // Build the category regex once per query instead of once per skill.
        const catRegex = category === "All" ? null : new RegExp(`<category:${category}>`, 'i');
        // "All" is the pupil's whole curriculum, not the whole book: it holds the
        // skills of every school their class studies and nothing outside them.
        const allowed = catRegex ? null : actorCategoryManager.allowedCategories();

        // How much magic this world has (window.MagicNature). A severed world
        // never learned the magical half of the book and an unbound one never
        // needed the mundane half: the skill is not on the seal at all, so the
        // atlas is redrawn around what is left rather than showing a node
        // nobody can ever buy. A skill a character already KNOWS is untouched.
        const MN = window.MagicNature;
        const filterNature = !!(MN && MN.isFiltering());

        for (const skill of $dataSkills) {
            if (!skill || !skill.name || skill.name.startsWith('<--')) continue;
            if (skill._customSpell) continue; // fused spells never appear in the browse list
            if (filterNature && !MN.allowsData(skill)) continue;

            if (catRegex) {
                if (catRegex.test(skill.note)) skills.push(skill);
                continue;
            }
            if (allowed) {
                const match = skill.note.match(/<category:(.+?)>/i);
                if (!match || !allowed.includes(match[1].trim())) continue;
            }
            skills.push(skill);
        }

        return skills;
    }

    //=============================================================================
    // Skill graph - what a school is made of
    //
    // A category is not a list, it is a map. Where each skill sits and what it
    // borders is authored into the noteboxes by tools/skills/gen_skill_graph.py:
    //
    //     <Node: tier,branch>    tier is its ring, branch its ray; 0 is the heart
    //     <Link: 12,45,78>       the skills it is adjacent to (same category)
    //
    // A pupil may only buy what they are standing next to. ONE known neighbour
    // is enough: links are alternative ways in, never joint requirements, which
    // is the whole rule of the circle. Tier 0 is always open, so a pupil who knows
    // nothing at all still has a way in, and a skill on no circle at all
    // (a fused spell, an uncategorised leftover) is never blocked by one.
    //
    // Links are stored on both endpoints and read as symmetric anyway, so a
    // hand-edited notebox that names only one side still works.
    //=============================================================================

    const NODE_RE = /<Node:\s*(\d+)\s*,\s*(\d+)\s*>/i;
    const LINK_RE = /<Link:\s*([\d,\s]*)>/i;
    // The maker's own school: every spell a pupil has forged, and nothing
    // else. Drawn per pupil, so two characters never see each other's work.
    const FUSION_CATEGORY = 'Fusion';   // i18n-ignore: category id

    const SkillGraph = {
        _nodes: null,        // skillId -> { tier, branch, category }
        _links: null,        // skillId -> [skillId, ...] (symmetric)
        _graphs: null,       // category -> laid-out graph, built on demand

        // One pass over $dataSkills; the tags never change at runtime.
        _build: function () {
            if (this._nodes) return;
            this._nodes = {};
            this._links = {};
            this._graphs = {};
            for (const skill of $dataSkills) {
                if (!skill || !skill.note) continue;
                const node = skill.note.match(NODE_RE);
                if (!node) continue;
                this._nodes[skill.id] = {
                    tier: parseInt(node[1], 10),
                    branch: parseInt(node[2], 10),
                    category: getSkillCategory(skill.id)
                };
                const link = skill.note.match(LINK_RE);
                if (!link) continue;
                for (const part of link[1].split(',')) {
                    const other = parseInt(part.trim(), 10);
                    if (!other || other === skill.id) continue;
                    (this._links[skill.id] = this._links[skill.id] || []).push(other);
                    (this._links[other] = this._links[other] || []).push(skill.id);
                }
            }
            for (const id of Object.keys(this._links)) {
                this._links[id] = Array.from(new Set(this._links[id]));
            }
        },

        node: function (skillId) {
            this._build();
            return this._nodes[skillId] || null;
        },

        links: function (skillId) {
            this._build();
            return this._links[skillId] || [];
        },

        // A forbidden working sits in the heart of the figure joined to nothing:
        // no path reaches it, and it opens only once the whole school around it
        // is known. Then any one of them may be taken first.
        isForbidden: function (skillId) {
            const skill = $dataSkills[skillId];
            return !!(skill && /<Forbidden>/i.test(skill.note || ''));
        },

        // The school's forbidden core, and the skills that must be finished
        // before it opens. Cached per category: neither list ever changes.
        _core: {},
        core: function (category) {
            if (this._core[category]) return this._core[category];
            const inner = [], outer = [];
            for (const skill of $dataSkills) {
                if (!skill || !skill.name || skill.name.startsWith('<--')) continue;
                if (getSkillCategory(skill.id) !== category) continue;
                (this.isForbidden(skill.id) ? inner : outer).push(skill.id);
            }
            const entry = { forbidden: inner, school: outer };
            this._core[category] = entry;
            return entry;
        },

        // Has this pupil finished everything the school teaches short of its
        // forbidden core?
        schoolMastered: function (actor, category) {
            if (!actor || !category) return false;
            const school = this.core(category).school;
            return school.length > 0 && school.every(id => actor.isLearnedSkill(id));
        },

        // A skill nobody has to walk to: the grid's entrance, or a skill that was
        // never put on a grid in the first place. The entrance is the innermost
        // ring the SCHOOL occupies, which is ring 1 wherever a forbidden core
        // holds ring 0.
        isEntry: function (skillId) {
            const node = this.node(skillId);
            if (!node) return true;
            if (this.isForbidden(skillId)) return false;
            const category = getSkillCategory(skillId);
            if (!category) return node.tier === 0;
            const floor = this._entryTier(category);
            return node.tier === floor;
        },

        _entryTiers: {},
        _entryTier: function (category) {
            if (this._entryTiers[category] !== undefined) return this._entryTiers[category];
            let floor = Infinity;
            for (const id of this.core(category).school) {
                const node = this.node(id);
                if (node && node.tier < floor) floor = node.tier;
            }
            if (!isFinite(floor)) floor = 0;
            this._entryTiers[category] = floor;
            return floor;
        },

        // Can this pupil buy it right now? Known skills are not "open" (there is
        // nothing left to buy), which is what the UI colours them by.
        //
        // A school outside the pupil's curriculum has no entrance: they got in
        // through the one skill they already know and may only walk outward
        // from it, so the free tier-0 entry does not apply there.
        isOpen: function (actor, skillId) {
            if (!actor || actor.isLearnedSkill(skillId)) return false;
            // Sandbox play (and a party led by "test") is a workshop: the whole
            // book is open in any order, so the grid never blocks anything.
            if (isWorkshopMode()) return true;
            // the price badge and this gate have to be reading the same pupil
            if (actor.actorId) actorCategoryManager.setActor(actor.actorId());
            const category = getSkillCategory(skillId);
            // The core is walled off: finish the school and every one of them
            // opens at once, in any order.
            if (this.isForbidden(skillId)) return this.schoolMastered(actor, category);
            const foreign = actorCategoryManager.isForeign(category);
            if (!foreign && this.isEntry(skillId)) return true;
            return this.links(skillId).some(id => actor.isLearnedSkill(id));
        },

        // The skills that would open this one, for the "you are not next to it
        // yet" line on the right page. A forbidden working is opened by the
        // school itself, so it answers with what is still missing from it.
        openers: function (skillId, actor) {
            if (this.isForbidden(skillId)) {
                const school = this.core(getSkillCategory(skillId)).school;
                return school
                    .filter(id => !(actor && actor.isLearnedSkill(id)))
                    .map(id => $dataSkills[id])
                    .filter(s => s && s.name)
                    .slice(0, 8);
            }
            return this.links(skillId)
                .map(id => $dataSkills[id])
                .filter(s => s && s.name);
        },

        // Nodes and edges of one category, laid out on the (tier, branch) grid.
        // Cached: the shape is static, only the pupil's colours change.
        invalidate: function () {
            this._nodes = null;
            this._links = null;
            this._graphs = null;
            this._core = {};
            this._entryTiers = {};
        },

        graph: function (category) {
            this._build();
            // The Fusion plate belongs to one pupil, so it is cached per pupil.
            const key = category === FUSION_CATEGORY
                ? `${category}:${$gameParty && SceneManager._scene && SceneManager._scene._teachActorId || 0}`
                : category;
            if (this._graphs[key]) return this._graphs[key];

            const nodes = [];
            for (const skill of getSkillsByCategory(category)) {
                const node = this._nodes[skill.id];
                if (!node) continue;
                nodes.push({ id: skill.id, skill: skill, tier: node.tier, branch: node.branch });
            }
            nodes.sort((a, b) => (a.tier - b.tier) || (a.branch - b.branch) || (a.id - b.id));

            const placed = {};
            for (const n of nodes) placed[n.id] = n;

            // Every edge once, and only between two nodes actually on this grid.
            const seen = {};
            const edges = [];
            for (const n of nodes) {
                for (const other of this.links(n.id)) {
                    if (!placed[other]) continue;
                    const key = n.id < other ? `${n.id}:${other}` : `${other}:${n.id}`;
                    if (seen[key]) continue;
                    seen[key] = true;
                    edges.push([n, placed[other]]);
                }
            }

            let tiers = 0, branches = 0;
            for (const n of nodes) {
                tiers = Math.max(tiers, n.tier + 1);
                branches = Math.max(branches, n.branch + 1);
            }
            this._graphs[key] = { nodes: nodes, edges: edges, tiers: tiers, branches: branches };
            return this._graphs[key];
        }
    };

    window.SkillGraph = SkillGraph;

    //=============================================================================
    // The atlas of circles
    //
    // A school is not a lattice of columns, it is an ALCHEMICAL CIRCLE laid out
    // as a sphere grid: ring inside ring around a heart. Every ring is a tier of
    // the grid and every lane a bearing, so a skill keeps the same bearing on
    // every ring it appears on and a spoke always runs outward along a lane. The
    // heart is the school's forbidden core where it has one, and its innermost
    // ordinary ring where it does not.
    //
    // ONE school is drawn at a time, alone on the page: a circle is a figure to be
    // read whole, and six of them crowded into one field is a field, not a
    // figure. The school being read is changed with the pager on the header bar
    // or by walking off the rim of the circle, and every school keeps its own zoom
    // and its own cursor, so leaving one and coming back is not starting over.
    // The line-work around each circle (the rules, the tier rings, the lane
    // guides and the squared circle at its heart) is the same alchemical figure
    // for every school; what tells two schools apart is the shape of their grid.
    //=============================================================================

    const TAU = Math.PI * 2;

    const CIRCLE_NODE = 42;        // node diameter
    const CIRCLE_MIN_ARC = 118;    // closest two skills may come on one ring
    const CIRCLE_RING_STEP = 116;  // distance between two rings, on a shallow school
    const CIRCLE_RING_STEP_MIN = 86;  // ... and on a deep one, which packs tighter
    const CIRCLE_RING_EASY = 12;   // tiers a school may have before it starts packing
    const CIRCLE_R0 = 132;         // the first ring, when the heart holds one skill
    const CIRCLE_MARGIN = 104;     // ink and name banner outside the outermost ring
    const CIRCLE_LABEL_W = 106;    // width a skill's name is allowed
    const CIRCLE_BANNER_ROOM = 70; // room under the figure for the school's banner
    const ATLAS_PAD = 90;        // clear air around the circle on its own page
    const ATLAS_LEGEND_H = 156;  // header bar + school pager + legend row above it
    const ATLAS_ZOOM_MIN = 0.08;   // far enough back to hold the deepest circle whole
    const ATLAS_ZOOM_MAX = 1.6;
    const ATLAS_WHEEL_STEP = 1.05;  // one notch of the wheel
    const ATLAS_ZOOM_STEP = 1.07;  // one notch, as a factor: small, so the wheel is a nudge
    const ATLAS_READ_ZOOM = 0.66;  // the smallest a name is still worth reading at
    const ATLAS_LABEL_MAX = 2.6;   // most a name may be grown back by
    const ATLAS_ICON_SHARE = 0.55; // an icon takes this share of the name's growth
    const ATLAS_FAR_ZOOM = 0.42;   // below this the names come off and the circles stand alone

    const SkillAtlas = {
        _atlas: null,
        _key: null,

        // One stable number per school name: the circle's figure, its phase and its
        // terminals are all drawn from it.
        _hash: function (str) {
            let h = 2166136261;
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return h >>> 0;
        },

        // One school, on a page of its own. Cached on that school: the geometry
        // is static, only the pupil's colours change and those are painted on
        // top of it. An array is still accepted, since a caller holding a whole
        // curriculum means "draw the first of these".
        build: function (category) {
            const name = Array.isArray(category) ? category[0] : category;
            // The magic level is part of the key: a severed and an unbound
            // world draw DIFFERENT seals for the same school (the skills of
            // the wrong nature are not on it), and this cache outlives a world
            // switch inside one session.
            const MN = window.MagicNature;
            const key = String(name || '') + '|' + ((MN && MN.level && MN.level()) || 'normal');
            if (this._atlas && this._key === key) return this._atlas;
            const circle = name ? this._circle(name) : null;
            const atlas = this._frame(circle && circle.nodes.length ? circle : null);
            atlas.index = {};
            for (const s of atlas.circles) {
                for (const node of s.nodes) atlas.index[node.id] = node;
            }
            // Consumers compare atlas.category to a plain school name, so the
            // cache suffix stays out of it.
            atlas.category = String(name || '');
            atlas.key = key;
            this._key = key;
            this._atlas = atlas;
            return atlas;
        },

        invalidate: function () {
            this._atlas = null;
            this._key = null;
        },

        // One school, laid out as concentric rings around its heart. A ring is
        // pushed out until no two skills on it come closer than CIRCLE_MIN_ARC, so
        // a crowded tier makes a wider ring rather than a tangle.
        _circle: function (category) {
            const graph = SkillGraph.graph(category);
            if (!graph || !graph.nodes.length) return null;
            const seed = this._hash(category);

            const branchValues = Array.from(new Set(graph.nodes.map(n => n.branch))).sort((a, b) => a - b);
            const rayOf = {};
            branchValues.forEach((b, i) => { rayOf[b] = i; });
            const rays = Math.max(1, branchValues.length);
            const rayStep = TAU / rays;
            // North, turned a little off true by the school's own name, so two
            // circles side by side are never the same figure twice.
            const phase = -Math.PI / 2 + (seed % 17) / 17 * rayStep;

            const tiers = Array.from(new Set(graph.nodes.map(n => n.tier))).sort((a, b) => a - b);
            // A school of twenty tiers drawn at a shallow school's spacing would
            // be a circle nobody could hold on the page, so a deep one packs its
            // rings tighter, down to a floor that still clears a name.
            const ringStep = Math.max(CIRCLE_RING_STEP_MIN,
                CIRCLE_RING_STEP * Math.min(1, CIRCLE_RING_EASY / Math.max(1, tiers.length)));
            const nodes = [];
            const rings = [];
            let prev = -1;
            let outermost = 0;

            tiers.forEach((tier, rank) => {
                const ring = graph.nodes.filter(n => n.tier === tier)
                    .sort((a, b) => rayOf[a.branch] - rayOf[b.branch] || a.id - b.id);
                const angles = ring.map(n => phase + rayStep * rayOf[n.branch]);
                // Two skills authored onto the same ray of the same ring would sit
                // one on top of the other; step the later one part of a ray over.
                for (let i = 1; i < angles.length; i++) {
                    if (Math.abs(angles[i] - angles[i - 1]) < 1e-6) angles[i] += rayStep * 0.44;
                }

                let r;
                if (rank === 0 && ring.length === 1) {
                    r = 0;                                  // the heart itself
                } else {
                    let tightest = TAU;
                    if (angles.length > 1) {
                        const sorted = angles.slice().sort((a, b) => a - b);
                        for (let i = 0; i < sorted.length; i++) {
                            const d = (i === sorted.length - 1)
                                ? sorted[0] + TAU - sorted[i]
                                : sorted[i + 1] - sorted[i];
                            if (d > 1e-6) tightest = Math.min(tightest, d);
                        }
                    }
                    const spread = angles.length > 1 ? CIRCLE_MIN_ARC / tightest : CIRCLE_R0;
                    r = Math.max(spread, prev > 0 ? prev + ringStep : CIRCLE_R0);
                }

                ring.forEach((n, i) => {
                    const a = angles[i];
                    nodes.push({
                        id: n.id, skill: n.skill, category: category,
                        tier: n.tier, branch: n.branch, ring: rank,
                        angle: a, radius: r,
                        x: Math.cos(a) * r, y: Math.sin(a) * r,
                        ax: 0, ay: 0
                    });
                });
                if (r > 0) rings.push(r);
                prev = r;
                outermost = Math.max(outermost, r);
            });

            const byId = {};
            for (const n of nodes) byId[n.id] = n;
            const edges = [];
            for (const [a, b] of graph.edges) {
                if (byId[a.id] && byId[b.id]) edges.push([byId[a.id], byId[b.id]]);
            }

            const outer = outermost + 46;
            return {
                category: category,
                nodes: nodes, edges: edges,
                rings: rings, rays: rays, rayStep: rayStep, phase: phase, seed: seed,
                inner: Math.min(outer * 0.5, rings.length ? rings[0] * 0.46 : CIRCLE_R0 * 0.46),
                outer: outer,
                radius: outermost + CIRCLE_MARGIN,
                cx: 0, cy: 0
            };
        },

        // The circle, centred on a page cut to fit it and nothing else. The room
        // below is a little deeper than the room above: the school's banner is
        // written under the figure and must not be cropped off the page.
        _frame: function (circle) {
            if (!circle) return { circles: [], width: 0, height: 0 };
            const size = circle.radius * 2;
            const width = Math.round(size + ATLAS_PAD * 2);
            const height = Math.round(size + ATLAS_PAD * 2 + CIRCLE_BANNER_ROOM);
            circle.cx = width / 2;
            circle.cy = ATLAS_PAD + circle.radius;
            for (const n of circle.nodes) {
                n.ax = circle.cx + n.x;
                n.ay = circle.cy + n.y;
            }
            return { circles: [circle], width: width, height: height };
        },

        // The plate's edge, and nothing else. Every line drawn across this page
        // is a link between two skills: tier rings, lane guides and the figure
        // at the heart were decoration, and decoration crossing the graph reads
        // as part of it.
        glyph: function (circle) {
            const cx = circle.cx.toFixed(1), cy = circle.cy.toFixed(1);
            const ring = (r, w, op) =>
                `<circle cx="${cx}" cy="${cy}" r="${Math.max(1, r).toFixed(1)}" fill="none" stroke-width="${w}" stroke-opacity="${op}" />`;
            return `<g class="sg-circle" data-circle="${circle.category}" fill="none" stroke="currentColor">`
                + ring(circle.outer, 2.2, 0.85) + ring(circle.outer - 10, 1.1, 0.5) + `</g>`;
        }
    };

    window.SkillAtlas = SkillAtlas;

    //=============================================================================
    // Window_SkillCategory - Grid Layout
    //=============================================================================

    function Window_SkillCategory() {
        this.initialize(...arguments);
    }

    Window_SkillCategory.prototype = Object.create(Window_Command.prototype);
    Window_SkillCategory.prototype.constructor = Window_SkillCategory;

    Window_SkillCategory.prototype.initialize = function (rect) {
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_SkillCategory.prototype.maxCols = function () {
        return 4;
    };

    Window_SkillCategory.prototype.itemHeight = function () {
        return 110;
    };

    Window_SkillCategory.prototype.makeCommandList = function () {
        actorCategoryManager.initialize();
        const categories = getAllSkillCategories();
        for (const category of categories) {
            let commandName = getCategoryDisplayName(category);
            if (category !== "All") {   // i18n-ignore: category id
                if (actorCategoryManager.isPrimary(category)) {
                    commandName += " (3x)";
                } else if (actorCategoryManager.isSecondary(category)) {
                    commandName += " (1.5x)";
                } else if (actorCategoryManager.isForeign(category)) {
                    commandName += ` (${T('SkillMaster.foreignSchool')})`;
                }
            }
            const icon = getCategoryIcon(category);
            this.addCommand(commandName, 'category', true, { category: category, icon: icon });
        }
    };

    Window_SkillCategory.prototype.drawItem = function (index) {
        const rect = this.itemRect(index);
        const data = this.commandData(index);

        // Highlight category if any party member knows at least one skill from it
        const members = $gameParty.members();
        let isSelectedCategory = false;
        const categorySkills = getSkillsByCategory(data.ext ? data.ext.category : "All");   // i18n-ignore: category id
        for (const actor of members) {
            if (categorySkills.some(s => actor.isLearnedSkill(s.id))) {
                isSelectedCategory = true;
                break;
            }
        }

        const icon = data && data.ext && data.ext.icon ? data.ext.icon : 245;
        const iconSize = ImageManager.iconWidth; // 32
        const iconX = rect.x + Math.floor((rect.width - iconSize) / 2);
        const iconY = rect.y + 18;

        if (isSelectedCategory) {
            this.changeTextColor(ColorManager.textColor(1));
        } else {
            this.resetTextColor();
        }

        this.drawIcon(icon, iconX, iconY);
        this.contents.fontSize = 18;
        this.drawText(data.name, rect.x, rect.y + 18 + iconSize + 10, rect.width, 'center');
        this.contents.fontSize = $gameSystem.mainFontSize();
        this.resetTextColor();
    };

    Window_SkillCategory.prototype.commandData = function (index) {
        return this._list[index];
    };

    Window_SkillCategory.prototype.currentCategory = function () {
        const ext = this.currentExt();
        if (ext && ext.category) {
            return ext.category;
        }
        return this.currentData() ? this.currentData().name : "All";   // i18n-ignore: category id
    };

    //=============================================================================
    // Window_SkillMasterList
    //=============================================================================

    function Window_SkillMasterList() {
        this.initialize(...arguments);
    }

    Window_SkillMasterList.prototype = Object.create(Window_Selectable.prototype);
    Window_SkillMasterList.prototype.constructor = Window_SkillMasterList;

    Window_SkillMasterList.prototype.initialize = function (rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._category = "All";   // i18n-ignore: category id
        this._data = [];
        this.refresh();
    };

    Window_SkillMasterList.prototype.maxCols = function () {
        return 2;
    };

    Window_SkillMasterList.prototype.maxItems = function () {
        return this._data ? this._data.length : 0;
    };

    Window_SkillMasterList.prototype.setCategory = function (category) {
        if (this._category !== category) {
            this._category = category;
            this.refresh();
            this.scrollTo(0, 0);
            this.select(0);
        }
    };

    Window_SkillMasterList.prototype.currentSkill = function () {
        return this._data && this.index() >= 0 ? this._data[this.index()] : null;
    };

    Window_SkillMasterList.prototype.selectSkillById = function (skillId) {
        for (let i = 0; i < this._data.length; i++) {
            if (this._data[i] && this._data[i].id === skillId) {
                this.select(i);
                this.scrollTo(0, Math.max(0, (i - 4) * this.itemHeight()));
                return true;
            }
        }
        return false;
    };

    Window_SkillMasterList.prototype.refresh = function () {
        this._data = getSkillsByCategory(this._category);
        this.createContents();
        this.drawAllItems();
    };

    Window_SkillMasterList.prototype.drawItem = function (index) {
        const skill = this._data[index];
        if (skill) {
            const rect = this.itemLineRect(index);
            // Green if any party member already knows this skill
            const isLearned = $gameParty.members().some(a => a.isLearnedSkill(skill.id));
            if (isLearned) {
                this.changeTextColor(ColorManager.textColor(3));
            } else {
                this.resetTextColor();
            }

            this.drawItemName(skill, rect.x, rect.y, rect.width);
            this.resetTextColor();
        }
    };

    Window_SkillMasterList.prototype.drawItemName = function (skill, x, y, width) {
        if (skill) {
            const iconBoxWidth = ImageManager.iconWidth + 4;
            this.drawIcon(skill.iconIndex, x, y + 2);

            let skillName = skill.name;
            if (skillName.length > 20) {
                skillName = skillName.substring(0, 20) + "...";
            }

            this.drawText(skillName, x + iconBoxWidth, y, width - iconBoxWidth);
        }
    };

    //=============================================================================
    // Window_SkillDetail
    //=============================================================================

    function Window_SkillDetail() {
        this.initialize(...arguments);
    }

    Window_SkillDetail.prototype = Object.create(Window_Selectable.prototype);
    Window_SkillDetail.prototype.constructor = Window_SkillDetail;

    Window_SkillDetail.prototype.initialize = function (rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._skill = null;
        this._showMessage = false;
        this._messageTimer = 0;
        this._messageText = "";
        this._actions = [];
        this.refresh();
    };

    Window_SkillDetail.prototype.maxItems = function () {
        return this._actions.length;
    };

    Window_SkillDetail.prototype.setSkill = function (skill) {
        if (this._skill !== skill) {
            this._skill = skill;
            this._showMessage = false;
            this._messageTimer = 0;
            this.buildActions();
            this.refresh();
            this.select(0);
        }
    };

    Window_SkillDetail.prototype.buildActions = function () {
        this._actions = [];
        if (!this._skill) return;

        const knowledge = $gameSystem.getKnowledge();

        // One "Learn" action per party member who doesn't already know the skill
        for (const actor of $gameParty.members()) {
            const actorId = actor.actorId();
            if (actor.isLearnedSkill(this._skill.id)) continue;
            const cost = $gameSystem.getSkillKnowledgeCost(this._skill.id, actorId);
            const canAfford = knowledge >= cost;
            this._actions.push({
                name: T('SkillMaster.teachActor', { actor: actor.name(), cost: cost }),
                symbol: 'learn',
                enabled: canAfford,
                actorId: actorId,
                cost: cost
            });
        }
    };

    Window_SkillDetail.prototype.currentAction = function () {
        return this._actions[this.index()];
    };

    Window_SkillDetail.prototype.showMessage = function (text) {
        this._showMessage = true;
        this._messageText = text;
        this._messageTimer = 120;
        this.refresh();
    };

    Window_SkillDetail.prototype.update = function () {
        Window_Selectable.prototype.update.call(this);

        if (this._showMessage && this._messageTimer > 0) {
            this._messageTimer--;
            if (this._messageTimer === 0) {
                this._showMessage = false;
                this.refresh();
            }
        }
    };

    Window_SkillDetail.prototype.itemRect = function (index) {
        const rect = Window_Selectable.prototype.itemRect.call(this, index);
        const baseY = this.contentsHeight() - (this._actions.length * this.lineHeight()) - 60;
        rect.y = baseY + (index * this.lineHeight());
        return rect;
    };

    Window_SkillDetail.prototype.refresh = function () {
        this.contents.clear();
        if (!this._skill) {
            const text = T('SkillMaster.selectSkillForDetails');
            this.drawText(text, 0, this.contentsHeight() / 2 - this.lineHeight(), this.contentsWidth(), "center");
            return;
        }

        const padding = 20;
        const halfWidth = (this.contentsWidth() - padding * 3) / 2;
        let leftY = padding;
        let rightY = padding;

        // LEFT COLUMN
        this.contents.fontSize = 32;
        this.drawIcon(this._skill.iconIndex || 0, padding, leftY);
        this.drawText(this._skill.name || T('SkillMaster.unknownSkill'), padding + ImageManager.iconWidth + 8, leftY, halfWidth - ImageManager.iconWidth - 8, "left");
        this.resetFontSize();
        leftY += 42;

        // Show message if any
        if (this._showMessage) {
            this.changeTextColor(ColorManager.textColor(14));
            this.drawText("✓ " + this._messageText, padding, leftY, halfWidth);
            this.resetTextColor();
            leftY += this.lineHeight();
        }

        leftY += 8;
        this.drawHorzLine(leftY, padding, halfWidth);
        leftY += 15;

        // Costs
        this.contents.fontSize = 24;
        if (this._skill.mpCost > 0) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(T('SkillMaster.mpLabel'), padding, leftY, 80);
            this.resetTextColor();
            this.drawText(this._skill.mpCost, padding + 80, leftY, halfWidth - 80, "right");
            leftY += this.lineHeight();
        }

        if (this._skill.tpCost > 0) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(T('SkillMaster.apLabel'), padding, leftY, 80);
            this.resetTextColor();
            this.drawText(this._skill.tpCost, padding + 80, leftY, halfWidth - 80, "right");
            leftY += this.lineHeight();
        }
        this.resetFontSize();

        leftY += 10;
        this.drawHorzLine(leftY, padding, halfWidth);
        leftY += 20;

        // Scale
        if (this._skill.damage && this._skill.damage.formula) {
            const isItalian = ConfigManager.language === 'it';
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(T('SkillMaster.scale'), padding, leftY, halfWidth);
            this.resetTextColor();
            leftY += this.lineHeight();

            const scaleText = this.getSimplifiedFormula(this._skill.damage.formula, isItalian);
            this.contents.fontSize = 28;
            this.drawText(scaleText, padding + 20, leftY, halfWidth - 20);
            this.resetFontSize();
            leftY += this.lineHeight() + 10;
        }

        // Effect
        const damageText = this.getDamageTypeText(this._skill);
        if (damageText) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(T('SkillMaster.effectLabel'), padding, leftY, halfWidth);
            this.resetTextColor();
            leftY += this.lineHeight();

            const wrappedLines = this.wrapText(damageText, halfWidth - 20);
            for (let i = 0; i < wrappedLines.length; i++) {
                this.drawText(wrappedLines[i], padding + 20, leftY, halfWidth - 20);
                leftY += this.lineHeight();
            }
        }

        // RIGHT COLUMN
        const rightX = padding * 2 + halfWidth;

        // Description
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(T('SkillMaster.descriptionLabel'), rightX, rightY, halfWidth);
        this.resetTextColor();
        rightY += this.lineHeight();

        this.drawHorzLine(rightY, rightX, halfWidth);
        rightY += 10;

        let description = this._skill.description || T('SkillMaster.noDescription');
        if (window.translateText) {
            description = window.translateText(description);
        }

        this.resetTextColor();
        const descLines = this.wrapText(description, halfWidth - 10);
        for (let i = 0; i < descLines.length; i++) {
            this.drawText(descLines[i], rightX, rightY, halfWidth);
            rightY += this.lineHeight();
        }
        rightY += 10;

        // Knowledge balance
        this.drawHorzLine(rightY, rightX, halfWidth);
        rightY += 10;

        const knowledge = $gameSystem.getKnowledge();
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(T('SkillMaster.knowledgeLabel'), rightX, rightY, halfWidth * 0.6);
        this.resetTextColor();
        this.changeTextColor(ColorManager.textColor(knowledge > 0 ? 3 : 7));
        this.contents.fontSize = 22;
        this.drawText(`${knowledge} KP`, rightX + halfWidth * 0.6, rightY, halfWidth * 0.4, 'right');
        this.resetFontSize();
        this.resetTextColor();
        rightY += this.lineHeight() + 6;

        // Per-actor status
        for (const actor of $gameParty.members()) {
            const hasSkill = actor.isLearnedSkill(this._skill.id);
            const cost = $gameSystem.getSkillKnowledgeCost(this._skill.id, actor.actorId());

            this.contents.fontSize = 20;
            if (hasSkill) {
                this.changeTextColor(ColorManager.textColor(3));
                this.drawText(actor.name() + " ✓", rightX, rightY, halfWidth);
            } else {
                this.resetTextColor();
                this.drawText(actor.name(), rightX, rightY, halfWidth * 0.55);
                this.changeTextColor(knowledge >= cost ? ColorManager.textColor(1) : ColorManager.textColor(7));
                this.drawText(`${cost} KP`, rightX + halfWidth * 0.55, rightY, halfWidth * 0.45, 'right');
            }
            this.resetTextColor();
            this.resetFontSize();
            rightY += 24;
        }

        // Draw actions at bottom
        this.drawAllItems();
    };

    Window_SkillDetail.prototype.drawItem = function (index) {
        const action = this._actions[index];
        if (!action) return;

        const rect = this.itemRect(index);
        const isSelected = this.index() === index;

        if (isSelected) {
            this.contents.fillRect(rect.x, rect.y, rect.width, rect.height, ColorManager.itemBackColor1());
        }

        this.resetTextColor();
        if (!action.enabled) {
            this.changeTextColor(ColorManager.dimColor1());
        }

        this.drawText("▶ " + action.name, rect.x + 10, rect.y, rect.width - 10);
        this.resetTextColor();
    };

    Window_SkillDetail.prototype.wrapText = function (text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
            const testWidth = this.textWidth(testLine);

            if (testWidth > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = words[i];
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    };

    Window_SkillDetail.prototype.getSimplifiedFormula = function (formula, isItalian) {
        const statNames = {
            'a.atk': _si18n("ATT"),
            'a.def': _si18n("DEF"),
            'a.agi': _si18n("AGILITY"),
            'a.mat': _si18n("M.ATT"),
            'a.mdf': _si18n("M.DEF"),
            'a.luk': _si18n("LUCK")
        };

        let mainStat = null;
        let maxMultiplier = 0;

        for (const [stat, name] of Object.entries(statNames)) {
            const regex = new RegExp(stat.replace('.', '\\.') + '\\s*\\*\\s*([\\d.]+)', 'i');
            const match = formula.match(regex);

            if (match) {
                const multiplier = parseFloat(match[1]);
                if (multiplier > maxMultiplier) {
                    maxMultiplier = multiplier;
                    mainStat = name;
                }
            } else if (formula.includes(stat)) {
                if (maxMultiplier === 0) {
                    mainStat = name;
                }
            }
        }

        if (!mainStat) return formula;

        let grade = 'F';
        if (maxMultiplier === 0) {
            grade = 'F';
        } else if (maxMultiplier < 1) {
            grade = 'F';
        } else if (maxMultiplier < 2) {
            grade = 'E';
        } else if (maxMultiplier < 3) {
            grade = 'D';
        } else if (maxMultiplier < 5) {
            grade = 'C';
        } else if (maxMultiplier < 7) {
            grade = 'B';
        } else if (maxMultiplier < 9) {
            grade = 'A';
        } else {
            grade = 'S';
        }

        return `${mainStat} (${grade})`;
    };

    Window_SkillDetail.prototype.getDamageTypeText = function (skill) {
        const isItalian = ConfigManager.language === 'it';
        const damage = skill.damage;
        let text = "";

        if (damage.type === 1) {
            text = T('SkillMaster.hpDamage');
        } else if (damage.type === 2) {
            text = T('SkillMaster.mpDamage');
        } else if (damage.type === 3) {
            text = T('SkillMaster.hpRecovery');
        } else if (damage.type === 4) {
            text = T('SkillMaster.mpRecovery');
        } else if (damage.type === 5) {
            text = T('SkillMaster.hpDrain');
        } else if (damage.type === 6) {
            text = T('SkillMaster.mpDrain');
        }

        if (damage.variance > 0 && text) {
            text += ` (±${damage.variance}%)`;
        }

        const effects = skill.effects;
        const buffEffects = effects.filter(e => e.code === 31 || e.code === 32);
        if (buffEffects.length > 0) {
            const buffTexts = buffEffects.map(e => {
                const paramKeys = ["HP", "MP", "ATT", "DEF", "M.ATT", "M.DEF", "AGILITY", "LUCK"];
                const key = paramKeys[e.dataId];
                const paramName = key ? _si18n(key) : TextManager.param(e.dataId);

                const type = e.code === 31 ?
                    (T('SkillMaster.buff')) :
                    (T('SkillMaster.debuff'));
                return `${type} ${paramName}`;
            });
            if (text) text += ", ";
            text += buffTexts.join(", ");
        }

        const stateEffects = effects.filter(e => e.code === 21 || e.code === 22);
        if (stateEffects.length > 0) {
            const stateTexts = stateEffects.map(e => {
                const state = $dataStates[e.dataId];
                return `${state ? state.name : (T('SkillMaster.state'))}`;
            });
            if (text) text += ", ";
            text += stateTexts.join(", ");
        }

        return text || (T('SkillMaster.none'));
    };

    Window_SkillDetail.prototype.drawHorzLine = function (y, x, width) {
        x = x || 16;
        width = width || (this.contentsWidth() - 32);
        this.contents.paintOpacity = 48;
        this.contents.fillRect(x, y, width, 2, ColorManager.normalColor());
        this.contents.paintOpacity = 255;
    };

    Window_SkillDetail.prototype.resetFontSize = function () {
        this.contents.fontSize = (typeof this.standardFontSize === 'function')
            ? this.standardFontSize()
            : $gameSystem.mainFontSize();
    };

    Window_SkillDetail.prototype.processOk = function () {
        const action = this.currentAction();
        if (action && action.enabled) {
            this.playOkSound();
            this.updateInputData();
            this.deactivate();
            this.callOkHandler();
        } else {
            this.playBuzzerSound();
        }
    };

    //=============================================================================
    // Window_ActorSelect - Pick a party member for skill training
    // Uses drawActorFace which is overridden by CustomBustFaceSystemjs to show busts
    //=============================================================================

    function Window_ActorSelect() {
        this.initialize(...arguments);
    }

    Window_ActorSelect.prototype = Object.create(Window_Selectable.prototype);
    Window_ActorSelect.prototype.constructor = Window_ActorSelect;

    Window_ActorSelect.prototype.initialize = function (rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._skill = null;
        this._actors = [];
        this.refresh();
    };

    Window_ActorSelect.prototype.setSkill = function (skill) {
        this._skill = skill;
        this._actors = $gameParty.members();
        this.refresh();
        this.select(0);
    };

    Window_ActorSelect.prototype.maxItems = function () {
        return this._actors.length;
    };

    Window_ActorSelect.prototype.itemHeight = function () {
        return 80;
    };

    Window_ActorSelect.prototype.currentActor = function () {
        return this._actors[this.index()] || null;
    };

    Window_ActorSelect.prototype.drawItem = function (index) {
        const actor = this._actors[index];
        if (!actor) return;

        const rect = this.itemRect(index);
        const skillId = this._skill ? this._skill.id : 0;
        const hasSkill = skillId > 0 && actor.isLearnedSkill(skillId);
        const cost = skillId > 0 ? $gameSystem.getSkillKnowledgeCost(skillId, actor.actorId()) : 0;
        const canAfford = $gameSystem.getKnowledge() >= cost;

        const faceSize = 72;
        const faceX = rect.x + 4;
        const faceY = rect.y + Math.floor((rect.height - faceSize) / 2);
        this.drawActorFace(actor, faceX, faceY, faceSize, faceSize);

        const textX = faceX + faceSize + 10;
        const textW = rect.width - faceSize - 22;
        const nameY = rect.y + 10;
        const statusY = nameY + this.lineHeight();

        if (hasSkill) {
            this.changeTextColor(ColorManager.textColor(3));
        } else if (!canAfford) {
            this.changeTextColor(ColorManager.textColor(7));
        } else {
            this.resetTextColor();
        }
        this.contents.fontSize = 22;
        this.drawText(actor.name(), textX, nameY, textW);
        this.contents.fontSize = $gameSystem.mainFontSize();
        this.resetTextColor();

        this.contents.fontSize = 18;
        if (hasSkill) {
            this.changeTextColor(ColorManager.textColor(3));
            this.drawText(T('SkillMaster.learnedMark'), textX, statusY, textW);
        } else {
            this.changeTextColor(canAfford ? ColorManager.textColor(1) : ColorManager.textColor(7));
            this.drawText(T('SkillMaster.costKp', { cost: cost }), textX, statusY, textW);
        }
        this.resetTextColor();
        this.contents.fontSize = $gameSystem.mainFontSize();
    };

    Window_ActorSelect.prototype.refresh = function () {
        this.createContents();
        this.drawAllItems();
    };

    //=============================================================================
    // Scene_SkillEncyclopedia - Unified Interface (Premium D&D Spread)
    //=============================================================================

    // Number of columns used by the category selection grid (full-page spread).
    // Number of columns used by each category page (Skills on the left, Magic on the right).
    const CATEGORY_PAGE_COLS = 2;
    // Number of columns used by the per-category skill grid (left page of the split spread).
    const SKILL_GRID_COLS = 2;

    // Pupils offered by the companion switcher. Matches the Skills scene, which
    // lists every party member (reserves included) rather than the battle party.
    function getSwitchableMembers() {
        return $gameParty.allMembers();
    }

    function Scene_SkillEncyclopedia() {
        this.initialize(...arguments);
    }

    Scene_SkillEncyclopedia.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_SkillEncyclopedia.prototype.constructor = Scene_SkillEncyclopedia;

    Scene_SkillEncyclopedia.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
        this._viewMode = 'category';
        this._preselectedSkillId = $gameVariables.value(variableId);
        this.handlePreselection();
    };

    Scene_SkillEncyclopedia.prototype.handlePreselection = function () {
        this._categoryPane = 0;            // 0 = Skills (left), 1 = Magic (right)
        this._selectedCategoryIndex = 0;
        this._selectedSkillIndex = 0;
        this._selectedActionIndex = 0;
        // Where the cursor stands on the circle, which is a skill rather than an
        // index: the circle is a figure, not a list, and the cursor walks it.
        this._focusSkillId = 0;
        this._atlasZoom = 0;
        // The school on the page, and what every other school was left at.
        this._atlasCategory = null;
        this._atlasMemory = {};
        // True when the cursor has walked off the bottom of the Magic grid onto
        // the Fuse Spells button, which is a focus target of its own.
        this._categoryFuseFocused = false;

        // The chosen pupil: every skill taught from this scene goes to this actor.
        const leader = $gameParty.leader();
        this._teachActorId = leader ? leader.actorId() : 1;
        // The browsable category lists are the pupil's, so the manager has to know
        // who the pupil is before anything reads them.
        actorCategoryManager.setActor(this._teachActorId);

        if (this._preselectedSkillId > 0) {
            const skillId = this._preselectedSkillId;
            const skill = $dataSkills[skillId];
            if (skill) {
                const category = getSkillCategory(skillId);
                if (category) {
                    this._selectedCategory = category;
                    const split = getSplitSkillCategories();
                    const pane = getCategoryType(category) === 'Magic' ? 1 : 0;   // i18n-ignore: category id
                    const list = pane === 1 ? split.Magic : split.Skill;
                    const catIdx = list.indexOf(category);
                    if (catIdx !== -1) {
                        this._categoryPane = pane;
                        this._selectedCategoryIndex = catIdx;
                        const skills = getSkillsByCategory(category);
                        const skillIdx = skills.findIndex(s => s.id === skillId);
                        if (skillIdx !== -1) {
                            this._selectedSkillIndex = skillIdx;
                            this._focusSkillId = skillId;
                            this._viewMode = 'detail';
                            this._selectedActionIndex = 0;
                            this._preselectedSkillId = 0;
                            return;
                        }
                    }
                }
            }
            this._preselectedSkillId = 0;
        }

        // The pupil defaults to the party leader (first member); the persistent
        // top switcher lets you change who is learning without a dedicated step.
    };

    Scene_SkillEncyclopedia.prototype.getTeachActor = function () {
        return $gameActors.actor(this._teachActorId) || $gameParty.leader();
    };

    Scene_SkillEncyclopedia.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        injectAllCustomSpells(); // make sure fused spells are attached before we draw
        this.createCategoryWindow();
        this.createSkillListWindow();
        this.createSkillDetailWindow();
        this.createUISkillDOM();
        window.CharSwitcher.installTabKey(this, (dir) => {
            if (this._viewMode !== 'spellEditor' && this._viewMode !== 'preview') this.cycleTeachActor(dir);
        });
    };

    Scene_SkillEncyclopedia.prototype.terminate = function () {
        Scene_MenuBase.prototype.terminate.call(this);
        window.CharSwitcher.removeTabKey(this);
        AnimPreview.dispose();
        if (this._dndContainer) {
            const container = this._dndContainer;
            container.style.transition = "opacity 0.2s ease-out";
            container.style.opacity = "0";
            container.style.pointerEvents = "none";
            setTimeout(() => {
                if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 200);
            this._dndContainer = null;
        }
    };

    Scene_SkillEncyclopedia.prototype.createCategoryWindow = function () {
        this._categoryWindow = new Window_SkillCategory(new Rectangle(0, 0, 100, 100));
        this._categoryWindow.visible = false;
        this.addWindow(this._categoryWindow);
    };

    Scene_SkillEncyclopedia.prototype.createSkillListWindow = function () {
        this._skillListWindow = new Window_SkillMasterList(new Rectangle(0, 0, 100, 100));
        this._skillListWindow.visible = false;
        this.addWindow(this._skillListWindow);
    };

    Scene_SkillEncyclopedia.prototype.createSkillDetailWindow = function () {
        this._skillDetailWindow = new Window_SkillDetail(new Rectangle(0, 0, 100, 100));
        this._skillDetailWindow.visible = false;
        this.addWindow(this._skillDetailWindow);
    };

    Scene_SkillEncyclopedia.prototype.createUISkillDOM = function () {
        // Styles for the shared skill inspect block (.inspect-*) rendered on the
        // right page; owned by CategorizedBattleSkills' SkillDetails service.
        if (window.SkillDetails) window.SkillDetails.injectStyles();
        this.injectAtlasStyles();

        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'menu-container';
        this._dndContainer.style.position = 'absolute';
        this._dndContainer.style.top = '0';
        this._dndContainer.style.left = '0';
        this._dndContainer.style.width = '100%';
        this._dndContainer.style.height = '100%';
        this._dndContainer.style.zIndex = '1000';
        this._dndContainer.style.background = 'radial-gradient(circle, var(--accent-bronze-translucent-78) 0%, var(--shadow-heavy) 100%)';
        this._dndContainer.style.display = 'flex';
        this._dndContainer.style.justifyContent = 'center';
        this._dndContainer.style.alignItems = 'center';
        this._dndContainer.style.fontFamily = "'Lora', serif";
        this._dndContainer.style.color = 'var(--bg-bg-alt-25-translucent-8)';
        this._dndContainer.style.boxSizing = 'border-box';
        this._dndContainer.style.opacity = '0';
        this._dndContainer.style.transition = 'opacity 0.22s ease-out';

        // Static frame layout matching Sepia golden split spread
        this._dndContainer.innerHTML = `
            <div class="book-spread">
                <div class="spine-divider"></div>
                <div class="left-page" style="position:relative;">
                    <div id="left-page-content" style="display:flex; flex-direction:column; flex:1; min-height:0;"></div>
                </div>
                <div class="right-page" style="position:relative;">
                    <div class="companion-switcher" id="skillmaster-companion-row" style="flex:0 0 auto; justify-content:flex-end; min-height:26px; margin-bottom:10px;"></div>
                    <div id="right-page-content" style="display:flex; flex-direction:column; flex:1 1 auto; min-height:0;"></div>
                </div>
            </div>
        `;

        document.body.appendChild(this._dndContainer);

        // Wheel scroll on category/skills list regardless of focus. On the atlas
        // the wheel zooms instead, about the point it is pointing at.
        this._dndContainer.addEventListener("wheel", (e) => {
            e.preventDefault();
            let box = e.target.closest && e.target.closest('.skill-scroll-box');
            if (!box) {
                box = document.getElementById('category-scroll-box-left') ||
                      document.getElementById('category-scroll-box-right') ||
                      document.getElementById('skills-scroll-box') ||
                      document.getElementById('skill-atlas-box');
            }
            if (!box) return;
            if (box.id === 'skill-atlas-box') {
                const rect = box.getBoundingClientRect();
                this.setAtlasZoom(
                    this.atlasZoom() * (e.deltaY > 0 ? 1 / ATLAS_WHEEL_STEP : ATLAS_WHEEL_STEP),
                    box.scrollLeft + (e.clientX - rect.left),
                    box.scrollTop + (e.clientY - rect.top)
                );
                return;
            }
            box.scrollTop += e.deltaY;
        }, { passive: false });

        // Inject separation of layout styles
        // Initialize state markers to force clean draw
        this._lastLeftMode = null;
        this._lastLeftCategory = null;
        this._lastRightMode = null;
        this._lastRightSkillId = null;
        this._lastRightKnowledge = null;
        this._lastPopupKey = null;

        this.refreshUISkillDOM();

        setTimeout(() => {
            if (this._dndContainer) {
                this._dndContainer.style.opacity = '1';
            }
        }, 16);
    };

    // getCategoryEmoji was unused and returned '' for every category; kept as a
    // no-op so any stray external caller still gets a string.
    Scene_SkillEncyclopedia.prototype.getCategoryEmoji = function (catName) {
        return '';
    };

    //=========================================================================
    // The atlas, drawn
    //
    // The spread holds ONE school: its circle, alone, taking both pages. Learned
    // skills are lit, the skills bordering them are open to buy and everything
    // else is dimmed but still readable. The other schools are a page turn away
    // (the pager on the header bar, or walking off the rim left or right), and
    // each of them keeps the zoom and the cursor it was left at.
    //=========================================================================

    // Every school the pupil studies, in the order the shelf lists them.
    Scene_SkillEncyclopedia.prototype.atlasCategories = function () {
        const split = this.getSplitCategoriesCached();
        return split.Skill.filter(c => c !== 'All').concat(split.Magic);   // i18n-ignore: category id
    };

    // The school on the page. "All" is not a circle of its own, so it opens on the
    // first school of the curriculum, and a school the pupil has stopped
    // studying (the pupil switcher) falls back the same way.
    Scene_SkillEncyclopedia.prototype.viewedCategory = function () {
        const list = this.atlasCategories();
        if (!list.length) return null;
        if (!this._atlasCategory || !list.includes(this._atlasCategory)) {
            const chosen = this._selectedCategory;
            this._atlasCategory = list.includes(chosen) ? chosen : list[0];
        }
        return this._atlasCategory;
    };

    Scene_SkillEncyclopedia.prototype.currentAtlas = function () {
        return SkillAtlas.build(this.viewedCategory());
    };

    // Turn the page to another school. The cursor and the zoom of the one being
    // left are remembered, so coming back lands where it was left standing.
    Scene_SkillEncyclopedia.prototype.showAtlasCategory = function (category) {
        const list = this.atlasCategories();
        if (!category || !list.includes(category) || category === this._atlasCategory) return false;
        if (!this._atlasMemory) this._atlasMemory = {};
        if (this._atlasCategory) {
            this._atlasMemory[this._atlasCategory] = {
                skillId: this._focusSkillId, zoom: this._atlasZoom
            };
        }
        this._atlasCategory = category;
        this._selectedCategory = category;
        if (this._skillListWindow) this._skillListWindow.setCategory(category);
        const kept = this._atlasMemory[category];
        this._atlasZoom = 0;
        this._focusSkillId = 0;
        if (kept && this.currentAtlas().index[kept.skillId]) {
            this._focusSkillId = kept.skillId;
            this._atlasZoom = kept.zoom || 0;
        } else {
            this.defaultGraphFocus();
        }
        return true;
    };

    // The pager: one school forward or back, wrapping, so a curriculum is
    // walked end to end without going back to the shelf.
    Scene_SkillEncyclopedia.prototype.pageAtlasSchool = function (dir) {
        const list = this.atlasCategories();
        if (list.length <= 1) return false;
        const cur = list.indexOf(this.viewedCategory());
        const next = ((cur < 0 ? 0 : cur) + dir + list.length) % list.length;
        if (!this.showAtlasCategory(list[next])) return false;
        SoundManager.playCursor();
        this.refreshUISkillDOM();
        this.centreAtlasOnFocus();
        return true;
    };

    // The atlas is the browsing view whenever there is anything to draw; the old
    // flat list survives only for a curriculum with no graph data at all.
    Scene_SkillEncyclopedia.prototype.usesGraphView = function () {
        return this.currentAtlas().circles.length > 0;
    };

    Scene_SkillEncyclopedia.prototype.focusedSkill = function () {
        if (this.usesGraphView()) {
            const skill = $dataSkills[this._focusSkillId];
            if (skill) return skill;
        }
        const skills = this.getSkillsByCategoryCached(this._selectedCategory);
        return skills[this._selectedSkillIndex] || null;
    };

    // The school on the page. Everything that names one (the header, the sheet,
    // the KP price, the banner) reads it from here.
    Scene_SkillEncyclopedia.prototype.focusedCategory = function () {
        if (this.usesGraphView()) return this.viewedCategory();
        return this._selectedCategory;
    };

    // Focus a skill by id. On the atlas that is a node of the school on the
    // page; anything else falls back to the flat list's cursor.
    Scene_SkillEncyclopedia.prototype.focusSkillId = function (skillId) {
        if (this.currentAtlas().index[skillId]) {
            this._focusSkillId = skillId;
            return true;
        }
        const skills = this.getSkillsByCategoryCached(this._selectedCategory);
        const idx = skills.findIndex(s => s.id === skillId);
        if (idx >= 0) {
            this._selectedSkillIndex = idx;
            this._focusSkillId = skillId;
        }
        return idx >= 0;
    };

    // The cursor must always be standing somewhere on the atlas. A skill
    // preselected from a school that has no circle, or a pupil switched under it,
    // can leave it nowhere at all, and a cursor that is nowhere cannot move.
    Scene_SkillEncyclopedia.prototype.ensureAtlasFocus = function () {
        const atlas = this.currentAtlas();
        if (!atlas.circles.length || atlas.index[this._focusSkillId]) return;
        this.defaultGraphFocus();
    };

    // Where the cursor lands when a school is opened: standing on something the
    // pupil already knows there if they know anything at all, otherwise on the
    // way in.
    Scene_SkillEncyclopedia.prototype.defaultGraphFocus = function () {
        const atlas = this.currentAtlas();
        if (!atlas.circles.length) return;
        const circle = atlas.circles[0];
        const actor = this.getTeachActor();
        const known = actor ? circle.nodes.find(n => actor.isLearnedSkill(n.id)) : null;
        const entry = circle.nodes.find(n => n.tier === 0) || circle.nodes[0];
        this.focusSkillId((known || entry).id);
    };

    // Everything that changes a node's COLOUR (never its position, and never the
    // cursor): the curriculum, the pupil, and how much of it they have learned.
    Scene_SkillEncyclopedia.prototype.graphStateKey = function () {
        const actor = this.getTeachActor();
        const atlas = this.currentAtlas();
        let learned = 0;
        if (actor) {
            for (const circle of atlas.circles) {
                for (const node of circle.nodes) if (actor.isLearnedSkill(node.id)) learned++;
            }
        }
        return `${atlas.key}|${actor ? actor.actorId() : 0}|${learned}`;
    };

    Scene_SkillEncyclopedia.prototype.atlasLearnedCount = function (category) {
        const circle = this.currentAtlas().circles.find(s => !category || s.category === category);
        const actor = this.getTeachActor();
        if (!circle) return { learned: 0, total: 0 };
        let learned = 0;
        if (actor) for (const node of circle.nodes) if (actor.isLearnedSkill(node.id)) learned++;
        return { learned: learned, total: circle.nodes.length };
    };

    Scene_SkillEncyclopedia.prototype.atlasProgressText = function (category) {
        const count = this.atlasLearnedCount(category);
        return T('SkillMaster.atlas.progress', { learned: count.learned, total: count.total });
    };

    //---------------------------------------------------------------- zoom / pan

    // A deep circle is wider than the page, so the page is a window onto it: the
    // wheel and the two rules on the legend bar zoom, dragging pans, and the
    // cursor keeps itself inside a comfortable margin of the window.
    Scene_SkillEncyclopedia.prototype.atlasZoom = function () {
        if (!this._atlasZoom) this._atlasZoom = this.defaultAtlasZoom();
        return this._atlasZoom;
    };

    // Open at a size the school can be READ at. A deep school will not fit
    // whole and is not shrunk until it does; it is held here and panned, and
    // Shift is what steps back far enough to see the whole figure.
    Scene_SkillEncyclopedia.prototype.defaultAtlasZoom = function () {
        const atlas = this.currentAtlas();
        if (!atlas.circles.length) return 1;
        const circle = atlas.circles[0];
        const box = document.getElementById('left-page-content');
        const w = Math.max(420, (box ? box.clientWidth : 1100) - 24);
        const h = Math.max(300, (box ? box.clientHeight : 660) - ATLAS_LEGEND_H);
        const fit = Math.min(w, h) / (circle.radius * 2 + 40);
        return Math.max(ATLAS_READ_ZOOM, Math.min(1, fit));
    };

    // Far enough back that the whole circle is on the page at once: what one
    // press of Shift steps out to.
    Scene_SkillEncyclopedia.prototype.wholeAtlasZoom = function () {
        const atlas = this.currentAtlas();
        if (!atlas.width || !atlas.height) return this.defaultAtlasZoom();
        const box = document.getElementById('left-page-content');
        const w = Math.max(420, (box ? box.clientWidth : 1100) - 24);
        const h = Math.max(300, (box ? box.clientHeight : 660) - ATLAS_LEGEND_H);
        return Math.max(ATLAS_ZOOM_MIN, Math.min(1, Math.min(w / atlas.width, h / atlas.height)));
    };

    // Anchor coordinates are in the scroll box's own content space; the point
    // under them is held still while the atlas grows or shrinks beneath it.
    Scene_SkillEncyclopedia.prototype.setAtlasZoom = function (zoom, anchorX, anchorY) {
        const atlas = this.currentAtlas();
        const box = document.getElementById('skill-atlas-box');
        const sizer = document.getElementById('skill-atlas-sizer');
        const canvas = document.getElementById('skill-atlas-canvas');
        if (!box || !sizer || !canvas) return;
        const next = Math.max(ATLAS_ZOOM_MIN, Math.min(ATLAS_ZOOM_MAX, zoom));
        const prev = this.atlasZoom();
        if (Math.abs(next - prev) < 0.001) return;

        const ax = (anchorX === undefined) ? box.scrollLeft + box.clientWidth / 2 : anchorX;
        const ay = (anchorY === undefined) ? box.scrollTop + box.clientHeight / 2 : anchorY;
        const worldX = ax / prev;
        const worldY = ay / prev;

        this._atlasZoom = next;
        sizer.style.width = Math.round(atlas.width * next) + 'px';
        sizer.style.height = Math.round(atlas.height * next) + 'px';
        canvas.style.transform = `scale(${next})`;
        this.applyAtlasFarView(canvas, next);
        box.scrollLeft += worldX * next - ax;
        box.scrollTop += worldY * next - ay;
    };

    // Stepped far enough back, a skill's name is a smudge and the atlas reads
    // better as pure figures: the names come off and the school names are held
    // at the size they had when they came off, so the circles stay identifiable.
    Scene_SkillEncyclopedia.prototype.applyAtlasFarView = function (canvas, zoom) {
        if (!canvas) return;
        const far = zoom < ATLAS_FAR_ZOOM;
        canvas.classList.toggle('sg-far', far);
        // Below 1:1 the plate is drawn smaller than it was written, so the
        // writing and the icons are scaled back UP by the same factor, capped
        // so they never grow into each other on a school stepped fully back.
        const back = zoom < 1 ? Math.min(ATLAS_LABEL_MAX, 1 / zoom) : 1;
        canvas.style.setProperty('--sg-label-scale', back.toFixed(2));
        canvas.style.setProperty('--sg-icon-scale', (1 + (back - 1) * ATLAS_ICON_SHARE).toFixed(2));
        canvas.style.setProperty('--sg-banner-scale', back.toFixed(2));
    };

    Scene_SkillEncyclopedia.prototype.zoomAtlas = function (dir) {
        this.setAtlasZoom(dir > 0 ? this.atlasZoom() * ATLAS_ZOOM_STEP
            : this.atlasZoom() / ATLAS_ZOOM_STEP);
    };

    // Drag anywhere on the field to pan. A press that never travelled is a
    // click, so the nodes keep their own onclick; one that did swallows it, so
    // panning across a circle never teaches anything by accident. Every listener
    // is on the box itself, so a rebuilt atlas leaves none of them behind.
    Scene_SkillEncyclopedia.prototype.bindAtlasPointer = function () {
        const box = document.getElementById('skill-atlas-box');
        if (!box || box._atlasBound) return;
        box._atlasBound = true;
        const DEAD = 6;
        let dragging = false, travelled = false;
        let fromX = 0, fromY = 0, scrollX = 0, scrollY = 0;
        box.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            travelled = false;
            fromX = e.clientX; fromY = e.clientY;
            scrollX = box.scrollLeft; scrollY = box.scrollTop;
            box.setPointerCapture(e.pointerId);
        });
        box.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - fromX;
            const dy = e.clientY - fromY;
            if (!travelled && Math.abs(dx) + Math.abs(dy) < DEAD) return;
            travelled = true;
            box.scrollLeft = scrollX - dx;
            box.scrollTop = scrollY - dy;
        });
        const release = (e) => {
            dragging = false;
            if (box.hasPointerCapture && box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
        };
        box.addEventListener('pointerup', release);
        box.addEventListener('pointercancel', release);
        box.addEventListener('click', (e) => {
            if (!travelled) return;
            travelled = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    };

    // The styles the atlas draws itself with. State lives in classes rather than
    // in inline style, so a curriculum of a thousand nodes is one string to
    // build and a cursor step is a class toggle instead of a repaint.
    Scene_SkillEncyclopedia.prototype.injectAtlasStyles = function () {
        if (document.getElementById('skillmaster-atlas-styles')) return;
        const style = document.createElement('style');
        style.id = 'skillmaster-atlas-styles';
        style.textContent = `
            #skill-atlas-box { position:relative; overflow:auto; min-height:0; box-sizing:border-box; cursor:grab; touch-action:none; }
            #skill-atlas-box:active { cursor:grabbing; }
            #skill-atlas-sizer { margin:0 auto; }
            #skill-atlas-canvas { position:relative; transform-origin:0 0; }
            #skill-atlas-canvas svg { position:absolute; left:0; top:0; pointer-events:none; }
            .sg-circle { color:var(--text-secondary-active); }
            .sg-node {
                position:absolute; display:flex; flex-direction:column; align-items:center;
                width:${CIRCLE_LABEL_W}px; cursor:pointer; font-family:'Lora', serif; user-select:none;
            }
            .sg-in { display:flex; flex-direction:column; align-items:center; }
            .sg-node.sg-locked .sg-in { opacity:0.66; }
            .sg-ring {
                width:${CIRCLE_NODE}px; height:${CIRCLE_NODE}px; border-radius:50%; box-sizing:border-box;
                border:2px solid var(--border-secondary-hover-translucent-15);
                background:var(--bg-card-translucent-5);
                display:flex; align-items:center; justify-content:center;
            }
            .sg-node.sg-learned .sg-ring { border-color:var(--border-forest-green); background:var(--bg-success-green-15); }
            .sg-node.sg-open .sg-ring { border-color:var(--text-secondary-active); background:var(--bg-tertiary-focus-translucent-45); }
            .sg-node.sg-focus .sg-ring { box-shadow:0 0 0 3px var(--text-secondary-active), 0 0 14px var(--shadow-primary-hover-translucent-5); }
            /* The circle is not a page of a book: while it is up, the spread
               gives up its 1560x960 plate and takes the whole screen. Scoped to
               .skill-fullpage, which only this scene ever sets. */
            #menu-container .book-spread.skill-fullpage {
                width:100%; height:100%; max-width:none; max-height:none;
            }
            .sg-name {
                margin-top:5px; max-width:${CIRCLE_LABEL_W}px; font-size:0.78rem; line-height:1.14;
                text-align:center; color:var(--text-pure-white); overflow:hidden;
                text-shadow:0 1px 2px var(--shadow-black-translucent-75);
                display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
            }
            .sg-node.sg-learned .sg-name, .sg-node.sg-focus .sg-name { font-weight:bold; }
            .sg-cost { font-size:0.7rem; color:var(--text-text-alt-3); letter-spacing:0.3px; }
            .sg-banner {
                position:absolute; text-align:center; pointer-events:none; font-family:'Lora', serif;
                text-transform:uppercase; letter-spacing:2.5px; font-weight:bold; font-size:1.05rem;
                color:var(--text-secondary-active); text-shadow:0 1px 3px var(--shadow-black-translucent-75);
            }
            /* Stepping back shrinks the whole plate, so the writing on it is
               grown back by the same amount (up to a ceiling): a school seen
               whole still reads as a set of named skills rather than a smudge. */
            .sg-name, .sg-cost { transform:scale(var(--sg-label-scale, 1)); transform-origin:top center; }
            .sg-ring { transform:scale(var(--sg-icon-scale, 1)); }
            .sg-banner { transform:scale(var(--sg-banner-scale, 1)); transform-origin:top center; }
            .sg-banner-sub {
                display:block; margin-top:2px; font-size:0.72rem; letter-spacing:1px;
                font-weight:normal; text-transform:none; color:var(--text-pure-white);
            }
            .sg-legend {
                display:flex; align-items:center; gap:16px; justify-content:center; flex-wrap:wrap;
                font-family:'Lora', serif; font-size:0.82rem; color:var(--text-pure-white); padding:2px 0 8px 0;
            }
            .sg-pager {
                display:flex; align-items:center; justify-content:center; gap:12px; flex:0 0 auto;
                font-family:'Lora', serif; padding:2px 0 6px 0; user-select:none;
            }
            .sg-pager-arrow {
                display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px;
                border:1px solid var(--text-secondary-active); border-radius:50%; color:var(--text-secondary-active);
                cursor:pointer; font-size:1.05rem; line-height:1; font-weight:bold;
            }
            .sg-pager-name {
                font-size:0.95rem; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase;
                color:var(--text-secondary-active);
            }
            .sg-pager-count { font-size:0.76rem; color:var(--text-card-medium); letter-spacing:0.5px; }
            .sg-legend-key { display:inline-flex; align-items:center; gap:5px; }
            .sg-legend-dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
            .sg-zoom {
                display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px;
                border:1px solid var(--text-secondary-active); border-radius:50%; color:var(--text-secondary-active);
                cursor:pointer; font-weight:bold; line-height:1; user-select:none;
            }
            .sg-hint { opacity:0.65; font-size:0.75rem; }
            .sg-occult {
                font-size:0.62rem; letter-spacing:1px; font-weight:bold; padding:1px 6px; border-radius:3px;
                border:1px solid var(--text-secondary-active); color:var(--text-secondary-active);
            }
            .sg-occult.sg-forbidden {
                border-color:var(--text-primary-hover); color:var(--text-primary-hover);
            }
        `;
        document.head.appendChild(style);
    };

    // The pager: which school of the curriculum is on the page, and the way to
    // the one before and the one after it. A curriculum of one school shows
    // nothing, since there is nowhere to turn to.
    Scene_SkillEncyclopedia.prototype.renderAtlasPagerHTML = function () {
        const list = this.atlasCategories();
        const cur = list.indexOf(this.viewedCategory());
        if (list.length <= 1 || cur < 0) return '';
        const prev = list[(cur - 1 + list.length) % list.length];
        const next = list[(cur + 1) % list.length];
        return `
            <div class="sg-pager">
                <span class="sg-pager-arrow" onclick="SceneManager._scene.pageAtlasSchool(-1)" title="${getCategoryDisplayName(prev)}">&#8249;</span>
                <span class="sg-pager-name">${getCategoryDisplayName(list[cur])}</span>
                <span class="sg-pager-count">${T('SkillMaster.atlas.schoolOf', { index: cur + 1, total: list.length })}</span>
                <span class="sg-pager-arrow" onclick="SceneManager._scene.pageAtlasSchool(1)" title="${getCategoryDisplayName(next)}">&#8250;</span>
            </div>`;
    };

    Scene_SkillEncyclopedia.prototype.renderSkillAtlasHTML = function () {
        const atlas = this.currentAtlas();
        const actor = this.getTeachActor();
        const focusedId = this._focusSkillId;
        const zoom = this.atlasZoom();
        const labelScale = (zoom < 1 ? Math.min(ATLAS_LABEL_MAX, 1 / zoom) : 1).toFixed(2);

        let glyphsHTML = "";
        let edgesHTML = "";
        let nodesHTML = "";
        let bannersHTML = "";

        for (const circle of atlas.circles) {
            glyphsHTML += SkillAtlas.glyph(circle);

            let sealEdges = "";
            for (const [a, b] of circle.edges) {
                const knownA = actor ? actor.isLearnedSkill(a.id) : false;
                const knownB = actor ? actor.isLearnedSkill(b.id) : false;
                // A link between two skills the pupil does not have is still a
                // link and still shows the shape of the school: drawn solid and
                // plainly visible, only cooler and thinner than a walked one.
                let stroke = 'var(--border-secondary-hover-translucent-15)';
                let opacity = 0.7;
                let dash = '';
                if (knownA && knownB) { stroke = 'var(--text-forest-complete)'; opacity = 0.95; dash = ''; }
                else if (knownA || knownB) { stroke = 'var(--text-secondary-active)'; opacity = 0.9; dash = ''; }
                sealEdges += `<line x1="${a.ax.toFixed(1)}" y1="${a.ay.toFixed(1)}" x2="${b.ax.toFixed(1)}" y2="${b.ay.toFixed(1)}" stroke="${stroke}" stroke-width="${knownA && knownB ? 3 : (knownA || knownB ? 2.4 : 1.6)}" stroke-opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round" />`;
            }
            edgesHTML += `<g class="sg-edges" data-circle="${circle.category}">${sealEdges}</g>`;

            for (const node of circle.nodes) {
                const learned = actor ? actor.isLearnedSkill(node.id) : false;
                const open = !learned && SkillGraph.isOpen(actor, node.id);
                const state = learned ? 'sg-learned' : (open ? 'sg-open' : 'sg-locked');   // i18n-ignore: CSS class
                const focus = node.id === focusedId ? ' sg-focus' : '';   // i18n-ignore: CSS class
                // Only a skill you could actually buy prices itself on the circle.
                const cost = (actor && open) ? $gameSystem.getSkillKnowledgeCost(node.id, actor.actorId()) : 0;
                nodesHTML += `<div class="sg-node ${state}${focus}" data-id="${node.id}" data-circle="${circle.category}" onclick="SceneManager._scene.selectGraphNode(${node.id})" style="left:${(node.ax - CIRCLE_LABEL_W / 2).toFixed(1)}px; top:${(node.ay - CIRCLE_NODE / 2).toFixed(1)}px;"><div class="sg-in"><div class="sg-ring"><div style="${getSkillIconStyle(node.skill.iconIndex)} transform:scale(0.9);"></div></div><div class="sg-name">${node.skill.name}</div>${cost ? `<div class="sg-cost">${cost} KP</div>` : ''}</div></div>`;
            }

            const count = this.atlasLearnedCount(circle.category);
            bannersHTML += `<div class="sg-banner" data-circle="${circle.category}" style="left:${(circle.cx - circle.radius).toFixed(1)}px; top:${(circle.cy + circle.outer + 18).toFixed(1)}px; width:${(circle.radius * 2).toFixed(1)}px;">${getCategoryDisplayName(circle.category)}<span class="sg-banner-sub">${T('SkillMaster.atlas.progress', { learned: count.learned, total: count.total })}</span></div>`;
        }

        const legendKey = (color, label) =>
            `<span class="sg-legend-key"><span class="sg-legend-dot" style="border:2px solid ${color};"></span>${label}</span>`;

        return `
            ${this.renderAtlasPagerHTML()}
            <div class="sg-legend">
                ${legendKey('var(--border-forest-green)', T('SkillMaster.graph.legendLearned'))}
                ${legendKey('var(--text-secondary-active)', T('SkillMaster.graph.legendOpen'))}
                ${legendKey('var(--border-secondary-hover-translucent-15)', T('SkillMaster.graph.legendLocked'))}
                <span class="sg-legend-key">
                    <span class="sg-zoom" onclick="SceneManager._scene.zoomAtlas(-1)">-</span>
                    <span class="sg-zoom" onclick="SceneManager._scene.zoomAtlas(1)">+</span>
                </span>
                <span class="sg-hint">${T('SkillMaster.atlas.hint')}</span>
            </div>
            <div id="skill-atlas-box" class="skill-scroll-box" style="flex:1;">
                <div id="skill-atlas-sizer" style="position:relative; width:${Math.round(atlas.width * zoom)}px; height:${Math.round(atlas.height * zoom)}px;">
                    <div id="skill-atlas-canvas" class="${zoom < ATLAS_FAR_ZOOM ? 'sg-far' : ''}" style="width:${atlas.width}px; height:${atlas.height}px; transform:scale(${zoom}); --sg-label-scale:${labelScale}; --sg-icon-scale:${(1 + (labelScale - 1) * ATLAS_ICON_SHARE).toFixed(2)}; --sg-banner-scale:${labelScale};">
                        <svg width="${atlas.width}" height="${atlas.height}">${glyphsHTML}${edgesHTML}</svg>
                        ${bannersHTML}
                        ${nodesHTML}
                    </div>
                </div>
            </div>
        `;
    };

    // The flat list, the fallback for a curriculum with no circle on it at all
    // (nothing in any of the pupil's schools carries a <Node:> tag).
    Scene_SkillEncyclopedia.prototype.renderSkillListHTML = function () {
        const skills = getSkillsByCategory(this._selectedCategory);
        const teachActor = this.getTeachActor();
        let skillsListHTML = "";

        skills.forEach((skill, idx) => {
            const isFocused = (this._selectedSkillIndex === idx);
            const isLearned = teachActor ? teachActor.isLearnedSkill(skill.id) : false;
            const isOpen = SkillGraph.isOpen(teachActor, skill.id);
            const badge = isLearned
                ? `<span style="font-family:'Lora', serif; font-size:0.7rem; text-transform:uppercase; color:var(--text-forest-complete); border:1px solid var(--border-forest-green); border-radius:3px; padding:1px 5px; font-weight:bold; background:var(--bg-success-green-15); letter-spacing:0.5px;">${T('SkillMaster.mastered')}</span>`
                : (!isOpen ? `<span style="font-family:'Lora', serif; font-size:0.7rem; text-transform:uppercase; color:var(--text-card-medium); border:1px solid var(--border-secondary-hover-translucent-15); border-radius:3px; padding:1px 5px; letter-spacing:0.5px;">${T('SkillMaster.graph.locked')}</span>` : '');

            skillsListHTML += `
                <div class="skill-card ${isFocused ? 'focused' : ''}" onclick="SceneManager._scene.selectSkill(${idx})" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--accent-gray-2-translucent-0); border:1px solid ${isFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer; font-family:'Lora', serif; opacity:${isLearned || isOpen ? 1 : 0.6}; transition:all 0.15s ease;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="${getSkillIconStyle(skill.iconIndex)} transform: scale(0.8); flex-shrink: 0; image-rendering: pixelated; margin-right: 2px;"></div>
                        <div style="font-weight:bold; color:${isFocused ? 'var(--text-secondary-active)' : 'var(--text-card-medium)'}; font-size:0.95rem;">${skill.name}</div>
                    </div>
                    ${badge}
                </div>
            `;
        });

        return `
            <div id="skills-scroll-box" class="skill-scroll-box" style="flex:1; overflow-y:auto; padding-right:10px; display:grid; grid-template-columns:repeat(${SKILL_GRID_COLS}, 1fr); gap:10px; align-content:start; box-sizing:border-box;">
                ${skillsListHTML}
            </div>
        `;
    };

    // Choosing a node on the circle opens its sheet, there and then: one click,
    // one popup, with everything the skill is and the button that teaches it.
    // A node is never selected without being read.
    Scene_SkillEncyclopedia.prototype.selectGraphNode = function (skillId) {
        if (this._focusSkillId !== skillId && !this.focusSkillId(skillId)) return;
        this.scrollGraphToFocus();
        this.openFocusedSkill();
    };

    // Open the sheet of whatever the cursor is standing on.
    Scene_SkillEncyclopedia.prototype.openFocusedSkill = function () {
        const skill = this.focusedSkill();
        if (!skill) { SoundManager.playBuzzer(); return; }
        this._skillDetailWindow.setSkill(skill);
        this._viewMode = 'detail';
        this._selectedActionIndex = 0;
        SoundManager.playOk();
        this.refreshUISkillDOM();
    };

    // Directional movement over the circle, measured where the skills actually
    // are rather than on a lattice of rows: take the nearest node that lies
    // inside a cone the way the stick was pushed. That walks a ring and steps
    // out to the next one; running out of circle to the left or the right is what
    // turns the page to the school before or after this one.
    Scene_SkillEncyclopedia.prototype.moveGraphFocus = function (dx, dy) {
        this.ensureAtlasFocus();
        const atlas = this.currentAtlas();
        const from = atlas.index[this._focusSkillId];
        if (!from) return false;

        let best = null;
        let bestScore = Infinity;
        for (const circle of atlas.circles) {
            for (const node of circle.nodes) {
                if (node.id === from.id) continue;
                const vx = node.ax - from.ax;
                const vy = node.ay - from.ay;
                const along = vx * dx + vy * dy;
                if (along <= 1) continue;                   // not the way asked for
                const across = Math.abs(vx * dy - vy * dx);
                if (across > along * 1.9) continue;         // outside the cone
                const score = along + across * 2.2;
                if (score < bestScore) { bestScore = score; best = node; }
            }
        }
        if (!best) return false;
        this.focusSkillId(best.id);
        return true;
    };

    // Keep the cursor inside a comfortable margin of the window rather than
    // snapping the atlas on every step: walking one ring should not swing the
    // whole page about.
    Scene_SkillEncyclopedia.prototype.scrollGraphToFocus = function () {
        const box = document.getElementById('skill-atlas-box');
        const node = this.currentAtlas().index[this._focusSkillId];
        if (!box || !node) return;
        const zoom = this.atlasZoom();
        const x = node.ax * zoom;
        const y = node.ay * zoom;
        const padX = Math.min(box.clientWidth * 0.34, 260);
        const padY = Math.min(box.clientHeight * 0.34, 220);
        if (x < box.scrollLeft + padX) box.scrollLeft = x - padX;
        else if (x > box.scrollLeft + box.clientWidth - padX) box.scrollLeft = x - box.clientWidth + padX;
        if (y < box.scrollTop + padY) box.scrollTop = y - padY;
        else if (y > box.scrollTop + box.clientHeight - padY) box.scrollTop = y - box.clientHeight + padY;
    };

    // Put a whole circle on the page: the step taken when a school is opened from
    // the shelf, where the cursor could be anywhere on the atlas.
    Scene_SkillEncyclopedia.prototype.centreAtlasOnFocus = function () {
        const box = document.getElementById('skill-atlas-box');
        const node = this.currentAtlas().index[this._focusSkillId];
        if (!box || !node) return;
        const zoom = this.atlasZoom();
        box.scrollLeft = node.ax * zoom - box.clientWidth / 2;
        box.scrollTop = node.ay * zoom - box.clientHeight / 2;
    };

    // Only the cursor has changed: repaint the ring in place instead of
    // rebuilding a school's worth of nodes for one step.
    Scene_SkillEncyclopedia.prototype.repaintAtlasFocus = function () {
        const canvas = document.getElementById('skill-atlas-canvas');
        if (!canvas) return;
        const focusedId = this._focusSkillId;
        canvas.querySelectorAll('.sg-node').forEach((el) => {
            el.classList.toggle('sg-focus', parseInt(el.dataset.id, 10) === focusedId);
        });
        const title = document.getElementById('atlas-school-name');
        const activeCat = this.focusedCategory();
        if (title && activeCat) title.textContent = getCategoryDisplayName(activeCat);
    };

    //=========================================================================
    // The skill sheet
    //
    // One renderer for both places it can appear: the right page (a flat list
    // category, where the sheet is the facing page) and the popup that opens
    // over the atlas, where the circles own the whole spread.
    //=========================================================================
    Scene_SkillEncyclopedia.prototype.renderSkillDetailHTML = function (skill, knowledge, opts) {
        opts = opts || {};
        // In 'list' mode focus lives on the left skill grid, so the teach
        // buttons render unfocused (preview only); 'detail' mode lets them focus.
        const allowActionFocus = (this._viewMode === 'detail');

        // Teaching always targets the pupil chosen when the scene opened.
        let actionsListHTML = "";
        const actor = this.getTeachActor();
        if (actor) {
            const hasSkill = actor.isLearnedSkill(skill.id);
            const cost = $gameSystem.getSkillKnowledgeCost(skill.id, actor.actorId());
            const canAfford = knowledge >= cost;
            const isActionFocused = allowActionFocus && (this._selectedActionIndex === 0);

            // The grid rule: a skill is only for sale when the pupil is
            // standing next to it. The neighbours that would open it are
            // named, so a locked node reads as a route, not a wall.
            const isOpen = SkillGraph.isOpen(actor, skill.id);

            if (hasSkill) {
                actionsListHTML += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-success-green-15); border:1px solid var(--border-forest-green); border-radius:6px; color:var(--text-forest-complete); font-weight:bold; font-size:0.95rem;">
                        <span>${actor.name()}</span>
                        <span style="font-family:'Lora', serif; font-size:0.8rem; text-transform:uppercase;">✓ ${T('SkillMaster.learned')}</span>
                    </div>
                `;
                // Knowing a skill and carrying it into a fight are two different
                // things: the same loadout the skill menu edits is editable here,
                // so a skill just bought can be taken up without leaving training.
                actionsListHTML += this.carryToggleHTML(actor, skill, allowActionFocus);
                // A spell the pupil forged is theirs to name and theirs to unmake.
                actionsListHTML += this.fusionActionsHTML(actor, skill);
            } else if (!isOpen) {
                const openers = SkillGraph.openers(skill.id, actor).map(s => s.name);
                const lockLine = SkillGraph.isForbidden(skill.id)
                    ? T('SkillMaster.graph.lockedBySchool', { skills: openers.join(', ') })
                    : (openers.length ? T('SkillMaster.graph.lockedBy', { skills: openers.join(', ') })
                        : T('SkillMaster.graph.lockedHint'));
                actionsListHTML += `
                    <div style="padding:10px 14px; background:var(--bg-card-translucent-5); border:1px dashed var(--border-secondary-hover-translucent-15); border-radius:6px; font-family:'Lora', serif;">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; font-size:0.9rem; color:var(--text-card-medium);">
                            <span>${T('SkillMaster.graph.locked')}</span>
                            <span style="color:var(--shadow-shadow-alt-5-translucent-40);">${cost} KP</span>
                        </div>
                        <div style="margin-top:5px; font-size:0.76rem; line-height:1.35; color:var(--text-card-medium);">
                            ${lockLine}
                        </div>
                    </div>
                `;
            } else {
                actionsListHTML += `
                    <div class="action-button ${isActionFocused ? 'focused' : ''} ${!canAfford ? 'disabled' : ''}" onclick="SceneManager._scene.teachSkill(${actor.actorId()}, ${cost})" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:${isActionFocused ? 'var(--text-secondary-active)' : 'var(--accent-gray-2-translucent-0)'}; border:1px solid ${isActionFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:${canAfford ? 'pointer' : 'not-allowed'}; font-family:'Lora', serif; opacity:${canAfford ? 1 : 0.6}; transition:all 0.15s ease;">
                        <span style="font-weight:bold; color:${isActionFocused ? 'var(--text-pure-black)' : 'var(--text-card-medium)'};">${T('SkillMaster.teachPupil', { actor: actor.name() })}</span>
                        <span style="font-family:'Lora', serif; font-weight:bold; color:${isActionFocused ? 'var(--text-pure-black)' : canAfford ? 'var(--text-text-alt-3)' : 'var(--shadow-shadow-alt-5-translucent-40)'};">${cost} KP</span>
                    </div>
                `;
            }
        }

        // Full inspect block (Combat Application + Damage side by side, Skill
        // Effects, Classifications) built by the same service the Skills menu uses.
        const detailedInfoHTML = window.SkillDetails ? window.SkillDetails.build(skill, actor) : '';

        let descriptionText = skill.description || (T('SkillMaster.noDescriptionAvailable'));
        if (window.translateText) {
            descriptionText = window.translateText(descriptionText);
        }

        // Preview button (index 1): opens a zoomable / draggable 3D Effekseer
        // preview of the skill's animation over an empty target.
        const isPreviewFocused = allowActionFocus && (this._selectedActionIndex === 1);
        const previewBtnHTML = `
            <div class="action-button preview-button ${isPreviewFocused ? 'focused' : ''}" onclick="SceneManager._scene.openSpellPreview(${skill.id})" style="flex:0 0 auto; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:4px; padding:10px 16px; background:${isPreviewFocused ? 'var(--text-secondary-active)' : 'var(--bg-card-translucent-5)'}; border:1px solid ${isPreviewFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer; font-family:'Lora', serif; transition:all 0.15s ease;">
                <span style="font-size:1.15rem; line-height:1;">◈</span>
                <span style="font-weight:bold; text-transform:uppercase; font-size:0.78rem; color:${isPreviewFocused ? 'var(--text-pure-black)' : 'var(--text-secondary-active)'};">${T('SkillMaster.preview')}</span>
            </div>`;

        // Why an occult skill is priced where it is: the tag is on the card, so
        // a four-figure number reads as a reason rather than a mistake.
        const note = skill.note || '';
        const occultBadge = /<Forbidden>/i.test(note)
            ? `<span class="sg-occult sg-forbidden">${T('SkillMaster.tag.forbidden')}</span>`
            : (/<Esoteric>/i.test(note)
                ? `<span class="sg-occult">${T('SkillMaster.tag.esoteric')}</span>` : '');

        // A popup card is already a sized flex column, so the sheet grows into
        // it instead of claiming a height of its own.
        const rootSizing = opts.popup ? 'flex:1 1 auto; min-height:0;' : 'height:100%;';
        const closeBtnHTML = opts.popup
            ? `<div class="focusable" onclick="SceneManager._scene.dismissSkillDetail()" title="${T('SkillMaster.close')}" style="flex:0 0 auto; margin-left:auto; align-self:flex-start; width:26px; height:26px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-secondary-hover-translucent-15); border-radius:50%; color:var(--text-secondary-active); cursor:pointer; font-size:0.9rem; line-height:1;">✕</div>`
            : '';

        return `
            <div style="display:flex; flex-direction:column; gap:12px; ${rootSizing} box-sizing:border-box;">
                <div style="display:flex; align-items:center; gap:12px; border-bottom:2px solid var(--border-secondary-hover-translucent-15); padding-bottom:8px;">
                    <div style="${getSkillIconStyle(skill.iconIndex)} transform: scale(1.2); flex-shrink: 0; image-rendering: pixelated; margin-right: 2px;"></div>
                    <div>
                        <h3 class="cc-header-gothic" style="font-size:1.55rem; color:var(--text-secondary-active); margin:0; line-height:1.2;">
                            ${skill.name}
                        </h3>
                        <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:var(--text-inverse); text-transform:uppercase; font-family:'Lora', serif; letter-spacing:0.5px;">
                            <span>${getCategoryDisplayName(this.focusedCategory())}</span>
                            ${occultBadge}
                        </div>
                    </div>
                    ${closeBtnHTML}
                </div>

                <div style="font-style:italic; font-size:0.9rem; line-height:1.5; color:var(--text-highlight-active); background:var(--bg-card-translucent-5); border:1px solid var(--border-secondary-hover-translucent-15); border-radius:6px; padding:10px 14px;">
                    "${descriptionText}"
                </div>

                <div class="skill-scroll-box" style="flex:1; min-height:0; overflow-y:auto; padding-right:6px; font-family:'Lora', serif; font-size:0.95rem; color:var(--text-card-medium);">
                    ${detailedInfoHTML}
                </div>

                <div style="display:flex; flex-direction:column; gap:8px; margin-top:auto; border-top:1px dashed var(--scroll-thumb-hover-translucent-60); padding-top:12px;">
                    <h4 style="margin:0 0 4px 0; font-family:'Lora', serif; color:var(--text-secondary-active); font-size:1.15rem; text-align:center;">
                        ${T('SkillMaster.teach')}
                        <span style="font-size:0.8rem; font-weight:normal; color:var(--text-card-medium); letter-spacing:0.5px;">&middot; ${T('SkillMaster.atlas.held', { knowledge: knowledge })}</span>
                    </h4>
                    <div style="display:flex; gap:8px; align-items:stretch;">
                        <div style="flex:1; display:flex; flex-direction:column; gap:8px; max-height:150px; overflow-y:auto; padding-right:4px;">
                            ${actionsListHTML}
                        </div>
                        ${previewBtnHTML}
                    </div>
                </div>
            </div>
        `;
    };

    // Everything the popup draws: the skill, who is learning it, what they can
    // afford and which action the cursor is on.
    Scene_SkillEncyclopedia.prototype.skillPopupKey = function (skill, knowledge) {
        const actor = this.getTeachActor();
        // the carried state is part of what the sheet draws, so a carry toggle
        // has to move the key or the pane never rebuilds
        const LO = window.BattleLoadout;
        const carried = (LO && actor) ? `${LO.isActive(actor, skill) ? 1 : 0}${LO.count(actor)}` : '';
        return `${skill.id}|${actor ? actor.actorId() : 0}|${knowledge}|${this._selectedActionIndex}|${actor && actor.isLearnedSkill(skill.id) ? 1 : 0}|${carried}`;
    };

    Scene_SkillEncyclopedia.prototype.closeSkillDetailPopup = function () {
        const el = document.getElementById('skill-detail-popup');
        if (el && el.parentNode) el.parentNode.removeChild(el);
        this._lastPopupKey = null;
    };

    // Dismiss from the popup itself (its ✕ or the backdrop), which is the same
    // step Cancel takes: back to the atlas with nothing chosen.
    Scene_SkillEncyclopedia.prototype.dismissSkillDetail = function () {
        if (this._viewMode !== 'detail') return;
        this._viewMode = 'list';
        SoundManager.playCancel();
        this.refreshUISkillDOM();
    };

    // Choosing a node opens the skill's sheet as a BAR DOWN THE RIGHT of the
    // plate rather than a card over the middle of it: the figure stays visible
    // and stays draggable while the sheet is read, which a centred modal with a
    // scrim did not allow. Only the bar itself takes the pointer.
    Scene_SkillEncyclopedia.prototype.updateSkillDetailPopup = function (skill, knowledge) {
        if (!this._dndContainer) return;
        const key = this.skillPopupKey(skill, knowledge);
        let overlay = document.getElementById('skill-detail-popup');
        if (overlay && this._lastPopupKey === key) return;

        const cardHTML = this.renderSkillDetailHTML(skill, knowledge, { popup: true });
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'skill-detail-popup';
            // Explicit edges rather than the `inset` shorthand: the game's
            // Chromium collapses full-screen overlays written with it.
            overlay.style.cssText = "position:absolute; top:0; right:0; bottom:0; z-index:1500; display:flex; align-items:stretch; justify-content:flex-end; pointer-events:none; font-family:'Lora', serif;";
            this._dndContainer.appendChild(overlay);
        }
        overlay.innerHTML = `
            <div id="skill-detail-bar" onclick="event.stopPropagation()" style="pointer-events:auto; width:min(30vw, 460px); min-width:340px; height:100%; display:flex; flex-direction:column; overflow-y:auto; padding:18px 20px; box-sizing:border-box; background:var(--bg-dark-warm-translucent-96); border-left:1.5px solid var(--border-focus-hover); box-shadow:-10px 0 30px var(--shadow-black-translucent-75);">
                ${cardHTML}
            </div>`;
        this._lastPopupKey = key;
    };

    Scene_SkillEncyclopedia.prototype.refreshUISkillDOM = function () {
        if (!this._dndContainer) return;

        const useItalian = ConfigManager.language === 'it';
        const knowledge = $gameSystem.getKnowledge();

        // Keep KP discounts and category badges aligned with the chosen pupil's class.
        actorCategoryManager.setActor(this._teachActorId);

        // Persistent pupil switcher: the same companion-tab row the Skills scene
        // (CategorizedBattleSkills) uses, sitting in flow at the top-right of the
        // right page. Hidden in the Spell Forge and for single-member parties.
        const compRow = document.getElementById('skillmaster-companion-row');
        if (compRow) {
            const members = getSwitchableMembers();
            if (this._viewMode === 'spellEditor' || members.length <= 1) {
                compRow.style.display = 'none';
                compRow.innerHTML = '';
            } else {
                compRow.style.display = 'flex';
                let tabs = '';
                members.forEach((m, idx) => {
                    const sel = m.actorId() === this._teachActorId ? 'selected' : '';
                    tabs += `<div class="companion-tab ${sel}" onclick="SceneManager._scene.switchTeachActor(${idx})">${m.name()}</div>`;
                });
                compRow.innerHTML = window.CharSwitcher.inner(
                    `<div class="companion-tabs-row">${tabs}</div>`,
                    members.length
                );
            }
        }

        // 0. Layout: the category browser puts Skills on the left page and Magic
        //    on the right, and a flat-list category keeps its sheet on the facing
        //    page. The atlas is not a list, though: it takes BOTH pages and the
        //    skill's sheet becomes a popup opened on a chosen node.
        const graphSpread = (this._viewMode === 'list' || this._viewMode === 'detail' ||
            this._viewMode === 'preview') && this.usesGraphView();
        if (graphSpread) this.ensureAtlasFocus();
        const fullPageList = graphSpread;
        const spreadEl = this._dndContainer.querySelector('.book-spread');
        const leftPageEl = this._dndContainer.querySelector('.left-page');
        const rightPageEl = this._dndContainer.querySelector('.right-page');
        const spineEl = this._dndContainer.querySelector('.spine-divider');
        if (spreadEl) spreadEl.classList.toggle('skill-fullpage', fullPageList);
        if (leftPageEl) leftPageEl.style.width = fullPageList ? '100%' : '';
        if (rightPageEl) rightPageEl.style.display = fullPageList ? 'none' : '';
        if (spineEl) spineEl.style.display = fullPageList ? 'none' : '';

        // The pupil tabs live on the right page, which the atlas takes over, so
        // they move to the top-right corner of the page that is actually there.
        // They sit OUTSIDE #left-page-content, which is rebuilt by innerHTML.
        if (compRow && compRow.style.display !== 'none') {
            if (fullPageList && leftPageEl && compRow.parentNode !== leftPageEl) {
                leftPageEl.appendChild(compRow);
                compRow.style.position = 'absolute';
                compRow.style.top = '10px';
                compRow.style.right = '45px';
                compRow.style.zIndex = '12';
                compRow.style.marginBottom = '0';
            } else if (!fullPageList && rightPageEl && compRow.parentNode !== rightPageEl) {
                rightPageEl.insertBefore(compRow, rightPageEl.firstChild);
                compRow.style.position = '';
                compRow.style.top = '';
                compRow.style.right = '';
                compRow.style.zIndex = '';
                compRow.style.marginBottom = '10px';
            }
        }

        // The sheet popup belongs to the atlas alone; any other view takes it down.
        if (!graphSpread) this.closeSkillDetailPopup();

        // The Spell Forge editor owns a self-contained renderer (both pages are
        // rebuilt every refresh), so bail out of the shared category/detail pipeline.
        if (this._viewMode === 'spellEditor') {
            this.renderSpellEditor(useItalian, knowledge);
            return;
        }

        // Shared renderer for a column of category cards (used by both pages in
        // 'category' mode: pane 0 = Skills on the left, pane 1 = Magic on the right).
        const renderCategoryCardsHTML = (list, pane) => {
            let html = "";
            list.forEach((cat, idx) => {
                const focused = (this._categoryPane === pane && this._selectedCategoryIndex === idx);
                const catName = getCategoryDisplayName(cat);
                let bonusBadge = "";
                if (cat !== "All") {   // i18n-ignore: category id
                    if (actorCategoryManager.isPrimary(cat)) {
                        bonusBadge = `<span style="font-family:'Lora', serif; font-size:0.65rem; background:var(--text-secondary-active); color:var(--text-pure-black); border-radius:3px; padding:1px 5px; font-weight:bold; letter-spacing:0.5px;">${T('SkillMaster.kpMultiplier3x')}</span>`;
                    } else if (actorCategoryManager.isSecondary(cat)) {
                        bonusBadge = `<span style="font-family:'Lora', serif; font-size:0.65rem; background:var(--accent-gold-2); color:var(--bg-bg-alt-25-translucent-8); border-radius:3px; padding:1px 5px; font-weight:bold; letter-spacing:0.5px;">${T('SkillMaster.kpMultiplier15x')}</span>`;
                    } else if (actorCategoryManager.isForeign(cat)) {
                        bonusBadge = `<span style="font-family:'Lora', serif; font-size:0.65rem; background:transparent; color:var(--text-card-medium); border:1px solid var(--border-secondary-hover-translucent-15); border-radius:3px; padding:1px 5px; font-weight:bold; letter-spacing:0.5px; font-style:italic;">${T('SkillMaster.foreignSchool')}</span>`;
                    }
                }
                html += `
                    <div class="category-card ${focused ? 'focused' : ''}" data-pane="${pane}" data-idx="${idx}" onclick="SceneManager._scene.selectCategoryClick(${pane}, ${idx})" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:8px; padding:14px 8px; min-height:100px; background:${focused ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--bg-card-translucent-5)'}; border:1.5px solid ${focused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:8px; cursor:pointer; font-family:'Lora', serif; transition:all 0.15s ease;">
                        <div style="${getCategoryIconStyle(cat)} transform: scale(1.35); flex-shrink: 0; image-rendering: pixelated;"></div>
                        <div class="category-card-name" style="font-weight:bold; color:${focused ? 'var(--text-secondary-active)' : 'var(--text-card-medium)'}; font-size:0.92rem; line-height:1.2;">
                            ${catName}
                        </div>
                        ${bonusBadge}
                    </div>
                `;
            });
            return html;
        };

        // 1. Determine if Left Page needs full rebuild
        const leftPageBox = document.getElementById('left-page-content');
        if (!leftPageBox) return;

        // The atlas is redrawn when its colours could have changed (a skill was
        // learned, the pupil changed); moving the cursor over it only repaints
        // the focus ring, so walking a whole school stays cheap. Opening or
        // closing the sheet over it is not a rebuild either; turning the page to
        // another school is, since that is a different circle entirely.
        const graphKey = this.usesGraphView() ? this.graphStateKey() : null;
        const leftMode = graphSpread ? 'atlas' : this._viewMode;   // i18n-ignore: cache key
        const needsLeftRebuild = (this._lastLeftMode !== leftMode) ||
            (leftMode !== 'atlas' && this._viewMode !== 'category' &&   // i18n-ignore: cache key
                this._lastLeftCategory !== this._selectedCategory) ||
            (graphKey !== null && graphKey !== this._lastGraphKey);

        // A rebuilt atlas comes back scrolled to its corner; the reader was
        // somewhere else entirely, so remember where and put them back.
        const oldAtlasBox = needsLeftRebuild ? document.getElementById('skill-atlas-box') : null;
        const keptScroll = oldAtlasBox
            ? { left: oldAtlasBox.scrollLeft, top: oldAtlasBox.scrollTop } : null;

        if (needsLeftRebuild) {
            this._lastGraphKey = graphKey;
            let leftPageHTML = "";
            if (this._viewMode === 'category') {
                const split = getSplitSkillCategories();
                const categoriesListHTML = renderCategoryCardsHTML(split.Skill, 0);

                const backBtnText = T('SkillMaster.back');
                const skillsTitle = T('SkillMaster.skills');

                leftPageHTML = `
                    <div class="page-header-bar" style="width: 100%;">
                      <div class="back-button focusable" onclick="SceneManager._scene.categoryBack()">${backBtnText}</div>
                      <h2 class="cc-header-gothic" style="border: none; margin: 0; padding: 0; text-align: center; font-size: 1.85rem;">${skillsTitle}</h2>
                    </div>
                    <div id="category-scroll-box-left" class="skill-scroll-box" style="flex:1; overflow-y:auto; padding-right:10px; display:grid; grid-template-columns:repeat(${CATEGORY_PAGE_COLS}, 1fr); gap:10px; align-content:start; box-sizing:border-box;">
                        ${categoriesListHTML}
                    </div>
                `;
            } else {
                const returnBtnText = T('SkillMaster.back');
                const onAtlas = this.usesGraphView();
                const bodyHTML = onAtlas
                    ? this.renderSkillAtlasHTML()
                    : this.renderSkillListHTML();
                // On the atlas the heading names the school on the page, and it
                // is rewritten in place when the pager turns to another.
                const heading = onAtlas ? this.focusedCategory() : this._selectedCategory;
                leftPageHTML = `
                    <div class="page-header-bar" style="width: 100%;">
                      <div class="back-button focusable" onclick="SceneManager._scene.goBack()">${returnBtnText}</div>
                      <h2 id="atlas-school-name" class="cc-header-gothic" style="border: none; margin: 0; padding: 0; text-align: center; font-size: 1.55rem;">${getCategoryDisplayName(heading)}</h2>
                    </div>
                    ${bodyHTML}
                `;
            }

            leftPageBox.innerHTML = leftPageHTML;
            this._lastLeftMode = leftMode;
            this._lastLeftCategory = this._selectedCategory;
        }

        // 2. Left Page focus updating
        if (this._viewMode === 'category') {
            // Both pages hold category cards; the focused one lives in the active pane.
            const applyFocus = (boxId, pane) => {
                const box = document.getElementById(boxId);
                if (!box) return;
                box.querySelectorAll('.category-card').forEach((card) => {
                    const idx = parseInt(card.dataset.idx, 10);
                    const focused = (this._categoryPane === pane && this._selectedCategoryIndex === idx);
                    card.classList.toggle('focused', focused);
                    card.style.borderColor = focused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)';
                    card.style.background = focused ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--bg-card-translucent-5)';
                    const nameDiv = card.querySelector('.category-card-name');
                    if (nameDiv) nameDiv.style.color = focused ? 'var(--text-secondary-active)' : 'var(--text-card-medium)';
                });
            };
            applyFocus('category-scroll-box-left', 0);
            applyFocus('category-scroll-box-right', 1);
            const fuseEl = document.querySelector('.fuse-spells-btn');
            if (fuseEl) {
                const on = !!this._categoryFuseFocused;
                fuseEl.classList.toggle('focused', on);
                fuseEl.style.background = on ? 'var(--text-secondary-active)' : 'var(--bg-card-translucent-5)';
                fuseEl.style.color = on ? 'var(--text-pure-black)' : 'var(--text-secondary-active)';
                if (on && fuseEl.scrollIntoView) fuseEl.scrollIntoView({ block: 'nearest' });
            }
        } else if (this.usesGraphView()) {
            this.repaintAtlasFocus();
            if (needsLeftRebuild) {
                this.bindAtlasPointer();
                // A rebuilt atlas starts in its corner, so put the reader back
                // where they were standing (after teaching, after a redraw).
                if (keptScroll) {
                    const box = document.getElementById('skill-atlas-box');
                    if (box) { box.scrollLeft = keptScroll.left; box.scrollTop = keptScroll.top; }
                    this.scrollGraphToFocus();
                } else {
                    this.centreAtlasOnFocus();
                }
            }
        } else {
            const cards = leftPageBox.querySelectorAll('.skill-card');
            cards.forEach((card, idx) => {
                if (idx === this._selectedSkillIndex) {
                    card.classList.add('focused');
                    card.style.borderColor = 'var(--text-secondary-active)';
                    const nameDiv = card.querySelector('div:last-child div:last-child');
                    if (nameDiv) nameDiv.style.color = 'var(--text-secondary-active)';
                } else {
                    card.classList.remove('focused');
                    card.style.borderColor = 'var(--border-secondary-hover-translucent-15)';
                    const nameDiv = card.querySelector('div:last-child div:last-child');
                    if (nameDiv) nameDiv.style.color = 'var(--text-card-medium)';
                }
            });
        }

        // 3. Determine if Right Page needs full rebuild
        const rightPageBox = document.getElementById('right-page-content');
        if (!rightPageBox) return;

        const skill = this.focusedSkill();
        const skillId = skill ? skill.id : null;

        // On the atlas there is no facing page to read: the sheet is a popup, and
        // only for a node the player actually chose. Walking the circles shows
        // nothing but the circles.
        if (graphSpread) {
            if (this._viewMode === 'detail' && skill) {
                this.updateSkillDetailPopup(skill, knowledge);
            } else if (this._viewMode !== 'preview') {
                this.closeSkillDetailPopup();
            }
            // The right page is out of sight, so whatever it holds is stale:
            // force a clean rebuild the next time it is shown.
            this._lastRightMode = null;
            this._lastRightSkillId = null;
            this._lastRightKnowledge = null;
            return;
        }

        const needsRightRebuild = (this._lastRightMode !== this._viewMode) ||
            ((this._viewMode === 'detail' || this._viewMode === 'list') && this._lastRightSkillId !== skillId) ||
            (this._viewMode === 'detail' && this._lastRightActionIndex !== this._selectedActionIndex) ||
            (this._lastRightKnowledge !== knowledge);

        if (needsRightRebuild) {
            let rightPageHTML = "";

            if (this._viewMode === 'category') {
                const split = getSplitSkillCategories();
                const magicListHTML = renderCategoryCardsHTML(split.Magic, 1);
                const magicTitle = T('SkillMaster.magic');
                const teachActor = this.getTeachActor();
                const pupilLine = teachActor
                    ? `<div style="font-family:'Lora', serif; font-size:0.85rem; color:var(--text-card-medium); text-align:center; margin-top:8px;">${T('SkillMaster.pupil')} <strong style="color:var(--text-secondary-active);">${teachActor.name()}</strong> &middot; ${knowledge} KP</div>`
                    : '';
                const fuseLabel = T('SkillMaster.fuseSpells');
                // The Fuse Spells action sits BELOW the magic grid (not tucked into
                // the header), as a clear full-width button.
                // NOTE: must NOT use the .back-button class here; a global CSS rule
                // forces .back-button to position:absolute;left:0, which would rip
                // this out of flow and drop it on top of the real Back button.
                const fuseBtn = `
                    <div class="fuse-spells-btn focusable" onclick="SceneManager._scene.openSpellEditor()" title="${T('SkillMaster.fuseSpellsShiftX')}" style="position:relative; display:flex; align-items:center; justify-content:center; gap:6px; margin-top:12px; padding:10px 14px; font-family:'Lora',serif; font-size:0.9rem; background:var(--bg-card-translucent-5); color:var(--text-secondary-active); border-radius:6px; font-weight:bold; cursor:pointer; border:1.5px solid var(--text-secondary-active); text-transform:uppercase; letter-spacing:0.5px; user-select:none;">${fuseLabel}</div>`;
                rightPageHTML = `
                    <div style="position: relative; display:flex; align-items:center; justify-content:center; border-bottom: 2px dashed var(--border-success); padding-bottom: 8px; margin-bottom: 20px; min-height: 40px; width: 100%;">
                      <h2 class="cc-header-gothic" style="border: none; margin: 0; padding: 0; text-align: center; font-size: 1.85rem;">${magicTitle}</h2>
                    </div>
                    <div id="category-scroll-box-right" class="skill-scroll-box" style="flex:1; overflow-y:auto; padding-right:10px; display:grid; grid-template-columns:repeat(${CATEGORY_PAGE_COLS}, 1fr); gap:10px; align-content:start; box-sizing:border-box;">
                        ${magicListHTML}
                    </div>
                    ${fuseBtn}
                    ${pupilLine}
                `;
            } else if (this._viewMode === 'list' || this._viewMode === 'detail') {
                if (!skill) {
                    rightPageHTML = `
                        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; gap:20px; padding:20px; box-sizing:border-box;">
                            <div style="${getCategoryIconStyle('All')} transform: scale(2.0); image-rendering: pixelated; filter: drop-shadow(0px 3px 6px var(--shadow-primary-hover-translucent-5)); margin-bottom: 12px;"></div>
                            <h3 class="cc-header-gothic" style="font-size:1.6rem; color:var(--text-secondary-active); margin:0;">
                                ${T('SkillMaster.selectASkill')}
                            </h3>
                        </div>
                    `;
                } else {
                    rightPageHTML = this.renderSkillDetailHTML(skill, knowledge, { popup: false });
                }
            }

            rightPageBox.innerHTML = rightPageHTML;
            this._lastRightMode = this._viewMode;
            this._lastRightSkillId = skillId;
            this._lastRightActionIndex = this._selectedActionIndex;
            this._lastRightKnowledge = knowledge;
        }

        // Detail action buttons (Teach / Preview) are re-rendered with their
        // focus styling whenever _selectedActionIndex changes (see the rebuild
        // condition above), so no extra DOM patching is needed here.
    };

    // Pupil switch from the persistent top-right tabs (or Tab / bumpers), the same
    // switcher the Skills scene uses; there is no separate member-select step.
    Scene_SkillEncyclopedia.prototype.switchTeachActor = function (index) {
        const members = getSwitchableMembers();
        const actor = members[index];
        if (!actor || actor.actorId() === this._teachActorId) return;
        this._teachActorId = actor.actorId();
        actorCategoryManager.setActor(this._teachActorId);
        SoundManager.playCursor();
        // The browsable categories are the new pupil's schools, so the old cursor
        // means nothing: drop the cached lists and start at the first card.
        this._splitCategoriesCache = null;
        this._skillsByCategoryKey = null;
        this._categoryPane = 0;
        this._selectedCategoryIndex = 0;
        this._categoryFuseFocused = false;
        // "All" is a different list for a different pupil, so the old skill cursor
        // is meaningless either way.
        this._selectedSkillIndex = 0;
        // A school the new pupil does not study is not theirs to be taught from,
        // so browsing one when the pupil changes drops back to the shelf.
        const allowed = actorCategoryManager.allowedCategories();
        const stillOpen = !this._selectedCategory || this._selectedCategory === 'All' ||   // i18n-ignore: category id
            !allowed || allowed.includes(this._selectedCategory);
        // A different pupil studies a different curriculum, so the school on the
        // page may not be one of theirs at all and nothing that was remembered
        // about the old one applies.
        this._atlasZoom = 0;
        this._atlasMemory = {};
        if (this._atlasCategory && allowed && !allowed.includes(this._atlasCategory)) {
            this._atlasCategory = null;
        }
        if (!stillOpen && (this._viewMode === 'list' || this._viewMode === 'detail')) {
            this._viewMode = 'category';
            this._selectedCategory = null;
        } else if (this.usesGraphView()) {
            // Same circle, different pupil: stand them where they already are on it.
            this.defaultGraphFocus();
        }
        // Learned badges, KP costs and available fusions are pupil-specific, so
        // force a clean redraw of both pages.
        this._lastLeftMode = null;
        this._lastLeftCategory = null;
        this._lastRightMode = null;
        this._lastRightSkillId = null;
        this._lastRightKnowledge = null;
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.cycleTeachActor = function (dir) {
        const members = getSwitchableMembers();
        if (members.length <= 1) return;
        const cur = members.findIndex(m => m.actorId() === this._teachActorId);
        const next = ((cur < 0 ? 0 : cur) + dir + members.length) % members.length;
        this.switchTeachActor(next);
    };

    Scene_SkillEncyclopedia.prototype.selectCategory = function () {
        const split = getSplitSkillCategories();
        const list = this._categoryPane === 1 ? split.Magic : split.Skill;
        const cat = list[this._selectedCategoryIndex];
        if (!cat) { SoundManager.playBuzzer(); return; }
        this._selectedCategory = cat;
        this._skillListWindow.setCategory(this._selectedCategory);
        this._viewMode = 'list';
        this._selectedSkillIndex = 0;
        // One school to a page: the chosen one, or the first of the curriculum
        // when "All" was picked, since "all of them" is not a circle.
        const schools = this.atlasCategories();
        this._atlasCategory = schools.includes(cat) ? cat : (schools[0] || null);
        this._atlasZoom = 0;
        this._focusSkillId = 0;
        // The pupil stands where they already stand on that circle, rather than at
        // its way in.
        if (this.usesGraphView()) this.defaultGraphFocus();
        SoundManager.playOk();
        this.refreshUISkillDOM();
        this.centreAtlasOnFocus();
    };

    Scene_SkillEncyclopedia.prototype.selectCategoryClick = function (pane, index) {
        this._categoryPane = pane;
        this._selectedCategoryIndex = index;
        // Clicking a category takes the cursor off the Fuse Spells button, so the
        // pad does not come back to a stale highlight on it.
        this._categoryFuseFocused = false;
        this.selectCategory();
    };

    // Back from the category browser leaves the scene (the member picker step
    // has been removed; the pupil is chosen via the persistent top switcher).
    Scene_SkillEncyclopedia.prototype.categoryBack = function () {
        this.popScene();
    };

    Scene_SkillEncyclopedia.prototype.selectSkill = function (index) {
        this._selectedSkillIndex = index;
        const skills = getSkillsByCategory(this._selectedCategory);
        const skill = skills[this._selectedSkillIndex];
        if (skill) {
            this._focusSkillId = skill.id;
            this._skillDetailWindow.setSkill(skill);
            this._viewMode = 'detail';
            this._selectedActionIndex = 0;
            SoundManager.playOk();
            this.refreshUISkillDOM();
        }
    };

    // Whether a skill the pupil already knows is carried into battle, toggled
    // from the training sheet. The store is CategorizedBattleSkills' own, so
    // this and the skill menu are editing one loadout, not two.
    Scene_SkillEncyclopedia.prototype.carryToggleHTML = function (actor, skill, allowFocus) {
        const LO = window.BattleLoadout;
        if (!LO) return '';
        const locked = LO.isAlwaysCarried(actor, skill);
        const active = LO.isActive(actor, skill);
        const full = !active && !locked && !LO.hasRoom(actor);
        const label = locked ? T('SkillMaster.carry.locked')
            : active ? T('SkillMaster.carry.drop')
                : full ? T('SkillMaster.carry.full') : T('SkillMaster.carry.take');
        const count = `${LO.count(actor)} / ${LO.MAX}`;
        const focused = allowFocus && (this._selectedActionIndex === 0) && !locked;
        const usable = !locked && (active || !full);
        return `
            <div class="action-button carry-button ${focused ? 'focused' : ''} ${usable ? '' : 'disabled'}" onclick="SceneManager._scene.toggleCarry(${actor.actorId()})" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; margin-top:6px; background:${active ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--accent-gray-2-translucent-0)'}; border:1px solid ${focused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:${usable ? 'pointer' : 'not-allowed'}; font-family:'Lora', serif; opacity:${usable ? 1 : 0.6}; transition:all 0.15s ease;">
                <span style="font-weight:bold; font-size:0.9rem; text-transform:uppercase;">${active ? '◉' : '○'} ${label}</span>
                <span style="font-size:0.8rem; color:var(--text-card-medium);">${count}</span>
            </div>
        `;
    };

    // A fused spell has two things an ordinary skill has not: a name its maker
    // chose, and no database entry to fall back on. Both are edited here.
    Scene_SkillEncyclopedia.prototype.fusionActionsHTML = function (actor, skill) {
        if (!skill || !skill._customSpell || skill._ownerActorId !== actor.actorId()) return '';
        const btn = (label, handler, danger) => `
            <div class="action-button focusable" onclick="${handler}" style="flex:1; display:flex; justify-content:center; align-items:center; padding:9px 12px; background:var(--accent-gray-2-translucent-0); border:1px solid ${danger ? 'var(--text-danger-hover)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer; font-family:'Lora', serif; font-size:0.84rem; font-weight:bold; text-transform:uppercase; color:${danger ? 'var(--text-danger-hover)' : 'var(--text-secondary-active)'};">${label}</div>`;
        return `
            <div style="display:flex; gap:8px; margin-top:6px;">
                ${btn(T('SkillMaster.fusion.rename'), `SceneManager._scene.beginRenameFusion(${skill.id})`, false)}
                ${btn(T('SkillMaster.fusion.delete'), `SceneManager._scene.deleteFusion(${skill.id})`, true)}
            </div>
            <div id="fusion-rename-row" style="display:none; gap:8px; margin-top:6px;">
                <input id="fusion-rename-input" maxlength="24" value="${String(skill.name).replace(/"/g, '&quot;')}" style="flex:1; padding:8px 10px; font-family:'Lora', serif; font-size:0.9rem; color:var(--text-pure-white); background:var(--bg-card-translucent-5); border:1px solid var(--text-secondary-active); border-radius:6px; outline:none;" />
                ${btn(T('SkillMaster.fusion.confirm'), `SceneManager._scene.commitRenameFusion(${skill.id})`, false)}
            </div>
        `;
    };

    Scene_SkillEncyclopedia.prototype.beginRenameFusion = function () {
        const row = document.getElementById('fusion-rename-row');
        const input = document.getElementById('fusion-rename-input');
        if (!row || !input) return;
        row.style.display = 'flex';
        input.focus();
        input.select();
        // The engine reads the keyboard globally; while the field has it, it does not.
        input.onkeydown = (e) => e.stopPropagation();
        input.onkeyup = (e) => e.stopPropagation();
    };

    Scene_SkillEncyclopedia.prototype.commitRenameFusion = function (skillId) {
        const input = document.getElementById('fusion-rename-input');
        const skill = $dataSkills[skillId];
        const name = input ? String(input.value || '').trim().slice(0, 24) : '';
        if (!skill || !skill._customSpell || !name) { SoundManager.playBuzzer(); return; }
        skill.name = name;
        // The stored copy is what survives the save; $dataSkills is rebuilt from it.
        const stored = $gameSystem.getCustomSpells().find(s => s && s.id === skillId);
        if (stored) stored.name = name;
        SoundManager.playOk();
        this.invalidateLearnedSkillCaches();
        this._lastPopupKey = null;
        this.refreshUISkillDOM();
    };

    // Unmaking a fusion is not splitting it: the components are gone for good,
    // which is why it asks once before it does it.
    Scene_SkillEncyclopedia.prototype.deleteFusion = function (skillId) {
        const skill = $dataSkills[skillId];
        const actor = this.getTeachActor();
        if (!skill || !skill._customSpell || !actor) { SoundManager.playBuzzer(); return; }
        if (this._pendingFusionDelete !== skillId) {
            this._pendingFusionDelete = skillId;
            SoundManager.playBuzzer();
            this._skillDetailWindow.showMessage(T('SkillMaster.fusion.confirmDelete', { skill: skill.name }));
            return;
        }
        this._pendingFusionDelete = 0;
        const name = skill.name;
        if (window.BattleLoadout) window.BattleLoadout.drop(actor, skillId);
        actor.forgetSkill(skillId);
        $gameSystem.removeCustomSpell(skillId);
        this.invalidateLearnedSkillCaches();
        this._focusSkillId = 0;
        this._viewMode = 'list';
        this.closeSkillDetailPopup();
        SoundManager.playCancel();
        this._skillDetailWindow.showMessage(T('SkillMaster.fusion.deleted', { skill: name }));
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.toggleCarry = function (actorId) {
        const LO = window.BattleLoadout;
        const actor = $gameActors.actor(actorId);
        const skill = this.focusedSkill();
        if (!LO || !actor || !skill || !actor.isLearnedSkill(skill.id)) {
            SoundManager.playBuzzer();
            return;
        }
        const result = LO.toggle(actor, skill);
        if (result === 'locked' || result === 'full') {
            SoundManager.playBuzzer();
            this._skillDetailWindow.showMessage(
                result === 'full' ? T('SkillMaster.carry.fullToast', { max: LO.MAX })
                    : T('SkillMaster.carry.lockedToast', { skill: skill.name }));
        } else {
            SoundManager.playEquip();
            this._skillDetailWindow.showMessage(result === 'on'
                ? T('SkillMaster.carry.takenToast', { skill: skill.name })
                : T('SkillMaster.carry.droppedToast', { skill: skill.name }));
        }
        this.refreshUISkillDOM();
    };

    // Sandbox play, and a party led by somebody called "test", is a workshop:
    // the whole book is buyable in any order and knowledge never runs out.
    function isWorkshopMode() {
        if ($gameSystem && ($gameSystem._isSandboxMode || $gameSystem._sandboxKnowledgePointsGiven)) return true;
        const leader = $gameParty && $gameParty.allMembers && $gameParty.allMembers()[0];
        return !!(leader && leader.name && leader.name().toLowerCase() === 'test');
    }
    window.SkillMasterWorkshop = isWorkshopMode;

    Scene_SkillEncyclopedia.prototype.teachSkill = function (actorId, cost) {
        const actor = $gameActors.actor(actorId);
        const skill = this.focusedSkill();
        if (!actor || !skill || (!isWorkshopMode() && $gameSystem.getKnowledge() < cost)) {
            SoundManager.playBuzzer();
            return;
        }
        // The adjacency rule is enforced here, not just drawn: the flat "All"
        // list and the mouse both come through this door.
        if (!isWorkshopMode() && !SkillGraph.isOpen(actor, skill.id)) {
            SoundManager.playBuzzer();
            this._skillDetailWindow.showMessage(T('SkillMaster.graph.lockedToast', { skill: skill.name }));
            this.refreshUISkillDOM();
            return;
        }
        if (!isWorkshopMode()) $gameSystem.spendKnowledge(cost);
        actor.learnSkill(skill.id);
        this.invalidateLearnedSkillCaches();
        SoundManager.playRecovery();

        this._skillDetailWindow.showMessage(
            T('SkillMaster.actorLearned', { actor: actor.name(), skill: skill.name })
        );

        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.goBack = function () {
        this._viewMode = 'category';
        SoundManager.playCancel();
        this.refreshUISkillDOM();
    };

    //=========================================================================
    // Spell animation preview
    //
    // Opens a modal overlay showing a zoomable / draggable 3D Effekseer preview
    // of a skill's animation played over an empty target dummy. Reuses the
    // MonsterTournament free-orbit camera idea (drag = rotate, wheel = zoom) via
    // the isolated AnimPreview Effekseer context.
    //=========================================================================
    Scene_SkillEncyclopedia.prototype.openSpellPreview = function (skillId) {
        const skill = $dataSkills[skillId];
        if (!skill) { SoundManager.playBuzzer(); return; }
        this._previewSkillId = skillId;
        this._viewMode = 'preview';
        SoundManager.playOk();
        this.buildSpellPreviewOverlay(skill);
    };

    Scene_SkillEncyclopedia.prototype.closeSpellPreview = function () {
        AnimPreview.dispose();
        const ov = document.getElementById('spell-preview-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        this._viewMode = 'detail';
        SoundManager.playCancel();
    };

    Scene_SkillEncyclopedia.prototype.buildSpellPreviewOverlay = function (skill) {
        if (!this._dndContainer) return;
        const useItalian = ConfigManager.language === 'it';
        const anim = skill.animationId && $dataAnimations ? $dataAnimations[skill.animationId] : null;
        const previewable = !!(anim && anim.effectName && !anim.frames);
        const animLabel = anim && anim.name
            ? `#${skill.animationId} · ${anim.name}`
            : (T('SkillMaster.noAnimation'));
        const noEfkNote = previewable ? '' :
            `<div style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; text-align:center; color:var(--text-card-medium); font-style:italic; font-size:0.9rem; pointer-events:none;">${T('SkillMaster.no3dAnimationForThis')}</div>`;

        const old = document.getElementById('spell-preview-overlay');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const ov = document.createElement('div');
        ov.id = 'spell-preview-overlay';
        // Explicit top/left/right/bottom (not the `inset` shorthand) and a
        // width + max-width pair (not `min()`), so the modal still fills the
        // scene and sizes correctly on the game's older Chromium.
        ov.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; z-index:2000; display:flex; align-items:center; justify-content:center; background:var(--shadow-black-translucent-75); font-family:\'Lora\',serif;';
        ov.innerHTML = `
            <div style="width:82%; max-width:560px; max-height:88%; display:flex; flex-direction:column; gap:12px; padding:20px; box-sizing:border-box; background:var(--bg-dark-warm-translucent-96); border:1.5px solid var(--border-focus-hover); border-radius:12px; box-shadow:0 10px 30px var(--shadow-black-translucent-75);">
                <div style="display:flex; align-items:center; gap:12px; border-bottom:2px solid var(--border-secondary-hover-translucent-15); padding-bottom:8px;">
                    <div style="${getSkillIconStyle(skill.iconIndex)} transform:scale(1.1); flex-shrink:0; image-rendering:pixelated;"></div>
                    <h3 class="cc-header-gothic" style="font-size:1.45rem; color:var(--text-secondary-active); margin:0;">${skill.name}</h3>
                </div>
                <div id="spell-preview-stage" style="position:relative; width:100%; height:300px; border-radius:10px; overflow:hidden; border:1.5px solid var(--border-secondary-hover-translucent-15); background:radial-gradient(circle at 50% 42%, var(--bg-tertiary-focus-translucent-45) 0%, var(--shadow-heavy) 78%);">
                    <!-- Empty target dummy: a ground disc with a target reticle. -->
                    <div style="position:absolute; left:50%; bottom:26px; transform:translate(-50%, 0) perspective(420px) rotateX(66deg); width:150px; height:150px; border-radius:50%; border:2px solid var(--accent-gold-translucent-50); box-shadow:0 0 0 18px var(--accent-gold-translucent-16) inset; background:radial-gradient(circle, var(--accent-gold-translucent-16) 0%, transparent 70%);"></div>
                    <div style="position:absolute; left:50%; bottom:88px; transform:translateX(-50%); width:2px; height:70px; background:linear-gradient(to bottom, transparent, var(--accent-gold-translucent-50)); pointer-events:none;"></div>
                    <canvas id="spell-preview-canvas" style="position:absolute; top:0; left:0; width:100%; height:100%; cursor:grab; touch-action:none;"></canvas>
                    ${noEfkNote}
                </div>
                <div style="text-align:center; font-size:0.82rem; color:var(--text-secondary-active); font-weight:bold;">${animLabel}</div>
                <div style="text-align:center; font-size:0.78rem; color:var(--text-card-medium); font-style:italic;">${T('SkillMaster.dragToRotateScrollTo')}</div>
                <div style="display:flex; gap:10px; margin-top:2px;">
                    <div class="focusable" onclick="SceneManager._scene.replaySpellPreview()" style="flex:1; text-align:center; padding:9px; background:var(--text-text-alt-3); color:var(--text-pure-black); border-radius:6px; cursor:pointer; font-weight:bold; text-transform:uppercase;">${T('SkillMaster.replay')}</div>
                    <div class="focusable" onclick="SceneManager._scene.closeSpellPreview()" style="flex:0 0 auto; text-align:center; padding:9px 18px; background:transparent; color:var(--text-primary-hover); border:1.5px solid var(--text-primary-hover); border-radius:6px; cursor:pointer; font-weight:bold; text-transform:uppercase;">${T('SkillMaster.close')}</div>
                </div>
            </div>`;
        this._dndContainer.appendChild(ov);

        // Size + initialise the isolated Effekseer canvas once laid out.
        requestAnimationFrame(() => {
            if (this._viewMode !== 'preview') return;
            const canvas = document.getElementById('spell-preview-canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            canvas.width = Math.max(64, Math.floor(rect.width));
            canvas.height = Math.max(64, Math.floor(rect.height));
            if (previewable && AnimPreview.isSupported() && AnimPreview.init(canvas, true)) {
                AnimPreview.setAnimation(skill.animationId);
            }
        });
    };

    Scene_SkillEncyclopedia.prototype.replaySpellPreview = function () {
        const skill = $dataSkills[this._previewSkillId];
        if (skill && skill.animationId) AnimPreview.setAnimation(skill.animationId);
        SoundManager.playCursor();
    };

    Scene_SkillEncyclopedia.prototype.updateSpellPreviewInput = function () {
        if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
            this.closeSpellPreview();
        } else if (Input.isTriggered('ok')) {
            this.replaySpellPreview();
        }
    };

    //=========================================================================
    // Fuse Spells (custom spell editor)
    //
    // Left-page focus layout:
    //   0     -> Dominant slot (a Spell / Magic; defines the fusion's behaviour)
    //   1     -> Recessive slot (a Spell OR a Skill; defines the result's type)
    //   2     -> animation row
    //   3     -> Fuse button
    //   4..   -> Split buttons (one per existing fused ability)
    //=========================================================================
    const FORGE_DOMINANT_IDX = 0;
    const FORGE_RECESSIVE_IDX = 1;
    const FORGE_ANIM_IDX = 2;
    const FORGE_CREATE_IDX = 3;
    const FORGE_SPLIT_BASE = 4;

    // Skills the pupil could feed into a slot: learned, non-basic, non-fused, and
    // matching the slot's type (dominant wants Magic "spells", recessive accepts
    // any Spell or Skill).
    //=========================================================================
    // Per-frame dataset caches
    //
    // Scene_SkillEncyclopedia.update() runs every frame and (before these
    // caches) re-derived full skill datasets from $dataSkills on each frame -
    // regexes per skill, actor.skills() filters, etc. These wrappers recompute
    // only when the underlying selection/actor changes and otherwise return the
    // cached result. Keys auto-invalidate on category/skill/actor change.
    //=========================================================================
    // Invalidate caches whose result depends on the actor's learned-skill set
    // (which category/skill/actor keys can't detect on their own).
    Scene_SkillEncyclopedia.prototype.invalidateLearnedSkillCaches = function () {
        this._editorCandidatesKey = null;
        // A fusion made or unmade changes $dataSkills, which both the graph and
        // the plate were built from.
        SkillGraph.invalidate();
        SkillAtlas.invalidate();
        this._splitCategoriesCache = null;
    };

    Scene_SkillEncyclopedia.prototype.getSplitCategoriesCached = function () {
        // Categories derive from $dataSkills (static for the scene lifetime) and
        // from the pupil's class, which the top switcher can change.
        if (!this._splitCategoriesCache || this._splitCategoriesActorId !== this._teachActorId) {
            actorCategoryManager.setActor(this._teachActorId);
            this._splitCategoriesActorId = this._teachActorId;
            this._splitCategoriesCache = getSplitSkillCategories();
        }
        return this._splitCategoriesCache;
    };

    Scene_SkillEncyclopedia.prototype.getSkillsByCategoryCached = function (category) {
        // "All" is scoped to the pupil's schools, so the key carries them both.
        const key = `${this._teachActorId}:${category}`;
        if (this._skillsByCategoryKey !== key) {
            actorCategoryManager.setActor(this._teachActorId);
            this._skillsByCategoryKey = key;
            this._skillsByCategoryCache = getSkillsByCategory(category);
        }
        return this._skillsByCategoryCache;
    };

    Scene_SkillEncyclopedia.prototype.getEditorCandidatesCached = function (slotIndex) {
        const actor = this.getTeachActor();
        // The candidate set depends on the slot, the actor and which components
        // are already chosen; none of those change during list navigation.
        const key = `${slotIndex}:${actor ? actor.actorId() : 0}:${this._editorSlots.join(',')}`;
        if (this._editorCandidatesKey !== key) {
            this._editorCandidatesKey = key;
            this._editorCandidatesCache = this.getEditorCandidates(slotIndex);
        }
        return this._editorCandidatesCache;
    };

    Scene_SkillEncyclopedia.prototype.getEditorCandidates = function (slotIndex) {
        const actor = this.getTeachActor();
        if (!actor) return [];
        // Dominant (slot 0) accepts only Magic. Recessive (slot 1) accepts any
        // Spell or Skill - picking a Skill here turns the fusion into a skill.
        const dominantSlot = (slotIndex === FORGE_DOMINANT_IDX);
        const chosenElsewhere = this._editorSlots.filter((id, i) => id != null && i !== slotIndex);
        return actor.skills().filter(s => {
            if (!s || !s.name) return false;
            if (s.id === 1 || s.id === 2) return false;       // Attack / Guard
            if (s._customSpell) return false;                  // no nesting fused spells
            if (!actor.isLearnedSkill(s.id)) return false;     // must be forgettable
            if (chosenElsewhere.includes(s.id)) return false;  // no duplicates across slots
            // Skills that call a Common Event (effect code 44) can't be fused - their
            // event side-effects wouldn't survive fusion.
            if (Array.isArray(s.effects) && s.effects.some(e => e && e.code === Game_Action.EFFECT_COMMON_EVENT)) return false;
            const cat = getSkillCategory(s.id);
            // "Basic" category skills are excluded from fusion entirely.
            if (cat && cat.toLowerCase() === 'basic') return false;
            const type = cat ? getCategoryType(cat) : 'Skill';   // i18n-ignore: category id
            // Dominant must be Magic; recessive accepts Magic or Skill.
            return dominantSlot ? type === 'Magic' : true;   // i18n-ignore: category id
        });
    };

    Scene_SkillEncyclopedia.prototype.getEditorCustomSpells = function () {
        const actor = this.getTeachActor();
        if (!actor) return [];
        return $gameSystem.getCustomSpells().filter(s =>
            s && s._ownerActorId === actor.actorId() && actor.isLearnedSkill(s.id));
    };

    // Previewable animations = named Effekseer animations (MV frame anims can't be
    // shown in the isolated preview canvas).
    Scene_SkillEncyclopedia.prototype.getAvailableAnimations = function () {
        if (!this._animCache) {
            this._animCache = [];
            if (typeof $dataAnimations !== 'undefined' && $dataAnimations) {
                for (const a of $dataAnimations) {
                    if (a && a.name && a.name.trim() && a.effectName) this._animCache.push(a);
                }
            }
        }
        return this._animCache;
    };

    // Default the fused ability's animation to the dominant spell, then recessive.
    Scene_SkillEncyclopedia.prototype.getDefaultAnimId = function () {
        for (const id of this._editorSlots) {
            const sk = id && $dataSkills[id];
            if (sk && sk.animationId > 0) return sk.animationId;
        }
        return 0;
    };

    Scene_SkillEncyclopedia.prototype.openSpellEditor = function () {
        this._viewMode = 'spellEditor';
        this._editorSlots = [null, null];
        this._editorFocus = 0;
        this._editorPicking = false;
        this._editorPickIndex = 0;
        this._editorAnimPicking = false;
        this._editorAnimPickIndex = 0;
        this._editorAnimId = 0;
        SoundManager.playOk();
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.closeSpellEditor = function () {
        AnimPreview.dispose();
        this._viewMode = 'category';
        this._editorPicking = false;
        this._editorAnimPicking = false;
        // Force a clean rebuild of the shared pages after leaving the editor.
        this._lastLeftMode = null;
        this._lastLeftCategory = null;
        this._lastRightMode = null;
        this._lastRightSkillId = null;
        this._lastRightKnowledge = null;
        SoundManager.playCancel();
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.editorFocusSlot = function (i) {
        this._editorFocus = i;
        const candidates = this.getEditorCandidates(i);
        if (candidates.length === 0) { SoundManager.playBuzzer(); this.refreshUISkillDOM(); return; }
        this._editorPicking = true;
        this._editorPickIndex = 0;
        SoundManager.playOk();
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.editorPickCandidate = function (k) {
        const candidates = this.getEditorCandidates(this._editorFocus);
        const skill = candidates[k];
        if (!skill) { SoundManager.playBuzzer(); return; }
        this._editorSlots[this._editorFocus] = skill.id;
        this._editorPicking = false;
        // Keep the animation default in sync until the player overrides it.
        if (!this._editorAnimId) this._editorAnimId = this.getDefaultAnimId();
        SoundManager.playOk();
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.openAnimPicker = function () {
        if (typeof $dataAnimations === 'undefined' || !$dataAnimations) { SoundManager.playBuzzer(); return; }
        const list = this.getAvailableAnimations();
        if (!list.length) { SoundManager.playBuzzer(); return; }
        if (this._editorAnimId <= 0 || !$dataAnimations[this._editorAnimId]) {
            this._editorAnimId = this.getDefaultAnimId();
        }
        this._animBackupId = this._editorAnimId;
        let idx = list.findIndex(a => a.id === this._editorAnimId);
        if (idx < 0) idx = 0;
        this._editorAnimPickIndex = idx;
        this._editorAnimId = list[idx].id;
        this._editorAnimPicking = true;
        SoundManager.playOk();
        this.refreshUISkillDOM();
    };

    // Lightweight update while browsing animations: swap the previewed effect and
    // repaint the list highlight WITHOUT rebuilding the canvas (which would restart
    // the Effekseer context every keypress).
    Scene_SkillEncyclopedia.prototype.editorAnimHighlight = function (k) {
        const list = this.getAvailableAnimations();
        if (!list.length) return;
        k = ((k % list.length) + list.length) % list.length;
        this._editorAnimPickIndex = k;
        this._editorAnimId = list[k].id;

        const box = document.getElementById('anim-list-box');
        if (box) {
            box.querySelectorAll('.anim-row').forEach(row => {
                const ri = parseInt(row.dataset.idx, 10);
                const on = ri === k;
                row.classList.toggle('focused', on);
                row.style.borderColor = on ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)';
                row.style.background = on ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--accent-gray-2-translucent-0)';
            });
        }
        const label = document.getElementById('anim-preview-label');
        if (label) label.textContent = `#${list[k].id} · ${list[k].name}`;
        AnimPreview.setAnimation(this._editorAnimId);
        SoundManager.playCursor();
        this.scrollToActiveItem('anim-list-box', '#anim-list-box .anim-row.focused');   // i18n-ignore: CSS selector
    };

    Scene_SkillEncyclopedia.prototype.editorConfirmAnim = function () {
        this._editorAnimPicking = false;
        AnimPreview.dispose();
        this._editorFocus = FORGE_ANIM_IDX;
        SoundManager.playOk();
        this.refreshUISkillDOM();
    };

    Scene_SkillEncyclopedia.prototype.editorCancelAnim = function () {
        this._editorAnimPicking = false;
        this._editorAnimId = this._animBackupId || this.getDefaultAnimId();
        AnimPreview.dispose();
        SoundManager.playCancel();
        this.refreshUISkillDOM();
    };

    // Knowledge price of the pair currently in the slots (0 when incomplete).
    Scene_SkillEncyclopedia.prototype.editorFusionCost = function () {
        if (!this._editorSlots.every(x => x != null)) return 0;
        const actor = this.getTeachActor();
        return kpFusionCost(this._editorSlots, actor ? actor.actorId() : 0);
    };

    Scene_SkillEncyclopedia.prototype.editorCreate = function () {
        if (!this._editorSlots.every(x => x != null)) { SoundManager.playBuzzer(); return; }
        const actor = this.getTeachActor();
        const components = this._editorSlots.map(id => $dataSkills[id]);
        if (components.some(c => !c)) { SoundManager.playBuzzer(); return; }

        const cost = kpFusionCost(this._editorSlots, actor.actorId());
        if ($gameSystem.getKnowledge() < cost) { SoundManager.playBuzzer(); return; }
        $gameSystem.spendKnowledge(cost);

        const animId = (this._editorAnimId && this._editorAnimId > 0) ? this._editorAnimId : this.getDefaultAnimId();
        const fused = buildFusedSkill(components, actor.actorId(), animId);
        $gameSystem.addCustomSpell(fused);
        // Component spells/skills are consumed by the fusion.
        for (const id of this._editorSlots) actor.forgetSkill(id);
        actor.learnSkill(fused.id);
        this.invalidateLearnedSkillCaches();

        this._editorSlots = [null, null];
        this._editorAnimId = 0;
        this._editorFocus = FORGE_CREATE_IDX;
        SoundManager.playRecovery();

        window.skipLocalization = true;
        $gameMessage.add(T('SkillMaster.fusedResult', {
            name: fused.name, cost: cost, left: $gameSystem.getKnowledge(),
        }));
        window.skipLocalization = false;

        this.refreshUISkillDOM();
    };

    // Split a fused spell back into its components (reverses editorCreate).
    Scene_SkillEncyclopedia.prototype.editorSplit = function (spellId) {
        const actor = this.getTeachActor();
        const spell = $dataSkills[spellId];
        if (!spell || !spell._components) { SoundManager.playBuzzer(); return; }
        const parts = spell._components.slice();

        actor.forgetSkill(spellId);
        for (const cid of parts) actor.learnSkill(cid);
        this.invalidateLearnedSkillCaches();
        $gameSystem.removeCustomSpell(spellId);

        this._editorFocus = FORGE_CREATE_IDX;
        SoundManager.playRecovery();

        window.skipLocalization = true;
        $gameMessage.add(T('SkillMaster.splitResult', { name: spell.name }));
        window.skipLocalization = false;

        this.refreshUISkillDOM();
    };

    // Bring the isolated Effekseer preview up on the freshly-rendered canvas.
    Scene_SkillEncyclopedia.prototype.setupAnimPreview = function () {
        requestAnimationFrame(() => {
            if (this._viewMode !== 'spellEditor' || !this._editorAnimPicking) return;
            const canvas = document.getElementById('anim-preview-canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            canvas.width = Math.max(64, Math.floor(rect.width));
            canvas.height = Math.max(64, Math.floor(rect.height));
            if (AnimPreview.isSupported() && AnimPreview.init(canvas)) {
                AnimPreview.setAnimation(this._editorAnimId);
            }
        });
    };

    Scene_SkillEncyclopedia.prototype.renderSpellEditor = function (useItalian, knowledge) {
        const leftBox = document.getElementById('left-page-content');
        const rightBox = document.getElementById('right-page-content');
        if (!leftBox || !rightBox) return;
        const actor = this.getTeachActor();
        const picking = this._editorPicking;
        const animPicking = this._editorAnimPicking;

        // ---- LEFT PAGE : dominant + recessive slots + animation + fuse + list ----
        const slotMeta = [
            { label: T('SkillMaster.dominantSpell'),
              hint: T('SkillMaster.magicOnlyDefinesTheEffect') },
            { label: T('SkillMaster.recessiveSpellOrSkill'),
              hint: T('SkillMaster.spellOrSkillSetsThe') }
        ];
        let slotsHTML = '';
        this._editorSlots.forEach((id, i) => {
            const skill = id ? $dataSkills[id] : null;
            const focused = !animPicking && this._editorFocus === i;
            const meta = slotMeta[i] || { label: '', hint: '' };
            // For a filled recessive slot, show whether it makes a Skill or Spell.
            let typeBadge = '';
            if (skill && i === FORGE_RECESSIVE_IDX) {
                const cat = getSkillCategory(skill.id);
                const isSkill = cat ? getCategoryType(cat) !== 'Magic' : false;   // i18n-ignore: category id
                const bLabel = isSkill ? (T('SkillMaster.skill')) : (T('SkillMaster.magic'));
                typeBadge = `<span style="margin-left:6px; font-family:'Lora',serif; font-size:0.6rem; text-transform:uppercase; color:var(--accent-badge-text); background:var(--accent-badge-yellow); border-radius:3px; padding:1px 5px; font-weight:bold;">${bLabel}</span>`;
            }
            const inner = skill
                ? `<div style="display:flex; align-items:center; gap:10px;"><div style="${getSkillIconStyle(skill.iconIndex)} transform:scale(0.75); flex-shrink:0; image-rendering:pixelated;"></div><span style="font-weight:bold; color:var(--text-primary-hover);">${skill.name}</span><span style="margin-left:auto; font-size:0.72rem; color:var(--text-card-medium);">MP ${skill.mpCost} · AP ${skill.tpCost}</span></div>`
                : `<span style="font-style:italic; color:var(--text-card-medium);">${T('SkillMaster.emptyPressToChoose')}</span>`;
            slotsHTML += `
                <div class="focusable ${focused ? 'focused' : ''}" onclick="SceneManager._scene.editorFocusSlot(${i})" style="display:flex; flex-direction:column; gap:4px; padding:9px 13px; background:${focused ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--bg-card-translucent-5)'}; border:1.5px solid ${focused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:8px; cursor:pointer; transition:all 0.15s ease;">
                    <span style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-secondary-active); font-weight:bold;">${meta.label}${typeBadge}</span>
                    ${inner}
                    <span style="font-size:0.62rem; color:var(--text-card-medium); font-style:italic;">${meta.hint}</span>
                </div>`;
        });

        // Animation row
        const animId = (this._editorAnimId && this._editorAnimId > 0) ? this._editorAnimId : this.getDefaultAnimId();
        const animData = animId && $dataAnimations ? $dataAnimations[animId] : null;
        const animName = animData ? `#${animId} · ${animData.name}` : (T('SkillMaster.default'));
        const animFocused = !animPicking && this._editorFocus === FORGE_ANIM_IDX;
        const animRowHTML = `
            <div class="focusable ${animFocused ? 'focused' : ''}" onclick="SceneManager._scene.openAnimPicker()" style="display:flex; flex-direction:column; gap:4px; padding:9px 13px; background:${animFocused ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--bg-card-translucent-5)'}; border:1.5px solid ${animFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:8px; cursor:pointer; transition:all 0.15s ease;">
                <span style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-secondary-active); font-weight:bold;">${T('SkillMaster.animation')}</span>
                <span style="font-weight:bold; color:var(--text-primary-hover);">${animName}</span>
            </div>`;

        const allFilled = this._editorSlots.every(x => x != null);
        const fuseCost = allFilled ? this.editorFusionCost() : 0;
        const canPay = !allFilled || knowledge >= fuseCost;
        const canForge = allFilled && canPay;
        const createFocused = !animPicking && this._editorFocus === FORGE_CREATE_IDX;
        const costTag = allFilled
            ? ` <span style="font-size:0.78rem; opacity:0.85;">&middot; ${fuseCost} KP</span>`
            : '';
        const createHTML = `
            <div class="focusable ${createFocused ? 'focused' : ''} ${canForge ? '' : 'disabled'}" onclick="SceneManager._scene.editorCreate()" style="display:flex; justify-content:center; align-items:center; padding:12px; margin-top:4px; background:${canForge ? (createFocused ? 'var(--text-secondary-active)' : 'var(--text-text-alt-3)') : 'var(--shadow-primary-hover-translucent-5)'}; color:${canForge ? 'var(--text-pure-black)' : 'var(--text-text-alt-12)'}; border:1px solid var(--border-secondary-hover-translucent-15); border-radius:8px; cursor:${canForge ? 'pointer' : 'not-allowed'}; font-weight:bold; text-transform:uppercase; font-family:'Lora', serif; transition:all 0.15s ease;">
                ${T('SkillMaster.fuseSpells2')}${costTag}
            </div>
            <div style="text-align:center; font-family:'Lora',serif; font-size:0.78rem; color:${canPay ? 'var(--text-card-medium)' : 'var(--text-danger-hover)'};">
                ${T('SkillMaster.knowledge')}: <strong>${knowledge} KP</strong>${allFilled && !canPay ? (T('SkillMaster.notEnough')) : ''}
            </div>`;

        const customSpells = this.getEditorCustomSpells();
        let fusedListHTML = '';
        customSpells.forEach((s, k) => {
            const focusIdx = FORGE_SPLIT_BASE + k;
            const focused = !animPicking && this._editorFocus === focusIdx;
            fusedListHTML += `
                <div class="focusable ${focused ? 'focused' : ''}" onclick="SceneManager._scene.editorSplit(${s.id})" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:${focused ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--bg-card-translucent-5)'}; border:1px solid ${focused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer;">
                    <span style="display:flex; align-items:center; gap:8px; font-weight:bold; color:var(--text-primary-hover);"><div style="${getSkillIconStyle(s.iconIndex)} transform:scale(0.7); flex-shrink:0; image-rendering:pixelated;"></div>${s.name}</span>
                    <span style="font-family:'Lora',serif; font-size:0.7rem; text-transform:uppercase; color:var(--text-secondary-active); border:1px solid var(--border-danger-active); border-radius:3px; padding:1px 6px;">${T('SkillMaster.split')}</span>
                </div>`;
        });
        if (!fusedListHTML) fusedListHTML = `<div style="font-style:italic; color:var(--text-card-medium); font-size:0.85rem; padding:4px;">${T('SkillMaster.noFusedSpellsYet')}</div>`;

        const backBtn = T('SkillMaster.back');
        const title = T('SkillMaster.fuseSpells3');
        leftBox.innerHTML = `
            <div class="page-header-bar" style="margin-bottom: 14px; width: 100%;">
              <div class="back-button focusable" onclick="SceneManager._scene.closeSpellEditor()">${backBtn}</div>
              <h2 class="cc-header-gothic" style="border:none; margin:0; padding:0; text-align:center; font-size:1.7rem;">${title}</h2>
            </div>
            <div style="display:flex; flex-direction:column; gap:9px;">
                ${slotsHTML}
                ${animRowHTML}
                ${createHTML}
            </div>
            <div style="border-top:1px dashed var(--scroll-thumb-hover-translucent-60); margin:14px 0 8px 0;"></div>
            <h4 style="margin:0 0 8px 0; font-family:'Lora',serif; color:var(--text-secondary-active); font-size:1.02rem; text-align:center;">${T('SkillMaster.fusedSpells')}</h4>
            <div id="fused-scroll-box" class="skill-scroll-box" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:6px; min-height:60px;">
                ${fusedListHTML}
            </div>`;

        // ---- RIGHT PAGE ----
        let rightHTML = '';
        if (picking) {
            const slotIdx = this._editorFocus;
            const candidates = this.getEditorCandidates(slotIdx);
            let candHTML = '';
            candidates.forEach((s, k) => {
                const focused = this._editorPickIndex === k;
                candHTML += `
                    <div class="focusable ${focused ? 'focused' : ''}" onclick="SceneManager._scene.editorPickCandidate(${k})" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:${focused ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--accent-gray-2-translucent-0)'}; border:1px solid ${focused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer;">
                        <span style="display:flex; align-items:center; gap:8px; font-weight:bold; color:${focused ? 'var(--text-secondary-active)' : 'var(--text-card-medium)'};"><div style="${getSkillIconStyle(s.iconIndex)} transform:scale(0.72); flex-shrink:0; image-rendering:pixelated;"></div>${s.name}</span>
                        <span style="font-size:0.72rem; color:var(--text-inverse);">MP ${s.mpCost} · AP ${s.tpCost}</span>
                    </div>`;
            });
            if (!candHTML) candHTML = `<div style="font-style:italic; color:var(--text-card-medium); text-align:center; margin-top:20px;">${T('SkillMaster.noAvailableSkillsForThis')}</div>`;
            const pickTitle = slotIdx === FORGE_DOMINANT_IDX
                ? (T('SkillMaster.chooseDominantSpell'))
                : (T('SkillMaster.chooseRecessive'));
            rightHTML = `
                <div style="display:flex; align-items:center; justify-content:center; border-bottom:2px dashed var(--border-success); padding-bottom:8px; margin-bottom:16px; min-height:40px;">
                  <h2 class="cc-header-gothic" style="border:none; margin:0; padding:0; text-align:center; font-size:1.5rem;">${pickTitle}</h2>
                </div>
                <div id="candidates-scroll-box" class="skill-scroll-box" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:6px;">
                    ${candHTML}
                </div>`;
        } else if (animPicking) {
            const list = this.getAvailableAnimations();
            const cur = list[this._editorAnimPickIndex] || list[0];
            const faceX = (actor.faceIndex() % 4) * 144;
            const faceY = Math.floor(actor.faceIndex() / 4) * 144;
            let rowsHTML = '';
            list.forEach((a, k) => {
                const on = this._editorAnimPickIndex === k;
                rowsHTML += `
                    <div class="anim-row ${on ? 'focused' : ''}" data-idx="${k}" onclick="SceneManager._scene.editorAnimHighlight(${k})" style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:${on ? 'var(--bg-tertiary-focus-translucent-45)' : 'var(--accent-gray-2-translucent-0)'}; border:1px solid ${on ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:5px; cursor:pointer;">
                        <span style="font-weight:bold; color:${on ? 'var(--text-secondary-active)' : 'var(--text-primary-hover)'}; font-size:0.85rem;">${a.name}</span>
                        <span style="font-size:0.68rem; color:var(--text-card-medium);">#${a.id}</span>
                    </div>`;
            });
            const pickTitle = T('SkillMaster.chooseAnimation');
            const useLbl = T('SkillMaster.use');
            const backLbl = T('SkillMaster.cancel');
            rightHTML = `
                <div style="display:flex; flex-direction:column; height:100%; box-sizing:border-box;">
                    <div style="display:flex; align-items:center; justify-content:center; border-bottom:2px dashed var(--border-success); padding-bottom:6px; margin-bottom:10px; min-height:34px;">
                      <h2 class="cc-header-gothic" style="border:none; margin:0; padding:0; text-align:center; font-size:1.35rem;">${pickTitle}</h2>
                    </div>
                    <div style="position:relative; width:100%; height:210px; border-radius:8px; overflow:hidden; border:1.5px solid var(--border-secondary-hover-translucent-15); background:radial-gradient(circle at 50% 40%, var(--bg-tertiary-focus-translucent-45) 0%, var(--shadow-heavy) 100%); perspective:600px;">
                        <div style="position:absolute; left:50%; bottom:6px; transform:translateX(-50%) rotateX(8deg); width:150px; height:150px; background:url('img/faces/${actor.faceName()}.png') -${faceX}px -${faceY}px no-repeat; image-rendering:pixelated; filter:drop-shadow(0 6px 10px var(--shadow-primary-hover-translucent-5));"></div>
                        <canvas id="anim-preview-canvas" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></canvas>
                    </div>
                    <div id="anim-preview-label" style="text-align:center; font-family:'Lora',serif; font-size:0.85rem; color:var(--text-secondary-active); font-weight:bold; margin:8px 0;">${cur ? `#${cur.id} · ${cur.name}` : ''}</div>
                    <div id="anim-list-box" class="skill-scroll-box" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:5px; padding-right:6px; min-height:60px;">
                        ${rowsHTML}
                    </div>
                    <div style="display:flex; gap:8px; margin-top:8px;">
                        <div class="focusable" onclick="SceneManager._scene.editorConfirmAnim()" style="flex:1; text-align:center; padding:9px; background:var(--text-text-alt-3); color:var(--text-pure-black); border-radius:6px; cursor:pointer; font-weight:bold; text-transform:uppercase; font-family:'Lora',serif;">${useLbl}</div>
                        <div class="focusable" onclick="SceneManager._scene.editorCancelAnim()" style="flex:0 0 auto; text-align:center; padding:9px 14px; background:transparent; color:var(--text-primary-hover); border:1.5px solid var(--text-primary-hover); border-radius:6px; cursor:pointer; font-weight:bold; text-transform:uppercase; font-family:'Lora',serif;">${backLbl}</div>
                    </div>
                </div>`;
        } else {
            const filledIds = this._editorSlots.filter(x => x != null);
            if (filledIds.length === this._editorSlots.length) {
                const filled = this._editorSlots.map(id => $dataSkills[id]);
                const dominant = filled[FORGE_DOMINANT_IDX];
                const recessive = filled[FORGE_RECESSIVE_IDX];
                const previewName = makeFusedSpellName(filled.map(s => s.name));
                const mp = filled.reduce((a, s) => a + (s.mpCost || 0), 0);
                const ap = filled.reduce((a, s) => a + (s.tpCost || 0), 0);
                const recCat = recessive ? getSkillCategory(recessive.id) : null;
                const resultIsSkill = recCat ? getCategoryType(recCat) !== 'Magic' : false;   // i18n-ignore: category id
                const resultKind = resultIsSkill ? (T('SkillMaster.skill')) : (T('SkillMaster.magic'));
                const previewCost = this.editorFusionCost();
                rightHTML = `
                    <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; text-align:center; gap:14px; padding:20px; box-sizing:border-box;">
                        <h3 class="cc-header-gothic" style="font-size:1.4rem; color:var(--text-secondary-active); margin:0;">${T('SkillMaster.preview2')}</h3>
                        <div style="font-size:1.9rem; font-weight:bold; color:var(--text-text-alt-3); font-family:'Lora',serif;">${previewName}</div>
                        <span style="font-family:'Lora',serif; font-size:0.72rem; text-transform:uppercase; color:var(--accent-badge-text); background:var(--accent-badge-yellow); border-radius:3px; padding:2px 8px; font-weight:bold;">${T('SkillMaster.becomesA')} ${resultKind}</span>
                        <div style="display:flex; gap:26px; font-size:1.05rem; color:var(--text-primary-hover);"><div><strong>${T('SkillMaster.mpLabel')}</strong> ${mp}</div><div><strong>${T('SkillMaster.apLabel')}</strong> ${ap}</div></div>
                        <div style="font-size:1.02rem; color:${knowledge >= previewCost ? 'var(--text-secondary-active)' : 'var(--text-danger-hover)'};"><strong>${T('SkillMaster.fusionCost')}</strong> ${previewCost} KP <span style="font-size:0.82rem; color:var(--text-card-medium);">(${T('SkillMaster.youHold')} ${knowledge})</span></div>
                        <div style="border-top:1px dashed var(--scroll-thumb-hover-translucent-60); width:80%;"></div>
                        <div style="font-size:0.9rem; color:var(--text-card-medium); font-style:italic;">${T('SkillMaster.dominant')} <strong style="color:var(--text-secondary-active);">${dominant.name}</strong> &middot; ${T('SkillMaster.recessive')} <strong style="color:var(--text-secondary-active);">${recessive.name}</strong></div>
                        <div style="font-size:0.82rem; color:var(--text-card-medium); line-height:1.5; max-width:85%;">${T('SkillMaster.theDominantDefinesDamageAnd')}</div>
                    </div>`;
            } else {
                rightHTML = `
                    <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; text-align:center; gap:16px; padding:24px; box-sizing:border-box;">
                        <div style="${getCategoryIconStyle('All')} transform:scale(1.8); image-rendering:pixelated;"></div>
                        <h3 class="cc-header-gothic" style="font-size:1.4rem; color:var(--text-secondary-active); margin:0;">${T('SkillMaster.fuseSpells3')}</h3>
                        <div style="font-size:0.95rem; color:var(--text-card-medium); font-style:italic; line-height:1.5; max-width:88%;">${T('SkillMaster.forgeBlurb', { actor: actor.name(), knowledge: knowledge })}</div>
                    </div>`;
            }
        }

        rightBox.innerHTML = rightHTML;

        if (animPicking) this.setupAnimPreview();
    };

    Scene_SkillEncyclopedia.prototype.updateSpellEditorInput = function () {
        // Component-picking sub-mode (right list of the pupil's skills).
        if (this._editorPicking) {
            const candidates = this.getEditorCandidatesCached(this._editorFocus);
            const max = candidates.length;
            if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                this._editorPicking = false;
                SoundManager.playCancel();
                this.refreshUISkillDOM();
                return;
            }
            if (max === 0) return;
            const prev = this._editorPickIndex;
            if (Input.isTriggered('ok')) { this.editorPickCandidate(this._editorPickIndex); return; }
            else if (Input.isTriggered('down') || Input.isRepeated('down')) {
                this._editorPickIndex = (this._editorPickIndex + 1) % max;
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                this._editorPickIndex = (this._editorPickIndex - 1 + max) % max;
            }
            if (this._editorPickIndex !== prev) {
                SoundManager.playCursor();
                this.refreshUISkillDOM();
                this.scrollToActiveItem('candidates-scroll-box', '#candidates-scroll-box .focused');
            }
            return;
        }

        // Animation-picking sub-mode (3D viewbox + list).
        if (this._editorAnimPicking) {
            const list = this.getAvailableAnimations();
            const max = list.length;
            if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                this.editorCancelAnim();
                return;
            }
            if (max === 0) return;
            if (Input.isTriggered('ok')) { this.editorConfirmAnim(); return; }
            else if (Input.isTriggered('down') || Input.isRepeated('down')) {
                this.editorAnimHighlight(this._editorAnimPickIndex + 1);
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                this.editorAnimHighlight(this._editorAnimPickIndex - 1);
            }
            return;
        }

        // Main slots navigation.
        const customCount = this.getEditorCustomSpells().length;
        const maxFocus = FORGE_SPLIT_BASE + customCount;
        const prev = this._editorFocus;

        if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
            this.closeSpellEditor();
            return;
        } else if (Input.isTriggered('ok')) {
            if (this._editorFocus <= FORGE_RECESSIVE_IDX) {
                this.editorFocusSlot(this._editorFocus);
            } else if (this._editorFocus === FORGE_ANIM_IDX) {
                this.openAnimPicker();
            } else if (this._editorFocus === FORGE_CREATE_IDX) {
                this.editorCreate();
            } else {
                const list = this.getEditorCustomSpells();
                const spell = list[this._editorFocus - FORGE_SPLIT_BASE];
                if (spell) this.editorSplit(spell.id); else SoundManager.playBuzzer();
            }
            return;
        } else if (Input.isTriggered('down') || Input.isRepeated('down')) {
            this._editorFocus = (this._editorFocus + 1) % maxFocus;
        } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
            this._editorFocus = (this._editorFocus - 1 + maxFocus) % maxFocus;
        }

        if (this._editorFocus !== prev) {
            SoundManager.playCursor();
            this.refreshUISkillDOM();
            this.scrollToActiveItem('fused-scroll-box', '#fused-scroll-box .focused');
        }
    };

    Scene_SkillEncyclopedia.prototype.scrollToActiveItem = function (containerId, selector) {
        const container = document.getElementById(containerId);
        const active = document.querySelector(selector);
        if (container && active) {
            const containerRect = container.getBoundingClientRect();
            const activeRect = active.getBoundingClientRect();
            if (activeRect.bottom > containerRect.bottom) {
                container.scrollTop += (activeRect.bottom - containerRect.bottom) + 10;
            } else if (activeRect.top < containerRect.top) {
                container.scrollTop -= (containerRect.top - activeRect.top) + 10;
            }
        }
    };

    Scene_SkillEncyclopedia.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);

        const useItalian = ConfigManager.language === 'it';

        // Bumpers (L1/R1) switch the pupil from any browsing view, mirroring the
        // Tab shortcut and the top-right switcher tabs.
        if (this._viewMode !== 'spellEditor' && this._viewMode !== 'preview' && getSwitchableMembers().length > 1) {
            if (Input.isTriggered('pagedown')) { this.cycleTeachActor(1); return; }
            if (Input.isTriggered('pageup')) { this.cycleTeachActor(-1); return; }
        }

        if (this._viewMode === 'category') {
            // Two side-by-side panes: 0 = Skills (left), 1 = Magic (right).
            const split = this.getSplitCategoriesCached();
            const lists = [split.Skill, split.Magic];
            const cols = CATEGORY_PAGE_COLS;
            let pane = this._categoryPane;
            let idx = this._selectedCategoryIndex;
            const prevPane = pane, prevIdx = idx;
            const curLen = lists[pane].length;

            // Fuse Spells used to be reachable only by mouse or the undiscoverable
            // SHIFT/X hotkey. It is now a real focus target below the Magic grid:
            // walk down off the last row to reach it, up to go back.
            if (this._categoryFuseFocused) {
                if (Input.isTriggered('ok')) {
                    this.openSpellEditor();
                    return;
                }
                if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                    this.categoryBack();
                    return;
                }
                if (Input.isTriggered('up') || Input.isRepeated('up') ||
                    Input.isTriggered('left') || Input.isRepeated('left')) {
                    this._categoryFuseFocused = false;
                    SoundManager.playCursor();
                    this.refreshUISkillDOM();
                }
                return;
            }

            if (Input.isTriggered('shift')) {
                this.openSpellEditor();
                return;
            } else if (Input.isTriggered('ok')) {
                this.selectCategory();
                return;
            } else if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                this.categoryBack();
                return;
            } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
                const col = idx % cols;
                if (col === cols - 1 && pane === 0 && lists[1].length > 0) {
                    const row = Math.floor(idx / cols);
                    pane = 1;
                    idx = Math.min(row * cols, lists[1].length - 1);
                } else if (idx + 1 < curLen) {
                    idx += 1;
                }
            } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
                const col = idx % cols;
                if (col === 0 && pane === 1 && lists[0].length > 0) {
                    const row = Math.floor(idx / cols);
                    pane = 0;
                    idx = Math.min(row * cols + (cols - 1), lists[0].length - 1);
                } else if (idx - 1 >= 0) {
                    idx -= 1;
                }
            } else if (Input.isTriggered('down') || Input.isRepeated('down')) {
                if (idx + cols < curLen) {
                    idx += cols;
                } else if (pane === 1 && idx === curLen - 1) {
                    // Already on the bottom row of Magic: step onto Fuse Spells.
                    this._categoryFuseFocused = true;
                    SoundManager.playCursor();
                    this.refreshUISkillDOM();
                    return;
                } else {
                    idx = curLen - 1;
                }
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                if (idx - cols >= 0) {
                    idx -= cols;
                }
            }

            if (pane !== prevPane || idx !== prevIdx) {
                this._categoryPane = pane;
                this._selectedCategoryIndex = idx;
                SoundManager.playCursor();
                this.refreshUISkillDOM();
                const boxId = pane === 1 ? 'category-scroll-box-right' : 'category-scroll-box-left';
                this.scrollToActiveItem(boxId, `#${boxId} .category-card.focused`);   // i18n-ignore: CSS selector
            }
        } else if (this._viewMode === 'list') {
            // On the atlas the cursor walks the circles rather than a wrapping
            // list, so it is asked first: the flat list is only the fallback for
            // a curriculum with no graph data at all.
            if (this.usesGraphView()) {
                if (Input.isTriggered('ok')) {
                    this.openFocusedSkill();
                    return;
                }
                if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                    this._viewMode = 'category';
                    SoundManager.playCancel();
                    this.refreshUISkillDOM();
                    return;
                }
                if (Input.isTriggered('shift')) {
                    // One press steps back far enough to see the whole circle and
                    // the next brings it home, so a reader is never lost on it.
                    const wide = this.wholeAtlasZoom();
                    this.setAtlasZoom(this.atlasZoom() > wide + 0.01 ? wide : this.defaultAtlasZoom());
                    this.scrollGraphToFocus();
                    SoundManager.playCursor();
                    return;
                }
                let moved = false;
                // Running out of circle sideways turns the page to the next
                // school; there is nothing above or below one to turn to.
                if (Input.isTriggered('right') || Input.isRepeated('right')) {
                    moved = this.moveGraphFocus(1, 0);
                    if (!moved && this.pageAtlasSchool(1)) return;
                } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
                    moved = this.moveGraphFocus(-1, 0);
                    if (!moved && this.pageAtlasSchool(-1)) return;
                } else if (Input.isTriggered('down') || Input.isRepeated('down')) moved = this.moveGraphFocus(0, 1);
                else if (Input.isTriggered('up') || Input.isRepeated('up')) moved = this.moveGraphFocus(0, -1);
                if (moved) {
                    SoundManager.playCursor();
                    this.refreshUISkillDOM();
                    this.scrollGraphToFocus();
                }
                return;
            }
            const skills = this.getSkillsByCategoryCached(this._selectedCategory);
            const max = skills.length;
            if (max === 0) {
                if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                    this._viewMode = 'category';
                    SoundManager.playCancel();
                    this.refreshUISkillDOM();
                }
                return;
            }
            const cols = SKILL_GRID_COLS;
            const prev = this._selectedSkillIndex;
            if (Input.isTriggered('ok')) {
                this.selectSkill(this._selectedSkillIndex);
                return;
            } else if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                this._viewMode = 'category';
                SoundManager.playCancel();
                this.refreshUISkillDOM();
                return;
            } else if (Input.isTriggered('right') || Input.isRepeated('right')) {
                this._selectedSkillIndex = (this._selectedSkillIndex + 1) % max;
            } else if (Input.isTriggered('left') || Input.isRepeated('left')) {
                this._selectedSkillIndex = (this._selectedSkillIndex - 1 + max) % max;
            } else if (Input.isTriggered('down') || Input.isRepeated('down')) {
                if (this._selectedSkillIndex + cols < max) {
                    this._selectedSkillIndex += cols;
                } else {
                    this._selectedSkillIndex = max - 1;
                }
            } else if (Input.isTriggered('up') || Input.isRepeated('up')) {
                if (this._selectedSkillIndex - cols >= 0) {
                    this._selectedSkillIndex -= cols;
                }
            }

            if (this._selectedSkillIndex !== prev) {
                SoundManager.playCursor();
                this.refreshUISkillDOM();
                this.scrollToActiveItem('skills-scroll-box', '.skill-card.focused');
            }
        } else if (this._viewMode === 'preview') {
            this.updateSpellPreviewInput();
        } else if (this._viewMode === 'detail') {
            const skill = this.focusedSkill();
            // Action 0 = teach the chosen pupil; action 1 = preview animation.
            const maxActions = 2;

            if (Input.isTriggered('down') || Input.isRepeated('down') ||
                Input.isTriggered('right') || Input.isRepeated('right')) {
                this._selectedActionIndex = (this._selectedActionIndex + 1) % maxActions;
                SoundManager.playCursor();
                this.refreshUISkillDOM();
            } else if (Input.isTriggered('up') || Input.isRepeated('up') ||
                       Input.isTriggered('left') || Input.isRepeated('left')) {
                this._selectedActionIndex = (this._selectedActionIndex - 1 + maxActions) % maxActions;
                SoundManager.playCursor();
                this.refreshUISkillDOM();
            } else if (Input.isTriggered('ok')) {
                if (!skill) {
                    SoundManager.playBuzzer();
                } else if (this._selectedActionIndex === 0) {
                    const actor = this.getTeachActor();
                    const cost = $gameSystem.getSkillKnowledgeCost(skill.id, actor.actorId());
                    this.teachSkill(actor.actorId(), cost);
                } else {
                    this.openSpellPreview(skill.id);
                }
            } else if (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled()) {
                this._viewMode = 'list';
                SoundManager.playCancel();
                this.refreshUISkillDOM();
            }
        } else if (this._viewMode === 'spellEditor') {
            this.updateSpellEditorInput();
        }
    };

    //=============================================================================
    // Plugin Commands
    //=============================================================================

    PluginManager.registerCommand(pluginName, "openSkillEncyclopedia", args => {
        SceneManager.push(Scene_SkillEncyclopedia);
    });

    // Legacy command names kept for old events.
    PluginManager.registerCommand(pluginName, "openEncyclopedia", args => {
        SceneManager.push(Scene_SkillEncyclopedia);
    });
    PluginManager.registerCommand(pluginName, "openSkillSystem", args => {
        SceneManager.push(Scene_SkillEncyclopedia);
    });

    PluginManager.registerCommand(pluginName, "openWithSkill", args => {
        const skillId = Number(args.skillId || 0);
        $gameVariables.setValue(variableId, skillId);
        SceneManager.push(Scene_SkillEncyclopedia);
    });

    PluginManager.registerCommand(pluginName, "increaseSkillProgress", args => {
        // Legacy command: now adds Knowledge points instead
        const amount = Number(args.amount || 1);
        $gameSystem.addKnowledge(amount);
        window.skipLocalization = true;
        $gameMessage.add(T('SkillMaster.knowledgeGained', {
            amount: amount, total: $gameSystem.getKnowledge(),
        }));
        window.skipLocalization = false;
    });

    //=============================================================================
    // Menu Integration
    //=============================================================================

    if (addToMenu) {
        const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
        Window_MenuCommand.prototype.addOriginalCommands = function () {
            _Window_MenuCommand_addOriginalCommands.call(this);
            const cardMode = window.isCardCombatMode ? window.isCardCombatMode() : $gameSwitches.value(45);
            if (!cardMode) {
                this.addCommand(T('SkillMaster.training'), 'skillEncyclopedia', true, 77);
            }
        };

        const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function () {
            _Scene_Menu_createCommandWindow.call(this);
            this._commandWindow.setHandler('skillEncyclopedia', this.commandSkillEncyclopedia.bind(this));
        };

        Scene_Menu.prototype.commandSkillEncyclopedia = function () {
            SceneManager.push(Scene_SkillEncyclopedia);
        };
    }

    // Register classes globally
    window.Scene_SkillEncyclopedia = Scene_SkillEncyclopedia;
    window.Window_SkillCategory = Window_SkillCategory;
    window.Window_SkillMasterList = Window_SkillMasterList;
    window.Window_SkillDetail = Window_SkillDetail;
    window.Window_ActorSelect = Window_ActorSelect;

})();
