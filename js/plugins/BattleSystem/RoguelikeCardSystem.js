/*:
 * @target MZ
 * @plugindesc RoguelikeCardSystem v2.0.0 (per-actor decks, card combat mode)
 * @author Omni-Lex, reworked
 * @help
 * ============================================================================
 * Roguelike Card System for RPGMaker MZ
 * ============================================================================
 *
 * A card-based battle layer that activates when Switch 45 is ON (a per-save
 * choice made at new-game time via the Character Creation "Combat Mode" step)
 * or when the "Card Combat" toggle in Options > Experimental is enabled. The
 * option can be switched at any time; the running battle keeps the mode it
 * started with, and the new value applies from the next battle on.
 *
 * The hand and the energy panel are drawn as an HTML overlay above the canvas
 * (#html-cardhand-overlay), so card text stays sharp regardless of the render
 * scale or the PSX shader. Input still runs through Input/TouchInput.
 *
 * Design (see docs/tasks/roguelike-card-rework.md):
 * - Per-actor decks: every party member has their own deck / hand / energy,
 *   auto-built from that member's class skills. No deck builder.
 * - Built on the Individual Turn Battle System (IndividualBattleTurns.js):
 *   each member takes its own input turn; playing one card IS that member's
 *   action for the turn. Energy and a fresh card are granted at the start of
 *   each member's turn (BattleManager.startActorInput).
 * - Energy replaces MP/TP: cards cost Energy; the spent MP/TP is refunded.
 * - Command window integrates with BattleSystemEnhanchedCommands.js (this
 *   plugin must load AFTER it).
 *
 * Balance:
 * - Energy cost = clamp(1, ceil((mp + tp*0.5)/8), 6). Basic Attack = 1.
 * - Energy: starts at 0, +1 at the start of each of the member's turns,
 *   capped at 6. Pass Turn grants +2 and draws a card.
 * - Deck: each skill added with copies weighted by cost (cheaper = more),
 *   padded to a minimum of 8 with Attack.
 * - Hand of 4, draw 1 each turn, opening hand of 4 with a guaranteed cheap card.
 *
 * @param cardWidth
 * @text Card Width
 * @type number
 * @default 150
 *
 * @param cardHeight
 * @text Card Height
 * @type number
 * @default 220
 *
 * @param handY
 * @text Hand Y Position
 * @type number
 * @default 380
 *
 * @param deckX
 * @text Energy/Deck X Position
 * @type number
 * @default 700
 *
 * @param deckY
 * @text Energy/Deck Y Position
 * @type number
 * @default 50
 */

(() => {
    'use strict';

    const pluginName = 'RoguelikeCardSystem';
    const parameters = PluginManager.parameters(pluginName);
    const cardWidth = Number(parameters['cardWidth'] || 150);
    const cardHeight = Number(parameters['cardHeight'] || 220);
    const handY = Number(parameters['handY'] || 380);
    const deckX = Number(parameters['deckX'] || 700);
    const deckY = Number(parameters['deckY'] || 50);

    //========================================================================
    // Tunables
    //========================================================================
    const CARD_MODE_SWITCH = 45;
    const HAND_SIZE = 4;
    const OPENING_HAND = 4;
    const START_ENERGY = 0;     // gain +1 on the first turn -> 1 to spend
    const ENERGY_PER_TURN = 1;
    const MAX_ENERGY = 6;
    const DECK_MIN = 8;
    const PASS_ENERGY_BONUS = 2;
    const ATTACK_SKILL_ID = 1;
    const ENEMY_Y_OFFSET = 120; // lift enemies so the hand has room at the bottom

    // Card combat is active when EITHER the per-save Switch 45 (chosen at
    // character creation) is ON, or the global "Card Combat" experimental
    // option is enabled in the options menu.
    const isCardModeEnabled = () => {
        if (ConfigManager && ConfigManager.cardCombat === true) return true;
        return !!(window.$gameSwitches && $gameSwitches.value(CARD_MODE_SWITCH));
    };
    window.isCardCombatMode = isCardModeEnabled;

    // The option can be toggled at any time, including from the in-battle
    // options menu. Flipping it mid-fight would strand the hand sprites and the
    // command window in an inconsistent state, so the value is latched when a
    // battle is set up and that latch is what the battle code reads.
    let _cardBattleLatch = false;
    const isCardMode = () => {
        if (window.$gameParty && $gameParty.inBattle()) return _cardBattleLatch;
        return isCardModeEnabled();
    };

    const _BattleManager_setup = BattleManager.setup;
    BattleManager.setup = function(troopId, canEscape, canLose) {
        _cardBattleLatch = isCardModeEnabled();
        _BattleManager_setup.call(this, troopId, canEscape, canLose);
    };

    // Module-scoped safety-net backup of Input.keyMapper taken when a card battle
    // remaps A/D. Cleared once the mapper is restored (in terminate or Scene_Map).
    let _cardKeyMapperBackup = null;

    // Card mode (Switch 45) is a per-save choice locked in during character
    // creation (CharacterCreation.js "Combat Mode" step). Any attempt to turn
    // it ON from anywhere else is ignored, so the only way to enable card combat
    // is the creation flow.
    const _Game_Switches_setValue = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function(switchId, value) {
        if (switchId === CARD_MODE_SWITCH && value === true) {
            const scene = SceneManager._scene;
            const inCreation = scene && scene.constructor && scene.constructor.name === 'Scene_CharacterCreation';
            if (!inCreation) return; // can only be enabled in character creation
        }
        _Game_Switches_setValue.call(this, switchId, value);
    };

    //========================================================================
    // Helpers
    //========================================================================
    function cardEnergyCost(skillId) {
        const skill = $dataSkills[skillId];
        if (!skill) return 1;
        const raw = Math.ceil((skill.mpCost + skill.tpCost * 0.5) / 8);
        return Math.min(MAX_ENERGY, Math.max(1, raw));
    }

    // Cheaper cards appear in more copies, expensive ones in fewer.
    function maxCopiesForCost(cost) {
        if (cost <= 1) return 4;
        if (cost <= 2) return 3;
        if (cost <= 4) return 2;
        return 1;
    }

    function isSkillUsableInBattle(skill) {
        if (!skill) return false;
        if (skill.occasion === 2 || skill.occasion === 3) return false; // menu-only / never
        return skill.occasion === 0 || skill.occasion === 1;
    }

    // All battle-usable skills available to an actor in card mode: the full
    // class kit (regardless of learned level) plus any extra learned skills.
    function usableSkillsForActor(actor) {
        const seen = new Set();
        const out = [];
        const cls = $dataClasses[actor._classId];
        if (cls && cls.learnings) {
            for (const l of cls.learnings) {
                const s = $dataSkills[l.skillId];
                if (s && isSkillUsableInBattle(s) && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
            }
        }
        for (const sid of actor._skills) {
            const s = $dataSkills[sid];
            if (s && isSkillUsableInBattle(s) && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
        }
        return out;
    }

    // Per-actor deck registry, rebuilt each battle. Key = actorId.
    window.$cardDecks = {};

    function getActiveDeck() {
        const actor = (BattleManager.actor && BattleManager.actor());
        if (!actor) return null;
        return window.$cardDecks[actor.actorId()] || null;
    }
    window.getActiveDeck = getActiveDeck;

    function activeCanAfford(cost) {
        const deck = getActiveDeck();
        return !!deck && deck.energy >= cost;
    }

    //========================================================================
    // Card
    //========================================================================
    class Card {
        constructor(skillId) {
            const data = $dataSkills[skillId];
            this.type = 'skill';
            this.id = skillId;
            this.data = data;
            this.name = data ? data.name : '';
            this.iconIndex = data ? data.iconIndex : 0;
            this.description = data ? data.description : '';
            this.energyCost = cardEnergyCost(skillId);
        }

        canUse(actor) {
            const deck = getActiveDeck();
            if (!deck || deck.energy < this.energyCost) return false;
            const skill = $dataSkills[this.id];
            if (!skill) return false;
            return skill.occasion === 0 || skill.occasion === 1;
        }

        needsTarget() {
            const skill = $dataSkills[this.id];
            if (!skill) return true;
            return skill.scope === 1 || skill.scope === 3 || skill.scope === 7;
        }

        createAction(actor) {
            const action = new Game_Action(actor);
            action.setSkill(this.id);
            return action;
        }
    }

    //========================================================================
    // DeckState (one per actor)
    //========================================================================
    class DeckState {
        constructor(actor) {
            this.actorId = actor.actorId();
            this.deck = [];
            this.hand = [];
            this.discard = [];
            this.selectedIndex = 0;
            this.energy = START_ENERGY;
            this.build(actor);
            this.shuffle();
            this.drawOpeningHand();
        }

        build(actor) {
            const skills = usableSkillsForActor(actor);
            for (const s of skills) {
                const copies = maxCopiesForCost(cardEnergyCost(s.id));
                for (let i = 0; i < copies; i++) this.deck.push(new Card(s.id));
            }
            // Pad thin kits so there is always something to draw.
            while (this.deck.length < DECK_MIN && $dataSkills[ATTACK_SKILL_ID]) {
                this.deck.push(new Card(ATTACK_SKILL_ID));
            }
        }

        shuffle() {
            for (let i = this.deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
            }
        }

        draw(n) {
            for (let i = 0; i < n; i++) {
                if (this.deck.length === 0) {
                    this.deck = this.discard;
                    this.discard = [];
                    this.shuffle();
                }
                if (this.deck.length > 0 && this.hand.length < HAND_SIZE) {
                    this.hand.push(this.deck.pop());
                }
            }
        }

        // Guarantee at least one cheap (cost <= 1) card in the opening hand so a
        // turn-one play is always possible.
        drawOpeningHand() {
            this.draw(OPENING_HAND);
            if (this.hand.some(c => c.energyCost <= 1) || this.hand.length === 0) return;

            let hi = 0;
            for (let i = 1; i < this.hand.length; i++) {
                if (this.hand[i].energyCost > this.hand[hi].energyCost) hi = i;
            }
            const lowIdx = this.deck.findIndex(c => c.energyCost <= 1);
            if (lowIdx >= 0) {
                const low = this.deck.splice(lowIdx, 1)[0];
                this.deck.push(this.hand[hi]);
                this.hand[hi] = low;
            } else if ($dataSkills[ATTACK_SKILL_ID]) {
                this.deck.push(this.hand[hi]);
                this.hand[hi] = new Card(ATTACK_SKILL_ID);
            }
        }

        playSelected() {
            const i = this.selectedIndex;
            if (i < 0 || i >= this.hand.length) return null;
            const card = this.hand.splice(i, 1)[0];
            this.discard.push(card);
            if (this.selectedIndex >= this.hand.length) {
                this.selectedIndex = Math.max(0, this.hand.length - 1);
            }
            return card;
        }

        current() { return this.hand[this.selectedIndex] || null; }
        selectNext() { if (this.hand.length) this.selectedIndex = (this.selectedIndex + 1) % this.hand.length; }
        selectPrevious() { if (this.hand.length) this.selectedIndex = (this.selectedIndex - 1 + this.hand.length) % this.hand.length; }
        gainEnergy(n) { this.energy = Math.min(MAX_ENERGY, this.energy + n); }
        spend(cost) { if (this.energy >= cost) { this.energy -= cost; return true; } return false; }
    }

    // In card mode, Energy is the only resource: actor skills are always
    // payable and never deduct MP/TP. This keeps a card's action valid even
    // when the actor lacks the skill's normal MP/TP (Game_Action.isValid()
    // checks canUse -> canPaySkillCost), and removes any need to refund cost.
    const _Game_BattlerBase_canPaySkillCost = Game_BattlerBase.prototype.canPaySkillCost;
    Game_BattlerBase.prototype.canPaySkillCost = function(skill) {
        if (isCardMode() && this.isActor()) return true;
        return _Game_BattlerBase_canPaySkillCost.call(this, skill);
    };

    const _Game_BattlerBase_paySkillCost = Game_BattlerBase.prototype.paySkillCost;
    Game_BattlerBase.prototype.paySkillCost = function(skill) {
        if (isCardMode() && this.isActor()) return;
        _Game_BattlerBase_paySkillCost.call(this, skill);
    };

    function buildDecksForParty() {
        window.$cardDecks = {};
        for (const actor of $gameParty.battleMembers()) {
            if (actor && actor.isAlive()) {
                window.$cardDecks[actor.actorId()] = new DeckState(actor);
            }
        }
    }

    //========================================================================
    // HTML card overlay
    //========================================================================
    // The hand is drawn with DOM elements layered over the canvas instead of
    // PIXI sprites: canvas-drawn text goes through the game's render scale (and
    // through the PSX shader's downscale/dither when that is on), which left
    // card names and descriptions unreadable. DOM text renders at the display's
    // native resolution and stays sharp.
    //
    // The overlay is purely visual and never takes pointer events, so hovering
    // and clicking cards keeps going through TouchInput exactly as before.

    const CARD_OVERLAY_ID = 'html-cardhand-overlay';
    const CARD_STYLE_ID = 'html-cardhand-style';

    // Canvas rect cache (same pattern as BattleSystemEnhanchedCommands.js):
    // getBoundingClientRect() forces a layout, so only recompute on resize.
    let _cachedCardScale = null;
    window.addEventListener('resize', () => { _cachedCardScale = null; });

    function cardCanvasScale() {
        if (_cachedCardScale) return _cachedCardScale;
        const el = document.getElementById('gameCanvas');
        if (!el) return { sx: 1, sy: 1, ox: 0, oy: 0 };
        const r = el.getBoundingClientRect();
        _cachedCardScale = {
            sx: r.width / Graphics.width,
            sy: r.height / Graphics.height,
            ox: r.left,
            oy: r.top
        };
        return _cachedCardScale;
    }

    function ensureCardStyle() {
        if (document.getElementById(CARD_STYLE_ID)) return;
        const st = document.createElement('style');
        st.id = CARD_STYLE_ID;
        st.textContent = `
#${CARD_OVERLAY_ID}{position:fixed;display:none;z-index:340;pointer-events:none;
  transform-origin:top left;overflow:visible;}
#${CARD_OVERLAY_ID} .rcs-card{position:absolute;box-sizing:border-box;
  width:${cardWidth}px;height:${cardHeight}px;border-radius:12px;
  border:3px solid #424242;padding:7px;
  background:linear-gradient(160deg,#fbfbfb 0%,#dedede 100%);
  box-shadow:0 8px 16px rgba(0,0,0,.55);
  font-family:'Segoe UI',Tahoma,Verdana,sans-serif;color:#111;
  transition:left .12s ease-out,top .12s ease-out,transform .12s ease-out;}
#${CARD_OVERLAY_ID} .rcs-card.rcs-t3{border-color:#1565c0;
  background:linear-gradient(160deg,#eaf3fd 0%,#bbdefb 100%);}
#${CARD_OVERLAY_ID} .rcs-card.rcs-t5{border-color:#6a1b9a;
  background:linear-gradient(160deg,#f7ecfa 0%,#e1bee7 100%);}
#${CARD_OVERLAY_ID} .rcs-card.sel{border-color:#f57c00;
  background:linear-gradient(160deg,#fffdf3 0%,#ffecb3 100%);
  box-shadow:0 10px 22px rgba(0,0,0,.6),0 0 14px rgba(255,193,7,.85);}
#${CARD_OVERLAY_ID} .rcs-card.poor{filter:grayscale(.75) brightness(.62);}
#${CARD_OVERLAY_ID} .rcs-name{height:34px;line-height:34px;border-radius:6px;
  background:rgba(0,0,0,.62);color:#fff;font-size:17px;font-weight:700;
  text-align:center;padding:0 34px 0 8px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.9);}
#${CARD_OVERLAY_ID} .rcs-cost{position:absolute;top:4px;right:4px;
  width:30px;height:30px;border-radius:50%;background:#00bcd4;
  border:2px solid #00707d;box-sizing:border-box;color:#fff;
  font-size:17px;font-weight:700;line-height:26px;text-align:center;
  text-shadow:0 1px 2px rgba(0,0,0,.8);}
#${CARD_OVERLAY_ID} .rcs-card.poor .rcs-cost{background:#f44336;border-color:#8e1c14;}
#${CARD_OVERLAY_ID} .rcs-icon-wrap{margin:8px auto 6px auto;width:52px;height:52px;
  border-radius:50%;background:rgba(255,255,255,.92);
  box-shadow:0 0 0 3px rgba(0,0,0,.18);display:flex;align-items:center;
  justify-content:center;}
#${CARD_OVERLAY_ID} .rcs-icon{background-image:url('img/system/IconSet.png');
  background-repeat:no-repeat;image-rendering:pixelated;}
#${CARD_OVERLAY_ID} .rcs-desc{margin-top:2px;padding:5px 6px;border-radius:5px;
  background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.14);
  font-size:14px;line-height:17px;font-weight:600;overflow:hidden;
  height:calc(100% - 130px);}
#${CARD_OVERLAY_ID} .rcs-type{position:absolute;left:10px;bottom:6px;
  font-size:11px;font-weight:700;letter-spacing:1px;color:rgba(0,0,0,.55);}
#${CARD_OVERLAY_ID} .rcs-energy{position:absolute;width:126px;padding:6px 0 8px 0;
  border-radius:10px;text-align:center;
  background:linear-gradient(160deg,#00bcd4 0%,#00838f 100%);
  border:3px solid #005f6b;box-sizing:border-box;
  box-shadow:0 6px 14px rgba(0,0,0,.5);
  font-family:'Segoe UI',Tahoma,Verdana,sans-serif;color:#fff;
  text-shadow:0 2px 3px rgba(0,0,0,.85);}
#${CARD_OVERLAY_ID} .rcs-energy-value{font-size:34px;font-weight:700;line-height:38px;}
#${CARD_OVERLAY_ID} .rcs-energy-deck{font-size:14px;font-weight:600;line-height:16px;}
`;
        document.head.appendChild(st);
    }

    // Fan layout in game-space coordinates (the overlay is sized to
    // Graphics.width/height and scaled to the canvas as a whole). Shared by the
    // DOM renderer and the mouse hit test so the two always agree.
    function cardLayout(index, count, isSelected) {
        const centerX = Graphics.width / 2 - 100;
        const cardSpacing = 140;
        const fanAngle = 20;   // degrees at the outermost card
        const arcHeight = 40;
        if (count <= 1) {
            return { x: centerX, y: handY + (isSelected ? -40 : 0), rot: 0, scale: isSelected ? 1.1 : 1 };
        }
        const n = (index / (count - 1)) - 0.5;
        const x = centerX + n * cardSpacing * Math.min(count / 1.5, 2.5);
        if (isSelected) return { x, y: handY - 40, rot: 0, scale: 1.1 };
        return { x, y: handY + arcHeight * Math.abs(n) * 2, rot: n * fanAngle, scale: 1 };
    }

    // RPG Maker control codes (\C[n], \I[n], ...) would show up verbatim in DOM
    // text, so strip them out of skill descriptions.
    function plainDescription(text) {
        return String(text || '')
            .replace(/\\[A-Za-z]+\[[^\]]*\]/g, '')
            .replace(/\\[.|^!><{}\\]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function buildCardElement(card) {
        const el = document.createElement('div');
        el.className = 'rcs-card ' +
            (card.energyCost >= 5 ? 'rcs-t5' : card.energyCost >= 3 ? 'rcs-t3' : 'rcs-t1');

        const name = document.createElement('div');
        name.className = 'rcs-name';
        name.textContent = card.name;
        el.appendChild(name);

        const cost = document.createElement('div');
        cost.className = 'rcs-cost';
        cost.textContent = card.energyCost;
        el.appendChild(cost);

        const wrap = document.createElement('div');
        wrap.className = 'rcs-icon-wrap';
        const icon = document.createElement('div');
        icon.className = 'rcs-icon';
        const iw = ImageManager.iconWidth;
        const ih = ImageManager.iconHeight;
        icon.style.width = iw + 'px';
        icon.style.height = ih + 'px';
        icon.style.backgroundPosition =
            `${-(card.iconIndex % 16) * iw}px ${-Math.floor(card.iconIndex / 16) * ih}px`; // i18n-ignore: CSS background-position
        wrap.appendChild(icon);
        el.appendChild(wrap);

        const desc = document.createElement('div');
        desc.className = 'rcs-desc';
        desc.textContent = plainDescription(card.description);
        el.appendChild(desc);

        const type = document.createElement('div');
        type.className = 'rcs-type';
        type.textContent = 'SKILL';
        el.appendChild(type);

        return el;
    }

    //========================================================================
    // Battle lifecycle
    //========================================================================
    const _BattleManager_startBattle = BattleManager.startBattle;
    BattleManager.startBattle = function() {
        _BattleManager_startBattle.call(this);
        if (isCardMode()) buildDecksForParty();
    };

    // ITBS calls startActorInput exactly once per actor's input turn. This is
    // the per-turn signal for energy gain + draw (vanilla startTurn is unused
    // under TPB/ITBS).
    const _BattleManager_startActorInput = BattleManager.startActorInput;
    BattleManager.startActorInput = function() {
        if (isCardMode() && this._currentActor) {
            const id = this._currentActor.actorId();
            let deck = window.$cardDecks[id];
            if (!deck) { deck = new DeckState(this._currentActor); window.$cardDecks[id] = deck; }
            deck.gainEnergy(ENERGY_PER_TURN);
            deck.draw(1);
            const scene = SceneManager._scene;
            if (scene instanceof Scene_Battle) scene.refreshCardDisplay();
        }
        _BattleManager_startActorInput.call(this);
    };

    //========================================================================
    // Scene_Battle: card display
    //========================================================================
    const _Scene_Battle_create = Scene_Battle.prototype.create;
    Scene_Battle.prototype.create = function() {
        _Scene_Battle_create.call(this);
        if (isCardMode()) {
            this.createCardDisplay();
            // A/D act as L1/R1 only inside card battles, scene-scoped so the
            // global WASD movement mapping is not clobbered outside battle.
            this._cardOriginalKeyMapper = Object.assign({}, Input.keyMapper);
            // Also stash a module-scoped backup as a safety net: some arena flows
            // clear SceneManager._stack and can bypass Scene_Battle.terminate,
            // which would otherwise leak the A/D -> pageup/pagedown remap into
            // map movement. Scene_Map.start restores from this if needed.
            _cardKeyMapperBackup = Object.assign({}, Input.keyMapper);
            Input.keyMapper[65] = 'pageup';   // A
            Input.keyMapper[68] = 'pagedown'; // D
        }
    };

    const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
    Scene_Battle.prototype.terminate = function() {
        if (this._cardOriginalKeyMapper) {
            Input.keyMapper = this._cardOriginalKeyMapper;
            this._cardOriginalKeyMapper = null;
            _cardKeyMapperBackup = null;
        }
        this.destroyCardDisplay();
        _Scene_Battle_terminate.call(this);
        window.$cardDecks = {};
        window.$deckCount = 0;
    };

    // The overlay is a DOM layer, so it does not disappear on its own when
    // another scene (options, item menu, ...) is pushed over the battle. Hide it
    // as soon as the battle scene stops; update() shows it again on return.
    const _Scene_Battle_stop = Scene_Battle.prototype.stop;
    Scene_Battle.prototype.stop = function() {
        _Scene_Battle_stop.call(this);
        if (this._cardRoot) {
            this._cardRoot.style.display = 'none';
            this._cardLastDisplay = 'none';
        }
    };

    // Safety net: if a card battle ended without terminate restoring the mapper
    // (e.g. an arena flow that wiped SceneManager._stack), undo the A/D remap the
    // moment we are back on the map so movement keys behave normally.
    const _Scene_Map_start_cardKeys = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        if (_cardKeyMapperBackup) {
            Input.keyMapper = _cardKeyMapperBackup;
            _cardKeyMapperBackup = null;
        }
        _Scene_Map_start_cardKeys.call(this);
    };

    Scene_Battle.prototype.createCardDisplay = function() {
        ensureCardStyle();
        const old = document.getElementById(CARD_OVERLAY_ID);
        if (old) old.remove();

        const root = document.createElement('div');
        root.id = CARD_OVERLAY_ID;
        root.style.width = Graphics.width + 'px';
        root.style.height = Graphics.height + 'px';
        document.body.appendChild(root);
        this._cardRoot = root;
        this._cardLastDisplay = 'none';

        const energy = document.createElement('div');
        energy.className = 'rcs-energy';
        energy.style.left = deckX + 'px';
        energy.style.top = deckY + 'px';
        const value = document.createElement('div');
        value.className = 'rcs-energy-value';
        const deckCount = document.createElement('div');
        deckCount.className = 'rcs-energy-deck';
        energy.appendChild(value);
        energy.appendChild(deckCount);
        root.appendChild(energy);
        this._cardEnergyValueEl = value;
        this._cardEnergyDeckEl = deckCount;

        this._cardEls = [];
    };

    Scene_Battle.prototype.destroyCardDisplay = function() {
        if (this._cardRoot && this._cardRoot.parentNode) {
            this._cardRoot.parentNode.removeChild(this._cardRoot);
        }
        this._cardRoot = null;
        this._cardEls = [];
        this._cardEnergyValueEl = null;
        this._cardEnergyDeckEl = null;
    };

    // Keep the overlay glued to the canvas (position + scale), and hide it
    // whenever the hand should not be visible.
    Scene_Battle.prototype.updateCardOverlayPos = function() {
        const root = this._cardRoot;
        if (!root) return;
        const visible = !!getActiveDeck() && SceneManager._scene === this;
        if (!visible) {
            if (this._cardLastDisplay !== 'none') { root.style.display = 'none'; this._cardLastDisplay = 'none'; }
            return;
        }
        const sc = cardCanvasScale();
        const left = sc.ox + 'px';
        const top = sc.oy + 'px';
        const transform = `scale(${sc.sx}, ${sc.sy})`;
        if (this._cardLastDisplay !== 'block') { root.style.display = 'block'; this._cardLastDisplay = 'block'; }
        if (this._cardLastLeft !== left) { root.style.left = left; this._cardLastLeft = left; }
        if (this._cardLastTop !== top) { root.style.top = top; this._cardLastTop = top; }
        if (this._cardLastTransform !== transform) { root.style.transform = transform; this._cardLastTransform = transform; }
    };

    Scene_Battle.prototype.refreshEnergyDisplay = function() {
        if (!this._cardEnergyValueEl) return;
        const deck = getActiveDeck();
        if (!deck) return;
        // Keep the legacy global fed for BattleSystemEnhancedHUD's deck counter.
        window.$deckCount = deck.deck.length;
        this._cardEnergyValueEl.textContent = String(deck.energy);
        this._cardEnergyDeckEl.textContent = T('Battle.card.deckCount', { n: deck.deck.length });
    };

    Scene_Battle.prototype.refreshCardDisplay = function() {
        if (!this._cardRoot) return;
        this.refreshEnergyDisplay();

        for (const el of (this._cardEls || [])) {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
        this._cardEls = [];

        const deck = getActiveDeck();
        if (!deck) return;

        for (let i = 0; i < deck.hand.length; i++) {
            const el = buildCardElement(deck.hand[i]);
            this._cardRoot.appendChild(el);
            this._cardEls.push(el);
        }
        this.updateCardSelection();
    };

    Scene_Battle.prototype.updateCardSelection = function() {
        const deck = getActiveDeck();
        if (!deck || !this._cardEls) return;
        const count = this._cardEls.length;
        for (let i = 0; i < count; i++) {
            const el = this._cardEls[i];
            const card = deck.hand[i];
            const isSelected = i === deck.selectedIndex;
            const L = cardLayout(i, count, isSelected);
            el.style.left = L.x + 'px';
            el.style.top = L.y + 'px';
            el.style.transform = `translate(-50%, -50%) rotate(${L.rot}deg) scale(${L.scale})`;
            el.style.zIndex = isSelected ? 999 : 100 + i;
            el.classList.toggle('sel', isSelected);
            el.classList.toggle('poor', !!card && !activeCanAfford(card.energyCost));
        }
        this.refreshEnergyDisplay();
    };

    //========================================================================
    // Mouse hover / click on cards
    //========================================================================
    // The overlay itself is pointer-events:none, so hit testing runs against
    // the same layout the DOM renderer uses, in game-space coordinates.
    Scene_Battle.prototype.getCardBounds = function(index, count, isSelected) {
        const L = cardLayout(index, count, isSelected);
        const halfW = (cardWidth * L.scale) / 2;
        const halfH = (cardHeight * L.scale) / 2;
        return { left: L.x - halfW, right: L.x + halfW, top: L.y - halfH, bottom: L.y + halfH };
    };

    Scene_Battle.prototype.isPointInBounds = function(x, y, b) {
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    };

    Scene_Battle.prototype.updateCardHover = function() {
        const deck = getActiveDeck();
        if (!deck || !deck.hand.length) return;

        const mouseX = TouchInput.x;
        const mouseY = TouchInput.y;
        const count = deck.hand.length;
        let hovered = -1;
        // Front-to-back: the selected card sits on top, so test it first.
        for (let i = count - 1; i >= 0; i--) {
            const b = this.getCardBounds(i, count, i === deck.selectedIndex);
            if (this.isPointInBounds(mouseX, mouseY, b)) { hovered = i; break; }
        }

        if (hovered !== -1 && hovered !== deck.selectedIndex) {
            deck.selectedIndex = hovered;
            this.updateCardSelection();
        }

        if (TouchInput.isTriggered() && hovered !== -1) {
            const card = deck.hand[hovered];
            const actor = BattleManager.actor();
            if (card && actor && card.canUse(actor)) {
                deck.selectedIndex = hovered;
                this.updateCardSelection();
                this.commandAttack();
            } else {
                SoundManager.playBuzzer();
            }
        }
    };

    //========================================================================
    // Card cycling input
    //========================================================================
    // Left/Right are routed through Window_ActorCommand's own cursor hooks: the
    // command window is a 1-column list, so its base cursorLeft/cursorRight do
    // nothing, and processCursorMove() calls them every frame the window is
    // active. Handling them here is what makes Left/Right cycle the hand even
    // when the window has consumed the input event.
    function cycleActiveCard(next) {
        const deck = getActiveDeck();
        if (!deck || deck.hand.length < 1) return;
        if (next) deck.selectNext(); else deck.selectPrevious();
        const scene = SceneManager._scene;
        if (scene instanceof Scene_Battle) scene.updateCardSelection();
        SoundManager.playCursor();
    }

    const _Window_ActorCommand_cursorRight = Window_ActorCommand.prototype.cursorRight;
    Window_ActorCommand.prototype.cursorRight = function(wrap) {
        if (isCardMode()) { cycleActiveCard(true); return; }
        _Window_ActorCommand_cursorRight.call(this, wrap);
    };

    const _Window_ActorCommand_cursorLeft = Window_ActorCommand.prototype.cursorLeft;
    Window_ActorCommand.prototype.cursorLeft = function(wrap) {
        if (isCardMode()) { cycleActiveCard(false); return; }
        _Window_ActorCommand_cursorLeft.call(this, wrap);
    };

    // Pageup/pagedown (A/D, L1/R1) are handled by the window too once a handler
    // exists for them, so intercept them the same way.
    const _Window_ActorCommand_cursorPagedown = Window_ActorCommand.prototype.cursorPagedown;
    Window_ActorCommand.prototype.cursorPagedown = function() {
        if (isCardMode()) { cycleActiveCard(true); return; }
        _Window_ActorCommand_cursorPagedown.call(this);
    };

    const _Window_ActorCommand_cursorPageup = Window_ActorCommand.prototype.cursorPageup;
    Window_ActorCommand.prototype.cursorPageup = function() {
        if (isCardMode()) { cycleActiveCard(false); return; }
        _Window_ActorCommand_cursorPageup.call(this);
    };


    const _Scene_Battle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function() {
        _Scene_Battle_update.call(this);
        if (!isCardMode()) return;
        this.updateCardOverlayPos();
        if (getActiveDeck() && this._actorCommandWindow && this._actorCommandWindow.active) {
            const deck = getActiveDeck();
            // Left/Right/A/D arrive through Window_ActorCommand's cursor hooks
            // (see cycleActiveCard); only the wheel and mouse are handled here.
            if (this._prevWheelY === undefined) this._prevWheelY = TouchInput.wheelY;
            if (TouchInput.wheelY !== this._prevWheelY) {
                if (TouchInput.wheelY - this._prevWheelY > 0) { deck.selectNext(); } else { deck.selectPrevious(); }
                this.updateCardSelection();
                SoundManager.playCursor();
                this._prevWheelY = TouchInput.wheelY;
            }

            this.updateCardHover();
        }
    };

    // Refresh the hand to the actor whose command window just opened (also fires
    // after returning from a sub-menu, so the display always matches the actor).
    const _Scene_Battle_startActorCommandSelection = Scene_Battle.prototype.startActorCommandSelection;
    Scene_Battle.prototype.startActorCommandSelection = function() {
        _Scene_Battle_startActorCommandSelection.call(this);
        if (isCardMode()) this.refreshCardDisplay();
    };

    //========================================================================
    // Playing a card == the actor's action this turn
    //========================================================================
    const _Scene_Battle_commandAttack = Scene_Battle.prototype.commandAttack;
    Scene_Battle.prototype.commandAttack = function() {
        if (!isCardMode()) { _Scene_Battle_commandAttack.call(this); return; }

        const deck = getActiveDeck();
        const actor = BattleManager.actor();
        if (!deck || !actor) { SoundManager.playBuzzer(); return; }

        const card = deck.current();
        if (!card || !card.canUse(actor)) { SoundManager.playBuzzer(); return; }

        const action = card.createAction(actor);
        if (!action || !action.item()) { SoundManager.playBuzzer(); return; }

        if (card.needsTarget()) {
            if (action.isForFriend()) {
                // Ally-scope cards (heal/buff, scope 7 etc.) must resolve to a
                // party member, not whatever enemy sits at that index.
                const members = action.isForDeadFriend()
                    ? $gameParty.deadMembers()
                    : $gameParty.aliveMembers();
                if (members.length > 0) action.setTarget(members[0].index());
            } else {
                const aliveEnemies = $gameTroop.aliveMembers();
                if (aliveEnemies.length === 0) { SoundManager.playBuzzer(); return; }
                // More than one monster on the field (nearby roamers join a
                // fight now): a single-target card asks which one it is played
                // on instead of always landing on whoever stands first.
                if (aliveEnemies.length > 1 && action.isForOne() && this._enemyWindow) {
                    this.startCardEnemySelection(card, action, actor);
                    return;
                }
                action.setTarget(aliveEnemies[0].index());
            }
        }
        this.commitCard(card, action, actor);
    };

    // Hand the chosen card to the actor as this turn's action and play it.
    Scene_Battle.prototype.commitCard = function(card, action, actor) {
        actor.setAction(0, action);
        actor.setLastBattleSkill($dataSkills[card.id]);

        this._pendingCard = card;
        this.executeCard();
    };

    // Card mode has no target step of its own, so it borrows the ordinary
    // battle target window and puts its handlers back the moment the choice is
    // made. Nothing has been spent yet, so cancelling simply returns the hand.
    Scene_Battle.prototype.startCardEnemySelection = function(card, action, actor) {
        this._cardTargetPending = { card: card, action: action, actor: actor };
        this._actorCommandWindow.deactivate();
        this._enemyWindow.refresh();
        this._enemyWindow.show();
        this._enemyWindow.setHandler('ok', this.onCardEnemyOk.bind(this));
        this._enemyWindow.setHandler('cancel', this.onCardEnemyCancel.bind(this));
        this._enemyWindow.select(0);
        this._enemyWindow.activate();
    };

    Scene_Battle.prototype.closeCardEnemySelection = function() {
        this._enemyWindow.hide();
        this._enemyWindow.deactivate();
        this._enemyWindow.setHandler('ok', this.onEnemyOk.bind(this));
        this._enemyWindow.setHandler('cancel', this.onEnemyCancel.bind(this));
    };

    Scene_Battle.prototype.onCardEnemyOk = function() {
        const pending = this._cardTargetPending;
        const enemy = this._enemyWindow.enemy();
        this.closeCardEnemySelection();
        this._cardTargetPending = null;
        if (!pending) { this._actorCommandWindow.activate(); return; }
        if (enemy) pending.action.setTarget(enemy.index());
        this.commitCard(pending.card, pending.action, pending.actor);
    };

    Scene_Battle.prototype.onCardEnemyCancel = function() {
        this.closeCardEnemySelection();
        this._cardTargetPending = null;
        this._actorCommandWindow.activate();
    };

    Scene_Battle.prototype.executeCard = function() {
        const deck = getActiveDeck();
        const actor = BattleManager.actor();
        if (this._pendingCard && deck && actor) {
            if (!deck.spend(this._pendingCard.energyCost)) {
                SoundManager.playBuzzer();
                this._pendingCard = null;
                return;
            }
            // MP/TP are not consumed in card mode (see paySkillCost override).
            deck.playSelected();
            this.refreshCardDisplay();
        }
        this._pendingCard = null;
        this.selectNextCommand();
    };

    Scene_Battle.prototype.commandPassTurn = function() {
        if (!isCardMode()) return;
        const deck = getActiveDeck();
        const actor = BattleManager.actor();
        if (deck) { deck.gainEnergy(PASS_ENERGY_BONUS); deck.draw(1); }
        if (actor) {
            const action = new Game_Action(actor);
            action.setGuard();
            actor.setAction(0, action);
        }
        this.refreshCardDisplay();
        this.selectNextCommand();
    };

    const _Scene_Battle_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
    Scene_Battle.prototype.createActorCommandWindow = function() {
        _Scene_Battle_createActorCommandWindow.call(this);
        this._actorCommandWindow.setHandler('passTurn', this.commandPassTurn.bind(this));
    };

    //========================================================================
    // Command window: Use Card / Pass Turn (integrates with the HTML command
    // window from BattleSystemEnhanchedCommands.js, which this loads after)
    //========================================================================
    const _Window_ActorCommand_makeCommandList = Window_ActorCommand.prototype.makeCommandList;
    Window_ActorCommand.prototype.makeCommandList = function() {
        if (isCardMode() && this._actor) {
            const useCard = T('Battle.card.useCard');
            const passTurn = T('Battle.card.passTurn');
            if (typeof this.addCommandWithIcon === 'function') {
                this.addCommandWithIcon(useCard, 'attack', true, null, 416);
                this.addCommandWithIcon(passTurn, 'passTurn', true, null, 75);
                this.addItemCommand();
                this.addGuardCommand();
            } else {
                this.addCommand(useCard, 'attack', true);
                this.addCommand(passTurn, 'passTurn', true);
                this.addItemCommand();
                this.addGuardCommand();
            }
        } else {
            _Window_ActorCommand_makeCommandList.call(this);
        }
    };

    // The HTML command renderer resolves labels via getCommandName(); relabel
    // attack/passTurn in card mode so they read correctly.
    const _Window_ActorCommand_getCommandName = Window_ActorCommand.prototype.getCommandName;
    Window_ActorCommand.prototype.getCommandName = function(symbol, ext) {
        if (isCardMode()) {
            if (symbol === 'attack') return T('Battle.card.useCard');
            if (symbol === 'passTurn') return T('Battle.card.passTurn');
        }
        if (typeof _Window_ActorCommand_getCommandName === 'function') {
            return _Window_ActorCommand_getCommandName.call(this, symbol, ext);
        }
        return '';
    };

    //========================================================================
    // Lift enemies so the hand has room at the bottom of the screen
    //========================================================================
    const _Sprite_Enemy_updatePosition = Sprite_Enemy.prototype.updatePosition;
    Sprite_Enemy.prototype.updatePosition = function() {
        _Sprite_Enemy_updatePosition.call(this);
        if (isCardMode()) this.y -= ENEMY_Y_OFFSET;
    };

})();
