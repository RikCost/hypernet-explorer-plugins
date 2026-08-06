//=============================================================================
// CategorizedBattleSkills.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Categorized skill menus for battle and the menu scene, with fullscreen skill UI and party switching.
 * @author Omni-Lex
 * @version 2.0.0
 *
 * @help CategorizedBattleSkills.js
 *
 * Combines CategorizedBattleSkills and CustomSkillsMenuSwitcher into one plugin.
 *
 * --- BATTLE ---
 * Skills are grouped by category. Select a category first, then choose a skill.
 * Categories grey out when no usable skills exist in them.
 *
 * --- MENU (Skills scene) ---
 * Same categorized layout with icons. Categories are NEVER greyed out.
 * Individual skills grey out if the actor cannot use them.
 * Left/Right switches party members. The skill info panel replaces the status window.
 * "Level Up" tab shows learnable skills by level.
 *
 * --- HOW TO USE ---
 * Add <category: CategoryName> to a skill's Note field.
 * Skills without a category tag fall into "General".
 *
 * --- CHANGE LOG ---
 * v2.0.0 - Merged CustomSkillsMenuSwitcher into CategorizedBattleSkills.
 *          Menu categories never grey out; individual skills grey if unusable.
 *          Category icons shown in menu skill list.
 * v1.6.1 - Fixed skill type filtering
 * v1.6.0 - Category descriptions in help window
 * v1.5.0 - Italian translation support
 * v1.4.0 - Cursor position memory
 * v1.3.0 - Category icons
 * v1.2.0 - Main menu Skills window + party switching
 */

(() => {
    'use strict';

    const DEFAULT_CATEGORY = "Basic"; // i18n-ignore: matched against the <category:Basic> note tag

    // Escape user/DB-provided strings before injecting into innerHTML so that
    // characters like < > & " ' (e.g. in damage formulas or notes) don't
    // corrupt the surrounding markup.
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ── Shared skill inspect service (idempotent across plugins) ──────────────
    // Builds the full "Combat Application / Damage / Skill Effects /
    // Classifications" block shown on the right page of the Skills scene, so any
    // other menu that inspects a skill (SkillMaster's Training encyclopedia,
    // ...) renders exactly the same information from the same code.
    if (!window.SkillDetails) {
        window.SkillDetails = (() => {
            const esc = escapeHtml;

            // The item inspect panel spells out the same engine enums and stat
            // names, so both read one vocabulary: Inventory.spec / Equip.
            const PARAM_KEYS = ["hp", "mp", "str", "con", "int", "wis", "dex", "psi"];
            const paramName = (paramId) => {
                const key = "Equip." + PARAM_KEYS[paramId];
                return PARAM_KEYS[paramId] && T.has(key) ? T(key) : T("Inventory.spec.stat");
            };

            const FORMULA_MAP = [
                { regex: /\b[ab]\.mhp\b/gi, key: "Inventory.spec.maxHp" },
                { regex: /\b[ab]\.mmp\b/gi, key: "Inventory.spec.maxMp" },
                { regex: /\b[ab]\.hp\b/gi, key: "Equip.hp" },
                { regex: /\b[ab]\.mp\b/gi, key: "Equip.mp" },
                { regex: /\b[ab]\.tp\b/gi, key: "SkillsMenu.unit.ap" },
                { regex: /\b[ab]\.atk\b/gi, key: "Equip.str" },
                { regex: /\b[ab]\.def\b/gi, key: "Equip.con" },
                { regex: /\b[ab]\.mat\b/gi, key: "Equip.int" },
                { regex: /\b[ab]\.mdf\b/gi, key: "Equip.wis" },
                { regex: /\b[ab]\.agi\b/gi, key: "Equip.dex" },
                { regex: /\b[ab]\.luk\b/gi, key: "Equip.psi" }
            ];
            const translateFormula = (formula) => {
                if (!formula) return "";
                let str = formula;
                FORMULA_MAP.forEach(m => { str = str.replace(m.regex, T(m.key)); });
                return str;
            };

            // Engine enum -> label, the index staying the id.
            const enumName = (key, index) => {
                const arr = T.list(key);
                return arr[index] || arr[0] || "";
            };
            const hitTypeName = (hitType) => enumName("Inventory.spec.hitType", hitType);
            const occasionName = (occasion) => enumName("Inventory.spec.occasion", occasion);
            const scopeName = (scope) => enumName("Inventory.spec.scope", scope);
            const damageTypeName = (type) => enumName("Inventory.spec.damageType", type);

            const costTextOf = (skill) => {
                if (!skill) return "";
                if (skill.mpCost > 0) return T("SkillsMenu.cost.mp", { n: skill.mpCost });
                if (skill.tpCost > 0) return T("SkillsMenu.cost.ap", { n: skill.tpCost });
                return "";
            };

            const scaleOf = (skill) => {
                if (!skill || !skill.damage || !skill.damage.formula) return null;
                const formula = skill.damage.formula;
                // Values are Equip.* leaves, so the scaling stat is named in the
                // same vocabulary as the character sheet.
                const statPatterns = {
                    'a.atk': 'str',
                    'a.mat': 'int',
                    'a.param(2)': 'str',
                    'a.param(3)': 'con',
                    'a.param(4)': 'int',
                    'a.param(5)': 'wis',
                    'a.param(6)': 'dex',
                    'a.param(7)': 'psi'
                };
                let mainStat = null;
                let maxMultiplier = 0;
                for (const [pattern, statName] of Object.entries(statPatterns)) {
                    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const match = formula.match(new RegExp(escaped + '\\s*\\*\\s*([\\d.]+)', 'i'));
                    if (match) {
                        const m = parseFloat(match[1]);
                        if (m > maxMultiplier) { maxMultiplier = m; mainStat = statName; }
                    } else if (formula.includes(pattern) && maxMultiplier === 0) {
                        mainStat = statName; maxMultiplier = 1;
                    }
                }
                if (!mainStat) return null;
                let grade = 'F';
                if (maxMultiplier >= 9) grade = 'S';
                else if (maxMultiplier >= 7) grade = 'A';
                else if (maxMultiplier >= 5) grade = 'B';
                else if (maxMultiplier >= 3) grade = 'C';
                else if (maxMultiplier >= 2) grade = 'D';
                else if (maxMultiplier >= 1) grade = 'E';
                return { stat: T("Equip." + mainStat), grade: grade, multiplier: maxMultiplier };
            };

            const categoryOf = (skill) => {
                if (!skill || !skill.note) return null;
                const match = skill.note.match(/<category:\s*(\w+)>/i);
                if (!match) return null;
                return match[1].replace(/([A-Z])/g, ' $1').trim();
            };

            const isBasic = (skill) => {
                if (!skill || !skill.note) return false;
                return /<[Cc]ategory\s*:\s*Basic>/i.test(skill.note);
            };

            // Human label for the subtitle under the skill name.
            const typeLabelOf = (skill) => {
                const cat = categoryOf(skill);
                if (cat) return cat;
                if (isBasic(skill)) return T("SkillsMenu.discipline.basic");
                return T("SkillsMenu.discipline.standard");
            };

            // ── Spec collection ───────────────────────────────────────────────
            const combatSpecsOf = (skill) => {
                const specs = [];
                if (!skill) return specs;
                if (skill.stypeId > 0) specs.push({ label: T("Inventory.spec.label.skillType"), val: ($dataSystem.skillTypes || [])[skill.stypeId] || T("Inventory.spec.label.skillFallback") });
                if (skill.occasion !== undefined) specs.push({ label: T("Inventory.spec.label.occasion"), val: occasionName(skill.occasion) });
                if (skill.scope !== undefined && skill.scope !== 0) specs.push({ label: T("Inventory.spec.label.target"), val: scopeName(skill.scope) });

                const costText = costTextOf(skill);
                if (costText) specs.push({ label: T("Inventory.spec.label.useCost"), val: costText });

                const scaleData = scaleOf(skill);
                if (scaleData) specs.push({ label: T("Equip.scale"), val: `${scaleData.stat} (${scaleData.grade})` });

                if (skill.speed) specs.push({ label: T("Inventory.spec.label.speedAdjust"), val: (skill.speed > 0 ? "+" : "") + skill.speed });
                if (skill.successRate !== undefined && skill.successRate !== 100) specs.push({ label: T("Inventory.spec.label.successRate"), val: skill.successRate + "%" });
                if (skill.repeats !== undefined && skill.repeats > 1) specs.push({ label: T("Inventory.spec.label.repeatActions"), val: "x" + skill.repeats });
                if (skill.tpGain > 0) specs.push({ label: T("Inventory.spec.label.apGain"), val: "+" + skill.tpGain });
                if (skill.hitType) specs.push({ label: T("Inventory.spec.label.hitClassification"), val: hitTypeName(skill.hitType) });
                return specs;
            };

            const damageSpecsOf = (skill) => {
                const specs = [];
                if (!skill || !skill.damage || !(skill.damage.type > 0)) return specs;
                specs.push({ label: T("Inventory.spec.label.damageType"), val: damageTypeName(skill.damage.type) });
                if (skill.damage.elementId > 0) {
                    specs.push({ label: T("Inventory.spec.label.attackElement"), val: ($dataSystem.elements || [])[skill.damage.elementId] || T("Inventory.spec.none") });
                }
                const formula = skill.damage.formula ? skill.damage.formula.trim() : "";
                if (formula && formula !== "0" && formula !== "0.0") specs.push({ label: T("Inventory.spec.label.formula"), val: translateFormula(formula) });
                if (skill.damage.variance > 0) specs.push({ label: T("Inventory.spec.label.variance"), val: skill.damage.variance + "%" });
                if (skill.damage.critical) specs.push({ label: T("Inventory.spec.label.canCritical"), val: T("Inventory.spec.yes") });
                return specs;
            };

            const effectsOf = (skill) => {
                const list = [];
                if (!skill || !skill.effects) return list;
                skill.effects.forEach(eff => {
                    let effDesc = "";
                    const val1 = eff.value1;
                    const val2 = eff.value2;
                    const dataId = eff.dataId;
                    if (eff.code === 21) {
                        const state = $dataStates[dataId];
                        if (state && state.name) effDesc = T("Inventory.effect.addState", { state: state.name, chance: Math.round(val1 * 100) });
                    } else if (eff.code === 22) {
                        const state = $dataStates[dataId];
                        if (state && state.name) effDesc = T("Inventory.effect.removeState", { state: state.name, chance: Math.round(val1 * 100) });
                    } else if (eff.code === 31) {
                        effDesc = T("Inventory.effect.addBuff", { param: paramName(dataId), turns: val1 });
                    } else if (eff.code === 32) {
                        effDesc = T("Inventory.effect.addDebuff", { param: paramName(dataId), turns: val1 });
                    } else if (eff.code === 33) {
                        effDesc = T("Inventory.effect.removeBuff", { param: paramName(dataId) });
                    } else if (eff.code === 34) {
                        effDesc = T("Inventory.effect.removeDebuff", { param: paramName(dataId) });
                    } else if (eff.code === 11) {
                        if (val1 !== 0 || val2 !== 0) effDesc = T("Inventory.effect.recoverHp", { amount: `${val1 > 0 ? Math.round(val1 * 100) + "%" : ""}${val1 > 0 && val2 > 0 ? " + " : ""}${val2 > 0 ? val2 : ""}` });
                    } else if (eff.code === 12) {
                        if (val1 !== 0 || val2 !== 0) effDesc = T("Inventory.effect.recoverMp", { amount: `${val1 > 0 ? Math.round(val1 * 100) + "%" : ""}${val1 > 0 && val2 > 0 ? " + " : ""}${val2 > 0 ? val2 : ""}` });
                    } else if (eff.code === 13) {
                        effDesc = T("Inventory.effect.gainAp", { n: dataId });
                    } else if (eff.code === 41) {
                        effDesc = T("Inventory.effect.growParam", { param: paramName(dataId), n: val1 });
                    }
                    if (effDesc) list.push(effDesc);
                });
                return list;
            };

            // Note tags become the "Classifications" block; <Lore:> is resolved
            // through the shared lore service so it reads as prose.
            const noteTagsOf = (skill) => {
                const tags = [];
                if (!skill || !skill.note) return tags;
                const matches = skill.note.match(/<([^>]+)>/g);
                if (!matches) return tags;
                matches.forEach(m => {
                    const inner = m.slice(1, -1).trim();
                    const colonIdx = inner.indexOf(":");
                    let tagName = inner;
                    let val = "";
                    if (colonIdx !== -1) {
                        tagName = inner.substring(0, colonIdx).trim();
                        val = inner.substring(colonIdx + 1).trim();
                    }
                    const nameLower = tagName.toLowerCase();
                    if (nameLower === "category") return;
                    if (nameLower === "uncraftable") return;
                    if (nameLower === "lore" && val && window.ItemSystemUtils && typeof window.ItemSystemUtils.fillLore === "function") {
                        val = window.ItemSystemUtils.fillLore(val, skill.id);
                    }
                    tags.push({ name: tagName.charAt(0).toUpperCase() + tagName.slice(1), value: val || T("Inventory.spec.yes") });
                });
                return tags;
            };

            // ── Rendering ─────────────────────────────────────────────────────
            const specRows = (specs) => specs.map(spec =>
                `<div class="inspect-spec-row"><span class="inspect-spec-label">${esc(spec.label)}:</span><span class="inspect-spec-value">${esc(spec.val)}</span></div>`
            ).join("");

            const section = (title, body) => `<div class="inspect-section-title">${esc(title)}</div>${body}`;

            // The specialization a skill is practised through (window.SkillSpecs,
            // SpecializationMenu.js): which discipline it trains, how far along
            // the character reading the page is, and what that is worth on the
            // skill's own numbers. Absent for the engine basics, which belong to
            // no discipline.
            const specRowsOf = (skill, actor) => {
                const svc = window.SkillSpecs;
                const def = svc ? svc.forSkill(skill) : null;
                if (!def) return [];
                const rows = [{
                    label: T("SkillsMenu.spec.trains"),
                    val: (typeof window.translateText === 'function')
                        ? window.translateText(def.name) : def.name
                }];
                if (actor && actor.specializationLevel) {
                    const level = actor.specializationLevel(def.id);
                    rows.push({
                        label: actor.name(),
                        val: window.Specializations.levelName(level)
                    });
                    const bonus = Math.round((svc.multiplier(actor, skill) - 1) * 100);
                    if (bonus > 0) {
                        rows.push({ label: T("SkillsMenu.spec.bonus"), val: `+${bonus}%` });
                    }
                }
                return rows;
            };

            function build(skill, actor) {
                if (!skill) return "";
                const combat = combatSpecsOf(skill);
                const damage = damageSpecsOf(skill);
                const effects = effectsOf(skill);
                const noteTags = noteTagsOf(skill);
                const training = specRowsOf(skill, actor);

                let html = "";

                // Combat Application and Damage sit side by side on one row; a
                // single present column simply spans the full width.
                const columns = [];
                if (combat.length) columns.push(`<div class="inspect-spec-col">${section(T("Inventory.section.combatApplication"), specRows(combat))}</div>`);
                if (damage.length) columns.push(`<div class="inspect-spec-col">${section(T("SkillsMenu.section.damage"), specRows(damage))}</div>`);
                if (columns.length) html += `<div class="inspect-spec-columns">${columns.join("")}</div>`;

                if (effects.length) {
                    html += section(T("SkillsMenu.section.skillEffects"), effects.map(desc =>
                        `<div class="inspect-effect-row"><span style="color:var(--text-primary-hover); margin-right:6px;">✦</span><span style="color:var(--text-success-active);">${esc(desc)}</span></div>`
                    ).join(""));
                }
                if (training.length) {
                    html += section(T("SkillsMenu.section.training"), specRows(training));
                }
                if (noteTags.length) {
                    html += section(T("SkillsMenu.section.classifications"), specRows(noteTags));
                }
                return html;
            }

            function injectStyles() {
                if (document.getElementById("skill-details-styles")) return;
                const style = document.createElement("style");
                style.id = "skill-details-styles";
                style.textContent = `
                    .inspect-section-title {
                        font-family: 'Lora', serif;
                        font-weight: bold;
                        color: var(--text-primary-hover);
                        border-bottom: 1px solid var(--border-gold-amber-30);
                        padding-bottom: 4px;
                        margin: 12px 0 8px 0;
                        font-size: 1.05em;
                    }
                    .inspect-spec-row {
                        display: flex;
                        justify-content: space-between;
                        gap: 10px;
                        padding: 2px 0;
                        font-size: 0.9em;
                    }
                    .inspect-spec-label {
                        color: var(--text-card-medium);
                        font-weight: bold;
                    }
                    .inspect-spec-value {
                        color: var(--text-success-active);
                        font-weight: bold;
                        text-align: right;
                    }
                    .inspect-effect-row {
                        display: flex;
                        align-items: flex-start;
                        font-size: 0.9em;
                        margin-bottom: 4px;
                    }
                    .inspect-spec-columns {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: flex-start;
                        gap: 0 20px;
                    }
                    .inspect-spec-col {
                        flex: 1 1 190px;
                        min-width: 0;
                    }
                    .inspect-spec-col .inspect-section-title {
                        margin-top: 0;
                    }
                `;
                document.head.appendChild(style);
            }

            return {
                build,
                injectStyles,
                costTextOf,
                scaleOf,
                categoryOf,
                isBasic,
                typeLabelOf,
                translateFormula,
                combatSpecsOf,
                damageSpecsOf,
                effectsOf,
                noteTagsOf
            };
        })();
    }

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

    const isDummySkill = skill => !skill.name || !skill.name.trim() || skill.name.startsWith('<--');
    const getSkillCategory = skill => (typeof skill.meta.category === 'string' && skill.meta.category.trim()) || DEFAULT_CATEGORY;

    //=============================================================================
    // Categorization mode ,  Role (default) / School / Off
    //=============================================================================
    // 0 = Role (Offensive / Healing / Support), 1 = School (magic schools &
    // skill disciplines), 2 = Off (no grouping). Off is the default: the flat
    // skill list is the plainest starting point, the groupings are opt-in.
    const CAT_MODE_ROLE = 0, CAT_MODE_SCHOOL = 1, CAT_MODE_OFF = 2;

    function getSkillCategoryMode() {
        const v = ConfigManager.skillCategoryMode;
        return (v === undefined || v === null) ? CAT_MODE_OFF : v;
    }
    function isRoleMode() {
        return getSkillCategoryMode() === CAT_MODE_ROLE;
    }

    // Fixed role buckets with fixed icons. Healing reuses the school "Healing"
    // metadata (see getCatData), so it is intentionally absent here.
    // i18n-ignore-start: role bucket ids, matched against the <role:> tag and
    // against Categories.json keys; the visible names come from ROLE_DATA
    const ROLE_KEYS = ['Offensive', 'Healing', 'Support'];
    // Display order for the role buckets. Basic skills keep their own bucket and
    // are always shown last (after Support) in Role mode.
    const ROLE_ORDER = { Offensive: 0, Healing: 1, Support: 2, Basic: 3 };
    // i18n-ignore-end

    // The Basic category only has its own dedicated battle command in Off mode;
    // in Role/School mode it is merged into the unified Skills menu as a category.
    function basicHasOwnCommand() {
        return getSkillCategoryMode() === CAT_MODE_OFF;
    }
    // nameKey/descKey are resolved at render time by getCategoryInfo. The
    // "Role" type is an id, compared against the skill-type group.
    const ROLE_DATA = {
        Offensive: {
            nameKey: "SkillsMenu.role.offensive.name",
            descKey: "SkillsMenu.role.offensive.description",
            type: "Role", icon: 97 // i18n-ignore: group id
        },
        Healing: {
            nameKey: "SkillsMenu.role.healing.name",
            descKey: "SkillsMenu.role.healing.description",
            type: "Role", icon: 75 // i18n-ignore: group id
        },
        Support: {
            nameKey: "SkillsMenu.role.support.name",
            descKey: "SkillsMenu.role.support.description",
            type: "Role", icon: 80 // i18n-ignore: group id
        }
    };

    // Infer a role from a skill's mechanics when it has no <role:> tag. Mirrors
    // the offline tagger in data/Skills.json so untagged/modded skills still bucket.
    function inferSkillRole(skill) {
        const dmg = skill.damage || {};
        const dtype = dmg.type || 0;
        const scope = skill.scope || 0;
        const effects = skill.effects || [];
        const codes = effects.map(e => e.code);
        const allyScope = scope >= 7 && scope <= 11;
        const enemyScope = scope >= 1 && scope <= 6;
        const hasRecover = codes.includes(11) || codes.includes(12);
        const hasCure = codes.includes(22);
        // i18n-ignore-start: role bucket ids, see ROLE_KEYS
        if (dtype === 3 || dtype === 4) return 'Healing';
        if ((hasRecover || hasCure) && allyScope) return 'Healing';
        if (hasRecover) return 'Healing';
        if (dtype === 1 || dtype === 2 || dtype === 5 || dtype === 6) return 'Offensive';
        if (enemyScope) return 'Offensive';
        return 'Support';
        // i18n-ignore-end
    }

    function getSkillRole(skill) {
        const r = skill.meta && skill.meta.role;
        if (typeof r === 'string') {
            const key = r.trim();
            const norm = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
            if (ROLE_DATA[norm]) return norm;
        }
        return inferSkillRole(skill);
    }

    // The grouping key used to bucket skills: role in Role mode, else school.
    // Basic-category skills always keep their own "Basic" bucket (shown last in
    // Role mode), rather than being scattered across the role buckets.
    function getSkillGroup(skill) {
        if (getSkillCategory(skill) === DEFAULT_CATEGORY) return DEFAULT_CATEGORY;
        return isRoleMode() ? getSkillRole(skill) : getSkillCategory(skill);
    }

    //=============================================================================
    // Recent skills ,  last few skills used in battle, surfaced under the
    // category list for quick re-casting.
    //=============================================================================
    const RECENT_SKILLS_MAX = 7;

    // Recent skills are tracked per actor and stored on $gameSystem, so each
    // character keeps their own history and it persists across battles/saves.
    function getRecentSkillIds(actorId) {
        if (!$gameSystem._recentSkillIds || Array.isArray($gameSystem._recentSkillIds)) {
            // Initialise (and migrate any legacy single global list away).
            $gameSystem._recentSkillIds = {};
        }
        if (!$gameSystem._recentSkillIds[actorId]) $gameSystem._recentSkillIds[actorId] = [];
        return $gameSystem._recentSkillIds[actorId];
    }

    function pushRecentSkillId(actorId, skillId) {
        const list = getRecentSkillIds(actorId);
        const i = list.indexOf(skillId);
        if (i >= 0) list.splice(i, 1);
        list.unshift(skillId);
        if (list.length > 30) list.length = 30;
    }

    // Most-recently-used skills the given actor actually knows (newest first),
    // optionally restricted to a single skill type.
    function getRecentSkillsForActor(actor, stypeId, max) {
        if (!actor) return [];
        const known = new Set(actor.skills().map(s => s.id));
        const out = [];
        for (const id of getRecentSkillIds(actor.actorId())) {
            if (!known.has(id)) continue;
            const skill = $dataSkills[id];
            if (!skill || isDummySkill(skill)) continue;
            if (stypeId && skill.stypeId !== stypeId) continue;
            out.push(skill);
            if (out.length >= max) break;
        }
        return out;
    }

    // Record skills as they are used (battle or menu), per acting actor.
    const _Game_Battler_useItem = Game_Battler.prototype.useItem;
    Game_Battler.prototype.useItem = function (item) {
        _Game_Battler_useItem.call(this, item);
        if (item && DataManager.isSkill(item) && this.isActor && this.isActor()) {
            pushRecentSkillId(this.actorId(), item.id);
        }
    };

    let _statsI18n = null;

    const _loadStatsI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/stats.json`;
        try {
            const response = await fetch(url);
            _statsI18n = await response.json();
        } catch (e) {
            console.error('CategorizedBattleSkills: Failed to load i18n data from ' + url, e);
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
            console.error('CategorizedBattleSkills: Failed to load Categories.json from ' + url, e);
        }
    };

    _loadCategoryData();

    //=============================================================================
    // Game Options Registry & ConfigManager Persistence
    //=============================================================================
    // Skill categorization mode: 0 = Role, 1 = School, 2 = Off (default).
    ConfigManager.skillCategoryMode = CAT_MODE_OFF;

    const _ConfigManager_makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _ConfigManager_makeData.call(this);
        config.skillCategoryMode = this.skillCategoryMode;
        return config;
    };

    const _ConfigManager_applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _ConfigManager_applyData.call(this, config);
        if (config.skillCategoryMode !== undefined) {
            this.skillCategoryMode = config.skillCategoryMode;
        } else if (config.categorizeInBattle !== undefined) {
            // Migrate the old boolean while preserving the player's prior choice:
            // ON -> School, OFF -> Off. New players default to Off below.
            this.skillCategoryMode = config.categorizeInBattle ? CAT_MODE_SCHOOL : CAT_MODE_OFF;
        } else {
            this.skillCategoryMode = CAT_MODE_OFF;
        }
    };

    const _skillCatModeNames = () => T.list('SkillsMenu.option.categoryModes');

    // Register option in GameOptions (3-way select) or fallback to a basic command.
    if (typeof GameOptions !== 'undefined' && typeof GameOptions.registerOption === 'function') {
        GameOptions.registerOption('skillCategoryMode', T('SkillsMenu.option.skillCategorization'),
            () => getSkillCategoryMode(),
            (value) => { ConfigManager.skillCategoryMode = value; },
            'gameplay', 'boolean',
            (value) => _skillCatModeNames()[value] || _skillCatModeNames()[0],
            function () {
                const v = (getSkillCategoryMode() + 1) % 3;
                this.setConfigValue('skillCategoryMode', v);
            },
            function () {
                const v = (getSkillCategoryMode() + 2) % 3;
                this.setConfigValue('skillCategoryMode', v);
            }
        );
    } else {
        const _Window_Options_makeCommandList = Window_Options.prototype.makeCommandList;
        Window_Options.prototype.makeCommandList = function () {
            _Window_Options_makeCommandList.call(this);
            this.addCommand(T('SkillsMenu.option.skillCategorization'), "skillCategoryMode");
        };
    }

    const FAVOURITES_CATEGORY = "Favourites"; // i18n-ignore: category id, compared in code
    const FAVOURITE_ICON = 87;

    function getActorFavourites(actorId) {
        if (!$gameSystem._favouriteSkills) $gameSystem._favouriteSkills = {};
        if (!$gameSystem._favouriteSkills[actorId]) $gameSystem._favouriteSkills[actorId] = [];
        return $gameSystem._favouriteSkills[actorId];
    }

    function isSkillFavourited(actorId, skillId) {
        return getActorFavourites(actorId).includes(skillId);
    }

    function toggleFavouriteSkill(actorId, skillId) {
        const favs = getActorFavourites(actorId);
        const idx = favs.indexOf(skillId);
        if (idx >= 0) favs.splice(idx, 1);
        else favs.push(skillId);
    }

    // Metadata lookup: school categories take precedence, then the fixed role
    // buckets (so "Healing" resolves to the existing school entry, while
    // "Offensive"/"Support" come from ROLE_DATA).
    function getCatData(categoryName) {
        return CATEGORY_DATA[categoryName] || ROLE_DATA[categoryName] || null;
    }

    function getCategoryInfo(categoryName) {
        const isItalian = ConfigManager.language === 'it';
        const data = getCatData(categoryName);
        if (!data) return {
            name: categoryName, description: '', type: "Skill", // i18n-ignore: skill-type group id
            icon: 160
        };
        // The role buckets carry i18n keys; js/db/Skills/Categories.json still
        // ships its own en/it pair, which the db overlay phase will take over.
        if (data.nameKey) {
            return {
                name: T.has(data.nameKey) ? T(data.nameKey) : categoryName,
                description: T.has(data.descKey) ? T(data.descKey) : '',
                type: data.type,
                icon: data.icon
            };
        }
        const nameObj = data.name || {};
        const descObj = data.description || {};
        return {
            name: (isItalian ? nameObj.it : nameObj.en) || nameObj.en || nameObj.it || categoryName,
            description: (isItalian ? descObj.it : descObj.en) || descObj.en || descObj.it || '',
            type: data.type,
            icon: data.icon
        };
    }

    // Returns "Magic" if the skill type name indicates magic, otherwise "Skill".
    function _getStypeIdCategoryGroup(stypeId) {
        if (!stypeId) return null;
        const name = $dataSystem.skillTypes[stypeId] || '';
        // Also check its lowercase variant
        return name.toLowerCase().includes('magic') ? 'Magic' : 'Skill'; // i18n-ignore: skill-type group ids
    }

    // Returns true if the given category should be visible when the current stypeId is active.
    // Categories with type "Magic" only appear for magic skill types.
    // Categories with type "Skill" only appear for non-magic (skill) skill types.
    // Favourites category always appears.
    function _isCategoryVisibleForStypeId(categoryName, stypeId) {
        if (!stypeId) return true;
        // Role buckets span every skill type, so never hide them by group.
        if (isRoleMode()) return true;
        if (categoryName === FAVOURITES_CATEGORY) return true;
        const group = _getStypeIdCategoryGroup(stypeId);
        if (!group) return true;
        const info = getCategoryInfo(categoryName);
        return info.type === group;
    }

    function decamelcaseAndCapitalize(str) {
        if (typeof str !== 'string') return '';
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
        if (typeof categoryName !== 'string') return '';
        const name = getCategoryInfo(categoryName).name;
        const isItalian = ConfigManager.language === 'it';
        const data = getCatData(categoryName);
        if (isItalian && data) {
            return name;
        }
        return decamelcaseAndCapitalize(name);
    }

    function getCategoryDescription(categoryName) {
        return getCategoryInfo(categoryName).description;
    }

    function getEquippedWeaponType(actor) {
        if (!actor) return null;
        const weapons = actor.weapons();
        if (weapons && weapons.length > 0 && weapons[0]) return weapons[0].wtypeId;
        return null;
    }

    function isCategoryCompatibleWithWeapon(categoryName, weaponType) {
        // i18n-ignore-start: Categories.json keys, compared never displayed
        if (weaponType === null) {
            if (categoryName === 'Swordsmanship' || categoryName === 'Firearms') return false;
            return true;
        }
        if (categoryName === 'Swordsmanship') {
            return ![3, 5, 6, 7, 8, 9, 10, 11].includes(weaponType);
        }
        if (categoryName === 'Firearms') {
            return ![1, 2, 3, 4, 5, 6, 10, 11, 12].includes(weaponType);
        }
        // i18n-ignore-end
        return true;
    }

    //=============================================================================
    // CategorizedSkillMixin (used by Window_BattleSkill)
    //=============================================================================

    const CategorizedSkillMixin = {
        shouldCategorize: function (actor = this._actor) {
            if (getSkillCategoryMode() !== CAT_MODE_OFF) return true;
            // Even with grouping Off, fall back to categories for huge skill lists.
            if (actor && actor.skills().length > 100) return true;
            return false;
        },

        initializeCategorizedMode: function () {
            this._categoryMode = CategorizedSkillMixin.shouldCategorize.call(this);
            this._selectedCategory = null;
            this._lastCategoryIndex = 0;
            this._categorySkillIndexes = {};
        },

        resetCategorizedState: function (actor) {
            if (this._actor !== actor) {
                this._categoryMode = CategorizedSkillMixin.shouldCategorize.call(this, actor);
                this._selectedCategory = null;
                this._lastCategoryIndex = 0;
                this._categorySkillIndexes = {};
            }
        },

        resetToCategoryMode: function () {
            if (this._basicMode) {
                // Basic mode is driven by its own battle command; never show categories.
                this._categoryMode = false;
                this._selectedCategory = null;
                return;
            }
            this._categoryMode = CategorizedSkillMixin.shouldCategorize.call(this);
            this._selectedCategory = null;
        },

        maxColsCategorized: function (originalMaxCols) {
            if (this._categoryMode) return originalMaxCols.call(this);
            return 2;
        },

        makeCategorizedItemList: function () {
            if (this._basicMode) {
                this.makeBasicSkillList();
            } else if (this._categoryMode) {
                this.makeCategoryList();
            } else {
                this.makeFilteredSkillList();
            }
        },

        // Basic skills across every skill type (magic and skill), shown via the
        // dedicated "Basic" battle command instead of the category list.
        makeBasicSkillList: function () {
            this._recentStartIndex = null;
            if (this._actor) {
                let list = this._actor.skills().filter(skill => {
                    if (isDummySkill(skill)) return false;
                    return getSkillCategory(skill) === DEFAULT_CATEGORY;
                });
                list.sort((a, b) => {
                    const costTpA = this._actor.skillTpCost(a);
                    const costMpA = this._actor.skillMpCost(a);
                    const costTpB = this._actor.skillTpCost(b);
                    const costMpB = this._actor.skillMpCost(b);
                    if (costTpA !== costTpB) return costTpA - costTpB;
                    return costMpA - costMpB;
                });
                this._data = list;
            } else {
                this._data = [];
            }
        },

        makeCategoryList: function () {
            if (this._actor) {
                const actorId = this._actor.actorId();
                const categoriesSet = new Set();
                let hasFavourites = false;
                for (const skill of this._actor.skills()) {
                    if (isDummySkill(skill)) continue;
                    if (this._stypeId && skill.stypeId !== this._stypeId) continue;
                    if (isSkillFavourited(actorId, skill.id)) hasFavourites = true;
                    // In Off mode the Basic category has its own dedicated battle
                    // command, so its skills are not listed among the categories.
                    if (basicHasOwnCommand() && getSkillCategory(skill) === DEFAULT_CATEGORY) continue;
                    const grp = getSkillGroup(skill);
                    // Filter out categories whose type (Magic/Skill) does not match
                    // the current stypeId's group (no-op in Role mode).
                    if (!_isCategoryVisibleForStypeId(grp, this._stypeId)) continue;
                    categoriesSet.add(grp);
                }
                const categories = Array.from(categoriesSet);
                if (isRoleMode()) {
                    categories.sort((a, b) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99));
                } else {
                    categories.sort();
                }
                if (hasFavourites) categories.unshift(FAVOURITES_CATEGORY);

                // Append a quick-access list of recently used skills below the
                // categories (a visual divider is drawn before them). Items at or
                // after _recentStartIndex are skill objects, not categories.
                this._recentStartIndex = null;
                const recents = getRecentSkillsForActor(this._actor, this._stypeId, RECENT_SKILLS_MAX);
                if (recents.length) {
                    this._recentStartIndex = categories.length;
                    this._data = categories.concat(recents);
                } else {
                    this._data = categories;
                }
            } else {
                this._data = [];
                this._recentStartIndex = null;
            }
        },

        // True when the item at this index is a recent-skill entry rather than a
        // category (only meaningful while the category list is showing).
        isRecentItem: function (index) {
            return this._categoryMode && this._recentStartIndex != null && index >= this._recentStartIndex;
        },

        makeFilteredSkillList: function () {
            this._recentStartIndex = null;
            if (this._actor) {
                if (CategorizedSkillMixin.shouldCategorize.call(this)) {
                    if (this._selectedCategory) {
                        const actorId = this._actor.actorId();
                        let list = this._actor.skills().filter(skill => {
                            if (isDummySkill(skill)) return false;
                            if (this._stypeId && skill.stypeId !== this._stypeId) return false;
                            if (this._selectedCategory === FAVOURITES_CATEGORY) {
                                return isSkillFavourited(actorId, skill.id);
                            }
                            // In Off mode, Basic skills live under their own command.
                            if (basicHasOwnCommand() && getSkillCategory(skill) === DEFAULT_CATEGORY) return false;
                            return getSkillGroup(skill) === this._selectedCategory;
                        });
                        // Sort by cost: cheaper on top, pricier on bottom
                        list.sort((a, b) => {
                            const costTpA = this._actor.skillTpCost(a);
                            const costMpA = this._actor.skillMpCost(a);
                            const costTpB = this._actor.skillTpCost(b);
                            const costMpB = this._actor.skillMpCost(b);
                            if (costTpA !== costTpB) return costTpA - costTpB;
                            return costMpA - costMpB;
                        });
                        this._data = list;
                    } else {
                        this._data = [];
                    }
                } else {
                    let list = this._actor.skills().filter(skill => {
                        if (isDummySkill(skill)) return false;
                        if (this._stypeId && skill.stypeId !== this._stypeId) return false;
                        // Basic-category skills live under the dedicated "Basic"
                        // command, so they are never duplicated in the regular list.
                        if (getSkillCategory(skill) === DEFAULT_CATEGORY) return false;
                        return true;
                    });
                    // Sort by cost: cheaper on top, pricier on bottom
                    list.sort((a, b) => {
                        const costTpA = this._actor.skillTpCost(a);
                        const costMpA = this._actor.skillMpCost(a);
                        const costTpB = this._actor.skillTpCost(b);
                        const costMpB = this._actor.skillMpCost(b);
                        if (costTpA !== costTpB) return costTpA - costTpB;
                        return costMpA - costMpB;
                    });
                    this._data = list;
                }
            } else {
                this._data = [];
            }
        },

        getCategoryIcon: function (categoryName) {
            return getCategoryInfo(categoryName).icon;
        },

        drawCategorizedItem: function (index) {
            const item = this.itemAt(index);
            if (!item) return;
            const rect = this.itemLineRect(index);
            if (this._categoryMode && !this.isRecentItem(index)) {
                this.changePaintOpacity(this.hasCategoryUsableSkills(item));
                this.resetTextColor();
                this.drawIcon(this.getCategoryIcon(item), rect.x + 2, rect.y + 2);
                this.drawText(getCategoryDisplayName(item), rect.x + ImageManager.iconWidth + 4, rect.y, rect.width - ImageManager.iconWidth - 4);
            } else {
                // All skills selectable regardless of usability
                this.changePaintOpacity(true);
                const isFav = this._actor && isSkillFavourited(this._actor.actorId(), item.id);
                const favW = isFav ? ImageManager.iconWidth + 4 : 0;
                this.drawItemName(item, rect.x, rect.y, rect.width - this.costWidth() - favW);
                if (isFav) {
                    this.drawIcon(FAVOURITE_ICON, rect.x + rect.width - this.costWidth() - ImageManager.iconWidth - 2, rect.y + 2);
                }
                this.drawSkillCost(item, rect.x, rect.y, rect.width);
            }
            this.changePaintOpacity(1);
        },

        costWidth: function () {
            return this.textWidth("000");
        },

        drawSkillCost: function (skill, x, y, width) {
            if (this._actor.skillTpCost(skill) > 0) {
                this.changeTextColor(ColorManager.tpCostColor());
                this.drawText(this._actor.skillTpCost(skill), x, y, width, "right");
                this.resetTextColor();
            } else if (this._actor.skillMpCost(skill) > 0) {
                this.changeTextColor(ColorManager.mpCostColor());
                this.drawText(this._actor.skillMpCost(skill), x, y, width, "right");
                this.resetTextColor();
            }
        },

        isCategoryEnabled: function (categoryName) {
            return true;
        },

        hasCategoryUsableSkills: function (categoryName) {
            if (!this._actor) return false;
            const actorId = this._actor.actorId();
            return this._actor.skills().some(skill => {
                if (isDummySkill(skill)) return false;
                if (this._stypeId && skill.stypeId !== this._stypeId) return false;
                if (categoryName === FAVOURITES_CATEGORY) {
                    return isSkillFavourited(actorId, skill.id) && this._actor.canUse(skill);
                }
                // In Off mode Basic skills live under their own command, not a group.
                if (basicHasOwnCommand() && getSkillCategory(skill) === DEFAULT_CATEGORY) return false;
                const grp = getSkillGroup(skill);
                if (grp !== categoryName) return false;
                // Hide categories whose type does not match current stypeId group
                if (!_isCategoryVisibleForStypeId(grp, this._stypeId)) return false;
                if (categoryName === 'Swordsmanship' || categoryName === 'Firearms') { // i18n-ignore: Categories.json keys
                    if (!isCategoryCompatibleWithWeapon(categoryName, getEquippedWeaponType(this._actor))) return false;
                }
                return this._actor.canUse(skill);
            });
        },

        isCategorizedItemEnabled: function (item, originalIsEnabled) {
            if (this._categoryMode) return this.isCategoryEnabled(item);
            return true; // All skills selectable; usability shown in action context menu
        },

        processCategorizedOk: function (originalProcessOk) {
            // A recent-skill entry shown under the category list confirms the skill
            // directly, exactly like picking it from a category's skill list.
            if (this._categoryMode && !this.isRecentItem(this.index())) {
                if (this.isCurrentItemEnabled()) {
                    SoundManager.playOk();
                    this._selectedCategory = this.item();
                    this._lastCategoryIndex = this.index();
                    this._categoryMode = false;
                    this.refresh();
                    const savedIndex = this._categorySkillIndexes[this._selectedCategory];
                    if (savedIndex !== undefined && savedIndex < this.maxItems()) {
                        this.select(savedIndex);
                    } else {
                        this.select(0);
                    }
                    this.activate();
                } else {
                    this.playBuzzerSound();
                }
            } else {
                if (this._selectedCategory) {
                    this._categorySkillIndexes[this._selectedCategory] = this.index();
                }
                // Show skill action menu instead of directly confirming
                if (this.isHandled('skillaction')) {
                    SoundManager.playOk();
                    this.updateInputData();
                    this.deactivate();
                    this.callHandler('skillaction');
                } else {
                    originalProcessOk.call(this);
                }
            }
        },

        processCategorizedCancel: function (originalProcessCancel) {
            if (this._basicMode) {
                // No category layer to back out to; return straight to the command window.
                originalProcessCancel.call(this);
                return;
            }
            if (!CategorizedSkillMixin.shouldCategorize.call(this)) {
                originalProcessCancel.call(this);
                return;
            }
            if (!this._categoryMode) {
                if (this._selectedCategory) {
                    this._categorySkillIndexes[this._selectedCategory] = this.index();
                }
                this._categoryMode = true;
                this._selectedCategory = null;
                this.refresh();
                this.select(Math.min(this._lastCategoryIndex, this.maxItems() - 1));
                this.activate();
                SoundManager.playCancel();
            } else {
                originalProcessCancel.call(this);
            }
        },

        handleCursorMove: function () {
            const isP2 = window.$gameSplitScreen && window.$gameSplitScreen.active &&
                this._actor && this._actor.multiplayerPlayerId && this._actor.multiplayerPlayerId() === 2;
            const input = isP2 ? window.$gameSplitScreen : Input;

            if (input.isRepeated("down")) {
                if (this.index() >= this.maxItems() - 1) {
                    this.select(0);
                    this.playCursorSound();
                } else {
                    this.cursorDown(input.isTriggered("down"));
                }
            } else if (input.isRepeated("up")) {
                if (this.index() <= 0) {
                    this.select(this.maxItems() - 1);
                    this.playCursorSound();
                } else {
                    this.cursorUp(input.isTriggered("up"));
                }
            } else if (input.isRepeated("right")) {
                this.cursorRight(input.isTriggered("right"));
            } else if (input.isRepeated("left")) {
                this.cursorLeft(input.isTriggered("left"));
            } else {
                if (!this.isHandled("pagedown") && input.isRepeated("pagedown")) this.cursorPagedown();
                if (!this.isHandled("pageup") && input.isRepeated("pageup")) this.cursorPageup();
            }
        },

        updateCategoryHelp: function () {
            if (this._categoryMode) {
                const category = this.item();
                this.setHelpWindowText(category ? getCategoryDescription(category) : '');
            }
        }
    };

    //=============================================================================
    // Window_BattleSkill ,  categorized battle skill window
    // NOTE: This section must come before Window_SkillList overrides so that
    // prototype captures (maxCols, setActor, processOk, etc.) grab the base
    // RPG Maker versions, not our menu overrides.
    //=============================================================================

    // -------------------------------------------------------------------------
    // HTML Battle Skill Overlay ,  parchment overlay matching DialogueSystem
    // -------------------------------------------------------------------------
    // getBoundingClientRect() forces a synchronous layout, so cache the canvas
    // rect and only recompute it when the window is resized. Calling this every
    // frame from the skill-menu update() was a needless reflow per frame.
    let _cachedMsgScale = null;
    window.addEventListener('resize', () => { _cachedMsgScale = null; });

    function _msgGetScale() {
        if (_cachedMsgScale) return _cachedMsgScale;
        const el = document.getElementById('gameCanvas');
        if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
        const r = el.getBoundingClientRect();
        _cachedMsgScale = {
            sx: r.width / Graphics.width,
            sy: r.height / Graphics.height,
            ox: r.left,
            oy: r.top
        };
        return _cachedMsgScale;
    }

    function getIconStyle(iconIndex) {
        const x = (iconIndex % 16) * 32;
        const y = Math.floor(iconIndex / 16) * 32;
        return `background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; vertical-align: middle; image-rendering: pixelated; transform: scale(0.75); margin-right: 4px;`;
    }

    const _Window_BattleSkill_initialize = Window_BattleSkill.prototype.initialize;
    Window_BattleSkill.prototype.initialize = function (rect) {
        _Window_BattleSkill_initialize.call(this, rect);
        CategorizedSkillMixin.initializeCategorizedMode.call(this);

        // Remove old overlay if any
        const old = document.getElementById('html-battle-skill-overlay');
        if (old) old.remove();

        const root = document.createElement('div');
        root.id = 'html-battle-skill-overlay';
        // i18n-ignore-start: a CSS declaration list, split over several lines
        root.style.cssText =
            'position:fixed;z-index:501;pointer-events:none;' +
            'box-sizing:border-box;overflow-y:auto;display:grid;' +
            'background:var(--text-danger-hover);' +
            'border:3px solid var(--border-subtle);border-radius:6px;' +
            'outline:1px solid var(--border-subtle-translucent-40);outline-offset:-7px;' +
            'background-image:radial-gradient(ellipse at center,' +
            'transparent 40%,var(--bg-brown-vignette-10) 100%);' +
            'padding:16px 12px;' +
            'transform:translateX(115%);opacity:0;' +
            'transition:transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s ease;';
        // i18n-ignore-end

        // Right click to cancel / back out
        root.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.active && typeof this.processCancel === 'function') {
                this.processCancel();
            }
        });

        // Delegated pointer handling on the persistent root. Per-row listeners
        // were attached inside _buildSkillItems(), which rebuilds the rows on
        // every refresh(); a refresh landing between a row's mousedown and its
        // mouseup stranded the old listener and the 'click' silently dropped.
        // Delegating on the root (which never gets rebuilt) and activating on
        // pointerup makes every click register regardless of rebuild timing.
        const rowIdxFromEvent = (e) => {
            const el = e.target && e.target.closest && e.target.closest('[data-idx]');
            if (!el || !root.contains(el)) return -1;
            const i = parseInt(el.dataset.idx, 10);
            return isNaN(i) ? -1 : i;
        };
        root.addEventListener('mouseover', (e) => {
            if (!this.active) return;
            const i = rowIdxFromEvent(e);
            if (i >= 0 && typeof this.select === 'function') this.select(i);
        });
        root.addEventListener('pointerup', (e) => {
            if (e.button !== undefined && e.button !== 0) return; // left button only
            if (!this.active) return;
            const i = rowIdxFromEvent(e);
            if (i < 0) return;
            if (typeof this.select === 'function') this.select(i);
            if (typeof this.processOk === 'function') this.processOk();
        });

        this._htmlSkillRoot = root;
        document.body.appendChild(root);

        root.addEventListener("wheel", (e) => {
            e.preventDefault();
            root.scrollTop += e.deltaY;
        }, { passive: false });
    };

    // Keep the window logically active/visible to the engine for keyboard/controller input,
    // but prevent PIXI from drawing its canvas graphics.
    Window_BattleSkill.prototype.render = function (renderer) {
        // Prevent PIXI rendering
    };

    Window_BattleSkill.prototype._render = function (renderer) {
        // Prevent PIXI rendering
    };

    const _Window_BattleSkill_destroy = Window_BattleSkill.prototype.destroy || Window_Selectable.prototype.destroy;
    Window_BattleSkill.prototype.destroy = function (options) {
        if (this._htmlSkillRoot && this._htmlSkillRoot.parentNode) {
            this._htmlSkillRoot.parentNode.removeChild(this._htmlSkillRoot);
        }
        this._htmlSkillRoot = null;
        if (_Window_BattleSkill_destroy) _Window_BattleSkill_destroy.call(this, options);
    };

    const _Window_BattleSkill_setActor = Window_BattleSkill.prototype.setActor;
    Window_BattleSkill.prototype.setActor = function (actor) {
        CategorizedSkillMixin.resetCategorizedState.call(this, actor);
        _Window_BattleSkill_setActor.call(this, actor);
    };

    const _Window_BattleSkill_show = Window_BattleSkill.prototype.show;
    Window_BattleSkill.prototype.show = function () {
        CategorizedSkillMixin.resetToCategoryMode.call(this);
        this.refresh();
        _Window_BattleSkill_show.call(this);
        if (this._categoryMode && this._lastCategoryIndex !== undefined) {
            this.select(Math.min(this._lastCategoryIndex, this.maxItems() - 1));
        } else if (!this._categoryMode) {
            this.select(0);
        }
        if (this._htmlSkillRoot) {
            this._buildSkillItems();
            setTimeout(() => {
                if (this._htmlSkillRoot && this.visible) {
                    this._htmlSkillRoot.style.transform = 'translateX(0)';
                    this._htmlSkillRoot.style.opacity = '1';
                    this._htmlSkillRoot.style.pointerEvents = 'auto';
                }
            }, 0);
        }
    };

    const _Window_BattleSkill_hide = Window_BattleSkill.prototype.hide;
    Window_BattleSkill.prototype.hide = function () {
        _Window_BattleSkill_hide.call(this);
        if (this._htmlSkillRoot) {
            this._htmlSkillRoot.style.transform = 'translateX(115%)';
            this._htmlSkillRoot.style.opacity = '0';
            this._htmlSkillRoot.style.pointerEvents = 'none';
        }
    };

    const _Window_BattleSkill_refresh = Window_BattleSkill.prototype.refresh;
    Window_BattleSkill.prototype.refresh = function () {
        if (!this._navigatingCategories) CategorizedSkillMixin.resetToCategoryMode.call(this);
        _Window_BattleSkill_refresh.call(this);
        if (this._categoryMode && this._lastCategoryIndex !== undefined && !this._navigatingCategories) {
            this.select(Math.min(this._lastCategoryIndex, this.maxItems() - 1));
        }
        if (this._htmlSkillRoot) {
            this._buildSkillItems();
        }
    };

    // Force single column layout to match narrow portrait page shape
    Window_BattleSkill.prototype.maxCols = function () {
        return 1;
    };

    Window_BattleSkill.prototype.processTouch = function () {
        // Disable standard touch inputs to prevent conflict with custom HTML overlay events
    };

    Window_BattleSkill.prototype.makeItemList = function () {
        CategorizedSkillMixin.makeCategorizedItemList.call(this);
    };

    Window_BattleSkill.prototype.shouldCategorize = CategorizedSkillMixin.shouldCategorize;
    Window_BattleSkill.prototype.makeCategoryList = CategorizedSkillMixin.makeCategoryList;
    Window_BattleSkill.prototype.makeBasicSkillList = CategorizedSkillMixin.makeBasicSkillList;
    Window_BattleSkill.prototype.makeFilteredSkillList = CategorizedSkillMixin.makeFilteredSkillList;

    // Enables/disables the cross-type "Basic" skill view used by the Basic battle command.
    Window_BattleSkill.prototype.setBasicMode = function (flag) {
        this._basicMode = !!flag;
    };
    Window_BattleSkill.prototype.isCategoryEnabled = CategorizedSkillMixin.isCategoryEnabled;
    Window_BattleSkill.prototype.hasCategoryUsableSkills = CategorizedSkillMixin.hasCategoryUsableSkills;
    Window_BattleSkill.prototype.getCategoryIcon = CategorizedSkillMixin.getCategoryIcon;
    Window_BattleSkill.prototype.isRecentItem = CategorizedSkillMixin.isRecentItem;

    Window_BattleSkill.prototype.drawItem = function (index) {
        CategorizedSkillMixin.drawCategorizedItem.call(this, index);
    };

    const _Window_BattleSkill_isEnabled = Window_BattleSkill.prototype.isEnabled;
    Window_BattleSkill.prototype.isEnabled = function (item) {
        return CategorizedSkillMixin.isCategorizedItemEnabled.call(this, item, _Window_BattleSkill_isEnabled);
    };

    const _Window_BattleSkill_processOk = Window_BattleSkill.prototype.processOk;
    Window_BattleSkill.prototype.processOk = function () {
        this._navigatingCategories = true;
        CategorizedSkillMixin.processCategorizedOk.call(this, _Window_BattleSkill_processOk);
        this._navigatingCategories = false;
    };

    const _Window_BattleSkill_processCancel = Window_BattleSkill.prototype.processCancel;
    Window_BattleSkill.prototype.processCancel = function () {
        this._navigatingCategories = true;
        CategorizedSkillMixin.processCategorizedCancel.call(this, _Window_BattleSkill_processCancel);
        this._navigatingCategories = false;
    };

    const _Window_BattleSkill_processCursorMove = Window_BattleSkill.prototype.processCursorMove;
    Window_BattleSkill.prototype.processCursorMove = function () {
        if (this.isCursorMovable()) {
            CategorizedSkillMixin.handleCursorMove.call(this);
        }
    };

    // Builds the battle help/description text for a skill, appending its element
    // (icon + name) so the player sees it in the description box. The MP/AP cost is
    // intentionally omitted here, it is already shown on each skill list entry.
    function buildBattleSkillHelpText(skill, actor) {
        let text = skill.description || '';
        if (skill.damage && skill.damage.elementId > 0 &&
            $dataSystem.elements && $dataSystem.elements[skill.damage.elementId]) {
            const iconIndex = 63 + skill.damage.elementId - 1;
            text += (text ? '\n' : '') +
                '\\I[' + iconIndex + ']' + $dataSystem.elements[skill.damage.elementId];
        }
        return text;
    }

    const _Window_BattleSkill_updateHelp = Window_BattleSkill.prototype.updateHelp;
    Window_BattleSkill.prototype.updateHelp = function () {
        if (this._categoryMode && !this.isRecentItem(this.index())) {
            this.setHelpWindowText('');
        } else {
            const skill = this.item();
            if (skill) {
                this.setHelpWindowText(buildBattleSkillHelpText(skill, this._actor));
            } else {
                _Window_BattleSkill_updateHelp.call(this);
            }
        }
    };

    Window_BattleSkill.prototype.setHelpWindowText = function (text) {
        if (this._helpWindow) this._helpWindow.setText(text);
    };

    Window_BattleSkill.prototype._buildSkillItems = function () {
        const root = this._htmlSkillRoot;
        if (!root) return;
        // Rows are recreated fresh (transparent), so force update() to re-apply
        // the selection highlight and font size on its next pass.
        this._lastSkillIdx = null;
        this._prevSkillHiIdx = null;
        root.innerHTML = '';

        root.style.display = 'grid';
        root.style.gridTemplateColumns = '1fr';
        root.style.gridGap = '6px 12px';
        root.style.alignContent = 'start';

        const sc = _msgGetScale();
        const baseFontSize = (typeof this.standardFontSize === 'function')
            ? this.standardFontSize() : 24;
        const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);

        const items = this._data || [];

        this._htmlSkillEls = items.map((item, i) => {
            const el = document.createElement('div');
            el.dataset.idx = i;
            el.style.cssText =
                'font-family:\'Lora\',serif;font-weight:bold;color:var(--text-primary-hover);' +
                'padding:6px 12px;border-radius:4px;cursor:pointer;' +
                'border:2px solid transparent;transition:background 0.1s, border-color 0.1s;' +
                'display:flex;align-items:center;justify-content:space-between;' +
                'user-select:none;box-sizing:border-box;min-height:40px;';
            el.style.fontSize = scaledFont + 'px';

            const leftDiv = document.createElement('div');
            leftDiv.style.cssText = 'display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            if (this._categoryMode && !this.isRecentItem(i)) {
                const category = item;
                const isEnabled = this.hasCategoryUsableSkills(category);

                const iconIndex = this.getCategoryIcon(category);
                const iconSpan = document.createElement('span');
                iconSpan.style.cssText = getIconStyle(iconIndex);
                leftDiv.appendChild(iconSpan);

                const nameSpan = document.createElement('span');
                nameSpan.textContent = getCategoryDisplayName(category);
                leftDiv.appendChild(nameSpan);
                el.appendChild(leftDiv);

                if (!isEnabled) {
                    el.style.opacity = '0.4';
                }
            } else {
                const skill = item;
                const actorId = this._actor ? this._actor.actorId() : 0;
                const isEnabled = this._actor ? this._actor.canUse(skill) : false;

                const iconIndex = skill.iconIndex;
                const iconSpan = document.createElement('span');
                iconSpan.style.cssText = getIconStyle(iconIndex);
                leftDiv.appendChild(iconSpan);

                const nameSpan = document.createElement('span');
                nameSpan.textContent = skill.name;
                leftDiv.appendChild(nameSpan);
                el.appendChild(leftDiv);

                const rightDiv = document.createElement('div');
                rightDiv.style.cssText = 'display:flex;align-items:center;font-size:85%;';

                const isFav = this._actor && isSkillFavourited(actorId, skill.id);
                if (isFav) {
                    const favSpan = document.createElement('span');
                    favSpan.style.cssText = getIconStyle(FAVOURITE_ICON);
                    rightDiv.appendChild(favSpan);
                }

                if (this._actor) {
                    const tpCost = this._actor.skillTpCost(skill);
                    const mpCost = this._actor.skillMpCost(skill);
                    if (tpCost > 0) {
                        const costSpan = document.createElement('span');
                        costSpan.style.color = 'var(--text-primary-hover)';
                        costSpan.style.fontWeight = 'bold';
                        costSpan.style.marginLeft = '8px';
                        costSpan.textContent = tpCost + ' AP';
                        rightDiv.appendChild(costSpan);
                    } else if (mpCost > 0) {
                        const costSpan = document.createElement('span');
                        costSpan.style.color = 'var(--text-primary-hover)';
                        costSpan.style.fontWeight = 'bold';
                        costSpan.style.marginLeft = '8px';
                        costSpan.textContent = mpCost + ' MP';
                        rightDiv.appendChild(costSpan);
                    }
                }
                el.appendChild(rightDiv);

                if (!isEnabled) {
                    el.style.opacity = '0.4';
                }
            }

            // Draw a labelled divider just before the first recent-skill entry to
            // separate it from the category list above.
            if (this._recentStartIndex != null && i === this._recentStartIndex) {
                const divider = document.createElement('div');
                divider.style.cssText =
                    'display:flex;align-items:center;gap:8px;margin:4px 2px 2px;' +
                    'font-family:\'Lora\',serif;font-size:0.72em;font-weight:bold;' +
                    'letter-spacing:1px;text-transform:uppercase;color:var(--text-card-medium);' +
                    'user-select:none;';
                const line = () => {
                    const hr = document.createElement('div');
                    hr.style.cssText = 'flex:1;height:1px;background:var(--border-gold-amber-30,rgba(255,255,255,0.18));';
                    return hr;
                };
                const lbl = document.createElement('span');
                lbl.textContent = T('SkillsMenu.recent');
                divider.appendChild(line());
                divider.appendChild(lbl);
                divider.appendChild(line());
                root.appendChild(divider);
            }

            // Pointer handling is delegated on the persistent root (see
            // Window_BattleSkill.initialize); the data-idx attribute set above is
            // all the delegation needs, so no per-row listeners are attached here.
            root.appendChild(el);
            return el;
        });
    };

    const _Window_BattleSkill_update = Window_BattleSkill.prototype.update;
    Window_BattleSkill.prototype.update = function () {
        _Window_BattleSkill_update.call(this);

        if (!this._htmlSkillRoot) return;

        // Hide overlay if the window is closed or not open yet
        if (!this.visible || this.openness === 0 || !this.isOpen() || this.height === 0 || this.width === 0) {
            if (this._lastSkillClosed !== true) {
                this._htmlSkillRoot.style.transform = 'translateX(115%)';
                this._htmlSkillRoot.style.opacity = '0';
                this._htmlSkillRoot.style.pointerEvents = 'none';
                this._lastSkillClosed = true;
                this._lastSkillIdx = null;
            }
            return;
        }

        const sc = _msgGetScale();
        const idx = this.index();

        // Everything below writes to the DOM (and getBoundingClientRect() forces
        // a reflow). None of it changes unless the selection, scale, or open
        // state changed, so bail out early on the common no-change frame.
        if (this._lastSkillClosed === false && this._lastSkillIdx === idx &&
            this._lastSkillSx === sc.sx && this._lastSkillSy === sc.sy) {
            return;
        }
        const idxChanged = this._lastSkillIdx !== idx;
        const layoutChanged = this._lastSkillClosed !== false ||
            this._lastSkillSx !== sc.sx || this._lastSkillSy !== sc.sy;
        this._lastSkillClosed = false;
        this._lastSkillIdx = idx;
        this._lastSkillSx = sc.sx;
        this._lastSkillSy = sc.sy;

        const s = this._htmlSkillRoot.style;
        const baseFontSize = (typeof this.standardFontSize === 'function')
            ? this.standardFontSize() : 24;
        const scaledFont = Math.round(baseFontSize * sc.sy * 0.85);

        if (layoutChanged) {
            const pad = this.padding || 12;
            // Define portrait narrow page dimensions
            const scaledW = 420 * sc.sx;
            const scaledH = 460 * sc.sy;

            // Position bottom-right, aligned with bottom-right commands
            const targetLeft = sc.ox + (Graphics.width * sc.sx) - scaledW - (20 * sc.sx);
            const targetTop = sc.oy + (Graphics.height * sc.sy) - scaledH - (20 * sc.sy);

            s.left = targetLeft + 'px';
            s.top = targetTop + 'px';
            s.width = scaledW + 'px';
            s.height = scaledH + 'px';
            s.padding = Math.round(pad * sc.sy) + 'px ' + Math.round(pad * sc.sx) + 'px';

            // Trigger slide-in/open transition styles
            s.transform = 'translateX(0)';
            s.opacity = '1';
            s.pointerEvents = 'auto';
        }

        if (this._htmlSkillEls) {
            const prevIdx = idxChanged ? this._prevSkillHiIdx : idx;
            // Only recolour the two rows whose highlight state flips, and only
            // restamp every row's font size when the scale actually changed.
            this._htmlSkillEls.forEach((el, i) => {
                if (layoutChanged) el.style.fontSize = scaledFont + 'px';
                if (i === idx) {
                    el.style.background = 'var(--bg-subtle-translucent-15)';
                    el.style.borderColor = 'var(--border-subtle)';
                } else if (i === prevIdx || layoutChanged) {
                    el.style.background = 'transparent';
                    el.style.borderColor = 'transparent';
                }
            });
            this._prevSkillHiIdx = idx;

            // Scroll the selected element into view for keyboard/controller navigation
            if (this._htmlSkillEls[idx]) {
                const container = this._htmlSkillRoot;
                const el = this._htmlSkillEls[idx];
                const cRect = container.getBoundingClientRect();
                const eRect = el.getBoundingClientRect();
                if (eRect.top < cRect.top) {
                    container.scrollTop -= cRect.top - eRect.top;
                } else if (eRect.bottom > cRect.bottom) {
                    container.scrollTop += eRect.bottom - cRect.bottom;
                }
            }
        }
    };


    //=============================================================================
    // Scene_Skill ,  fullscreen layout with party member switching
    //=============================================================================

    const _Scene_Skill_create = Scene_Skill.prototype.create;
    Scene_Skill.prototype.create = function () {
        _Scene_Skill_create.call(this);

        // Deactivate standard canvas windows and hide them
        if (this._skillTypeWindow) {
            this._skillTypeWindow.visible = false;
            this._skillTypeWindow.deactivate();
        }
        if (this._statusWindow) {
            this._statusWindow.visible = false;
            this._statusWindow.deactivate();
        }
        if (this._itemWindow) {
            this._itemWindow.visible = false;
            this._itemWindow.deactivate();
        }
        if (this._skillActionWindow) {
            this._skillActionWindow.visible = false;
            this._skillActionWindow.deactivate();
        }

        this._actorIndex = $gameParty.allMembers().indexOf(this.actor());
        if (this._actorIndex < 0) this._actorIndex = 0;

        // UI UI states
        this._dndActiveSection = "types"; // "types", "skills", "actions", "targets"
        this._dndSelectedTypeIndex = 0;
        this._dndSelectedIndex = 0; // selected category or skill row
        this._dndSelectedActionIndex = 0;
        this._dndSelectedTargetIndex = 0;
        this._dndTargetingMode = false;
        this._dndTargetingSkill = null;
        this._collapsedCategories = new Set();

        this.createUISkillOverlay();
    };

    const _Scene_Skill_start = Scene_Skill.prototype.start;
    Scene_Skill.prototype.start = function () {
        _Scene_Skill_start.call(this);
        if (this._skillTypeWindow) {
            this._skillTypeWindow.visible = false;
            this._skillTypeWindow.deactivate();
        }
        if (this._itemWindow) {
            this._itemWindow.visible = false;
            this._itemWindow.deactivate();
        }
        if (this._statusWindow) {
            this._statusWindow.visible = false;
            this._statusWindow.deactivate();
        }
        if (this._skillActionWindow) {
            this._skillActionWindow.visible = false;
            this._skillActionWindow.deactivate();
        }
    };

    const _Scene_Skill_createStatusWindow = Scene_Skill.prototype.createStatusWindow;
    Scene_Skill.prototype.createStatusWindow = function () {
        const rect = this.statusWindowRect();
        this._statusWindow = new Window_SkillInfo(rect);
        this._statusWindow.setActor(this.actor());
        this.addWindow(this._statusWindow);
    };

    const _Scene_Skill_createItemWindow = Scene_Skill.prototype.createItemWindow;
    Scene_Skill.prototype.createItemWindow = function () {
        _Scene_Skill_createItemWindow.call(this);
        if (this._statusWindow && this._itemWindow) {
            this._itemWindow.setSkillInfoWindow(this._statusWindow);
        }
        this._itemWindow.setHandler('skillaction', this.onSkillAction.bind(this));
        const ww = 220;
        const wh = this.calcWindowHeight(3, true);
        const rect = new Rectangle(Math.floor((Graphics.boxWidth - ww) / 2), Math.floor((Graphics.boxHeight - wh) / 2), ww, wh);
        this._skillActionWindow = new Window_SkillAction(rect);
        this._skillActionWindow.setHandler('ok', this.onSkillActionOk.bind(this));
        this._skillActionWindow.setHandler('cancel', this.onSkillActionCancel.bind(this));
        this.addWindow(this._skillActionWindow);
    };

    Scene_Skill.prototype.onSkillAction = function () {
        this._skillActionWindow.setSkill(this.actor(), this._itemWindow.item());
    };

    Scene_Skill.prototype.onSkillActionOk = function () {
        const symbol = this._skillActionWindow.currentSymbol();
        if (symbol === 'use') {
            this._skillActionWindow.hide();
            this._skillActionWindow.deactivate();
            this.onItemOk();
        } else if (symbol === 'favourite') {
            const skill = this._itemWindow.item();
            if (skill) toggleFavouriteSkill(this.actor().actorId(), skill.id);
            this._skillActionWindow.hide();
            this._skillActionWindow.deactivate();
            this._itemWindow.refresh();
            this._itemWindow.activate();
        } else if (symbol === 'cancel') {
            this.onSkillActionCancel();
        }
    };

    Scene_Skill.prototype.onSkillActionCancel = function () {
        this._skillActionWindow.hide();
        this._skillActionWindow.deactivate();
        this._itemWindow.activate();
    };

    const _Scene_Skill_update = Scene_Skill.prototype.update;
    Scene_Skill.prototype.update = function () {
        if (this._skillTypeWindow && this._skillTypeWindow.active) this._skillTypeWindow.deactivate();
        if (this._itemWindow && this._itemWindow.active) this._itemWindow.deactivate();
        if (this._statusWindow && this._statusWindow.active) this._statusWindow.deactivate();
        if (this._skillActionWindow && this._skillActionWindow.active) this._skillActionWindow.deactivate();
        if (this._actorWindow && this._actorWindow.active) this._actorWindow.deactivate();

        _Scene_Skill_update.call(this);
        UISkillInputManager.update();
    };

    Scene_Skill.prototype.updateActorSelection = function () {
        // Handled directly inside UISkillInputManager
    };

    Scene_Skill.prototype.nextActor = function () {
        const allMembers = $gameParty.allMembers();
        if (allMembers.length <= 1) return;
        this._actorIndex = (this._actorIndex + 1) % allMembers.length;
        this.changeActor();
    };

    Scene_Skill.prototype.previousActor = function () {
        const allMembers = $gameParty.allMembers();
        if (allMembers.length <= 1) return;
        this._actorIndex = (this._actorIndex - 1 + allMembers.length) % allMembers.length;
        this.changeActor();
    };

    // Cycle the displayed party member from a keyboard/controller shortcut,
    // resetting the category/skill selection so the new actor opens cleanly.
    Scene_Skill.prototype.cycleUIActor = function (dir) {
        const allMembers = $gameParty.allMembers();
        if (allMembers.length <= 1) return;
        this._actorIndex = (this._actorIndex + dir + allMembers.length) % allMembers.length;
        this.changeActor();
        this._dndSelectedIndex = 0;
        this._dndSelectedCategoryIndex = 0;
        this.refreshUISkill();
    };

    Scene_Skill.prototype.changeActor = function () {
        const newActor = $gameParty.allMembers()[this._actorIndex];
        if (newActor && this._actor !== newActor) {
            this._actor = newActor;
            SoundManager.playCursor();
            if (this._statusWindow) this._statusWindow.setActor(this._actor);
            if (this._skillTypeWindow) {
                this._skillTypeWindow.setActor(this._actor);
                this._skillTypeWindow.refresh();
            }
            if (this._itemWindow) {
                this._itemWindow.setActor(this._actor);
                this._itemWindow.refresh();
                this._itemWindow.scrollTo(0, 0);
                this._itemWindow.select(0);
            }
        }
    };

    Scene_Skill.prototype.actor = function () {
        return this._actor;
    };

    Scene_Skill.prototype.helpAreaHeight = function () {
        return this.calcWindowHeight(2, false);
    };

    Scene_Skill.prototype.helpAreaTop = function () {
        return Graphics.boxHeight - this.helpAreaHeight();
    };

    Scene_Skill.prototype.mainAreaTop = function () {
        return 0;
    };

    Scene_Skill.prototype.mainAreaHeight = function () {
        return Graphics.boxHeight - this.helpAreaHeight();
    };

    Scene_Skill.prototype.skillTypeWindowRect = function () {
        return new Rectangle(0, 0, 240, this.calcWindowHeight(4, true));
    };

    Scene_Skill.prototype.statusWindowRect = function () {
        return new Rectangle(240, 0, Graphics.boxWidth - 240, this.calcWindowHeight(4, true));
    };

    Scene_Skill.prototype.itemWindowRect = function () {
        const wy = this.calcWindowHeight(4, true);
        return new Rectangle(0, wy, Graphics.boxWidth, this.mainAreaHeight() - wy);
    };

    // --- UI UI Overlay Engine for Skills ---

    Scene_Skill.prototype.createUISkillOverlay = function () {
        window.SkillDetails.injectStyles();
        // Initialize the new category selection index
        this._dndSelectedCategoryIndex = 0;
        this._collapsedCategories = new Set();

        // Dynamic companions and spellbook styles
        let companionStyles = document.getElementById("companion-styles");
        if (!companionStyles) {
            companionStyles = document.createElement("style");
            companionStyles.id = "companion-styles";
            document.head.appendChild(companionStyles);
        }
        companionStyles.innerHTML = `
            .companion-tabs-row {
                display: flex;
                justify-content: flex-end;
                align-items: center;
            }
            .companion-tab {
                font-family: 'Lora', serif;
                font-size: 1.05rem;
                padding: 6px 14px;
                margin: 0 6px;
                color: var(--text-primary-hover);
                cursor: pointer;
                border: 1px solid transparent;
                border-radius: 4px;
                transition: all 0.2s ease;
                user-select: none;
                font-weight: bold;
            }
            .companion-tab.selected {
                background: var(--text-primary-hover);
                color: var(--bg-secondary-hover) !important;
                font-weight: bold;
                box-shadow: 0 2px 4px var(--shadow-gold-amber-50);
            }
            .companion-tab:hover {
                background: var(--bg-primary-hover-translucent-35);
            }

            .skill-types-row {
                display: flex;
                justify-content: center;
                margin-bottom: 15px;
                border-bottom: 2px dashed var(--border-gold-amber-30);
                padding-bottom: 8px;
            }
            .skill-type-tab {
                font-family: 'Lora', serif;
                font-size: 0.95rem;
                padding: 5px 12px;
                margin: 0 5px;
                color: var(--text-primary-hover);
                cursor: pointer;
                border: 1px solid var(--border-gold-amber-30);
                background: var(--bg-panel);
                border-radius: 4px;
                transition: all 0.15s ease;
                user-select: none;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .skill-type-tab.active {
                background: var(--text-primary-hover);
                color: var(--bg-secondary-hover) !important;
                border-color: var(--text-primary-hover);
                box-shadow: 0 2px 4px var(--shadow-gold-amber-50);
            }
            .skill-type-tab.selected {
                outline: 2px solid var(--text-primary-hover);
                outline-offset: 1px;
            }
            .skill-type-tab:hover {
                background: var(--bg-primary-hover-translucent-35);
                border-color: var(--text-primary-hover);
            }

            .skill-book-content {
                display: flex;
                flex-direction: column;
                height: 660px;
                overflow-y: auto;
                padding-right: 6px;
                box-sizing: border-box;
            }
            .skill-book-content::-webkit-scrollbar {
                width: 6px;
            }
            .skill-book-content::-webkit-scrollbar-track {
                background: rgba(74, 39, 17, 0.05);
                border-radius: 3px;
            }
            .skill-book-content::-webkit-scrollbar-thumb {
                background: rgba(74, 39, 17, 0.25);
                border-radius: 3px;
            }
            .skill-book-content::-webkit-scrollbar-thumb:hover {
                background: rgba(74, 39, 17, 0.45);
            }

            .skill-section-title {
                font-family: 'Lora', serif;
                font-size: 1.15rem;
                font-weight: bold;
                color: var(--text-primary-hover);
                margin: 14px 0 8px 0;
                border-bottom: 1.5px solid var(--border-gold-amber-30);
                padding-bottom: 4px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .skill-section-title:first-child {
                margin-top: 0;
            }
            .skill-section-subtitle {
                font-size: 0.72rem;
                font-style: italic;
                color: var(--text-card-medium);
                font-weight: normal;
            }

            .skills-grid-container {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                grid-gap: 10px;
                align-content: start;
                padding-bottom: 10px;
            }

            .discipline-card, .skill-card-slot {
                background: var(--bg-panel);
                border: 1px solid var(--border-gold-amber-30);
                border-radius: 5px;
                padding: 6px 10px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                transition: all 0.15s ease;
                user-select: none;
                box-sizing: border-box;
                min-height: 44px;
            }
            .discipline-card:hover, .skill-card-slot:hover {
                background: var(--bg-primary-hover-translucent-35);
                border-color: var(--text-primary-hover);
            }
            .discipline-card.selected, .skill-card-slot.selected {
                background: var(--bg-tertiary-focus-translucent-45);
                border-color: var(--text-primary-hover);
                box-shadow: 0 0 6px var(--shadow-gold-amber-50);
                outline: 2px solid var(--text-primary-hover);
            }

            .card-left-side {
                display: flex;
                align-items: center;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .card-title-text {
                font-family: 'Lora', serif;
                font-weight: bold;
                color: var(--text-primary-hover);
                font-size: 0.9rem;
            }
            .card-right-side {
                display: flex;
                align-items: center;
                font-size: 80%;
                font-family: 'Lora', serif;
            }
            .card-cost-label {
                color: var(--text-gold-dark);
                font-weight: bold;
                margin-left: 6px;
            }
            .card-tag {
                font-size: 0.72rem;
                color: var(--text-card-medium);
                font-style: italic;
            }

            .category-detail-header {
                display: flex;
                align-items: center;
                margin-bottom: 15px;
                border-bottom: 2px solid var(--border-gold-amber-30);
                padding-bottom: 8px;
            }
            .category-back-btn {
                font-family: 'Lora', serif;
                font-size: 0.8rem;
                background: var(--border-primary-hover-translucent-15);
                color: var(--text-primary-hover);
                padding: 3px 10px;
                border-radius: 4px;
                font-weight: bold;
                cursor: pointer;
                border: 1.5px solid var(--text-primary-hover);
                margin-right: 12px;
                text-transform: uppercase;
                user-select: none;
                transition: all 0.15s ease;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .category-back-btn:hover {
                background: var(--text-primary-hover);
                color: var(--bg-secondary-hover);
            }
            .category-detail-title {
                font-family: 'Lora', serif;
                font-size: 1.3rem;
                font-weight: bold;
                color: var(--text-primary-hover);
            }

            .inspect-section-title {
                font-family: 'Lora', serif;
                font-weight: bold;
                color: var(--text-primary-hover);
                border-bottom: 1px solid var(--border-gold-amber-30);
                padding-bottom: 4px;
                margin: 12px 0 8px 0;
                font-size: 1.05em;
            }
            .inspect-spec-row {
                display: flex;
                justify-content: space-between;
                padding: 2px 0;
                font-size: 0.9em;
            }
            .inspect-spec-label {
                color: var(--text-card-medium);
                font-weight: bold;
            }
            .inspect-spec-value {
                color: var(--text-success-active);
                font-weight: bold;
                text-align: right;
            }
            .inspect-effect-row {
                display: flex;
                align-items: flex-start;
                font-size: 0.9em;
                margin-bottom: 4px;
            }
        `;

        // Create overlay container
        this._dndContainer = document.createElement("div");
        this._dndContainer.id = "menu-container";
        this._dndContainer.style.opacity = "0";
        this._dndContainer.style.transition = "opacity 0.22s ease-out";
        document.body.appendChild(this._dndContainer);

        this._dndContainer.addEventListener("wheel", (e) => {
            e.preventDefault();
            const content = this._dndContainer.querySelector(".skill-book-content");
            if (content) content.scrollTop += e.deltaY;
        }, { passive: false });

        this.refreshUISkill();
        UISkillInputManager.activate(this);

        window.CharSwitcher.installTabKey(this, (dir) => this.cycleUIActor(dir));

        // Right-click anywhere on the overlay acts like the Back button
        this._dndContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            UISkillInputManager.handleCancel();
        });

        setTimeout(() => {
            if (this._dndContainer) {
                this._dndContainer.style.opacity = "1";
            }
        }, 16);
    };

    const _Scene_Skill_terminate = Scene_Skill.prototype.terminate;
    Scene_Skill.prototype.terminate = function () {
        _Scene_Skill_terminate.call(this);
        UISkillInputManager.deactivate();
        window.CharSwitcher.removeTabKey(this);
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

    Scene_Skill.prototype.getUISkillTypes = function () {
        const actor = this.actor();
        if (!actor) return [];

        const list = [];
        const stypeIds = actor.skillTypes();
        stypeIds.forEach(id => {
            const name = $dataSystem.skillTypes[id];
            list.push({ name: name, ext: id, type: "normal" });
        });

        list.push({ name: T('SkillsMenu.cmd.favourites'), ext: "favourites", type: "favourites" });
        list.push({ name: T('SkillsMenu.cmd.levelUp'), ext: "levelup", type: "levelup" });

        return list;
    };

    Scene_Skill.prototype.getUISkillList = function () {
        const types = this.getUISkillTypes();
        const type = types[this._dndSelectedTypeIndex];
        if (!type) return { data: [], categoryMode: false };

        this._itemWindow.setActor(this.actor());
        this._itemWindow.setStypeId(type.ext);
        this._itemWindow.makeItemList();

        return {
            data: this._itemWindow._data || [],
            categoryMode: this._itemWindow._categoryMode && type.ext !== "levelup" && type.ext !== "favourites"
        };
    };

    Scene_Skill.prototype.getUISkillsOnlyList = function () {
        if (!this._collapsedCategories) this._collapsedCategories = new Set();
        const actor = this.actor();
        if (!actor) return [];
        const types = this.getUISkillTypes();
        const type = types[this._dndSelectedTypeIndex];
        if (!type) return [];

        let list = [];
        if (type.ext === "levelup") {
            const classData = $dataClasses[actor._classId];
            if (!classData || !classData.learnings) return [];
            list = classData.learnings
                .map(l => ({ skill: $dataSkills[l.skillId], level: l.level, isLearned: actor.isLearnedSkill(l.skillId) }))
                .sort((a, b) => a.level !== b.level ? a.level - b.level : ((a.skill && a.skill.name) || '').localeCompare((b.skill && b.skill.name) || ''))
                .map(entry => entry.skill);
        } else if (type.ext === "favourites") {
            const actorId = actor.actorId();
            list = actor.skills().filter(skill => isSkillFavourited(actorId, skill.id));
        } else {
            list = actor.skills().filter(skill => {
                return !type.ext || skill.stypeId === type.ext;
            });
            const isCatMode = this._itemWindow._categoryMode;
            if (isCatMode) {
                list.sort((a, b) => {
                    const catA = getSkillGroup(a);
                    const catB = getSkillGroup(b);
                    if (catA === catB) return a.name.localeCompare(b.name);
                    if (isRoleMode()) return (ROLE_ORDER[catA] ?? 99) - (ROLE_ORDER[catB] ?? 99);
                    return catA.localeCompare(catB);
                });
                list = list.filter(skill => {
                    const cat = getSkillGroup(skill);
                    return !this._collapsedCategories.has(cat);
                });
            }
        }
        return list;
    };

    Scene_Skill.prototype.getUISkillCostText = function (skill) {
        if (!skill) return "";
        if (skill.mpCost > 0) return `${skill.mpCost} MP`;
        if (skill.tpCost > 0) return `${skill.tpCost} AP`;
        return "";
    };

    Scene_Skill.prototype.getUISkillActions = function () {
        const skillListInfo = this.getUISkillList();
        const types = this.getUISkillTypes();
        const isCatMode = this._itemWindow._categoryMode && types[this._dndSelectedTypeIndex].ext !== "levelup" && types[this._dndSelectedTypeIndex].ext !== "favourites";

        const list = isCatMode ? this.getUISkillsOnlyList() : skillListInfo.data;
        const skill = list[this._dndSelectedIndex];
        if (!skill) return [];

        const actions = [];
        const actor = this.actor();

        if (actor.canUse(skill)) {
            actions.push("use");
        }
        if (types[this._dndSelectedTypeIndex].ext !== "levelup") {
            actions.push("favorite");
        }
        actions.push("back");
        return actions;
    };

    Scene_Skill.prototype.toggleUICategory = function(categoryName) {
        if (!this._collapsedCategories) this._collapsedCategories = new Set();
        if (this._collapsedCategories.has(categoryName)) {
            this._collapsedCategories.delete(categoryName);
        } else {
            this._collapsedCategories.add(categoryName);
        }
        SoundManager.playCursor();
        this.refreshUISkill();
    };

    Scene_Skill.prototype.triggerUISkillAction = function (action) {
        const types = this.getUISkillTypes();
        const isCatMode = this._itemWindow._categoryMode && types[this._dndSelectedTypeIndex].ext !== "levelup" && types[this._dndSelectedTypeIndex].ext !== "favourites";
        const list = isCatMode ? this.getUISkillsOnlyList() : this.getUISkillList().data;
        const skill = list[this._dndSelectedIndex];
        if (!skill) return;

        const actor = this.actor();

        if (action === "use") {
            if (skill.scope === 1 || skill.scope === 7 || skill.scope === 8 || skill.scope === 9 || skill.scope === 10 || skill.scope === 11) {
                SoundManager.playOk();
                this._dndTargetingMode = true;
                this._dndTargetingSkill = skill;
                this._dndActiveSection = "targets";
                this._dndSelectedTargetIndex = 0;
                this.refreshUISkill();
            } else {
                SoundManager.playOk();
                actor.useItem(skill);
                actor.paySkillCost(skill);
                this._itemWindow.refresh();
                this.refreshUISkill();
            }
        } else if (action === "favorite") {
            SoundManager.playOk();
            toggleFavouriteSkill(actor.actorId(), skill.id);
            this._itemWindow.refresh();
            this.refreshUISkill();
        } else if (action === "back") {
            SoundManager.playCancel();
            this._dndActiveSection = "skills";
            this.refreshUISkill();
        }
    };

    // Enemy-scoped skills (one/all/random enemy) target the opposing troop;
    // everything else targets party members.
    Scene_Skill.prototype._isUISkillEnemyScope = function (skill) {
        return skill && skill.scope >= 1 && skill.scope <= 6;
    };

    Scene_Skill.prototype._getUISkillTargets = function (skill) {
        if (this._isUISkillEnemyScope(skill)) {
            return $gameTroop ? $gameTroop.aliveMembers() : [];
        }
        return $gameParty.members();
    };

    Scene_Skill.prototype.applyUISkillTarget = function (idx) {
        const skill = this._dndTargetingSkill;
        if (!skill) return;

        const actor = this.actor();
        const members = this._getUISkillTargets(skill);

        SoundManager.playUseSkill();

        if (idx === members.length) {
            actor.useItem(skill);
            members.forEach(member => {
                const action = new Game_Action(actor);
                action.setItemObject(skill);
                action.apply(member);
            });
        } else {
            const target = members[idx];
            if (target) {
                actor.useItem(skill);
                const action = new Game_Action(actor);
                action.setItemObject(skill);
                action.apply(target);
            }
        }

        this._itemWindow.refresh();
        this.cancelUISkillTargeting();
    };

    Scene_Skill.prototype.cancelUISkillTargeting = function () {
        SoundManager.playCancel();
        this._dndTargetingMode = false;
        this._dndTargetingSkill = null;
        this._dndActiveSection = "actions";
        this.refreshUISkill();
    };

    Scene_Skill.prototype.handleUICancel = function () {
        if (typeof UISkillInputManager !== 'undefined') {
            UISkillInputManager.handleCancel();
        }
    };

    Scene_Skill.prototype.refreshUISkill = function () {
        if (!this._dndContainer) return;
        if (!this._collapsedCategories) this._collapsedCategories = new Set();

        const actor = this.actor();
        if (!actor) return;

        // 1. Companion navigation tabs
        const allMembers = $gameParty.allMembers();
        let companionTabsHTML = "";
        allMembers.forEach((member, idx) => {
            const isSelected = member === actor ? "selected" : "";
            companionTabsHTML += `
                <div class="companion-tab ${isSelected}" onclick="SceneManager._scene.selectUIActor(${idx})">
                    ${member.name()}
                </div>
            `;
        });

        const companionsRowHTML = window.CharSwitcher.inner(
            `<div class="companion-tabs-row">${companionTabsHTML}</div>`,
            allMembers.length
        );

        // 2. Skill Types Tab Column -> Horizontal Tab Row
        const types = this.getUISkillTypes();
        // Clamp the selected type index so switching to a member with fewer
        // skill types doesn't dereference types[idx] on undefined.
        if (this._dndSelectedTypeIndex >= types.length) {
            this._dndSelectedTypeIndex = Math.max(0, types.length - 1);
        }
        let typesRowHTML = "";
        types.forEach((type, idx) => {
            const isActive = this._dndSelectedTypeIndex === idx ? "active" : "";
            const isFocused = (this._dndActiveSection === "types" && this._dndSelectedTypeIndex === idx) ? "selected" : "";
            typesRowHTML += `
                <div class="skill-type-tab ${isActive} ${isFocused}" onclick="SceneManager._scene.selectUISkillType(${idx})">
                    ${type.name}
                </div>
            `;
        });

        const skillTypesRowHTML = `
            <div class="skill-types-row">
                ${typesRowHTML}
            </div>
        `;

        // 3. Get lists
        const skillListInfo = this.getUISkillList();
        const categories = skillListInfo.data;
        const skillsOnlyList = this.getUISkillsOnlyList();

        const isCatMode = this._itemWindow._categoryMode && types[this._dndSelectedTypeIndex].ext !== "levelup" && types[this._dndSelectedTypeIndex].ext !== "favourites";

        // Boundary protections
        if (this._dndSelectedCategoryIndex >= categories.length) {
            this._dndSelectedCategoryIndex = Math.max(0, categories.length - 1);
        }
        const skillsListLength = isCatMode ? skillsOnlyList.length : categories.length;
        if (this._dndSelectedIndex >= skillsListLength) {
            this._dndSelectedIndex = Math.max(0, skillsListLength - 1);
        }

        // Let's get the selected item for the inspector (right page)
        let selectedItem = null;
        let isSelectedItemCategory = false;

        if (isCatMode) {
            selectedItem = skillsOnlyList[this._dndSelectedIndex] || null;
            isSelectedItemCategory = false;
        } else {
            const rawItem = categories[this._dndSelectedIndex] || null;
            selectedItem = (types[this._dndSelectedTypeIndex].ext === "levelup" && rawItem) ? rawItem.skill : rawItem;
            isSelectedItemCategory = false;
        }

        // Determine left page key to see if left page needs full render
        const collapsedKey = Array.from(this._collapsedCategories).join('-');
        const leftPageKey = `${actor.actorId()}_${this._dndSelectedTypeIndex}_${isCatMode}_${this._itemWindow._selectedCategory}_${categories.length}_${skillsOnlyList.length}_${collapsedKey}`;

        const skillsTitle = T('SkillsMenu.title');
        const backBtnText = T('SkillsMenu.back');

        let leftPageContentHTML = "";

        if (isCatMode) {
            let categoriesHTML = "";
            if (categories.length === 0) {
                categoriesHTML = `
                    <div style="grid-column: 1 / -1; font-family:'Lora', serif; font-style:italic; text-align:center; padding: 40px 10px; color:var(--text-card-medium);">
                        ${T('SkillsMenu.empty.section')}
                    </div>
                `;
            } else {
                categories.forEach((cat, catIdx) => {
                    const typeExt = types[this._dndSelectedTypeIndex].ext;
                    const rawSkills = actor.skills().filter(s => !isDummySkill(s) && (!typeExt || s.stypeId === typeExt));
                    const skillsInCatFull = rawSkills.filter(skill => getSkillGroup(skill) === cat).sort((a, b) => a.name.localeCompare(b.name));

                    if (skillsInCatFull.length === 0) return;

                    const isCollapsed = this._collapsedCategories.has(cat);
                    const skillsInCat = isCollapsed ? [] : skillsInCatFull;

                    let skillsGridHTML = "";
                    skillsInCat.forEach((item) => {
                        const globalIdx = skillsOnlyList.indexOf(item);
                        const isFocused = (this._dndActiveSection === "skills" && this._dndSelectedIndex === globalIdx) ? "selected" : "";
                        const isEnabled = actor.canUse(item);
                        const isFav = isSkillFavourited(actor.actorId(), item.id);
                        const costText = this.getUISkillCostText(item);
                        const canvasId = `skill-canvas-${globalIdx}`;
                        const nameWeight = isEnabled ? "font-weight: bold;" : "";
                        skillsGridHTML += `
                            <div class="skill-card-slot ${isFocused}" data-skill-idx="${globalIdx}" onclick="SceneManager._scene.clickUISkill(${globalIdx})">
                                <div class="card-left-side">
                                    <div class="faction-icon-frame" style="margin-right: 8px; border-radius: 50%; display: flex; align-items: center;">
                                        <canvas id="${canvasId}" width="32" height="32" style="width:24px; height:24px;"></canvas>
                                    </div>
                                    <span class="card-title-text" style="${nameWeight}">${item.name}</span>
                                    ${isFav ? `<span style="color:#bba16d; margin-left: 5px; font-size:1.1em;">★</span>` : ""}
                                </div>
                                <div class="card-right-side">
                                    <span class="card-cost-label">${costText}</span>
                                </div>
                            </div>
                        `;
                    });

                    const catIcon = getCategoryInfo(cat).icon;
                    const canvasId = `category-icon-canvas-${catIdx}`;
                    const chevron = isCollapsed ? "▶" : "▼";
                    categoriesHTML += `
                        <div class="skill-section-title" style="cursor:pointer;" onclick='SceneManager._scene.toggleUICategory(${JSON.stringify(cat).replace(/'/g, "&#39;")})'>
                            <span style="display: flex; align-items: center;">
                                <span style="margin-right: 8px; font-size: 0.75em; color: var(--text-primary-hover);">${chevron}</span>
                                <canvas id="${canvasId}" width="32" height="32" style="width:24px; height:24px; margin-right: 8px; vertical-align: middle;"></canvas>
                                <span style="font-family: 'Lora', serif; font-weight: bold; color: var(--text-primary-hover);">${getCategoryDisplayName(cat)}</span>
                            </span>
                            <span class="skill-section-subtitle">${getCategoryDescription(cat)}</span>
                        </div>
                        ${isCollapsed ? "" : `<div class="skills-grid-container">${skillsGridHTML}</div>`}
                    `;
                });
            }

            leftPageContentHTML = `
                <div class="skill-book-content">
                    ${categoriesHTML}
                </div>
            `;
        } else {
            // Favourites or Level Up View with a Single Large Grid
            let skillsGridHTML = "";
            if (categories.length === 0) {
                skillsGridHTML = `
                    <div style="grid-column: 1 / -1; font-family:'Lora', serif; font-style:italic; text-align:center; padding: 40px 10px; color:var(--text-card-medium);">
                        ${T('SkillsMenu.empty.category')}
                    </div>
                `;
            } else {
                categories.forEach((entry, idx) => {
                    const isLevelUp = types[this._dndSelectedTypeIndex].ext === "levelup";
                    const item = isLevelUp ? entry.skill : entry;
                    if (!item) return;

                    const isLearned = isLevelUp ? entry.isLearned : true;
                    const levelText = isLevelUp ? `<span style="color:#bba16d; margin-right: 5px; font-family:'Lora', serif; font-size: 0.9em; font-weight: bold;">Lv ${entry.level}:</span>` : "";

                    const isFocused = (this._dndActiveSection === "skills" && this._dndSelectedIndex === idx) ? "selected" : "";
                    const isEnabled = actor.canUse(item);
                    const isFav = isSkillFavourited(actor.actorId(), item.id);
                    const costText = this.getUISkillCostText(item);
                    const canvasId = `skill-canvas-${idx}`;
                    let nameWeight = isEnabled ? "font-weight: bold;" : "";
                    if (isLevelUp && !isLearned) nameWeight += " opacity: 0.6;";

                    skillsGridHTML += `
                        <div class="skill-card-slot ${isFocused}" data-skill-idx="${idx}" onclick="SceneManager._scene.clickUISkill(${idx})">
                            <div class="card-left-side">
                                ${levelText}
                                <div class="faction-icon-frame" style="margin-right: 8px; border-radius: 50%; display: flex; align-items: center;">
                                    <canvas id="${canvasId}" width="32" height="32" style="width:24px; height:24px;"></canvas>
                                </div>
                                <span class="card-title-text" style="${nameWeight}">${item.name}</span>
                                ${isFav ? `<span style="color:#bba16d; margin-left: 5px; font-size:1.1em;">★</span>` : ""}
                            </div>
                            <div class="card-right-side">
                                <span class="card-cost-label">${costText}</span>
                            </div>
                        </div>
                    `;
                });
            }

            leftPageContentHTML = `
                <div class="skill-book-content">
                    <div class="skills-grid-container">
                        ${skillsGridHTML}
                    </div>
                </div>
            `;
        }

        const leftPageHeaderHTML = `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed var(--border-gold-amber-30); padding-bottom: 8px; margin-bottom: 12px; min-height: 40px; width: 100%;">
              <div class="back-button focusable" onclick="SceneManager._scene.handleUICancel()" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                ${backBtnText}
              </div>
              <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${skillsTitle}</h2>
            </div>
            ${skillTypesRowHTML}
        `;

        const leftPageHTML = `
            ${leftPageHeaderHTML}
            ${leftPageContentHTML}
        `;

        // 4. Generate Right Page: Spell / Inspect Card
        let rightPageContentHTML = "";

        if (this._dndTargetingMode && this._dndTargetingSkill) {
            const skill = this._dndTargetingSkill;
            const targetUnit = this._getUISkillTargets(skill);
            let targetsHTML = "";
            targetUnit.forEach((companion, idx) => {
                const isFocused = (this._dndActiveSection === "targets" && this._dndSelectedTargetIndex === idx) ? "selected" : "";
                targetsHTML += `
                    <div class="target-option ${isFocused}" onclick="SceneManager._scene.applyUISkillTarget(${idx})">
                        ${escapeHtml(companion.name())} (HP: ${companion.hp}/${companion.mhp})
                    </div>
                `;
            });

            if (skill.scope === 8 || skill.scope === 10) {
                const isFocused = (this._dndActiveSection === "targets" && this._dndSelectedTargetIndex === targetUnit.length) ? "selected" : "";
                targetsHTML += `
                    <div class="target-option ${isFocused}" onclick="SceneManager._scene.applyUISkillTarget(${targetUnit.length})">
                        ${T('SkillsMenu.target.allCompanions')}
                    </div>
                `;
            }

            rightPageContentHTML = `
                <div class="target-overlay">
                    <h3 class="target-title">${T('SkillsMenu.target.title')}</h3>
                    <div style="font-family: 'Lora', serif; margin-bottom: 15px; color:var(--text-primary-hover);">
                        ${T('SkillsMenu.target.prompt', { skill: `<strong>${escapeHtml(skill.name)}</strong>` })}
                    </div>
                    <div class="inspect-actions">
                        ${targetsHTML}
                        <div class="inspect-btn" onclick="SceneManager._scene.cancelUISkillTargeting()" style="margin-top: 15px; border-color: #555; color: #555;">${T('SkillsMenu.cmd.cancel')}</div>
                    </div>
                </div>
            `;
        } else if (!selectedItem) {
            rightPageContentHTML = `
                <div class="skill-inspect-card" style="justify-content: center; text-align: center; padding: 40px 10px;">
                    <div style="font-size: 4em; margin-bottom: 20px;"></div>
                    <h3 class="title" style="border:none; margin-bottom: 10px;">${T('SkillsMenu.empty.title')}</h3>
                    <p style="font-family: 'Lora', serif; font-style: italic; line-height: 1.6; color: var(--text-card-medium);">
                        ${T('SkillsMenu.empty.hint')}
                    </p>
                </div>
            `;
        } else {
            const skill = selectedItem;
            const desc = skill.description;

            const skillType = window.SkillDetails.typeLabelOf(skill);

            // Full spec block (Combat Application + Damage side by side, then
            // Skill Effects and Classifications) from the shared service, which
            // SkillMaster's Training encyclopedia renders too.
            const detailedInfoHTML = window.SkillDetails.build(skill, actor);

            const actions = this.getUISkillActions();
            let actionsHTML = "";
            actions.forEach((action, idx) => {
                const isFocused = (this._dndActiveSection === "actions" && this._dndSelectedActionIndex === idx) ? "selected" : "";
                let label = "";
                if (action === "use") label = T('SkillsMenu.action.useSkill');
                else if (action === "favorite") {
                    const isFav = isSkillFavourited(actor.actorId(), skill.id);
                    label = isFav ? T('SkillsMenu.action.unfavourite') : T('SkillsMenu.action.favourite');
                } else if (action === "back") {
                    label = T('SkillsMenu.action.back');
                }

                actionsHTML += `
                    <div class="inspect-btn ${isFocused}" onclick="SceneManager._scene.triggerUISkillAction('${action}')">
                        ${label}
                    </div>
                `;
            });

            rightPageContentHTML = `
                <div class="skill-inspect-card">
                    <div class="inspect-header">
                        <div class="inspect-frame">
                            <canvas id="inspect-canvas" width="32" height="32" style="width:36px; height:36px; image-rendering: pixelated;"></canvas>
                        </div>
                        <div class="inspect-title-box">
                            <h3 class="inspect-name">${escapeHtml(skill.name)}</h3>
                            <div class="inspect-rarity" style="color: var(--text-gold-dark);">${escapeHtml(skillType)}</div>
                        </div>
                    </div>

                    <div class="inspect-lore" style="flex-grow: 1; max-height: 100px; overflow-y: auto; padding-right:5px; margin-bottom: 15px;">
                        ${escapeHtml(desc)}
                    </div>

                    <div class="inspect-detailed-info" style="flex-grow: 1; overflow-y: auto; padding-right:5px; margin-bottom: 15px; font-family: 'Lora', serif; font-size: 0.95rem;">
                        ${detailedInfoHTML}
                    </div>

                    <div class="inspect-actions">
                        ${actionsHTML}
                    </div>
                </div>
            `;
        }

        // 5. Render to DOM
        // The character switcher lives at the top of the RIGHT page (its own
        // static row), so the left page can start with its title straight away.
        if (!this._dndContainer.querySelector(".book-spread")) {
            this._dndContainer.innerHTML = `
                <div class="book-spread">
                    <div class="left-page"></div>
                    <div class="right-page">
                        <div class="companion-switcher" id="skill-companion-row" style="flex:0 0 auto; justify-content:flex-end; min-height:26px; margin-bottom:10px;"></div>
                        <div id="skill-right-body" style="flex:1 1 auto; min-height:0; display:flex; flex-direction:column;"></div>
                    </div>
                </div>
            `;
            this._dndLastLeftPageKey = null; // force initial draw
        }

        const leftPageContainer = this._dndContainer.querySelector(".left-page");
        const rightPageContainer = this._dndContainer.querySelector("#skill-right-body");

        const companionRow = this._dndContainer.querySelector("#skill-companion-row");
        if (companionRow) companionRow.innerHTML = companionsRowHTML;

        if (this._dndLastLeftPageKey !== leftPageKey) {
            this._dndLastLeftPageKey = leftPageKey;
            leftPageContainer.innerHTML = leftPageHTML;

            // Render all left page canvases
            if (isCatMode) {
                // Render category icons
                categories.forEach((cat, catIdx) => {
                    const catIcon = getCategoryInfo(cat).icon;
                    this.drawUISkillIcon(catIcon, `category-icon-canvas-${catIdx}`);
                });
                // Render skills icons
                if (skillsOnlyList.length > 0) {
                    skillsOnlyList.forEach((item, idx) => {
                        this.drawUISkillIcon(item.iconIndex, `skill-canvas-${idx}`);
                    });
                }
            } else {
                // Render skills icons in detail view
                if (categories.length > 0) {
                    const isLevelUp = types[this._dndSelectedTypeIndex].ext === "levelup";
                    categories.forEach((entry, idx) => {
                        const item = isLevelUp ? entry.skill : entry;
                        if (item) this.drawUISkillIcon(item.iconIndex, `skill-canvas-${idx}`);
                    });
                }
            }
        } else {
            // Left page already drawn! Update only selection classes in-place
            // (companion tabs live on the right page and are rebuilt above).
            // 1. Skill type tabs
            const typeTabs = leftPageContainer.querySelectorAll(".skill-type-tab");
            typeTabs.forEach((tab, idx) => {
                if (idx === this._dndSelectedTypeIndex) {
                    tab.classList.add("active");
                } else {
                    tab.classList.remove("active");
                }
                if (idx === this._dndSelectedTypeIndex && this._dndActiveSection === "types") {
                    tab.classList.add("selected");
                } else {
                    tab.classList.remove("selected");
                }
            });

            // 2. Skill cards
            const skillSlots = leftPageContainer.querySelectorAll(".skill-card-slot");
            skillSlots.forEach((slot) => {
                const sIdx = parseInt(slot.getAttribute("data-skill-idx"), 10);
                if (sIdx === this._dndSelectedIndex && this._dndActiveSection === "skills") {
                    slot.classList.add("selected");
                } else {
                    slot.classList.remove("selected");
                }
            });
        }

        // Always update right page contents inside the static right-page container (prevents full page repaint/redraws)
        rightPageContainer.innerHTML = rightPageContentHTML;

        // Draw inspect canvas icon
        if (selectedItem) {
            this.drawUISkillIcon(selectedItem.iconIndex, "inspect-canvas");
        }

        // Scroll active item into view
        if (this._dndActiveSection === "skills") {
            const selectedElem = this._dndContainer.querySelector(".skill-card-slot.selected");
            if (selectedElem) {
                selectedElem.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    };

    Scene_Skill.prototype.drawUISkillIcon = function (iconIndex, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const bitmap = ImageManager.loadSystem("IconSet");
        const drawIcon = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, 32, 32);
            ctx.imageSmoothingEnabled = false;

            const pw = 32;
            const ph = 32;
            const sx = (iconIndex % 16) * pw;
            const sy = Math.floor(iconIndex / 16) * ph;

            ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, 0, 0, 32, 32);
        };

        if (bitmap.isReady()) {
            drawIcon();
        } else {
            bitmap.addLoadListener(drawIcon);
        }
    };

    Scene_Skill.prototype.selectUIActor = function (idx) {
        const allMembers = $gameParty.allMembers();
        const actor = allMembers[idx];
        if (actor && actor !== this.actor()) {
            this._actorIndex = idx;
            this.changeActor();
            this._dndSelectedIndex = 0;
            this._dndSelectedCategoryIndex = 0;
            this.refreshUISkill();
        }
    };

    Scene_Skill.prototype.selectUISkillType = function (idx) {
        const types = this.getUISkillTypes();
        const type = types[idx];
        if (type) {
            SoundManager.playCursor();
            this._dndSelectedTypeIndex = idx;
            this._dndSelectedIndex = 0;
            this._dndSelectedCategoryIndex = 0;
            this._itemWindow.setStypeId(type.ext);
            this.refreshUISkill();
        }
    };

    Scene_Skill.prototype.selectUISkill = function (idx) {
        SoundManager.playCursor();
        this._dndSelectedIndex = idx;
        this.refreshUISkill();
    };

    Scene_Skill.prototype.clickUICategory = function (idx) {
        const categories = this.getUISkillList().data;
        const category = categories[idx];
        if (category) {
            SoundManager.playOk();
            this._itemWindow._selectedCategory = category;
            this._itemWindow._categoryMode = false;
            this._dndActiveSection = "skills";
            this._dndSelectedIndex = 0;
            this.refreshUISkill();
        }
    };

    Scene_Skill.prototype.clickUISkill = function (idx) {
        const alreadySelected = (this._dndActiveSection === "skills" && this._dndSelectedIndex === idx);
        this._dndActiveSection = "skills";
        this._dndSelectedIndex = idx;
        if (alreadySelected) {
            // Second click = open actions (same as pressing OK)
            const actions = this.getUISkillActions();
            if (actions.length > 0) {
                SoundManager.playOk();
                this._dndActiveSection = "actions";
                this._dndSelectedActionIndex = 0;
            } else {
                SoundManager.playCursor();
            }
        } else {
            SoundManager.playCursor();
        }
        this.refreshUISkill();
    };

    // Called on mouseenter ,  lightweight hover: only patches selection classes + right-page inspector.
    // Does NOT call refreshUISkill() to avoid DOM churn / mouseenter feedback loops.
    Scene_Skill.prototype.hoverUISkill = function (idx) {
        if (!this._dndContainer) return;
        if (this._dndActiveSection === "skills" && this._dndSelectedIndex === idx) return;

        this._dndActiveSection = "skills";
        this._dndSelectedIndex = idx;

        // 1. Patch left-page skill card selection classes in-place
        const leftPageContainer = this._dndContainer.querySelector(".left-page");
        if (leftPageContainer) {
            const skillSlots = leftPageContainer.querySelectorAll(".skill-card-slot");
            skillSlots.forEach((slot) => {
                const sIdx = parseInt(slot.getAttribute("data-skill-idx"), 10);
                if (sIdx === idx) slot.classList.add("selected");
                else slot.classList.remove("selected");
            });
        }

        // 2. Rebuild only the right-page inspector for the newly hovered skill
        this._refreshUISkillRightPage();
    };

    // Lightweight right-page-only refresh ,  called by hoverUISkill and by refreshUISkill's tail.
    Scene_Skill.prototype._refreshUISkillRightPage = function () {
        if (!this._dndContainer) return;
        const rightPageContainer = this._dndContainer.querySelector("#skill-right-body");
        if (!rightPageContainer) return;

        const actor = this.actor();
        if (!actor) return;

        const types = this.getUISkillTypes();
        if (!types.length) return;
        const isCatMode = this._itemWindow._categoryMode &&
            types[this._dndSelectedTypeIndex].ext !== "levelup" &&
            types[this._dndSelectedTypeIndex].ext !== "favourites";

        const skillsOnlyList = this.getUISkillsOnlyList();
        const categories = this.getUISkillList().data;
        let selectedItem = isCatMode
            ? (skillsOnlyList[this._dndSelectedIndex] || null)
            : (categories[this._dndSelectedIndex] || null);

        let rightPageContentHTML = "";

        if (!selectedItem) {
            rightPageContentHTML = `
                <div class="skill-inspect-card" style="justify-content: center; text-align: center; padding: 40px 10px;">
                    <div style="font-size: 4em; margin-bottom: 20px;"></div>
                    <h3 class="title" style="border:none; margin-bottom: 10px;">${T('SkillsMenu.empty.title')}</h3>
                    <p style="font-family: 'Lora', serif; font-style: italic; line-height: 1.6; color: var(--text-card-medium);">
                        ${T('SkillsMenu.empty.hint')}
                    </p>
                </div>
            `;
        } else {
            const skill = selectedItem;
            const desc = skill.description || "";
            const skillType = window.SkillDetails.typeLabelOf(skill);

            // Same inspect block as the full refresh, so hovering a skill and
            // selecting it show identical information.
            const detailedInfoHTML = window.SkillDetails.build(skill, actor);

            const actions = this.getUISkillActions();
            let actionsHTML = "";
            actions.forEach((action, idx) => {
                const isFocused = (this._dndActiveSection === "actions" && this._dndSelectedActionIndex === idx) ? "selected" : "";
                let label = "";
                if (action === "use") label = T('SkillsMenu.action.useSkill');
                else if (action === "favorite") {
                    const isFav = isSkillFavourited(actor.actorId(), skill.id);
                    label = isFav ? T('SkillsMenu.action.unfavourite') : T('SkillsMenu.action.favourite');
                } else if (action === "back") label = T('SkillsMenu.action.back');
                actionsHTML += `<div class="inspect-btn ${isFocused}" onclick="SceneManager._scene.triggerUISkillAction('${action}')">${label}</div>`;
            });

            rightPageContentHTML = `
                <div class="skill-inspect-card">
                    <div class="inspect-header">
                        <div class="inspect-frame">
                            <canvas id="inspect-canvas" width="32" height="32" style="width:36px; height:36px; image-rendering: pixelated;"></canvas>
                        </div>
                        <div class="inspect-title-box">
                            <h3 class="inspect-name">${escapeHtml(skill.name)}</h3>
                            <div class="inspect-rarity" style="color: var(--text-gold-dark);">${escapeHtml(skillType)}</div>
                        </div>
                    </div>

                    <div class="inspect-lore" style="flex-grow: 1; max-height: 100px; overflow-y: auto; padding-right:5px; margin-bottom: 15px;">
                        ${escapeHtml(desc)}
                    </div>

                    <div class="inspect-detailed-info" style="flex-grow: 1; overflow-y: auto; padding-right:5px; margin-bottom: 15px; font-family: 'Lora', serif; font-size: 0.95rem;">
                        ${detailedInfoHTML}
                    </div>

                    <div class="inspect-actions">
                        ${actionsHTML}
                    </div>
                </div>
            `;
        }

        rightPageContainer.innerHTML = rightPageContentHTML;
        if (selectedItem) this.drawUISkillIcon(selectedItem.iconIndex, "inspect-canvas");
    };

    Scene_Skill.prototype.exitUICategory = function () {
        SoundManager.playCancel();
        this._itemWindow._categoryMode = true;
        this._itemWindow._selectedCategory = null;
        this._dndActiveSection = "categories";
        this._dndSelectedCategoryIndex = 0;
        this.refreshUISkill();
    };

    // Keyboard and Gamepad Interceptor for Skills/Spellbook Screen
    const UISkillInputManager = {
        _scene: null,
        _active: false,

        activate: function (scene) {
            this._scene = scene;
            this._active = true;
        },

        deactivate: function () {
            this._active = false;
            this._scene = null;
        },

        update: function () {
            if (!this._active || !this._scene) return;

            // Directions: isRepeated so holding a key auto-scrolls
            if (Input.isRepeated('down')) {
                this.handleMove("down");
            } else if (Input.isRepeated('up')) {
                this.handleMove("up");
            } else if (Input.isRepeated('left')) {
                this.handleMove("left");
            } else if (Input.isRepeated('right')) {
                this.handleMove("right");
            } else if (Input.isTriggered('ok')) {
                this.handleOk();
            } else if (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                this.handleCancel();
            } else if (Input.isTriggered('pagedown')) {
                // L1 / Q ,  next actor
                this.handleActorCycle(1);
            } else if (Input.isTriggered('pageup')) {
                // R1 / W ,  previous actor
                this.handleActorCycle(-1);
            }
        },

        handleActorCycle: function (dir) {
            const scene = this._scene;
            const allMembers = $gameParty.allMembers();
            if (allMembers.length <= 1) return;
            SoundManager.playCursor();
            scene._actorIndex = (scene._actorIndex + dir + allMembers.length) % allMembers.length;
            scene.changeActor();
            scene._dndSelectedIndex = 0;
            scene._dndSelectedCategoryIndex = 0;
            scene.refreshUISkill();
        },

        handleMove: function (dir) {
            const scene = this._scene;
            const section = scene._dndActiveSection;
            const types = scene.getUISkillTypes();
            const skillListInfo = scene.getUISkillList();
            const categories = skillListInfo.data;
            const skillsOnlyList = scene.getUISkillsOnlyList();
            const isCatMode = scene._itemWindow._categoryMode && types[scene._dndSelectedTypeIndex].ext !== "levelup" && types[scene._dndSelectedTypeIndex].ext !== "favourites";

            if (section === "types") {
                if (dir === "left") {
                    if (scene._dndSelectedTypeIndex > 0) {
                        SoundManager.playCursor();
                        scene._dndSelectedTypeIndex--;
                        scene._dndSelectedCategoryIndex = 0;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    } else {
                        scene.previousActor();
                        scene._dndSelectedTypeIndex = types.length - 1;
                        scene._dndSelectedCategoryIndex = 0;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    }
                } else if (dir === "right") {
                    if (scene._dndSelectedTypeIndex < types.length - 1) {
                        SoundManager.playCursor();
                        scene._dndSelectedTypeIndex++;
                        scene._dndSelectedCategoryIndex = 0;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    } else {
                        scene.nextActor();
                        scene._dndSelectedTypeIndex = 0;
                        scene._dndSelectedCategoryIndex = 0;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    }
                } else if (dir === "down") {
                    const listLength = isCatMode ? skillsOnlyList.length : categories.length;
                    if (listLength > 0) {
                        SoundManager.playCursor();
                        scene._dndActiveSection = "skills";
                        scene._dndSelectedIndex = 0;
                        scene.refreshUISkill();
                    }
                }
            } else if (section === "skills") {
                const list = isCatMode ? skillsOnlyList : categories;
                if (dir === "left") {
                    if (scene._dndSelectedIndex % 2 === 1) {
                        SoundManager.playCursor();
                        scene._dndSelectedIndex--;
                        scene.refreshUISkill();
                    }
                } else if (dir === "right") {
                    if (scene._dndSelectedIndex % 2 === 0 && scene._dndSelectedIndex < list.length - 1) {
                        SoundManager.playCursor();
                        scene._dndSelectedIndex++;
                        scene.refreshUISkill();
                    } else if (list[scene._dndSelectedIndex]) {
                        const actions = scene.getUISkillActions();
                        if (actions.length > 0) {
                            SoundManager.playCursor();
                            scene._dndActiveSection = "actions";
                            scene._dndSelectedActionIndex = 0;
                            scene.refreshUISkill();
                        }
                    }
                } else if (dir === "down") {
                    if (scene._dndSelectedIndex + 2 < list.length) {
                        SoundManager.playCursor();
                        scene._dndSelectedIndex += 2;
                        scene.refreshUISkill();
                    }
                } else if (dir === "up") {
                    if (scene._dndSelectedIndex >= 2) {
                        SoundManager.playCursor();
                        scene._dndSelectedIndex -= 2;
                        scene.refreshUISkill();
                    } else {
                        SoundManager.playCursor();
                        scene._dndActiveSection = "types";
                        scene.refreshUISkill();
                    }
                }
            } else if (section === "actions") {
                const actions = scene.getUISkillActions();
                if (dir === "down") {
                    if (scene._dndSelectedActionIndex < actions.length - 1) {
                        SoundManager.playCursor();
                        scene._dndSelectedActionIndex++;
                        scene.refreshUISkill();
                    }
                } else if (dir === "up") {
                    if (scene._dndSelectedActionIndex > 0) {
                        SoundManager.playCursor();
                        scene._dndSelectedActionIndex--;
                        scene.refreshUISkill();
                    }
                } else if (dir === "left") {
                    SoundManager.playCursor();
                    scene._dndActiveSection = "skills";
                    scene.refreshUISkill();
                }
            } else if (section === "targets") {
                const membersCount = scene._getUISkillTargets(scene._dndTargetingSkill).length;
                const totalTargets = scene._dndTargetingSkill.scope === 8 || scene._dndTargetingSkill.scope === 10 ? membersCount + 1 : membersCount;
                if (dir === "down") {
                    if (scene._dndSelectedTargetIndex < totalTargets - 1) {
                        SoundManager.playCursor();
                        scene._dndSelectedTargetIndex++;
                        scene.refreshUISkill();
                    }
                } else if (dir === "up") {
                    if (scene._dndSelectedTargetIndex > 0) {
                        SoundManager.playCursor();
                        scene._dndSelectedTargetIndex--;
                        scene.refreshUISkill();
                    }
                }
            }
        },

        handleOk: function () {
            if (this._okHandled) return;
            this._okHandled = true;
            setTimeout(() => { this._okHandled = false; }, 50);

            const scene = this._scene;
            const section = scene._dndActiveSection;
            const types = scene.getUISkillTypes();
            const isCatMode = scene._itemWindow._categoryMode && types[scene._dndSelectedTypeIndex].ext !== "levelup" && types[scene._dndSelectedTypeIndex].ext !== "favourites";

            if (section === "types") {
                const listLength = isCatMode ? scene.getUISkillsOnlyList().length : scene.getUISkillList().data.length;
                if (listLength > 0) {
                    SoundManager.playOk();
                    scene._dndActiveSection = "skills";
                    scene._dndSelectedIndex = 0;
                    scene.refreshUISkill();
                }
            } else if (section === "skills") {
                const list = isCatMode ? scene.getUISkillsOnlyList() : scene.getUISkillList().data;
                const item = list[scene._dndSelectedIndex];
                if (!item) return;

                const actions = scene.getUISkillActions();
                if (actions.length > 0) {
                    SoundManager.playOk();
                    scene._dndActiveSection = "actions";
                    scene._dndSelectedActionIndex = 0;
                    scene.refreshUISkill();
                }
            } else if (section === "actions") {
                const actions = scene.getUISkillActions();
                const action = actions[scene._dndSelectedActionIndex];
                if (action) {
                    scene.triggerUISkillAction(action);
                }
            } else if (section === "targets") {
                scene.applyUISkillTarget(scene._dndSelectedTargetIndex);
            }
        },

        handleCancel: function () {
            if (this._cancelHandled) return;
            this._cancelHandled = true;
            setTimeout(() => { this._cancelHandled = false; }, 50);

            const scene = this._scene;
            const section = scene._dndActiveSection;

            if (scene._dndTargetingMode) {
                scene.cancelUISkillTargeting();
                return;
            }

            if (section === "actions") {
                SoundManager.playCancel();
                scene._dndActiveSection = "skills";
                scene.refreshUISkill();
            } else if (section === "skills") {
                SoundManager.playCancel();
                scene._dndActiveSection = "types";
                scene.refreshUISkill();
            } else {
                SoundManager.playCancel();
                scene.popScene();
            }
        }
    };

    //=============================================================================
    // Window_SkillType ,  add Basic and Level Up tabs; block left/right for actor switching
    //=============================================================================

    Window_SkillType.prototype.processCursorMove = function () {
        if (this.isCursorMovable()) {
            const lastIndex = this.index();
            const isP2 = window.$gameSplitScreen && window.$gameSplitScreen.active &&
                SceneManager._scene instanceof Scene_Battle &&
                this._actor && this._actor.multiplayerPlayerId && this._actor.multiplayerPlayerId() === 2;
            const input = isP2 ? window.$gameSplitScreen : Input;

            if (input.isRepeated("down")) this.cursorDown(input.isTriggered("down"));
            if (input.isRepeated("up")) this.cursorUp(input.isTriggered("up"));
            // Left/Right reserved for actor switching in Scene_Skill
            if (this.index() !== lastIndex) this.playCursorSound();
        }
    };

    const _Window_SkillType_makeCommandList = Window_SkillType.prototype.makeCommandList;
    Window_SkillType.prototype.makeCommandList = function () {
        _Window_SkillType_makeCommandList.call(this);
        if (this._actor) {
            this.addCommand(T('SkillsMenu.cmd.favourites'), "skill", true, "favourites");
            this.addCommand(T('SkillsMenu.cmd.levelUp'), "skill", true, "levelup");
        }
    };

    const _Window_SkillType_update = Window_SkillType.prototype.update;
    Window_SkillType.prototype.update = function () {
        _Window_SkillType_update.call(this);
        if (this._itemWindow) {
            this._itemWindow.setStypeId(this.currentExt());
        }
    };

    //=============================================================================
    // Window_SkillList ,  categorized display for menu; Basic/LevelUp tabs;
    //                    skill info panel connection; left/right blocked for actor switching
    //=============================================================================

    // --- Initialise categorized state ---

    const _Window_SkillList_initialize = Window_SkillList.prototype.initialize;
    Window_SkillList.prototype.initialize = function (rect) {
        _Window_SkillList_initialize.call(this, rect);
        this._categoryMode = true;
        this._selectedCategory = null;
        this._lastCategoryIndex = 0;
        this._categorySkillIndexes = {};
        this._skillInfoWindow = null;
    };

    // Reset categorized state when stypeId changes
    const _Window_SkillList_setStypeId = Window_SkillList.prototype.setStypeId;
    Window_SkillList.prototype.setStypeId = function (stypeId) {
        if (this._stypeId !== stypeId) {
            this._categoryMode = true;
            this._selectedCategory = null;
            this._lastCategoryIndex = 0;
        }
        _Window_SkillList_setStypeId.call(this, stypeId);
    };

    // Reset categorized state when actor changes
    const _Window_SkillList_setActor = Window_SkillList.prototype.setActor;
    Window_SkillList.prototype.setActor = function (actor) {
        if (this._actor !== actor) {
            this._categoryMode = true;
            this._selectedCategory = null;
            this._lastCategoryIndex = 0;
            this._categorySkillIndexes = {};
        }
        _Window_SkillList_setActor.call(this, actor);
        this.updateSkillInfo();
    };

    // --- Skill info window connection ---

    Window_SkillList.prototype.setSkillInfoWindow = function (skillInfoWindow) {
        this._skillInfoWindow = skillInfoWindow;
        this.updateSkillInfo();
    };

    Window_SkillList.prototype._isSpecialStypeId = function () {
        return this._stypeId === "levelup" || this._stypeId === "favourites";
    };

    Window_SkillList.prototype.updateSkillInfo = function () {
        if (this._skillInfoWindow) {
            const isCatMode = this._categoryMode && !this._isSpecialStypeId();
            this._skillInfoWindow.setItem(isCatMode ? null : this.item());
        }
    };

    const _Window_SkillList_update = Window_SkillList.prototype.update;
    Window_SkillList.prototype.update = function () {
        _Window_SkillList_update.call(this);
        this.updateSkillInfo();
    };

    const _Window_SkillList_select = Window_SkillList.prototype.select;
    Window_SkillList.prototype.select = function (index) {
        _Window_SkillList_select.call(this, index);
        this.updateSkillInfo();
    };

    // --- Single column ---

    Window_SkillList.prototype.maxCols = function () {
        return 2;
    };

    // --- Block left/right (Scene_Skill handles actor switching) ---




    // --- Item list construction ---

    Window_SkillList.prototype.makeItemList = function () {
        if (this._stypeId === "levelup") {
            this._data = this._makeLearnableSkillsList();
        } else if (this._stypeId === "favourites") {
            this._data = this._makeFavouritesSkillsList();
        } else if (this._categoryMode) {
            this._data = this._makeCategoryListForMenu();
        } else {
            this._data = this._makeFilteredSkillsForMenu();
        }
    };

    // Build sorted category list for the menu
    Window_SkillList.prototype._makeCategoryListForMenu = function () {
        if (!this._actor) return [];
        const categoriesSet = new Set();
        for (const skill of this._actor.skills()) {
            if (isDummySkill(skill)) continue;
            if (this._stypeId && skill.stypeId !== this._stypeId) continue;
            const grp = getSkillGroup(skill);
            // Filter out categories whose type does not match current stypeId group
            if (!_isCategoryVisibleForStypeId(grp, this._stypeId)) continue;
            categoriesSet.add(grp);
        }
        const categories = Array.from(categoriesSet);
        if (isRoleMode()) {
            categories.sort((a, b) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99));
        } else {
            categories.sort();
        }
        return categories;
    };

    // Build skill list for the selected category in the menu
    Window_SkillList.prototype._makeFilteredSkillsForMenu = function () {
        if (!this._actor || !this._selectedCategory) return [];
        let list = this._actor.skills().filter(skill => {
            if (isDummySkill(skill)) return false;
            if (this._stypeId && skill.stypeId !== this._stypeId) return false;
            return getSkillGroup(skill) === this._selectedCategory;
        });
        list.sort((a, b) => {
            const costTpA = this._actor.skillTpCost(a);
            const costMpA = this._actor.skillMpCost(a);
            const costTpB = this._actor.skillTpCost(b);
            const costMpB = this._actor.skillMpCost(b);
            if (costTpA !== costTpB) return costTpA - costTpB;
            return costMpA - costMpB;
        });
        return list;
    };

    // Skills that can be learned by level up
    Window_SkillList.prototype._makeLearnableSkillsList = function () {
        if (!this._actor) return [];
        const classData = $dataClasses[this._actor._classId];
        if (!classData || !classData.learnings) return [];
        return classData.learnings
            .map(l => ({ skill: $dataSkills[l.skillId], level: l.level, isLearned: this._actor.isLearnedSkill(l.skillId) }))
            .sort((a, b) => a.level !== b.level ? a.level - b.level : ((a.skill && a.skill.name) || '').localeCompare((b.skill && b.skill.name) || ''));
    };



    // All favourited skills for this actor (across all stypeIds)
    Window_SkillList.prototype._makeFavouritesSkillsList = function () {
        if (!this._actor) return [];
        const actorId = this._actor.actorId();
        let list = this._actor.skills().filter(skill => !isDummySkill(skill) && isSkillFavourited(actorId, skill.id));
        list.sort((a, b) => {
            const costTpA = this._actor.skillTpCost(a);
            const costMpA = this._actor.skillMpCost(a);
            const costTpB = this._actor.skillTpCost(b);
            const costMpB = this._actor.skillMpCost(b);
            if (costTpA !== costTpB) return costTpA - costTpB;
            return costMpA - costMpB;
        });
        return list;
    };

    // --- item() accessor ---

    const _Window_SkillList_item = Window_SkillList.prototype.item;
    Window_SkillList.prototype.item = function () {
        if (this._stypeId === "levelup") {
            const data = this._data[this.index()];
            return data ? data.skill : null;
        }
        return _Window_SkillList_item.call(this);
    };

    // --- isEnabled ---

    const _Window_SkillList_isEnabled = Window_SkillList.prototype.isEnabled;
    Window_SkillList.prototype.isEnabled = function (item) {
        if (this._stypeId === "levelup") return false;
        if (this._categoryMode) return true; // categories always enabled
        return true; // All skills selectable; context menu handles usability
    };

    // --- Drawing ---

    Window_SkillList.prototype.drawItem = function (index) {
        if (this._stypeId === "levelup") {
            this._drawLearnableSkillItem(index);
            return;
        }

        const item = this.itemAt(index);
        if (!item) return;
        const rect = this.itemLineRect(index);

        if (this._categoryMode && !this._isSpecialStypeId()) {
            // Categories: always full opacity, show icon
            this.changePaintOpacity(true);
            this.resetTextColor();
            this.drawIcon(getCategoryInfo(item).icon, rect.x + 2, rect.y + 2);
            this.drawText(getCategoryDisplayName(item), rect.x + ImageManager.iconWidth + 4, rect.y, rect.width - ImageManager.iconWidth - 4);
        } else {
            // Skills (normal & favourites tabs): always selectable, show favourite icon
            this.changePaintOpacity(true);
            const isFav = this._actor && isSkillFavourited(this._actor.actorId(), item.id);
            const favW = isFav ? ImageManager.iconWidth + 4 : 0;
            this.drawItemName(item, rect.x, rect.y, rect.width - this.costWidth() - favW);
            if (isFav) {
                this.drawIcon(FAVOURITE_ICON, rect.x + rect.width - this.costWidth() - ImageManager.iconWidth - 2, rect.y + 2);
            }
            this.drawSkillCost(item, rect.x, rect.y, rect.width);
        }
        this.changePaintOpacity(1);
    };

    Window_SkillList.prototype._drawLearnableSkillItem = function (index) {
        const entry = this._data[index];
        if (!entry || !entry.skill) return;
        const rect = this.itemLineRect(index);

        if (entry.isLearned) this.changePaintOpacity(false);

        const levelText = `Lv ${entry.level}: `;
        const levelWidth = this.textWidth(levelText);
        this.drawText(levelText, rect.x, rect.y, levelWidth);

        this.drawIcon(entry.skill.iconIndex, rect.x + levelWidth, rect.y + 2);
        const nameX = rect.x + levelWidth + ImageManager.iconWidth + 4;
        this.drawText(entry.skill.name, nameX, rect.y, rect.width - (nameX - rect.x) - 60);
        this.drawSkillCost(entry.skill, rect.x, rect.y, rect.width);

        this.changePaintOpacity(true);
    };

    // --- Process OK: enter category or use skill ---

    const _Window_SkillList_processOk = Window_SkillList.prototype.processOk;
    Window_SkillList.prototype.processOk = function () {
        if (this._stypeId === "levelup") {
            _Window_SkillList_processOk.call(this);
            return;
        }

        if (this._stypeId === "favourites") {
            // Favourites tab: show action menu
            SoundManager.playOk();
            this.updateInputData();
            this.deactivate();
            this.callHandler('skillaction');
            return;
        }
        if (this._categoryMode) {
            SoundManager.playOk();
            this._selectedCategory = this.item();
            this._lastCategoryIndex = this.index();
            this._categoryMode = false;
            this.refresh();
            const saved = this._categorySkillIndexes[this._selectedCategory];
            this.select((saved !== undefined && saved < this.maxItems()) ? saved : 0);
            this.activate();
        } else {
            if (this._selectedCategory) {
                this._categorySkillIndexes[this._selectedCategory] = this.index();
            }
            SoundManager.playOk();
            this.updateInputData();
            this.deactivate();
            this.callHandler('skillaction');
        }
    };

    // --- Process Cancel: go back to category list, or exit ---

    const _Window_SkillList_processCancel = Window_SkillList.prototype.processCancel;
    Window_SkillList.prototype.processCancel = function () {
        if (this._isSpecialStypeId()) {
            _Window_SkillList_processCancel.call(this);
            return;
        }
        if (!this._categoryMode) {
            if (this._selectedCategory) {
                this._categorySkillIndexes[this._selectedCategory] = this.index();
            }
            this._categoryMode = true;
            this._selectedCategory = null;
            this.refresh();
            this.select(Math.min(this._lastCategoryIndex, this.maxItems() - 1));
            this.activate();
            SoundManager.playCancel();
        } else {
            _Window_SkillList_processCancel.call(this);
        }
    };

    // --- Help window ---

    const _Window_SkillList_updateHelp = Window_SkillList.prototype.updateHelp;
    Window_SkillList.prototype.updateHelp = function () {
        if (this._skillInfoWindow) {
            const isCatMode = this._categoryMode && !this._isSpecialStypeId();
            this._skillInfoWindow.setItem(isCatMode ? null : this.item());
        }
        if (!this._isSpecialStypeId() && this._categoryMode) {
            const category = this.item();
            if (category && typeof category === 'string') {
                this._setHelpText(getCategoryDescription(category));
            } else {
                this._setHelpText('');
            }
        } else {
            _Window_SkillList_updateHelp.call(this);
        }
    };

    Window_SkillList.prototype._setHelpText = function (text) {
        if (this._helpWindow) this._helpWindow.setText(text);
    };

    Window_SkillList.prototype.hasCategoryUsableSkills = CategorizedSkillMixin.hasCategoryUsableSkills;

    //=============================================================================
    // Window_SkillAction ,  context popup: Use / Favourite / Cancel
    //=============================================================================

    function Window_SkillAction() {
        this.initialize(...arguments);
    }

    Window_SkillAction.prototype = Object.create(Window_Command.prototype);
    Window_SkillAction.prototype.constructor = Window_SkillAction;

    Window_SkillAction.prototype.initialize = function (rect) {
        Window_Command.prototype.initialize.call(this, rect);
        this._actor = null;
        this._skill = null;
        this.hide();
        this.deactivate();
    };

    Window_SkillAction.prototype.makeCommandList = function () {
        if (!this._actor || !this._skill) return;
        if (this._actor.canUse(this._skill)) {
            this.addCommand(T('SkillsMenu.cmd.use'), "use", true);
        }
        const isFav = isSkillFavourited(this._actor.actorId(), this._skill.id);
        this.addCommand(isFav ? T('SkillsMenu.cmd.unfavourite') : T('SkillsMenu.cmd.favourite'), "favourite", true);
        this.addCommand(T('SkillsMenu.cmd.cancel'), "cancel", true);
    };

    Window_SkillAction.prototype.setSkill = function (actor, skill) {
        this._actor = actor;
        this._skill = skill;
        this.clearCommandList();
        this.makeCommandList();
        // Resize to fit the actual number of commands
        const n = this._list.length;
        this.height = n * this.itemHeight() + $gameSystem.windowPadding() * 2;
        this.y = Math.floor((Graphics.boxHeight - this.height) / 2);
        this.createContents();
        this.select(0);
        this.refresh();
        this.show();
        this.activate();
    };

    window.Window_SkillAction = Window_SkillAction;

    //=============================================================================
    // Window_SkillInfo ,  replaces the status window in Scene_Skill
    //=============================================================================

    function Window_SkillInfo() {
        this.initialize(...arguments);
    }

    Window_SkillInfo.prototype = Object.create(Window_Base.prototype);
    Window_SkillInfo.prototype.constructor = Window_SkillInfo;

    Window_SkillInfo.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._actor = null;
        this._skill = null;
    };

    Window_SkillInfo.prototype.setActor = function (actor) {
        if (this._actor !== actor) {
            this._actor = actor;
            this.refresh();
        }
    };

    Window_SkillInfo.prototype.setItem = function (skill) {
        if (this._skill !== skill) {
            this._skill = skill;
            this.refresh();
        }
    };

    Window_SkillInfo.prototype.refresh = function () {
        this.contents.clear();
        if (this._skill) this.drawSkillInfo();
        this.drawPartyTabs();
    };

    const _getTranslation = function (key) {
        const k = 'SkillsMenu.info.' + key;
        return T.has(k) ? T(k) : key;
    };

    // These three delegate to the shared inspect service so the Skills scene,
    // the classic info window and SkillMaster all read the same numbers.
    Window_SkillInfo.prototype.getSkillScale = function (skill) {
        return window.SkillDetails.scaleOf(skill);
    };

    Window_SkillInfo.prototype.getSkillCategory = function (skill) {
        return window.SkillDetails.categoryOf(skill);
    };

    Window_SkillInfo.prototype.isBasicSkill = function (skill) {
        return window.SkillDetails.isBasic(skill);
    };

    Window_SkillInfo.prototype.drawSkillInfo = function () {
        const skill = this._skill;
        const lh = this.lineHeight();
        const x = this.itemPadding();
        let y = this.itemPadding();

        const category = this.getSkillCategory(skill);
        if (category) {
            this.drawKeyValue(T('SkillsMenu.info.type'), category, x, y);
            y += lh;
        }

        if (skill.damage.elementId > 0) {
            this.drawIcon(63 + skill.damage.elementId - 1, x, y + 2);
            this.drawText($dataSystem.elements[skill.damage.elementId] || _getTranslation('none'), x + ImageManager.iconWidth + 4, y, 150);
            y += lh;
        }

        const scaleData = this.getSkillScale(skill);
        if (scaleData) {
            const scaleText = `${scaleData.stat} (${scaleData.grade})`;
            this.drawKeyValue(T('SkillsMenu.info.scale'), scaleText, x, y);
            if (this.isBasicSkill(skill)) {
                const basicX = x + 100 + this.textWidth(scaleText) + 20;
                this.changeTextColor(ColorManager.systemColor());
                this.drawText(T('SkillsMenu.info.basic'), basicX, y, 100);
                this.resetTextColor();
            }
            y += lh;
        }

        const damageText = this.getDamageTypeText(skill);
        if (damageText) {
            const keyWidth = 100;
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(_getTranslation('effect'), x, y, keyWidth);
            this.resetTextColor();
            const maxWidth = this.contents.width - keyWidth - x * 2;
            for (const line of this.wrapText(damageText, maxWidth)) {
                this.drawText(line, x + keyWidth + 20, y, maxWidth);
                y += lh;
            }
        }
    };

    Window_SkillInfo.prototype.wrapText = function (text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let current = '';
        for (const word of words) {
            const test = current ? current + ' ' + word : word;
            if (this.textWidth(test) > maxWidth && current) {
                lines.push(current);
                current = word;
            } else {
                current = test;
            }
        }
        if (current) lines.push(current);
        return lines.length > 0 ? lines : [text];
    };

    Window_SkillInfo.prototype.drawKeyValue = function (key, value, x, y) {
        const kw = 100;
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(key, x, y, kw);
        this.resetTextColor();
        this.drawText(value, x + kw, y, this.contents.width - kw - x * 2);
    };

    Window_SkillInfo.prototype.getDamageTypeText = function (skill) {
        const damage = skill.damage;
        const typeMap = { 1: 'hpDmg', 2: 'mpDmg', 3: 'hpHeal', 4: 'mpHeal', 5: 'hpDrain', 6: 'mpDrain' };
        let text = (damage && damage.type) ? typeMap[damage.type] ? _getTranslation(typeMap[damage.type]) : "" : "";

        const effects = skill.effects || [];

        const buffEffects = effects.filter(e => e.code === 31 || e.code === 32);
        if (buffEffects.length > 0) {
            const bt = buffEffects.map(e => {
                const paramKeys = ["HP", "MP", "ATT", "DEF", "M.ATT", "M.DEF", "AGILITY", "LUCK"];
                const key = paramKeys[e.dataId];
                const paramName = key && _statsI18n ? _si18n(key) : TextManager.param(e.dataId);
                return `${_getTranslation(e.code === 31 ? 'buffs' : 'debuffs')} ${paramName}`;
            }).join(", ");
            if (text) text += ", ";
            text += bt;
        }

        const stateEffects = effects.filter(e => e.code === 21 || e.code === 22);
        if (stateEffects.length > 0) {
            const st = stateEffects.map(e => { const s = $dataStates[e.dataId]; return s ? s.name : _getTranslation('state'); }).join(", ");
            if (text) text += ", ";
            text += st;
        }

        return text || _getTranslation('none');
    };

    Window_SkillInfo.prototype.drawPartyTabs = function () {
        if (!this._actor) return;
        const allMembers = $gameParty.allMembers();
        if (allMembers.length <= 1) return;
        const actorIndex = allMembers.indexOf(this._actor);
        if (actorIndex < 0) return;

        const tabWidth = 120;
        const tabHeight = 32;
        const tabSpacing = 10;
        const arrowWidth = 20;
        const total = allMembers.length === 2 ? tabWidth : (tabWidth * 2 + tabSpacing);
        const startX = this.contents.width - total - 20;
        const startY = 8;

        const prevIdx = (actorIndex - 1 + allMembers.length) % allMembers.length;
        const nextIdx = (actorIndex + 1) % allMembers.length;

        const overlayW = total + arrowWidth * 2 + 20;
        this.contents.fillRect(startX - arrowWidth - 15, startY - 8, overlayW, tabHeight + 16, 'rgba(0,0,0,0.5)');

        if (allMembers.length === 2) {
            this.drawArrow(startX - arrowWidth - 5, startY + tabHeight / 2, "left");
            this.drawTab(allMembers[prevIdx], startX, startY, tabWidth, tabHeight);
            this.drawArrow(startX + tabWidth + 5, startY + tabHeight / 2, "right");
        } else {
            const leftX = startX;
            this.drawArrow(leftX - arrowWidth - 5, startY + tabHeight / 2, "left");
            this.drawTab(allMembers[prevIdx], leftX, startY, tabWidth, tabHeight);
            const rightX = startX + tabWidth + tabSpacing;
            this.drawTab(allMembers[nextIdx], rightX, startY, tabWidth, tabHeight);
            this.drawArrow(rightX + tabWidth + 5, startY + tabHeight / 2, "right");
        }
    };

    Window_SkillInfo.prototype.drawArrow = function (x, y, direction) {
        this.changeTextColor(ColorManager.normalColor());
        this.contents.fontSize = 22;
        const arrowText = direction === "left" ? "◀" : "▶";
        this.contents.drawText(arrowText, x - 12, y - 11, 24, 22, "center");
        this.resetFontSettings();
    };

    Window_SkillInfo.prototype.drawTab = function (actor, x, y, width, height) {
        this.contents.fillRect(x, y, width, height, ColorManager.dimColor1());
        this.contents.strokeRect(x, y, width, height, ColorManager.outlineColor());
        this.contents.fontSize = 16;
        this.changeTextColor(ColorManager.normalColor());
        this.contents.drawText(actor.name(), x, y + (height - 16) / 2 - 2, width, 16, "center");
        this.resetFontSettings();
    };

    window.Window_SkillInfo = Window_SkillInfo;

})();
