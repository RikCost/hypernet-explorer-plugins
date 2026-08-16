// ============================================================================
// Battle System Enhanced - Death, Gravestone & Respawn
// For RPG Maker MZ
// ============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0 Death module: gravestone, respawn, permadeath, restore.
 * @author Combined by Claude, modified by OmniLex
 * @pluginName BattleSystemEnhancedDeath
 *
 * @help
 * ============================================================================
 * BattleSystemEnhancedDeath, Sub-module
 * ============================================================================
 *
 * Requires BattleSystemEnhanced.js (Core) and sub-modules to be loaded first.
 *
 * Manages actor death logic, gravestone placement, respawn mechanics,
 * inventory stripping on permadeath, and the "restore" plugin command.
 *
 * Loading order:
 *   1. BattleSystemEnhanced.js (Core)
 *   2. BattleSystemEnhancedEncounters.js
 *   3. BattleSystemEnhancedState.js
 *   4. BattleSystemEnhancedDeath.js (THIS PLUGIN)
 *   5. BattleSystemEnhancedMechanics.js
 *   6. BattleSystemEnhancedLevelDisplay.js
 */

(() => {
    'use strict';

    if (!window.BattleSystemEnhanced) {
        console.error('BattleSystemEnhancedDeath: Core plugin not loaded!');
        return;
    }
    const BSE = window.BattleSystemEnhanced;

    // ========================================================================
    // 1. SAVE DEATH DATA
    // ========================================================================

    function saveDeathData() {
        if (!$gameSwitches.value(9)) return;

        const savedData = {
            mapId: $gameMap.mapId(),
            x: $gamePlayer.x,
            y: $gamePlayer.y,
            gold: $gameParty.gold(),
            items: {}
        };

        // Save and remove standard items
        $gameParty.items().forEach(item => {
            const count = $gameParty.numItems(item);
            savedData.items['i' + item.id] = count;
            $gameParty.loseItem(item, count, false);
        });

        // Save and remove unequipped weapons
        $gameParty.weapons().forEach(weapon => {
            const isEquipped = $gameParty.members().some(actor => actor.isEquipped(weapon));
            if (!isEquipped) {
                const count = $gameParty.numItems(weapon);
                savedData.items['w' + weapon.id] = count;
                $gameParty.loseItem(weapon, count, false);
            }
        });

        // Save and remove unequipped armors
        $gameParty.armors().forEach(armor => {
            const isEquipped = $gameParty.members().some(actor => actor.isEquipped(armor));
            if (!isEquipped) {
                const count = $gameParty.numItems(armor);
                savedData.items['a' + armor.id] = count;
                $gameParty.loseItem(armor, count, false);
            }
        });

        $gameParty.loseGold($gameParty.gold());
        $gameSystem.setDeathData(savedData);
    }

    // Expose for other modules (used in BattleManager.processDefeat)
    BSE.Functions.saveDeathData = saveDeathData;

    // ========================================================================
    // 2. RESTORE COMMAND
    // ========================================================================

    BSE.Functions.executeRestoreCommand = function() {
        const deathData = $gameSystem.getDeathData();
        if (deathData) {
            $gameParty.gainGold(deathData.gold);
            for (const key in deathData.items) {
                const amount = deathData.items[key];
                let item = null;
                const id = parseInt(key.substring(1));
                if (key.startsWith('i')) item = $dataItems[id];
                else if (key.startsWith('w')) item = $dataWeapons[id];
                else if (key.startsWith('a')) item = $dataArmors[id];
                if (item) $gameParty.gainItem(item, amount, false);
            }
            $gameSystem.clearDeathData();
        }
    };

    // ========================================================================
    // 3. ACTOR DEATH ON MAP (processMapDeath)
    // ========================================================================

    // Tutorial maps never trigger a terminal game over.
    const _hardcoreTutorialMaps = [1414, 1415, 1416, 1417];
    function isTerminalDeath() {
        if (!$gameSwitches.value(9)) return false;
        if ($gameSwitches.value(75) && _hardcoreTutorialMaps.includes($gameMap.mapId())) return false;
        return !!(window.SaveSystem && window.SaveSystem.triggerGameOver);
    }

    // Resolves where a non-terminal (roguelite / normal) death respawns the
    // player. Priority:
    //   1. the latest location recorded by the save system (last save point)
    //   2. an explicit respawn point set by sleeping (TimeDateSystem) or the
    //      setRespawnPoint command (vars 25/26/27). The new-game defaults are
    //      ignored here, they only count once a respawn has actually been set.
    //   3. the character-creation starting location
    //   4a. in normal mode (Hardcore and Blood and Oil both off) with nothing
    //       set, the default safe location map 708 (25, 12)
    //   4b. otherwise the hardcoded fallback passed in by the caller
    function resolveRespawnLocation(fallbackMapId, fallbackX, fallbackY) {
        const saveLoc = window.SaveSystem?.getLastSaveLocation?.();
        if (saveLoc && saveLoc.mapId > 0) {
            return { mapId: saveLoc.mapId, x: saveLoc.x, y: saveLoc.y };
        }
        const vMap = $gameVariables.value(BSE.Params.respawnMapVar);
        if ($gameSystem._respawnPointSet && vMap > 0) {
            return {
                mapId: vMap,
                x: $gameVariables.value(BSE.Params.respawnXVar),
                y: $gameVariables.value(BSE.Params.respawnYVar)
            };
        }
        const startLoc = window.SaveSystem?.getCreationStartLocation?.();
        if (startLoc && startLoc.mapId > 0) {
            return { mapId: startLoc.mapId, x: startLoc.x, y: startLoc.y };
        }
        // Normal / roguelite death with no respawn point ever set: send the
        // player to the default safe location instead of the caller fallback.
        if (!$gameSwitches.value(9)) {
            return { mapId: 708, x: 25, y: 12 };
        }
        return { mapId: fallbackMapId, x: fallbackX, y: fallbackY };
    }

    Game_Actor.prototype.processMapDeath = function() {
        if (this !== $gameParty.members()[0]) return;

        // Hardcore / Blood and Oil: death is terminal -> Game Over, no respawn.
        if (isTerminalDeath()) {
            $gameSystem.setActor1Died(true);
            BSE.State.needsRespawn = false;
            window.SaveSystem.triggerGameOver();
            return;
        }

        if ($gameSwitches.value(9)) {
            saveDeathData();
        }

        $gameVariables.setValue(1, 0);
        $gameSystem.setActor1Died(true);
        BSE.State.needsRespawn = true;
        this.recoverAll();

        // A death out on the map, away from a battle, never reaches the
        // post-battle branch in the state module, so the party's needs are
        // refilled here instead: in Roguelite and Peaceful you get back up
        // whole, rather than starving on top of having just died.
        if (BSE.Helpers.isForgivingDeathMode()) {
            BSE.Helpers.refillPartyNeeds();
        }

        const _resolved = resolveRespawnLocation(1, 21, 23);
        let respawnMapId = _resolved.mapId;
        let respawnX = _resolved.x;
        let respawnY = _resolved.y;

        if ($gameSwitches.value(34)) {
            respawnMapId = 557;
            respawnX = 13;
            respawnY = 5;
        }

        if ($gameSwitches.value(100)) {
            respawnMapId = 1415;
            respawnX = 60;
            respawnY = 6;
        }

        $gamePlayer._priorityType = 0;
        $gamePlayer._through = true;
        $gameScreen.startFadeOut(30);

        if ($dataAnimations[1078]) {
            $gameTemp.requestAnimation([$gamePlayer], 1078);
        }

        setTimeout(() => {
            $gamePlayer.reserveTransfer(respawnMapId, respawnX, respawnY, 2, 0);
            let mapLoadAttempts = 0;
            const mapLoadInterval = setInterval(() => {
                // Give up after ~10s so the transfer never landing does not leak
                // a forever-running interval.
                if (++mapLoadAttempts > 100) { clearInterval(mapLoadInterval); return; }
                if ($gameMap.mapId() === respawnMapId) {
                    $gamePlayer._priorityType = 1;
                    $gamePlayer._through = false;
                    $gameSystem.setActor1Died(false);
                    BSE.State.needsRespawn = false;
                    if ($gameWeather) {
                        $gameWeather.updateTimeAndWeather();
                        $gameWeather.updateTimeOfDayTint();
                    }
                    clearInterval(mapLoadInterval);
                }
            }, 100);
        }, 500);
    };

    // ========================================================================
    // 4. Scene_Map - handleActor1Respawn
    // ========================================================================

    Scene_Map.prototype.handleActor1Respawn = function() {
        // Hardcore / Blood and Oil: a full party wipe ends the run with a
        // Game Over screen instead of respawning.
        if (isTerminalDeath()) {
            BSE.State.needsRespawn = false;
            window.SaveSystem.triggerGameOver();
            return;
        }

        $gameVariables.setValue(1, 0);
        $gamePlayer.setThrough(true);

        const _resolved = resolveRespawnLocation(25, 0, 0);
        let respawnMapId = _resolved.mapId;
        let respawnX = _resolved.x;
        let respawnY = _resolved.y;
        let respawnCountryID = $gameVariables.value(BSE.Params.respawnCountryIDVar) || 112;

        // Permadeath respawn. Also require Switch 9 (permadeath active): Switch 34
        // is set on a permadeath death but never reset, so this guards against a
        // stale Switch 34 removing roguelite party members if Switch 9 is later off (#80).
        if ($gameSwitches.value(34) && $gameSwitches.value(9)) {
            $gameSwitches.setValue(13, false);
            respawnMapId = 557;
            respawnX = 13;
            respawnY = 5;
            $gameVariables.setValue(86, 102);
            $gameVariables.setValue(BSE.Params.respawnCountryIDVar, 102);

            if ($gameSystem._currentPresetId && window.removePresetById) {
                window.removePresetById($gameSystem._currentPresetId);
            }

            const party = $gameParty.members();
            if (party[1]) $gameParty.removeActor(party[1].actorId());
            if (party[2]) $gameParty.removeActor(party[2].actorId());
        } else {
            $gameVariables.setValue(86, respawnCountryID);
            $gameVariables.setValue(BSE.Params.respawnCountryIDVar, respawnCountryID);
        }

        // Tutorial area respawn
        const _tutorialMaps = [1414, 1415, 1416, 1417];
        if ($gameSwitches.value(75) && _tutorialMaps.includes($gameMap.mapId())) {
            respawnMapId = 1414;
            respawnX = 61;
            respawnY = 7;
        }

        $gameScreen.startFadeOut(30);
        setTimeout(() => {
            $gamePlayer.reserveTransfer(respawnMapId, respawnX, respawnY, 2, 0);
            BSE.State.needsRespawn = false;

            let weatherAttempts = 0;
            const weatherUpdateInterval = setInterval(() => {
                // Give up after ~10s to avoid leaking a forever-running interval
                // if the transfer never lands on the respawn map.
                if (++weatherAttempts > 100) { clearInterval(weatherUpdateInterval); return; }
                if ($gameMap.mapId() === respawnMapId && $gameWeather) {
                    $gameWeather.updateTimeAndWeather();
                    $gameWeather.updateTimeOfDayTint();
                    clearInterval(weatherUpdateInterval);
                }
            }, 100);
        }, 500);
    };

    // ========================================================================
    // 5. Scene_Map - handlePartyMemberDeath
    // ========================================================================

    Scene_Map.prototype.handlePartyMemberDeath = function(actor, actorName) {
        // Only Hardcore (Permadeath) and Blood and Oil permanently remove a
        // fallen member. In Roguelite (Switch 9 off) the dead body stays in
        // the party so it can still be resurrected after the battle.
        if (!$gameSwitches.value(9)) return;
        if (!actor || !actor.isDead()) return;
        $gameParty.removeActor(actor.actorId());
        window.skipLocalization = true;
        $gameMessage.add(T('Battle.actorDied', { actor: actorName }));
        window.skipLocalization = false;
    };

    // ========================================================================
    // 6. Game_Player - performTransfer
    // ========================================================================

    const _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        _Game_Player_performTransfer.call(this);
        if (this.isTransferring() && !BSE.State.needsRespawn) {
            this.setThrough(false);
        }
    };

})();