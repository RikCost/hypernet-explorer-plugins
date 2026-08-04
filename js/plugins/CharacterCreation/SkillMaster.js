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

    const actorCategoryManager = {
        _primary: [],
        _secondary: [],
        _initialized: false,
        _actorId: 1,

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
            if (this._initialized || typeof $dataActors === 'undefined' || !$dataActors) return;

            const classId = this._classIdFor(this._actorId);
            if (!classId) return;

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

        isPrimary: function (category) {
            if (!this._initialized) this.initialize();
            return this._primary.includes(category);
        },

        isSecondary: function (category) {
            if (!this._initialized) this.initialize();
            return this._secondary.includes(category);
        },

        getMultiplier: function (skillId) {
            if (!this._initialized) this.initialize();

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

    // Base cost derived from skill MP/TP cost; Primary = 50% off, Secondary = 25% off
    Game_System.prototype.getSkillKnowledgeCost = function (skillId, actorId) {
        const skill = $dataSkills[skillId];
        if (!skill) return 10;
        const base = Math.max(10, Math.floor((skill.mpCost + skill.tpCost) / 2));
        const category = getSkillCategory(skillId);
        if (category && actorId) {
            if (actorCategoryManager.isPrimary(category)) return Math.max(1, Math.floor(base * 0.5));
            if (actorCategoryManager.isSecondary(category)) return Math.max(1, Math.floor(base * 0.75));
        }
        return base;
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
    // pays ~8.5; quadruple hits the 25 KP ceiling. Teaching a skill costs
    // 10-50 KP (getSkillKnowledgeCost, median 15), so an average skill is about
    // five even fights, or one good bounty, away.
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
    const KP_FUSION_MIN = 15;

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
        fused.note = '<customSpell>';
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

    function getAllSkillCategories() {
        const categories = new Set();
        categories.add("All");   // i18n-ignore: category id

        for (const skill of $dataSkills) {
            if (!skill) continue;
            const categoryMatch = skill.note.match(/<category:(.+?)>/i);
            if (categoryMatch) {
                categories.add(categoryMatch[1]);
            }
        }

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
        const skills = [];
        // Build the category regex once per query instead of once per skill.
        const catRegex = category === "All" ? null : new RegExp(`<category:${category}>`, 'i');

        for (const skill of $dataSkills) {
            if (!skill || !skill.name || skill.name.startsWith('<--')) continue;
            if (skill._customSpell) continue; // fused spells never appear in the browse list

            if (category === "All" || catRegex.test(skill.note)) {
                skills.push(skill);
            }
        }

        return skills;
    }

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
        // True when the cursor has walked off the bottom of the Magic grid onto
        // the Fuse Spells button, which is a focus target of its own.
        this._categoryFuseFocused = false;

        // The chosen pupil: every skill taught from this scene goes to this actor.
        const leader = $gameParty.leader();
        this._teachActorId = leader ? leader.actorId() : 1;

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

        // Wheel scroll on category/skills list regardless of focus
        this._dndContainer.addEventListener("wheel", (e) => {
            e.preventDefault();
            let box = e.target.closest && e.target.closest('.skill-scroll-box');
            if (!box) {
                box = document.getElementById('category-scroll-box-left') ||
                      document.getElementById('category-scroll-box-right') ||
                      document.getElementById('skills-scroll-box');
            }
            if (box) box.scrollTop += e.deltaY;
        }, { passive: false });

        // Inject separation of layout styles
        // Initialize state markers to force clean draw
        this._lastLeftMode = null;
        this._lastLeftCategory = null;
        this._lastRightMode = null;
        this._lastRightSkillId = null;
        this._lastRightKnowledge = null;

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

        // 0. Layout: every view now uses the split book spread. The category browser
        //    puts Skills on the left page and Magic on the right; the member-select,
        //    skill grid, detail and fusion views all use the same split layout.
        const fullPageList = false;
        const spreadEl = this._dndContainer.querySelector('.book-spread');
        const leftPageEl = this._dndContainer.querySelector('.left-page');
        const rightPageEl = this._dndContainer.querySelector('.right-page');
        const spineEl = this._dndContainer.querySelector('.spine-divider');
        if (spreadEl) spreadEl.classList.toggle('skill-fullpage', fullPageList);
        if (leftPageEl) leftPageEl.style.width = fullPageList ? '100%' : '';
        if (rightPageEl) rightPageEl.style.display = fullPageList ? 'none' : '';
        if (spineEl) spineEl.style.display = fullPageList ? 'none' : '';

        // 1. Determine if Left Page needs full rebuild
        const leftPageBox = document.getElementById('left-page-content');
        if (!leftPageBox) return;

        const needsLeftRebuild = (this._lastLeftMode !== this._viewMode) ||
            (this._viewMode !== 'category' && this._lastLeftCategory !== this._selectedCategory);

        if (needsLeftRebuild) {
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
                const skills = getSkillsByCategory(this._selectedCategory);
                let skillsListHTML = "";

                const teachActor = this.getTeachActor();
                skills.forEach((skill, idx) => {
                    const isFocused = (this._selectedSkillIndex === idx);
                    const isLearned = teachActor ? teachActor.isLearnedSkill(skill.id) : false;

                    skillsListHTML += `
                        <div class="skill-card ${isFocused ? 'focused' : ''}" onclick="SceneManager._scene.selectSkill(${idx})" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--accent-gray-2-translucent-0); border:1px solid ${isFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer; font-family:'Lora', serif; transition:all 0.15s ease;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="${getSkillIconStyle(skill.iconIndex)} transform: scale(0.8); flex-shrink: 0; image-rendering: pixelated; margin-right: 2px;"></div>
                                <div style="font-weight:bold; color:${isFocused ? 'var(--text-secondary-active)' : 'var(--text-card-medium)'}; font-size:0.95rem;">${skill.name}</div>
                            </div>
                            ${isLearned ? `<span style="font-family:'Lora', serif; font-size:0.7rem; text-transform:uppercase; color:var(--text-forest-complete); border:1px solid var(--border-forest-green); border-radius:3px; padding:1px 5px; font-weight:bold; background:var(--bg-success-green-15); letter-spacing:0.5px;">${T('SkillMaster.mastered')}</span>` : ''}
                        </div>
                    `;
                });

                const returnBtnText = T('SkillMaster.back');
                leftPageHTML = `
                    <div class="page-header-bar" style="width: 100%;">
                      <div class="back-button focusable" onclick="SceneManager._scene.goBack()">${returnBtnText}</div>
                      <h2 class="cc-header-gothic" style="border: none; margin: 0; padding: 0; text-align: center; font-size: 1.55rem;">${getCategoryDisplayName(this._selectedCategory)}</h2>
                    </div>
                    <div id="skills-scroll-box" class="skill-scroll-box" style="flex:1; overflow-y:auto; padding-right:10px; display:grid; grid-template-columns:repeat(${SKILL_GRID_COLS}, 1fr); gap:10px; align-content:start; box-sizing:border-box;">
                        ${skillsListHTML}
                    </div>
                `;
            }

            leftPageBox.innerHTML = leftPageHTML;
            this._lastLeftMode = this._viewMode;
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

        const skills = getSkillsByCategory(this._selectedCategory);
        const skill = skills[this._selectedSkillIndex];
        const skillId = skill ? skill.id : null;

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
                    // Full inspect block (Combat Application + Damage side by
                    // side, Skill Effects, Classifications) built by the same
                    // service the Skills menu uses.
                    const detailedInfoHTML = window.SkillDetails ? window.SkillDetails.build(skill) : '';

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

                        if (hasSkill) {
                            actionsListHTML += `
                                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-success-green-15); border:1px solid var(--border-forest-green); border-radius:6px; color:var(--text-forest-complete); font-weight:bold; font-size:0.95rem;">
                                    <span>${actor.name()}</span>
                                    <span style="font-family:'Lora', serif; font-size:0.8rem; text-transform:uppercase;">✓ ${T('SkillMaster.learned')}</span>
                                </div>
                            `;
                        } else {
                            actionsListHTML += `
                                <div class="action-button ${isActionFocused ? 'focused' : ''} ${!canAfford ? 'disabled' : ''}" onclick="SceneManager._scene.teachSkill(${actor.actorId()}, ${cost})" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:${isActionFocused ? 'var(--text-secondary-active)' : 'var(--accent-gray-2-translucent-0)'}; border:1px solid ${isActionFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:${canAfford ? 'pointer' : 'not-allowed'}; font-family:'Lora', serif; opacity:${canAfford ? 1 : 0.6}; transition:all 0.15s ease;">
                                    <span style="font-weight:bold; color:${isActionFocused ? 'var(--text-pure-black)' : 'var(--text-card-medium)'};">${useItalian ? `Insegna a ${actor.name()}` : `Teach ${actor.name()}`}</span>
                                    <span style="font-family:'Lora', serif; font-weight:bold; color:${isActionFocused ? 'var(--text-pure-black)' : canAfford ? 'var(--text-text-alt-3)' : 'var(--shadow-shadow-alt-5-translucent-40)'};">${cost} KP</span>
                                </div>
                            `;
                        }
                    }

                    let descriptionText = skill.description || (T('SkillMaster.noDescriptionAvailable'));
                    if (window.translateText) {
                        descriptionText = window.translateText(descriptionText);
                    }

                    // Preview button (index 1): opens a zoomable/draggable 3D
                    // Effekseer preview of the skill's animation over an empty target.
                    const isPreviewFocused = allowActionFocus && (this._selectedActionIndex === 1);
                    const previewBtnHTML = `
                        <div class="action-button preview-button ${isPreviewFocused ? 'focused' : ''}" onclick="SceneManager._scene.openSpellPreview(${skill.id})" style="flex:0 0 auto; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:4px; padding:10px 16px; background:${isPreviewFocused ? 'var(--text-secondary-active)' : 'var(--bg-card-translucent-5)'}; border:1px solid ${isPreviewFocused ? 'var(--text-secondary-active)' : 'var(--border-secondary-hover-translucent-15)'}; border-radius:6px; cursor:pointer; font-family:'Lora', serif; transition:all 0.15s ease;">
                            <span style="font-size:1.15rem; line-height:1;">◈</span>
                            <span style="font-weight:bold; text-transform:uppercase; font-size:0.78rem; color:${isPreviewFocused ? 'var(--text-pure-black)' : 'var(--text-secondary-active)'};">${T('SkillMaster.preview')}</span>
                        </div>`;

                    rightPageHTML = `
                        <div style="display:flex; flex-direction:column; gap:12px; height:100%; box-sizing:border-box;">
                            <div style="display:flex; align-items:center; gap:12px; border-bottom:2px solid var(--border-secondary-hover-translucent-15); padding-bottom:8px;">
                                <div style="${getSkillIconStyle(skill.iconIndex)} transform: scale(1.2); flex-shrink: 0; image-rendering: pixelated; margin-right: 2px;"></div>
                                <div>
                                    <h3 class="cc-header-gothic" style="font-size:1.55rem; color:var(--text-secondary-active); margin:0; line-height:1.2;">
                                        ${skill.name}
                                    </h3>
                                    <div style="font-size:0.8rem; color:var(--text-inverse); text-transform:uppercase; font-family:'Lora', serif; letter-spacing:0.5px;">
                                        ${getCategoryDisplayName(this._selectedCategory)}
                                    </div>
                                </div>
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
        SoundManager.playCursor();
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
        SoundManager.playOk();
        this.refreshUISkillDOM();
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
            this._skillDetailWindow.setSkill(skill);
            this._viewMode = 'detail';
            this._selectedActionIndex = 0;
            SoundManager.playOk();
            this.refreshUISkillDOM();
        }
    };

    Scene_SkillEncyclopedia.prototype.teachSkill = function (actorId, cost) {
        const actor = $gameActors.actor(actorId);
        const skills = getSkillsByCategory(this._selectedCategory);
        const skill = skills[this._selectedSkillIndex];
        if (!actor || !skill || $gameSystem.getKnowledge() < cost) {
            SoundManager.playBuzzer();
            return;
        }
        $gameSystem.spendKnowledge(cost);
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
                    <canvas id="spell-preview-canvas" style="position:absolute; inset:0; width:100%; height:100%; cursor:grab; touch-action:none;"></canvas>
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
    };

    Scene_SkillEncyclopedia.prototype.getSplitCategoriesCached = function () {
        // Categories derive only from $dataSkills (static for the scene lifetime).
        if (!this._splitCategoriesCache) this._splitCategoriesCache = getSplitSkillCategories();
        return this._splitCategoriesCache;
    };

    Scene_SkillEncyclopedia.prototype.getSkillsByCategoryCached = function (category) {
        if (this._skillsByCategoryKey !== category) {
            this._skillsByCategoryKey = category;
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
                        <canvas id="anim-preview-canvas" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;"></canvas>
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
            const skills = this.getSkillsByCategoryCached(this._selectedCategory);
            const skill = skills[this._selectedSkillIndex];
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
                if (this._selectedActionIndex === 0) {
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
