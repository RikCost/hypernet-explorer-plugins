/*:
 * @target MZ
 * @plugindesc v1.2.0 Auto Idle Explorer, when idle, the CPU takes control of the player to explore, interact, fight and heal. Off by default.
 * @author esoteric-heavy-industries & Assistant
 *
 * @help AutoIdleExplorer.js
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

    // Watchdog / dismissal tuning for arbitrary external plugin menus.
    const BLOCK_LIMIT = 240;  // frames the map may stay un-drivable (no message,
                              // no detected overlay) before we poke Cancel.
    const MAX_DISMISS = 6;    // give up dismissing after this many tries → relinquish.
    const DISMISS_COOL = 45;  // frames between dismiss attempts (~0.75s).
    const KEYUP_DELAY = 5;    // frames a synthetic key is held before release.

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
    // ConfigManager persistence, option defaults OFF.
    // ========================================================================
    ConfigManager.autoIdle = false;

    const _makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _makeData.call(this);
        config.autoIdle = this.autoIdle;
        return config;
    };

    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _applyData.call(this, config);
        this.autoIdle = config.autoIdle !== undefined ? config.autoIdle : false;
    };

    // ========================================================================
    // Options menu entry (Gameplay tab).
    // ========================================================================
    if (window.GameOptions && typeof GameOptions.registerOption === "function") {
        GameOptions.registerOption(
            "autoIdle",
            T('AutoIdle.optionName'),
            () => ConfigManager.autoIdle,
            (value) => { ConfigManager.autoIdle = value; if (!value) AutoIdle.disengage(); },
            "gameplay",
            "boolean"
        );
        const tab = GameOptions.tabs.find((t) => t.id === "gameplay");
        if (tab && !tab.symbols.includes("autoIdle")) tab.symbols.push("autoIdle");
    } else {
        // Fallback: append to the vanilla options list.
        const _addGeneral = Window_Options.prototype.addGeneralOptions;
        Window_Options.prototype.addGeneralOptions = function () {
            _addGeneral.call(this);
            this.addCommand(T('AutoIdle.optionName'), "autoIdle");
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

            if (this.engaged) {
                this.updateEngaged();
                return;
            }

            // Not engaged yet: count idle frames (only on a clean, drivable map).
            if (!onDrivableMap()) {
                this.idle = 0;
                return;
            }
            if (manualInputDetected() || $gamePlayer.isMoving() || $gameTemp.isDestinationValid()) {
                this.idle = 0;
                return;
            }
            if (++this.idle >= IDLE_FRAMES) this.engage();
        },

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
            // Heuristic: a non-canvas DOM element capturing the screen centre
            // means a plugin overlay/menu is sitting on top of the map. Passive
            // HUDs use pointer-events:none (so elementFromPoint skips them), and
            // render layers (lighting, fog, parallax) are <canvas> (excluded),
            // which keeps this from firing on ordinary map decoration.
            // The elementFromPoint hit-test forces a layout, so it's throttled to
            // every 15 frames; the result is cached in between.
            if (typeof document !== "undefined" && document.elementFromPoint) {
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
                    if (
                        el &&
                        el !== this._badge &&
                        el !== document.body &&
                        el !== document.documentElement &&
                        el.tagName !== "CANVAS"
                    ) {
                        this._extMenuDomCache = { name: "overlay", el, close: null };
                    } else {
                        this._extMenuDomCache = null;
                    }
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
            // on escape/cancel.
            // Guard: on Scene_Map, Escape opens the main menu rather than closing
            // anything, so skip the keypress and let dismissTries exhaust naturally.
            if (SceneManager._scene instanceof Scene_Map) return;
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

    window.AutoIdleExplorer = AutoIdle;

    // ========================================================================
    // Scene hooks
    // ========================================================================
    const _SceneMap_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _SceneMap_update.call(this);
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
        _SceneMap_terminate.call(this);
    };

    const _SceneMap_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _SceneMap_start.call(this);
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
