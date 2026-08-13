/*:
 * @target MZ
 * @plugindesc v1.4.0 Auto Idle Explorer + Party Formation, the CPU explores for an idle player, and a loose party lives its own life.
 * @author esoteric-heavy-industries & Assistant
 *
 * @help AutoIdleExplorer.js
 *
 * Two independent features, both on the Gameplay tab of the Options menu.
 *
 * ============================================================================
 * 1. PARTY FORMATION (Close / Loose), default Loose
 * ============================================================================
 *
 * Close is the marching column every RPG Maker game ships with: each member
 * walks in the leader's exact footsteps, one tile back, and never stops.
 *
 * Loose cuts that rope. The other members keep the leader company rather than
 * following them:
 *
 *   • They live their own lives around the leader and head back only once they
 *     have been carried OFF THE SCREEN, picking their own way with the engine's
 *     A* pathfinding and respecting the terrain (in Close they walk through
 *     everything, as always). The screen is the leash: a member the player can
 *     see has not been left behind, however many tiles of a wide map lie between
 *     them, so walking about near the party never drags anybody back into line.
 *     One left a good way past the edge (`looseSnap` tiles) is simply put back
 *     at the leader's shoulder rather than made to walk the whole way.
 *   • Between walks they take up an activity the way an NPC does: standing and
 *     thinking, going over to look at something, or walking up to a person on
 *     the map and holding a short conversation with them. A conversation is a
 *     real one: it moves what that person thinks of THAT member (their own
 *     standing, not the party's) up or down, and the state of the member doing
 *     the talking is part of it, so somebody who has not washed in three days
 *     is worse company. They stroll within `looseLeash` tiles of the leader.
 *   • They talk to EACH OTHER as readily as to the town, the leader included:
 *     roughly half the time a member looking for company turns to their own
 *     first. That conversation has two sides, so both ledgers move, each of
 *     them comes away thinking a little more (or a little less) of the other,
 *     on the same per-member standing the Empathize panel shows. How much they
 *     have in common and how either of them smells decide which way it goes.
 *   • They look after themselves, off the very same capability registry the
 *     town's NPCs use (NPC/NPCSimulationCore.js), so a party member and a
 *     townsperson recognise a washroom by one rule and the table that teaches
 *     one teaches the other. A meter under 35% sends that member looking:
 *       hunger  eats the smallest thing in the pack that covers it
 *       hygiene walks to a WC / bathroom / shower / sink / fountain
 *       fun     walks to an arcade cabinet, a piano, a pool table
 *       company walks up to a person and talks to them
 *       sleep   rents a free room with the party's money (the door then opens
 *               for everybody), or sits down on a region 102 rest tile
 *     Everything they do to a meter, every room rented, every meal eaten and
 *     every opinion moved is announced as a toast, because it happens while
 *     the player is looking somewhere else.
 *   • A SPRINT calls them in, and only a sustained one: two seconds of running
 *     before the column forms, so a dash through a doorway is not a recall.
 *     What forms is the engine's own caterpillar: whoever is already within a
 *     tile of the person in FRONT of them is handed straight back to the
 *     vanilla chase, so they trail one behind the other in the leader's exact
 *     footsteps; anybody further back runs to that same shoulder, never to the
 *     leader, so the party strings out into a line instead of piling onto the
 *     one they are all following. They hold it for as long as the sprint lasts
 *     and come apart the moment it ends. Walking never calls them in at all,
 *     which is what makes Loose the party living its own life rather than a
 *     column with a longer rope. One member calls after the leader when it
 *     happens, rarely.
 *   • Sometimes they simply walk WITH the leader for a while of their own
 *     accord, keeping a couple of tiles off their shoulder at the leader's own
 *     pace, and then go back to their own business. They amble a notch under
 *     the leader's speed otherwise, hurry when they are out of sight, and now
 *     and then take a turn of speed for no reason at all.
 *   • They swim. A member cut off by water, or following a leader who has swum
 *     off, gets in and swims across it (region 99, or a water tile on the
 *     procedural map) and climbs out on the far bank. They never DIVE: going
 *     under is the player's business.
 *   • They are gathered up automatically when the player returns from a
 *     battle, takes a transfer event, or changes map: each member is placed on
 *     a free tile around the leader rather than left behind on the old map.
 *   • Stand facing one and press OK to talk to them: that opens their
 *     Empathize panel directly, the same sheet the Dynamics roster opens.
 *
 * PETS AND FOLLOWERS ARE ALWAYS LOOSE. The extra trailing slot owned by
 * NPC/PetFollowerSystem.js (a pet, a child, or a creature that came along of its
 * own accord) is not a party member marching in a column: it keeps to itself on
 * every map whatever the option says, and Close applies only to the party. It
 * wanders, visits and looks like everyone else, but it says none of the party's
 * chatter, and it comes when the leader runs like everyone else.
 *
 * The loose behaviour stands down wherever the party has to act as one body:
 * in a vehicle, in split-screen, while an event or a message is running, and
 * whenever anything calls Gather Party (the members close ranks the vanilla
 * way, then scatter again once it is over).
 *
 * It also stands down for a MAP BATTLE (BattleSystem/MapBattleMode.js), where
 * every member becomes a tactical battler that MapBattleMode walks itself, tile
 * by tile. Close formation stands down there too: its through-walls followers
 * would otherwise walk straight through the wall they are meant to be taking
 * cover behind. A fight opening on a scattered party calls standDown() below,
 * so nobody comes back from the battlefield to an errand they had forgotten.
 *
 * ============================================================================
 * 2. AUTO IDLE EXPLORER, default OFF
 * ============================================================================
 *
 * Adds an "Auto Idle Explorer" toggle to the Gameplay tab of the Options menu
 * (default OFF, persisted in the global config).
 *
 * When the option is ON and the player stands still on a normal map for more
 * than the configured number of seconds (default 5), the CPU takes over:
 *
 *   • It navigates the map with the engine's built-in A* pathfinding
 *     (the same routine the NPC system relies on for goal seeking).
 *   • It walks up to nearby events (NPCs, objects, doors) and interacts with
 *     them, preferring roaming enemy events so battles get started.
 *   • It advances dialogue boxes automatically (fast-forwarding the typewriter
 *     and tapping through each page), answers "Show Choices" with a random
 *     option, confirms number entry, and picks an item for "Select Item".
 *   • Battles are resolved automatically using each actor's auto-battle AI.
 *   • Between actions it keeps the party alive by casting healing skills or
 *     using healing items, and eats food when the party is hungry
 *     (when TimeDateSystem is present).
 *   • Best-effort: it leaves standard shop scenes after a moment.
 *
 * Needs & menu profiles: the CPU keeps a table of "menu profiles" describing
 * what each menu is FOR. Every think-cycle it reads the party's stats (HP,
 * hunger, sleep, gold, bounty) and walks the profiles by priority; the first
 * profile whose need is met is fulfilled. Built-in profiles cover healing
 * (spell, then a healing item applied directly), eating, and stat-gated
 * templates for the Cooking and Work menus. A menu is only opened when it is
 * genuinely needed AND the CPU can operate it, it never opens a menu just to
 * leave it unused.
 *
 * Menu compatibility: if the CPU triggers ANY menu it does not need, or cannot
 * drive, a custom plugin scene, or a DOM-overlay menu (quest log, Hypernet OS,
 * work board, bestiary, vending machine, etc.), it dismisses it generically so
 * exploration resumes. It does this by:
 *
 *   1. Asking a matching profile to close itself programmatically (most
 *      reliable), then
 *   2. Falling back to a synthetic Cancel/Escape keypress dispatched to the
 *      document. That press reaches both the engine's Input system and any
 *      plugin listening on `document` directly, matching the project standard
 *      that every menu closes on escape/cancel. If a menu still refuses to
 *      close after several tries, the autopilot relinquishes control.
 *
 * Teach the CPU about a menu by registering a profile once at load time. Give it
 * a stat-based need and how to open/operate it so the CPU uses it only when it
 * helps; add close for a clean exit:
 *
 *   AutoIdleExplorer.registerMenu({
 *       id: "myShop",
 *       purpose: "Buy potions when low on healing items.",
 *       need:   (s) => s.injured,              // stat-based: when to use it
 *       open:   () => MyPlugin.openShop(),     // how to open it
 *       drive:  (scene) => MyPlugin.autoBuy(), // operate it; false when done
 *       isOpen: () => MyPlugin.isOpen(),       // true while it owns the screen
 *       close:  () => MyPlugin.close(),        // optional clean dismissal
 *   });
 *
 * The stats object passed to need()/drive() exposes: injured, minHpRate, hunger,
 * hungerRate, hungry, sleep, gold, broke, bounty.
 *
 * The instant the player presses a movement key, confirm/cancel, or taps the
 * screen, control is handed straight back and the autopilot disengages until
 * the next idle period.
 *
 * Two-player split-screen: when SplitScreenMultiplayer.js has an active local
 * session and Player 2 sits idle for the same number of seconds, the CPU takes
 * over Player 2 as well, walking the P2 event around with A* pathfinding and
 * triggering nearby events (enemies first). It works by feeding synthetic input
 * into the split-screen manager, so every existing P2 rule (touch triggers,
 * action interaction, swimming, world-map distance limits) still applies. The
 * moment a real P2 key or gamepad input is used, Player 2 control is returned.
 *
 * Requires GameOptions.js for the menu entry (falls back to a plain option
 * row if GameOptions is not present). All other integrations are optional and
 * feature-detected, so the plugin is safe to load anywhere after GameOptions.
 *
 * Diagnostics: window.AutoIdleExplorer.why() reports, in one string, why the
 * autopilot is not currently driving (option off, a message up, an event
 * running, still counting idle frames, ...). window.AutoIdleExplorer.loose
 * exposes the formation controller.
 *
 * @param looseLeash
 * @text Loose Wander Radius (tiles)
 * @desc How far from the leader a party member strolls while idling in Loose formation. Coming back is decided by the screen.
 * @type number
 * @min 2
 * @max 40
 * @default 7
 *
 * @param looseSnap
 * @text Loose Snap Margin (tiles)
 * @desc Tiles past the edge of the screen before a member left behind is simply put back beside the leader.
 * @type number
 * @min 4
 * @max 60
 * @default 10
 *
 * @param looseChatter
 * @text Loose Chatter
 * @desc Show the speech bubbles a loose party member trades with the people they walk up to.
 * @type boolean
 * @default true
 *
 * @param idleSeconds
 * @text Idle Seconds
 * @desc Seconds the player must be idle before the CPU takes over.
 * @type number
 * @min 1
 * @max 60
 * @default 5
 *
 * @param healThreshold
 * @text Heal Threshold (%)
 * @desc Heal a party member when its HP drops below this percentage.
 * @type number
 * @min 1
 * @max 100
 * @default 50
 *
 * @param hungerThreshold
 * @text Hunger Threshold (%)
 * @desc Eat food when hunger (Variable 54) drops below this percentage. Needs TimeDateSystem.
 * @type number
 * @min 0
 * @max 100
 * @default 35
 *
 * @param moneyFloor
 * @text Money Floor (gold)
 * @desc The CPU considers itself "broke" below this much gold (drives money-earning menus like Work). 0 disables.
 * @type number
 * @min 0
 * @default 200
 *
 * @param scanRadius
 * @text Interaction Scan Radius
 * @desc How many tiles around the player to scan for events to interact with.
 * @type number
 * @min 3
 * @max 30
 * @default 12
 *
 * @param showBadge
 * @text Show "AUTO" Badge
 * @desc Display a small on-screen badge while the CPU is in control.
 * @type boolean
 * @default true
 */

(() => {
    "use strict";

    const PLUGIN = "AutoIdleExplorer";
    const params = PluginManager.parameters(PLUGIN);
    const IDLE_FRAMES = Math.max(1, Math.round((Number(params.idleSeconds) || 5) * 60));
    const HEAL_RATE = (Number(params.healThreshold) || 50) / 100;
    const HUNGER_RATE = (Number(params.hungerThreshold) || 35) / 100;
    const SCAN_RADIUS = Number(params.scanRadius) || 12;
    const SHOW_BADGE = params.showBadge !== "false";
    const MONEY_FLOOR = Number(params.moneyFloor) || 0; // 0 = never "broke"

    const BOUNTY_VAR = 66; // Crime bounty (euros)

    // ---------------------------------------------------------------- formation
    const FORM_CLOSE = 0;
    const FORM_LOOSE = 1;
    const LOOSE_CHATTER = params.looseChatter !== "false";
    // The party keeps to itself unless the leader is really covering ground.
    // A SPRINT calls them in, but not the instant it starts: two seconds of it
    // (RECALL_RUN), so a hop over a puddle or a dash through a doorway is not a
    // recall. They then hold the column for as long as the sprint lasts and let
    // go the moment it ends, give or take the frame or two of RECALL_DROP that
    // separate one dashed step from the next.
    const RECALL_RUN  = 120;
    const RECALL_DROP = 20;
    // How the column is shaped once they have been called in. A member within
    // this many tiles of the person in FRONT of them is already in the file and
    // is left entirely to the engine's own caterpillar chase, which walks them
    // into the tile that person is leaving. Anybody further back closes on that
    // same shoulder, not on the leader, so the party trails behind in a line
    // rather than piling onto the one they are all following.
    const COLUMN_GAP = 1;
    // "Wait for me!" is for the moment they are left behind, not for every
    // sprint: one member says it, rarely, and not again for a good while.
    const RECALL_CRY_ODDS = 0.3;
    const RECALL_CRY_COOL = 1800;
    // Tagging along of their own accord: how often a member chooses it over an
    // errand, how long they stay at the leader's shoulder, and how close they
    // keep. Plus the odd turn of speed, whatever they are doing.
    const FOLLOW_ODDS      = 0.3;
    const FOLLOW_MIN       = 240;   // 4 seconds
    const FOLLOW_MAX       = 1200;  // 20 seconds
    const FOLLOW_NEAR      = 2;
    const FOLLOW_DASH_ODDS = 0.25;
    // What tells a member they have been left behind is the SCREEN, not a tile
    // count: somebody the player can see is not lost, however far across a wide
    // map they have wandered, and a leader walking about near them should never
    // drag them back into line. These two are margins measured from the edge of
    // the screen outward, in tiles: one to head back, one to be put back.
    const LOOSE_SIGHT_MARGIN = 1;
    const LOOSE_SNAP_MARGIN = Math.max(4, Number(params.looseSnap) || 10);
    // Once heading back, keep walking until this far INSIDE the edge again, so a
    // member does not stop dead on the rim and drift straight back out of it.
    const LOOSE_BACK_INSET = 2;
    // A stroll stays a stroll: this is how far a member sets out to go, which is
    // not the same question as when they come back.
    const LOOSE_ROAM = Math.min(Math.max(2, Number(params.looseLeash) || 7), 12);

    // ------------------------------------------------------------------ needs
    // A loose member attends to themselves the way the town's NPCs do, off the
    // very same capability registry (NPC/NPCSimulationCore.js): a washroom for
    // hygiene, an arcade cabinet for fun, a bed for the night, a person to talk
    // to for company. What each thing on the map is good for is answered in one
    // place, NPCSim.InteractionScanner, so teaching the town teaches the party.
    const NEED_LOW    = 35;   // a meter at or under this sends a member looking
    const NEED_SCAN   = 14;   // tiles they will walk to attend to one
    const NEED_TRIES  = 140;  // steps before an errand is written off
    const NEED_RETRY  = 300;  // frames before a fruitless search is tried again
    const REST_REGION = 102;  // the region NPCs sit and rest on
    // What one visit to the right place is worth. Deliberately partial: a bath
    // is not a spa day, and the meter has to be worth topping up again later.
    const NEED_FILL   = { hygiene: 45, leisure: 35, social: 18, sleep: 55, comfort: 25 };
    // A meal is taken from the pack the moment it is wanted, so hunger is the
    // one need with no errand attached to it.
    const HUNGER_EAT  = 45;
    const LOOSE_SCAN = 9;     // tiles a member looks around for company
    // How often a member looking for company looks to their OWN first, the
    // leader or whoever else is walking with them, rather than to the town. A
    // party that only ever talks to strangers reads as a column of strangers.
    const PARTY_TALK_ODDS = 0.45;
    const VISIT_COOLDOWN = 1200; // frames before a member calls on the same face again
    const BUBBLE_MS = 3400;   // how long one line of chatter stays up

    // Watchdog / dismissal tuning for arbitrary external plugin menus.
    const BLOCK_LIMIT = 240;  // frames the map may stay un-drivable (no message,
                              // no detected overlay) before we poke Cancel.
    const MAX_DISMISS = 6;    // give up dismissing after this many tries → relinquish.
    const DISMISS_COOL = 45;  // frames between dismiss attempts (~0.75s).
    const KEYUP_DELAY = 5;    // frames a synthetic key is held before release.
    const OVERLAY_IGNORE = 1800; // frames an undismissable DOM element is ignored.
    const OVERLAY_MIN_AREA = 0.22; // of the viewport, before a node counts as a menu.
    const DEST_STALL = 60;    // frames a stale touch destination may block engaging.

    // ========================================================================
    // Menu profiles, the autopilot's understanding of what each menu is FOR.
    // ------------------------------------------------------------------------
    // Every entry teaches the CPU about one menu so it can decide, from the
    // party's current stats, whether it actually needs to use that menu. Fields
    // (all optional except a purpose to act on):
    //
    //   id        unique string id.
    //   label     short human name.
    //   purpose   one-line description of what the menu is for.
    //   priority  higher = considered first when several needs compete.
    //   need(s)   given a stats snapshot (see gatherStats), return true when the
    //             CPU genuinely needs this menu right now. No need → never used.
    //   act(s)    fulfil the need directly WITHOUT a menu (preferred when
    //             possible, e.g. casting a heal). Return true if it acted.
    //   open(s)   open the menu (push its scene / call its command).
    //   drive(sc) operate the OPEN menu toward the goal; return true while still
    //             working, false when finished (then it is closed). A menu is
    //             only opened proactively when it can be driven (has act, drive,
    //             or driven:true).
    //   driven    true if an existing scene hook already operates it (e.g. the
    //             built-in Scene_Menu/Scene_Item handlers).
    //   isOpen()  true while this menu owns the screen (for dismissal/driving).
    //   close()   dismiss it programmatically (else a synthetic Escape is used).
    //   cooldown  frames to wait before using this menu again (default 1800/30s).
    //   enabled   set false (or feature-detect) to skip the profile entirely.
    //
    // Plugins/menus can add their own at load time:
    //   AutoIdleExplorer.registerMenu({
    //       id: "myMenu", purpose: "…", need: s => s.broke,
    //       isOpen: () => MyUI.visible, open: () => MyUI.show(),
    //       drive: () => MyUI.step(), close: () => MyUI.hide(),
    //   });
    // Unknown DOM overlays / custom scenes are still dismissed generically with
    // a synthetic Cancel/Escape keypress even without a profile.
    // ========================================================================
    const MENU_PROFILES = [];

    // ========================================================================
    // Menu navigation state, tracks the CPU's journey through Scene_Menu/Item.
    // ========================================================================
    const MenuNav = {
        intent: null,        // 'item' | null
        targetItem: null,    // $dataItems entry to use
        targetMember: null,  // Game_Actor to target
        phase: 'idle',       // 'idle'|'command'|'category'|'item'|'actor'|'done'
        delay: 0,
        timeout: 0,

        clear() {
            this.intent = null;
            this.targetItem = null;
            this.targetMember = null;
            this.phase = 'idle';
            this.delay = 0;
            this.timeout = 0;
        },
    };

    // ========================================================================
    // ConfigManager persistence. The autopilot is off by default; the party
    // walks Loose by default, Close being the option a player asks for.
    // ========================================================================
    ConfigManager.autoIdle = false;
    ConfigManager.partyFormation = FORM_LOOSE;

    const _makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _makeData.call(this);
        config.autoIdle = this.autoIdle;
        config.partyFormation = this.partyFormation;
        return config;
    };

    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _applyData.call(this, config);
        this.autoIdle = config.autoIdle !== undefined ? config.autoIdle : false;
        this.partyFormation = config.partyFormation !== undefined
            ? (Number(config.partyFormation) | 0)
            : FORM_LOOSE;
    };

    // ========================================================================
    // Options menu entry (Gameplay tab).
    // ========================================================================
    // Both labels are passed as functions so the rows re-read themselves when
    // the player changes language without leaving the menu.
    const formationNames = () => T.list('AutoIdle.formation.states');

    if (window.GameOptions && typeof GameOptions.registerOption === "function") {
        GameOptions.registerOption(
            "autoIdle",
            () => T('AutoIdle.optionName'),
            () => ConfigManager.autoIdle,
            (value) => { ConfigManager.autoIdle = value; if (!value) AutoIdle.disengage(); },
            "gameplay",
            "boolean"
        );
        // Party formation is a two-state select (Close / Loose), so it carries
        // its own status text and cursor handlers rather than toggling.
        GameOptions.registerOption(
            "partyFormation",
            () => T('AutoIdle.formation.label'),
            () => ConfigManager.partyFormation | 0,
            (value) => { ConfigManager.partyFormation = value | 0; Loose.onModeChanged(); },
            "gameplay",
            "boolean",
            (value) => formationNames()[value | 0] || formationNames()[FORM_CLOSE],
            function () {
                const v = ((this.getConfigValue('partyFormation') | 0) + 1) % 2;
                this.setConfigValue('partyFormation', v);
            },
            function () {
                const v = ((this.getConfigValue('partyFormation') | 0) + 1) % 2;
                this.setConfigValue('partyFormation', v);
            }
        );
        const tab = GameOptions.tabs.find((t) => t.id === "gameplay");
        if (tab && !tab.symbols.includes("autoIdle")) tab.symbols.push("autoIdle");
        if (tab && !tab.symbols.includes("partyFormation")) tab.symbols.push("partyFormation");
    } else {
        // Fallback: append to the vanilla options list.
        const _addGeneral = Window_Options.prototype.addGeneralOptions;
        Window_Options.prototype.addGeneralOptions = function () {
            _addGeneral.call(this);
            this.addCommand(T('AutoIdle.optionName'), "autoIdle");
            this.addCommand(T('AutoIdle.formation.label'), "partyFormation");
        };
    }

    // ========================================================================
    // Helpers
    // ========================================================================
    function onDrivableMap() {
        return (
            SceneManager._scene instanceof Scene_Map &&
            !!$gameMap &&
            !!$gamePlayer &&
            !$gameMap.isEventRunning() &&
            !$gameMessage.isBusy() &&
            !$gamePlayer.isTransferring() &&
            $gamePlayer.canMove()
        );
    }

    function manualInputDetected() {
        if (Input.dir4 !== 0) return true;
        if (Input.isPressed("ok") || Input.isTriggered("ok")) return true;
        if (Input.isTriggered("cancel") || Input.isTriggered("escape") || Input.isTriggered("menu")) return true;
        if (Input.isPressed("shift")) return true;
        if (TouchInput.isPressed() || TouchInput.isTriggered()) return true;
        return false;
    }

    // Does this DOM element really own the screen? The centre hit-test alone is
    // far too eager: anything the project draws over the map that happens to
    // accept the pointer reads as "a menu is open", and the autopilot then
    // spends its life trying to close the game itself and finally hands control
    // back. A menu is a node that is visible, sits over the map, and covers a
    // real share of the viewport, so the search walks up from the hit element
    // (which is usually a label inside the panel) looking for that footprint.
    function looksLikeOverlay(el) {
        if (typeof window === "undefined" || !el) return false;
        if (el === document.body || el === document.documentElement) return false;
        if (el.tagName === "CANVAS" || el.tagName === "VIDEO") return false;
        if (el.id === "gameCanvas" || el.id === "gameVideo" || el.id === "errorPrinter") return false;
        const vw = window.innerWidth || Graphics.width || 816;
        const vh = window.innerHeight || Graphics.height || 624;
        for (let node = el; node && node !== document.body; node = node.parentElement) {
            if (node.tagName === "CANVAS") return false;
            let style = null;
            try {
                style = window.getComputedStyle(node);
            } catch (e) {
                style = null;
            }
            if (style) {
                if (style.display === "none" || style.visibility === "hidden") return false;
                if (Number(style.opacity) === 0) return false;
            }
            const r = node.getBoundingClientRect();
            if (r.width * r.height >= vw * vh * OVERLAY_MIN_AREA) return true;
        }
        return false;
    }

    function tilePassable(x, y) {
        if (!$gameMap.isValid(x, y)) return false;
        if ($gameMap.regionId(x, y) === 10) return false;
        return [2, 4, 6, 8].some((d) => $gameMap.isPassable(x, y, d));
    }

    // Cardinal direction (2/4/6/8) from one tile toward another, 0 if same tile.
    function dirBetween(fromX, fromY, toX, toY) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        if (dx === 0 && dy === 0) return 0;
        return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
    }

    // An event we are willing to walk up to and trigger.
    function isInteractable(ev) {
        if (!ev || ev === $gamePlayer || ev._erased) return false;
        if (ev.isTransparent && ev.isTransparent()) return false;
        const page = ev.page && ev.page();
        if (!page) return false;
        // Action button / player touch / event touch only, never autorun/parallel.
        if (![0, 1, 2].includes(ev._trigger)) return false;
        const list = ev.list && ev.list();
        if (!list || list.length <= 1) return false;
        // Skip fast-travel / menu-opening nodes we cannot drive.
        const name = (ev.event() && ev.event().name) || "";
        if (/teleport|fast\s*travel/i.test(name)) return false;
        return true;
    }

    // Prefer enemy events so battles get started.
    function isEnemyEvent(ev) {
        const name = (ev.event() && ev.event().name) || "";
        const note = (ev.event() && ev.event().note) || "";
        if (/enemy|monster|slime|beast|foe|bandit|wolf|spider|skab|ghoul|zombie/i.test(name + " " + note)) {
            return true;
        }
        const list = ev.list && ev.list();
        if (list) {
            for (const cmd of list) {
                if (cmd.code === 301) return true; // Battle Processing
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ heal
    function menuUsable(item) {
        return item && (item.occasion === 0 || item.occasion === 2);
    }

    function recoversHp(item) {
        if (!item || !item.effects) return false;
        return item.effects.some(
            (e) => e.code === Game_Action.EFFECT_RECOVER_HP && (e.value1 > 0 || e.value2 > 0)
        );
    }

    function applyMenuAction(user, item, targetActor, isItem) {
        try {
            const action = new Game_Action(user);
            action.setItemObject(item);
            if (targetActor && action.isForOne && action.isForOne() && !action.isForUser()) {
                action.setTarget(targetActor.index());
            }
            const targets = action.makeTargets();
            user.useItem(item); // pays skill MP/TP cost
            for (const t of targets) action.apply(t);
            action.applyGlobal();
            if (isItem) $gameParty.consumeItem(item);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ food
    function foodItem() {
        for (const item of $gameParty.items()) {
            const meta = item && item.meta;
            if (!meta) continue;
            if (meta.calories || (meta.Category && /food/i.test(String(meta.Category)))) {
                return item;
            }
        }
        return null;
    }

    function tryEat() {
        const leader = $gameParty.leader();
        if (!leader || typeof leader.addHunger !== "function") return false;
        // TimeDateSystem stores hunger on the actor, not in Variable 54.
        const hunger = typeof leader.hunger === "function" ? leader.hunger() : 0;
        const max = (window.TimeDateSystem && window.TimeDateSystem.maxHunger) || 100;
        if (hunger >= max * HUNGER_RATE) return false;
        const item = foodItem();
        if (!item) return false;
        const cal = Number(item.meta.calories) || 0;
        const pro = Number(item.meta.protein) || 0;
        const fat = Number(item.meta.fat) || 0;
        const recovery = cal * 0.1 + pro * 2.0 + fat * 1.5 || 20;
        leader.addHunger(recovery);
        $gameParty.consumeItem(item);
        return true;
    }

    function hasCookableIngredients() {
        // Cooking is enabled by carrying items 127-128, and combines two foods.
        if (!$gameParty.hasItem($dataItems[127]) && !$gameParty.hasItem($dataItems[128])) {
            return false;
        }
        let foods = 0;
        for (const item of $gameParty.items()) {
            const meta = item && item.meta;
            if (meta && (meta.calories || (meta.Category && /food/i.test(String(meta.Category))))) {
                foods += $gameParty.numItems(item);
                if (foods >= 2) return true;
            }
        }
        return false;
    }

    // The living party member most in need of healing (or null).
    function neediestMember() {
        let worst = null;
        for (const m of $gameParty.battleMembers()) {
            if (m.isAlive() && (!worst || m.hpRate() < worst.hpRate())) worst = m;
        }
        return worst;
    }

    // Heal the neediest member with any usable party skill. No menu, no battle.
    function healWithSkill() {
        const member = neediestMember();
        if (!member) return false;
        for (const caster of $gameParty.battleMembers()) {
            for (const skill of caster.skills()) {
                if (recoversHp(skill) && menuUsable(skill) && caster.canUse(skill)) {
                    return applyMenuAction(caster, skill, member, false);
                }
            }
        }
        return false;
    }

    // The first carried healing item, or null.
    function findHealItem() {
        for (const item of $gameParty.items()) {
            if (recoversHp(item) && menuUsable(item) && $gameParty.numItems(item) > 0) return item;
        }
        return null;
    }

    // ------------------------------------------------------------- stats snapshot
    // One read of everything the needs system reasons about. Profiles receive
    // this so each menu's "do I need it?" check is a simple, declarative test.
    function gatherStats() {
        const party = $gameParty;
        const leader = party && party.leader();
        let injured = false;
        let minHpRate = 1;
        if (party) {
            for (const m of party.battleMembers()) {
                if (!m.isAlive()) continue;
                minHpRate = Math.min(minHpRate, m.hpRate());
                if (m.hpRate() < HEAL_RATE) injured = true;
            }
        }
        const maxHunger = (window.TimeDateSystem && window.TimeDateSystem.maxHunger) || 100;
        // TimeDateSystem stores hunger/sleep on the actor, not in Variables 54/55.
        const hunger = (leader && typeof leader.hunger === "function") ? Number(leader.hunger()) || 0 : maxHunger;
        const canEat = !!leader && typeof leader.addHunger === "function";
        const gold = party ? party.gold() : 0;
        return {
            injured,
            minHpRate,
            hunger,
            hungerRate: hunger / maxHunger,
            hungry: canEat && hunger < maxHunger * HUNGER_RATE,
            sleep: (leader && typeof leader.sleep === "function") ? Number(leader.sleep()) || 0 : 100,
            gold,
            broke: MONEY_FLOOR > 0 && gold < MONEY_FLOOR,
            bounty: $gameVariables ? Number($gameVariables.value(BOUNTY_VAR)) || 0 : 0,
        };
    }

    // ========================================================================
    // Built-in menu profiles. Edit/extend these (or call registerMenu) to teach
    // the CPU about more menus. Survival needs are fulfilled directly where the
    // engine allows; menus are only opened when a need cannot be met otherwise.
    // ========================================================================
    // i18n-ignore-start  label/purpose document the registerMenu contract;
    // nothing renders them, they are not display copy
    MENU_PROFILES.push(
        {
            id: "heal-skill",
            label: "Healing spell",
            purpose: "Restore a wounded ally's HP with a free skill, no menu needed.",
            priority: 100,
            need: (s) => s.injured,
            act: () => healWithSkill(),
        },
        {
            id: "heal-item",
            label: "Healing item",
            purpose: "Use a carried healing item directly when no spell can mend a wounded ally.",
            priority: 90,
            // Applied silently, never opens the main menu. This project's
            // ItemSystem replaces Scene_Item with a custom Scene_EnhancedItem
            // (ItemSystemInventory.js), so driving the vanilla item menu is not
            // possible, direct application is both reliable and unobtrusive.
            need: (s) => s.injured && !!findHealItem(),
            act: () => {
                const item = findHealItem();
                const member = neediestMember();
                if (!item || !member) return false;
                return applyMenuAction(member, item, member, true);
            },
        },
        {
            id: "eat",
            label: "Eat food",
            purpose: "Eat a carried food item to refill hunger.",
            priority: 80,
            need: (s) => s.hungry,
            act: () => tryEat(),
        },
        {
            id: "cook",
            label: "Cooking menu",
            purpose: "Combine ingredients into a meal when hungry but carrying no ready food.",
            priority: 70,
            // Feature-detected; opened only when hungry AND there is nothing to
            // eat AND two ingredients are on hand. Provide a `drive` (here or via
            // registerMenu) to let the CPU actually operate Scene_Cooking.
            get enabled() {
                return typeof Scene_Cooking !== "undefined";
            },
            need: (s) => s.hungry && !foodItem() && hasCookableIngredients(),
            open: () => SceneManager.push(Scene_Cooking),
            isOpen: () => SceneManager._scene instanceof Scene_Cooking,
        },
        {
            id: "work",
            label: "Work / Jobs",
            purpose: "Take a job to earn money when funds run low.",  // i18n-ignore-end
            priority: 60,
            get enabled() {
                return typeof Scene_Work !== "undefined";
            },
            need: (s) => s.broke,
            open: () => SceneManager.push(Scene_Work),
            isOpen: () => SceneManager._scene instanceof Scene_Work,
        }
    );

    // ========================================================================
    // AutoIdle controller
    // ========================================================================
    const AutoIdle = {
        engaged: false,
        idle: 0,
        frame: 0,
        think: 0,
        sameCount: 0,
        postDelay: 0,
        msgDelay: 0,
        intent: null, // 'target' | 'wander'
        target: null,
        destX: null,
        destY: null,
        recent: {},
        mapId: 0,
        blocked: 0,       // frames stuck on a non-drivable map with no message/overlay
        dismissTries: 0,  // attempts made to close the current external menu
        dismissCool: 0,   // cooldown between dismiss attempts
        keyUpTimer: 0,    // frames until a synthetic key is released
        needCooldown: {}, // per-profile id → frame before it may be used again
        driving: null,    // id of the menu profile currently being operated
        destStall: 0,     // frames a pending touch destination has sat unmoved
        _overlayIgnoreUntil: 0, // frame the DOM overlay heuristic wakes up again

        reset() {
            this.idle = 0;
        },

        engage() {
            if (this.engaged) return;
            this.engaged = true;
            this.intent = null;
            this.target = null;
            this.destX = this.destY = null;
            this.think = 0;
            this.sameCount = 0;
            this.postDelay = 0;
            this.msgDelay = 0;
            this.blocked = 0;
            this.dismissTries = 0;
            this.dismissCool = 0;
            this.driving = null;
            this.showBadge();
        },

        disengage() {
            if (!this.engaged) {
                this.idle = 0;
                return;
            }
            this.engaged = false;
            this.intent = null;
            this.target = null;
            this.destX = this.destY = null;
            this.idle = 0;
            this.destStall = 0;
            this.blocked = 0;
            this.dismissTries = 0;
            this.dismissCool = 0;
            this.driving = null;
            if ($gameTemp) $gameTemp.clearDestination();
            this.hideBadge();
        },

        // Called every frame from Scene_Map.update.
        updateOnMap() {
            this.frame++;

            if (this.mapId !== ($gameMap ? $gameMap.mapId() : 0)) {
                this.mapId = $gameMap ? $gameMap.mapId() : 0;
                this.recent = {};
                this.intent = null;
                this.target = null;
            }

            if (!ConfigManager.autoIdle) {
                this.disengage();
                return;
            }

            // A map battle (BattleSystem/MapBattleMode.js) is a fight the player
            // is playing on the map itself, with its own command menu, its own
            // tile cursor and its own message boxes. The autopilot cannot play
            // it and must not interfere with it: left engaged it would read the
            // talk panel as a stray menu and dismiss it, and auto-advance the
            // battle's own messages out from under the player.
            if (Loose.inMapBattle()) {
                this.disengage();
                this.idle = 0;
                return;
            }

            if (this.engaged) {
                this.updateEngaged();
                return;
            }

            // Not engaged yet: count idle frames (only on a clean, drivable map).
            if (!onDrivableMap()) {
                this.idle = 0;
                return;
            }
            if (manualInputDetected() || $gamePlayer.isMoving()) {
                this.idle = 0;
                this.destStall = 0;
                return;
            }
            // A pending touch destination means the player is still walking
            // somewhere. One the player can no longer reach never clears itself,
            // though, and would hold the idle counter at zero for the rest of the
            // session, so a destination nobody is moving toward is dropped.
            if ($gameTemp.isDestinationValid()) {
                if (++this.destStall < DEST_STALL) {
                    this.idle = 0;
                    return;
                }
                $gameTemp.clearDestination();
            }
            this.destStall = 0;
            if (++this.idle >= IDLE_FRAMES) this.engage();
        },

        // Why the autopilot is not driving right now, in one line. A console
        // diagnostic (AutoIdleExplorer.why()), never rendered anywhere.
        // i18n-ignore-start
        why() {
            if (!ConfigManager.autoIdle) return "the option is off";
            if (Loose.inMapBattle()) return "a map battle is running";
            if (this.engaged) return "engaged";
            if (!(SceneManager._scene instanceof Scene_Map)) return "not on the map";
            if (!$gameMap || !$gamePlayer) return "the map is not ready";
            if ($gameMessage.isBusy()) return "a message is up";
            if ($gameMap.isEventRunning()) return "an event is running";
            if ($gamePlayer.isTransferring()) return "the player is transferring";
            if (!$gamePlayer.canMove()) return "the player cannot move";
            if (manualInputDetected()) return "input is being held";
            if ($gamePlayer.isMoving()) return "the player is moving";
            if ($gameTemp.isDestinationValid()) return "a touch destination is pending";
            return "counting idle frames (" + this.idle + "/" + IDLE_FRAMES + ")";
        },
        // i18n-ignore-end

        // True when the player is deliberately taking over. While we are holding
        // a synthetic key to dismiss a menu (keyUpTimer > 0) that key would read
        // back as input, so it must not count as a takeover.
        userOverride() {
            return this.keyUpTimer === 0 && manualInputDetected();
        },

        // Engaged update: arbitrate between driving messages, dismissing any
        // external plugin menu we triggered, and exploring the map.
        updateEngaged() {
            // 1) A "Show Text" / "Show Choices" / number / item prompt keeps the
            //    map busy, drive those windows ourselves. A clear takeover
            //    gesture (movement, cancel/menu) still hands control back; the
            //    confirm key is left alone here since it merely advances text.
            if ($gameMessage.isBusy()) {
                if (
                    this.keyUpTimer === 0 &&
                    (Input.dir4 !== 0 ||
                        Input.isTriggered("cancel") ||
                        Input.isTriggered("escape") ||
                        Input.isTriggered("menu") ||
                        Input.isPressed("shift"))
                ) {
                    this.disengage();
                    return;
                }
                this.driveMessages();
                return;
            }

            // 2) A custom plugin menu (DOM overlay, custom scene, or known
            //    profile) is on top of the map. If the CPU actually needs this
            //    menu and knows how to operate it, drive it; otherwise dismiss it
            //    so exploration resumes. This both makes the autopilot compatible
            //    with *any* menu plugin and lets it USE the ones it needs.
            const menu = this.detectExternalMenu();
            if (menu) {
                if (this.userOverride()) {
                    this.disengage();
                    return;
                }
                if (this.driveMenu(menu)) return;
                this.dismissMenu(menu);
                return;
            }

            // 3) Open map: any deliberate input hands control straight back.
            if (this.userOverride()) {
                this.disengage();
                return;
            }

            // 4) Transiently un-drivable (transfer, a brief event running, etc.).
            //    Wait it out; if it persists, just relinquish, sendCancelKey on
            //    Scene_Map opens the main menu instead of closing anything.
            //    A map transfer (including slow procedural map loads, which can
            //    take well over BLOCK_LIMIT frames) must NOT disengage: auto mode
            //    persists across maps and resumes once the new map is drivable.
            if (!onDrivableMap()) {
                this.idle = 0;
                if ($gamePlayer && $gamePlayer.isTransferring()) {
                    this.blocked = 0;
                    return;
                }
                if (++this.blocked > BLOCK_LIMIT) {
                    this.blocked = 0;
                    this.disengage();
                }
                return;
            }

            this.blocked = 0;
            this.dismissTries = 0;
            this.driving = null;
            this.drive();
        },

        // Detect a menu/overlay the autopilot cannot drive. Returns a registry
        // entry, a generic overlay descriptor, or null.
        detectExternalMenu() {
            // Known profiles first, programmatic detection is most reliable.
            for (const m of MENU_PROFILES) {
                if (!m || !m.isOpen) continue;
                try {
                    if (m.isOpen()) return m;
                } catch (e) {
                    /* a misbehaving detector must not break the autopilot */
                }
            }
            // Heuristic: a DOM element that owns the screen centre means a plugin
            // overlay/menu is sitting on top of the map. Passive HUDs use
            // pointer-events:none (so elementFromPoint skips them), render layers
            // (lighting, fog, parallax) are <canvas> (excluded), and looksLikeOverlay
            // then insists on a panel-sized footprint, which keeps this from
            // firing on ordinary map decoration.
            // The elementFromPoint hit-test forces a layout, so it's throttled to
            // every 15 frames; the result is cached in between. An element that
            // repeatedly refused to close is ignored for a while (see dismissMenu),
            // since at that point it is almost certainly not a menu at all.
            if (typeof document !== "undefined" && document.elementFromPoint) {
                if (this.frame < (this._overlayIgnoreUntil || 0)) return null;
                const fc = (typeof Graphics !== "undefined" && Graphics.frameCount) || 0;
                if (fc - (this._extMenuDomFrame || -999) >= 15) {
                    this._extMenuDomFrame = fc;
                    const w = window.innerWidth || (typeof Graphics !== "undefined" && Graphics.width) || 816;
                    const h = window.innerHeight || (typeof Graphics !== "undefined" && Graphics.height) || 624;
                    let el = null;
                    try {
                        el = document.elementFromPoint(w >> 1, h >> 1);
                    } catch (e) {
                        el = null;
                    }
                    this._extMenuDomCache =
                        el && el !== this._badge && looksLikeOverlay(el)
                            ? { name: "overlay", el, close: null }
                            : null;
                }
                if (this._extMenuDomCache) return this._extMenuDomCache;
            }
            return null;
        },

        // Operate an open menu the CPU needs and knows how to drive. Returns
        // true while it is still being driven (caller should wait), false when
        // it is finished or undrivable (caller should dismiss it).
        driveMenu(menu) {
            if (!menu || typeof menu.drive !== "function") return false;
            // Only START driving a menu the CPU genuinely needs; once started we
            // see it through until its drive() reports completion.
            if (this.driving !== menu.id) {
                let needed = true;
                try {
                    needed = menu.need ? !!menu.need(gatherStats()) : true;
                } catch (e) {
                    needed = true;
                }
                if (!needed) return false;
            }
            let busy = false;
            try {
                busy = !!menu.drive(SceneManager._scene);
            } catch (e) {
                busy = false;
            }
            if (busy) {
                this.driving = menu.id;
                this.dismissTries = 0; // making progress, reset the give-up counter
                return true;
            }
            this.driving = null;
            return false;
        },

        // Try to close the given menu. Paced so we never hammer it every frame;
        // after MAX_DISMISS failed attempts we hand control back to the player.
        dismissMenu(menu) {
            if (this.dismissCool > 0) {
                this.dismissCool--;
                return;
            }
            if (this.dismissTries >= MAX_DISMISS) {
                // Out of ideas. A real scene we cannot leave means handing control
                // back. An unrecognised DOM element on the map that will not close
                // is far more likely to be something the project simply draws
                // there, so it is written off for a while and exploration carries
                // on rather than the autopilot quietly switching itself off.
                if (menu && menu.name === "overlay" && SceneManager._scene instanceof Scene_Map) {
                    this._overlayIgnoreUntil = this.frame + OVERLAY_IGNORE;
                    this._extMenuDomCache = null;
                    this.dismissTries = 0;
                    return;
                }
                this.disengage();
                return;
            }
            this.dismissTries++;
            this.dismissCool = DISMISS_COOL;

            // Prefer a registered programmatic close.
            if (menu && typeof menu.close === "function") {
                try {
                    menu.close();
                    return;
                } catch (e) {
                    /* fall through to the universal keypress */
                }
            }

            // Universal fallback: a synthetic Cancel/Escape keypress. It reaches
            // the engine's Input system (so any menu polling Input.isTriggered
            // ('cancel'/'escape') closes) AND any plugin listening on `document`
            // directly, matching the project standard that every menu dismiss
            // on escape/cancel. It is safe on Scene_Map too: this project opens
            // the pause menu from "menu" (gamepad Y), Tab and right-click, never
            // from Escape, which the engine maps to "escape" alone.
            this.sendCancelKey();
        },

        // Dispatch a low-level keyboard event to the document so both the engine
        // and DOM-listening plugins observe it.
        dispatchKey(type, keyCode, key) {
            if (typeof KeyboardEvent === "undefined" || typeof document === "undefined") return;
            let e;
            try {
                e = new KeyboardEvent(type, { bubbles: true, cancelable: true, key, code: key });
            } catch (err) {
                return;
            }
            // KeyboardEvent ignores keyCode/which in its constructor, but the
            // engine's Input handler reads them, patch them back in.
            Object.defineProperty(e, "keyCode", { get: () => keyCode });
            Object.defineProperty(e, "which", { get: () => keyCode });
            document.dispatchEvent(e);
        },

        // Press Escape (which the engine also treats as Cancel), holding it for a
        // few frames so Input.update() registers the press before it is released.
        sendCancelKey() {
            this.dispatchKey("keydown", 27, "Escape");
            this.keyUpTimer = KEYUP_DELAY;
        },

        drive() {
            if (this.postDelay > 0) {
                this.postDelay--;
                return;
            }
            if ($gamePlayer.isMoving()) {
                this.sameCount = 0;
                return;
            }

            // Opportunistic: if the player is in contact with a "Door" event and
            // already facing it, walk through it (start it) so the autopilot can
            // move between maps the way a player would.
            if (this.tryDoorInFront()) return;

            if (this.intent) {
                if (this.intent === "target" && this.target) {
                    if (!isInteractable(this.target)) {
                        this.abandonIntent();
                    } else if (this.adjacent(this.target)) {
                        this.interact(this.target);
                        return;
                    } else if (++this.sameCount < 24) {
                        // Walk the player directly via A* rather than relying on
                        // $gameTemp.setDestination (touch-move), which this project
                        // can suppress, leaving P1 engaged but standing still.
                        if (this.destX !== null && this.stepToward(this.destX, this.destY)) {
                            this.sameCount = 0;
                        }
                        return;
                    } else {
                        this.abandonIntent();
                    }
                } else {
                    // wandering: arrived or blocked
                    if (this.destX !== null && $gamePlayer.x === this.destX && $gamePlayer.y === this.destY) {
                        this.abandonIntent();
                    } else if (++this.sameCount < 24) {
                        if (this.destX !== null && this.stepToward(this.destX, this.destY)) {
                            this.sameCount = 0;
                        }
                        return;
                    } else {
                        this.abandonIntent();
                    }
                }
            }

            if (this.think > 0) {
                this.think--;
                return;
            }
            this.think = 8;

            if (this.tryNeeds()) return;
            this.pickGoal();
        },

        // Stat-driven needs. Reads the party's stats once, then walks the menu
        // profiles from highest priority down: the first profile whose need is
        // met is fulfilled, directly via act() when possible, otherwise by
        // opening a menu the CPU knows how to operate. Returns true if it acted.
        tryNeeds() {
            const stats = gatherStats();
            const profiles = MENU_PROFILES.slice().sort(
                (a, b) => (b.priority || 0) - (a.priority || 0)
            );
            for (const p of profiles) {
                if (this.profileEnabled(p) === false) continue;
                if ((this.needCooldown[p.id] || 0) > this.frame) continue;
                let needed = false;
                try {
                    needed = p.need ? !!p.need(stats) : false;
                } catch (e) {
                    needed = false;
                }
                if (!needed) continue;

                // 1) Direct fulfilment (no menu) is always preferred.
                if (typeof p.act === "function") {
                    try {
                        if (p.act(stats)) {
                            this.setNeedCooldown(p);
                            return true;
                        }
                    } catch (e) {
                        /* ignore and try the next profile */
                    }
                    continue;
                }

                // 2) Otherwise open the menu, but only if the CPU can actually
                //    operate it (an existing handler, or a drive()), so it never
                //    opens a menu just to have it auto-closed unused.
                if (typeof p.open === "function" && (p.driven || typeof p.drive === "function")) {
                    try {
                        p.open(stats);
                        this.driving = p.id;
                        this.setNeedCooldown(p);
                        return true;
                    } catch (e) {
                        /* opening failed, move on */
                    }
                }
                // Needed but not operable: the CPU understands the menu's
                // purpose but has no safe way to use it, so it does nothing.
            }
            return false;
        },

        profileEnabled(p) {
            try {
                return p.enabled !== false;
            } catch (e) {
                return true;
            }
        },

        setNeedCooldown(p) {
            this.needCooldown[p.id] = this.frame + (p.cooldown || 1800);
        },

        // Advance the active message / answer the active prompt. Returns true
        // while something is still being handled. Paced by msgDelay so dialogue
        // stays on screen for a beat instead of flashing past instantly.
        driveMessages() {
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map)) return false;

            if (this.msgDelay > 0) {
                this.msgDelay--;
                return true;
            }

            // 1) Show Choices, pick a random valid option (cancel if empty).
            const choice = scene._choiceListWindow;
            if (choice && choice.active) {
                const max = choice.maxItems ? choice.maxItems() : 0;
                if (max > 0) {
                    choice.select(Math.floor(Math.random() * max));
                    if (choice.processOk) choice.processOk();
                } else if (choice.processCancel) {
                    choice.processCancel();
                }
                this.msgDelay = 40;
                return true;
            }

            // 2) Number input, accept the current value.
            const num = scene._numberInputWindow;
            if (num && num.active) {
                if (num.processOk) num.processOk();
                this.msgDelay = 40;
                return true;
            }

            // 3) Select Item, take the first match, or cancel if none.
            const item = scene._eventItemWindow;
            if (item && item.active) {
                if (item.maxItems && item.maxItems() > 0) {
                    item.select(0);
                    if (item.processOk) item.processOk();
                } else if (item.processCancel) {
                    item.processCancel();
                }
                this.msgDelay = 40;
                return true;
            }

            // 4) Plain text, fast-forward the typewriter, then tap through each
            // page exactly the way Window_Message.updateInput would on "ok".
            const mw = scene._messageWindow;
            if (mw && $gameMessage.isBusy()) {
                if (mw.pause) {
                    mw.pause = false;
                    if (!mw._textState && mw.terminateMessage) {
                        mw.terminateMessage();
                    }
                    this.msgDelay = 24;
                } else {
                    mw._showFast = true;
                }
                return true;
            }

            return $gameMessage.isBusy();
        },

        adjacent(ev) {
            return Math.abs(ev.x - $gamePlayer.x) + Math.abs(ev.y - $gamePlayer.y) <= 1;
        },

        // Trigger a "Door" event the player is in contact with and facing. The
        // door tile is the one directly in front of the player; if an event named
        // "Door" sits there we face it and start it. Returns true if one fired.
        tryDoorInFront() {
            const dir = $gamePlayer.direction();
            const fx = $gamePlayer.x + (dir === 6 ? 1 : dir === 4 ? -1 : 0);
            const fy = $gamePlayer.y + (dir === 2 ? 1 : dir === 8 ? -1 : 0);
            for (const ev of $gameMap.eventsXy(fx, fy)) {
                if (!isInteractable(ev)) continue;
                const name = (ev.event() && ev.event().name) || "";
                if (!/\bdoor\b/i.test(name)) continue;
                $gamePlayer.setDirection(dir);
                this.recent[this.recentKey(ev)] = this.frame;
                try {
                    ev.start();
                } catch (e) {
                    /* door refused to start, ignore */
                }
                this.postDelay = 20;
                this.abandonIntent();
                return true;
            }
            return false;
        },

        // Step the player one tile toward (x, y) using the engine's A* path,
        // moving $gamePlayer directly instead of through $gameTemp destination
        // (touch-move). Returns true if a move was actually started.
        stepToward(x, y) {
            if (!$gamePlayer || $gamePlayer.isMoving() || !$gamePlayer.canMove()) return false;
            const dir = $gamePlayer.findDirectionTo(x, y);
            if (dir > 0) {
                $gamePlayer.executeMove(dir);
                return $gamePlayer.isMovementSucceeded();
            }
            return false;
        },

        recentKey(ev) {
            return this.mapId + ":" + ev.eventId();
        },

        interact(ev) {
            const dx = ev.x - $gamePlayer.x;
            const dy = ev.y - $gamePlayer.y;
            if (dx !== 0 || dy !== 0) {
                const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
                $gamePlayer.setDirection(dir);
            }
            this.recent[this.recentKey(ev)] = this.frame;
            try {
                ev.start();
            } catch (e) {
                /* event refused to start, ignore */
            }
            this.postDelay = 20;
            this.intent = null;
            this.target = null;
            this.destX = this.destY = null;
            this.sameCount = 0;
            if ($gameTemp) $gameTemp.clearDestination();
        },

        abandonIntent() {
            if (this.intent === "target" && this.target) {
                this.recent[this.recentKey(this.target)] = this.frame;
            }
            this.intent = null;
            this.target = null;
            this.destX = this.destY = null;
            this.sameCount = 0;
            if ($gameTemp) $gameTemp.clearDestination();
        },

        pickGoal() {
            const candidates = this.scanEvents();
            if (candidates.length && Math.random() < 0.85) {
                // Weighted random among the nearest few, enemies first.
                const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
                this.intent = "target";
                this.target = pick.ev;
                this.destX = pick.ev.x;
                this.destY = pick.ev.y;
                this.sameCount = 0;
                $gameTemp.setDestination(pick.ev.x, pick.ev.y);
                return;
            }
            this.wander();
        },

        scanEvents() {
            const px = $gamePlayer.x;
            const py = $gamePlayer.y;
            const out = [];
            for (const ev of $gameMap.events()) {
                if (!isInteractable(ev)) continue;
                const last = this.recent[this.recentKey(ev)];
                if (last && this.frame - last < 1800) continue; // 30s cooldown
                const dist = Math.abs(ev.x - px) + Math.abs(ev.y - py);
                if (dist > SCAN_RADIUS) continue;
                out.push({ ev, dist, enemy: isEnemyEvent(ev) });
            }
            // Enemies first, then by distance.
            out.sort((a, b) => (b.enemy - a.enemy) * 100 + (a.dist - b.dist));
            return out;
        },

        wander() {
            for (let i = 0; i < 16; i++) {
                const dist = 5 + Math.floor(Math.random() * 6);
                const ang = Math.random() * Math.PI * 2;
                const tx = Math.round($gamePlayer.x + Math.cos(ang) * dist);
                const ty = Math.round($gamePlayer.y + Math.sin(ang) * dist);
                if ((tx !== $gamePlayer.x || ty !== $gamePlayer.y) && tilePassable(tx, ty)) {
                    this.intent = "wander";
                    this.destX = tx;
                    this.destY = ty;
                    this.sameCount = 0;
                    $gameTemp.setDestination(tx, ty);
                    return;
                }
            }
            this.intent = null;
        },

        // -------------------------------------------------------------- badge
        showBadge() {
            if (!SHOW_BADGE || this._badge) return;
            const el = document.createElement("div");
            el.textContent = "AUTO";
            el.style.cssText =
                "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99;" +
                "padding:3px 12px;border-radius:10px;font:bold 13px monospace;letter-spacing:1px;" +
                "color:#ffe9b0;background:rgba(40,20,10,0.78);border:1px solid #b89d7c;" +
                "pointer-events:none;text-shadow:0 1px 2px #000;";
            document.body.appendChild(el);
            this._badge = el;
        },

        hideBadge() {
            if (this._badge) {
                if (this._badge.parentNode) this._badge.parentNode.removeChild(this._badge);
                this._badge = null;
            }
        },

        // Open Scene_Menu and navigate to the given item for the given actor.
        // Food is still handled silently (TimeDateSystem uses custom hunger calc).
        openMenuForItem(item, member) {
            if (MenuNav.intent) return; // already navigating
            MenuNav.intent = 'item';
            MenuNav.targetItem = item;
            MenuNav.targetMember = member;
            MenuNav.phase = 'command';
            MenuNav.delay = 0;
            MenuNav.timeout = 0;
            SceneManager.push(Scene_Menu);
        },

        shouldAutoBattle() {
            return ConfigManager.autoIdle && this.engaged;
        },

        driveBattle(scene) {
            try {
                if (!BattleManager.isInputting || !BattleManager.isInputting()) return;
                if (scene._partyCommandWindow && scene._partyCommandWindow.active && scene.commandFight) {
                    scene.commandFight();
                    return;
                }
                const actor = BattleManager.actor ? BattleManager.actor() : null;
                if (actor && typeof actor.makeAutoBattleActions === "function") {
                    actor.makeAutoBattleActions();
                    if (BattleManager.selectNextCommand) BattleManager.selectNextCommand();
                }
            } catch (e) {
                /* keep the battle running even if a custom system fights us */
            }
        },
    };

    // Public API: let any plugin teach the autopilot about its custom menu.
    // Accepts a full profile (see MENU_PROFILES docs). At minimum it should give
    // the CPU something to act on, a need + (act|open) for proactive use, and/or
    // isOpen + (drive|close) for when the CPU lands in the menu.
    AutoIdle.registerMenu = function (entry) {
        if (!entry || MENU_PROFILES.includes(entry)) return;
        if (
            typeof entry.isOpen !== "function" &&
            typeof entry.need !== "function" &&
            typeof entry.act !== "function"
        ) {
            return; // nothing actionable
        }
        if (!entry.id) entry.id = "menu_" + MENU_PROFILES.length;
        // Replace an existing profile sharing this id (lets projects override built-ins).
        const i = MENU_PROFILES.findIndex((p) => p.id === entry.id);
        if (i >= 0) MENU_PROFILES.splice(i, 1, entry);
        else MENU_PROFILES.push(entry);
    };

    // Expose the live profile table for inspection / configuration.
    AutoIdle.menuProfiles = MENU_PROFILES;

    // ========================================================================
    // Player 2 autopilot (SplitScreenMultiplayer integration)
    // ------------------------------------------------------------------------
    // When a local split-screen session is active and Auto Idle Explorer is on,
    // an idle Player 2 is taken over the same way Player 1 is: the CPU walks the
    // P2 event around the map with the engine's A* pathfinding, seeks out nearby
    // events (enemies first) and triggers them. Rather than move the P2 event
    // directly, it feeds synthetic input into SplitScreenManager.p2Input right
    // after the manager polls real input, so ALL of SplitScreen's existing P2
    // logic (touch triggers, action interaction, swimming, world-map limits)
    // is reused unchanged. The instant a real P2 key/stick is used, control is
    // handed straight back.
    // ========================================================================
    const P2Auto = {
        engaged: false,
        idle: 0,
        frame: 0,
        think: 0,
        sameCount: 0,
        postDelay: 0,
        intent: null, // 'target' | 'wander'
        target: null,
        destX: null,
        destY: null,
        recent: {},
        mapId: 0,
        _badge: null,

        ssm() {
            return window.SplitScreenManager;
        },

        p2() {
            const s = this.ssm();
            return s && s.p2Event;
        },

        // A real P2 input (keyboard/gamepad) is present this frame.
        manual(input) {
            return !!(
                input &&
                (input.up || input.down || input.left || input.right || input.action || input.dash || input.menu)
            );
        },

        clearIntent() {
            this.intent = null;
            this.target = null;
            this.destX = this.destY = null;
            this.sameCount = 0;
        },

        reset() {
            this.clearIntent();
            this.think = 0;
            this.postDelay = 0;
        },

        disengage() {
            this.engaged = false;
            this.idle = 0;
            this.reset();
            this.hideBadge();
        },

        // Wipe any synthetic input we previously injected so a frame we sit out
        // does not leave a key "held".
        clearInput(input) {
            if (!input) return;
            input.up = input.down = input.left = input.right = false;
            input.action = false;
            input.dash = false;
        },

        // Called right after SplitScreenManager.pollInput() each frame.
        afterPoll() {
            const s = this.ssm();
            if (!ConfigManager.autoIdle || !s || !s.active) {
                this.disengage();
                return;
            }
            if (!(SceneManager._scene instanceof Scene_Map)) return;

            const ev = this.p2();
            if (!ev) {
                this.disengage();
                return;
            }
            // P2 is driving or riding a vehicle: leave that to the player /
            // SplitScreen's own passenger logic.
            if (s.vehicleDriver || ev.opacity === 0) {
                this.disengage();
                return;
            }

            this.frame++;
            const mid = $gameMap ? $gameMap.mapId() : 0;
            if (this.mapId !== mid) {
                this.mapId = mid;
                this.recent = {};
                this.disengage();
            }

            const input = s.p2Input;
            if (this.manual(input)) {
                // Player took P2 back.
                this.engaged = false;
                this.idle = 0;
                this.reset();
                this.hideBadge();
                return;
            }

            // Cannot act while a message/event owns the map or during transfer.
            if (
                $gameMessage.isBusy() ||
                $gameMap.isEventRunning() ||
                !$gamePlayer ||
                $gamePlayer.isTransferring()
            ) {
                this.clearInput(input);
                return;
            }

            if (!this.engaged) {
                if (++this.idle >= IDLE_FRAMES) {
                    this.engaged = true;
                    this.showBadge();
                } else {
                    return;
                }
            }

            this.drive(ev, input);
        },

        drive(ev, input) {
            this.clearInput(input);

            if (this.postDelay > 0) {
                this.postDelay--;
                return;
            }
            if (ev.isMoving()) {
                this.sameCount = 0;
                return;
            }

            if (this.intent === "target" && this.target) {
                if (!isInteractable(this.target)) {
                    this.abandon();
                } else if (this.adjacent(ev, this.target)) {
                    this.interact(ev, this.target, input);
                    return;
                } else if (++this.sameCount < 30) {
                    const dir = ev.findDirectionTo(this.destX, this.destY);
                    if (dir > 0) {
                        this.setDir(input, dir);
                        return;
                    }
                    this.abandon();
                } else {
                    this.abandon();
                }
            } else if (this.intent === "wander") {
                if (ev.x === this.destX && ev.y === this.destY) {
                    this.clearIntent();
                } else if (++this.sameCount < 30) {
                    const dir = ev.findDirectionTo(this.destX, this.destY);
                    if (dir > 0) {
                        this.setDir(input, dir);
                        return;
                    }
                    this.clearIntent();
                } else {
                    this.clearIntent();
                }
            }

            if (this.think > 0) {
                this.think--;
                return;
            }
            this.think = 8;
            this.pickGoal(ev);
        },

        // Stop adjacent to a target, face it, and pulse the P2 action button so
        // SplitScreen's updateP2Movement starts the event in front of P2.
        interact(ev, target, input) {
            const dir = dirBetween(ev.x, ev.y, target.x, target.y);
            if (dir > 0) ev.setDirection(dir);
            this.recent[this.recentKey(target)] = this.frame;
            input.action = true; // single-frame pulse → isTriggered("action")
            this.postDelay = 20;
            this.clearIntent();
        },

        setDir(input, dir) {
            if (dir === 8) input.up = true;
            else if (dir === 2) input.down = true;
            else if (dir === 4) input.left = true;
            else if (dir === 6) input.right = true;
        },

        abandon() {
            if (this.intent === "target" && this.target) {
                this.recent[this.recentKey(this.target)] = this.frame;
            }
            this.clearIntent();
        },

        pickGoal(ev) {
            const candidates = this.scanEvents(ev);
            if (candidates.length && Math.random() < 0.85) {
                const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
                this.intent = "target";
                this.target = pick.ev;
                this.destX = pick.ev.x;
                this.destY = pick.ev.y;
                this.sameCount = 0;
                return;
            }
            this.wander(ev);
        },

        scanEvents(ev) {
            const out = [];
            for (const e of $gameMap.events()) {
                if (e === ev) continue;
                if (!isInteractable(e)) continue;
                const last = this.recent[this.recentKey(e)];
                if (last && this.frame - last < 1800) continue; // 30s cooldown
                const dist = Math.abs(e.x - ev.x) + Math.abs(e.y - ev.y);
                if (dist > SCAN_RADIUS) continue;
                out.push({ ev: e, dist, enemy: isEnemyEvent(e) });
            }
            out.sort((a, b) => (b.enemy - a.enemy) * 100 + (a.dist - b.dist));
            return out;
        },

        wander(ev) {
            for (let i = 0; i < 16; i++) {
                const dist = 4 + Math.floor(Math.random() * 5);
                const ang = Math.random() * Math.PI * 2;
                const tx = Math.round(ev.x + Math.cos(ang) * dist);
                const ty = Math.round(ev.y + Math.sin(ang) * dist);
                if ((tx !== ev.x || ty !== ev.y) && tilePassable(tx, ty)) {
                    this.intent = "wander";
                    this.destX = tx;
                    this.destY = ty;
                    this.sameCount = 0;
                    return;
                }
            }
            this.intent = null;
        },

        recentKey(e) {
            return this.mapId + ":" + e.eventId();
        },

        adjacent(ev, t) {
            return Math.abs(ev.x - t.x) + Math.abs(ev.y - t.y) <= 1;
        },

        showBadge() {
            if (!SHOW_BADGE || this._badge) return;
            const el = document.createElement("div");
            el.textContent = T('AutoIdle.badge');
            el.style.cssText =
                "position:fixed;top:8px;right:8px;z-index:99;" +
                "padding:3px 12px;border-radius:10px;font:bold 13px monospace;letter-spacing:1px;" +
                "color:#b0e0ff;background:rgba(10,20,40,0.78);border:1px solid #7c9db8;" +
                "pointer-events:none;text-shadow:0 1px 2px #000;";
            document.body.appendChild(el);
            this._badge = el;
        },

        hideBadge() {
            if (this._badge) {
                if (this._badge.parentNode) this._badge.parentNode.removeChild(this._badge);
                this._badge = null;
            }
        },
    };

    // Install the P2 input post-poll hook once SplitScreenManager exists. Done
    // lazily (from the map update) so load order relative to SplitScreen does
    // not matter; wrapping the method directly guarantees we inject right after
    // the real poll and before updateP2Movement reads p2Input the same frame.
    AutoIdle.ensureP2Hook = function () {
        if (this._p2HookInstalled) return;
        const SSM = window.SplitScreenManager;
        if (!SSM || typeof SSM.pollInput !== "function") return;
        const original = SSM.pollInput;
        SSM.pollInput = function () {
            original.apply(this, arguments);
            try {
                P2Auto.afterPoll();
            } catch (e) {
                /* never break P2 input because the autopilot errored */
            }
        };
        this._p2HookInstalled = true;
    };

    AutoIdle.p2 = P2Auto;

    // ========================================================================
    // Party formation, Close (the marching column) and Loose (their own lives)
    // ------------------------------------------------------------------------
    // Close is what the engine ships: Game_Followers.updateMove walks every
    // member through the tile the one in front just left, so the party is a rope
    // the leader drags. Loose cuts that rope. The members are no longer moved by
    // the leader's steps at all: each one is given the map, a leash around the
    // leader and an activity, and walks itself with the engine's own A* (the
    // same findDirectionTo the autopilot above uses).
    //
    // The rope is spliced back on for exactly as long as the party has to act as
    // one body: a dashing leader (they drop everything and come), an event's
    // Gather Party, a vehicle, split-screen, a battle. Everything else, a
    // transfer, a change of map, walking out of a fight, is handled by putting
    // the members back at the leader's shoulder outright rather than making them
    // walk home across a map they were never on.
    // ========================================================================

    // Names that are furniture rather than people. A follower will happily walk
    // over to look at a chest, but a door or a teleport marker is a thing the
    // party uses, not someone it talks to.
    const NON_PERSON = /door|teleport|transfer|house|room|plant|animal|chest|sign|delivery|vehicle|player2|enemy/i;

    function isPersonEvent(ev) {
        if (!ev || ev === $gamePlayer || ev._erased) return false;
        if (ev.isTransparent && ev.isTransparent()) return false;
        if (!ev.characterName || !ev.characterName()) return false; // a tile, not a body
        const name = (ev.event() && ev.event().name) || "";
        if (NON_PERSON.test(name)) return false;
        return !isEnemyEvent(ev);
    }

    // Something worth stopping to look at: an event that is not a person and not
    // a way out of the map (walking up to a teleport tile would look like the
    // member was about to leave).
    function isSceneryEvent(ev) {
        if (!ev || ev === $gamePlayer || ev._erased) return false;
        if (ev.isTransparent && ev.isTransparent()) return false;
        const name = (ev.event() && ev.event().name) || "";
        if (/teleport|transfer|door|fast\s*travel|player2/i.test(name)) return false;
        return !isPersonEvent(ev) && !isEnemyEvent(ev);
    }

    // ------------------------------------------------------------------------
    // Speech bubbles for the party. NPCConversation's own bubble manager
    // resolves its target by event name, and a follower is not an event, so this
    // is the same idea anchored on any Game_Character. It borrows
    // NPCConversation's stylesheet class outright, so a member's chatter reads
    // exactly like the town's.
    // ------------------------------------------------------------------------
    const Bubbles = {
        _pool: [],
        _live: [],

        _element() {
            const el = this._pool.pop();
            if (el) return el;
            const made = document.createElement("div");
            made.className = "npc-thought-bubble";
            document.body.appendChild(made);
            return made;
        },

        show(char, text) {
            if (!LOOSE_CHATTER || !char || !text) return;
            if (typeof document === "undefined") return;
            this.clearFor(char);
            const el = this._element();
            el.textContent = text;
            el.style.display = "block";
            el.classList.remove("fading");
            void el.offsetWidth; // restart the transition on a recycled element
            el.classList.add("visible");
            this._live.push({ el, char, until: Date.now() + BUBBLE_MS, h: el.offsetHeight || 32 });
            this.update();
        },

        clearFor(char) {
            for (let i = this._live.length - 1; i >= 0; i--) {
                if (this._live[i].char === char) this._release(i);
            }
        },

        clear() {
            while (this._live.length) this._release(this._live.length - 1);
        },

        _release(i) {
            const b = this._live[i];
            this._live.splice(i, 1);
            b.el.classList.remove("visible", "fading");
            b.el.style.display = "none";
            this._pool.push(b.el);
        },

        // Anchored off the character's own screen projection (so it tracks zoom,
        // jumps and camera shifts) and scaled onto the canvas' real on-page size.
        update() {
            if (!this._live.length) return;
            if (!(SceneManager._scene instanceof Scene_Map) || !$gameMap) {
                this.clear();
                return;
            }
            const canvas = document.getElementById("gameCanvas");
            const r = canvas ? canvas.getBoundingClientRect() : null;
            const sx = r ? r.width / Graphics.width : 1;
            const sy = r ? r.height / Graphics.height : 1;
            const ox = r ? r.left : 0;
            const oy = r ? r.top : 0;
            const now = Date.now();
            for (let i = this._live.length - 1; i >= 0; i--) {
                const b = this._live[i];
                if (now >= b.until) {
                    this._release(i);
                    continue;
                }
                const x = b.char.screenX();
                const y = b.char.screenY() - $gameMap.tileHeight() - (b.h || 32) - 16;
                b.el.style.left = Math.round(ox + x * sx) + "px";
                b.el.style.top = Math.round(oy + y * sy) + "px";
            }
        },
    };

    const Loose = {
        _recall: false,
        _still: 0,      // frames the leader has stood still during a recall
        // Per-member AI state, kept module-side and keyed by party slot rather
        // than written onto the Game_Follower: followers are serialised into the
        // savegame, and a live Game_Event reference in there would be cloned
        // into the save as a second copy of that event.
        _states: [],
        mapId: 0,

        mode() {
            return ConfigManager.partyFormation | 0;
        },

        // A pet, a child or a creature that came along of its own accord
        // (NPC/PetFollowerSystem.js) is not a party member marching in a column.
        // It keeps to itself whatever the formation option says, so Loose is
        // always on for that slot and Close never applies to it.
        isAlwaysLoose(f) {
            return !!(window.Game_PetFollower && f instanceof window.Game_PetFollower);
        },

        // The formation THIS member walks in.
        modeFor(f) {
            return this.isAlwaysLoose(f) ? FORM_LOOSE : this.mode();
        },

        stateOf(f) {
            const i = f._memberIndex || 0;
            let s = this._states[i];
            if (!s) {
                s = this._states[i] = {
                    act: "idle", wait: 0, gx: null, gy: null, partner: null, beat: 0, tries: 0,
                    need: null, rent: false, until: 0, dash: false,
                    // Who this member has already been over to see, and when. A
                    // party standing in a village would otherwise queue up in
                    // front of the one villager nearest the leader all evening.
                    seen: new Map(),
                };
            }
            return s;
        },

        // Has this member just dealt with that character?
        stale(s, c) {
            const last = s.seen.get(c);
            return last !== undefined && Graphics.frameCount - last < VISIT_COOLDOWN;
        },

        remember(s, c) {
            s.seen.set(c, Graphics.frameCount);
            if (s.seen.size > 24) s.seen.delete(s.seen.keys().next().value);
        },

        resetStates() {
            this._states = [];
        },

        clearGoal(s) {
            s.act = "idle";
            s.gx = s.gy = null;
            s.partner = null;
            s.beat = 0;
            s.tries = 0;
            s.need = null;
            s.rent = false;
            s.until = 0;
        },

        // A map battle (BattleSystem/MapBattleMode.js) turns every member into a
        // tactical battler that MapBattleMode walks itself. The whole formation
        // layer, Close included, stands down for the duration of the fight.
        inMapBattle() {
            return !!(window.MapBattleMode && window.MapBattleMode.isActive());
        },

        // Called by MapBattleMode when a fight opens on top of a loose party:
        // drop every errand and every bubble, so nobody walks back to a stale
        // goal once the fight is over, and nobody stands in the middle of a
        // battlefield thinking about the flowers.
        standDown() {
            this._recall = false;
            this._still = 0;
            this._run = 0;
            this.resetStates();
            Bubbles.clear();
        },

        // True while the loose formation owns the followers. Everything that
        // needs the party to move as one body switches it back off, and the
        // vanilla chase takes over again for the duration.
        active() {
            return this.mode() === FORM_LOOSE && this.conditionsMet();
        },

        // The same question for one member, so a pet keeps its own life while
        // the party around it is still marching in Close.
        activeFor(f) {
            return this.modeFor(f) === FORM_LOOSE && this.conditionsMet();
        },

        // Everything except the formation itself: the states of the game in
        // which no follower may be walking itself.
        conditionsMet() {
            if (this.inMapBattle()) return false;
            if (!$gamePlayer || !$gameMap || !$gameParty || !$gameMessage) return false;
            if (!(SceneManager._scene instanceof Scene_Map)) return false;
            if ($gameParty.inBattle()) return false;
            if (!$gamePlayer.followers().isVisible()) return false;
            if ($gamePlayer.isInVehicle()) return false;
            if ($gamePlayer._vehicleGettingOn || $gamePlayer._vehicleGettingOff) return false;
            const ss = window.SplitScreenManager;
            if (ss && ss.active) return false;
            return true;
        },

        // The party is being called in: by a leader who broke into a run, or by
        // anything that asked for a Gather Party.
        recalling() {
            if ($gamePlayer && $gamePlayer.areFollowersGathering()) return true;
            return this._recall;
        },

        // The activity AI only runs on a quiet map. An event, a message or a
        // transfer freezes every member where they stand.
        canAct(f) {
            return (
                (f ? this.activeFor(f) : this.active()) &&
                !this.recalling() &&
                !$gameMap.isEventRunning() &&
                !$gameMessage.isBusy() &&
                !$gamePlayer.isTransferring()
            );
        },

        dist(a, b) {
            return $gameMap.distance(a.x, a.y, b.x, b.y);
        },

        // Is this member outside what the player can actually see? Screen
        // coordinates are the honest answer to that: they already carry the
        // camera, the edges of a map too small to centre on, and the zoom the
        // spriteset renders at. `margin` is measured in tiles from the edge of
        // the screen, positive outward (past the edge) and negative inward.
        offScreen(f, margin) {
            if (!f || !$gameMap || typeof f.screenX !== "function") return false;
            const z = ($gameScreen && $gameScreen.zoomScale()) || 1;
            const zx = $gameScreen ? $gameScreen.zoomX() : 0;
            const zy = $gameScreen ? $gameScreen.zoomY() : 0;
            // The stage is scaled about the zoom centre, so that is where a
            // character's screen position really ends up on the canvas.
            const x = (f.screenX() - zx) * z + zx;
            const y = (f.screenY() - zy) * z + zy;
            const m = Number(margin) || 0;
            const mx = m * $gameMap.tileWidth() * z;
            const my = m * $gameMap.tileHeight() * z;
            return x < -mx || x > Graphics.width + mx || y < -my || y > Graphics.height + my;
        },

        say(char, key) {
            // The chatter is written for the people in the party. A pet or a
            // child walking with them wanders and stops to look at things like
            // everyone else, but it says none of it.
            if (this.isAlwaysLoose(char)) return;
            const lines = T.pool(key);
            if (!lines.length) return;
            Bubbles.show(char, lines[Math.floor(Math.random() * lines.length)]);
        },

        // Switching the option mid-game: close ranks (or let go) immediately
        // rather than at the next map.
        onModeChanged() {
            this._recall = false;
            this._still = 0;
            this._run = 0;
            Bubbles.clear();
            this.resetStates();
            if (!$gamePlayer) return;
            for (const f of $gamePlayer.followers().data()) f.setThrough(true);
            if (this.mode() === FORM_CLOSE) this.gatherNear();
        },

        // The leader is running, not walking. Read as "covering ground at dash
        // speed", which is the engine's own notion of a run: it therefore also
        // covers click-to-move (the engine dashes for that too) and behaves
        // sensibly under Always Dash, where the party keeps formation whenever
        // the leader is on the move and scatters the moment they stand still.
        isLeaderRunning() {
            const p = $gamePlayer;
            return !!p && p.isMoving() && p.isDashing();
        },

        // In the water (Map/MovementInteractionSystem.js). The leader swimming
        // is NOT a recall: a loose member gets into the water themselves and
        // swims after them. What they never do is dive.
        isLeaderSwimming() {
            const p = $gamePlayer;
            return !!p && (!!p._isSwimming || !!p._isDiving);
        },

        // Is anybody walking themselves? The whole party in Loose, or just the
        // pet slot while the party marches in Close.
        anyLoose() {
            if (this.mode() === FORM_LOOSE) return true;
            if (!$gamePlayer || !$gamePlayer.followers()) return false;
            return $gamePlayer.followers().data().some((f) => f.isVisible() && this.isAlwaysLoose(f));
        },

        // ------------------------------------------------------------ per frame
        update() {
            if ($gamePlayer && this.anyLoose()) {
                // A sprint is the one thing that puts the rope back on, and it
                // has to be a real one: the run is timed, and only once it has
                // lasted RECALL_RUN frames does the party form up. Anything
                // slower than a sprint, walking included, leaves them to their
                // own lives, which is the whole point of Loose.
                const running = this.conditionsMet() && this.isLeaderRunning();
                this._run = running ? (this._run || 0) + 1 : 0;
                if (running && this._run >= RECALL_RUN) {
                    if (!this._recall) {
                        Bubbles.clear();
                        this.cryForTheLeader();
                    }
                    this._recall = true;
                    this._still = 0;
                }
                // And they let go as soon as the sprint does.
                if (this._recall && !running) {
                    this._still = (this._still || 0) + 1;
                    if (this._still >= RECALL_DROP) {
                        this._recall = false;
                        this._still = 0;
                    }
                } else if (running) {
                    this._still = 0;
                }
            }
            Bubbles.update();
        },

        // One member calls after the leader, and only now and then: a party
        // that shouted every time somebody broke into a run would never shut up.
        cryForTheLeader() {
            const now = Graphics.frameCount;
            if (this._cried && now - this._cried < RECALL_CRY_COOL) return;
            if (Math.random() > RECALL_CRY_ODDS) return;
            const f = $gamePlayer.followers().data().find((m) => m.isVisible() && this.activeFor(m));
            if (!f) return;
            this._cried = now;
            this.say(f, "AutoIdle.loose.recall");
        },

        // Called from Game_Follower.update, once per member per frame.
        updateFollower(f) {
            if (!f || !f.isVisible()) return;
            // Hands off entirely during a map battle: the through(true) below is
            // exactly what would let a tactical battler walk through a wall.
            if (this.inMapBattle()) return;
            if (this.modeFor(f) !== FORM_LOOSE || !this.activeFor(f)) {
                // Back in the engine's chain, be it Close formation or a state
                // that suspends the loose behaviour (a vehicle, split-screen, a
                // battle): a chained follower walks through everything, and a
                // pet left solid would be stranded the moment the party sails.
                if (!f.isThrough()) f.setThrough(true);
                return;
            }

            if (this.recalling()) {
                if (!f.isThrough()) f.setThrough(true);
                const gathering = $gamePlayer.areFollowersGathering();
                // Already in the file: the engine's own chase (the vanilla
                // updateMove spliced back in below) steps them into the tile
                // the person in front is leaving, which IS the marching column
                // every RPG Maker game ships with. The loose layer takes its
                // hands off them entirely rather than walking them somewhere
                // else at the same time, and they keep the leader's pace so the
                // spacing holds instead of concertinaing.
                if (!gathering && this.inColumn(f)) {
                    f.setMoveSpeed($gamePlayer.realMoveSpeed());
                    return;
                }
                this.stepHome(f, gathering);
                return;
            }
            if (!this.canAct(f)) return;

            // Loose members walk the map for themselves, so they obey it.
            if (f.isThrough()) f.setThrough(false);
            // Game_Follower.update has just copied the leader's speed onto them,
            // which would have the whole party sprinting between flowers, so
            // each one is put back on the pace their own errand deserves.
            f.setMoveSpeed(this.gaitFor(f));
            this.updateSwim(f);
            this.think(f);
        },

        // How fast this member is moving right now. Mostly an amble a notch
        // under the leader's; keeping up with them or running outright when
        // there is a reason to (coming back into view, tagging along, or one of
        // those moments when somebody simply feels like running).
        gaitFor(f) {
            const s = this.stateOf(f);
            const base = $gamePlayer.realMoveSpeed();
            if (s.act === "return") return base + 1;      // out of sight: hurry
            if (s.act === "follow") return base;          // matching the leader
            if (s.dash) return base;                      // a turn of speed
            return Math.max(3, base - 1);
        },

        // ------------------------------------------------------------- water
        // A loose member gets into the water on their own (region 99, or a
        // water tile on the procedural map) and swims across it, which is what
        // lets them follow a leader who has swum off. They never DIVE: going
        // under is the player's business.
        isWater(x, y) {
            if (!$gameMap) return false;
            if ($gameMap.regionId(x, y) === 99) return true;
            const mis = window.MovementSystem;
            if (mis && typeof mis.isWaterTile === "function") {
                try { return !!mis.isWaterTile(x, y); } catch (e) { /* fall through */ }
            }
            return $gameMap.terrainTag(x, y) === 3;
        },

        setSwimming(f, on) {
            if (!f || !!f._isSwimming === !!on) return;
            const mis = window.MovementSystem;
            try {
                if (on && mis && mis.enterSwimMode) mis.enterSwimMode(f);
                else if (!on && mis && mis.exitSwimMode) mis.exitSwimMode(f);
                else f._isSwimming = !!on;
            } catch (e) {
                f._isSwimming = !!on;
            }
        },

        // Out of the water the moment they are standing on dry land again.
        updateSwim(f) {
            if (f._isSwimming && !f.isMoving() && !this.isWater(f.x, f.y)) {
                this.setSwimming(f, false);
            }
        },

        // Who this member walks behind: the visible member ahead of them in the
        // party's own order, and the leader for the first of them. That is what
        // makes a recall a file rather than a huddle, since everybody closes on
        // the back of the person in front instead of on the leader's tile.
        precedingOf(f) {
            if (!$gamePlayer || !f) return $gamePlayer;
            const data = $gamePlayer.followers().data();
            const i = data.indexOf(f);
            for (let j = i - 1; j >= 0; j--) {
                if (data[j] && data[j].isVisible()) return data[j];
            }
            return $gamePlayer;
        },

        // In the column already: within a tile of the back of the person in
        // front, which is exactly the spacing the engine's caterpillar keeps.
        // Measured on each axis rather than as a distance, so a member sitting
        // diagonally off their shoulder (which is where a diagonal step leaves
        // them) still reads as being in the file.
        inColumn(f) {
            const head = this.precedingOf(f);
            if (!head || !f) return false;
            return Math.abs(f.deltaXFrom(head.x)) <= COLUMN_GAP &&
                Math.abs(f.deltaYFrom(head.y)) <= COLUMN_GAP;
        },

        // Walk back into the column. `onto` is the Gather Party case, where the
        // engine only counts the party gathered once every member shares the
        // leader's tile; a sprint recall ends with them strung out behind the
        // leader instead, each one on the shoulder of the one in front.
        stepHome(f, onto) {
            if (f.isMoving()) return;
            if (this.offScreen(f, LOOSE_SNAP_MARGIN)) {
                this.placeBeside(f);
                return;
            }
            if (onto) {
                if (this.dist(f, $gamePlayer) === 0) return;
                this.stepTo(f, $gamePlayer.x, $gamePlayer.y);
                return;
            }
            if (this.inColumn(f)) return;
            // Catching up is a run: the engine only steps the file when the
            // leader steps, so at the leader's own pace a gap would never close.
            const head = this.precedingOf(f);
            f.setMoveSpeed($gamePlayer.realMoveSpeed() + 1);
            this.stepTo(f, head.x, head.y);
        },

        stepTo(f, x, y) {
            const dir = f.findDirectionTo(x, y);
            if (dir > 0) {
                f.moveStraight(dir);
                if (f.isMovementSucceeded()) return true;
            }
            // No dry way there. If what is in the way is water, they get in and
            // swim it: the engine already lets a swimming character onto those
            // tiles, and a member cut off by a river would otherwise stand on
            // the bank for ever.
            return this.swimToward(f, x, y);
        },

        swimToward(f, x, y) {
            if (!$gameMap) return false;
            const dirs = f.x !== x || f.y !== y
                ? [dirBetween(f.x, f.y, x, y), Math.abs(y - f.y) > Math.abs(x - f.x)
                    ? (x > f.x ? 6 : 4) : (y > f.y ? 2 : 8)]
                : [];
            for (const d of dirs) {
                if (!d) continue;
                const nx = $gameMap.roundXWithDirection(f.x, d);
                const ny = $gameMap.roundYWithDirection(f.y, d);
                if (!$gameMap.isValid(nx, ny) || !this.isWater(nx, ny)) continue;
                this.setSwimming(f, true);
                f.moveStraight(d);
                if (f.isMovementSucceeded()) return true;
            }
            return false;
        },

        // -------------------------------------------------------- the activities
        think(f) {
            const s = this.stateOf(f);
            if (f.isMoving()) return;
            if (s.wait > 0) {
                s.wait--;
                return;
            }

            // Left so far behind that walking home is pointless: put back.
            if (this.offScreen(f, LOOSE_SNAP_MARGIN)) {
                this.placeBeside(f);
                return;
            }
            // Out of sight and nothing else matters, whatever they were doing:
            // a member off the screen always heads for the leader. Once heading
            // back they keep going until a little inside the edge, so nobody
            // stops dead on the rim and drifts straight out of it again.
            const gone = this.offScreen(f, LOOSE_SIGHT_MARGIN);
            if (gone || (s.act === "return" && this.offScreen(f, -LOOSE_BACK_INSET))) {
                if (s.act !== "return") {
                    this.clearGoal(s);
                    s.act = "return";
                }
                if (!this.stepTo(f, $gamePlayer.x, $gamePlayer.y)) s.wait = 20;
                return;
            }
            if (s.act === "return") this.clearGoal(s);

            switch (s.act) {
                case "walk":
                    return this.stepWalk(f, s);
                case "visit":
                    return this.stepVisit(f, s);
                case "look":
                    return this.stepLook(f, s);
                case "need":
                    return this.stepNeed(f, s);
                case "follow":
                    return this.stepFollow(f, s);
                default:
                    return this.pickActivity(f, s);
            }
        },

        // What a member does next. A meter that has run down comes first: they
        // are people with an evening of their own, not scenery, so a filthy one
        // goes looking for a washroom and a bored one for something to play
        // before anybody strolls anywhere. Then, sometimes, simply walking with
        // the leader for a while, because a companion who never once falls in
        // beside you reads as a stranger. Then company, then something to look
        // at, then a walk, then standing there with a thought.
        pickActivity(f, s) {
            if (this.beginNeed(f, s)) return;
            // Every errand is taken at its own pace, and now and then somebody
            // takes it at a run.
            s.dash = Math.random() < FOLLOW_DASH_ODDS;
            if (Math.random() < FOLLOW_ODDS && this.beginFollow(f, s)) return;
            const roll = Math.random();
            if (roll < 0.36 && this.beginVisit(f, s)) return;
            if (roll < 0.58 && this.beginLook(f, s)) return;
            if (roll < 0.86 && this.beginWalk(f, s)) return;
            this.clearGoal(s);
            s.wait = 60 + Math.floor(Math.random() * 150);
            if (Math.random() < 0.5) this.say(f, "AutoIdle.loose.thought");
        },

        // Walking with the leader, of their own accord: they keep a couple of
        // tiles off their shoulder, at the leader's own speed, for a while, and
        // then go back to their own business. Nothing is chained and nothing is
        // through a wall, so it reads as a person keeping you company rather
        // than as the marching column.
        beginFollow(f, s) {
            this.clearGoal(s);
            s.act = "follow";
            s.until = Graphics.frameCount + FOLLOW_MIN +
                Math.floor(Math.random() * (FOLLOW_MAX - FOLLOW_MIN));
            return true;
        },

        stepFollow(f, s) {
            if (Graphics.frameCount >= (s.until || 0)) {
                this.clearGoal(s);
                s.wait = 30;
                return;
            }
            const d = this.dist(f, $gamePlayer);
            if (d <= FOLLOW_NEAR) {
                // Close enough: face the way the leader is looking and wait for
                // them to move off again.
                if (!$gamePlayer.isMoving()) f.setDirection($gamePlayer.direction());
                return;
            }
            if (!this.stepTo(f, $gamePlayer.x, $gamePlayer.y)) s.wait = 10;
        },

        beginWalk(f, s) {
            for (let i = 0; i < 20; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 2 + Math.random() * (LOOSE_ROAM - 1);
                const x = Math.round($gamePlayer.x + Math.cos(a) * r);
                const y = Math.round($gamePlayer.y + Math.sin(a) * r);
                if ((x !== f.x || y !== f.y) && tilePassable(x, y)) {
                    this.clearGoal(s);
                    s.act = "walk";
                    s.gx = x;
                    s.gy = y;
                    return true;
                }
            }
            return false;
        },

        stepWalk(f, s) {
            if ((f.x === s.gx && f.y === s.gy) || ++s.tries > 40) {
                this.clearGoal(s);
                s.wait = 30;
                return;
            }
            if (!this.stepTo(f, s.gx, s.gy)) s.tries += 4;
        },

        beginVisit(f, s) {
            const mate = this.findCompany(f);
            if (!mate) return false;
            this.clearGoal(s);
            s.act = "visit";
            s.partner = mate;
            this.remember(s, mate);
            return true;
        },

        // Walk over, stop at arm's length, turn to face them and trade a line
        // each. Nothing is triggered: this is two people talking, not the player
        // starting an event.
        stepVisit(f, s) {
            const p = s.partner;
            if (!p || p._erased || (p.isTransparent && p.isTransparent()) || ++s.tries > 90) {
                this.clearGoal(s);
                return;
            }
            if (this.dist(f, p) > 1) {
                if (!this.stepTo(f, p.x, p.y)) s.tries += 6;
                return;
            }
            const facing = dirBetween(f.x, f.y, p.x, p.y);
            if (facing > 0) f.setDirection(facing);
            if (!p.isMoving() && !p.isDirectionFixed()) {
                const back = dirBetween(p.x, p.y, f.x, f.y);
                if (back > 0) p.setDirection(back);
            }
            // Two travellers who have been on the same road all week do not
            // talk to each other the way they talk to a stranger in a village,
            // so the party has a bank of its own.
            const own = !!this.partyActorOf(p);
            if (s.beat === 0) {
                this.say(f, own ? "AutoIdle.loose.partyGreet" : "AutoIdle.loose.greet");
                s.beat = 1;
                s.wait = 100;
                return;
            }
            if (s.beat === 1) {
                this.say(p, own ? "AutoIdle.loose.partyReply" : "AutoIdle.loose.reply");
                s.beat = 2;
                s.wait = 110;
                return;
            }
            // The conversation happened, so it counted: it moves what that
            // person thinks of THIS member (their own standing, not the
            // party's) and it is company for the member who had it.
            this.settleTalk(f, p);
            this.clearGoal(s);
            s.wait = 60;
        },

        // What one exchange did to their opinion. A person is not a vending
        // machine: an unwashed traveller wearing yesterday's road is worse
        // company than a clean one, which is the whole of why the hygiene
        // errand below is worth walking. Handed to NPCEmpathize so a chat in
        // the street and a chat in the panel move the same number the same way
        // (and pay the party the same social).
        settleTalk(f, npcEvent) {
            const actor = this.actorOf(f);
            const helpers = window.NPCEmpathize && window.NPCEmpathize._helpers;
            if (!actor || !helpers) return;
            // One of their own is a conversation with two sides to it, and it
            // is settled on both of them rather than on a stranger's ledger.
            const other = this.partyActorOf(npcEvent);
            if (other) {
                this.settlePartyTalk(actor, other);
                return;
            }
            if (!npcEvent || typeof npcEvent.eventId !== "function") return;
            const name = helpers._getNPCName ? helpers._getNPCName(npcEvent.eventId()) : null;
            const profile = name && helpers._getProfile ? helpers._getProfile(name) : null;
            if (!profile) return;
            let delta = Math.round(-2 + Math.random() * 7); // -2 .. +4
            try {
                if (helpers._hygienePenalty) {
                    delta += helpers._hygienePenalty(profile, actor, 0.12) || 0;
                }
            } catch (e) { /* a chat never breaks on a missing reading */ }
            delta = Math.max(-6, Math.min(6, delta));
            if (!delta) return;
            try {
                helpers._addNpcOpinion(profile, actor.actorId(), delta);
            } catch (e) {
                return;
            }
            this.toastOpinion(actor, name, delta);
        },

        // Two members of the same party talking. Unlike a chat with a stranger
        // this moves BOTH ledgers: each of them comes away thinking a little
        // more, or a little less, of the other. The numbers are the ones the
        // Empathize panel keeps (profile.opinions[actorId], the per-member
        // standing, never the party-wide one) so a road spent walking together
        // shows up on the same sheet a conversation in the panel writes to.
        // What the exchange is worth is read off how much the two of them have
        // in common and how either of them smells right now, which is the whole
        // of why the hygiene errand is worth walking.
        settlePartyTalk(speaker, listener) {
            if (!speaker || !listener || speaker === listener) return;
            const a = this.partyProfile(speaker);
            const b = this.partyProfile(listener);
            if (!a && !b) return;
            // One roll for the exchange, so a conversation that went well went
            // well for both of them, and each side then reads it their own way.
            const mood = -2 + Math.random() * 7; // -2 .. +5, the swing a chat has
            const toListener = this.partyTalkDelta(b, speaker, mood);
            const toSpeaker = this.partyTalkDelta(a, listener, mood);
            const landedB = !!(b && toListener) && this.movePartyOpinion(b, speaker, toListener);
            // Quiet only once the other direction has already paid the party its
            // company: one conversation is one helping of it, however many
            // people were standing in it.
            const landedA = !!(a && toSpeaker) && this.movePartyOpinion(a, listener, toSpeaker, landedB);
            if (!landedB && !landedA) return;
            const dB = landedB ? toListener : 0;
            const dA = landedA ? toSpeaker : 0;
            this.toast(T('AutoIdle.loose.toastPartyTalk', {
                name: speaker.name(),
                other: listener.name(),
                delta: (dB > 0 ? "+" : "") + dB,
                back: (dA > 0 ? "+" : "") + dA,
            }), dB + dA >= 0 ? "good" : "warning");
        },

        // A party member's own society profile, the record the Empathize panel
        // reads. Character creation writes one for every member, so this is
        // normally a lookup; a member who arrived some other way is given one
        // rather than left without a ledger to be remembered on.
        partyProfile(actor) {
            const reg = window.NPCSocietyRegistry;
            if (!actor || !reg) return null;
            try {
                return reg.getProfile(actor.name())
                    || (reg.ensureProfile
                        ? reg.ensureProfile(actor.name(), actor.currentClass() ? actor.currentClass().id : null)
                        : null);
            } catch (e) {
                return null;
            }
        },

        // What this exchange did to `profile`'s opinion of `other`: the mood of
        // the conversation, what the two of them have in common, and how the
        // other one smells.
        partyTalkDelta(profile, other, mood) {
            if (!profile || !other) return 0;
            const helpers = window.NPCEmpathize && window.NPCEmpathize._helpers;
            let delta = mood;
            try {
                if (helpers && helpers._traitCompatBonus) {
                    delta += (helpers._traitCompatBonus(profile, other) || 0) * 0.06;
                }
                if (helpers && helpers._hygienePenalty) {
                    delta += helpers._hygienePenalty(profile, other, 0.12) || 0;
                }
            } catch (e) { /* a chat never breaks on a missing reading */ }
            return Math.max(-6, Math.min(6, Math.round(delta)));
        },

        // Write it down. A direction that is not `quiet` goes through
        // NPCEmpathize's own adder, so the exchange also pays the party its
        // company the way every other conversation does; a quiet one only moves
        // the ledger.
        movePartyOpinion(profile, subject, delta, quiet) {
            const helpers = window.NPCEmpathize && window.NPCEmpathize._helpers;
            if (!helpers || !profile || !subject || !delta) return false;
            try {
                if (quiet && helpers._setNpcBaseOpinion && helpers._npcBaseOpinion) {
                    helpers._setNpcBaseOpinion(
                        profile, subject.actorId(),
                        helpers._npcBaseOpinion(profile, subject.actorId()) + delta
                    );
                } else {
                    helpers._addNpcOpinion(profile, subject.actorId(), delta);
                }
                return true;
            } catch (e) {
                return false;
            }
        },

        // ------------------------------------------------------------- needs
        // The member's own five meters. A pet or a child walking with the party
        // has no actor and no meters, so it simply keeps wandering.
        actorOf(f) {
            return (f && typeof f.actor === "function" && f.actor()) || null;
        },

        needsOf(f) {
            const a = this.actorOf(f);
            if (!a || !window.PartyNeeds) return null;
            try {
                return window.PartyNeeds.getMemberNeeds(a);
            } catch (e) {
                return null;
            }
        },

        // The lowest meter under the line, or nothing at all. Read in a fixed
        // order on a tie so a member does not dither between two equal wants.
        pressingNeed(f) {
            const needs = this.needsOf(f);
            if (!needs) return null;
            let worst = null;
            let low = NEED_LOW;
            for (const key of ["hunger", "sleep", "hygiene", "social", "leisure"]) {
                const v = Number(needs[key]);
                if (!isFinite(v) || v > low) continue;
                if (worst === null || v < low) {
                    worst = key;
                    low = v;
                }
            }
            return worst;
        },

        // What the capability registry's weights want to know about whoever is
        // asking. A party member has no society profile of their own for the
        // fields that matter here, so the party's purse stands in for theirs.
        needProfile(f) {
            const a = this.actorOf(f);
            const gold = $gameParty ? $gameParty.gold() : 0;
            const base = (a && window.NPCSocietyRegistry && window.NPCSocietyRegistry.getProfile)
                ? window.NPCSocietyRegistry.getProfile(a.name())
                : null;
            return Object.assign({ moralityScore: 0, itemIds: [] }, base || {}, {
                money: gold,
                wealthTierBase: gold >= 5000 ? 3 : gold >= 2000 ? 2 : gold >= 600 ? 1 : 0,
            });
        },

        // Start an errand for whatever has run down. Hunger is settled where
        // they stand (the food is in the pack); everything else is somewhere on
        // the map they have to walk to.
        beginNeed(f, s) {
            if (!this.actorOf(f)) return false;
            // A map with nothing to answer a want on it would otherwise be
            // re-scanned on every idle decision for as long as the meter stays
            // low, so a fruitless search stands the member down for a while.
            if (s.needTried && Graphics.frameCount - s.needTried < NEED_RETRY) return false;
            const need = this.pressingNeed(f);
            if (!need) {
                s.needTried = Graphics.frameCount;
                return false;
            }
            // Each want is tried at the thing that really answers it first, and
            // then at whatever the map can offer instead.
            const gaveUp = () => {
                s.needTried = Graphics.frameCount;
                return false;
            };
            if (need === "hunger") return this.eat(f, s) || gaveUp();
            // A bed is paid for, so it never comes through the ordinary target
            // path (which would hand out free sleep); it is its own errand.
            if (need === "sleep" && this.beginRent(f, s)) return true;
            if (need === "social" && this.beginVisit(f, s)) return true;

            const target = this.findForNeed(f, need);
            if (target) {
                this.clearGoal(s);
                s.act = "need";
                s.need = need;
                s.partner = target;
                this.remember(s, target);
                return true;
            }
            // Nothing built for it: sit down, which is worth something for a
            // tired member and for a bored one.
            if ((need === "sleep" || need === "leisure") && this.beginRest(f, s, need)) return true;
            return gaveUp();
        },

        // The nearest thing on the map that answers this need, asked of the
        // town's own capability registry so a party member and a townsperson
        // recognise a washroom by exactly the same rule.
        findForNeed(f, need) {
            const scanner = window.NPCSim && window.NPCSim.InteractionScanner;
            if (!scanner || typeof scanner.findByNeed !== "function") return null;
            let matches = [];
            try {
                matches = scanner.findByNeed(need, this.needProfile(f)) || [];
            } catch (e) {
                return null;
            }
            let best = null;
            let bestD = NEED_SCAN + 1;
            const s = this.stateOf(f);
            for (const m of matches) {
                if (!m || !m.event || (m.score ?? 0) <= 0) continue;
                // A room is rented, never simply used: beginRent owns it.
                if (m.capability && m.capability.id === "rentable_room") continue;
                if (m.event._erased || this.stale(s, m.event)) continue;
                const d = this.dist(f, m.event);
                if (d <= NEED_SCAN && d < bestD) {
                    best = m.event;
                    bestD = d;
                }
            }
            return best;
        },

        // A free room, taken with the party's own money. Tired members are the
        // ones who go looking, which is why this is only ever reached from the
        // sleep branch.
        beginRent(f, s) {
            const rent = window.RentSystem;
            if (!rent || typeof rent.freeRooms !== "function") return false;
            let rooms = [];
            try {
                rooms = rent.freeRooms($gameMap.mapId()) || [];
            } catch (e) {
                return false;
            }
            const gold = $gameParty ? $gameParty.gold() : 0;
            let best = null;
            let bestD = NEED_SCAN + 1;
            for (const room of rooms) {
                if (room.price > gold) continue;
                const ev = $gameMap.event(room.eventId);
                if (!ev || ev._erased) continue;
                const d = this.dist(f, ev);
                if (d <= NEED_SCAN && d < bestD) {
                    best = ev;
                    bestD = d;
                }
            }
            if (!best) return false;
            this.clearGoal(s);
            s.act = "need";
            s.need = "sleep";
            s.rent = true;
            s.partner = best;
            return true;
        },

        // Somewhere to sit down: the same region 102 rest tiles the town's NPCs
        // take their weight off on.
        beginRest(f, s, need) {
            if (!$gameMap) return false;
            let best = null;
            let bestD = NEED_SCAN + 1;
            for (let dy = -NEED_SCAN; dy <= NEED_SCAN; dy++) {
                for (let dx = -NEED_SCAN; dx <= NEED_SCAN; dx++) {
                    const x = $gameMap.roundX(f.x + dx);
                    const y = $gameMap.roundY(f.y + dy);
                    if ($gameMap.regionId(x, y) !== REST_REGION) continue;
                    if (!tilePassable(x, y)) continue;
                    const d = Math.abs(dx) + Math.abs(dy);
                    if (d < bestD) {
                        best = { x, y };
                        bestD = d;
                    }
                }
            }
            if (!best) return false;
            this.clearGoal(s);
            s.act = "need";
            s.need = need;
            s.gx = best.x;
            s.gy = best.y;
            return true;
        },

        // Walk to it, and settle it on arrival. A tile errand (a seat) is done
        // by standing on it; an event errand by standing beside it.
        stepNeed(f, s) {
            if (++s.tries > NEED_TRIES) {
                this.clearGoal(s);
                s.wait = 60;
                return;
            }
            const p = s.partner;
            if (p) {
                if (p._erased) {
                    this.clearGoal(s);
                    return;
                }
                if (this.dist(f, p) > 1) {
                    if (!this.stepTo(f, p.x, p.y)) s.tries += 6;
                    return;
                }
                const facing = dirBetween(f.x, f.y, p.x, p.y);
                if (facing > 0) f.setDirection(facing);
            } else {
                if (s.gx === null) {
                    this.clearGoal(s);
                    return;
                }
                if (f.x !== s.gx || f.y !== s.gy) {
                    if (!this.stepTo(f, s.gx, s.gy)) s.tries += 6;
                    return;
                }
            }
            this.finishNeed(f, s);
        },

        finishNeed(f, s) {
            const need = s.need;
            const seat = !s.partner;
            if (s.rent && !this.payRent(f, s)) {
                this.clearGoal(s);
                s.wait = 90;
                return;
            }
            if (!s.rent) this.fillNeed(f, need, NEED_FILL[need] || 20);
            this.say(f, seat ? "AutoIdle.loose.rest" : "AutoIdle.loose.need." + need);
            this.clearGoal(s);
            // Whatever they came for takes a while: a bath, a game, a nap.
            s.wait = seat ? 300 : 180;
        },

        // Pay for the room and let the party in. A member who rents it rents it
        // for everybody: the door opens the way it does when the player pays at
        // the counter themselves.
        payRent(f, s) {
            const ev = s.partner;
            const rent = window.RentSystem;
            if (!ev || !rent || typeof rent.rentForParty !== "function") return false;
            let deal = null;
            try {
                deal = rent.rentForParty($gameMap.mapId(), ev.eventId());
            } catch (e) {
                return false;
            }
            if (!deal) return false;
            SoundManager.playShop();
            this.fillNeed(f, "sleep", NEED_FILL.sleep);
            const actor = this.actorOf(f);
            this.toast(T('AutoIdle.loose.toastRent', {
                name: actor ? actor.name() : "",
                price: window.ParchmentToast ? window.ParchmentToast.money(deal.price) : String(deal.price),
            }), "good");
            return true;
        },

        // Put the points on the member's own meter and say so. Hunger and sleep
        // are shared by the whole party, the other three are personal; the
        // actor's own need methods already know which is which.
        fillNeed(f, need, amount) {
            const actor = this.actorOf(f);
            if (!actor || !amount) return;
            const adder = { hunger: "addHunger", sleep: "addSleep", hygiene: "addHygiene", social: "addSocial", leisure: "addLeisure" }[need];
            if (!adder || typeof actor[adder] !== "function") return;
            actor[adder](amount);
            this.toastNeed(actor, need, amount);
        },

        // A meal out of the pack. The smallest thing that will do the job is
        // eaten, so a banquet is not spent on a snack's worth of hunger.
        eat(f, s) {
            const actor = this.actorOf(f);
            const utils = window.ItemSystemUtils;
            if (!actor || !$gameParty) return false;
            let best = null;
            let bestValue = Infinity;
            for (const item of $gameParty.items()) {
                if (!item || !item.note) continue;
                const isFood = utils && utils.isFoodItem
                    ? utils.isFoodItem(item)
                    : /<category:\s*Food>/i.test(item.note);
                if (!isFood) continue;
                const value = this.foodValue(item);
                if (value <= 0) continue;
                // Anything that covers the gap, else the largest thing there is.
                const covers = value >= HUNGER_EAT;
                const score = covers ? value : 1000000 - value;
                if (score < bestValue) {
                    best = item;
                    bestValue = score;
                }
            }
            if (!best) return false;
            const gain = this.foodValue(best);
            $gameParty.loseItem(best, 1);
            actor.addHunger(gain);
            if (utils && utils.applyNeedRestores) {
                try { utils.applyNeedRestores(actor, best); } catch (e) { /* the meal still counted */ }
            }
            this.toast(T('AutoIdle.loose.toastEat', { name: actor.name(), item: best.name }), "good");
            this.toastNeed(actor, "hunger", Math.round(gain));
            this.say(f, "AutoIdle.loose.need.hunger");
            if (s) {
                this.clearGoal(s);
                s.wait = 150;
            }
            return true;
        },

        // TimeDateSystem's own recovery formula: calories, protein and fat.
        foodValue(item) {
            const read = (key) => {
                const m = (item.note || "").match(new RegExp("<" + key + ":\\s*(\\d+)>", "i"));
                return m ? Number(m[1]) : 0;
            };
            const value = read("calories") * 0.10 + read("protein") * 2.00 + read("fat") * 1.50;
            return Math.round(value);
        },

        // ------------------------------------------------------------- toasts
        // Everything a loose member does to a meter or to somebody's opinion is
        // reported, because it happens while the player is looking somewhere
        // else. All of it goes through the one notification service.
        toast(text, severity) {
            if (!text) return;
            try {
                window.ParchmentToast && window.ParchmentToast.show(text, {
                    severity: severity || "info", duration: 150,
                });
            } catch (e) { /* a popup never breaks an errand */ }
        },

        toastNeed(actor, need, delta) {
            if (!delta) return;
            const needs = window.PartyNeeds ? window.PartyNeeds.getMemberNeeds(actor) : null;
            try {
                window.ParchmentToast && window.ParchmentToast.need(need, delta, {
                    value: needs ? needs[need] : null,
                    note: actor ? actor.name() : "",
                });
            } catch (e) { /* as above */ }
        },

        toastOpinion(actor, npcName, delta) {
            if (!delta) return;
            this.toast(T('AutoIdle.loose.toastOpinion', {
                name: actor.name(),
                npc: npcName,
                delta: (delta > 0 ? "+" : "") + delta,
            }), delta > 0 ? "good" : "warning");
        },

        beginLook(f, s) {
            const thing = this.findScenery(f);
            if (!thing) return false;
            this.clearGoal(s);
            s.act = "look";
            s.partner = thing;
            this.remember(s, thing);
            return true;
        },

        stepLook(f, s) {
            const p = s.partner;
            if (!p || p._erased || ++s.tries > 70) {
                this.clearGoal(s);
                return;
            }
            if (this.dist(f, p) > 1) {
                if (!this.stepTo(f, p.x, p.y)) s.tries += 6;
                return;
            }
            const facing = dirBetween(f.x, f.y, p.x, p.y);
            if (facing > 0) f.setDirection(facing);
            this.say(f, "AutoIdle.loose.look");
            this.clearGoal(s);
            s.wait = 120;
        },

        // Someone to talk to. Roughly half the time a member turns to their own
        // company first, the leader or whoever else is walking with them; the
        // rest of the time it is the town, where the living NPCs the NPC system
        // is currently running come first (they are the ones with a life to
        // talk about), then any other person on the map. Whichever was asked
        // first, the other is the fallback, so nobody stands there with nothing
        // to say while somebody is standing right next to them.
        findCompany(f) {
            const own = Math.random() < PARTY_TALK_ODDS;
            if (own) {
                const mate = this.findPartyCompany(f);
                if (mate) return mate;
            }
            let best = null;
            let bestD = LOOSE_SCAN + 1;
            const s = this.stateOf(f);
            const consider = (c) => {
                if (!c || c === f || this.stale(s, c)) return;
                const d = this.dist(f, c);
                if (d <= LOOSE_SCAN && d < bestD) {
                    best = c;
                    bestD = d;
                }
            };
            const ctrls =
                $gameSystem && typeof $gameSystem.getActiveNPCControllers === "function"
                    ? $gameSystem.getActiveNPCControllers()
                    : null;
            if (ctrls && ctrls.length) {
                for (const c of ctrls) {
                    if (c && c.event && !c.event._erased && !c.event.isTransparent()) consider(c.event);
                }
            }
            if (!best) {
                for (const ev of $gameMap.events()) {
                    if (isPersonEvent(ev)) consider(ev);
                }
            }
            if (!best && !own) best = this.findPartyCompany(f);
            return best;
        },

        // The nearest of their own: the leader, or another member walking with
        // them. A pet or a child is company to walk up to like anybody else,
        // but it holds no conversation, so nothing is settled over it.
        findPartyCompany(f) {
            if (!$gamePlayer || $gamePlayer.isInVehicle()) return null;
            const s = this.stateOf(f);
            let best = null;
            let bestD = LOOSE_SCAN + 1;
            const consider = (c) => {
                if (!c || c === f || this.stale(s, c)) return;
                if (c.isTransparent && c.isTransparent()) return;
                const d = this.dist(f, c);
                if (d <= LOOSE_SCAN && d < bestD) {
                    best = c;
                    bestD = d;
                }
            };
            consider($gamePlayer);
            for (const other of $gamePlayer.followers().data()) {
                if (other.isVisible()) consider(other);
            }
            return best;
        },

        // The actor behind a character, when that character is one of the
        // party: the leader for the player, the member for a follower. Anybody
        // else on the map (an NPC event, a pet) answers null.
        partyActorOf(c) {
            if (!c) return null;
            if (c === $gamePlayer) return ($gameParty && $gameParty.leader()) || null;
            if (this.isAlwaysLoose(c)) return null;
            return this.actorOf(c);
        },

        findScenery(f) {
            const s = this.stateOf(f);
            let best = null;
            let bestD = LOOSE_SCAN + 1;
            for (const ev of $gameMap.events()) {
                if (!isSceneryEvent(ev) || this.stale(s, ev)) continue;
                const d = this.dist(f, ev);
                if (d <= LOOSE_SCAN && d < bestD) {
                    best = ev;
                    bestD = d;
                }
            }
            return best;
        },

        // ------------------------------------------------------------- regroup
        // Put one member back on a free tile at the leader's shoulder.
        placeBeside(f, taken) {
            const px = $gamePlayer.x;
            const py = $gamePlayer.y;
            const ring = [
                [0, 1], [0, -1], [1, 0], [-1, 0],
                [1, 1], [-1, 1], [1, -1], [-1, -1],
                [0, 2], [0, -2], [2, 0], [-2, 0],
            ];
            for (const [dx, dy] of ring) {
                const x = $gameMap.roundX(px + dx);
                const y = $gameMap.roundY(py + dy);
                const key = x + "," + y;
                if (taken && taken.has(key)) continue;
                if (!tilePassable(x, y)) continue;
                // Never drop somebody on top of a solid event: standing inside
                // a chest or a shopkeeper reads as a bug even though a follower
                // blocks nothing.
                if ($gameMap.eventsXyNt(x, y).some((e) => e.isNormalPriority())) continue;
                if (taken) taken.add(key);
                f.locate(x, y);
                f.setDirection($gamePlayer.direction());
                this.clearGoal(this.stateOf(f));
                return true;
            }
            // Nowhere free: standing on the leader is still better than being
            // left on the other side of the map.
            f.locate(px, py);
            f.setDirection($gamePlayer.direction());
            this.clearGoal(this.stateOf(f));
            return false;
        },

        // The whole party back at the leader's side at once: coming out of a
        // battle, taking a transfer event, or arriving on a new map.
        gatherNear() {
            if (!$gamePlayer || !$gameMap) return;
            // Riding, the party is inside the vehicle with the leader; putting
            // them on the tiles around it would drop them in the water.
            if ($gamePlayer.isInVehicle()) return;
            const taken = new Set([$gamePlayer.x + "," + $gamePlayer.y]);
            for (const f of $gamePlayer.followers().data()) {
                if (!f.isVisible()) continue;
                this.placeBeside(f, taken);
            }
            this._recall = false;
            this._still = 0;
            this._run = 0;
            Bubbles.clear();
        },

        // --------------------------------------------------------- talking to one
        // The member standing on the tile the leader is facing.
        facedFollower() {
            if (!this.active()) return null;
            const d = $gamePlayer.direction();
            const fx = $gameMap.roundXWithDirection($gamePlayer.x, d);
            const fy = $gameMap.roundYWithDirection($gamePlayer.y, d);
            for (const f of $gamePlayer.followers().data()) {
                if (!f.isVisible() || f.isTransparent()) continue;
                if (f.pos(fx, fy)) return f;
            }
            return null;
        },

        talkTo(f) {
            const actor = f && f.actor();
            if (!actor) return false;
            if (!window.NPCEmpathize || typeof window.NPCEmpathize.openForActor !== "function") return false;
            f.setDirection(f.reverseDir($gamePlayer.direction()));
            this.clearGoal(this.stateOf(f));
            Bubbles.clear();
            window.NPCEmpathize.openForActor(actor.actorId());
            return true;
        },
    };

    AutoIdle.loose = Loose;
    window.AutoIdleExplorer = AutoIdle;

    // ========================================================================
    // Party formation hooks
    // ========================================================================
    // 0) Map 315 (the world map) draws the party as a single dot, whatever the
    //    formation: a marching Close column or a scattered Loose one would both
    //    show human-scale sprites on a screen where one tile is a whole region.
    //    Followers are hidden by opacity rather than by blanking their image
    //    (Game_Follower.refresh only reruns on specific triggers, so an
    //    isVisible()-driven approach would not react to a plain map transfer),
    //    the same trick SplitScreenMultiplayer.js uses to hide Player 2's.
    const _Game_Followers_update_worldMap = Game_Followers.prototype.update;
    Game_Followers.prototype.update = function () {
        const onWorldMap = $gameMap && $gameMap.mapId() === 315;
        const targetOpacity = onWorldMap ? 0 : 255;
        for (const follower of this._data) {
            if (follower.opacity() !== targetOpacity) follower.setOpacity(targetOpacity);
        }
        _Game_Followers_update_worldMap.call(this);
    };

    // 1) The chase itself. In Loose the rope is cut, except while the party is
    //    being called in (a running leader, or an event's Gather Party).
    const _Game_Followers_updateMove_loose = Game_Followers.prototype.updateMove;
    Game_Followers.prototype.updateMove = function () {
        // A map battle (BattleSystem/MapBattleMode.js) walks every member itself,
        // one tile at a time, and each one holds the tile it is fighting from.
        // Neither branch below may run: the loose layer is off for the fight
        // anyway (conditionsMet), which means control would fall through to the
        // marching column and chaseCharacter would drag the whole train along
        // behind every tactical step the leader takes, undoing the positioning
        // the fight is being fought over. Checked before recalling() too, since
        // a Gather Party queued before the fight would do the same.
        if (Loose.inMapBattle()) return;
        if (Loose.recalling()) {
            _Game_Followers_updateMove_loose.call(this);
            return;
        }
        if (Loose.active()) return;
        // Close ranks, except for the slots that are never in the column at all
        // (a pet, a child, a creature follower). The chain is walked by hand so
        // those are left out of it and everyone else keeps the rope.
        for (let i = this._data.length - 1; i >= 0; i--) {
            const f = this._data[i];
            if (Loose.activeFor(f)) continue;
            f.chaseCharacter(i > 0 ? this._data[i - 1] : $gamePlayer);
        }
    };

    // 2) Each member's own turn to act, once per frame.
    const _Game_Follower_update_loose = Game_Follower.prototype.update;
    Game_Follower.prototype.update = function () {
        _Game_Follower_update_loose.call(this);
        try {
            Loose.updateFollower(this);
        } catch (e) {
            console.error("[AutoIdleExplorer] loose follower error:", e);
        }
    };

    // 3) OK on a member standing in front of the leader opens their Empathize
    //    sheet, the same page the Dynamics roster opens. Checked before the
    //    engine's own action button so the member is not walked through.
    const _Game_Player_triggerButtonAction_loose = Game_Player.prototype.triggerButtonAction;
    Game_Player.prototype.triggerButtonAction = function () {
        if (Input.isTriggered("ok") && !this.isInVehicle()) {
            const f = Loose.facedFollower();
            if (f && Loose.talkTo(f)) return true;
        }
        return _Game_Player_triggerButtonAction_loose.call(this);
    };

    // ========================================================================
    // Scene hooks
    // ========================================================================
    const _SceneMap_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _SceneMap_update.call(this);
        try {
            Loose.update();
        } catch (e) {
            console.error("[AutoIdleExplorer] formation update error:", e);
        }
        try {
            AutoIdle.ensureP2Hook();
            AutoIdle.updateOnMap();
        } catch (e) {
            console.error("[AutoIdleExplorer] map update error:", e);
        }
    };

    const _SceneMap_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function () {
        // Hide the badges while off-map; engaged state is restored on return.
        AutoIdle.hideBadge();
        AutoIdle.p2.hideBadge();
        Bubbles.clear();
        _SceneMap_terminate.call(this);
    };

    const _SceneMap_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _SceneMap_start.call(this);
        // A transfer event, a change of map, or walking out of a battle: the
        // party is put back at the leader's shoulder instead of being left
        // scattered over the map it was last standing on. Close needs none of
        // this, the engine already stacks the column on the leader's tile.
        const mapId = $gameMap ? $gameMap.mapId() : 0;
        // A map battle (BattleSystem/MapBattleMode.js) never leaves Scene_Map:
        // it ends by re-running start() to reach the corpse/reward hooks. The
        // party has not arrived anywhere, it has been standing here fighting,
        // and putting it back at the leader's shoulder now would undo every
        // position the fight was fought over.
        const reentry = !!(window.MapBattleMode && window.MapBattleMode.isReentering &&
            window.MapBattleMode.isReentering());
        const arrived = !reentry &&
            (this._transfer || SceneManager.isPreviousScene(Scene_Battle) || Loose.mapId !== mapId);
        if (arrived) {
            // The pet slot is loose on every map, so its errands are dropped on
            // arrival whatever the party formation is. Only a loose party has to
            // be put back at the leader's shoulder: in Close the engine has
            // already stacked the column, pet included, on the leader's tile.
            Loose.resetStates();
            if (Loose.mode() === FORM_LOOSE) Loose.gatherNear();
        }
        Loose.mapId = mapId;
        if (AutoIdle.engaged && ConfigManager.autoIdle) AutoIdle.showBadge();
        if (AutoIdle.p2.engaged && ConfigManager.autoIdle) AutoIdle.p2.showBadge();
    };

    const _SceneBattle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function () {
        if (AutoIdle.shouldAutoBattle()) AutoIdle.driveBattle(this);
        _SceneBattle_update.call(this);
    };

    // Best-effort: pop out of a standard shop scene after a short delay so the
    // autopilot never gets stuck inside a menu it cannot meaningfully drive.
    const _SceneShop_update = Scene_Shop.prototype.update;
    Scene_Shop.prototype.update = function () {
        _SceneShop_update.call(this);
        if (AutoIdle.shouldAutoBattle()) {
            this._autoShopTimer = (this._autoShopTimer || 0) + 1;
            if (this._autoShopTimer > 90 && !this.isBusy()) {
                this.popScene();
            }
        }
    };

    // ========================================================================
    // Scene_Menu, navigate the command list to "Items", then close when done.
    // ========================================================================
    const _SceneMenu_update = Scene_Menu.prototype.update;
    Scene_Menu.prototype.update = function () {
        _SceneMenu_update.call(this);
        if (!AutoIdle.shouldAutoBattle()) return;
        if (MenuNav.delay > 0) { MenuNav.delay--; return; }

        // Item use complete, Scene_Item already popped back here; close the menu.
        if (MenuNav.phase === 'done') {
            MenuNav.clear();
            if (!this.isBusy() && this.popScene) this.popScene();
            return;
        }

        // Safety: never stay stuck in the menu indefinitely.
        if (++MenuNav.timeout > 300) {
            MenuNav.clear();
            if (this.popScene) this.popScene();
            return;
        }

        const cw = this._commandWindow;
        if (!cw || !cw.active) return;

        if (MenuNav.intent === 'item') {
            const list = cw._list || [];
            for (let i = 0; i < list.length; i++) {
                if (list[i] && list[i].symbol === 'item') {
                    cw.select(i);
                    if (cw.callOkHandler) cw.callOkHandler();
                    MenuNav.delay = 15;
                    return;
                }
            }
            // No item command in this menu layout, bail out.
            MenuNav.clear();
            if (this.popScene) this.popScene();
        } else {
            // No remaining intent, close menu.
            MenuNav.clear();
            if (cw.processCancel) cw.processCancel();
        }
    };

    // ========================================================================
    // Scene_Item, select category → item → actor target, then exit cleanly.
    // ========================================================================
    const _SceneItem_update = Scene_Item.prototype.update;
    Scene_Item.prototype.update = function () {
        _SceneItem_update.call(this);
        if (!AutoIdle.shouldAutoBattle()) return;
        if (!MenuNav.intent && MenuNav.phase !== 'done') return;
        if (MenuNav.delay > 0) { MenuNav.delay--; return; }

        const catW = this._categoryWindow;
        const iw   = this._itemWindow;
        const aw   = this._actorWindow;

        // Phase done, unwind out of Scene_Item one cancel at a time.
        if (MenuNav.phase === 'done') {
            if (iw && iw.active) {
                if (iw.processCancel) iw.processCancel();
                MenuNav.delay = 10;
            } else if (catW && catW.active) {
                if (catW.processCancel) catW.processCancel();
                MenuNav.delay = 10;
            }
            return;
        }

        // Category window, pick the consumable ('item') category.
        if (catW && catW.active) {
            const list = catW._list || [];
            let idx = 0;
            for (let i = 0; i < list.length; i++) {
                if (list[i] && list[i].symbol === 'item') { idx = i; break; }
            }
            catW.select(idx);
            if (catW.callOkHandler) catW.callOkHandler();
            MenuNav.delay = 10;
            MenuNav.phase = 'item';
            return;
        }

        // No category window present, skip straight to item selection.
        if (MenuNav.phase === 'category') MenuNav.phase = 'item';

        // Item window, find and select our target item.
        if (iw && iw.active && MenuNav.phase === 'item') {
            const target = MenuNav.targetItem;
            const count  = iw.maxItems ? iw.maxItems() : 0;
            for (let i = 0; i < count; i++) {
                const entry = iw.itemAt ? iw.itemAt(i) : (iw._data && iw._data[i]);
                if (entry && entry.id === target.id) {
                    iw.select(i);
                    if (iw.callOkHandler) iw.callOkHandler();
                    MenuNav.delay = 15;
                    MenuNav.phase = 'actor';
                    return;
                }
            }
            // Item not visible in this category, bail.
            MenuNav.intent = null;
            MenuNav.phase  = 'done';
            MenuNav.delay  = 5;
            return;
        }

        // Actor window, select the target party member.
        if (aw && aw.active && MenuNav.phase === 'actor') {
            const idx = MenuNav.targetMember ? MenuNav.targetMember.index() : 0;
            aw.select(Math.max(0, Math.min(idx, (aw.maxItems ? aw.maxItems() : 1) - 1)));
            if (aw.callOkHandler) aw.callOkHandler();
            MenuNav.intent = null;
            MenuNav.phase  = 'done';
            MenuNav.delay  = 15;
            return;
        }

        // Actor phase but actor window never appeared (AoE/no-target item used directly).
        if (iw && iw.active && MenuNav.phase === 'actor') {
            MenuNav.intent = null;
            MenuNav.phase  = 'done';
            MenuNav.delay  = 10;
        }
    };

    // ========================================================================
    // Generic escape, any other scene the CPU triggered but cannot drive gets
    // popped after a short timeout so exploration can resume.
    // ========================================================================
    const _SceneBase_update = Scene_Base.prototype.update;
    Scene_Base.prototype.update = function () {
        _SceneBase_update.call(this);
        // Release any synthetic key we are holding (see sendCancelKey). Done here
        // so it fires in every scene, not just on the map.
        if (AutoIdle.keyUpTimer > 0 && --AutoIdle.keyUpTimer === 0) {
            AutoIdle.dispatchKey("keyup", 27, "Escape");
        }
        if (!AutoIdle.shouldAutoBattle()) return;
        if (
            this instanceof Scene_Map    ||
            this instanceof Scene_Battle ||
            this instanceof Scene_Menu   ||
            this instanceof Scene_Item   ||
            this instanceof Scene_Shop
        ) return;
        this._autoEscapeTimer = (this._autoEscapeTimer || 0) + 1;
        // First, give the scene a chance to close itself cleanly via its own
        // cancel/escape handler (most custom plugin scenes pop on Cancel).
        if (this._autoEscapeTimer === 60) {
            try { AutoIdle.sendCancelKey(); } catch (e) {}
        }
        // Fallback: force the scene off the stack if it is still stuck.
        if (this._autoEscapeTimer > 180 && !this.isBusy()) {
            this._autoEscapeTimer = 0;
            try { if (this.popScene) this.popScene(); } catch (e) {}
        }
    };
})();
