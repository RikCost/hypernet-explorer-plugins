//=============================================================================
// MapBattleMode.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v1.0.0 Experimental tactical battle mode: fights play out on the live map instead of pushing Scene_Battle.
 * @author Assistant
 *
 * @help MapBattleMode.js
 *
 * When the "Map Battle" experimental option is on (Options > Experimental),
 * bumping into a map "Enemy" event no longer pushes Scene_Battle. Instead the
 * fight plays out directly on the current map:
 *   - every other "Enemy" event stays exactly where it is, fully visible, and
 *     keeps its own movement options (its move type, its ecology chase/flee
 *     AI); it simply moves in step-time with the fight instead of in real time
 *   - a non-combatant "Enemy" event that ends up within JOIN_RANGE tiles of any
 *     combatant - because the party walked past it, or because it wandered in -
 *     joins the fight on the spot: its whole troop is added to $gameTroop, it
 *     gets an HP card and a slot in the turn order, and it fights from the tile
 *     it is standing on (see section 9c)
 *   - a townsperson standing near the fight joins the PARTY's side when the
 *     party is well liked (median disposition across every party member, the
 *     same figure the Empathize panel shows) or when they are simply brave;
 *     they fight CPU-controlled off their society profile's own level, stats,
 *     skills and pouch (see section 9d)
 *   - the party fights from where it is standing. Whoever bumped the monster
 *     holds the tile they bumped it from, and every other member who is on the
 *     screen and near the brawl simply KEEPS THE TILE THEY ARE ON - the fight
 *     opens around them rather than shuffling them into a formation first.
 *     Only a member who is off the screen or most of a map away - which a Loose
 *     party (Core/AutoIdleExplorer.js) makes routine - is placed, put straight
 *     down on a muster tile a few tiles off the nearest monster (see section 5).
 *     Nothing is walked in and nothing is waited for: the round opens on the
 *     same frame the fight does.
 *   - the same HP/MP/AP HUD cards appear, plus a map-native command menu
 *   - a new "Move" command lets the acting battler reposition (range driven
 *     by DEX/agi) before choosing an action, FFT/Baldur's-Gate style
 *   - every CPU-driven battler - enemies, recruited townspeople, and the
 *     party's own members while the "CPU Party Members" option is on - takes
 *     the same turn: it attacks when a target is already inside its reach with
 *     a clear line, and otherwise walks (its own AGI move budget, the one the
 *     party's Move command uses) toward the best tile it can strike from,
 *     falling back to simply closing the distance; if the walk brings someone
 *     into reach it then acts, exactly like a party member who spends Move and
 *     picks an action afterwards
 *   - skills carry a <Range:N> notetag that restricts and visualizes how far
 *     they reach on the tile grid
 *   - normal attacks reach as far as the equipped weapon's own <Range:N>
 *     notetag (data/Weapons.json tags every weapon: 1 for ordinary melee, 2
 *     for spears/whips/staves/flails, higher for bows, guns and thrown or
 *     projectile weapons), and additionally require a clear line of sight.
 *     The Attack command greys out while no enemy satisfies both.
 *
 * Turn order (section 9e). A round is built once and runs to the end:
 *   1. the party and the enemy troop, interleaved by the ordinary RPG Maker
 *      turn-order formula (BattleSystem/IndividualBattleTurns.js)
 *   2. every townsperson who has joined the party's side, in AGI order
 *   3. the world step: every roaming "Enemy" event, every NPCSystem
 *      townsperson, every bystander event that moves at all, and the party's
 *      pet/follower (PetFollowerSystem.js, one random tile) all take exactly
 *      one tile, simultaneously.
 * Nothing outside the fight moves at any other time, so the map is a still
 * frame while the player reads menus and lurches forward once a round.
 *
 * This plugin is a presentation/input layer only: all rules (damage, AI,
 * skills, states, win/lose/flee/recruit resolution, rewards, corpses,
 * respawn) keep running through the existing BattleManager and
 * BattleSystemEnhanced{State,Death,Mechanics} code, completely unmodified.
 *
 * Load order: after Core/GameOptions, Multiplayer/SplitScreenMultiplayer,
 * Map/MovementInteractionSystem, every BattleSystem/BattleSystemEnhanced*
 * module, Weapon/WeaponSystem, BattleSystem/BattleSystemEnhanchedCommands,
 * BattleSystem/BattleSystemEnhancedHUD, BattleSystem/IndividualBattleTurns and
 * NPC/NPCSystem (whose controllers this plugin drives in step-time).
 *
 * Split-screen (Multiplayer/SplitScreenMultiplayer.js): the two viewports merge
 * into a single camera for the duration of the fight. Player 2's avatar event
 * becomes the second party member's tactical battler (its free roaming is
 * suspended for the fight), whoever did NOT bump the enemy is pulled in beside
 * it before the battle opens, and Player 2 drives the command menu and the tile
 * cursor on their own actor's turn.
 *
 * Water (Map/MovementInteractionSystem.js): a combatant that steps onto a water
 * tile starts swimming by itself and dries off again on land, so no "Swim"
 * prompt is ever needed mid-fight. Swimming costs WATER_MOVE_COST movement
 * points per tile instead of one, which makes a river a real obstacle rather
 * than a free shortcut. Every out-of-battle terrain prompt (Swim, Fish, Dive,
 * Drink, Resurface, Climb, Sit, boat) is suppressed while a fight runs.
 *
 * Talk: EnemyTalkSystem's Talk/recruit menu is authored on Scene_Battle; the
 * whole panel is re-hosted on Scene_Map here (see section 14) and reachable
 * from a Talk command in the tactical command menu.
 *
 * CPU Party Members (Core/GameOptions.js): the option is honoured here exactly
 * as it is in a front-view battle - the non-leader members never open a command
 * menu and drive themselves through the shared tactical AI above. The option is
 * ignored outright while a multiplayer session is running (split-screen or
 * network), where those slots belong to a second human. Townspeople who joined
 * the fight are CPU-driven either way; that is what they are.
 *
 * Known scope limits (presentation-layer, not rule changes):
 *   - The first troop member of every "Enemy" event in the fight has that
 *     event's real map position; any FURTHER members of the same troop are
 *     HP-bar-only (as they already are in front-view battles today) and are
 *     treated as always in range.
 */

(() => {
    "use strict";

    const MBM = {};
    window.MapBattleMode = MBM;

    const MOVE_AGI_DIVISOR = 5;
    // Movement points a single water tile costs. Land is 1, so swimming across
    // even a narrow river eats most of an ordinary turn's allowance.
    const WATER_MOVE_COST = 3;
    const DEFAULT_RANGE = 4;
    const UNARMED_RANGE = 1;
    const DIR_LIST = [2, 4, 6, 8];

    // --- The muster (section 5) ----------------------------------------------
    // How far off the nearest monster the party forms up. Not shoulder to
    // shoulder with it: a fight that opens with everybody already in contact has
    // no opening move, so the line stands off far enough that closing in, or
    // shooting across the gap, is a real first turn.
    const MUSTER_MIN = 2;
    const MUSTER_MAX = 4;
    // How far around the member who bumped the monster a muster tile is looked
    // for, so a placed member lands behind the one already in contact rather
    // than on the far side of the creature.
    const MUSTER_SCAN = 7;
    // A member standing this close to the one who bumped the monster, and on
    // the screen, keeps the tile they are already on: they are part of the
    // scene as it stands. Anyone further off - or off the screen entirely,
    // which a Loose party (Core/AutoIdleExplorer.js) makes routine - is placed
    // on a muster tile instead.
    const MUSTER_KEEP = 10;

    // How close a roaming "Enemy" event has to get to any combatant before it is
    // dragged into the fight (Manhattan tiles, same metric as every reach test
    // here). Two, so brushing past a monster during a Move pulls it in but
    // fighting three tiles from one does not.
    const JOIN_RANGE = 2;
    // How close a townsperson has to be before they even consider wading in.
    // Wider than JOIN_RANGE: bystanders decide from the edge of the brawl.
    const NPC_JOIN_RANGE = 5;
    // Median disposition (Empathize's own per-actor opinion, medianed across the
    // whole party) at or above which a townsperson takes the party's side.
    const NPC_JOIN_OPINION = 30;
    // PersonalityData.json list index for "Brave" - the personality that wades in
    // regardless of what it thinks of the party. Resolved by name at runtime with
    // this as the fallback if the data ever moves (see _isBraveProfile).
    const BRAVE_PERSONALITY = "Brave"; // i18n-ignore: PersonalityData.json id
    // Health/Traits.json ids that read as courage rather than personality:
    // adrenaline_junkie (24) and loyal (89) wade in; coward (54) and pacifist
    // (25) never do, whatever they think of the party.
    const BRAVE_TRAIT_IDS = [24, 89];
    const TIMID_TRAIT_IDS = [54, 25];
    // Proxy actors reserved for townspeople fighting alongside the party
    // (data/Actors.json, all tagged <MapBattleAlly>). Three, so a street brawl
    // can pull in a small crowd without ever touching a real party slot.
    const ALLY_ACTOR_IDS = [6, 7, 8];

    const COLOR_MOVE = "rgba(80,170,255,0.35)";
    const COLOR_RANGE = "rgba(255,90,60,0.35)";
    const COLOR_CURSOR = "rgba(255,255,255,0.55)";

    //=========================================================================
    // State
    //=========================================================================

    MBM._active = false;
    MBM._troopId = 0;
    MBM._persistentId = null;
    MBM._eventId = 0;
    MBM._mapId = 0;
    MBM._enemyEvent = null;
    MBM._moveUsedThisTurn = {};

    MBM._logWindow = null;
    MBM._cmdWindow = null;
    MBM._skillWindow = null;
    MBM._itemWindow = null;
    MBM._hpBars = [];
    MBM._hpBarKey = "";
    MBM._tileSprites = [];
    MBM._cursorState = null;
    MBM._activeWalk = null;
    MBM._lastInputActor = null;
    // Followers are through-walls characters outside battle; remember that so it
    // can be restored (see _positionParty).
    MBM._followerThrough = [];
    // Windows muted (not hidden) while a message box or the talk panel is up.
    MBM._windowsDeaf = false;
    MBM._deafened = null;
    // Per-turn AI bookkeeping for whoever is acting: { subject, done }.
    // See _updateAiTurn - shared by enemies, CPU party members and allies.
    MBM._aiTurn = null;

    // --- Combatant registries ------------------------------------------------
    // Every "Enemy" event taking part, and the troop members standing on it.
    // The first member of each event's troop owns that event's tile; further
    // members of the same troop are HP-bar-only (file header's scope note).
    MBM._enemyEventFor = new Map();   // Game_Enemy  -> Game_Event
    MBM._combatEnemyEvents = [];      // [{ event, eventId, persistentId, troopId, battlers }]
    // Townspeople fighting for the party: proxy actor + the event that is their
    // body on the map. See section 9d.
    MBM._allies = [];                 // [{ actorId, actor, eventId, event, npcName, profile, items }]
    // Map events already judged for joining (either side), so the per-round scan
    // never re-rolls the same bystander.
    MBM._considered = new Set();
    // Set while a party-roster query must NOT see the ally proxies (the
    // index-based death latches, isAllDead, the ITBS round builder).
    MBM._hideAllies = false;
    // The pet/follower's out-of-battle through state (PetFollowerSystem.js).
    MBM._petThrough = null;
    // False until the first round has been built, so the world step only ever
    // runs BETWEEN rounds and never before the fight has begun.
    MBM._roundStarted = false;

    MBM.isActive = function () {
        return !!MBM._active;
    };

    // Mirrors window.isCardCombatMode (RoguelikeCardSystem.js): the raw
    // Experimental-options toggle, checked at the one point a new battle
    // decides which presentation to use (BattleSystemEnhanced.js). Once a
    // fight has begun, everything else here checks MBM.isActive() instead so
    // a mid-battle option flip can never corrupt an in-progress fight.
    window.isMapBattleMode = () => ConfigManager.mapBattleMode === true;

    //=========================================================================
    // Helpers
    //=========================================================================

    // window.isMultiplayerSession / window.isCpuPartyMembersActive are defined by
    // Core/GameOptions.js, which owns the CPU Party Members option itself; the
    // fallbacks keep this plugin standalone if it is ever loaded without it.
    MBM.isMultiplayer = function () {
        if (typeof window.isMultiplayerSession === "function") return window.isMultiplayerSession();
        const ss = window.SplitScreenManager || window.$gameSplitScreen;
        if (ss && ss.active) return true;
        if (window.$gameSwitches) {
            if ($gameSwitches.value(66) || $gameSwitches.value(67)) return true;
        }
        const nm = window.NetworkManager;
        return !!(nm && nm.isConnected && nm.isConnected());
    };
    MBM.isCpuParty = function () {
        if (typeof window.isCpuPartyMembersActive === "function") return window.isCpuPartyMembersActive();
        return ConfigManager.cpuPartyMembers === true && !MBM.isMultiplayer();
    };

    function tileCenterX(x) {
        return Math.round($gameMap.adjustX(x) * $gameMap.tileWidth() + $gameMap.tileWidth() / 2);
    }
    function tileCenterY(y) {
        return Math.round($gameMap.adjustY(y) * $gameMap.tileHeight() + $gameMap.tileHeight() / 2);
    }
    function manhattan(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }
    function dirBetween(x1, y1, x2, y2) {
        if (x2 > x1) return 6;
        if (x2 < x1) return 4;
        if (y2 > y1) return 2;
        if (y2 < y1) return 8;
        return 0;
    }
    function currentSpriteset() {
        const scene = SceneManager._scene;
        return scene && scene._spriteset;
    }

    //=========================================================================
    // Split-screen bridge (Multiplayer/SplitScreenMultiplayer.js)
    //
    // In a 2P session the party is [P1 actor, P2 actor], the follower train is
    // hidden, and the second member walks the map as the "Player2" avatar event.
    // A map battle therefore has to treat that event as a real tactical battler
    // rather than as a bystander.
    //=========================================================================

    function splitScreen() {
        const ss = window.SplitScreenManager || window.$gameSplitScreen;
        return ss && ss.active && ss.p2Event ? ss : null;
    }

    MBM.p2Event = function () {
        const ss = splitScreen();
        return ss ? ss.p2Event : null;
    };

    MBM._p2Battler = function () {
        return splitScreen() ? ($gameParty.battleMembers()[1] || null) : null;
    };

    // True while the battler waiting for input is Player 2's, i.e. while the
    // second controller owns the command menu and the tile cursor.
    MBM._isP2Input = function () {
        const p2 = MBM._p2Battler();
        return !!p2 && BattleManager.actor() === p2;
    };

    const P2_INPUT_KEY = {
        ok: "action", cancel: "cancel",
        up: "up", down: "down", left: "left", right: "right"
    };

    // Input.isTriggered for the tile cursor. Player 2's pad/keys answer on
    // Player 2's own turn and only then, so the two controllers can never fight
    // over the same cursor. Windows are routed separately, by the
    // Window_Selectable hooks in SplitScreenMultiplayer.js.
    MBM.inputTriggered = function (key) {
        if (Input.isTriggered(key)) return true;
        const ss = splitScreen();
        if (!ss || !MBM._isP2Input()) return false;
        const pk = P2_INPUT_KEY[key];
        return !!pk && ss.isTriggered(pk);
    };

    // Swallow the Player 2 press we just acted on. The tile cursor is not a
    // Window_Selectable, so nothing else clears it while the cursor owns input.
    MBM.consumeP2Input = function () {
        const ss = splitScreen();
        if (ss && ss.consumeTrigger) ss.consumeTrigger();
    };

    //=========================================================================
    // 0. Ally roster (townspeople fighting for the party)
    //
    // A recruited townsperson is a proxy Game_Actor (data/Actors.json ids 6-8,
    // tagged <MapBattleAlly>) appended to $gameParty.battleMembers() for the
    // duration of the fight, with the NPC's own map event as its body.
    //
    // Appending to battleMembers() rather than calling $gameParty.addActor() is
    // deliberate: the proxy then shows up everywhere the battle rules look
    // ($gameTroop targets it, Game_Action.setTarget indexes it, the HUD cards
    // list it) while staying out of $gameParty._actors entirely - so it never
    // reaches the menu, the save file, the follower train, the reward split, or
    // the roster history. The three places that DO have to keep seeing the real
    // party only (the index-based death latches, isAllDead, and the turn-order
    // round builder) ask through withoutAllies().
    //=========================================================================

    MBM.isAllyActor = function (battler) {
        return !!battler && battler.isActor && battler.isActor() &&
            ALLY_ACTOR_IDS.includes(battler.actorId());
    };

    MBM.allyBattlers = function () {
        return MBM._allies.map(a => a.actor).filter(Boolean);
    };

    MBM.allyRecordFor = function (battler) {
        return MBM._allies.find(a => a.actor === battler) || null;
    };

    // Run `fn` with the ally proxies invisible to $gameParty. Restores the flag
    // even if fn throws, so one bad frame can never strand the party roster.
    MBM.withoutAllies = function (fn) {
        const was = MBM._hideAllies;
        MBM._hideAllies = true;
        try {
            return fn();
        } finally {
            MBM._hideAllies = was;
        }
    };

    // battleMembers() is polled several times a frame, so the concatenated list
    // is memoized and only rebuilt when the roster actually changes.
    MBM._allyListDirty = true;
    MBM._battleMembersCache = null;

    const _Game_Party_battleMembers = Game_Party.prototype.battleMembers;
    Game_Party.prototype.battleMembers = function () {
        const base = _Game_Party_battleMembers.call(this);
        if (!MBM.isActive() || MBM._hideAllies || MBM._allies.length === 0) return base;
        if (MBM._allyListDirty || !MBM._battleMembersCache ||
            MBM._battleMembersCache.length !== base.length + MBM._allies.length) {
            MBM._battleMembersCache = base.concat(MBM.allyBattlers());
            MBM._allyListDirty = false;
        }
        return MBM._battleMembersCache;
    };

    // A fight is lost when the PARTY is down, not when the last volunteer falls
    // (and it is not saved by a volunteer still standing either).
    const _Game_Party_isAllDead = Game_Party.prototype.isAllDead;
    Game_Party.prototype.isAllDead = function () {
        if (!MBM.isActive() || MBM._allies.length === 0) return _Game_Party_isAllDead.call(this);
        return MBM.withoutAllies(() => _Game_Party_isAllDead.call(this));
    };

    // BattleSystemEnhancedState's death latches are positional
    // ($gameParty.members()[0..2] -> setActor1Died/2/3). With a one- or
    // two-strong party an ally would sit at index 1 or 2 and a dead volunteer
    // would be filed as a dead party member - which, under Hardcore, permanently
    // deletes a real companion who is standing right there.
    const _BattleManager_checkActorDeaths = BattleManager.checkActorDeaths;
    if (typeof _BattleManager_checkActorDeaths === "function") {
        BattleManager.checkActorDeaths = function () {
            if (!MBM.isActive() || MBM._allies.length === 0) {
                return _BattleManager_checkActorDeaths.call(this);
            }
            return MBM.withoutAllies(() => _BattleManager_checkActorDeaths.call(this));
        };
    }

    // The proxy's stats come from the society profile the Empathize panel shows,
    // not from the (blank) database actor.
    const ALLY_PARAM_KEYS = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi", "luk"];

    const _Game_Actor_paramBase_MBM = Game_Actor.prototype.paramBase;
    Game_Actor.prototype.paramBase = function (paramId) {
        if (MBM.isActive() && MBM.isAllyActor(this)) {
            const rec = MBM.allyRecordFor(this);
            const value = rec && rec.profile ? rec.profile[ALLY_PARAM_KEYS[paramId]] : null;
            if (Number.isFinite(value) && value > 0) return value;
        }
        return _Game_Actor_paramBase_MBM.call(this, paramId);
    };

    // Volunteers are always CPU-driven: nobody is holding a controller for them,
    // in single player or multiplayer alike.
    const _Game_Actor_isAutoBattle_MBM = Game_Actor.prototype.isAutoBattle;
    Game_Actor.prototype.isAutoBattle = function () {
        if (MBM.isActive() && MBM.isAllyActor(this)) return true;
        return _Game_Actor_isAutoBattle_MBM.call(this);
    };

    //=========================================================================
    // Water (Map/MovementInteractionSystem.js)
    //=========================================================================

    // A tile a combatant may swim across: real water that is not a region-10
    // "no swimming here" tile. Everything else is walked at the normal cost.
    MBM.isSwimmableWater = function (x, y) {
        const MS = window.MovementSystem;
        if (!MS || !MS.isWaterTile) return false;
        if ($gameMap.regionId(x, y) === 10) return false;
        return MS.isWaterTile(x, y);
    };

    MBM.stepCost = function (x, y) {
        return MBM.isSwimmableWater(x, y) ? WATER_MOVE_COST : 1;
    };

    // Water is impassable to anyone who is not already swimming, so ask the
    // passability system the question it would be asked mid-swim: a combatant
    // who walks in enters swim mode as the step lands (_enterWaterFor below).
    MBM._canStep = function (character, x, y, dir) {
        const nx = $gameMap.roundXWithDirection(x, dir);
        const ny = $gameMap.roundYWithDirection(y, dir);
        if (!MBM.isSwimmableWater(nx, ny)) return character.canPass(x, y, dir);
        const was = character._isSwimming;
        character._isSwimming = true;
        try {
            return character.canPass(x, y, dir);
        } finally {
            character._isSwimming = was;
        }
    };

    // Called immediately before a tactical step, so the swimmer is already in
    // swim mode when moveStraight asks whether the water tile is passable.
    MBM._enterWaterFor = function (character, x, y) {
        const MS = window.MovementSystem;
        if (!MS || !character || character._isSwimming) return;
        if (MBM.isSwimmableWater(x, y)) MS.enterSwimMode(character);
    };

    // Reconcile a combatant's swim state with the tile it actually ended up on.
    // The leader's exit is deliberately left to Game_Player.updateSwimState
    // (MovementInteractionSystem), which also owns the permanently submerged
    // SeaBed biome; forcing it from here would fight that every frame.
    MBM._syncSwimState = function (character) {
        const MS = window.MovementSystem;
        if (!MS || !character) return;
        if (MBM.isSwimmableWater(character.x, character.y)) {
            if (!character._isSwimming) MS.enterSwimMode(character);
            return;
        }
        if (character !== $gamePlayer && character._isSwimming) MS.exitSwimMode(character);
    };

    // "Enemy" is the map-event name BattleSystemEnhancedEncounters spawns every
    // roaming monster under. Hit from the per-frame Game_Event.update hook for
    // every event on the map, so the (immutable) name test is cached on the
    // event object itself.
    function isEnemyEvent(event) {
        if (!event) return false;
        if (event._mbmIsEnemy === undefined) {
            const data = event.event ? event.event() : null;
            event._mbmIsEnemy = !!data && data.name === "Enemy";
        }
        return event._mbmIsEnemy;
    }

    // Resolve the real on-map character behind a battler: the leader, the first
    // two followers (or, in split-screen, Player 2's avatar event), a recruited
    // townsperson's own event, and the first troop member of every "Enemy" event
    // in the fight. Further members of the same troop have no tile (see the file
    // header's scope note) and are treated as "always in range" by returning
    // null.
    MBM.mapCharacterFor = function (battler) {
        if (!battler) return null;
        if (battler.isActor && battler.isActor()) {
            // Checked before the positional mapping: with a one-strong party an
            // ally sits at battleMembers index 1, where follower(0) lives.
            if (MBM.isAllyActor(battler)) {
                const rec = MBM.allyRecordFor(battler);
                return rec ? rec.event : null;
            }
            const idx = MBM.withoutAllies(() => $gameParty.battleMembers().indexOf(battler));
            if (idx === 0) return $gamePlayer;
            // Split-screen hides the follower train entirely and walks the
            // second member as the "Player2" event, so that event is the second
            // battler's map position.
            if (idx === 1 && MBM.p2Event()) return MBM.p2Event();
            if (idx === 1) return $gamePlayer.followers().follower(0);
            if (idx === 2) return $gamePlayer.followers().follower(1);
            // The fourth place in the line: a summon (SummonSystem.js) holds it
            // for the length of a fight, and it fights from a tile like anyone
            // else rather than from nowhere.
            if (idx === 3) return $gamePlayer.followers().follower(2);
            return null;
        }
        if (battler.isEnemy && battler.isEnemy()) {
            return MBM._enemyEventFor.get(battler) || null;
        }
        return null;
    };

    // Every map character taking part in the fight: the party members and
    // volunteers that have a real tile (resolved through mapCharacterFor, so
    // split-screen's P2 event is included and hidden followers are not) plus
    // every combatant Enemy event.
    MBM._battlerCharacters = function () {
        const list = [];
        for (const actor of $gameParty.battleMembers()) {
            const c = MBM.mapCharacterFor(actor);
            if (!c) continue;
            // An empty follower slot has a Game_Follower but no actor behind it.
            if (typeof c.actor === "function" && !c.actor()) continue;
            if (!list.includes(c)) list.push(c);
        }
        for (const entry of MBM._combatEnemyEvents) {
            if (entry.event && !entry.event._erased && !list.includes(entry.event)) {
                list.push(entry.event);
            }
        }
        return list;
    };

    // The tiles the fight is being fought over: used to decide which bystanders
    // are close enough to be dragged in. `combatants` may be a snapshot taken by
    // the caller, so a sweep over the whole map costs one list, not one per event.
    MBM._nearestCombatantDistance = function (x, y, combatants) {
        let best = Infinity;
        for (const c of (combatants || MBM._battlerCharacters())) {
            if (!c) continue;
            best = Math.min(best, manhattan(x, y, c.x, c.y));
        }
        return best;
    };

    MBM.skillRange = function (skill) {
        if (!skill) return DEFAULT_RANGE;
        const raw = skill.meta && skill.meta.Range;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_RANGE;
    };

    // Every entry in data/Weapons.json carries a <Range:N> notetag; an
    // untagged weapon (a mod's, or a hand-added one) falls back to melee reach.
    MBM.weaponRange = function (weapon) {
        if (!weapon) return 0;
        const n = Number(weapon.meta && weapon.meta.Range);
        return Number.isFinite(n) && n > 0 ? n : UNARMED_RANGE;
    };

    // Normal-attack reach: the longest range among equipped weapons (so a
    // dual-wielder keeps their better one), bare hands reach one tile. Enemies
    // may declare their own <Range:N> in data/Enemies.json.
    MBM.attackRange = function (battler) {
        if (!battler) return UNARMED_RANGE;
        if (battler.weapons) {
            const ranges = battler.weapons().map(MBM.weaponRange).filter(r => r > 0);
            if (ranges.length > 0) return Math.max(...ranges);
        }
        if (battler.isEnemy && battler.isEnemy()) {
            const n = Number(battler.enemy().meta.Range);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return UNARMED_RANGE;
    };

    // Attack actions reach as far as the weapon in hand; skills and items use
    // their own <Range:N> notetag (DEFAULT_RANGE when untagged).
    MBM.actionRange = function (action) {
        if (!action) return DEFAULT_RANGE;
        if (action.isAttack && action.isAttack()) return MBM.attackRange(action.subject());
        return MBM.skillRange(action.item());
    };

    //=========================================================================
    // Line of sight
    //=========================================================================

    // Every other battler on the map counts as cover, so a target can be
    // shielded by the body standing in front of it. The shooter and the target
    // themselves never block their own line.
    MBM._sightBlockers = function (from, to) {
        const set = new Set();
        for (const c of MBM._battlerCharacters()) {
            if (!c || c === from || c === to) continue;
            set.add(c.x + "," + c.y);
        }
        return set;
    };

    // A tile blocks sight when nothing may walk through it from any direction
    // (walls, solid props) or when a battler is standing on it. Same
    // "impassable from every side" wall test _positionParty() uses.
    MBM._blocksSight = function (x, y, blockers) {
        if (blockers && blockers.has(x + "," + y)) return true;
        if (!$gameMap.isValid(x, y)) return true;
        return DIR_LIST.every(d => !$gameMap.isPassable(x, y, d));
    };

    // Supercover line walk: sample the segment finely and test every distinct
    // tile strictly between the endpoints. Adjacent battlers always see each
    // other (no tile in between).
    MBM.hasLineOfSight = function (x1, y1, x2, y2, blockers) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
        if (steps <= 0) return true;
        let lastKey = x1 + "," + y1;
        for (let i = 1; i < steps; i++) {
            const x = Math.round(x1 + (dx * i) / steps);
            const y = Math.round(y1 + (dy * i) / steps);
            const key = x + "," + y;
            if (key === lastKey) continue;
            lastKey = key;
            if (x === x2 && y === y2) continue;
            if (MBM._blocksSight(x, y, blockers)) return false;
        }
        return true;
    };

    // Can `subject` act on `target` from where it stands: inside `range` tiles
    // and with an unobstructed line. Battlers without a real map position (see
    // the file header's scope note) are always reachable.
    MBM.canReach = function (subject, target, range) {
        const from = MBM.mapCharacterFor(subject);
        const to = MBM.mapCharacterFor(target);
        if (!from || !to) return true;
        if (manhattan(from.x, from.y, to.x, to.y) > range) return false;
        return MBM.hasLineOfSight(from.x, from.y, to.x, to.y, MBM._sightBlockers(from, to));
    };

    // Drives the greyed-out Attack command (BattleSystemEnhanchedCommands.js):
    // true only while some living enemy is in weapon range with a clear line.
    MBM.canUseAttackCommand = function (actor) {
        if (!MBM.isActive() || !actor) return true;
        const range = MBM.attackRange(actor);
        return $gameTroop.members().some(e => e && e.isAlive() && MBM.canReach(actor, e, range));
    };

    //=========================================================================
    // 1. Spriteset_Map / Window_BattleLog engine glue
    //
    // Window_BattleLog.isBusy() polls `this._spriteset.isBusy()`, and its
    // "effect"/"movement" wait modes poll isEffecting()/isAnyoneMoving() -
    // all four only exist on Spriteset_Battle in core. Adding them to
    // Spriteset_Map lets the exact same log-window sequencer that already
    // drives front-view battles drive map battles too.
    //=========================================================================

    // "Anyone moving" means the combatants only, never the whole map. An
    // unrelated roaming NPC stepping around must not make BattleManager.isBusy()
    // true, or the phase machine stalls forever and no command window ever
    // opens (the map is full of NPCSystem walkers).
    Spriteset_Map.prototype.isAnyoneMoving = function () {
        if (MBM.isActive()) {
            return MBM._battlerCharacters().some(c => c.isMoving());
        }
        return this._characterSprites.some(s => s._character && s._character.isMoving());
    };
    Spriteset_Map.prototype.isEffecting = function () {
        return this.isAnimationPlaying();
    };
    Spriteset_Map.prototype.isBusy = function () {
        return this.isAnimationPlaying() || this.isAnyoneMoving();
    };

    // Animations aimed at a Game_Battler need to land on the real map
    // character sprite (player/follower/enemy event) instead of nothing.
    const _Spriteset_Map_findTargetSprite = Spriteset_Map.prototype.findTargetSprite;
    Spriteset_Map.prototype.findTargetSprite = function (target) {
        if (MBM.isActive() && target && ((target.isActor && target.isActor()) || (target.isEnemy && target.isEnemy()))) {
            const ch = MBM.mapCharacterFor(target);
            if (ch) {
                const found = this._characterSprites.find(s => s.checkCharacter(ch));
                if (found) return found;
            }
        }
        return _Spriteset_Map_findTargetSprite.call(this, target);
    };

    // Damage popups only exist on Sprite_Battler (Sprite_Actor/Sprite_Enemy),
    // not Sprite_Character. Draw a small lightweight floating number directly
    // on the map instead, positioned at the battler's real sprite.
    const _WBL_popupDamage = Window_BattleLog.prototype.popupDamage;
    Window_BattleLog.prototype.popupDamage = function (target) {
        if (MBM.isActive()) {
            MBM.showDamagePopup(target);
            return;
        }
        _WBL_popupDamage.call(this, target);
    };

    class Sprite_MBMDamage extends Sprite {
        constructor(character, result) {
            super();
            this._character = character;
            this._duration = 40;
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this.z = 9;
            this.bitmap = new Bitmap(160, 48);
            this._drawResult(result);
            this._updatePosition();
        }
        _drawResult(result) {
            const b = this.bitmap;
            b.fontSize = 26;
            b.outlineWidth = 4;
            b.outlineColor = "black";
            if (result.missed || result.evaded) {
                b.textColor = "#ffffff";
                b.drawText(result.missed ? T('Battle.popup.miss') : T('Battle.popup.evaded'), 0, 4, 160, 32, "center");
            } else if (result.hpAffected) {
                const amount = Math.abs(Math.round(result.hpDamage));
                const heal = result.hpDamage < 0;
                b.textColor = heal ? "#7CFC00" : "#ff6666";
                b.drawText((heal ? "+" : "-") + amount, 0, 4, 160, 32, "center");
            }
        }
        _updatePosition() {
            if (!this._character) return;
            this.x = tileCenterX(this._character._realX !== undefined ? this._character._realX : this._character.x);
            this.y = tileCenterY(this._character._realY !== undefined ? this._character._realY : this._character.y) - 48 - (40 - this._duration);
        }
        update() {
            super.update();
            this._updatePosition();
            this._duration--;
            this.opacity = Math.min(255, this._duration * 12);
            if (this._duration > 0) return;
            // Destroyed, not merely unparented: every popup carries its own
            // 160x48 Bitmap, and a long fight throws hundreds of them.
            if (this.parent) this.parent.removeChild(this);
            this.destroy();
        }
    }

    MBM.showDamagePopup = function (target) {
        const character = MBM.mapCharacterFor(target);
        const spriteset = currentSpriteset();
        if (!character || !spriteset || !target.result()) return;
        const sprite = new Sprite_MBMDamage(character, target.result());
        spriteset.addChild(sprite);
    };

    //=========================================================================
    // 2. BattleManager glue
    //=========================================================================

    // Vanilla-then-pop-scene behavior doesn't apply here: we never pushed a
    // new scene, so there is nothing to pop. Run the same win/lose/revive
    // branching, then hand off to MBM.finish() which re-invokes
    // Scene_Map.prototype.start() (already aliased by BattleSystemEnhancedState.js
    // to run the corpse/respawn/reward path) without ever leaving the scene.
    const _BattleManager_updateBattleEnd = BattleManager.updateBattleEnd;
    BattleManager.updateBattleEnd = function () {
        if (!MBM.isActive()) {
            _BattleManager_updateBattleEnd.call(this);
            return;
        }
        // Parity with BattleSystemEnhancedState.js's own updateBattleEnd alias,
        // whose scene-popping half we deliberately skip below: its actor-died
        // bookkeeping is otherwise mostly redundant with the checkActorDeaths()
        // poll (driven every frame via MBM's BattleManager.update(true) call),
        // but replicate it here too for full parity with front-view battles.
        if (this._escaped || $gameParty.isAllDead() || $gameTroop.isAllDead()) {
            $gameSystem.setBattleEnded(true);
            // Positional, exactly like BattleManager.checkActorDeaths, so the
            // volunteers have to be invisible here for the same reason: with a
            // one- or two-strong party an ally sits at index 1 or 2, and a dead
            // volunteer would be filed as a dead companion - which, under
            // Hardcore, permanently deletes a real one who is standing there.
            MBM.withoutAllies(() => {
                $gameParty.members().forEach((actor, index) => {
                    if (!actor.isDead()) return;
                    if (index === 0) $gameSystem.setActor1Died(true);
                    else if (index === 1) $gameSystem.setActor2Died(true, actor.name());
                    else if (index === 2) $gameSystem.setActor3Died(true, actor.name());
                });
            });
        }
        if (this.isBattleTest()) {
            AudioManager.stopBgm();
            SceneManager.exit();
            return;
        }
        if (!this._escaped && $gameParty.isAllDead()) {
            if (this._canLose) {
                $gameParty.reviveBattleMembers();
            } else {
                this._phase = "";
                MBM.finish();
                SceneManager.goto(Scene_Gameover);
                return;
            }
        }
        this._phase = "";
        MBM.finish();
    };

    // The core auto-random-attack-retarget in selectNextCommand would stomp
    // whatever target the tactical range-cursor already set. Skip that one
    // block while active; everything else behaves the same.
    const _BattleManager_selectNextCommand = BattleManager.selectNextCommand;
    BattleManager.selectNextCommand = function () {
        if (!MBM.isActive()) {
            _BattleManager_selectNextCommand.call(this);
            return;
        }
        if (this._currentActor) {
            if (this._currentActor.selectNextCommand()) return;
            this.finishActorInput();
        }
        this.selectNextActor();
    };

    // World time no longer advances per action or per tile: the whole map takes
    // one step together, once a round, from the round builder (section 9e). This
    // is where the old per-action grant used to be; nothing replaces it.

    // A CPU-driven turn is "attack OR move", never both: the battler acts if a
    // target is inside the reach of the action it rolled, and otherwise spends
    // the whole turn closing the distance. processTurn is polled every frame
    // while it is the subject, so this gate simply withholds the action until
    // the approach walk has finished. Applies to every battler nobody is holding
    // a controller for: enemies, recruited townspeople, and the party's own
    // members while the CPU Party Members option is on.
    const _BattleManager_processTurn = BattleManager.processTurn;
    BattleManager.processTurn = function () {
        if (MBM.isActive() && MBM.isAiControlled(this._subject)) {
            if (!MBM._updateAiTurn(this._subject)) return;
        }
        _BattleManager_processTurn.call(this);
    };

    //=========================================================================
    // 3. World freeze
    //=========================================================================

    // True for an event that is fighting right now: a combatant Enemy event, or
    // a townsperson who has joined the party's side. Both are driven exclusively
    // by MBM (_updateWalk) and must never take a world step of their own.
    MBM.isCombatantEvent = function (event) {
        return !!event && event._mbmCombatant === true;
    };

    // Nothing on the map is frozen out of existence any more: every event keeps
    // updating, so a roaming monster still animates, still runs its ecology
    // chase/flee AI, and still looks alive while the fight goes on beside it.
    // What changes is the CLOCK - see updateSelfMovement below.

    // Movement authority while a map battle runs:
    //   - combatants (enemy events and recruited townspeople) are driven
    //     exclusively by MBM's own walker
    //   - everybody else - roaming "Enemy" events included - keeps their own
    //     movement options (move type, move route, BSE's ecology chase/flee) but
    //     spends them out of the banked tactical budget, so the map is a still
    //     frame between rounds and lurches one tile forward at each world step
    const _Game_Event_updateSelfMovement = Game_Event.prototype.updateSelfMovement;
    Game_Event.prototype.updateSelfMovement = function () {
        if (MBM.isActive()) {
            if (MBM.isCombatantEvent(this)) return;
            if (!this._mbmSteps || this._mbmSteps <= 0) return;
            // Core gates self-movement on a real-time stop counter. World time is
            // frozen, so that counter would hold a banked step for a second or
            // more; skip the wait and let the step land on the frame it was
            // granted, which is what keeps the map in lockstep with the fight.
            const threshold = this.stopCountThreshold();
            if (this._stopCount <= threshold) this._stopCount = threshold + 1;
            const wasAt = this._x + "," + this._y;
            _Game_Event_updateSelfMovement.call(this);
            // Only a step that actually left the tile costs a banked step; a
            // stop-count wait or a blocked direction must not drain the budget.
            if (this._x + "," + this._y !== wasAt) {
                this._mbmSteps--;
                // A monster that just wandered into the brawl is now part of it.
                if (isEnemyEvent(this)) MBM.checkEnemyEventJoin(this);
            }
            return;
        }
        _Game_Event_updateSelfMovement.call(this);
    };

    // An "Enemy" event page is the battle trigger itself; letting one fire while
    // a fight is already running would push a SECOND battle on top of this one.
    // Enemy events can legitimately touch the player during a map battle (the
    // combatant closing in, a bystander wandering past), so this guard is
    // load-bearing. The bystander is not simply ignored, though: touching a
    // fight is the clearest possible sign of wanting in, so it joins instead.
    const _Game_Event_start = Game_Event.prototype.start;
    Game_Event.prototype.start = function () {
        if (MBM.isActive() && isEnemyEvent(this)) {
            if (!MBM.isCombatantEvent(this)) MBM.joinEnemyEvent(this);
            return;
        }
        _Game_Event_start.call(this);
    };

    // A combatant caught mid-step would keep sliding between tiles while MBM
    // reads its (already advanced) destination coordinates. Snap it onto the
    // tile it was walking to before the fight starts measuring anything.
    MBM._snapEvent = function (event) {
        if (event && event.isMoving()) event.locate(event.x, event.y);
    };

    // The same for a party member. Routed through _placeBattler so snapping the
    // leader does not drag the whole follower train onto their tile
    // (Game_Player.locate synchronizes it), and so a member snapped in a river
    // is left in the right swim state.
    MBM._snapCharacter = function (character) {
        if (character && character.isMoving && character.isMoving()) {
            MBM._placeBattler(character, character.x, character.y);
        }
    };

    // Every bystander event banks `n` tiles of movement - roaming Enemy events
    // included, which is what lets them keep their movement options mid-fight.
    // NPCSystem's controllers own the townspeople (they move their events
    // directly rather than through updateSelfMovement), so they get the same
    // grant through their own API, which skips combatant events itself.
    MBM._grantWorldSteps = function (n) {
        if (!MBM.isActive() || n <= 0) return;
        // A townsperson under an NPCController is walked by the controller
        // itself, not by updateSelfMovement, so granting it both budgets would
        // let it take two tiles per world step.
        const controlled = new Set(
            ($gameSystem.npcControllers || []).map(c => c && c.eventId).filter(id => id != null)
        );
        // Player 2's avatar is a combatant, not a bystander: it moves only when
        // its own Move command says so, exactly like the leader.
        const p2 = MBM.p2Event();
        for (const event of $gameMap.events()) {
            if (!event || event === p2) continue;
            if (MBM.isCombatantEvent(event)) continue;
            if (controlled.has(event.eventId())) continue;
            event._mbmSteps = (event._mbmSteps || 0) + n;
        }
        if (window.NPCSystem && window.NPCSystem.grantTacticalSteps) {
            window.NPCSystem.grantTacticalSteps(n);
        }
    };

    MBM._clearWorldSteps = function () {
        for (const event of $gameMap.events()) {
            if (event) event._mbmSteps = 0;
        }
        if (window.NPCSystem && window.NPCSystem.clearTacticalSteps) {
            window.NPCSystem.clearTacticalSteps();
        }
    };

    const _Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function () {
        if (MBM.isActive()) return false;
        return _Game_Player_canMove.call(this);
    };

    // The leader is also a tactical battler during Map Battle Mode; stepping
    // them should not drag the whole formation along like normal map travel.
    // Cancel/Esc belongs to the tactical cursor and the command menu while a
    // map battle runs; Scene_Map would otherwise also read it as "open the
    // pause menu" on the very same frame.
    const _Scene_Map_isMenuEnabled = Scene_Map.prototype.isMenuEnabled;
    Scene_Map.prototype.isMenuEnabled = function () {
        if (MBM.isActive()) return false;
        return _Scene_Map_isMenuEnabled.call(this);
    };

    // The leader is also a tactical battler here, so a step they take is their
    // own move and must not drag the formation along like ordinary map travel.
    // Suppressing the follower train at the source (rather than bypassing
    // Game_Player.moveStraight, which is what v1 did) keeps
    // MovementInteractionSystem's own moveStraight override in the chain, so
    // bridge layering and the swim/climb bookkeeping still run on every
    // tactical step.
    const _Game_Followers_updateMove = Game_Followers.prototype.updateMove;
    Game_Followers.prototype.updateMove = function () {
        if (MBM.isActive()) return;
        _Game_Followers_updateMove.call(this);
    };

    //=========================================================================
    // 3b. Terrain prompts (Map/MovementInteractionSystem.js)
    //
    // Out of battle, pressing OK next to water or a cliff opens the Swim / Fish
    // / Dive / Drink / Climb / Sit prompts. During a map battle OK belongs to
    // the command menu and the tile cursor, and none of those actions has any
    // meaning mid-fight (diving swaps the tileset out from under the grid), so
    // the whole interaction layer stands down for the duration. Swimming still
    // happens, just automatically, as part of a tactical move.
    //=========================================================================

    const _Scene_Map_updateSwimFishInput = Scene_Map.prototype.updateSwimFishInput;
    Scene_Map.prototype.updateSwimFishInput = function () {
        if (MBM.isActive()) return;
        _Scene_Map_updateSwimFishInput.call(this);
    };

    // Also the entry point Player 2 calls directly (updateP2Movement), not just
    // the Player 1 polling path above.
    const _Scene_Map_checkMovementInteraction = Scene_Map.prototype.checkMovementInteraction;
    Scene_Map.prototype.checkMovementInteraction = function (character) {
        if (MBM.isActive()) return;
        _Scene_Map_checkMovementInteraction.call(this, character);
    };

    // Belt and braces for the prompts themselves: an event, a plugin command or
    // another plugin can open one without going through the two hooks above.
    for (const name of [
        "showSwimFishOptions", "showDiveOption", "showResurfaceOption",
        "showNonProcDiveOption", "showNonProcResurfaceOption",
        "showClimbOptions", "showSitOptions", "showChangeSeatOptions"
    ]) {
        const original = Scene_Map.prototype[name];
        if (typeof original !== "function") continue;
        Scene_Map.prototype[name] = function (...args) {
            if (MBM.isActive()) return;
            return original.apply(this, args);
        };
    }

    // Fishing pushes a whole scene, which would tear the battle's windows and
    // HUD out from under it.
    if (window.MovementSystem && typeof window.MovementSystem.performFishing === "function") {
        const _performFishing = window.MovementSystem.performFishing;
        window.MovementSystem.performFishing = function (...args) {
            if (MBM.isActive()) return;
            return _performFishing.apply(this, args);
        };
    }

    //=========================================================================
    // 4. Begin / Finish lifecycle
    //=========================================================================

    MBM.begin = function (troopId, persistentId, eventId, mapId) {
        const BSE = window.BattleSystemEnhanced;
        if (!BSE) return;
        // Re-entry guard: a second Enemy event must never set up a battle on top
        // of the running one, which would leave orphaned windows and HUD cards
        // behind. It is not simply dropped, though - the monster that tried to
        // start its own fight joins this one instead.
        if (MBM._active) {
            const other = $gameMap.event(eventId);
            if (other) MBM.joinEnemyEvent(other);
            return;
        }

        const pData = BSE.State.persistentEnemyData;
        if (!pData[persistentId]) {
            pData[persistentId] = { troopId: troopId, enemyHp: {} };
        }

        $gameMessage._eventActivator = $gameMessage._eventActivator || window._battleActivatorOverride || "p1";
        window._battleActivatorOverride = null;
        $gameSystem._p1PreBattlePos = {
            mapId: $gameMap.mapId(),
            x: $gamePlayer.x,
            y: $gamePlayer.y,
            d: $gamePlayer.direction()
        };
        // Nothing to restore afterwards: unlike a front-view battle, nobody ever
        // leaves the map, so Player 2 simply stays wherever the fight left them.
        $gameSystem._p2PreBattlePos = null;

        BSE.State.currentBattleEventId = persistentId;
        BSE.State.currentEventId = eventId;
        BSE.State.currentMapId = mapId;
        BSE.State.needsRespawn = false;

        MBM._troopId = troopId;
        MBM._persistentId = persistentId;
        MBM._eventId = eventId;
        MBM._mapId = mapId;
        MBM._enemyEvent = $gameMap.event(eventId);
        MBM._moveUsedThisTurn = {};
        MBM._aiTurn = null;
        MBM._activeWalk = null;
        MBM._windowsDeaf = false;
        MBM._deafened = null;
        MBM._enemyEventFor = new Map();
        MBM._combatEnemyEvents = [];
        MBM._allies = [];
        MBM._considered = new Set();
        MBM._hideAllies = false;
        MBM._allyListDirty = true;
        MBM._battleMembersCache = null;
        MBM._roundStarted = false;
        MBM._hpBarKey = "";
        // A fight that never reached _positionParty (no enemy event) must not
        // leave the last one's follower states standing here to be restored.
        MBM._followerThrough = [];

        BattleManager.setup(troopId, false, false);
        // No scene change means Scene_Map.stopAudioOnBattleStart never ran, so
        // BattleManager has no map BGM/BGS on file. Without this, the escape and
        // victory paths' replayBgmAndBgs() would fall through to stopBgm() and
        // silence the map for a fight that never changed the music.
        BattleManager.saveBgmAndBgs();
        // Switch from the map ambient track to the battle BGM, exactly as the
        // normal Scene_Battle start does. The saved BGM above is what gets
        // restored when the fight ends.
        BattleManager.playBattleBgm();

        const spriteset = currentSpriteset();
        MBM._logWindow = new Window_BattleLog(new Rectangle(0, 0, Graphics.boxWidth, 168));
        SceneManager._scene.addWindow(MBM._logWindow);
        BattleManager.setLogWindow(MBM._logWindow);
        BattleManager.setSpriteset(spriteset);
        MBM._logWindow.setSpriteset(spriteset);

        MBM._active = true;

        // The bumped event is the first combatant; every other Enemy event on
        // the map stays a free-roaming bystander until it wanders in.
        MBM._registerEnemyEvent(MBM._enemyEvent, persistentId, troopId, $gameTroop.members());
        MBM._clearWorldSteps();
        MBM._positionParty();
        MBM._preparePet();
        MBM._refreshHpBars();

        // _positionParty() has already settled where everybody stands, so the
        // fight opens on the same frame it was triggered on.
        MBM._beginRounds();
    };

    // The fight proper begins: the volunteers are counted, the cards are dealt
    // and BattleManager builds the first round.
    MBM._beginRounds = function () {
        // Townspeople standing around the brawl decide whether to wade in as
        // soon as the party has taken its positions - before startBattle() builds
        // the first round, so a volunteer acts in it rather than watching it.
        MBM._considerNpcAllies();
        MBM._refreshHpBars();
        BattleManager.startBattle();
    };

    MBM.finish = function () {
        // Snapshot the combatants before _active flips: mapCharacterFor and the
        // split-screen accessors are all gated on the battle still running.
        const combatants = MBM._battlerCharacters();
        // BattleSystemEnhancedState.endBattle only knows about the ONE event the
        // fight started from; settle every monster that joined afterwards here,
        // by the same rules, before the roster is torn down.
        MBM._settleJoinedEnemies();
        MBM._dismissAllies();

        MBM._active = false;

        MBM._closeTalkMenu();
        MBM._closeCursor(null, null);
        MBM._destroyCommandWindows();
        MBM._destroyHpBars();

        if (MBM._logWindow) {
            if (MBM._logWindow.parent) MBM._logWindow.parent.removeChild(MBM._logWindow);
            if (MBM._logWindow.destroy) MBM._logWindow.destroy();
            MBM._logWindow = null;
        }

        // Scene_Battle.terminate() normally does this; since we never pushed a
        // scene there is nothing to terminate, so run its teardown by hand.
        // Without it $gameParty._inBattle stays true for the rest of the session
        // (poisoning everything that branches on inBattle(), from Game_Party's
        // member list to item usability) and no battler ever gets onBattleEnd(),
        // so battle-only states, TP and queued actions survive onto the map.
        $gameParty.onBattleEnd();
        $gameTroop.onBattleEnd();
        // Deliberately not Scene_Battle.terminate's AudioManager.stopMe(): there
        // the victory ME has already played out under the reward messages, which
        // BattleSystemEnhancedState turns into no-ops here, so stopping it would
        // cut the fanfare one frame in. Letting it finish resumes the map BGM by
        // itself.
        //
        // For escape and can-lose defeat, no ME ever plays, so the battle BGM
        // would keep playing on the map forever. Restore the map audio explicitly
        // on those paths by checking whether a ME is currently active. When a ME
        // IS playing (victory fanfare path), AudioManager restores the saved BGM
        // automatically when the ME ends - so we must not call replayBgmAndBgs()
        // here or it would cut the fanfare.
        if (!AudioManager._currentMe || !AudioManager._currentMe.url) {
            BattleManager.replayBgmAndBgs();
        }

        MBM._clearWorldSteps();
        MBM._releaseCombatEvents();
        MBM._restoreFollowerThrough();
        MBM._restorePet();

        // A fight that ended mid-river leaves battlers standing on water tiles.
        // Hand each of them back to MovementInteractionSystem in the right state
        // so nobody walks away swimming on dry land (or drowning on the waves).
        for (const character of combatants) {
            if (!(character instanceof Game_Event)) MBM._syncSwimState(character);
        }

        // Closing ranks is what a marching column does. A Loose party
        // (Core/AutoIdleExplorer.js) has no column to close: gathering there
        // would drag everybody onto the leader's tile the instant the fight
        // ended, undoing the whole point of the formation, so they are left
        // standing where they fought and pick their own lives back up.
        if (!MBM._looseFormation()) $gamePlayer.gatherFollowers();

        MBM._enemyEvent = null;
        MBM._enemyEventFor = new Map();
        MBM._combatEnemyEvents = [];
        MBM._considered = new Set();
        MBM._hideAllies = false;
        MBM._allyListDirty = true;
        MBM._battleMembersCache = null;
        MBM._roundStarted = false;
        MBM._moveUsedThisTurn = {};
        MBM._lastInputActor = null;
        MBM._aiTurn = null;
        MBM._activeWalk = null;
        MBM._windowsDeaf = false;
        MBM._deafened = null;
        MBM._hpBarKey = "";

        // Never actually left Scene_Map, so "returning" from battle is simply
        // re-running its start() hook (already aliased by
        // BattleSystemEnhancedState.js for corpses/respawn/rewards) now that
        // $gameSystem.isBattleEnded() is true.
        //
        // Scene_Map._transfer is set once in create() and never cleared, so on
        // any map the party walked into - which is nearly all of them - the core
        // start() would replay the whole arrival: a fade in from black, the map
        // name banner, an autosave, and $gameMap.autoplay(), which restarts the
        // map BGM over the victory fanfare the audio bookkeeping above just went
        // to some trouble to protect. That transfer finished long ago; the flag
        // is put down for the re-entry and handed straight back, since the scene
        // (and Core/AutoIdleExplorer.js's own start hook) still reads it later.
        const scene = SceneManager._scene;
        const wasTransfer = scene._transfer;
        scene._transfer = false;
        MBM._reentering = true;
        try {
            scene.start();
        } finally {
            scene._transfer = wasTransfer;
            MBM._reentering = false;
        }
    };

    // True only inside the finish() re-entry above. Anything hung off
    // Scene_Map.start that means "the party has just arrived somewhere" - the
    // formation reset in Core/AutoIdleExplorer.js is the one that matters - has
    // to sit this one out: the party has not arrived anywhere, it has been
    // standing on this map fighting.
    MBM._reentering = false;
    MBM.isReentering = function () {
        return !!MBM._reentering;
    };

    //=========================================================================
    // 5. Party positioning
    //
    // The party fights from where it is standing. Whoever bumped the monster
    // holds the tile they bumped it from, and so does every other member who is
    // ON THE SCREEN and within MUSTER_KEEP tiles of them: the fight opens
    // around the scene as the player left it, with no shuffling and no waiting.
    //
    // The one case that has to be handled is the member who is not there at
    // all. A Loose party (Core/AutoIdleExplorer.js) is not a column behind the
    // leader: each member is off living their own life, routinely most of a map
    // away and off the screen entirely. A battler with no line to the field can
    // neither act nor be acted on, so that member is PLACED - put straight down
    // on a muster tile standing MUSTER_MIN..MUSTER_MAX tiles off the nearest
    // monster, near the member already in contact, dry land before water.
    //
    // Two smaller cases go the same way as being absent: a member standing on a
    // tile another combatant already holds (a Close column freshly gathered
    // onto the leader's tile), and one standing somewhere nothing can stand.
    //=========================================================================

    // Free tiles around the enemy to muster the rest of the party on, walking
    // outward one ring at a time so allies land as close to the fight as the
    // terrain allows. `taken` holds tiles that are already spoken for.
    MBM._flankTiles = function (enemy, count, taken) {
        const flanks = [];
        for (let radius = 1; radius <= 3 && flanks.length < count; radius++) {
            for (const d of DIR_LIST) {
                if (flanks.length >= count) break;
                let x = enemy.x, y = enemy.y;
                for (let step = 0; step < radius; step++) {
                    x = $gameMap.roundXWithDirection(x, d);
                    y = $gameMap.roundYWithDirection(y, d);
                }
                if (taken.some(p => p.x === x && p.y === y)) continue;
                if (flanks.some(p => p.x === x && p.y === y)) continue;
                if (!$gameMap.isPassable(x, y, 2) && !$gameMap.isPassable(x, y, 4) &&
                    !$gameMap.isPassable(x, y, 6) && !$gameMap.isPassable(x, y, 8)) continue;
                flanks.push({ x, y });
            }
        }
        return flanks;
    };

    // Every monster the party is forming up against. At the opening bell that is
    // the one event that was bumped; reinforcements (section 9c) join later and
    // are picked up by whatever asks again afterwards.
    MBM._enemyAnchors = function () {
        const list = [];
        for (const entry of MBM._combatEnemyEvents) {
            if (entry.event && !entry.event._erased) list.push(entry.event);
        }
        if (list.length === 0 && MBM._enemyEvent) list.push(MBM._enemyEvent);
        return list;
    };

    MBM._nearestAnchorTo = function (character) {
        let best = null;
        let bestD = Infinity;
        for (const foe of MBM._enemyAnchors()) {
            const d = manhattan(character.x, character.y, foe.x, foe.y);
            if (d < bestD) { best = foe; bestD = d; }
        }
        return best;
    };

    // A tile somebody can stand on: the same "impassable from every side" wall
    // test _flankTiles and the line of sight use.
    MBM._standable = function (x, y) {
        if (!$gameMap.isValid(x, y)) return false;
        return DIR_LIST.some(d => $gameMap.isPassable(x, y, d));
    };

    // The muster tiles themselves: standing off every monster by
    // MUSTER_MIN..MUSTER_MAX tiles, as near as the terrain allows to the member
    // who is already in contact, dry land before water. `blocked` is the set of
    // "x,y" keys already spoken for and is added to as tiles are handed out.
    MBM._musterTiles = function (anchor, count, blocked) {
        if (count <= 0) return [];
        const foes = MBM._enemyAnchors();
        const nearestFoe = (x, y) =>
            foes.reduce((best, f) => Math.min(best, manhattan(x, y, f.x, f.y)), Infinity);

        const candidates = [];
        for (let dy = -MUSTER_SCAN; dy <= MUSTER_SCAN; dy++) {
            for (let dx = -MUSTER_SCAN; dx <= MUSTER_SCAN; dx++) {
                const away = Math.abs(dx) + Math.abs(dy);
                if (away > MUSTER_SCAN) continue;
                const x = $gameMap.roundX(anchor.x + dx);
                const y = $gameMap.roundY(anchor.y + dy);
                if (blocked.has(x + "," + y)) continue;
                if (!MBM._standable(x, y)) continue;
                const foe = nearestFoe(x, y);
                if (foe < MUSTER_MIN || foe > MUSTER_MAX) continue;
                candidates.push({ x, y, away, foe, wet: MBM.isSwimmableWater(x, y) ? 1 : 0 });
            }
        }
        // Dry land first, then the tiles nearest the member already in contact,
        // then the ones nearest the monster: the line forms up around them.
        candidates.sort((a, b) => (a.wet - b.wet) || (a.away - b.away) || (a.foe - b.foe));

        const spots = [];
        for (const c of candidates) {
            if (spots.length >= count) break;
            spots.push({ x: c.x, y: c.y });
            blocked.add(c.x + "," + c.y);
        }
        // A corridor, a cave mouth or a jetty simply may not hold that many
        // tiles at the right stand-off; fall back to the flanking ring so nobody
        // is left without a place to stand.
        if (spots.length < count && MBM._enemyEvent) {
            const taken = [...blocked].map(k => {
                const [x, y] = k.split(",").map(Number);
                return { x, y };
            });
            for (const spot of MBM._flankTiles(MBM._enemyEvent, count - spots.length, taken)) {
                spots.push(spot);
                blocked.add(spot.x + "," + spot.y);
            }
        }
        return spots;
    };

    // Is the party walking itself rather than marching in a column? Loose is
    // the formation that scatters members over the map (Core/AutoIdleExplorer.js).
    // Asked of the option rather than of Loose.anyLoose(), which also answers
    // true for a Close party that merely has a pet trailing it.
    const FORMATION_LOOSE = 1;
    MBM._looseFormation = function () {
        const loose = window.AutoIdleExplorer && window.AutoIdleExplorer.loose;
        if (!loose || typeof loose.mode !== "function") return false;
        return loose.mode() === FORMATION_LOOSE;
    };

    // Can this member fight from the tile they are already standing on? Only if
    // the player can see them, they are near the brawl, the tile is one somebody
    // can stand on, and nobody else has it.
    MBM._holdsPosition = function (character, anchor, taken) {
        if (taken.has(character.x + "," + character.y)) return false;
        // Somewhere nobody can stand: a follower parked inside a wall by the
        // permanent through state it walks the map with, which is exactly where
        // a Close column ends up after a Gather Party. Water is not that - a
        // member who swam out there is legitimately in it and keeps swimming.
        if (!MBM._standable(character.x, character.y) &&
            !MBM.isSwimmableWater(character.x, character.y)) return false;
        if (manhattan(character.x, character.y, anchor.x, anchor.y) > MUSTER_KEEP) return false;
        return MBM._isOnScreen(character);
    };

    MBM._positionParty = function () {
        const enemy = MBM._enemyEvent;
        if (!enemy) return;

        // A Loose party (Core/AutoIdleExplorer.js) is scattered over the map
        // living its own life when the fight opens. Drop every errand and every
        // speech bubble before anything else, or a member walks back to a stale
        // goal the moment the battle ends - and nobody stands in the middle of a
        // battlefield thinking about the flowers.
        const loose = window.AutoIdleExplorer && window.AutoIdleExplorer.loose;
        if (loose && typeof loose.standDown === "function") loose.standDown();

        // Whoever bumped the enemy is the anchor: they are already in contact,
        // and everybody near them is already in the scene. In split-screen that
        // is the load-bearing half, since the partner may be anywhere on the map
        // when the fight opens, and a battler with no line to the field can
        // neither act nor be acted on.
        const activatedByP2 = !!MBM.p2Event() && $gameMessage._eventActivator === "p2";
        const triggerChar = activatedByP2 ? MBM.p2Event() : $gamePlayer;
        MBM._snapCharacter(triggerChar);

        // Real party members only: a volunteer fights from wherever they were
        // standing when they decided to, they are never placed.
        const members = [];
        for (const actor of MBM.withoutAllies(() => $gameParty.battleMembers())) {
            const c = MBM.mapCharacterFor(actor);
            if (!c || c === triggerChar) continue;
            if (typeof c.actor === "function" && !c.actor()) continue;
            if (!members.includes(c)) members.push(c);
        }

        const taken = new Set([triggerChar.x + "," + triggerChar.y]);
        for (const foe of MBM._enemyAnchors()) taken.add(foe.x + "," + foe.y);

        // Two passes, and the order matters: everybody who is staying claims
        // their tile first, so a member who has to be placed is never put down
        // on top of one who was already standing there.
        MBM._followerThrough = [];
        const placing = [];
        for (const character of members) {
            if (character instanceof Game_Follower) {
                // Followers are permanently through-walls outside battle (they
                // have to be, to trail the leader through crowds). As tactical
                // battlers they would walk straight through walls and other
                // combatants, so they are solidified here and put back in
                // finish().
                MBM._followerThrough.push({ follower: character, through: character.isThrough() });
            }
            MBM._snapCharacter(character);
            if (MBM._holdsPosition(character, triggerChar, taken)) {
                taken.add(character.x + "," + character.y);
                MBM._settleBattler(character);
            } else {
                placing.push(character);
            }
        }

        const spots = MBM._musterTiles(triggerChar, placing.length, taken);
        placing.forEach((character, i) => {
            const spot = spots[i];
            // No muster tile to be had (a corridor, a jetty, a cave mouth with
            // the whole party outside it): leaving them where they stand beats
            // dropping them into a wall.
            if (spot) MBM._placeBattler(character, spot.x, spot.y);
            MBM._settleBattler(character);
        });
    };

    // A member has taken their place: solid for the rest of the fight (only the
    // leader keeps whatever through state they walked in with, for a debug pass
    // or a permanently submerged biome), facing the nearest monster, and in the
    // right swim state for the tile they ended up on.
    MBM._settleBattler = function (character) {
        if (character !== $gamePlayer) character.setThrough(false);
        const foe = MBM._nearestAnchorTo(character);
        if (foe) {
            character.setDirection(
                dirBetween(character.x, character.y, foe.x, foe.y) || character.direction()
            );
        }
        MBM._syncSwimState(character);
    };

    // Is the character somewhere the camera can actually show? Takes a plain
    // { x, y } as happily as a character, so a candidate tile can be tested too.
    MBM._isOnScreen = function (pos) {
        const x = $gameMap.adjustX(pos.x);
        const y = $gameMap.adjustY(pos.y);
        return x >= -1 && y >= -1 && x <= $gameMap.screenTileX() && y <= $gameMap.screenTileY();
    };

    // locate() on the leader drags the whole follower train onto their tile
    // (Game_Player.locate synchronizes them), which would undo every muster spot
    // handed out so far; put the followers back where they were standing.
    MBM._placeBattler = function (character, x, y) {
        if (character === $gamePlayer) {
            const saved = $gamePlayer.followers().data()
                .map(f => ({ f, x: f.x, y: f.y, d: f.direction() }));
            character.locate(x, y);
            for (const s of saved) {
                s.f.locate(s.x, s.y);
                s.f.setDirection(s.d);
            }
        } else {
            character.locate(x, y);
        }
        // The tile can be water (a fight on a riverbank), so the arriving battler
        // starts swimming rather than standing on the waves.
        MBM._syncSwimState(character);
    };

    //=========================================================================
    // 5b. Split-screen: one camera for the fight
    //
    // Two half-width viewports cannot show a shared tactical grid, so the split
    // collapses back to a single full-screen camera for the duration and comes
    // back by itself the moment the battle ends (updateSplitScreen re-activates
    // as soon as MBM.isActive() goes false again).
    //=========================================================================

    if (typeof Scene_Map.prototype.updateSplitScreen === "function") {
        const _Scene_Map_updateSplitScreen = Scene_Map.prototype.updateSplitScreen;
        Scene_Map.prototype.updateSplitScreen = function () {
            if (MBM.isActive()) {
                if (this._splitScreenActive) {
                    this.deactivateSplitScreen();
                    // updateSplitViewports left the camera centred on Player 1's
                    // half-width viewport; re-centre it on the full screen or the
                    // battlefield sits off to one side until the leader moves.
                    $gamePlayer.center($gamePlayer.x, $gamePlayer.y);
                }
                return;
            }
            _Scene_Map_updateSplitScreen.call(this);
        };
    }

    MBM._restoreFollowerThrough = function () {
        for (const entry of MBM._followerThrough) {
            if (entry.follower) entry.follower.setThrough(entry.through);
        }
        MBM._followerThrough = [];
    };

    //=========================================================================
    // 6. Per-frame driver
    //=========================================================================

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if (MBM.isActive()) MBM.update();
    };

    MBM.update = function () {
        // A finished turn clears the subject; drop the per-turn AI state here
        // (before BattleManager hands the same battler another turn later in the
        // round) so its next turn re-decides between attacking and approaching.
        if (!BattleManager._subject && MBM._aiTurn) MBM._aiTurn = null;
        // The log window is a child of Scene_Map's window layer, so the scene
        // already updates it; updating it again here would run its method queue
        // twice per frame.
        BattleManager.update(true);
        MBM._updateWalk();
        MBM._updateHpBars();

        // Scene_Battle suspends its own windows while a message or the talk panel
        // is up (isAnyInputWindowActive / updateMessage); Scene_Map has no such
        // notion, and a Window_Selectable stays deaf only if it is deactivated.
        // Without this the one OK press that advances a talk result would ALSO
        // land on the command row the cursor is parked on.
        const overlayOwnsInput = MBM.isTalkMenuOpen() || $gameMessage.isBusy();
        MBM._setWindowsDeaf(overlayOwnsInput);

        if (MBM.isTalkMenuOpen()) {
            MBM._updateTalkInput();
            return;
        }
        if ($gameMessage.isBusy()) return;

        MBM._updateCursorInput();
        MBM._updateActorInput();
    };

    // Mute/unmute the tactical windows without hiding them, so the menu stays
    // readable behind a message box but stops answering input.
    MBM._setWindowsDeaf = function (deaf) {
        if (MBM._windowsDeaf === deaf) return;
        MBM._windowsDeaf = deaf;
        if (deaf) {
            MBM._deafened = [MBM._cmdWindow, MBM._skillWindow, MBM._itemWindow]
                .filter(w => w && w.active);
            MBM._deafened.forEach(w => w.deactivate());
        } else {
            for (const w of MBM._deafened || []) {
                if (w && w.visible) w.activate();
            }
            MBM._deafened = null;
        }
    };

    // Something has to be listening for input; nothing may be selected while a
    // walk animation or a tile cursor is running.
    MBM._isAnyInputActive = function () {
        if (MBM._activeWalk || MBM._cursorState) return true;
        if (MBM.isTalkMenuOpen()) return true;
        return [MBM._cmdWindow, MBM._skillWindow, MBM._itemWindow]
            .some(w => w && w.active && w.visible);
    };

    MBM._updateActorInput = function () {
        if (!BattleManager.isInputting()) {
            if (MBM._lastInputActor) {
                MBM._lastInputActor = null;
                MBM._closeCursor();
                MBM._closeCommandWindow();
                MBM._closeSubWindows();
            }
            return;
        }
        if (!BattleManager.actor()) {
            // Mirrors Scene_Battle.changeInputWindow(): in vanilla turn-based
            // flow startInput() leaves _currentActor null and relies on the
            // scene to walk to the first party member that can input. Under
            // IndividualBattleTurns (isTpb() is forced true) BattleManager
            // assigns the actor itself in updateTpb, so leave it alone there.
            if (!BattleManager.isTpb() && !MBM._isAnyInputActive()) {
                BattleManager.selectNextCommand();
            }
            return;
        }
        if (MBM._lastInputActor !== BattleManager.actor()) {
            MBM._lastInputActor = BattleManager.actor();
            delete MBM._moveUsedThisTurn[BattleManager.actor().actorId()];
            MBM._openCommandWindow(BattleManager.actor());
        }
    };

    //=========================================================================
    // 7. Command window
    //=========================================================================

    function commandWindowRect() {
        const width = 220;
        const margin = 12;
        const height = SceneManager._scene.calcWindowHeight ? SceneManager._scene.calcWindowHeight(5, true) : 300;
        // Window_ActorCommand.refresh (BattleSystemEnhanchedCommands.js) grows the
        // menu upward from the scene's _bseCommandBottomY as commands are added or
        // removed; without it on Scene_Map the list would drift off the bottom edge
        // whenever Move appears or disappears.
        SceneManager._scene._bseCommandBottomY = Graphics.boxHeight - margin;
        return new Rectangle(Graphics.boxWidth - width - margin, Graphics.boxHeight - height - margin, width, height);
    }

    // Window_BattleSkill / Window_BattleItem render through HTML overlays whose
    // update() hides them whenever the backing window has zero width or height,
    // so both need a real rect. Mirrors Scene_Battle's own skill/item rect.
    function subWindowRect() {
        const height = SceneManager._scene.calcWindowHeight ? SceneManager._scene.calcWindowHeight(4, true) : 240;
        return new Rectangle(0, Graphics.boxHeight - height, Graphics.boxWidth, height);
    }

    MBM._openCommandWindow = function (actor) {
        MBM._closeCursor(null, null);
        if (!MBM._cmdWindow) {
            MBM._cmdWindow = new Window_ActorCommand(commandWindowRect());
            SceneManager._scene.addWindow(MBM._cmdWindow);
            MBM._cmdWindow.setHandler("move", MBM._commandMove);
            MBM._cmdWindow.setHandler("attack", MBM._commandAttack);
            MBM._cmdWindow.setHandler("defense", MBM._commandDefense);
            MBM._cmdWindow.setHandler("reload", MBM._commandDefense);
            MBM._cmdWindow.setHandler("skill", MBM._commandSkill);
            MBM._cmdWindow.setHandler("basic", MBM._commandSkillBasic);
            MBM._cmdWindow.setHandler("item", MBM._commandItem);
            MBM._cmdWindow.setHandler("talk", MBM._commandTalk);
            MBM._cmdWindow.setHandler("escape", MBM._commandEscape);
            // processCancel() deactivates the window before calling us; without
            // handing input straight back the turn would be left with nothing
            // listening at all.
            MBM._cmdWindow.setHandler("cancel", () => {
                SoundManager.playBuzzer();
                if (MBM._cmdWindow) MBM._cmdWindow.activate();
            });
        }
        MBM._cmdWindow.x = commandWindowRect().x;
        MBM._cmdWindow.show();
        MBM._cmdWindow.setup(actor);
    };

    MBM._closeCommandWindow = function () {
        if (MBM._cmdWindow) {
            MBM._cmdWindow.hide();
            MBM._cmdWindow.deactivate();
        }
    };

    MBM._closeSubWindows = function () {
        [MBM._skillWindow, MBM._itemWindow].forEach(w => {
            if (!w) return;
            w.hide();
            w.deactivate();
        });
    };

    MBM._destroyCommandWindows = function () {
        [MBM._cmdWindow, MBM._skillWindow, MBM._itemWindow].forEach(w => {
            if (!w) return;
            if (w.parent) w.parent.removeChild(w);
            // Window_ActorCommand/Window_BattleItem's own destroy() (aliased
            // in BattleSystemEnhanchedCommands.js/BattleSystemEnhancedHUD.js)
            // also tears down their HTML overlay <div>, not just the PIXI side.
            if (w.destroy) w.destroy();
        });
        MBM._cmdWindow = null;
        MBM._skillWindow = null;
        MBM._itemWindow = null;
    };

    MBM.canUseMoveCommand = function (actor) {
        if (!MBM.isActive() || !actor) return false;
        if (MBM._moveUsedThisTurn[actor.actorId()]) return false;
        return !!MBM.mapCharacterFor(actor);
    };

    MBM._afterActionSelected = function () {
        const action = BattleManager.inputtingAction();
        if (!action.needsSelection()) {
            BattleManager.selectNextCommand();
            return;
        }
        MBM._startTargeting(action);
    };

    MBM._commandAttack = function () {
        // The command is already greyed out in this case, so this only catches
        // input routed past isCurrentItemEnabled.
        if (!MBM.canUseAttackCommand(BattleManager.actor())) {
            SoundManager.playBuzzer();
            if (MBM._cmdWindow) MBM._cmdWindow.activate();
            return;
        }
        const action = BattleManager.inputtingAction();
        action.setAttack();
        MBM._afterActionSelected();
    };

    MBM._commandDefense = function () {
        const action = BattleManager.inputtingAction();
        action.setSkill(2);
        BattleManager.selectNextCommand();
    };

    // The greyed-out skill/magic/basic rows already buzz at the input layer; this
    // only catches input routed past isCurrentItemEnabled, and keeps an empty
    // list from being opened.
    MBM._commandIsLive = function () {
        const win = MBM._cmdWindow;
        if (!win || !win.isCurrentCommandEnabled) return true;
        if (win.isCurrentCommandEnabled()) return true;
        SoundManager.playBuzzer();
        win.activate();
        return false;
    };

    MBM._commandSkill = function () {
        if (!MBM._commandIsLive()) return;
        const actor = BattleManager.actor();
        if (!MBM._skillWindow) {
            MBM._skillWindow = new Window_BattleSkill(subWindowRect());
            MBM._skillWindow.setHandler("ok", MBM._onSkillOk);
            MBM._skillWindow.setHandler("cancel", MBM._onSkillCancel);
            SceneManager._scene.addWindow(MBM._skillWindow);
        }
        MBM._skillWindow.setActor(actor);
        // A normal skill command clears any lingering Basic view, or the window
        // would keep showing the basic kit for the rest of the fight.
        if (MBM._skillWindow.setBasicMode) MBM._skillWindow.setBasicMode(false);
        MBM._skillWindow.setStypeId(MBM._cmdWindow.currentExt());
        MBM._skillWindow.refresh();
        MBM._skillWindow.show();
        MBM._skillWindow.activate();
        MBM._closeCommandWindow();
    };

    MBM._commandSkillBasic = function () {
        if (!MBM._commandIsLive()) return;
        MBM._commandSkill();
        if (MBM._skillWindow.setBasicMode) MBM._skillWindow.setBasicMode(true);
        MBM._skillWindow.setStypeId(0);
        MBM._skillWindow.refresh();
    };

    MBM._onSkillOk = function () {
        const skill = MBM._skillWindow.item();
        const action = BattleManager.inputtingAction();
        action.setSkill(skill.id);
        BattleManager.actor().setLastBattleSkill && BattleManager.actor().setLastBattleSkill(skill);
        MBM._skillWindow.hide();
        MBM._skillWindow.deactivate();
        MBM._afterActionSelected();
    };

    MBM._onSkillCancel = function () {
        MBM._skillWindow.hide();
        MBM._skillWindow.deactivate();
        MBM._openCommandWindow(BattleManager.actor());
    };

    MBM._commandItem = function () {
        if (!MBM._commandIsLive()) return;
        if (!MBM._itemWindow) {
            MBM._itemWindow = new Window_BattleItem(subWindowRect());
            MBM._itemWindow.setHandler("ok", MBM._onItemOk);
            MBM._itemWindow.setHandler("cancel", MBM._onItemCancel);
            SceneManager._scene.addWindow(MBM._itemWindow);
        }
        MBM._itemWindow.refresh();
        MBM._itemWindow.show();
        MBM._itemWindow.activate();
        MBM._closeCommandWindow();
    };

    MBM._onItemOk = function () {
        const item = MBM._itemWindow.item();
        const action = BattleManager.inputtingAction();
        action.setItem(item.id);
        $gameParty.setLastItem(item);
        MBM._itemWindow.hide();
        MBM._itemWindow.deactivate();
        MBM._afterActionSelected();
    };

    MBM._onItemCancel = function () {
        MBM._itemWindow.hide();
        MBM._itemWindow.deactivate();
        MBM._openCommandWindow(BattleManager.actor());
    };

    MBM._commandTalk = function () {
        MBM._closeCommandWindow();
        if (MBM.openTalkMenu()) return;
        SoundManager.playBuzzer();
        if (BattleManager.actor()) MBM._openCommandWindow(BattleManager.actor());
    };

    MBM._commandEscape = function () {
        const escaped = BattleManager.processEscape();
        // Escape failed (PerfectEscape.js normally makes this unreachable): the
        // attempt still costs the turn, so hand it on as any other action would.
        if (!escaped && !BattleManager.isBattleEnd()) {
            BattleManager.selectNextCommand();
            return;
        }
        // A successful escape has already run endBattle() and moved BattleManager
        // into the "battleEnd" phase, where updateBattleEnd -> MBM.finish() closes
        // the fight down on the next frame. Calling selectNextCommand() from here
        // (as the old code did) walked straight back into the ITBS input machinery
        // instead: finishActorInput() re-armed _subject with the fleeing actor and
        // selectNextActor() went hunting for another inputtable one, so the escape
        // was immediately buried under a fresh turn and Run appeared to do nothing.
        // Tear the input state down explicitly rather than trusting endBattle's
        // cancelActorInput(), which leaves _currentActor pointing at the actor.
        MBM._closeCursor();
        MBM._closeCommandWindow();
        MBM._closeSubWindows();
        MBM._lastInputActor = null;
        MBM._activeWalk = null;
        MBM._aiTurn = null;
        BattleManager._currentActor = null;
        BattleManager._subject = null;
        BattleManager._inputting = false;
    };

    //=========================================================================
    // 8. Tile highlight sprites
    //=========================================================================

    class Sprite_MBMTile extends Sprite {
        constructor(x, y, color) {
            super();
            this._tx = x;
            this._ty = y;
            this.anchor.x = 0.5;
            this.anchor.y = 0.5;
            this.z = 1;
            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            this.bitmap = new Bitmap(tw, th);
            this.bitmap.fillRect(2, 2, tw - 4, th - 4, color);
        }
        update() {
            super.update();
            this.x = tileCenterX(this._tx);
            this.y = tileCenterY(this._ty) - $gameMap.tileHeight() / 2;
        }
    }

    // Each highlight owns a tile-sized Bitmap, and a Move command paints one per
    // reachable tile - a hundred and more on an open field, every turn, for the
    // whole fight. Removing them from the stage is not enough: the texture stays
    // on the GPU until the sprite is destroyed.
    MBM._clearTiles = function () {
        for (const s of MBM._tileSprites) {
            if (s.parent) s.parent.removeChild(s);
            if (s.destroy) s.destroy();
        }
        MBM._tileSprites = [];
    };

    MBM._paintTiles = function (coords, color) {
        const spriteset = currentSpriteset();
        if (!spriteset || !spriteset._tilemap) return;
        for (const [x, y] of coords) {
            const sprite = new Sprite_MBMTile(x, y, color);
            spriteset._tilemap.addChild(sprite);
            MBM._tileSprites.push(sprite);
        }
    };

    //=========================================================================
    // 9. Move command (BFS reachable tiles + adjacent-step cursor)
    //=========================================================================

    MBM._occupiedTiles = function (exceptCharacter) {
        const set = new Set();
        for (const c of MBM._battlerCharacters()) {
            if (c && c !== exceptCharacter) set.add(c.x + "," + c.y);
        }
        return set;
    };

    // Reachable tiles within a movement-point budget, keyed "x,y" -> points
    // spent. Not a plain BFS: water costs WATER_MOVE_COST per tile, so the
    // cheapest route to a tile is not always the one with the fewest steps.
    // Costs are small positive integers, so a bucket queue (one bucket per
    // total cost) is an exact Dijkstra without a heap.
    MBM._bfsReachable = function (character, range) {
        const blocked = MBM._occupiedTiles(character);
        const startKey = character.x + "," + character.y;
        const dist = new Map([[startKey, 0]]);
        const prev = new Map();
        const buckets = [[[character.x, character.y]]];

        for (let cost = 0; cost <= range; cost++) {
            const bucket = buckets[cost];
            if (!bucket) continue;
            for (const [cx, cy] of bucket) {
                // A cheaper route to this tile was found after it was queued.
                if (dist.get(cx + "," + cy) !== cost) continue;
                for (const dir of DIR_LIST) {
                    const nx = $gameMap.roundXWithDirection(cx, dir);
                    const ny = $gameMap.roundYWithDirection(cy, dir);
                    const key = nx + "," + ny;
                    if (blocked.has(key)) continue;
                    const next = cost + MBM.stepCost(nx, ny);
                    if (next > range) continue;
                    if (dist.has(key) && dist.get(key) <= next) continue;
                    if (!MBM._canStep(character, cx, cy, dir)) continue;
                    dist.set(key, next);
                    prev.set(key, cx + "," + cy);
                    (buckets[next] = buckets[next] || []).push([nx, ny]);
                }
            }
        }
        return { dist, prev };
    };

    MBM._commandMove = function () {
        const actor = BattleManager.actor();
        const character = MBM.mapCharacterFor(actor);
        if (!character) { SoundManager.playBuzzer(); MBM._cmdWindow.activate(); return; }

        const range = Math.max(1, Math.floor(actor.agi / MOVE_AGI_DIVISOR));
        const { dist, prev } = MBM._bfsReachable(character, range);
        const coords = [...dist.keys()]
            .filter(k => dist.get(k) > 0)
            .map(k => k.split(",").map(Number));

        MBM._closeCommandWindow();
        MBM._paintTiles(coords, COLOR_MOVE);

        MBM._cursorState = {
            mode: "move",
            character,
            x: character.x,
            y: character.y,
            reachable: dist,
            prev,
            cursorSprite: null
        };
        const spriteset = currentSpriteset();
        if (spriteset && spriteset._tilemap) {
            MBM._cursorState.cursorSprite = new Sprite_MBMTile(character.x, character.y, COLOR_CURSOR);
            spriteset._tilemap.addChild(MBM._cursorState.cursorSprite);
        }
    };

    // Walk the BFS predecessor chain back from a destination key to the tile the
    // character is standing on, yielding the tiles to step through in order.
    MBM._pathFrom = function (prev, character, destKey) {
        const path = [];
        const startKey = character.x + "," + character.y;
        let key = destKey;
        while (key !== startKey) {
            const [x, y] = key.split(",").map(Number);
            path.unshift([x, y]);
            key = prev.get(key);
            if (!key) break;
        }
        return path;
    };

    MBM._updateWalk = function () {
        const walk = MBM._activeWalk;
        if (!walk) return;
        if (walk.character.isMoving()) return;
        if (walk.i >= walk.path.length) {
            MBM._activeWalk = null;
            if (walk.onDone) walk.onDone();
            return;
        }
        const [tx, ty] = walk.path[walk.i];
        const dir = dirBetween(walk.character.x, walk.character.y, tx, ty);
        walk.i++;
        if (dir <= 0) return;
        // Wading in is automatic: the swimmer has to be in swim mode before the
        // step, or MovementInteractionSystem's passability rules reject the
        // water tile the path was already costed for.
        MBM._enterWaterFor(walk.character, tx, ty);
        walk.character.moveStraight(dir);
        MBM._syncSwimState(walk.character);
        if (walk.character.isMovementSucceeded()) {
            // Walking past a monster is how you pick a fight with it: the step
            // that lands next to a bystander drags it in on the spot.
            MBM._scanEnemyEventJoins();
        } else {
            // A bystander that stepped into the path mid-walk: stop here rather
            // than grinding against it for the rest of the queued tiles.
            MBM._activeWalk = null;
            if (walk.onDone) walk.onDone();
        }
    };

    MBM._confirmMove = function () {
        const st = MBM._cursorState;
        if (!st || st.mode !== "move") return;
        const destKey = st.x + "," + st.y;
        if (!st.reachable.has(destKey) || st.reachable.get(destKey) === 0) {
            SoundManager.playBuzzer();
            return;
        }
        const path = MBM._pathFrom(st.prev, st.character, destKey);
        MBM._closeCursor(null, null);
        // The turn can end under the cursor (a slip-damage death, a scripted
        // abort), and Move is then spent on nobody.
        const actor = BattleManager.actor();
        if (actor) MBM._moveUsedThisTurn[actor.actorId()] = true;
        MBM._activeWalk = {
            character: st.character,
            path,
            i: 0,
            onDone: () => {
                if (BattleManager.actor()) MBM._openCommandWindow(BattleManager.actor());
            }
        };
    };

    //=========================================================================
    // 9b. CPU turn: attack when in reach, otherwise close the distance
    //=========================================================================

    // Nobody is choosing this battler's actions by hand: an enemy, a recruited
    // townsperson, or a party member the CPU Party Members option has taken
    // over. All three take the same tactical turn.
    MBM.isAiControlled = function (battler) {
        if (!battler) return false;
        if (battler.isEnemy && battler.isEnemy()) return true;
        if (!battler.isActor || !battler.isActor()) return false;
        if (MBM.isAllyActor(battler)) return true;
        return MBM.isCpuParty() && battler !== $gameParty.leader();
    };

    // True once the battler is allowed to run the action it rolled. Returns
    // false while an approach walk is still playing out, which keeps
    // BattleManager parked on this subject until it has finished moving.
    MBM._updateAiTurn = function (subject) {
        const character = MBM.mapCharacterFor(subject);
        // Troop members past the first have no map position (see the file
        // header's scope note); they are always considered in reach.
        if (!character) return true;

        const state = MBM._aiTurn;
        if (state && state.subject === subject) {
            if (state.done) return true;
            if (MBM._activeWalk) return false;
            state.done = true;
            // The approach is over. Swing only if the new tile actually brought
            // someone into reach, exactly like a party member who spends Move and
            // then picks an action; otherwise the walk was the whole turn.
            if (!MBM._aiActionReaches(subject)) subject.clearActions();
            return true;
        }

        MBM._aiTurn = { subject, done: false };
        if (MBM._aiActionReaches(subject)) {
            MBM._aiTurn.done = true;
            return true;
        }
        if (MBM._startAiApproach(subject, character)) return false;
        // Boxed in with nothing in reach: the turn passes.
        MBM._aiTurn.done = true;
        subject.clearActions();
        return true;
    };

    // Can the action the battler rolled actually land from where it stands? Also
    // pins the action onto a reachable target, otherwise Game_Action's random
    // pick could aim at someone behind a wall.
    MBM._aiActionReaches = function (subject) {
        const action = subject.currentAction();
        // No action left is never blocked by reach.
        if (!action || !action.item()) return true;
        // Scope 14 ("Everyone") answers true to both questions; measure reach
        // against the side the action is really aimed at.
        const forFriend = !action.isForOpponent() && action.isForFriend();
        if (!action.isForOpponent() && !forFriend) return true;
        // Reviving/healing yourself or a downed friend is never a positioning
        // problem worth walking across the map for.
        if (forFriend && action.isForUser()) return true;

        const range = MBM.actionRange(action);
        const unit = forFriend ? subject.friendsUnit() : subject.opponentsUnit();
        const members = unit.members();
        const wantsDead = forFriend && action.isForDeadFriend();
        // isAlive()/isDead() both answer false for a battler that has not
        // appeared or has been hidden (a monster talked round mid-fight), so
        // testing "not dead" would keep aiming at one that is no longer there.
        const reachable = members.filter(b =>
            b && (wantsDead ? b.isDead() : b.isAlive()) && MBM.canReach(subject, b, range));
        if (reachable.length === 0) return false;
        const pick = reachable[Math.floor(Math.random() * reachable.length)];
        action.setTarget(members.indexOf(pick));
        return true;
    };

    // Queue the battler's approach walk, spending at most its own move allowance
    // (the same AGI budget the party's Move command uses). Preference order:
    //   1. a tile it could actually strike from (range AND line of sight)
    //   2. failing that, any tile strictly closer to a target
    // Step 1 matters because raw distance can already be minimal while a wall
    // blocks the shot - scoring on distance alone would leave the battler
    // standing there passing turns forever with its target just out of sight.
    MBM._startAiApproach = function (subject, character) {
        const action = subject.currentAction();
        const forFriend = !!(action && action.item() && action.isForFriend() && !action.isForOpponent());
        const unit = forFriend ? subject.friendsUnit() : subject.opponentsUnit();
        const targets = unit.members()
            .filter(b => b && b !== subject && (forFriend ? true : b.isAlive()))
            .map(b => MBM.mapCharacterFor(b))
            .filter(Boolean);
        if (targets.length === 0) return false;

        const attackRange = (action && action.item())
            ? MBM.actionRange(action)
            : MBM.attackRange(subject);

        const nearest = (x, y) =>
            targets.reduce((best, t) => Math.min(best, manhattan(x, y, t.x, t.y)), Infinity);
        // Built ONCE for the whole search. It used to be rebuilt inside the
        // per-tile test, i.e. (reachable tiles x targets) walks of the whole
        // combatant roster - several thousand list scans per AI turn on an open
        // field, which is a visible hitch every time a monster moves. Passing
        // the target itself is what the per-target build was for, and it buys
        // nothing: hasLineOfSight never tests the endpoint tile.
        const blockers = MBM._sightBlockers(character, null);
        const canStrikeFrom = (x, y) => targets.some(t =>
            manhattan(x, y, t.x, t.y) <= attackRange &&
            MBM.hasLineOfSight(x, y, t.x, t.y, blockers));

        const moveRange = Math.max(1, Math.floor(subject.agi / MOVE_AGI_DIVISOR));
        const { dist, prev } = MBM._bfsReachable(character, moveRange);

        let bestKey = null;
        let bestStrikes = false;
        let bestNear = nearest(character.x, character.y);
        let bestSteps = Infinity;
        for (const [key, steps] of dist) {
            if (steps === 0) continue;
            const [x, y] = key.split(",").map(Number);
            if (canStrikeFrom(x, y)) {
                // Any firing position beats any non-firing one; among them the
                // shortest walk wins so the battler doesn't overshoot.
                if (!bestStrikes || steps < bestSteps) {
                    bestKey = key; bestStrikes = true; bestNear = nearest(x, y); bestSteps = steps;
                }
                continue;
            }
            if (bestStrikes) continue;
            const near = nearest(x, y);
            // Strictly closer wins; ties go to the cheaper walk so the battler
            // doesn't circle its target for the same distance.
            if (near < bestNear || (near === bestNear && bestKey && steps < bestSteps)) {
                bestKey = key; bestNear = near; bestSteps = steps;
            }
        }
        if (!bestKey) return false;

        const path = MBM._pathFrom(prev, character, bestKey);
        if (path.length === 0) return false;
        MBM._activeWalk = { character, path, i: 0, onDone: null };
        return true;
    };

    //=========================================================================
    // 9c. Reinforcements: roaming monsters that wander into the fight
    //
    // Every other "Enemy" event on the map keeps roaming while the battle runs.
    // The moment one ends up within JOIN_RANGE of any combatant it is pulled in:
    // its whole troop is appended to $gameTroop, the event becomes that troop's
    // body on the grid, and the next round deals it turns like any other enemy.
    //=========================================================================

    // Bookkeeping for one Enemy event taking part in the fight. `battlers` are
    // the troop members it brought; the first one owns its tile.
    MBM._registerEnemyEvent = function (event, persistentId, troopId, battlers) {
        if (!event || !battlers || battlers.length === 0) return;
        MBM._snapEvent(event);
        event._mbmCombatant = true;
        event._mbmSteps = 0;
        MBM._enemyEventFor.set(battlers[0], event);
        MBM._combatEnemyEvents.push({
            event,
            eventId: event.eventId(),
            persistentId,
            troopId,
            battlers: battlers.slice()
        });
    };

    // Drag a roaming monster into the running fight. Safe to call with anything:
    // a bystander that is already in, an event with no troop, or a monster that
    // turned up after the battle is already over, all fall out harmlessly.
    MBM.joinEnemyEvent = function (event) {
        if (!MBM.isActive() || !event || event._erased) return false;
        if (!isEnemyEvent(event) || MBM.isCombatantEvent(event)) return false;
        // The fight is already being torn down: a monster arriving now would get
        // a turn nobody is going to run and an HP card nobody removes.
        if (BattleManager._phase === "battleEnd" || BattleManager._phase === "") return false;
        const troopId = event._fixedTroopId;
        const troop = troopId > 0 ? $dataTroops[troopId] : null;
        if (!troop || !troop.members || troop.members.length === 0) return false;

        const persistentId = `${$gameMap.mapId()}_${event.eventId()}`;
        const stored = MBM._persistentHpFor(persistentId);
        const added = [];
        troop.members.forEach((member, index) => {
            if (!$dataEnemies[member.enemyId]) return;
            const enemy = new Game_Enemy(member.enemyId, member.x, member.y);
            if (member.hidden) enemy.hide();
            $gameTroop._enemies.push(enemy);
            // Reinforcements never ran the battle-start pass, so give them the
            // one thing it provides that the round builder needs: a turn-order
            // roll and a clean action slate.
            enemy.onBattleStart();
            if (stored && stored[index] !== undefined) enemy.setHp(stored[index]);
            added.push(enemy);
        });
        if (added.length === 0) return false;
        $gameTroop.makeUniqueNames();

        MBM._registerEnemyEvent(event, persistentId, troopId, added);
        MBM._refreshHpBars();
        MBM._announceJoin(added[0].name(), false);
        return true;
    };

    MBM._persistentHpFor = function (persistentId) {
        const BSE = window.BattleSystemEnhanced;
        const record = BSE && BSE.State.persistentEnemyData[persistentId];
        return record ? record.enemyHp : null;
    };

    // A monster that strayed within JOIN_RANGE of the brawl. Called after every
    // tactical step and after every world step, so walking past a monster during
    // a Move pulls it in exactly as the player would expect.
    MBM.checkEnemyEventJoin = function (event, combatants) {
        if (!MBM.isActive() || !event || MBM.isCombatantEvent(event)) return;
        if (MBM._nearestCombatantDistance(event.x, event.y, combatants) <= JOIN_RANGE) {
            MBM.joinEnemyEvent(event);
        }
    };

    MBM._scanEnemyEventJoins = function () {
        if (!MBM.isActive()) return;
        // One snapshot for the whole sweep: joining rewrites the combatant list,
        // and a monster that arrives mid-sweep must not drag in its neighbours on
        // the same frame (they get their chance on the next world step).
        const combatants = MBM._battlerCharacters();
        for (const event of $gameMap.events()) {
            if (!event || event._erased) continue;
            if (!isEnemyEvent(event) || MBM.isCombatantEvent(event)) continue;
            if (!event._fixedTroopId || event._fixedTroopId <= 0) continue;
            MBM.checkEnemyEventJoin(event, combatants);
        }
    };

    // Restore every combatant event to an ordinary map event.
    MBM._releaseCombatEvents = function () {
        for (const entry of MBM._combatEnemyEvents) {
            if (entry.event) entry.event._mbmCombatant = false;
        }
        for (const ally of MBM._allies) {
            if (ally.event) ally.event._mbmCombatant = false;
        }
    };

    // BattleSystemEnhancedState.endBattle settles the ONE event the fight opened
    // on (corpse, erase-on-win, persist-HP-on-flee). Every monster that joined
    // afterwards is settled here by the same rules, so a reinforcement that died
    // leaves a corpse and stops respawning, and one that survived remembers how
    // badly it was hurt.
    MBM._settleJoinedEnemies = function () {
        const BSE = window.BattleSystemEnhanced;
        if (!BSE) return;
        const mapId = $gameMap.mapId();
        const pData = BSE.State.persistentEnemyData;
        for (const entry of MBM._combatEnemyEvents) {
            // The event the battle opened on is BSE's own business.
            if (!entry.event || entry.eventId === MBM._eventId) continue;
            if (entry.event._erased) continue;
            // A troop member that never appeared (a <hidden> reinforcement slot)
            // counts as settled: it cannot be what is keeping the event alive.
            const wiped = entry.battlers.every(b => !b || b.isDead() || !b.isAppeared());
            if (wiped) {
                // Only something that actually died leaves a body: a monster that
                // was recruited (hidden, still alive) or a reinforcement slot that
                // never appeared is removed without a corpse.
                if (entry.battlers.some(b => b && b.isDead())) MBM._recordCorpse(entry, mapId);
                delete pData[entry.persistentId];
                $gameMap.eraseEvent(entry.eventId);
                if (mapId === 636) {
                    if (!$gameSystem._procGenDefeatedEnemies) $gameSystem._procGenDefeatedEnemies = [];
                    if (!$gameSystem._procGenDefeatedEnemies.includes(entry.eventId)) {
                        $gameSystem._procGenDefeatedEnemies.push(entry.eventId);
                    }
                }
            } else {
                const record = pData[entry.persistentId] ||
                    (pData[entry.persistentId] = { troopId: entry.troopId, enemyHp: {} });
                record.troopId = entry.troopId;
                record.enemyHp = record.enemyHp || {};
                entry.battlers.forEach((b, i) => { if (b) record.enemyHp[i] = b.hp; });
                entry.event.lockMovement(160);
            }
        }
    };

    MBM._recordCorpse = function (entry, mapId) {
        const BSE = window.BattleSystemEnhanced;
        const event = entry.event;
        if (!BSE || !event || !event._characterName) return;
        const troop = $dataTroops[entry.troopId];
        const enemyId = (troop && troop.members[0]) ? troop.members[0].enemyId : 0;
        const colorFn = BSE.Helpers.getCorpseBloodColor;
        BSE.State.mapCorpses.push({
            mapId,
            x: event.x,
            y: event.y,
            spriteName: event._characterName,
            spriteIndex: event._characterIndex,
            hue: event._characterHue || 0,
            bloodColor: colorFn ? colorFn($dataEnemies[enemyId]) : [220, 20, 20],
            enemyId
        });
    };

    //=========================================================================
    // 9d. Volunteers: townspeople who take the party's side
    //
    // Anyone standing near the brawl is judged once. They wade in when the party
    // is genuinely well liked - the median of the per-actor opinions the
    // Empathize panel shows, so one popular member cannot drag in a crowd that
    // dislikes everybody else - or when they are simply brave, which ignores
    // what they think of the party entirely. Cowards and pacifists never do.
    //
    // Once in, they are a proxy actor on the party's side (section 0) whose
    // level, stats, skills and pouch all come straight off the same society
    // profile, and they are driven by the shared tactical AI in 9b.
    //=========================================================================

    function empathizeHelpers() {
        return (window.NPCEmpathize && window.NPCEmpathize._helpers) || null;
    }

    // Is this event a person at all? Society profiles are keyed by event name,
    // and doors, chests and signs are events too - minting one a profile just
    // because it stood near a fight would pollute the whole simulation. An event
    // qualifies when NPCSystem is already walking it, or when it carries the
    // "NPC-<classId>" note every hand-placed townsperson has.
    MBM._isPersonEvent = function (event) {
        const id = event.eventId();
        const controllers = ($gameSystem && $gameSystem.npcControllers) || [];
        if (controllers.some(c => c && c.eventId === id)) return true;
        const data = event.event();
        return !!(data && /NPC-\d+/.test(data.note || ""));
    };

    MBM._npcProfileFor = function (event) {
        const registry = window.NPCSocietyRegistry;
        if (!registry || !event) return null;
        const name = (event.event() && event.event().name || "").trim();
        if (!name || name === "Enemy") return null;
        // An NPC the player has already met has a profile; one they have not is
        // minted here, exactly as opening the Empathize panel on them would.
        let profile = registry.getProfile(name);
        if (!profile && MBM._isPersonEvent(event) && registry.ensureProfile) {
            const helpers = empathizeHelpers();
            const classId = helpers && helpers._extractClassId ? helpers._extractClassId(event) : null;
            profile = registry.ensureProfile(name, classId);
        }
        return profile ? { name, profile } : null;
    };

    // The party's standing with this NPC: the median of what they think of each
    // member individually (NPCEmpathize owns both halves of that maths).
    MBM._npcPartyStanding = function (profile) {
        const helpers = empathizeHelpers();
        if (helpers && helpers._computePartyPredisposition && helpers._medianScore) {
            return helpers._medianScore(helpers._computePartyPredisposition(profile));
        }
        return profile.playerOpinion || 0;
    };

    MBM._isBraveProfile = function (profile) {
        const traitIds = profile.traitIds || [];
        if (TIMID_TRAIT_IDS.some(id => traitIds.includes(id))) return false;
        if (BRAVE_TRAIT_IDS.some(id => traitIds.includes(id))) return true;
        const list = window._NPCSocietyDataLoader && window._NPCSocietyDataLoader.personalities;
        const persona = list && list[profile.personalityIndex];
        return !!persona && persona.name === BRAVE_PERSONALITY;
    };

    MBM._isTimidProfile = function (profile) {
        return TIMID_TRAIT_IDS.some(id => (profile.traitIds || []).includes(id));
    };

    // One pass over the bystanders standing near the fight. Every event is only
    // ever judged once per battle (_considered), so an NPC who decided to stay
    // out does not get re-rolled every round.
    MBM._considerNpcAllies = function () {
        if (!MBM.isActive()) return;
        if (MBM._allies.length >= ALLY_ACTOR_IDS.length) return;
        const combatants = MBM._battlerCharacters();
        for (const event of $gameMap.events()) {
            if (!event || event._erased || isEnemyEvent(event)) continue;
            if (MBM.isCombatantEvent(event) || event === MBM.p2Event()) continue;
            const id = event.eventId();
            if (MBM._considered.has(id)) continue;
            if (MBM._nearestCombatantDistance(event.x, event.y, combatants) > NPC_JOIN_RANGE) continue;
            MBM._considered.add(id);
            const found = MBM._npcProfileFor(event);
            if (!found) continue;
            if (MBM._isTimidProfile(found.profile)) continue;
            const brave = MBM._isBraveProfile(found.profile);
            if (!brave && MBM._npcPartyStanding(found.profile) < NPC_JOIN_OPINION) continue;
            if (!MBM.recruitNpcAlly(event, found.name, found.profile)) continue;
            if (MBM._allies.length >= ALLY_ACTOR_IDS.length) return;
        }
    };

    // Turn a townsperson into a fighting proxy actor. Everything mechanical -
    // level, the eight params, the skill list, the pouch - is read off the
    // society profile, which is exactly what the Empathize panel reads, so an
    // NPC fights like the sheet the player can already inspect.
    MBM.recruitNpcAlly = function (event, npcName, profile) {
        const used = MBM._allies.map(a => a.actorId);
        const actorId = ALLY_ACTOR_IDS.find(id => !used.includes(id));
        if (actorId == null) return false;
        const actor = $gameActors.actor(actorId);
        if (!actor) return false;

        // Clean slate: a proxy re-used from an earlier fight must not keep the
        // previous volunteer's skills, states or wounds.
        actor.setup(actorId);
        actor.setName(npcName);
        if (profile.assignedClassId && $dataClasses[profile.assignedClassId]) {
            actor.changeClass(profile.assignedClassId, true);
        }
        actor.changeLevel(Math.max(1, profile.level || 1), false);
        actor._skills = [];
        for (const skillId of (profile.skillIds || [])) {
            if ($dataSkills[skillId]) actor.learnSkill(skillId);
        }
        actor.setCharacterImage(event.characterName(), event.characterIndex());
        actor._faceName = "";
        actor._faceIndex = 0;

        const record = {
            actorId,
            actor,
            eventId: event.eventId(),
            event,
            npcName,
            profile,
            // Their own pouch, spent from as the fight goes on. The party's
            // inventory is never touched: these are the NPC's own things.
            items: (profile.itemIds || []).filter(id => $dataItems[id])
        };
        MBM._allies.push(record);
        MBM._allyListDirty = true;
        MBM._battleMembersCache = null;

        event._mbmCombatant = true;
        event._mbmSteps = 0;
        MBM._snapEvent(event);
        // The NPC's own controller must stop walking them around: they are a
        // combatant now, and MBM owns where they stand.
        if (window.NPCSystem && window.NPCSystem.clearTacticalSteps) {
            window.NPCSystem.clearTacticalSteps();
        }

        actor.recoverAll();
        actor.onBattleStart();
        actor.clearActions();
        MBM._refreshHpBars();
        MBM._announceJoin(npcName, true);
        return true;
    };

    // Hand every volunteer back to the map: their event becomes an ordinary NPC
    // again and the proxy actor is wiped so the next fight starts it clean.
    MBM._dismissAllies = function () {
        for (const ally of MBM._allies) {
            if (ally.event) {
                ally.event._mbmCombatant = false;
                ally.event._mbmSteps = 0;
            }
            if (ally.actor) {
                ally.actor.clearActions();
                ally.actor.setup(ally.actorId);
            }
        }
        MBM._allies = [];
        MBM._allyListDirty = true;
        MBM._battleMembersCache = null;
    };

    MBM._announceJoin = function (name, friendly) {
        if (!name) return;
        const text = friendly
            ? T('Battle.join.friendly', { name: name })
            : T('Battle.join.hostile', { name: name });
        if (window.ParchmentToast) {
            window.ParchmentToast.show(text, { severity: friendly ? "info" : "warning", duration: 150 });
        } else if (MBM._logWindow) {
            MBM._logWindow.addText(text);
        }
    };

    // A volunteer reaches for their own pouch before their own skills when
    // somebody on the party's side is badly hurt. Called from makeActions, so it
    // slots in ahead of the ordinary auto-battle roll without replacing it.
    MBM._makeAllyItemAction = function (actor) {
        const record = MBM.allyRecordFor(actor);
        if (!record || record.items.length === 0) return false;
        const hurt = $gameParty.battleMembers()
            .filter(b => b && b.isAlive() && b.hpRate() < 0.5)
            .sort((a, b) => a.hpRate() - b.hpRate())[0];
        if (!hurt) return false;
        for (let i = 0; i < record.items.length; i++) {
            const item = $dataItems[record.items[i]];
            if (!item || !actor.canUse(item)) continue;
            const action = new Game_Action(actor);
            action.setItem(item.id);
            if (!action.isForFriend()) continue;
            // Healing is either a recover-HP damage formula or a RECOVER_HP
            // effect; this game's consumables use both spellings.
            const heals = action.isHpRecover() ||
                (item.effects || []).some(e => e && e.code === Game_Action.EFFECT_RECOVER_HP);
            if (!heals) continue;
            if (!MBM.canReach(actor, hurt, MBM.actionRange(action))) continue;
            action.setTarget($gameParty.battleMembers().indexOf(hurt));
            actor.setAction(0, action);
            // Spent from their own supply, never from the party's inventory.
            record.items.splice(i, 1);
            return true;
        }
        return false;
    };

    // Game_Action.item() looks the item up in $dataItems and Game_Battler.consumeItem
    // takes it out of the PARTY's inventory - which the party never had. Skip
    // that one step for a volunteer's own supplies.
    const _Game_Battler_consumeItem = Game_Battler.prototype.consumeItem;
    Game_Battler.prototype.consumeItem = function (item) {
        if (MBM.isActive() && MBM.isAllyActor(this)) return;
        _Game_Battler_consumeItem.call(this, item);
    };

    // Same reason: meetsItemConditions() ends in $gameParty.hasItem(item), and
    // the party has never held any of this. A volunteer's own pouch answers for
    // itself; everything else about usability (occasion, states, cooldowns) still
    // goes through the ordinary check.
    const _Game_BattlerBase_canUse = Game_BattlerBase.prototype.canUse;
    Game_BattlerBase.prototype.canUse = function (item) {
        if (MBM.isActive() && item && DataManager.isItem(item) && MBM.isAllyActor(this)) {
            const record = MBM.allyRecordFor(this);
            if (record && record.items.includes(item.id)) {
                return this.meetsUsableItemConditions(item);
            }
        }
        return _Game_BattlerBase_canUse.call(this, item);
    };

    const _Game_Actor_makeActions_MBM = Game_Actor.prototype.makeActions;
    Game_Actor.prototype.makeActions = function () {
        _Game_Actor_makeActions_MBM.call(this);
        if (MBM.isActive() && MBM.isAllyActor(this) && this.numActions() > 0) {
            MBM._makeAllyItemAction(this);
        }
    };

    //=========================================================================
    // 9e. Round structure and the world step
    //
    // A round is: the party and the troop interleaved by the ordinary turn-order
    // formula (IndividualBattleTurns.js), then the volunteers, then one world
    // step in which everything that is not fighting moves a single tile at once.
    //=========================================================================

    if (typeof BattleManager.makeITBSRound === "function") {
        const _BattleManager_makeITBSRound = BattleManager.makeITBSRound;
        BattleManager.makeITBSRound = function () {
            if (!MBM.isActive()) return _BattleManager_makeITBSRound.call(this);
            // Called once at the top of every round, so this is the seam between
            // rounds - and the only moment the world outside the fight moves.
            if (MBM._roundStarted) MBM.runWorldStep();
            MBM._roundStarted = true;
            // The interleaving in the base builder is party-vs-troop; volunteers
            // are appended whole, after it, so they always act last.
            const round = MBM.withoutAllies(() => _BattleManager_makeITBSRound.call(this));
            const allies = MBM.allyBattlers()
                .filter(a => a && a.isAlive())
                .sort((a, b) => (b._battleAgi || 0) - (a._battleAgi || 0));
            return round.concat(allies);
        };
    }

    // Everything that is not fighting takes exactly one tile, all together:
    // roaming monsters, NPCSystem townspeople, any bystander event with a move
    // type of its own, and the party's pet.
    MBM.runWorldStep = function () {
        if (!MBM.isActive()) return;
        MBM._grantWorldSteps(1);
        MBM._stepPet();
        // Whoever that step brought to the edge of the brawl is now in it. The
        // grant above only banks the steps (they land over the next few frames),
        // so this catches the ones already standing close; the rest are caught
        // by the per-step check in updateSelfMovement.
        MBM._scanEnemyEventJoins();
        MBM._considerNpcAllies();
    };

    //=========================================================================
    // 9f. The party's pet (NPC/PetFollowerSystem.js)
    //
    // The pet is not a battler and never becomes one: it wanders the battlefield
    // one random tile per round, exactly like the bystanders it is standing
    // among. Its normal behaviour (chasing the follower ahead of it) is off for
    // the duration because Game_Followers.updateMove is suspended.
    //=========================================================================

    MBM._petFollower = function () {
        if (typeof Game_PetFollower === "undefined") return null;
        const followers = $gamePlayer && $gamePlayer.followers();
        const data = followers && followers._data;
        if (!data) return null;
        const pet = data.find(f => f instanceof Game_PetFollower);
        return pet && pet.isVisible() ? pet : null;
    };

    // Out of battle the pet walks through everything (that is how it keeps up
    // through a crowd). On the battlefield it has to respect walls and bodies
    // like anyone else, so solidify it and remember to put it back.
    MBM._preparePet = function () {
        const pet = MBM._petFollower();
        MBM._petThrough = null;
        if (!pet) return;
        MBM._petThrough = { pet, through: pet.isThrough() };
        pet.setThrough(false);
    };

    MBM._restorePet = function () {
        if (MBM._petThrough && MBM._petThrough.pet) {
            MBM._petThrough.pet.setThrough(MBM._petThrough.through);
        }
        MBM._petThrough = null;
    };

    MBM._stepPet = function () {
        const pet = MBM._petFollower();
        if (!pet || pet.isMoving()) return;
        const occupied = MBM._occupiedTiles(null);
        const dirs = DIR_LIST.filter(d => {
            const nx = $gameMap.roundXWithDirection(pet.x, d);
            const ny = $gameMap.roundYWithDirection(pet.y, d);
            if (occupied.has(nx + "," + ny)) return false;
            return pet.canPass(pet.x, pet.y, d);
        });
        if (dirs.length === 0) return;
        pet.moveStraight(dirs[Math.floor(Math.random() * dirs.length)]);
    };

    //=========================================================================
    // 10. Targeting (Attack/Skill/Item)
    //=========================================================================

    MBM._candidateTargets = function (action) {
        let pool;
        if (action.isForOpponent()) {
            pool = $gameTroop.members();
        } else if (action.isForFriend()) {
            pool = $gameParty.battleMembers();
        } else {
            pool = [];
        }
        // Not `isDead() === false`: a battler that has not appeared, or one
        // hidden by being talked round mid-fight, answers false to isDead() AND
        // to isAlive(), and must not be offered as a target.
        const wantsDead = action.isForDeadFriend();
        return pool.filter(b => b && (wantsDead ? b.isDead() : b.isAlive()));
    };

    MBM._startTargeting = function (action) {
        const subject = action.subject();
        const subjectChar = MBM.mapCharacterFor(subject);
        const range = MBM.actionRange(action);
        const candidates = MBM._candidateTargets(action)
            .filter(b => MBM.canReach(subject, b, range));

        if (candidates.length === 0) {
            SoundManager.playBuzzer();
            // processOk() already deactivated the command window; hand input
            // back rather than leaving the turn with nothing listening.
            if (BattleManager.actor()) MBM._openCommandWindow(BattleManager.actor());
            return;
        }
        if (candidates.length === 1) {
            MBM._confirmTarget(action, candidates[0]);
            return;
        }

        if (subjectChar) {
            // Only paint tiles the subject can actually hit from here: inside
            // the range diamond and with a clear line to them.
            const blockers = MBM._sightBlockers(subjectChar, null);
            const coords = [];
            for (let dx = -range; dx <= range; dx++) {
                const remain = range - Math.abs(dx);
                for (let dy = -remain; dy <= remain; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const x = subjectChar.x + dx;
                    const y = subjectChar.y + dy;
                    if (!MBM.hasLineOfSight(subjectChar.x, subjectChar.y, x, y, blockers)) continue;
                    coords.push([x, y]);
                }
            }
            MBM._paintTiles(coords, COLOR_RANGE);
        }

        MBM._cursorState = {
            mode: "target",
            action,
            list: candidates,
            index: 0,
            cursorSprite: null
        };
        MBM._refreshTargetCursor();
    };

    MBM._refreshTargetCursor = function () {
        const st = MBM._cursorState;
        if (!st || st.mode !== "target") return;
        const spriteset = currentSpriteset();
        if (!spriteset || !spriteset._tilemap) return;
        if (st.cursorSprite) {
            spriteset._tilemap.removeChild(st.cursorSprite);
            if (st.cursorSprite.destroy) st.cursorSprite.destroy();
            st.cursorSprite = null;
        }
        const battler = st.list[st.index];
        const ch = MBM.mapCharacterFor(battler);
        if (ch) {
            st.cursorSprite = new Sprite_MBMTile(ch.x, ch.y, COLOR_CURSOR);
            spriteset._tilemap.addChild(st.cursorSprite);
        }
    };

    MBM._confirmTarget = function (action, battler) {
        const list = action.isForOpponent() ? $gameTroop.members() : $gameParty.battleMembers();
        action.setTarget(list.indexOf(battler));
        MBM._closeCursor(null, null);
        BattleManager.selectNextCommand();
    };

    //=========================================================================
    // 11. Shared cursor input (Move destination / target cycling)
    //=========================================================================

    MBM._closeCursor = function () {
        MBM._clearTiles();
        const sprite = MBM._cursorState && MBM._cursorState.cursorSprite;
        if (sprite) {
            if (sprite.parent) sprite.parent.removeChild(sprite);
            if (sprite.destroy) sprite.destroy();
        }
        MBM._cursorState = null;
    };

    MBM._updateCursorInput = function () {
        const st = MBM._cursorState;
        if (!st) return;

        if (MBM.inputTriggered("cancel")) {
            MBM.consumeP2Input();
            MBM._closeCursor();
            if (BattleManager.actor()) MBM._openCommandWindow(BattleManager.actor());
            return;
        }
        if (MBM.inputTriggered("ok")) {
            MBM.consumeP2Input();
            if (st.mode === "move") MBM._confirmMove();
            else MBM._confirmTarget(st.action, st.list[st.index]);
            return;
        }

        if (st.mode === "move") {
            for (const dir of DIR_LIST) {
                const key = dir === 2 ? "down" : dir === 4 ? "left" : dir === 6 ? "right" : "up";
                if (MBM.inputTriggered(key)) {
                    const nx = $gameMap.roundXWithDirection(st.x, dir);
                    const ny = $gameMap.roundYWithDirection(st.y, dir);
                    if (st.reachable.has(nx + "," + ny)) {
                        st.x = nx;
                        st.y = ny;
                        // No sprite when the scene has no tilemap yet; the
                        // destination still tracks, it simply is not drawn.
                        if (st.cursorSprite) {
                            st.cursorSprite._tx = nx;
                            st.cursorSprite._ty = ny;
                        }
                    }
                    MBM.consumeP2Input();
                    break;
                }
            }
        } else if (st.mode === "target") {
            if (MBM.inputTriggered("right") || MBM.inputTriggered("down")) {
                st.index = (st.index + 1) % st.list.length;
                MBM.consumeP2Input();
                MBM._refreshTargetCursor();
            } else if (MBM.inputTriggered("left") || MBM.inputTriggered("up")) {
                st.index = (st.index - 1 + st.list.length) % st.list.length;
                MBM.consumeP2Input();
                MBM._refreshTargetCursor();
            }
        }
    };

    //=========================================================================
    // 12. HUD cards (reuse Sprite_BattleBar as-is, parented to Scene_Map)
    //=========================================================================

    // The identity of the current card set. The roster is no longer fixed for
    // the fight (monsters pile in, townspeople take sides, both sides fall), so
    // the cards are rebuilt whenever - and only whenever - this changes.
    MBM._rosterKey = function () {
        const party = $gameParty.battleMembers().map(a => a ? a.actorId() : 0);
        const troop = $gameTroop.members()
            .map((e, i) => (e && e.isAlive() ? i : -1))
            .filter(i => i >= 0);
        return party.join(",") + "|" + troop.join(",");
    };

    MBM._refreshHpBars = function () {
        if (!MBM.isActive()) return;
        const key = MBM._rosterKey();
        if (key === MBM._hpBarKey && MBM._hpBars.length > 0) return;
        MBM._hpBarKey = key;
        MBM._createHpBars();
    };

    MBM._createHpBars = function () {
        MBM._destroyHpBars();
        const scene = SceneManager._scene;
        if (!window.Sprite_BattleBar || !scene) return;

        const W = 200, H = 110, STEP = H - 14;
        const members = $gameParty.battleMembers();
        members.forEach((actor, i) => {
            const sprite = new window.Sprite_BattleBar(actor, true, W, H);
            sprite.x = 90;
            sprite.y = 18 + H + i * STEP;
            sprite._targetY = sprite.y;
            scene.addChild(sprite);
            MBM._hpBars.push(sprite);
        });

        // Reinforcements (section 9c) mean the troop has no fixed size, so the
        // column is cut to what the screen actually holds rather than running
        // the last few cards off the bottom edge.
        const enemyW = 400, enemyStep = 90, enemyTop = 40;
        const maxRows = Math.max(1, Math.floor((Graphics.height - enemyTop) / enemyStep));
        let row = 0;
        $gameTroop.members().forEach(enemy => {
            if (!enemy.isAlive() || row >= maxRows) return;
            const sprite = new window.Sprite_BattleBar(enemy, false, enemyW);
            sprite.x = Graphics.width - enemyW - 40;
            sprite.y = enemyTop + row * enemyStep;
            scene.addChild(sprite);
            MBM._hpBars.push(sprite);
            row++;
        });
    };

    MBM._hpBarTick = 0;

    MBM._updateHpBars = function () {
        // Sprite_BattleBar updates itself via the normal PIXI child update loop
        // (it is added straight to the scene). All that is left is noticing a
        // roster change - a reinforcement, a volunteer, a corpse - and redealing
        // the cards to match. Joining and dying both refresh the cards
        // themselves, so this poll is only a safety net: a few frames of latency
        // on a stale card is invisible, and rebuilding the roster key every frame
        // is not worth it.
        if (++MBM._hpBarTick < 10) return;
        MBM._hpBarTick = 0;
        MBM._refreshHpBars();
    };

    MBM._destroyHpBars = function () {
        for (const sprite of MBM._hpBars) {
            if (sprite.parent) sprite.parent.removeChild(sprite);
            if (sprite.destroy) sprite.destroy();
        }
        MBM._hpBars = [];
    };

    //=========================================================================
    // 13. Skill list: show Range instead of MP/AP cost while active
    //=========================================================================

    const _Window_SkillList_drawSkillCost = Window_SkillList.prototype.drawSkillCost;
    Window_SkillList.prototype.drawSkillCost = function (skill, x, y, width) {
        if (MBM.isActive()) {
            const range = MBM.skillRange(skill);
            this.changeTextColor("#88ccff");
            this.drawText(T('Battle.rangeLabel', { range: range }), x, y, width, "right");
            return;
        }
        _Window_SkillList_drawSkillCost.call(this, skill, x, y, width);
    };

    //=========================================================================
    // 14. Talk menu (NPC/EnemyTalkSystem.js) re-hosted on Scene_Map
    //
    // The whole Chat / Join / Surrender / Insult / Throw Stone / Pet panel is
    // authored on Scene_Battle.prototype. Every one of those handlers works off
    // $gameTroop, $gameMessage and `this._talkEl/_talkOptions/_talkIdx` alone -
    // the only Scene_Battle-specific parts are opening and closing the panel,
    // which reach for _actorCommandWindow / _partyCommandWindow. So the rules
    // are borrowed wholesale by copying those methods onto Scene_Map, and only
    // open/close/input are reimplemented here against the tactical command menu.
    //
    // EnemyTalkSystem loads AFTER this plugin, so the copy happens on first use
    // rather than at load time.
    //=========================================================================

    // Methods lifted verbatim from Scene_Battle. Deliberately excludes
    // openTalkMenu / closeTalkMenu / _updateTalkInput, which are ours below.
    const TALK_BORROWED = [
        "_buildTalkOptions", "_buildTalkPanelHTML", "_updateTalkHighlight", "_talkOk",
        // Which monster of the brawl the panel is addressing. Required here:
        // unlike a front-view troop, a map battle can hold several monsters at
        // once, so without it every handler would fall back to the first one.
        "_talkEnemy",
        "calculateTalkSuccessChance", "calculateTalkSuccess", "calculateJoinSuccessChance",
        "calculatePetSuccessChance", "calculatePetFollowerChance",
        "onTalkChat", "onTalkSurrender", "onTalkInsult", "onThrowStone", "onPet",
        "onTalkJoinParty", "onTalkJoinPet", "onTalkCancel",
        "getArchetypeSprite", "setActorSpriteByArchetype", "resolveRecruitSprite",
        "copyEnemySkillsToActor"
    ];

    MBM.isTalkSystemLoaded = function () {
        return typeof Scene_Battle.prototype.openTalkMenu === "function" &&
            typeof Scene_Battle.prototype._buildTalkOptions === "function";
    };

    function borrowTalkMethods() {
        if (!MBM.isTalkSystemLoaded()) return false;
        for (const name of TALK_BORROWED) {
            const fn = Scene_Battle.prototype[name];
            if (typeof fn === "function" && Scene_Map.prototype[name] !== fn) {
                Scene_Map.prototype[name] = fn;
            }
        }
        return true;
    }

    MBM.isTalkMenuOpen = function () {
        const scene = SceneManager._scene;
        return !!(scene && scene._talkEl && scene._talkEl.parentElement);
    };

    // Talking needs somebody left to talk to. The reach rules deliberately do
    // NOT apply: this mirrors the front-view menu, where range never gated Talk.
    MBM.canUseTalkCommand = function () {
        if (!MBM.isActive()) return false;
        if (!MBM.isTalkSystemLoaded()) return false;
        return $gameTroop.aliveMembers().length > 0;
    };

    // Returns false when the panel could not be opened, so the caller can buzz
    // and hand input back instead of leaving the turn with nothing listening.
    MBM.openTalkMenu = function () {
        if (!MBM.canUseTalkCommand()) return false;
        if (!borrowTalkMethods()) return false;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || MBM.isTalkMenuOpen()) return false;

        scene._talkIdx = 0;
        scene._talkOptions = scene._buildTalkOptions();
        scene._talkHandlers = {
            chat: scene.onTalkChat.bind(scene),
            joinParty: scene.onTalkJoinParty.bind(scene),
            joinPet: scene.onTalkJoinPet.bind(scene),
            surrender: scene.onTalkSurrender.bind(scene),
            insult: scene.onTalkInsult.bind(scene),
            throwStone: scene.onThrowStone.bind(scene),
            pet: scene.onPet.bind(scene),
            cancel: scene.onTalkCancel.bind(scene)
        };

        const el = document.createElement("div");
        el.id = "enemy-talk-panel";
        el.innerHTML = scene._buildTalkPanelHTML();
        document.body.appendChild(el);
        scene._talkEl = el;

        el.addEventListener("mouseover", ev => {
            const row = ev.target.closest(".etalk-option");
            if (!row) return;
            const i = parseInt(row.dataset.idx, 10);
            if (!isNaN(i) && i !== scene._talkIdx) {
                scene._talkIdx = i;
                scene._updateTalkHighlight();
            }
        });
        el.addEventListener("click", ev => {
            const row = ev.target.closest(".etalk-option");
            if (!row) return;
            const i = parseInt(row.dataset.idx, 10);
            if (!isNaN(i)) { scene._talkIdx = i; scene._talkOk(); }
        });
        return true;
    };

    // Scene_Map has no _actorCommandWindow, so the tactical menu is what comes
    // back. Every borrowed handler ends by calling closeTalkMenu(), which is why
    // this must exist on Scene_Map before any of them runs.
    Scene_Map.prototype.closeTalkMenu = function () {
        MBM._closeTalkMenu();
    };

    MBM._closeTalkMenu = function () {
        const scene = SceneManager._scene;
        if (!scene) return;
        if (scene._talkEl) {
            scene._talkEl.remove();
            scene._talkEl = null;
        }
        scene._talkOptions = null;
        scene._talkHandlers = null;
        // A recruit/surrender ends the battle from inside the handler; there is
        // no turn left to hand back to in that case.
        if (MBM.isActive() && BattleManager.actor()) {
            MBM._openCommandWindow(BattleManager.actor());
        }
    };

    // Same keys as the front-view panel, routed through the split-screen shim so
    // Player 2 can work the panel on their own actor's turn.
    MBM._updateTalkInput = function () {
        const scene = SceneManager._scene;
        const opts = scene && scene._talkOptions;
        if (!opts || opts.length === 0) return;
        if (MBM.inputTriggered("down")) {
            MBM.consumeP2Input();
            if (scene._talkIdx < opts.length - 1) {
                scene._talkIdx++;
                SoundManager.playCursor();
                scene._updateTalkHighlight();
            }
        } else if (MBM.inputTriggered("up")) {
            MBM.consumeP2Input();
            if (scene._talkIdx > 0) {
                scene._talkIdx--;
                SoundManager.playCursor();
                scene._updateTalkHighlight();
            }
        } else if (MBM.inputTriggered("ok")) {
            MBM.consumeP2Input();
            scene._talkOk();
        } else if (MBM.inputTriggered("cancel")) {
            MBM.consumeP2Input();
            SoundManager.playCancel();
            scene.onTalkCancel();
        }
    };

    // EnemyTalkSystem's own plugin command does SceneManager._scene.openTalkMenu()
    // whenever $gameParty.inBattle(); during a map battle that scene is Scene_Map,
    // so give it the entry point it expects (common event 137 "TalkToEnemy").
    Scene_Map.prototype.openTalkMenu = function () {
        MBM.openTalkMenu();
    };

    // Add the Talk row to the tactical command menu. In Peaceful difficulty
    // PeacefulMode already adds one (its alias wraps this one, so it appends
    // after us and would otherwise leave two Talk rows stacked up); there it
    // stays the owner and this only supplies the handler, above.
    const _Window_ActorCommand_makeCommandList_MBM = Window_ActorCommand.prototype.makeCommandList;
    Window_ActorCommand.prototype.makeCommandList = function () {
        _Window_ActorCommand_makeCommandList_MBM.call(this);
        if (!MBM.isActive() || !this._actor) return;
        if (typeof this.addCommandWithIcon !== "function") return;
        if (!MBM.isTalkSystemLoaded()) return;
        if (window.PeacefulMode && window.PeacefulMode.isActive && window.PeacefulMode.isActive()) return;
        if (this._list.some(cmd => cmd.symbol === "talk")) return;
        this.addCommandWithIcon(T('PeacefulMode.cmd.talk'), "talk", MBM.canUseTalkCommand(), null, 4);
        // Talk leads, the same position PeacefulMode gives it in front view.
        this._list.unshift(this._list.pop());
    };
})();
