//=============================================================================
// CategorizedBattleSkills.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Role-tabbed skill menu with a carried battle loadout of 7 skills and 7 magic per character.
 * @author Omni-Lex
 * @version 3.0.0
 *
 * @help CategorizedBattleSkills.js
 *
 * Combines CategorizedBattleSkills and CustomSkillsMenuSwitcher into one plugin.
 *
 * --- THE LOADOUT ---
 * A character knows far more than they can hold in their hands. At most 7
 * skills and 7 magic are carried at once, and only those reach the battle
 * menus; everything else is known but benched until the player says otherwise.
 * A newly learned skill is carried straight away while its half of the loadout
 * still has room. The Basic kit (<category:Basic>: Attack, Guard, Check, ...)
 * and anything a weapon or a state grants are always carried and spend no slot.
 *
 * window.BattleLoadout is the only way to ask what a character carries.
 *
 * --- BATTLE ---
 * One flat list per skill type, holding that type's carried skills by name.
 * There is no category layer.
 *
 * --- MENU (Skills scene) ---
 * Three tabs by role, Offensive / Healing / Support, each listing skills AND
 * magic together by name, plus a "Level Up" tab of what the class still owes.
 * A skill is carried or benched from its row (Shift, or the pill on the card)
 * or from the action list on the right page.
 * Left/Right switches party members. The skill info panel replaces the status window.
 *
 * --- HOW TO USE ---
 * Add <role: Offensive|Healing|Support> to a skill's Note field. A skill
 * without one is bucketed from its own mechanics.
 *
 * --- CHANGE LOG ---
 * v3.0.0 - Carried battle loadout (7 skills + 7 magic). Skill menu tabs are
 *          roles, not schools. Battle categories, the categorization option
 *          and favourite skills all removed.
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
                    // Sphere-grid plumbing (SkillMaster's <Node:> / <Link:> tags):
                    // where a skill sits on its category graph is drawn, not listed.
                    if (nameLower === "node" || nameLower === "link") return;
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

    //=============================================================================
    // Roles ,  the one grouping a skill has
    //=============================================================================
    // Schools (<category:>) survive as flavour on the inspect page and nowhere
    // else: what a skill is FOR is what the menu sorts it by.
    // i18n-ignore-start: role bucket ids, matched against the <role:> tag; the
    // visible names come from ROLE_DATA
    const ROLE_KEYS = ['Offensive', 'Healing', 'Support'];
    // i18n-ignore-end

    // nameKey/descKey are resolved at render time by getRoleInfo.
    const ROLE_DATA = {
        Offensive: {
            nameKey: "SkillsMenu.role.offensive.name",
            descKey: "SkillsMenu.role.offensive.description",
            icon: 97
        },
        Healing: {
            nameKey: "SkillsMenu.role.healing.name",
            descKey: "SkillsMenu.role.healing.description",
            icon: 75
        },
        Support: {
            nameKey: "SkillsMenu.role.support.name",
            descKey: "SkillsMenu.role.support.description",
            icon: 80
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

    function getRoleInfo(roleKey) {
        const data = ROLE_DATA[roleKey];
        if (!data) return { name: String(roleKey || ''), description: '', icon: 160 };
        return {
            name: T.has(data.nameKey) ? T(data.nameKey) : roleKey,
            description: T.has(data.descKey) ? T(data.descKey) : '',
            icon: data.icon
        };
    }
    const getRoleDisplayName = roleKey => getRoleInfo(roleKey).name;
    const getRoleDescription = roleKey => getRoleInfo(roleKey).description;

    //=============================================================================
    // Battle loadout ,  what a character actually carries into a fight
    //=============================================================================
    // Knowing a skill and having it to hand are two different things. At most
    // LOADOUT_MAX skills and LOADOUT_MAX magic are carried at once and only
    // those reach the battle menus; the rest are known and benched. Two kinds of
    // skill are always carried and spend no slot: the Basic kit (the engine's
    // own fallback moves, which have their own battle command) and anything a
    // weapon or a state grants, which comes and goes with what is worn.
    // The carried ids live on $gameSystem, so a loadout travels with the save.
    const LOADOUT_MAX = 7;
    const GROUP_MAGIC = 'Magic', GROUP_SKILL = 'Skill'; // i18n-ignore: skill-type group ids

    // Width of the battle skill page, in game pixels. The description box above
    // it matches, so a line of help text breaks where the skill names do.
    const PAGE_WIDTH = 420;

    // "Magic" for a skill type whose name reads as magic, "Skill" otherwise.
    function _getStypeIdCategoryGroup(stypeId) {
        if (!stypeId) return null;
        const name = $dataSystem.skillTypes[stypeId] || '';
        return name.toLowerCase().includes('magic') ? GROUP_MAGIC : GROUP_SKILL;
    }

    // The explicit tag, not getSkillCategory's catch-all: an untagged skill is
    // an ordinary skill, not a member of the engine's basic kit.
    const isBasicSkill = skill => !!skill && /<category\s*:\s*Basic\s*>/i.test(skill.note || '');

    function loadoutGroupOf(skill) {
        return _getStypeIdCategoryGroup(skill && skill.stypeId) === GROUP_MAGIC ? GROUP_MAGIC : GROUP_SKILL;
    }

    function isAlwaysCarried(actor, skill) {
        if (!skill) return false;
        if (isBasicSkill(skill)) return true;
        if (!actor) return false;
        return !actor.isLearnedSkill(skill.id) && actor.addedSkills().includes(skill.id);
    }

    function loadoutStore() {
        if (!$gameSystem._activeBattleSkills) $gameSystem._activeBattleSkills = {};
        return $gameSystem._activeBattleSkills;
    }

    // The raw carried list, in the order the skills were taken up. A character
    // who has never had one (an old save, or one built before this ran) is
    // seeded with the first LOADOUT_MAX of each group they know, so nobody
    // walks into a fight with empty hands.
    function loadoutIds(actor) {
        if (!actor || typeof $gameSystem === 'undefined' || !$gameSystem) return [];
        const store = loadoutStore();
        const id = actor.actorId();
        if (!Array.isArray(store[id])) store[id] = seedLoadout(actor);
        return store[id];
    }

    function seedLoadout(actor) {
        const counts = {};
        const picked = [];
        for (const skill of actor.skills()) {
            if (!skill || isDummySkill(skill) || isAlwaysCarried(actor, skill)) continue;
            const group = loadoutGroupOf(skill);
            if ((counts[group] || 0) >= LOADOUT_MAX) continue;
            counts[group] = (counts[group] || 0) + 1;
            picked.push(skill.id);
        }
        return picked;
    }

    const BattleLoadout = {
        MAX: LOADOUT_MAX,
        GROUP_MAGIC: GROUP_MAGIC,
        GROUP_SKILL: GROUP_SKILL,
        groupOf: loadoutGroupOf,
        isAlwaysCarried: isAlwaysCarried,
        isBasic: isBasicSkill,

        // Carried ids the character still knows, in carry order.
        ids(actor) {
            if (!actor) return [];
            const known = new Set(actor.skills().map(s => s.id));
            return loadoutIds(actor).filter(id => {
                const skill = $dataSkills[id];
                return skill && !isDummySkill(skill) && known.has(id);
            });
        },

        isActive(actor, skill) {
            if (!actor || !skill) return false;
            if (isAlwaysCarried(actor, skill)) return true;
            return loadoutIds(actor).includes(skill.id);
        },

        count(actor, group) {
            return this.ids(actor).filter(id => loadoutGroupOf($dataSkills[id]) === group).length;
        },

        hasRoom(actor, group) {
            return this.count(actor, group) < LOADOUT_MAX;
        },

        // 'locked' , always carried, there is nothing to decide. 'full' , that
        // half of the loadout is already at capacity. Otherwise 'on' / 'off'.
        toggle(actor, skill) {
            if (!actor || !skill) return 'locked';
            if (isAlwaysCarried(actor, skill)) return 'locked';
            const list = loadoutIds(actor);
            const i = list.indexOf(skill.id);
            if (i >= 0) {
                list.splice(i, 1);
                return 'off';
            }
            if (!this.hasRoom(actor, loadoutGroupOf(skill))) return 'full';
            list.push(skill.id);
            return 'on';
        },

        // A freshly learned skill is taken up at once while its half of the
        // loadout has room; past that it is learned and left on the bench.
        autoActivate(actor, skillId) {
            const skill = $dataSkills[skillId];
            if (!actor || !skill || isDummySkill(skill)) return false;
            if (isAlwaysCarried(actor, skill)) return false;
            const list = loadoutIds(actor);
            if (list.includes(skillId)) return false;
            if (!this.hasRoom(actor, loadoutGroupOf(skill))) return false;
            list.push(skillId);
            return true;
        },

        drop(actor, skillId) {
            const list = loadoutIds(actor);
            const i = list.indexOf(skillId);
            if (i >= 0) list.splice(i, 1);
        },

        // What a battle menu shows for one skill type: that type's carried
        // skills, by name. The Basic kit has its own command and stays out.
        battleSkills(actor, stypeId) {
            if (!actor) return [];
            return actor.skills()
                .filter(skill => skill && !isDummySkill(skill) && !isBasicSkill(skill) &&
                    (!stypeId || skill.stypeId === stypeId) && this.isActive(actor, skill))
                .sort((a, b) => a.name.localeCompare(b.name));
        }
    };
    window.BattleLoadout = BattleLoadout;

    const _Game_Actor_learnSkill = Game_Actor.prototype.learnSkill;
    Game_Actor.prototype.learnSkill = function (skillId) {
        const knew = this.isLearnedSkill(skillId);
        _Game_Actor_learnSkill.call(this, skillId);
        if (!knew && this.isLearnedSkill(skillId)) BattleLoadout.autoActivate(this, skillId);
    };

    const _Game_Actor_forgetSkill = Game_Actor.prototype.forgetSkill;
    Game_Actor.prototype.forgetSkill = function (skillId) {
        _Game_Actor_forgetSkill.call(this, skillId);
        BattleLoadout.drop(this, skillId);
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
    // BattleSkillMixin (used by Window_BattleSkill)
    //=============================================================================

    const BattleSkillMixin = {
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
        }
    };

    //=============================================================================
    // Window_BattleSkill ,  the carried skills of one skill type, by name
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

    // ── The battle list page geometry (idempotent across plugins) ─────────────
    // The skill page, the item page (BattleSystemEnhancedHUD) and the
    // description box that sits on top of them are three panels that have to
    // agree: whichever list is open publishes the corner it occupies, in game
    // pixels, and the description box reads it. Without this the box is placed
    // against a size the page no longer has and drifts away from what it
    // describes.
    if (!window.BattleListPage) {
        window.BattleListPage = {
            MARGIN: 20,   // from the screen's right and bottom edges
            GAP: 10,      // between the description box and the page below it
            width: 420,
            height: 460,
            set(width, height) {
                this.width = width;
                this.height = height;
            }
        };
    }

    const _Window_BattleSkill_initialize = Window_BattleSkill.prototype.initialize;
    Window_BattleSkill.prototype.initialize = function (rect) {
        _Window_BattleSkill_initialize.call(this, rect);
        this._basicMode = false;

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

    const _Window_BattleSkill_show = Window_BattleSkill.prototype.show;
    Window_BattleSkill.prototype.show = function () {
        this.refresh();
        _Window_BattleSkill_show.call(this);
        this.select(0);
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
        _Window_BattleSkill_refresh.call(this);
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

    // The Basic command shows the engine's own kit across every skill type;
    // every other command shows that type's carried skills.
    Window_BattleSkill.prototype.makeItemList = function () {
        if (!this._actor) {
            this._data = [];
            return;
        }
        if (this._basicMode) {
            this._data = this._actor.skills()
                .filter(skill => skill && !isDummySkill(skill) && isBasicSkill(skill))
                .sort((a, b) => a.name.localeCompare(b.name));
        } else {
            this._data = BattleLoadout.battleSkills(this._actor, this._stypeId);
        }
    };

    // Enables/disables the cross-type "Basic" skill view used by the Basic battle command.
    Window_BattleSkill.prototype.setBasicMode = function (flag) {
        this._basicMode = !!flag;
    };

    Window_BattleSkill.prototype.drawItem = function (index) {
        const skill = this.itemAt(index);
        if (!skill) return;
        const rect = this.itemLineRect(index);
        // A skill the actor cannot pay for is drawn faded, the same answer the
        // HTML row gives, so the canvas fallback never reads as selectable when
        // the row it mirrors is locked.
        this.changePaintOpacity(this.isEnabled(skill));
        this.drawItemName(skill, rect.x, rect.y, rect.width - this.costWidth());
        this.drawSkillCost(skill, rect.x, rect.y, rect.width);
        this.changePaintOpacity(1);
    };

    // These shadow the Window_SkillList overrides installed further down (which
    // serve the menu scene); the battle list wants the base RPG Maker rule.
    // A carried skill the actor cannot afford right now is a locked row: it can
    // still be browsed and read, but Window_SkillList.isCurrentItemEnabled sends
    // OK on it to playBuzzerSound(), so nothing is chosen, no action is set and
    // the turn is not spent.
    Window_BattleSkill.prototype.isEnabled = function (item) {
        return !!(item && this._actor && this._actor.canUse(item));
    };

    const _Window_BattleSkill_processOk = Window_BattleSkill.prototype.processOk;
    Window_BattleSkill.prototype.processOk = function () {
        _Window_BattleSkill_processOk.call(this);
        TouchInput.clear();
    };

    const _Window_BattleSkill_processCancel = Window_BattleSkill.prototype.processCancel;
    Window_BattleSkill.prototype.processCancel = function () {
        _Window_BattleSkill_processCancel.call(this);
    };

    Window_BattleSkill.prototype.processCursorMove = function () {
        if (this.isCursorMovable()) {
            BattleSkillMixin.handleCursorMove.call(this);
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
        const skill = this.item();
        if (skill) {
            this.setHelpWindowText(buildBattleSkillHelpText(skill, this._actor));
        } else {
            _Window_BattleSkill_updateHelp.call(this);
        }
    };

    Window_BattleSkill.prototype.setHelpWindowText = function (text) {
        if (this._helpWindow) this._helpWindow.setText(text);
    };

    Window_BattleSkill.prototype._buildSkillItems = function () {
        const root = this._htmlSkillRoot;
        if (!root) return;
        // Rows are recreated fresh (transparent), so force update() to re-apply
        // the selection highlight and font size on its next pass. The page is
        // sized off the rows, so the layout pass has to run again too: a list
        // that shed or gained entries is a page of a different height.
        this._lastSkillIdx = null;
        this._prevSkillHiIdx = null;
        this._lastSkillSy = null;
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

            const skill = item;
            const isEnabled = this._actor ? this._actor.canUse(skill) : false;

            const iconSpan = document.createElement('span');
            iconSpan.style.cssText = getIconStyle(skill.iconIndex);
            leftDiv.appendChild(iconSpan);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = skill.name;
            leftDiv.appendChild(nameSpan);
            el.appendChild(leftDiv);

            const rightDiv = document.createElement('div');
            rightDiv.style.cssText = 'display:flex;align-items:center;font-size:85%;';

            if (this._actor) {
                const tpCost = this._actor.skillTpCost(skill);
                const mpCost = this._actor.skillMpCost(skill);
                const costText = tpCost > 0 ? tpCost + ' AP' : (mpCost > 0 ? mpCost + ' MP' : '');
                if (costText) {
                    const costSpan = document.createElement('span');
                    costSpan.style.color = 'var(--text-primary-hover)';
                    costSpan.style.fontWeight = 'bold';
                    costSpan.style.marginLeft = '8px';
                    costSpan.textContent = costText;
                    rightDiv.appendChild(costSpan);
                }
            }
            el.appendChild(rightDiv);

            if (!isEnabled) {
                el.style.opacity = '0.4';
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
            const page = window.BattleListPage;
            const pad = this.padding || 12;
            const padY = Math.round(pad * sc.sy);
            const padX = Math.round(pad * sc.sx);
            // Define portrait narrow page dimensions
            const scaledW = PAGE_WIDTH * sc.sx;

            s.width = scaledW + 'px';
            s.padding = padY + 'px ' + padX + 'px';

            // The rows carry the new font before anything is measured off them.
            if (this._htmlSkillEls) {
                this._htmlSkillEls.forEach(el => { el.style.fontSize = scaledFont + 'px'; });
            }

            // The page is as tall as the loadout it shows. A full carry is
            // LOADOUT_MAX skills or LOADOUT_MAX magic, so that many rows always
            // fit without scrolling; a shorter list shrinks to what it holds
            // instead of leaving the page half empty, and the Basic kit (which
            // answers to no loadout) stops at that same height and scrolls.
            const els = this._htmlSkillEls || [];
            const shown = Math.min(els.length, LOADOUT_MAX);
            let rowsH = 0;
            if (shown > 0) {
                const last = els[shown - 1];
                rowsH = last.offsetTop + last.offsetHeight - padY;
            }
            // Border-box: the 3px frame on both sides counts toward the height.
            const frameH = padY * 2 + 6;
            const minH = Math.round(120 * sc.sy);
            const maxH = (Graphics.height - 40) * sc.sy;
            const scaledH = Math.max(minH, Math.min(rowsH + frameH, maxH));

            // The description box sits on top of this page, so it is told the
            // corner the page ended up occupying.
            page.set(PAGE_WIDTH, scaledH / sc.sy);

            // Position bottom-right, aligned with bottom-right commands
            const targetLeft = sc.ox + (Graphics.width * sc.sx) - scaledW - (page.MARGIN * sc.sx);
            const targetTop = sc.oy + (Graphics.height * sc.sy) - scaledH - (page.MARGIN * sc.sy);

            s.left = targetLeft + 'px';
            s.top = targetTop + 'px';
            s.height = scaledH + 'px';

            // Trigger slide-in/open transition styles
            s.transform = 'translateX(0)';
            s.opacity = '1';
            s.pointerEvents = 'auto';
        }

        if (this._htmlSkillEls) {
            const prevIdx = idxChanged ? this._prevSkillHiIdx : idx;
            // Only recolour the two rows whose highlight state flips; the font
            // size is stamped by the layout pass above, which measures off it.
            this._htmlSkillEls.forEach((el, i) => {
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
        this._dndSelectedIndex = 0; // selected skill row
        this._dndSelectedActionIndex = 0;
        this._dndSelectedTargetIndex = 0;
        this._dndTargetingMode = false;
        this._dndTargetingSkill = null;

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
        } else if (symbol === 'loadout') {
            const skill = this._itemWindow.item();
            if (skill) BattleLoadout.toggle(this.actor(), skill);
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
    // resetting the skill selection so the new actor opens cleanly.
    Scene_Skill.prototype.cycleUIActor = function (dir) {
        const allMembers = $gameParty.allMembers();
        if (allMembers.length <= 1) return;
        this._actorIndex = (this._actorIndex + dir + allMembers.length) % allMembers.length;
        this.changeActor();
        this._dndSelectedIndex = 0;
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
            /* A benched skill is still legible, just visibly not in hand. */
            .skill-card-slot.benched {
                opacity: 0.5;
                border-style: dashed;
            }
            .loadout-pill {
                font-family: 'Lora', serif;
                font-size: 0.62rem;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                line-height: 1;
                padding: 3px 6px;
                margin-left: 6px;
                border-radius: 3px;
                border: 1px solid var(--text-primary-hover);
                color: var(--text-primary-hover);
                background: var(--border-primary-hover-translucent-15);
                cursor: pointer;
                user-select: none;
                white-space: nowrap;
            }
            .loadout-pill.locked {
                cursor: default;
                opacity: 0.7;
                border-style: dashed;
            }
            .loadout-pill.off {
                border-color: var(--text-card-medium);
                color: var(--text-card-medium);
                background: transparent;
            }
            .loadout-summary {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 14px;
                flex-wrap: wrap;
                font-family: 'Lora', serif;
                font-size: 0.78rem;
                font-weight: bold;
                color: var(--text-primary-hover);
                margin-bottom: 10px;
            }
            .loadout-summary .loadout-count.full {
                color: var(--text-gold-dark);
            }
            .loadout-summary .loadout-hint {
                font-weight: normal;
                font-style: italic;
                color: var(--text-card-medium);
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

    // Three role tabs plus the class's own ledger. A tab is not a skill type:
    // skills and magic sit side by side inside each role.
    Scene_Skill.prototype.getUISkillTypes = function () {
        const actor = this.actor();
        if (!actor) return [];

        const list = ROLE_KEYS.map(key => ({ name: getRoleDisplayName(key), ext: key, type: "role" }));
        list.push({ name: T('SkillsMenu.cmd.levelUp'), ext: "levelup", type: "levelup" });

        return list;
    };

    Scene_Skill.prototype.isUILevelUpTab = function () {
        const type = this.getUISkillTypes()[this._dndSelectedTypeIndex];
        return !!type && type.ext === "levelup";
    };

    // A Level Up row is a {skill, level, isLearned} record; every other row is
    // the skill itself.
    Scene_Skill.prototype.uiSkillOf = function (entry) {
        if (!entry) return null;
        return this.isUILevelUpTab() ? entry.skill : entry;
    };

    Scene_Skill.prototype.getUISkillsOnlyList = function () {
        const actor = this.actor();
        if (!actor) return [];
        const type = this.getUISkillTypes()[this._dndSelectedTypeIndex];
        if (!type) return [];

        if (type.ext === "levelup") {
            const classData = $dataClasses[actor._classId];
            if (!classData || !classData.learnings) return [];
            return classData.learnings
                .map(l => ({ skill: $dataSkills[l.skillId], level: l.level, isLearned: actor.isLearnedSkill(l.skillId) }))
                .filter(entry => entry.skill && !isDummySkill(entry.skill))
                .sort((a, b) => a.level !== b.level ? a.level - b.level : a.skill.name.localeCompare(b.skill.name));
        }
        return actor.skills()
            .filter(skill => skill && !isDummySkill(skill) && getSkillRole(skill) === type.ext)
            .sort((a, b) => a.name.localeCompare(b.name));
    };

    Scene_Skill.prototype.getUISkillCostText = function (skill) {
        if (!skill) return "";
        if (skill.mpCost > 0) return `${skill.mpCost} MP`;
        if (skill.tpCost > 0) return `${skill.tpCost} AP`;
        return "";
    };

    Scene_Skill.prototype.uiLoadoutGroupLabel = function (group) {
        return group === BattleLoadout.GROUP_MAGIC
            ? T('SkillsMenu.loadout.magic')
            : T('SkillsMenu.loadout.skills');
    };

    Scene_Skill.prototype.getUISkillActions = function () {
        const list = this.getUISkillsOnlyList();
        const skill = this.uiSkillOf(list[this._dndSelectedIndex]);
        if (!skill) return [];

        const actions = [];
        const actor = this.actor();

        if (!this.isUILevelUpTab()) {
            if (actor.canUse(skill)) actions.push("use");
            if (!BattleLoadout.isAlwaysCarried(actor, skill)) actions.push("loadout");
        }
        actions.push("back");
        return actions;
    };

    // Take a skill up or put it down. A full half of the loadout refuses, and
    // says which half and how full, rather than silently doing nothing.
    Scene_Skill.prototype.toggleUILoadout = function (skill) {
        const actor = this.actor();
        if (!skill || !actor) return;
        const result = BattleLoadout.toggle(actor, skill);
        if (result === 'locked') {
            SoundManager.playBuzzer();
            return;
        }
        if (result === 'full') {
            SoundManager.playBuzzer();
            if (window.ParchmentToast) {
                window.ParchmentToast.show(T('SkillsMenu.loadout.full', {
                    group: this.uiLoadoutGroupLabel(BattleLoadout.groupOf(skill)),
                    max: BattleLoadout.MAX
                }), { severity: "warning" });
            }
            return;
        }
        SoundManager.playOk();
        this._itemWindow.refresh();
        this.refreshUISkill();
    };

    Scene_Skill.prototype.clickUILoadout = function (idx) {
        const list = this.getUISkillsOnlyList();
        const skill = this.uiSkillOf(list[idx]);
        if (!skill) return;
        this._dndActiveSection = "skills";
        this._dndSelectedIndex = idx;
        this.toggleUILoadout(skill);
    };

    Scene_Skill.prototype.triggerUISkillAction = function (action) {
        const list = this.getUISkillsOnlyList();
        const skill = this.uiSkillOf(list[this._dndSelectedIndex]);
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
        } else if (action === "loadout") {
            this.toggleUILoadout(skill);
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

        // 3. Get the list ,  one flat, name-ordered roll of the active tab
        const list = this.getUISkillsOnlyList();
        const isLevelUp = this.isUILevelUpTab();

        // Boundary protection
        if (this._dndSelectedIndex >= list.length) {
            this._dndSelectedIndex = Math.max(0, list.length - 1);
        }

        const selectedItem = this.uiSkillOf(list[this._dndSelectedIndex]);

        // Determine left page key to see if left page needs full render. The
        // carried ids are part of it: taking a skill up repaints its pill.
        const carriedKey = BattleLoadout.ids(actor).join(',');
        const leftPageKey = `${actor.actorId()}_${this._dndSelectedTypeIndex}_${list.length}_${carriedKey}`;

        const skillsTitle = T('SkillsMenu.title');
        const backBtnText = T('SkillsMenu.back');

        let skillsGridHTML = "";
        if (list.length === 0) {
            skillsGridHTML = `
                <div style="grid-column: 1 / -1; font-family:'Lora', serif; font-style:italic; text-align:center; padding: 40px 10px; color:var(--text-card-medium);">
                    ${T('SkillsMenu.empty.section')}
                </div>
            `;
        } else {
            list.forEach((entry, idx) => {
                const item = isLevelUp ? entry.skill : entry;
                if (!item) return;

                const isLearned = isLevelUp ? entry.isLearned : true;
                const levelText = isLevelUp ? `<span style="color:#bba16d; margin-right: 5px; font-family:'Lora', serif; font-size: 0.9em; font-weight: bold;">Lv ${entry.level}:</span>` : "";

                const isFocused = (this._dndActiveSection === "skills" && this._dndSelectedIndex === idx) ? "selected" : "";
                const isEnabled = actor.canUse(item);
                const costText = this.getUISkillCostText(item);
                const canvasId = `skill-canvas-${idx}`;
                let nameWeight = isEnabled ? "font-weight: bold;" : "";
                if (isLevelUp && !isLearned) nameWeight += " opacity: 0.6;";

                // Whether the skill is in hand, and whether that is the player's
                // to decide: the basic kit and anything worn are simply carried.
                let pillHTML = "";
                let benchedClass = "";
                if (!isLevelUp) {
                    const locked = BattleLoadout.isAlwaysCarried(actor, item);
                    const carried = BattleLoadout.isActive(actor, item);
                    if (locked) {
                        pillHTML = `<span class="loadout-pill locked">${T('SkillsMenu.loadout.always')}</span>`;
                    } else {
                        pillHTML = `<span class="loadout-pill ${carried ? "" : "off"}" onclick="event.stopPropagation(); SceneManager._scene.clickUILoadout(${idx})">${carried ? T('SkillsMenu.loadout.carried') : T('SkillsMenu.loadout.benched')}</span>`;
                        if (!carried) benchedClass = " benched";
                    }
                }

                skillsGridHTML += `
                    <div class="skill-card-slot ${isFocused}${benchedClass}" data-skill-idx="${idx}" onclick="SceneManager._scene.clickUISkill(${idx})">
                        <div class="card-left-side">
                            ${levelText}
                            <div class="faction-icon-frame" style="margin-right: 8px; border-radius: 50%; display: flex; align-items: center;">
                                <canvas id="${canvasId}" width="32" height="32" style="width:24px; height:24px;"></canvas>
                            </div>
                            <span class="card-title-text" style="${nameWeight}">${item.name}</span>
                        </div>
                        <div class="card-right-side">
                            <span class="card-cost-label">${costText}</span>
                            ${pillHTML}
                        </div>
                    </div>
                `;
            });
        }

        const leftPageContentHTML = `
            <div class="skill-book-content">
                <div class="skills-grid-container">
                    ${skillsGridHTML}
                </div>
            </div>
        `;

        // How full each half of the loadout is, so the budget is never a guess.
        const skillCount = BattleLoadout.count(actor, BattleLoadout.GROUP_SKILL);
        const magicCount = BattleLoadout.count(actor, BattleLoadout.GROUP_MAGIC);
        const loadoutSummaryHTML = isLevelUp ? "" : `
            <div class="loadout-summary">
                <span class="loadout-count ${skillCount >= BattleLoadout.MAX ? "full" : ""}">${T('SkillsMenu.loadout.count', { group: T('SkillsMenu.loadout.skills'), n: skillCount, max: BattleLoadout.MAX })}</span>
                <span class="loadout-count ${magicCount >= BattleLoadout.MAX ? "full" : ""}">${T('SkillsMenu.loadout.count', { group: T('SkillsMenu.loadout.magic'), n: magicCount, max: BattleLoadout.MAX })}</span>
                <span class="loadout-hint">${T('SkillsMenu.loadout.hint')}</span>
            </div>
        `;

        const leftPageHeaderHTML = `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed var(--border-gold-amber-30); padding-bottom: 8px; margin-bottom: 12px; min-height: 40px; width: 100%;">
              <div class="back-button focusable" onclick="SceneManager._scene.handleUICancel()" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                ${backBtnText}
              </div>
              <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${skillsTitle}</h2>
            </div>
            ${skillTypesRowHTML}
            ${loadoutSummaryHTML}
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
                else if (action === "loadout") {
                    label = BattleLoadout.isActive(actor, skill)
                        ? T('SkillsMenu.action.bench') : T('SkillsMenu.action.carry');
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

            // Render every row's icon
            list.forEach((entry, idx) => {
                const item = isLevelUp ? entry.skill : entry;
                if (item) this.drawUISkillIcon(item.iconIndex, `skill-canvas-${idx}`);
            });
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
            this._itemWindow.setStypeId(type.ext);
            this.refreshUISkill();
        }
    };

    Scene_Skill.prototype.selectUISkill = function (idx) {
        SoundManager.playCursor();
        this._dndSelectedIndex = idx;
        this.refreshUISkill();
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

        const list = this.getUISkillsOnlyList();
        const selectedItem = this.uiSkillOf(list[this._dndSelectedIndex]);

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
                else if (action === "loadout") {
                    label = BattleLoadout.isActive(actor, skill)
                        ? T('SkillsMenu.action.bench') : T('SkillsMenu.action.carry');
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
            } else if (Input.isTriggered('shift')) {
                // Take the highlighted skill up or put it down without leaving
                // the list: the quick way to rebuild a loadout.
                this.handleQuickToggle();
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
            scene.refreshUISkill();
        },

        handleQuickToggle: function () {
            const scene = this._scene;
            if (!scene || scene._dndTargetingMode) return;
            if (scene._dndActiveSection !== "skills" && scene._dndActiveSection !== "actions") return;
            if (scene.isUILevelUpTab()) return;
            const list = scene.getUISkillsOnlyList();
            const skill = scene.uiSkillOf(list[scene._dndSelectedIndex]);
            if (skill) scene.toggleUILoadout(skill);
        },

        handleMove: function (dir) {
            const scene = this._scene;
            const section = scene._dndActiveSection;
            const types = scene.getUISkillTypes();
            const skillsOnlyList = scene.getUISkillsOnlyList();

            if (section === "types") {
                if (dir === "left") {
                    if (scene._dndSelectedTypeIndex > 0) {
                        SoundManager.playCursor();
                        scene._dndSelectedTypeIndex--;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    } else {
                        scene.previousActor();
                        scene._dndSelectedTypeIndex = types.length - 1;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    }
                } else if (dir === "right") {
                    if (scene._dndSelectedTypeIndex < types.length - 1) {
                        SoundManager.playCursor();
                        scene._dndSelectedTypeIndex++;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    } else {
                        scene.nextActor();
                        scene._dndSelectedTypeIndex = 0;
                        scene._dndSelectedIndex = 0;
                        scene._itemWindow.setStypeId(types[scene._dndSelectedTypeIndex].ext);
                        scene.refreshUISkill();
                    }
                } else if (dir === "down") {
                    if (skillsOnlyList.length > 0) {
                        SoundManager.playCursor();
                        scene._dndActiveSection = "skills";
                        scene._dndSelectedIndex = 0;
                        scene.refreshUISkill();
                    }
                }
            } else if (section === "skills") {
                const list = skillsOnlyList;
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

            if (section === "types") {
                if (scene.getUISkillsOnlyList().length > 0) {
                    SoundManager.playOk();
                    scene._dndActiveSection = "skills";
                    scene._dndSelectedIndex = 0;
                    scene.refreshUISkill();
                }
            } else if (section === "skills") {
                const item = scene.getUISkillsOnlyList()[scene._dndSelectedIndex];
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

    // The menu's tabs are roles, not skill types: a character's magic and their
    // skills belong to the same three purposes, so they are listed together.
    Window_SkillType.prototype.makeCommandList = function () {
        if (!this._actor) return;
        ROLE_KEYS.forEach(key => this.addCommand(getRoleDisplayName(key), "skill", true, key));
        this.addCommand(T('SkillsMenu.cmd.levelUp'), "skill", true, "levelup");
    };

    const _Window_SkillType_update = Window_SkillType.prototype.update;
    Window_SkillType.prototype.update = function () {
        _Window_SkillType_update.call(this);
        if (this._itemWindow) {
            this._itemWindow.setStypeId(this.currentExt());
        }
    };

    //=============================================================================
    // Window_SkillList ,  one flat roll per role tab, plus the Level Up ledger;
    //                    skill info panel connection; left/right blocked for actor switching
    //=============================================================================

    const _Window_SkillList_initialize = Window_SkillList.prototype.initialize;
    Window_SkillList.prototype.initialize = function (rect) {
        _Window_SkillList_initialize.call(this, rect);
        this._skillInfoWindow = null;
    };

    const _Window_SkillList_setActor = Window_SkillList.prototype.setActor;
    Window_SkillList.prototype.setActor = function (actor) {
        _Window_SkillList_setActor.call(this, actor);
        this.updateSkillInfo();
    };

    // --- Skill info window connection ---

    Window_SkillList.prototype.setSkillInfoWindow = function (skillInfoWindow) {
        this._skillInfoWindow = skillInfoWindow;
        this.updateSkillInfo();
    };

    Window_SkillList.prototype._isSpecialStypeId = function () {
        return this._stypeId === "levelup";
    };

    Window_SkillList.prototype.updateSkillInfo = function () {
        if (this._skillInfoWindow) {
            this._skillInfoWindow.setItem(this.item());
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

    // A role key ("Offensive"...) lists that role whole, skills and magic
    // together; a numeric skill type lists what is carried of that type.
    Window_SkillList.prototype.makeItemList = function () {
        if (!this._actor) {
            this._data = [];
            return;
        }
        if (this._stypeId === "levelup") {
            this._data = this._makeLearnableSkillsList();
        } else if (ROLE_KEYS.includes(this._stypeId)) {
            this._data = this._actor.skills()
                .filter(skill => skill && !isDummySkill(skill) && getSkillRole(skill) === this._stypeId)
                .sort((a, b) => a.name.localeCompare(b.name));
        } else {
            this._data = BattleLoadout.battleSkills(this._actor, this._stypeId);
        }
    };

    // Skills that can be learned by level up
    Window_SkillList.prototype._makeLearnableSkillsList = function () {
        if (!this._actor) return [];
        const classData = $dataClasses[this._actor._classId];
        if (!classData || !classData.learnings) return [];
        return classData.learnings
            .map(l => ({ skill: $dataSkills[l.skillId], level: l.level, isLearned: this._actor.isLearnedSkill(l.skillId) }))
            .filter(entry => entry.skill && !isDummySkill(entry.skill))
            .sort((a, b) => a.level !== b.level ? a.level - b.level : a.skill.name.localeCompare(b.skill.name));
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
        return true; // All skills selectable; the action popup handles usability
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

        // Every skill is selectable; a benched one is drawn faded, since it is
        // known but not in hand.
        this.changePaintOpacity(BattleLoadout.isActive(this._actor, item));
        this.drawItemName(item, rect.x, rect.y, rect.width - this.costWidth());
        this.drawSkillCost(item, rect.x, rect.y, rect.width);
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

    // --- Process OK: hand over to the action popup ---

    const _Window_SkillList_processOk = Window_SkillList.prototype.processOk;
    Window_SkillList.prototype.processOk = function () {
        if (this._stypeId === "levelup" || !this.isHandled('skillaction')) {
            _Window_SkillList_processOk.call(this);
            return;
        }
        SoundManager.playOk();
        this.updateInputData();
        this.deactivate();
        this.callHandler('skillaction');
    };

    // --- Help window ---

    const _Window_SkillList_updateHelp = Window_SkillList.prototype.updateHelp;
    Window_SkillList.prototype.updateHelp = function () {
        if (this._skillInfoWindow) {
            this._skillInfoWindow.setItem(this.item());
        }
        _Window_SkillList_updateHelp.call(this);
    };

    Window_SkillList.prototype._setHelpText = function (text) {
        if (this._helpWindow) this._helpWindow.setText(text);
    };

    //=============================================================================
    // Window_SkillAction ,  context popup: Use / Carry-Bench / Cancel
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
        if (!BattleLoadout.isAlwaysCarried(this._actor, this._skill)) {
            const carried = BattleLoadout.isActive(this._actor, this._skill);
            this.addCommand(carried ? T('SkillsMenu.cmd.bench') : T('SkillsMenu.cmd.carry'), "loadout", true);
        }
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
