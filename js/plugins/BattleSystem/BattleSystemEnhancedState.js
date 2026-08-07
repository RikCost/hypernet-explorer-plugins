// ============================================================================
// Battle System Enhanced - Persistent Battles & Rewards
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0 State module: persistent HP, rewards, corpses, battle flow.
 * @author Combined by Claude, modified by OmniLex
 * @pluginName BattleSystemEnhancedState
 *
 * @help
 * ============================================================================
 * BattleSystemEnhancedState, Sub-module
 * ============================================================================
 *
 * Requires BattleSystemEnhanced.js (Core) and 
 * BattleSystemEnhancedEncounters.js to be loaded first.
 *
 * Manages persistent enemy HP tracking, battle reward popups,
 * enemy part damage synchronization, corpse sprite rendering,
 * and post-battle state cleanup (event deletion/locking, cooldowns).
 *
 * Loading order:
 *   1. BattleSystemEnhanced.js (Core)
 *   2. BattleSystemEnhancedEncounters.js
 *   3. BattleSystemEnhancedState.js (THIS PLUGIN)
 *   4. BattleSystemEnhancedDeath.js
 *   5. BattleSystemEnhancedMechanics.js
 *   6. BattleSystemEnhancedLevelDisplay.js
 */

(() => {
    'use strict';

    if (!window.BattleSystemEnhanced) {
        console.error('BattleSystemEnhancedState: Core plugin not loaded!');
        return;
    }
    const BSE = window.BattleSystemEnhanced;

    // ========================================================================
    // 1. SHARED MODULE STATE
    // ========================================================================

    let _lastSpawnedMapId = null;
    // The procedural map (636) reuses the same map ID across edge transitions,
    // so _lastSpawnedMapId alone can't detect moving between proc regions. Track
    // the proc-gen region identity (origin + layer depth + which biome) separately
    // so stale corpses/part-damage are cleared when the region actually changes.
    let _lastProcRegionKey = null;
    const BATTLE_COOLDOWN_FRAMES = 120;
    let _battleCooldownTimer = 0;
    let _battleTurnCount = 0;

    const PROC_MAP_ID = 636;
    const _procRegionKey = function() {
        const pg = $gameSystem && $gameSystem._procGenData;
        if (!pg) return null;
        const depth = (pg.biomeLayerStack && pg.biomeLayerStack.length) || 0;
        // A structure biome entered through a terrain feature (LootCellar, Sewer,
        // Crypt, CaveDen, TempleInside, PatronVault, a sandbox Dungeon) is built by
        // startForcedBiome as a fresh depth-0 map on the SAME world square, so
        // origin + depth alone reads identical to the surface it was entered from
        // and back again. The biome name and the entrance salt tell them apart.
        const session = pg._dungeonSession;
        const salt = session ? `${session.type || ''}:${session.salt || 0}` : '';
        return `${pg.originX},${pg.originY},${depth},${pg.currentBiome || ''},${salt}`;
    };

    // Corpses and the transient part-damage snapshot decorate the map the fight
    // happened on. Clear them in place so BSE.Data keeps holding the same
    // references the accessors were seeded with.
    const _clearMapCorpses = function() {
        BSE.State.mapCorpses.length = 0;
        const pd = BSE.State.enemyPartDamage;
        for (const key in pd) delete pd[key];
    };

    // _lastSpawnedMapId is module-scoped, so it survives across a new game or a
    // load. Reset it on both so the first Scene_Map.start after starting/loading
    // always spawns enemies (otherwise loading a save on the last-spawned map
    // would skip spawning until you leave and return).
    const _DM_setupNewGame_lastSpawn = DataManager.setupNewGame;
    DataManager.setupNewGame = function() {
        _lastSpawnedMapId = null;
        _lastProcRegionKey = null;
        _DM_setupNewGame_lastSpawn.call(this);
    };
    const _DM_extractSaveContents_lastSpawn = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _lastSpawnedMapId = null;
        _lastProcRegionKey = null;
        _DM_extractSaveContents_lastSpawn.call(this, contents);
    };

    // ========================================================================
    // 2. Game_System - Battle State Storage
    // ========================================================================

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        this._battleEnded = false;
        this._actor1Died = false;
        this._actor2Died = false;
        this._actor3Died = false;
        this._actor2Name = "";
        this._actor3Name = "";
        // Queues, not single slots: a battle can settle several map events at
        // once now that nearby monsters join a fight.
        this._eventsToDelete = [];
        this._eventsToLock = [];
        this._deathData = null;
        this._battleCooldownTimer = 0;
    };

    Game_System.prototype.setBattleCooldown = function(frames) { this._battleCooldownTimer = frames; };
    Game_System.prototype.getBattleCooldown = function() { return this._battleCooldownTimer || 0; };
    Game_System.prototype.updateBattleCooldown = function() {
        if (this._battleCooldownTimer > 0) this._battleCooldownTimer--;
    };
    Game_System.prototype.setBattleEnded = function(value) { this._battleEnded = value; };
    Game_System.prototype.isBattleEnded = function() { return this._battleEnded; };
    Game_System.prototype.setFullPartyWipe = function(value) { this._fullPartyWipe = value; };
    Game_System.prototype.isFullPartyWipe = function() { return this._fullPartyWipe; };
    Game_System.prototype.setActor1Died = function(value) { this._actor1Died = value; };
    Game_System.prototype.isActor1Died = function() { return this._actor1Died; };
    Game_System.prototype.setActor2Died = function(value, name) { this._actor2Died = value; this._actor2Name = name || ""; };
    Game_System.prototype.isActor2Died = function() { return this._actor2Died; };
    Game_System.prototype.getActor2Name = function() { return this._actor2Name; };
    Game_System.prototype.setActor3Died = function(value, name) { this._actor3Died = value; this._actor3Name = name || ""; };
    Game_System.prototype.isActor3Died = function() { return this._actor3Died; };
    Game_System.prototype.getActor3Name = function() { return this._actor3Name; };
    // A battle can end owing the map more than one event: the monster that
    // started it plus every roamer that joined in. Both lists are queues, and
    // the map drains the entries that belong to it once the fight is over.
    const queueEvent = (list, mapId, eventId) => {
        if (!list.some(e => e.mapId === mapId && e.eventId === eventId)) {
            list.push({ mapId, eventId });
        }
    };
    // A save written before the queues existed carries a single pending entry
    // in the old slot; fold it in the first time the queue is read.
    Game_System.prototype.getEventsToDelete = function() {
        if (!this._eventsToDelete) {
            this._eventsToDelete = this._eventToDelete ? [this._eventToDelete] : [];
            this._eventToDelete = null;
        }
        return this._eventsToDelete;
    };
    Game_System.prototype.getEventsToLock = function() {
        if (!this._eventsToLock) {
            this._eventsToLock = this._eventToLock ? [this._eventToLock] : [];
            this._eventToLock = null;
        }
        return this._eventsToLock;
    };
    Game_System.prototype.setEventToDelete = function(mapId, eventId) {
        queueEvent(this.getEventsToDelete(), mapId, eventId);
    };
    Game_System.prototype.clearEventsToDelete = function() { this._eventsToDelete = []; };
    Game_System.prototype.setEventToLock = function(mapId, eventId) {
        queueEvent(this.getEventsToLock(), mapId, eventId);
    };
    Game_System.prototype.clearEventsToLock = function() { this._eventsToLock = []; };
    Game_System.prototype.setDeathData = function(data) { this._deathData = data; };
    Game_System.prototype.getDeathData = function() { return this._deathData; };
    Game_System.prototype.clearDeathData = function() { this._deathData = null; };

    // ========================================================================
    // 3. BattleManager - Setup & Start
    // ========================================================================

    const _BattleManager_setup = BattleManager.setup;
    BattleManager.setup = function(troopId, canEscape, canLose) {
        _BattleManager_setup.call(this, troopId, canEscape, canLose);

        // Apply wet status if battle starts on water tile. A title-launched arena
        // (or a save loaded straight into battle) can have $gameMap._mapId set while
        // $dataMap was never streamed in, so guard against the null map data too or
        // terrainTag()/regionId() dereference null and throw.
        if ($gameMap && $gameMap._mapId && $dataMap && typeof $dataMap.width === 'number') {
            const playerX = $gamePlayer.x;
            const playerY = $gamePlayer.y;
            const terrainTag = $gameMap.terrainTag(playerX, playerY);
            const regionId = $gameMap.regionId(playerX, playerY);
            const isWaterTile = (terrainTag === 3 || regionId === 99);
            if (isWaterTile) {
                for (let i = 0; i < $gameParty.members().length; i++) {
                    $gameParty.members()[i].addState(28);
                }
                for (let i = 0; i < $gameTroop.members().length; i++) {
                    $gameTroop.members()[i].addState(28);
                }
            }
        }
    };

    const _BattleManager_update = BattleManager.update;
    BattleManager.update = function() {
        _BattleManager_update.apply(this, arguments);
        if (this._phase === 'action' || this._phase === 'turn') {
            // checkActorDeaths() only flips one-way death latches (idempotent),
            // and the exact turn boundary is already caught by the endTurn hook.
            // Poll a few times per second instead of every frame to avoid a
            // per-frame $gameParty.members() allocation; the latency is invisible.
            this._bseDeathPollTick = (this._bseDeathPollTick || 0) + 1;
            if (this._bseDeathPollTick >= 10) {
                this._bseDeathPollTick = 0;
                this.checkActorDeaths();
            }
        }
    };

    // ========================================================================
    // 4. BattleManager - Display & Message Overrides
    // ========================================================================

    BattleManager.displayStartMessages = function() {
        _battleTurnCount = 0;
    };

    BattleManager.displayEscapeFailureMessage = function() {};
    BattleManager.displayEscapeSuccessMessage = function() {};
    BattleManager.displayVictoryMessage = function() {};

    const _BattleManager_makeEscapeRatio = BattleManager.makeEscapeRatio;
    BattleManager.makeEscapeRatio = function() {
        _BattleManager_makeEscapeRatio.call(this);
        if (_battleTurnCount <= 1) this._escapeRatio = 1.0;
    };

    const _BattleManager_makeRewards = BattleManager.makeRewards;
    BattleManager.makeRewards = function() {
        _BattleManager_makeRewards.call(this);
        const r = BSE.State.battleRewards;
        r.exp = this._rewards.exp || 0;
        r.gold = this._rewards.gold || 0;
        r.items = this._rewards.items ? this._rewards.items.slice() : [];
    };

    // Knowledge from a win is priced by how far above the party the troop was,
    // on the shared curve in SkillMaster (window.KnowledgePoints), so a fight and
    // the contract that asked for it pay on the same scale. The old formula read
    // only the single strongest enemy and used a flat level *difference*, which
    // ignored troop size and never scaled with the party's own level: at level 5
    // a +20 enemy paid 20 KP, at level 60 the same relative threat paid 60.
    const _BattleManager_processVictory = BattleManager.processVictory;
    BattleManager.processVictory = function() {
        const party = $gameParty.members();
        if (party.length && $gameTroop && $gameTroop.members().length && window.KnowledgePoints) {
            const partyMedian = BSE.Helpers.getMedianLevel(party);
            const enemyLevels = $gameTroop.members().map(e => {
                const data = $dataEnemies[e.enemyId()];
                return data ? BSE.Helpers.getEnemyLevel(data.note) : 0;
            });
            const knowledge = window.KnowledgePoints.forEncounter(enemyLevels, partyMedian);
            if (knowledge > 0) {
                $gameSystem.addKnowledge(knowledge);
                BSE.State.battleRewards.knowledge = knowledge;
            }
        }
        _BattleManager_processVictory.call(this);
    };

    const _BattleManager_startTurn = BattleManager.startTurn;
    BattleManager.startTurn = function() {
        _BattleManager_startTurn.call(this);
        _battleTurnCount++;
    };

    const _BattleManager_endTurn = BattleManager.endTurn;
    BattleManager.endTurn = function() {
        this.checkActorDeaths();
        _BattleManager_endTurn.call(this);
    };

    BattleManager.displayRewards = function() {
        this.gainRewards();
    };

    // ========================================================================
    // 5. BattleManager - Actor Death Detection
    // ========================================================================

    BattleManager.checkActorDeaths = function() {
        let deathOccurred = false;
        const members = $gameParty.members();
        if (members[0] && members[0].isDead() && !$gameSystem.isActor1Died()) {
            $gameSystem.setActor1Died(true);
            deathOccurred = true;
        }
        if (members[1] && members[1].isDead() && !$gameSystem.isActor2Died()) {
            $gameSystem.setActor2Died(true, members[1].name());
            deathOccurred = true;
        }
        if (members[2] && members[2].isDead() && !$gameSystem.isActor3Died()) {
            $gameSystem.setActor3Died(true, members[2].name());
            deathOccurred = true;
        }
        return deathOccurred;
    };

    BattleManager.processActor1Death = function() {
        if ($gameSwitches.value(9)) {
            // Save death data is handled in BattleSystemEnhancedDeath.js
            $gameSwitches.setValue(34, true);
            // The leader is never removed from the party, so the roster-history
            // hook in NPCSystemParty.js would never see this death: log it here
            // for the Dynamics menu's History page.
            window.PartyRoster?.recordDeath?.($gameParty.members()[0]);
        }
        BSE.State.needsRespawn = true;
        if (BSE.State.currentMapId && BSE.State.currentEventId) {
            $gameSystem.setEventToDelete(BSE.State.currentMapId, BSE.State.currentEventId);
        }
        this._escaped = true;
        this.updateBattleEnd();
    };

    BattleManager.processDefeat = function() {
        const _tutorialMaps = [1414, 1415, 1416, 1417];
        const inTutorial = $gameSwitches.value(75) && _tutorialMaps.includes($gameMap.mapId());
        AudioManager.stopBgm();
        if ($gameSwitches.value(9) && !inTutorial) {
            // Permadeath ON: save death data
            $gameSwitches.setValue(34, true);
            // Whole party down for good: every fallen member gets a date of
            // death in the roster history (Dynamics -> History).
            $gameParty.members().forEach(actor => {
                if (actor.isDead()) window.PartyRoster?.recordDeath?.(actor);
            });
        }
        $gameSystem.setActor1Died(true);
        $gameSystem.setFullPartyWipe(true);
        BSE.State.needsRespawn = true;
        const actor1 = $gameParty.members()[0];
        if (actor1) actor1.recoverAll();
        this._escaped = true;
        this.updateBattleEnd();
    };

    // ========================================================================
    // 6. BattleManager - Battle End & Persistent HP
    // ========================================================================

    const _BattleManager_updateBattleEnd = BattleManager.updateBattleEnd;
    BattleManager.updateBattleEnd = function() {
        const partyStates = $gameParty.members().map(actor => ({
            actor, isDead: actor.isDead(), actorId: actor.actorId(), name: actor.name()
        }));
        _BattleManager_updateBattleEnd.call(this);
        if (this._escaped || $gameParty.isAllDead() || $gameTroop.isAllDead()) {
            $gameSystem.setBattleEnded(true);
            partyStates.forEach((state, index) => {
                if (state.isDead) {
                    if (index === 0) $gameSystem.setActor1Died(true);
                    else if (index === 1) $gameSystem.setActor2Died(true, state.name);
                    else if (index === 2) $gameSystem.setActor3Died(true, state.name);
                }
            });
        }
    };

    const _BattleManager_endBattle = BattleManager.endBattle;
    BattleManager.endBattle = function(result) {
        const members = $gameParty.members();
        members.forEach((actor, index) => {
            if (actor.isDead()) {
                if (index === 0 && !$gameSystem.isActor1Died()) $gameSystem.setActor1Died(true);
                else if (index === 1 && !$gameSystem.isActor2Died()) $gameSystem.setActor2Died(true, actor.name());
                else if (index === 2 && !$gameSystem.isActor3Died()) $gameSystem.setActor3Died(true, actor.name());
            }
        });

        const pData = BSE.State.persistentEnemyData;
        const bId = BSE.State.currentBattleEventId;
        const eId = BSE.State.currentEventId;
        const mId = BSE.State.currentMapId;

        // Monsters that piled in from nearby (see startPersistentBattle). Their
        // map events are settled exactly the way the triggering one is: wiped on
        // a win or a recruit, locked with their HP kept on a flee.
        const reinforcement = BSE.Helpers.getReinforcement();
        const joined = reinforcement.joined;
        const baseSize = reinforcement.baseSize;

        // Mark a joined monster's event the way a defeated trigger event is
        // marked: deleted from the map, and remembered as defeated on the
        // procedural map so it does not come back with the next spawn pass.
        const clearJoinedEvent = j => {
            delete pData[j.persistentId];
            $gameSystem.setEventToDelete(j.mapId, j.eventId);
            if ($gameMap.mapId() === 636) {
                if (!$gameSystem._procGenDefeatedEnemies) $gameSystem._procGenDefeatedEnemies = [];
                if (!$gameSystem._procGenDefeatedEnemies.includes(j.eventId)) {
                    $gameSystem._procGenDefeatedEnemies.push(j.eventId);
                }
            }
        };

        // An event whose monsters are all off the field is settled the way a
        // defeated one is, whatever ended the battle: they are dead, or they
        // walked away with the party (recruited as allies or pets, hidden by
        // EnemyTalkSystem). Anything of it still standing and the event is
        // locked instead, with its wounds written back. Read per event rather
        // than per battle, since one monster of a pack can be talked round
        // while the rest keep fighting.
        const eventCleared = indexes => indexes.every(i => {
            const enemy = $gameTroop.members()[i];
            return !enemy || !enemy.isAlive();
        });

        if (result === 1 && bId) { // Fled, or a recruit that emptied the field
            const baseIndexes = [];
            for (let i = 0; i < baseSize; i++) baseIndexes.push(i);
            if (eventCleared(baseIndexes)) {
                delete pData[bId];
                $gameSystem.setEventToDelete(mId, eId);
                if ($gameMap.mapId() === 636) {
                    if (!$gameSystem._procGenDefeatedEnemies) $gameSystem._procGenDefeatedEnemies = [];
                    if (!$gameSystem._procGenDefeatedEnemies.includes(eId)) {
                        $gameSystem._procGenDefeatedEnemies.push(eId);
                    }
                }
            } else {
                const persistentData = pData[bId] || { enemyHp: {} };
                // Only the troop that started the fight belongs to this event's
                // record; the members past it came from the joining events and are
                // written back to their own records below.
                $gameTroop.members().forEach((enemy, index) => {
                    if (index < baseSize) persistentData.enemyHp[index] = enemy.hp;
                });
                pData[bId] = persistentData;
                $gameSystem.setEventToLock(mId, eId);
            }
            joined.forEach(j => {
                if (eventCleared(j.memberIndexes)) {
                    clearJoinedEvent(j);
                    return;
                }
                const jData = pData[j.persistentId] || { enemyHp: {} };
                j.memberIndexes.forEach((troopIndex, i) => {
                    const enemy = $gameTroop.members()[troopIndex];
                    if (enemy) jData.enemyHp[i] = enemy.hp;
                });
                pData[j.persistentId] = jData;
                $gameSystem.setEventToLock(j.mapId, j.eventId);
            });
            // Clear rewards: the party did not win this fight.
            const r = BSE.State.battleRewards;
            r.exp = 0; r.gold = 0; r.items = []; r.knowledge = 0;
        } else if (result === 0 && bId) { // Win
            // Capture corpse data. `troopIndex` is where in the battle troop
            // that event's own lead monster stood, so a joined event leaves a
            // corpse for the creature that actually fell there.
            const dropCorpse = (evMapId, evId, troopIndex) => {
                if (!evId || !evMapId) return;
                const deadEvent = $gameMap.event(evId);
                if (!deadEvent || !deadEvent._characterName) return;
                const deadTroop = deadEvent._fixedTroopId ? $dataTroops[deadEvent._fixedTroopId] : null;
                const deadEnemy = (deadTroop && deadTroop.members.length > 0)
                    ? $dataEnemies[deadTroop.members[0].enemyId] : null;
                const troopMember = $gameTroop && $gameTroop.members()[troopIndex];
                const enemyEscaped = troopMember && troopMember.hp > 0;
                if (enemyEscaped) return;
                BSE.State.mapCorpses.push({
                    mapId: evMapId,
                    x: deadEvent.x,
                    y: deadEvent.y,
                    spriteName: deadEvent._characterName,
                    spriteIndex: deadEvent._characterIndex,
                    hue: deadEvent._characterHue || 0,
                    bloodColor: getCorpseBloodColor(deadEnemy),
                    enemyId: (deadTroop && deadTroop.members[0]) ? deadTroop.members[0].enemyId : 0
                });
            };
            dropCorpse(mId, eId, 0);
            joined.forEach(j => dropCorpse(j.mapId, j.eventId, j.memberIndexes[0]));

            if (pData[bId]) delete pData[bId];
            $gameSystem.setEventToDelete(mId, eId);
            if ($gameMap.mapId() === 636) {
                if (!$gameSystem._procGenDefeatedEnemies) $gameSystem._procGenDefeatedEnemies = [];
                if (!$gameSystem._procGenDefeatedEnemies.includes(eId)) {
                    $gameSystem._procGenDefeatedEnemies.push(eId);
                }
            }
            joined.forEach(clearJoinedEvent);
        }

        saveEnemyPartDamage();
        $gameSystem.setBattleEnded(true);
        BSE.State.currentBattleEventId = null;
        BSE.State.reinforcement = null;

        _BattleManager_endBattle.call(this, result);
    };

    // Enemy max HP multiplier applied when a lone actor enters battle.
    // A solo party brings roughly 1/3 the firepower, so trim enemy bulk to match.
    const SOLO_ENEMY_HP_MULT = 0.66;

    const _Game_Troop_setup = Game_Troop.prototype.setup;
    Game_Troop.prototype.setup = function(troopId) {
        _Game_Troop_setup.call(this, troopId);

        const bId = BSE.State.currentBattleEventId;
        const pData = BSE.State.persistentEnemyData;
        const storedHp = (bId && pData[bId]) ? pData[bId].enemyHp : null;

        // Debuff enemy max HP for a lone party member. Applied before restoring
        // persistent HP so stored values (already in debuffed scale) clamp correctly.
        if ($gameParty.battleMembers().length <= 1 && SOLO_ENEMY_HP_MULT < 1) {
            this.members().forEach((enemy, index) => {
                const penalty = Math.round(enemy.mhp * (1 - SOLO_ENEMY_HP_MULT));
                if (penalty <= 0) return;
                enemy.addParam(0, -penalty);
                // Fresh enemies (no persisted HP) start at the new full HP.
                if (!storedHp || storedHp[index] === undefined) {
                    enemy.setHp(enemy.mhp);
                }
            });
        }

        if (storedHp) {
            this.members().forEach((enemy, index) => {
                if (storedHp[index] !== undefined) enemy.setHp(storedHp[index]);
            });
        }

        // Monsters that joined from nearby (see startPersistentBattle) carry the
        // wounds their own map event was left with, read from that event's own
        // persistent record rather than the one the battle is keyed on.
        const reinforcement = BSE.Helpers.getReinforcement();
        if (reinforcement.troopId === troopId) {
            reinforcement.joined.forEach(j => {
                const jHp = pData[j.persistentId] && pData[j.persistentId].enemyHp;
                if (!jHp) return;
                j.memberIndexes.forEach((troopIndex, i) => {
                    const enemy = this.members()[troopIndex];
                    if (enemy && jHp[i] !== undefined) enemy.setHp(jHp[i]);
                });
            });
        }
    };

    const _Game_Enemy_die = Game_Enemy.prototype.die;
    Game_Enemy.prototype.die = function() {
        _Game_Enemy_die.call(this);
        const bId = BSE.State.currentBattleEventId;
        const pData = BSE.State.persistentEnemyData;
        if (bId && pData[bId]) {
            const index = $gameTroop.members().indexOf(this);
            // Indexes past the base troop belong to the monsters that joined the
            // fight, not to this event's own record.
            const baseSize = BSE.Helpers.getReinforcement().baseSize;
            if (index >= 0 && index < baseSize) pData[bId].enemyHp[index] = 0;
        }
    };

    const _Spriteset_Battle_isBusy = Spriteset_Battle.prototype.isBusy;
    Spriteset_Battle.prototype.isBusy = function() {
        if (_Spriteset_Battle_isBusy.call(this)) return true;
        if (this._enemySprites) {
            return this._enemySprites.some(sprite => sprite.isEffecting && sprite.isEffecting());
        }
        return false;
    };

    // ========================================================================
    // 7. Enemy Part Damage Syncing
    // ========================================================================
    // partData (BSE.State.enemyPartDamage, keyed by enemyId) is a transient
    // snapshot consumed by corpse harvesting (ContainerSystemUI) right after a
    // kill - fine to share across enemies of the same species since only the
    // just-defeated one is read before the next death overwrites it.
    // Living, still-roaming map enemies must NOT restore from that shared-by-id
    // table (two different map events of the same enemyId would bleed damage
    // into each other). Instead their body-part state rides along with the
    // same per-instance persistentEnemyData record (keyed by "mapId_eventId")
    // that already tracks their HP across flee/re-encounter.

    function saveEnemyPartDamage() {
        if (!$gameTroop) return;
        const partData = BSE.State.enemyPartDamage;
        const bId = BSE.State.currentBattleEventId;
        const pData = BSE.State.persistentEnemyData;
        const instanceParts = (bId && pData[bId]) ? {} : null;
        $gameTroop.members().forEach(function(enemy, index) {
            if (!enemy._bodyParts) return;
            const parts = {};
            for (const key in enemy._bodyParts) {
                const p = enemy._bodyParts[key];
                parts[key] = {
                    currentHp: p.currentHp, maxHp: p.maxHp,
                    destroyed: p.destroyed, appliedStatEffect: p.appliedStatEffect
                };
            }
            const record = {
                parts,
                statModifiers: Object.assign({}, enemy._statModifiers || {}),
                disabledActions: (enemy._disabledActions || []).slice(),
                archetypeName: enemy._archetypeName || null,
                def: enemy.def || 0
            };
            partData[enemy.enemyId()] = record;
            if (instanceParts) instanceParts[index] = record;
        });
        if (instanceParts) pData[bId].bodyParts = instanceParts;
    }

    function restoreEnemyPartDamage() {
        if (!$gameTroop) return;
        const bId = BSE.State.currentBattleEventId;
        const pData = BSE.State.persistentEnemyData;
        const saved = bId && pData[bId] && pData[bId].bodyParts;
        if (!saved) return;
        $gameTroop.members().forEach(function(enemy, index) {
            const s = saved[index];
            if (!s || !enemy._bodyParts) return;
            for (const key in s.parts) {
                if (enemy._bodyParts[key]) {
                    const sp = s.parts[key];
                    enemy._bodyParts[key].currentHp = sp.currentHp;
                    enemy._bodyParts[key].maxHp = sp.maxHp;
                    enemy._bodyParts[key].destroyed = sp.destroyed;
                    enemy._bodyParts[key].appliedStatEffect = sp.appliedStatEffect;
                }
            }
            if (!enemy._statModifiers) enemy._statModifiers = {};
            Object.assign(enemy._statModifiers, s.statModifiers);
            if (enemy._disabledActions) {
                s.disabledActions.forEach(a => {
                    if (!enemy._disabledActions.includes(a)) enemy._disabledActions.push(a);
                });
            }
            enemy.refresh();
        });
    }

    const _BattleManager_startBattle_PartRestore = BattleManager.startBattle;
    BattleManager.startBattle = function() {
        _BattleManager_startBattle_PartRestore.call(this);
        restoreEnemyPartDamage();
    };

    // ========================================================================
    // 8. Corpse Sprite System
    // ========================================================================

    function getCorpseBloodColor(enemyData) {
        const hexToRgb = hex => {
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [220, 20, 20];
        };
        const bsfxParams = PluginManager.parameters('BloodSplatterFX');
        const defaultHex = bsfxParams.defaultBloodColor || '#ff0000';
        const archetype = BSE.Helpers.getEnemyArchetype(enemyData);
        if (!archetype) return hexToRgb(defaultHex);
        try {
            const colorList = JSON.parse(bsfxParams.archetypeColors || '[]').map(s => JSON.parse(s));
            const match = colorList.find(ac => ac.archetype.toLowerCase() === archetype.toLowerCase());
            return hexToRgb(match ? match.color : defaultHex);
        } catch (_) {
            return hexToRgb(defaultHex);
        }
    }

    // Exposed so other modules (e.g. map enemy-vs-enemy deaths) can match blood colour
    BSE.Helpers.getCorpseBloodColor = getCorpseBloodColor;

    function Sprite_EnemyCorpse(data) {
        this.initialize(data);
    }

    Sprite_EnemyCorpse.prototype = Object.create(Sprite.prototype);
    Sprite_EnemyCorpse.prototype.constructor = Sprite_EnemyCorpse;

    Sprite_EnemyCorpse.prototype.initialize = function(data) {
        Sprite.prototype.initialize.call(this);
        this._data = data;
        this._isBigCharacter = ImageManager.isBigCharacter(data.spriteName);
        this.anchor.x = 0.5;
        this.anchor.y = 0.5;
        this.rotation = Math.PI / 2;
        this.z = 1;
        this.bitmap = ImageManager.loadCharacter(data.spriteName);
        this.bitmap.addLoadListener(this._onBitmapReady.bind(this));
    };

    Sprite_EnemyCorpse.prototype._onBitmapReady = function() {
        const bm = this.bitmap;
        const big = this._isBigCharacter;
        const pw = bm.width / (big ? 3 : 12);
        const ph = bm.height / (big ? 4 : 8);
        const idx = this._data.spriteIndex;
        const bx = big ? 0 : (idx % 4) * 3 * pw;
        const by = big ? 0 : Math.floor(idx / 4) * 4 * ph;
        this.setFrame(bx + pw, by, pw, ph);
        const [r, g, b] = this._data.bloodColor;
        this.setBlendColor([r, g, b, 160]);
    };

    Sprite_EnemyCorpse.prototype.update = function() {
        Sprite.prototype.update.call(this);
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        this.x = Math.round($gameMap.adjustX(this._data.x) * tw + tw / 2);
        this.y = Math.round($gameMap.adjustY(this._data.y) * th + th / 2);
    };

    const _Spriteset_Map_createCharacters = Spriteset_Map.prototype.createCharacters;
    Spriteset_Map.prototype.createCharacters = function() {
        _Spriteset_Map_createCharacters.call(this);
        this._corpseSprites = BSE.State.mapCorpses
            .filter(data => data.mapId === $gameMap.mapId())
            .map(data => {
                const sprite = new Sprite_EnemyCorpse(data);
                this._tilemap.addChild(sprite);
                return sprite;
            });
    };

    // A corpse belongs to the map it was killed on, and the list above is keyed by
    // map ID alone. On the procedural map (636) every region shares that ID, so a
    // body left in a sewer, dungeon, loot cellar or crypt was re-drawn at the same
    // tile of whatever was generated next. Wipe the list on EVERY transfer (door,
    // world map, proc edge crossing, goDown/goUp, a structure biome entered through
    // a terrain feature), which runs from Scene_Map.onMapLoaded before
    // createDisplayObjects builds the spriteset that reads it.
    const _Game_Player_performTransfer_BSEState = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        const wasTransferring = this.isTransferring();
        _Game_Player_performTransfer_BSEState.call(this);
        if (!wasTransferring) return;
        _clearMapCorpses();
        // Re-baseline the region key against where the player actually landed, so
        // Scene_Map.start below does not immediately re-clear (harmless) and, more
        // importantly, does not mistake the arrival region for an unchanged one.
        _lastProcRegionKey = $gameMap.mapId() === PROC_MAP_ID ? _procRegionKey() : null;
    };

    // Add a single corpse sprite at runtime (used when one map enemy kills another)
    Spriteset_Map.prototype.addCorpseSprite = function(data) {
        if (!this._corpseSprites) this._corpseSprites = [];
        const sprite = new Sprite_EnemyCorpse(data);
        if (this._tilemap) this._tilemap.addChild(sprite);
        this._corpseSprites.push(sprite);
        return sprite;
    };

    // ========================================================================
    // 9. Rewards popup, shared standardized toast (ParchmentToast.js)
    // ========================================================================

    // ========================================================================
    // 10. Scene_Map - Start (spawning, gravestone, post-battle)
    // ========================================================================

    // Restore HP/MP, body parts, hunger and sleep for the whole party on a
    // permadeath/tutorial respawn so the player does not wake up already dying
    // (issue #155). Mirrors the roguelite (non-permadeath) respawn branch.
    Scene_Map.prototype._refillPartyOnRespawn = function() {
        const leader = $gameParty.members()[0];
        if (leader) leader.recoverAll();
        for (const member of $gameParty.members()) {
            if (member.recoverAll) member.recoverAll();
            if (window.HealthCore && window.HealthCore.restoreAllBodyParts) {
                window.HealthCore.restoreAllBodyParts(member);
            }
            const maxHunger = (window.TimeDateSystem && window.TimeDateSystem.maxHunger) || 100;
            const maxSleep = (window.TimeDateSystem && window.TimeDateSystem.maxSleep) || 100;
            if (member._hunger !== undefined) member._hunger = maxHunger;
            if (member._sleep !== undefined) member._sleep = maxSleep;
        }
    };

    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        const currMap = $gameMap.mapId();

        if (!$gameSystem.isBattleEnded() && currMap !== _lastSpawnedMapId) {
            _clearMapCorpses();
            // Write through the real getter/setter ($gameSystem._battleCooldownTimer);
            // the module-scoped _battleCooldownTimer is never read.
            $gameSystem.setBattleCooldown(BATTLE_COOLDOWN_FRAMES);
            this.spawnEnemiesFromEncounters();
            _lastSpawnedMapId = currMap;
            _lastProcRegionKey = currMap === PROC_MAP_ID ? _procRegionKey() : null;
        } else if (!$gameSystem.isBattleEnded() && currMap === PROC_MAP_ID) {
            // Edge transitions between procedural regions keep map ID 636, so the
            // check above never fires and corpses from the previous region would
            // linger. The performTransfer hook already cleared them; this is the
            // backstop for a region swapped without a transfer, and it re-baselines
            // the key. Enemy respawning here is handled separately by
            // WorldMapReturn's refreshEnemiesForBiome().
            const regionKey = _procRegionKey();
            if (regionKey !== _lastProcRegionKey) {
                _clearMapCorpses();
                _lastProcRegionKey = regionKey;
            }
        }

        _Scene_Map_start.call(this);

        // Gravestone logic
        const deathData = $gameSystem.getDeathData();
        const gravestoneEvent = $gameMap.events().find(event => event.event().name === "Gravestone");
        if (gravestoneEvent) {
            if (deathData && deathData.mapId === $gameMap.mapId() && $gameSwitches.value(9)) {
                gravestoneEvent.locate(deathData.x, deathData.y);
                gravestoneEvent.setOpacity(255);
            } else {
                gravestoneEvent.locate(0, 0);
                gravestoneEvent.setOpacity(0);
                gravestoneEvent.setThrough(true);
            }
        }

        // Post-battle logic
        if ($gameSystem.isBattleEnded()) {
            let hasRespawned = false;
            $gameSystem.setBattleCooldown(120);

            const _tutorialRespawnMaps = [1414, 1415, 1416, 1417];
            const _inTutorialRespawn = $gameSwitches.value(75) && _tutorialRespawnMaps.includes($gameMap.mapId());

            if (_inTutorialRespawn && $gameSystem.isFullPartyWipe()) {
                this._refillPartyOnRespawn();
                this.handleActor1Respawn();
                hasRespawned = true;
            } else if ($gameSwitches.value(9)) {
                if ($gameSystem.isFullPartyWipe()) {
                    // Permadeath respawn: refill HP/MP, body parts, hunger and
                    // sleep so the player does not respawn already dying (#155).
                    this._refillPartyOnRespawn();
                    this.handleActor1Respawn();
                    hasRespawned = true;
                } else {
                    // Hardcore / Blood and Oil: any ally still dead at the end
                    // of the battle (not resurrected) is permanently removed.
                    // Capture the fallen members by reference BEFORE removing
                    // any of them, otherwise the shifting party indices would
                    // let a second dead ally slip through and survive. Filter
                    // every party member generically (not just indices 0-2) so
                    // a dead 4th member is removed too.
                    const fallen = $gameParty.members().filter(m => m && m.isDead());
                    for (const member of fallen) {
                        this.handlePartyMemberDeath(member, member.name());
                    }
                }
            } else if ($gameSystem.isActor1Died()) {
                // Roguelite KO: restore the WHOLE party to full (HP/MP via
                // recoverAll, which also clears death), not just the leader (#59).
                for (const member of $gameParty.members()) {
                    member.recoverAll();
                    if (window.HealthCore && window.HealthCore.restoreAllBodyParts) {
                        window.HealthCore.restoreAllBodyParts(member);
                    }
                    const maxHunger = (window.TimeDateSystem && window.TimeDateSystem.maxHunger) || 100;
                    const maxSleep = (window.TimeDateSystem && window.TimeDateSystem.maxSleep) || 100;
                    if (member._hunger !== undefined) member._hunger = maxHunger;
                    if (member._sleep !== undefined) member._sleep = maxSleep;
                }
                this.handleActor1Respawn();
                hasRespawned = true;
            }

            // Handle event deletion/locking. Both queues can hold the monster
            // that started the fight and every one that joined it, so drain
            // every entry that belongs to the map the party came back to and
            // leave the rest for the map they were left on.
            const mapNow = $gameMap.mapId();
            const keptDeletes = $gameSystem.getEventsToDelete().filter(entry => {
                if (entry.mapId !== mapNow) return true;
                if ($gameMap.event(entry.eventId)) $gameMap.eraseEvent(entry.eventId);
                return false;
            });
            $gameSystem.clearEventsToDelete();
            keptDeletes.forEach(e => $gameSystem.setEventToDelete(e.mapId, e.eventId));

            $gameSystem.getEventsToLock().forEach(entry => {
                const event = $gameMap.event(entry.eventId);
                if (event) event.lockMovement(160);
            });
            $gameSystem.clearEventsToLock();

            if (!hasRespawned) {
                if ($gameSystem._p1PreBattlePos && $gameSystem._p1PreBattlePos.mapId === $gameMap.mapId()) {
                    $gamePlayer.locate($gameSystem._p1PreBattlePos.x, $gameSystem._p1PreBattlePos.y);
                    $gamePlayer.setDirection($gameSystem._p1PreBattlePos.d);
                }
                if ($gameSystem._p2PreBattlePos && $gameSystem._p2PreBattlePos.mapId === $gameMap.mapId()) {
                    const p2Name = (window.$gameSplitScreen && window.$gameSplitScreen.p2EventName) || "Player 2";
                    const p2 = $gameMap.events().find(ev => ev && ev.event().name === p2Name);
                    if (p2) {
                        p2.locate($gameSystem._p2PreBattlePos.x, $gameSystem._p2PreBattlePos.y);
                        p2.setDirection($gameSystem._p2PreBattlePos.d);
                    }
                }
                this.createRewardsPopup();
            }

            $gameSystem.setBattleEnded(false);
            $gameSystem.setFullPartyWipe(false);
            $gameSystem.setActor1Died(false);
            $gameSystem.setActor2Died(false, "");
            $gameSystem.setActor3Died(false, "");
        } else {
            $gamePlayer.setThrough(false);
        }
    };

    // ========================================================================
    // 11. Scene_Map - Rewards Popup & Updates
    // ========================================================================

    // Battle spoils go through the shared reward popup (ParchmentToast.reward),
    // the same one terrain harvesting, dismantling and loot chests use, so a
    // win reads exactly like every other "you got something" in the game.
    // Item drops were gained silently during the fight: they are listed here
    // under the headline with their inventory icons, duplicates stacked.
    Scene_Map.prototype.createRewardsPopup = function() {
        const r = BSE.State.battleRewards;
        const kp = r ? (r.knowledge || 0) : 0;
        if (!r || (r.exp <= 0 && r.gold <= 0 && r.items.length === 0 && kp <= 0)) return;

        if (window.ParchmentToast) {
            window.ParchmentToast.reward({
                title: null,
                exp: r.exp || 0,
                gold: r.gold || 0,
                knowledge: kp,
                entries: (r.items || []).filter(Boolean).map(item => ({ obj: item, qty: 1 }))
            });
        }

        r.exp = 0; r.gold = 0; r.items = []; r.knowledge = 0;
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        $gameSystem.updateBattleCooldown();
    };

    // ========================================================================
    // 12. Game_Actor - onBattleEnd
    // ========================================================================

    const _Game_Actor_onBattleEnd = Game_Actor.prototype.onBattleEnd;
    Game_Actor.prototype.onBattleEnd = function() {
        _Game_Actor_onBattleEnd.call(this);
        if (this === $gameParty.members()[0] && $gameSystem.isActor1Died() && $gameSystem.isFullPartyWipe()) {
            this.recoverAll();
        }
    };

})();