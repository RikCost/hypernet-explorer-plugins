//=============================================================================
// AnimatedHorseRace.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Animated Horse Race v2.0.0 - Themed DOM betting board and free play.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help AnimatedHorseRace.js
 * * @param minBet
 * @text Minimum Bet
 * @desc Minimum tokens to bet
 * @type number
 * @default 1
 * * @param maxBet
 * @text Maximum Bet
 * @desc Maximum tokens to bet
 * @type number
 * @default 100
 * * @param tokenItemId
 * @text Token Item ID
 * @desc ID of the token item in database (124 = Arcade Token)
 * @type number
 * @default 124
 * * @command openHorseRace
 * @text Open Horse Race
 * @desc Opens the horse racing minigame
 * * This plugin creates an animated horse racing minigame with persistent horses.
 * Use Plugin Command: "Open Horse Race" or Script Call: SceneManager.push(Scene_HorseRace);
 * * The board is a DOM overlay styled from the active CSS theme (css/vars.css,
 * i.e. whichever css/themes/*.css preset is live), so it follows the same gold
 * on black language as the rest of the UI plugins. Everything is crisp HTML
 * type: no canvas text, no scanlines, no blur.
 * * Opened from the title screen's free-play arcade the race runs on play money
 * (a local chip stack), never on the party's arcade tokens, and re-stakes the
 * player instead of locking them out when the stack runs dry.
 */

(() => {
    'use strict';

    const pluginName = "AnimatedHorseRace";
    const parameters = PluginManager.parameters(pluginName);
    const MIN_BET = parseInt(parameters['minBet']) || 1;
    const MAX_BET = parseInt(parameters['maxBet']) || 9999;
    const TOKEN_ITEM_ID = parseInt(parameters['tokenItemId']) || 124;
    // Play-money bankroll for the title screen's free-play arcade.
    const FREE_PLAY_CHIPS = 50;
    const CONTAINER_ID = 'horse-race-container';

    PluginManager.registerCommand(pluginName, "openHorseRace", args => {
        SceneManager.push(Scene_HorseRace);
    });

    function getHorseNamePart(type) {
        return T.list('AnimatedHorseRace.' + type);
    }
    const HORSE_COLORS = ['#8B4513', '#A0522D', '#000000', '#FFFFFF', '#D2691E', '#CD853F'];
    // Racer markers drawn from the IconSet (Gold/Silver/Pink Star, indices per
    // js/db/Sprites/Icons.json) rather than emoji glyphs.
    const HORSE_ICONS = [87, 88, 89];

    //-----------------------------------------------------------------------------
    // DOM helpers
    //-----------------------------------------------------------------------------

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    // IconSet.png is a 16-wide sheet of 32px icons; pixelated so a scaled marker
    // stays hard-edged instead of going soft.
    function iconStyle(index, size) {
        const s = size || 32;
        const col = index % 16;
        const row = Math.floor(index / 16);
        return `background-image:url('img/system/IconSet.png');background-size:${s * 16}px auto;` +
               `background-position:-${col * s}px -${row * s}px;width:${s}px;height:${s}px;` +
               `image-rendering:pixelated;display:inline-block;flex-shrink:0;`;
    }

    // The locale strings carry RMMZ \I[n] escapes; turn them into real sprites.
    function withIcons(text, size) {
        return escapeHtml(text).replace(/\\I\[(\d+)\]/g, (m, n) =>
            `<span class="hr-inline-icon" style="${iconStyle(Number(n), size || 24)}"></span>`);
    }

    // True when the race was opened from the title screen's free-play arcade,
    // which runs on a throwaway game context with no save behind it.
    function isFreePlay() {
        const arcade = window.MinigameArcade;
        return !!(arcade && arcade.isFreePlay && arcade.isFreePlay());
    }

    class SeededRandom {
        constructor(seed) {
            this.seed = seed;
        }
        next() {
            this.seed = (this.seed * 9301 + 49297) % 233280;
            return this.seed / 233280;
        }
    }

    function generateSeedFromPlayerName() {
        let historySeed = 19002001;
        if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
            historySeed = window.HistoryManager.getSeed();
        } else if ($gameSystem && $gameSystem._historySeed !== undefined) {
            historySeed = $gameSystem._historySeed;
        }
        return historySeed % 1000000;
    }

    function generateHorsePool() {
        const seed = generateSeedFromPlayerName();
        const rng = new SeededRandom(seed);
        const pool = [];

        const normalPrefixes = getHorseNamePart('normalPrefixes');
        const normalSuffixes = getHorseNamePart('normalSuffixes');
        const weirdPrefixes = getHorseNamePart('weirdPrefixes');
        const weirdSuffixes = getHorseNamePart('weirdSuffixes');

        for (let i = 0; i < 30; i++) {
            let name;
            if (rng.next() < 0.4) {
                const prefix = weirdPrefixes[Math.floor(rng.next() * weirdPrefixes.length)];
                const suffix = weirdSuffixes[Math.floor(rng.next() * weirdSuffixes.length)];
                name = `${prefix} ${suffix}`;
            } else {
                if (rng.next() < 0.6) {
                    name = normalPrefixes[Math.floor(rng.next() * normalPrefixes.length)];
                } else {
                    const prefix = normalPrefixes[Math.floor(rng.next() * normalPrefixes.length)];
                    const suffix = normalSuffixes[Math.floor(rng.next() * normalSuffixes.length)];
                    name = `${prefix} ${suffix}`;
                }
            }
            const strength = 0.3 + rng.next() * 0.4;
            const luck = 0.3 + rng.next() * 0.4;
            pool.push({
                id: i,
                name: name,
                color: HORSE_COLORS[Math.floor(rng.next() * HORSE_COLORS.length)],
                icon: HORSE_ICONS[Math.floor(rng.next() * HORSE_ICONS.length)],
                strength: strength,
                luck: luck,
                position: 0,
                speed: 0,
                currentStamina: 1.0,
                odds: 0
            });
        }
        return pool;
    }

    let globalHorsePool = null;
    function getHorsePool() {
        if (!globalHorsePool) {
            globalHorsePool = generateHorsePool();
        }
        return globalHorsePool;
    }

    //-----------------------------------------------------------------------------
    // Scene_HorseRace
    //
    // The board is a DOM overlay (#horse-race-container, .hr-* classes in
    // css/theme.css) so every label is crisp browser type at the display's own
    // resolution. The scene only owns the turf backdrop, the simulation and the
    // input loop; markup is rebuilt per state and patched per frame.
    //-----------------------------------------------------------------------------
    class Scene_HorseRace extends Scene_MenuBase {
        initialize() {
            super.initialize();
            this._gameState = 'selection'; // 'selection', 'racing', 'results'
            this._bet = MIN_BET;
            this._cursor = 0;
            this._selectedHorse = -1;
            this._raceHorses = [];
            this._finishOrder = [];
            this._raceTimer = 0;
            this._lastWin = 0;
            this._notice = '';
            this._resultsTimer = null;
            this._freePlay = isFreePlay();
            this._chips = FREE_PLAY_CHIPS;
            this.setupNewRace();
        }

        // ---- the wallet ---------------------------------------------------
        // One funding source for the whole scene. In the free-play arcade it is
        // a local chip stack, so the party's arcade tokens are never asked for;
        // in a real game it is the token item.
        tokenItem() {
            return $dataItems[TOKEN_ITEM_ID];
        }

        walletName() {
            if (this._freePlay) return T('AnimatedHorseRace.tokens');
            const item = this.tokenItem();
            return item ? item.name : T('AnimatedHorseRace.tokens');
        }

        walletCount() {
            if (this._freePlay) return this._chips;
            const item = this.tokenItem();
            return item ? $gameParty.numItems(item) : 0;
        }

        walletSpend(amount) {
            if (this._freePlay) {
                this._chips = Math.max(0, this._chips - amount);
                return;
            }
            const item = this.tokenItem();
            if (item) $gameParty.loseItem(item, amount);
        }

        walletGain(amount) {
            if (this._freePlay) {
                this._chips += amount;
                return;
            }
            const item = this.tokenItem();
            if (item) $gameParty.gainItem(item, amount);
        }

        // Free play is never a dead end: an empty stack is simply re-staked.
        // A real game reports honestly whether the player can still bet.
        ensureStake() {
            if (!this._freePlay) return this.walletCount() >= MIN_BET;
            if (this._chips < MIN_BET) {
                this._chips = FREE_PLAY_CHIPS;
                this._notice = T('AnimatedHorseRace.restake', { amount: FREE_PLAY_CHIPS });
            }
            return true;
        }

        // Cannot happen in free play; a real game with no tokens says so.
        cannotBetText() {
            const item = this.tokenItem();
            if (!item) return T('AnimatedHorseRace.noTokens');
            return T('AnimatedHorseRace.notEnoughTokens', {
                tokenName: item.name,
                current: $gameParty.numItems(item),
                needed: MIN_BET
            });
        }

        // ---- lifecycle ----------------------------------------------------
        create() {
            super.create();
            this.createOverlay();
        }

        // A flat turf gradient instead of Scene_MenuBase's blurred map snapshot:
        // nothing soft behind the type.
        createBackground() {
            this._backgroundSprite = new Sprite();
            this._backgroundSprite.bitmap = new Bitmap(Graphics.width, Graphics.height);
            const context = this._backgroundSprite.bitmap.context;
            const gradient = context.createLinearGradient(0, 0, 0, Graphics.height);
            gradient.addColorStop(0, '#0b1a10');
            gradient.addColorStop(0.55, '#123021');
            gradient.addColorStop(1, '#06110b');
            context.fillStyle = gradient;
            context.fillRect(0, 0, Graphics.width, Graphics.height);
            this._backgroundSprite.bitmap.baseTexture.update();
            this.addChild(this._backgroundSprite);
        }

        start() {
            super.start();
            this.enterSelection();
        }

        terminate() {
            super.terminate();
            // Cancel a pending results reveal so it cannot fire on a dead scene.
            if (this._resultsTimer) {
                clearTimeout(this._resultsTimer);
                this._resultsTimer = null;
            }
            this.destroyOverlay();
        }

        createOverlay() {
            let root = document.getElementById(CONTAINER_ID);
            if (!root) {
                root = document.createElement('div');
                root.id = CONTAINER_ID;
                document.body.appendChild(root);
            }
            root.innerHTML = '';
            root.style.display = 'flex';
            this._root = root;
        }

        destroyOverlay() {
            if (!this._root) return;
            this._root.innerHTML = '';
            this._root.style.display = 'none';
            this._root = null;
        }

        // ---- race setup ---------------------------------------------------
        setupNewRace() {
            const pool = getHorsePool();
            const selectedIndices = [];
            while (selectedIndices.length < 6) {
                const index = Math.floor(Math.random() * pool.length);
                if (!selectedIndices.includes(index)) {
                    selectedIndices.push(index);
                }
            }
            this._raceHorses = selectedIndices.map(index => {
                const horse = { ...pool[index] };
                horse.position = 0;
                horse.speed = 0;
                horse.currentStamina = 1.0;
                return horse;
            });
            this.assignOdds();
            this._finishOrder = [];
            this._selectedHorse = -1;
            this._cursor = 0;
            this._raceTimer = 0;
        }

        // Odds derived from the SAME strength/luck terms that actually drive the
        // race (see updateRace), normalised across the field with a house margin.
        // The old formula added pure random jitter decoupled from win chance, so
        // stat-reading players could find positive-EV bets.
        assignOdds() {
            const HOUSE_EDGE = 0.20; // 20% overround keeps the book in the house's favour
            // Proxy for finishing speed: speed factor * luck-driven speed modifier.
            const ratings = this._raceHorses.map(
                h => (0.5 + h.strength * 0.8) * (0.7 + h.luck * 0.6)
            );
            // Winner-take-most: emphasise gaps so favourites are properly favoured.
            const weights = ratings.map(r => Math.pow(r, 3));
            const total = weights.reduce((a, b) => a + b, 0) || 1;
            this._raceHorses.forEach((h, i) => {
                const p = weights[i] / total;                 // estimated win probability
                const fair = 1 / Math.max(p, 0.0001);          // fair decimal odds
                h.odds = Math.max(2, Math.floor(fair * (1 - HOUSE_EDGE)));
            });
        }

        // ---- selection board ----------------------------------------------
        enterSelection() {
            this._gameState = 'selection';
            const canBet = this.ensureStake();
            this._bet = Math.max(MIN_BET, Math.min(this._bet, Math.min(MAX_BET, this.walletCount() || MIN_BET)));
            this.renderSelection(canBet);
        }

        renderSelection(canBet) {
            if (!this._root) return;
            this._canBet = canBet !== false;

            const rows = this._raceHorses.map((horse, i) => this.horseRowHtml(horse, i)).join('');
            const notice = this._notice
                ? `<div class="hr-notice">${withIcons(this._notice)}</div>` : '';
            const blocked = this._canBet ? '' :
                `<div class="hr-notice hr-notice-warn">${escapeHtml(this.cannotBetText())}</div>`;

            this._root.innerHTML = `
                <div class="hr-frame">
                    ${this.headerHtml()}
                    <div class="hr-body">
                        <div class="hr-col-main">
                            <div class="hr-section-title">${escapeHtml(T('AnimatedHorseRace.field'))}</div>
                            <div class="hr-list">${rows}</div>
                            ${notice}${blocked}
                        </div>
                        <div class="hr-col-side">
                            ${this.slipHtml()}
                            ${this.legendHtml()}
                        </div>
                    </div>
                    <div class="hr-footer">
                        <div class="hr-btn hr-btn-primary${this._canBet ? '' : ' hr-btn-off'}"
                             onclick="SceneManager._scene.onPlaceBetClick && SceneManager._scene.onPlaceBetClick()">
                            ${escapeHtml(T('AnimatedHorseRace.placeBet'))}
                        </div>
                        <div class="hr-btn"
                             onclick="SceneManager._scene.onExitClick && SceneManager._scene.onExitClick()">
                            ${escapeHtml(T('AnimatedHorseRace.exit'))}
                        </div>
                    </div>
                </div>`;

            this._helpEl = this._root.querySelector('.hr-help');
            this._slipEl = this._root.querySelector('.hr-slip');
        }

        headerHtml() {
            const stake = this._freePlay
                ? `<span class="hr-tag">${escapeHtml(T('AnimatedHorseRace.freePlay'))}</span>` : '';
            return `
                <div class="hr-header">
                    <div class="hr-title">${escapeHtml(T('AnimatedHorseRace.title'))}</div>
                    ${stake}
                    <div class="hr-purse">
                        <span class="hr-purse-label">${escapeHtml(this.walletName())}</span>
                        <span class="hr-purse-value">${this.walletCount()}</span>
                    </div>
                </div>
                <div class="hr-help">${withIcons(T('AnimatedHorseRace.helpText'))}</div>`;
        }

        horseRowHtml(horse, index) {
            const sel = index === this._cursor ? ' selected' : '';
            const staked = index === this._selectedHorse ? ' staked' : '';
            const spd = Math.round(((horse.strength - 0.3) / 0.4) * 100);
            const grt = Math.round(((horse.luck - 0.3) / 0.4) * 100);
            return `
                <div class="hr-row${sel}${staked}" data-index="${index}"
                     onmouseenter="SceneManager._scene.onRowHover && SceneManager._scene.onRowHover(${index})"
                     onclick="SceneManager._scene.onRowClick && SceneManager._scene.onRowClick(${index})">
                    <span class="hr-gate">${index + 1}</span>
                    <span class="hr-silk" style="${iconStyle(horse.icon, 32)}"></span>
                    <span class="hr-name" style="color:${horse.color}">${escapeHtml(horse.name)}</span>
                    <span class="hr-form">
                        <span class="hr-form-row"><i>${escapeHtml(T('AnimatedHorseRace.statSpeed'))}</i>
                            <b class="hr-meter"><b style="width:${spd}%"></b></b></span>
                        <span class="hr-form-row"><i>${escapeHtml(T('AnimatedHorseRace.statGrit'))}</i>
                            <b class="hr-meter"><b style="width:${grt}%"></b></b></span>
                    </span>
                    <span class="hr-odds">${horse.odds}:1</span>
                </div>`;
        }

        slipHtml() {
            const horse = this._selectedHorse >= 0 ? this._raceHorses[this._selectedHorse] : null;
            const pick = horse
                ? `<span class="hr-slip-pick" style="color:${horse.color}">${escapeHtml(horse.name)}</span>`
                : `<span class="hr-slip-pick hr-dim">&mdash;</span>`;
            const odds = horse ? `${horse.odds}:1` : '&mdash;';
            const win = horse ? this._bet * horse.odds : 0;
            return `
                <div class="hr-slip">
                    <div class="hr-slip-title">${escapeHtml(T('AnimatedHorseRace.bet'))}</div>
                    <div class="hr-stepper">
                        <span class="hr-step" onclick="SceneManager._scene.onBetStep && SceneManager._scene.onBetStep(-10)">&laquo;</span>
                        <span class="hr-step" onclick="SceneManager._scene.onBetStep && SceneManager._scene.onBetStep(-1)">&lsaquo;</span>
                        <span class="hr-bet-value">${this._bet}</span>
                        <span class="hr-step" onclick="SceneManager._scene.onBetStep && SceneManager._scene.onBetStep(1)">&rsaquo;</span>
                        <span class="hr-step" onclick="SceneManager._scene.onBetStep && SceneManager._scene.onBetStep(10)">&raquo;</span>
                    </div>
                    <div class="hr-slip-line"><span>${escapeHtml(T('AnimatedHorseRace.selected'))}</span>${pick}</div>
                    <div class="hr-slip-line"><span>${escapeHtml(T('AnimatedHorseRace.odds'))}</span><b>${odds}</b></div>
                    <div class="hr-slip-line"><span>${escapeHtml(T('AnimatedHorseRace.potentialWin'))}</span><b class="hr-win">${win}</b></div>
                </div>`;
        }

        legendHtml() {
            const keys = ['selectHorse', 'changeBet1', 'changeBet10', 'confirmSelection', 'exitGame'];
            return `<div class="hr-legend">${
                keys.map(k => `<div>${escapeHtml(T('AnimatedHorseRace.' + k))}</div>`).join('')
            }</div>`;
        }

        // Patch only what changed: rebuilding the list on every cursor step
        // would drop the CSS transitions and thrash layout.
        syncSelection() {
            if (!this._root) return;
            const rows = this._root.querySelectorAll('.hr-row');
            rows.forEach((row, i) => {
                row.classList.toggle('selected', i === this._cursor);
                row.classList.toggle('staked', i === this._selectedHorse);
            });
            if (this._slipEl) {
                this._slipEl.outerHTML = this.slipHtml();
                this._slipEl = this._root.querySelector('.hr-slip');
            }
            const purse = this._root.querySelector('.hr-purse-value');
            if (purse) purse.textContent = this.walletCount();
        }

        setHelp(text) {
            this._notice = '';
            if (this._helpEl) this._helpEl.innerHTML = withIcons(text);
        }

        // ---- input ---------------------------------------------------------
        update() {
            super.update();
            if (this._gameState === 'selection') {
                this.updateSelectionInput();
            } else if (this._gameState === 'racing') {
                this.updateRace();
            } else if (this._gameState === 'results') {
                this.updateResults();
            }
        }

        updateSelectionInput() {
            if (Input.isRepeated('down')) {
                this.moveCursor(1);
            } else if (Input.isRepeated('up')) {
                this.moveCursor(-1);
            } else if (Input.isRepeated('right')) {
                this.changeBet(Input.isPressed('shift') ? 10 : 1);
            } else if (Input.isRepeated('left')) {
                this.changeBet(Input.isPressed('shift') ? -10 : -1);
            } else if (Input.isTriggered('ok')) {
                this.confirmPick();
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                SoundManager.playCancel();
                this.popScene();
            }
        }

        moveCursor(delta) {
            const max = this._raceHorses.length;
            this._cursor = (this._cursor + delta + max) % max;
            SoundManager.playCursor();
            this.syncSelection();
        }

        changeBet(amount) {
            const oldBet = this._bet;
            const currentMax = Math.min(MAX_BET, Math.max(MIN_BET, this.walletCount()));
            this._bet = Math.max(MIN_BET, Math.min(currentMax, this._bet + amount));

            if (this._bet !== oldBet) {
                SoundManager.playCursor();
                this.syncSelection();
            } else {
                SoundManager.playBuzzer();
            }
        }

        confirmPick() {
            if (!this._canBet) {
                SoundManager.playBuzzer();
                return;
            }
            this._selectedHorse = this._cursor;
            if (this.walletCount() < this._bet) {
                SoundManager.playBuzzer();
                this.setHelp(this.cannotBetText());
                this.syncSelection();
                return;
            }
            SoundManager.playOk();
            this.syncSelection();
            this.startRace();
        }

        onRowHover(index) {
            if (this._gameState !== 'selection' || index === this._cursor) return;
            this._cursor = index;
            SoundManager.playCursor();
            this.syncSelection();
        }

        onRowClick(index) {
            if (this._gameState !== 'selection') return;
            this._cursor = index;
            this.confirmPick();
        }

        onBetStep(amount) {
            if (this._gameState !== 'selection') return;
            this.changeBet(amount);
        }

        onPlaceBetClick() {
            if (this._gameState !== 'selection') return;
            this.confirmPick();
        }

        onExitClick() {
            SoundManager.playCancel();
            this.popScene();
        }

        // ---- the race ------------------------------------------------------
        startRace() {
            this._gameState = 'racing';
            this._raceTimer = 0;
            this.walletSpend(this._bet);

            this._raceHorses.forEach(horse => {
                horse.position = 0;
                horse.currentStamina = 1.0;
                horse.speed = (0.5 + horse.strength * 0.8) * (0.8 + Math.random() * 0.4);
            });

            this.renderRace();
        }

        renderRace() {
            if (!this._root) return;
            const lanes = this._raceHorses.map((horse, i) => {
                const mine = i === this._selectedHorse ? ' mine' : '';
                return `
                    <div class="hr-lane${mine}" data-lane="${i}">
                        <span class="hr-lane-gate">${i + 1}</span>
                        <span class="hr-lane-name" style="color:${horse.color}">${escapeHtml(horse.name)}</span>
                        <span class="hr-strip">
                            <span class="hr-runner" style="left:0%">
                                <span style="${iconStyle(horse.icon, 32)}"></span>
                            </span>
                        </span>
                        <span class="hr-pct">0%</span>
                    </div>`;
            }).join('');

            this._root.innerHTML = `
                <div class="hr-frame">
                    ${this.headerHtml()}
                    <div class="hr-section-title">${escapeHtml(T('AnimatedHorseRace.raceInProgress'))}</div>
                    <div class="hr-track">${lanes}</div>
                </div>`;

            this._helpEl = this._root.querySelector('.hr-help');
            this._slipEl = null;
            this.setHelp(T('AnimatedHorseRace.raceStarted'));
            this._laneEls = Array.from(this._root.querySelectorAll('.hr-lane')).map(lane => ({
                runner: lane.querySelector('.hr-runner'),
                pct: lane.querySelector('.hr-pct'),
                node: lane
            }));
        }

        updateRace() {
            this._raceTimer++;
            this._raceHorses.forEach(horse => {
                if (horse.position < 100) {
                    const luckFactor = 0.7 + horse.luck * 0.6;
                    const speedModifier = luckFactor * (0.8 + Math.random() * 0.4);
                    const staminaLossRate = 0.003 * (1.5 - horse.luck);
                    horse.currentStamina = Math.max(0.4, horse.currentStamina - staminaLossRate);
                    const staminaFactor = Math.pow(horse.currentStamina, 0.5);
                    horse.position += horse.speed * speedModifier * staminaFactor  * 0.6;

                    if (horse.position >= 100 && !this._finishOrder.includes(horse.id)) {
                        this._finishOrder.push(horse.id);
                        horse.position = 100;
                    }
                }
            });
            this.updateRaceView();
            if (this._finishOrder.length >= this._raceHorses.length || this._raceTimer > 1800) {
                this.endRace();
            }
        }

        // Six style writes a frame: no markup is rebuilt while the race runs.
        updateRaceView() {
            if (!this._laneEls) return;
            this._raceHorses.forEach((horse, i) => {
                const lane = this._laneEls[i];
                if (!lane) return;
                const pct = Math.min(100, Math.floor(horse.position));
                lane.runner.style.left = pct + '%';
                lane.pct.textContent = pct + '%';
                if (pct >= 100) lane.node.classList.add('done');
            });
        }

        endRace() {
            this._gameState = 'results';
            let winnerId = this._finishOrder[0];
            if (winnerId === undefined) {
                // Timeout with no horse across the line: the winner is whoever
                // got the furthest. Avoids dereferencing an undefined winner.
                const leader = this._raceHorses.reduce(
                    (best, h) => (h.position > best.position ? h : best),
                    this._raceHorses[0]
                );
                winnerId = leader ? leader.id : undefined;
            }
            let winnerHorse = this._raceHorses.find(h => h.id === winnerId);
            if (!winnerHorse) winnerHorse = this._raceHorses[0];
            let winAmount = 0;
            let won = false;

            if (this._selectedHorse !== -1 && this._raceHorses[this._selectedHorse].id === winnerId) {
                const horse = this._raceHorses[this._selectedHorse];
                winAmount = this._bet * horse.odds;
                won = true;

                this.walletGain(winAmount);
                this._lastWin = winAmount;
                SoundManager.playRecovery();

                if (winAmount >= this._bet * 5) {
                    $gameScreen.startFlash([255, 255, 255, 128], 30);
                }
            } else {
                this._lastWin = 0;
            }

            if (window.MinigameFun) won ? window.MinigameFun.won('Card Counting') : window.MinigameFun.lost('Card Counting');

            this.showResults(winnerHorse, won, winAmount);
        }

        showResults(winnerHorse, won, winAmount) {
            this._resultsTimer = setTimeout(() => {
                this._resultsTimer = null;
                // updateResults allows cancel->popScene during this 500ms delay;
                // bail if the scene was torn down so we don't touch a dead DOM.
                if (SceneManager._scene !== this || !this._root) return;
                this.renderResults(winnerHorse, won, winAmount);
            }, 500);
        }

        renderResults(winnerHorse, won, winAmount) {
            const lines = won ? `
                <div class="hr-result-line"><span>${escapeHtml(T('AnimatedHorseRace.bet'))}</span><b>${this._bet}</b></div>
                <div class="hr-result-line"><span>${escapeHtml(T('AnimatedHorseRace.won'))}</span><b class="hr-win">${winAmount}</b></div>
                <div class="hr-result-line"><span>${escapeHtml(T('AnimatedHorseRace.profit'))}</span><b class="hr-win">${winAmount - this._bet}</b></div>`
                : `
                <div class="hr-result-line"><span>${escapeHtml(T('AnimatedHorseRace.lost'))}</span><b class="hr-loss">${this._bet}</b></div>`;

            const order = this._finishOrder.length
                ? this._finishOrder.map((id, place) => {
                    const h = this._raceHorses.find(x => x.id === id);
                    if (!h) return '';
                    return `<div class="hr-order-row"><span class="hr-place">${place + 1}</span>
                        <span class="hr-silk" style="${iconStyle(h.icon, 24)}"></span>
                        <span style="color:${h.color}">${escapeHtml(h.name)}</span></div>`;
                }).join('')
                : '';

            const message = won
                ? T('AnimatedHorseRace.winMessage', { horseName: winnerHorse.name, amount: winAmount })
                : T('AnimatedHorseRace.loseMessage', { horseName: winnerHorse.name });

            this._root.innerHTML = `
                <div class="hr-frame">
                    ${this.headerHtml()}
                    <div class="hr-body hr-body-results">
                        <div class="hr-col-main">
                            <div class="hr-section-title">${escapeHtml(T('AnimatedHorseRace.raceResults'))}</div>
                            <div class="hr-winner">
                                <span class="hr-silk" style="${iconStyle(winnerHorse.icon, 32)}"></span>
                                <span class="hr-winner-name" style="color:${winnerHorse.color}">${escapeHtml(winnerHorse.name)}</span>
                                <span class="hr-winner-tag">${escapeHtml(T('AnimatedHorseRace.winner'))}</span>
                            </div>
                            <div class="hr-verdict ${won ? 'hr-win' : 'hr-loss'}">
                                ${escapeHtml(won ? T('AnimatedHorseRace.youWon') : T('AnimatedHorseRace.youLost'))}
                            </div>
                            ${lines}
                        </div>
                        <div class="hr-col-side">
                            <div class="hr-order">${order}</div>
                            <div class="hr-legend">
                                <div>${escapeHtml(T('AnimatedHorseRace.newRace'))}</div>
                                <div>${escapeHtml(T('AnimatedHorseRace.exitGame'))}</div>
                            </div>
                        </div>
                    </div>
                    <div class="hr-footer">
                        <div class="hr-btn hr-btn-primary"
                             onclick="SceneManager._scene.onNewRaceClick && SceneManager._scene.onNewRaceClick()">
                            ${escapeHtml(T('AnimatedHorseRace.newRace'))}
                        </div>
                        <div class="hr-btn"
                             onclick="SceneManager._scene.onExitClick && SceneManager._scene.onExitClick()">
                            ${escapeHtml(T('AnimatedHorseRace.exit'))}
                        </div>
                    </div>
                </div>`;

            this._helpEl = this._root.querySelector('.hr-help');
            this.setHelp(message + T('AnimatedHorseRace.continuePrompt'));
        }

        updateResults() {
            if (Input.isTriggered('ok')) {
                this.startNewRace();
            } else if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                this.popScene();
            }
        }

        onNewRaceClick() {
            if (this._gameState !== 'results') return;
            this.startNewRace();
        }

        startNewRace() {
            if (this._resultsTimer) {
                clearTimeout(this._resultsTimer);
                this._resultsTimer = null;
            }
            SoundManager.playOk();
            this.setupNewRace();
            this._laneEls = null;
            this.enterSelection();
        }
    }

    window.Scene_HorseRace = Scene_HorseRace;

})();
