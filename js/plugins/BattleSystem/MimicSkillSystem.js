/*:
 * @target MZ
 * @plugindesc Mimic Class Skill System v1.0.0, note-tag driven transformation skills
 * @author Omni-Lex
 * @orderAfter BattleSystemEnhanced
 * @orderAfter Health_Core
 * @orderAfter CharacterCreationCreature
 * @orderAfter EnemyTalkSystem
 * @orderAfter BattleSystemActiveSkills
 *
 * @help MimicSkillSystem.js
 *
 * Adds six mimic skills triggered by note tags placed in the Notes field
 * of skill entries in the RPG Maker database. There must be exactly 1 enemy
 * in battle (by project design).
 *
 * SKILL NOTE TAGS:
 *   <MimicPartial>   , Copy enemy face/bust and world sprite. Stats/HP/MP/TP unchanged.
 *   <MimicFull>      , Full copy: stats, HP/MP/TP, skills, body archetype, and visuals.
 *   <MimicMirror>    , Re-execute the last skill used by the enemy against itself.
 *   <MimicCopyParty> , Copy a targeted ally's name, class, skills, sprite, and archetype.
 *                       Set skill scope to "Single Ally" in the database.
 *   <MimicRandom>    , Apply MimicFull using a randomly selected enemy from $dataEnemies.
 *   <MimicMutation>  , Randomly merge two archetypes into actor's body parts only.
 *
 * INTEGRATION:
 *   - Face/bust uses CustomBustFaceSystemjs.js variables 106-109, 117-118 and switches 77-79.
 *   - Body parts use Health_Core.js via window.changeArchetypeForActor.
 *   - Hybrid body parts mirror CharacterCreationCreature.js applyHybridArchetype.
 *   - Mirror Move uses standard MZ BattleManager.forceAction pipeline.
 *
 * License: Free for commercial and non-commercial use.
 */

(() => {
    'use strict';

    // =========================================================================
    // Module-level state
    // =========================================================================

    // Tracks the last skill ID used by any enemy this battle (for MimicMirror).
    let _lastEnemySkillId = null;

    // Reset mirror tracking at the start of each battle.
    const _BattleManager_startBattle = BattleManager.startBattle;
    BattleManager.startBattle = function () {
        _lastEnemySkillId = null;
        _BattleManager_startBattle.call(this);
    };

    // =========================================================================
    // Actor ID → variable/switch helpers
    // Confirmed against CustomBustFaceSystemjs.js
    // =========================================================================

    function getActorBattlerVarId(actorId) {
        return { 1: 106, 2: 107, 3: 108 }[actorId] || null;
    }

    function getActorBustVarId(actorId) {
        return { 1: 109, 2: 117, 3: 118 }[actorId] || null;
    }

    function getActorCreatureSwitch(actorId) {
        return { 1: 77, 2: 78, 3: 79 }[actorId] || null;
    }

    function getActorReproductionVarId(actorId) {
        return { 1: 87, 2: 115, 3: 116 }[actorId] || null;
    }

    // =========================================================================
    // Enemy data helpers
    // =========================================================================

    // Reads <Char:SpriteName> from enemy note tag, avoids BattleSystemEnhanced's private cache.
    function getEnemyCharSpriteName(enemyDataObj) {
        if (!enemyDataObj || !enemyDataObj.note) return null;
        const m = enemyDataObj.note.match(/<Char:\s*(.+?)>/i);
        return m ? m[1].trim() : null;
    }

    // Reads <Archetype:Name> from enemy note tag.
    function getEnemyArchetypeName(enemyDataObj) {
        if (!enemyDataObj || !enemyDataObj.note) return null;
        const m = enemyDataObj.note.match(/<Archetype:\s*(.+?)>/i);
        return m ? m[1].trim() : null;
    }

    // =========================================================================
    // Visual helpers
    // =========================================================================

    // Sets face/bust to creature mode (battler image) and updates world sprite.
    function applyPartialMimicVisuals(actor, battlerName, charSpriteName) {
        const actorId = actor.actorId();
        const battlerVarId = getActorBattlerVarId(actorId);
        const bustVarId = getActorBustVarId(actorId);
        const creatureSwitchId = getActorCreatureSwitch(actorId);

        // Clear bust variable so creature mode takes priority (loading order in CustomBustFaceSystemjs.js).
        if (bustVarId) $gameVariables.setValue(bustVarId, '');

        // Set battler variable and turn on creature switch.
        if (battlerVarId) $gameVariables.setValue(battlerVarId, battlerName || '');
        if (creatureSwitchId) $gameSwitches.setValue(creatureSwitchId, true);

        // Update world/map character sprite if the enemy has a <Char:...> tag.
        if (charSpriteName) {
            actor.setCharacterImage('Monsters/' + charSpriteName, 0);
            $gamePlayer.refresh();
        }

        $gameTemp.requestBattleRefresh();
    }

    // =========================================================================
    // Handler: Partial Mimic
    // Face + world sprite only. Stats/HP/MP/TP unchanged.
    // =========================================================================

    function applyMimicPartial(actor, liveEnemy) {
        const enemyData = liveEnemy.enemy();
        const battlerName = liveEnemy.battlerName();
        const charSpriteName = getEnemyCharSpriteName(enemyData);

        applyPartialMimicVisuals(actor, battlerName, charSpriteName);
    }

    // =========================================================================
    // Handler: Full Mimic
    // Complete transformation: stats, HP/MP/TP, skills, archetype, visuals.
    // liveEnemy is null when called from MimicRandom (no live battle instance).
    // =========================================================================

    function applyMimicFull(actor, enemyDataObj, liveEnemy) {
        if (!enemyDataObj) return;

        const actorId = actor.actorId();

        // 1. Save pre-mimic state for potential future reversal.
        actor._preMimicState = {
            name: actor.name(),
            classId: actor._classId,
            skills: actor._skills ? actor._skills.slice() : [],
            characterName: actor._characterName,
            characterIndex: actor._characterIndex,
            bustVarValue: $gameVariables.value(getActorBustVarId(actorId) || 0),
            battlerVarValue: $gameVariables.value(getActorBattlerVarId(actorId) || 0),
            creatureSwitch: $gameSwitches.value(getActorCreatureSwitch(actorId) || 0),
            archetypeName: actor._currentArchetype || null,
            mimicParamOverrides: actor._mimicParamOverrides
                ? actor._mimicParamOverrides.slice()
                : null,
        };

        // 2. Override base params (8 values: mhp, mmp, atk, def, mat, mdf, agi, luk).
        actor._mimicParamOverrides = enemyDataObj.params.slice(0, 8);

        // 3. Recalculate mhp/mmp from new paramBase before setting HP/MP.
        actor.refresh();

        // 4. Set HP/MP/TP to match the enemy's current values (clamped to new max).
        if (liveEnemy) {
            actor.setHp(Math.min(liveEnemy.hp, actor.mhp));
            actor.setMp(Math.min(liveEnemy.mp, actor.mmp));
            actor.setTp(liveEnemy.tp);
        } else {
            // Random transform: use full HP/MP.
            actor.setHp(actor.mhp);
            actor.setMp(actor.mmp);
            actor.setTp(0);
        }

        // 5. Apply archetype (body parts) first so action skills can overlay on top.
        const archetypeName = getEnemyArchetypeName(enemyDataObj);
        if (archetypeName &&
            window.Health &&
            window.Health.EnemyArchetypes &&
            window.Health.EnemyArchetypes[archetypeName] &&
            typeof window.changeArchetypeForActor === 'function') {
            window.changeArchetypeForActor(actor, archetypeName);
        }

        // 6. Copy enemy action skills (mirrors EnemyTalkSystem.copyEnemySkillsToActor).
        const currentSkills = actor.skills ? actor.skills().slice() : [];
        for (const skill of currentSkills) {
            if (skill.id !== actor.attackSkillId() && skill.id !== actor.guardSkillId()) {
                actor.forgetSkill(skill.id);
            }
        }
        const addedSkills = new Set();
        if (enemyDataObj.actions) {
            for (const action of enemyDataObj.actions) {
                if (action.skillId > 0 && !addedSkills.has(action.skillId)) {
                    actor.learnSkill(action.skillId);
                    addedSkills.add(action.skillId);
                }
            }
        }

        // 7. Apply visuals.
        const battlerName = enemyDataObj.battlerName || '';
        const charSpriteName = getEnemyCharSpriteName(enemyDataObj);
        applyPartialMimicVisuals(actor, battlerName, charSpriteName);
    }

    // =========================================================================
    // Handler: Mirror Move
    // Executes the last skill used by the enemy against itself.
    // =========================================================================

    function applyMimicMirror(actor) {
        if (!_lastEnemySkillId) {
            return;
        }

        const enemy = $gameTroop.members()[0];
        if (!enemy || !enemy.isAlive()) {
            return;
        }

        // Verify skill still exists.
        if (!$dataSkills[_lastEnemySkillId]) {
            return;
        }

        // Queue a forced action targeting the first enemy (index 0).
        actor.forceAction(_lastEnemySkillId, 0);
        BattleManager.forceAction(actor);
    }

    // =========================================================================
    // Handler: Copy Party
    // Copies a targeted ally's identity. Requires skill scope = Single Ally.
    // =========================================================================

    function applyMimicCopyParty(actor, target) {
        if (!target || !target.isActor() || target === actor) {
            return;
        }

        const targetId = target.actorId();

        // 1. Copy name and class.
        actor.setName(target.name());
        actor.changeClass(target._classId, false);

        // 2. Replace skills.
        actor.skills().slice().forEach(s => actor.forgetSkill(s.id));
        target.skills().forEach(s => actor.learnSkill(s.id));

        // 3. Copy world sprite.
        actor.setCharacterImage(target._characterName, target._characterIndex);

        // 4. Copy bust/face. Disable creature switch so bust variable takes priority.
        const targetBustVarId = getActorBustVarId(targetId);
        const actorBustVarId = getActorBustVarId(actor.actorId());
        if (targetBustVarId && actorBustVarId) {
            $gameVariables.setValue(actorBustVarId, $gameVariables.value(targetBustVarId));
        }
        const actorBattlerVarId = getActorBattlerVarId(actor.actorId());
        if (actorBattlerVarId) $gameVariables.setValue(actorBattlerVarId, '');
        const actorCreatureSwitchId = getActorCreatureSwitch(actor.actorId());
        if (actorCreatureSwitchId) $gameSwitches.setValue(actorCreatureSwitchId, false);

        // 5. Copy archetype/body parts.
        const archetypeName = target._currentArchetype;
        if (archetypeName &&
            window.Health &&
            window.Health.EnemyArchetypes &&
            window.Health.EnemyArchetypes[archetypeName] &&
            typeof window.changeArchetypeForActor === 'function') {
            window.changeArchetypeForActor(actor, archetypeName);
        }

        $gamePlayer.refresh();
        $gameTemp.requestBattleRefresh();
        actor.refresh();
    }

    // =========================================================================
    // Handler: Random Transform
    // Applies MimicFull using a random enemy from $dataEnemies.
    // =========================================================================

    function applyMimicRandom(actor) {
        const pool = ($dataEnemies || []).filter(e => e && e.name && e.name.trim() !== '');
        if (pool.length === 0) {
            return;
        }

        const picked = pool[Math.floor(Math.random() * pool.length)];
        applyMimicFull(actor, picked, null);
    }

    // =========================================================================
    // Handler: Random Mutation
    // Merges two random archetypes into actor's body parts only.
    // Face, world sprite, and stats are unchanged.
    // Mirrors CharacterCreationCreature.js applyHybridArchetype exactly.
    // =========================================================================

    function applyMimicMutation(actor) {
        const { EnemyArchetypes } = window.Health || {};
        if (!EnemyArchetypes) {
            return;
        }

        const keys = Object.keys(EnemyArchetypes);
        if (keys.length < 2) {
            return;
        }

        // Pick two distinct random archetypes.
        const idx1 = Math.floor(Math.random() * keys.length);
        let idx2;
        do { idx2 = Math.floor(Math.random() * keys.length); } while (idx2 === idx1);

        const key1 = keys[idx1];
        const key2 = keys[idx2];
        const arch1 = EnemyArchetypes[key1];
        const arch2 = EnemyArchetypes[key2];

        // Merge parts, arch2 overrides arch1 for duplicate part keys (arch2 is dominant).
        const mergedParts = Object.assign({}, arch1.parts, arch2.parts);

        // Clear existing body parts and stat modifiers.
        actor._statModifiers = {};
        actor._bodyParts = {};
        actor._currentArchetype = `${key1} / ${key2}`;

        // Build body parts with hpPercent scaling against actor's current mhp.
        const getArchText = (typeof window.getArchetypeText === 'function')
            ? window.getArchetypeText.bind(window)
            : (v) => v;

        for (const partKey in mergedParts) {
            const p = mergedParts[partKey];
            const maxHp = Math.round(actor.mhp * ((p.hpPercent || 10) / 100));
            actor._bodyParts[partKey] = {
                name: getArchText(p.name) || p.name || partKey,
                maxHp,
                currentHp: maxHp,
                vital: false,
                damaged: false,
                canCutoff: p.canCutoff || false,
                statEffect: p.statEffect || null,
                damageMsg: getArchText(p.msg) || p.msg || '',
                specialEffect: p.specialEffect || null,
                appliedStatEffect: false,
                skillId: p.skillId || [],
                hpPercent: p.hpPercent || 10,
            };
        }

        // Set reproduction variable from arch2 (dominant archetype).
        const reproVarId = getActorReproductionVarId(actor.actorId());
        if (reproVarId && $gameVariables) {
            const reproVal = arch2.reproduction !== undefined ? arch2.reproduction : 0;
            $gameVariables.setValue(reproVarId, reproVal);
        }

        // Grant type-based body-part skills (Mouth/Hands/Eyes/Feet) for the
        // newly merged body.
        if (window.HealthCore && window.HealthCore.ensureBodyPartSkills) {
            window.HealthCore.ensureBodyPartSkills(actor);
        }

        actor.refresh();
    }

    // =========================================================================
    // paramBase override, enables Full Mimic stat replacement
    // Placed at paramBase so Health_Core's param-level modifiers still apply on top.
    // =========================================================================

    const _Game_Actor_paramBase_mimic = Game_Actor.prototype.paramBase;
    Game_Actor.prototype.paramBase = function (paramId) {
        if (this._mimicParamOverrides && this._mimicParamOverrides[paramId] !== undefined) {
            return this._mimicParamOverrides[paramId];
        }
        return _Game_Actor_paramBase_mimic.call(this, paramId);
    };

    // =========================================================================
    // Game_Action.prototype.apply, main dispatcher
    // Runs after standard effect resolution.
    // =========================================================================

    const _Game_Action_apply_mimic = Game_Action.prototype.apply;
    Game_Action.prototype.apply = function (target) {
        _Game_Action_apply_mimic.call(this, target);

        const subject = this.subject();
        if (!this.isSkill()) return;

        const item = this.item();
        if (!item) return;

        // Track last enemy skill for MimicMirror (runs regardless of subject type).
        if (subject.isEnemy()) {
            _lastEnemySkillId = item.id;
        }

        // Dispatch mimic skills for actor subjects only.
        if (!subject.isActor()) return;

        const note = item.note || '';

        if (note.match(/<MimicPartial>/i)) {
            const enemy = $gameTroop.members()[0];
            if (enemy && enemy.isAlive()) {
                applyMimicPartial(subject, enemy);
            }
        } else if (note.match(/<MimicFull>/i)) {
            const enemy = $gameTroop.members()[0];
            if (enemy && enemy.isAlive()) {
                applyMimicFull(subject, enemy.enemy(), enemy);
            }
        } else if (note.match(/<MimicMirror>/i)) {
            applyMimicMirror(subject);
        } else if (note.match(/<MimicCopyParty>/i)) {
            applyMimicCopyParty(subject, target);
        } else if (note.match(/<MimicRandom>/i)) {
            applyMimicRandom(subject);
        } else if (note.match(/<MimicMutation>/i)) {
            applyMimicMutation(subject);
        }
    };

})();
