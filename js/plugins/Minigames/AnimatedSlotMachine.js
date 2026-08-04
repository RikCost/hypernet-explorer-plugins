//=============================================================================
// AnimatedSlotMachine.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Animated Art Deco Slot Machine v2.0.0 (HTML/DOM, IconSet symbols)
 * @author Omni-Lex
 * @url
 * @help AnimatedSlotMachine.js
 *
 * A fully HTML/CSS rendered, animated Art Deco slot machine.
 * Symbols are drawn from the game's IconSet (img/system/IconSet.png) instead
 * of emojis, so they always match the project's art style.
 *
 * Open with Plugin Command: "Open Slot Machine"
 * or Script Call: SceneManager.push(Scene_SlotMachine);
 *
 * Controls:
 *   Enter / Z / SPIN button .... Spin
 *   Up / Down .................. Change bet by 10
 *   Left / Right ............... Change bet by 1
 *   Esc / X / Close button ..... Exit
 *
 * @param minBet
 * @text Minimum Bet
 * @desc Minimum tokens to bet
 * @type number
 * @default 1
 *
 * @param maxBet
 * @text Maximum Bet
 * @desc Maximum tokens to bet
 * @type number
 * @default 100
 *
 * @param tokenItemId
 * @text Token Item ID
 * @desc ID of the token item in database (124 = Arcade Token)
 * @type number
 * @default 124
 *
 * @param slotIcons
 * @text Slot Icon Indices
 * @desc Comma-separated IconSet indices used as reel symbols
 *       (rarest/highest payout LAST). 5-10 recommended.
 * @type string
 * @default 73,76,77,64,84,87,160,162
 *
 * @command openSlotMachine
 * @text Open Slot Machine
 * @desc Opens the slot machine minigame
 */

(() => {
    'use strict';

    const pluginName = "AnimatedSlotMachine";
    const parameters = PluginManager.parameters(pluginName);
    const MIN_BET = parseInt(parameters['minBet']) || 1;
    const MAX_BET = parseInt(parameters['maxBet']) || 100;
    const TOKEN_ITEM_ID = parseInt(parameters['tokenItemId']) || 124;

    // Art Deco accent palette cycled across the symbols.
    const DECO_PALETTE = [
        '#e9c46a', '#e76f51', '#2a9d8f', '#457b9d',
        '#c9a227', '#f4a261', '#06d6a0', '#ef476f',
        '#9b5de5', '#118ab2'
    ];

    // Payout multiplier for three-of-a-kind, by symbol rarity index.
    const MULT_TABLE = [3, 4, 5, 8, 12, 18, 30, 50, 75, 120];
    function multForIndex(i) {
        return MULT_TABLE[i] != null ? MULT_TABLE[i] : Math.round(3 * Math.pow(1.7, i));
    }

    // Build the symbol set from the parameter list of IconSet indices.
    const SYMBOLS = (() => {
        const raw = String(parameters['slotIcons'] || '73,76,77,64,84,87,160,162');
        const icons = raw.split(',')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => Number.isFinite(n) && n >= 0);
        if (icons.length < 3) icons.push(73, 76, 77);
        return icons.map((icon, i) => ({
            icon,
            mult: multForIndex(i),
            color: DECO_PALETTE[i % DECO_PALETTE.length]
        }));
    })();
    const SYMBOL_COUNT = SYMBOLS.length;

    // Weighted target pool, higher payouts appear less often for balance.
    const WEIGHTED_POOL = (() => {
        const pool = [];
        SYMBOLS.forEach((s, i) => {
            const weight = Math.max(1, Math.round(60 / s.mult));
            for (let w = 0; w < weight; w++) pool.push(i);
        });
        return pool;
    })();
    function pickTarget() {
        return WEIGHTED_POOL[Math.floor(Math.random() * WEIGHTED_POOL.length)];
    }

    const ICONSET_URL = 'img/system/IconSet.png';
    const ICON_PX = 72;          // rendered icon size
    const CELL_H = 112;          // reel cell height
    const VISIBLE_ROWS = 3;      // rows visible in a reel
    const STRIP_COPIES = 3;      // symbol list repeated for seamless looping

    function iconStyle(index) {
        const col = index % 16;
        const row = Math.floor(index / 16);
        return [
            `width:${ICON_PX}px`,
            `height:${ICON_PX}px`,
            `background-image:url('${ICONSET_URL}')`,
            `background-size:${16 * ICON_PX}px auto`,
            `background-position:-${col * ICON_PX}px -${row * ICON_PX}px`,
            `image-rendering:pixelated`
        ].join(';');
    }

    PluginManager.registerCommand(pluginName, "openSlotMachine", () => {
        SceneManager.push(Scene_SlotMachine);
    });

    //-----------------------------------------------------------------------------
    // SlotMachineDOM, builds and updates the HTML overlay
    //-----------------------------------------------------------------------------

    class SlotMachineDOM {
        constructor(callbacks) {
            this._callbacks = callbacks || {};
            this._reelStrips = [];
            this._landed = [false, false, false];
            this._build();
        }

        _build() {
            const overlay = document.createElement('div');
            overlay.id = 'asm-overlay';
            overlay.className = 'asm-overlay';
            this._overlay = overlay;

            overlay.innerHTML = `
                <div class="asm-bg"></div>
                <div class="asm-cabinet" id="asm-cabinet">
                    <div class="asm-bulbs asm-bulbs-top"></div>
                    <div class="asm-marquee">
                        <div class="asm-sunburst"></div>
                        <div class="asm-title">${T('SlotMachine.ui.title')}</div>
                        <div class="asm-subtitle">${T('SlotMachine.ui.subtitle')}</div>
                    </div>
                    <div class="asm-banner" id="asm-banner">${T('SlotMachine.ui.pressSpin')}</div>
                    <div class="asm-reels-frame">
                        <div class="asm-reels" id="asm-reels"></div>
                        <div class="asm-payline"></div>
                        <div class="asm-marker asm-marker-left">&#9664;</div>
                        <div class="asm-marker asm-marker-right">&#9654;</div>
                        <div class="asm-lever" id="asm-lever" title="${T('SlotMachine.pullToSpin')}">
                            <div class="asm-lever-arm" id="asm-lever-arm">
                                <div class="asm-lever-shaft"></div>
                                <div class="asm-lever-knob"></div>
                            </div>
                            <div class="asm-lever-mount"></div>
                        </div>
                    </div>
                    <div class="asm-info">
                        <div class="asm-stat">
                            <span class="asm-label">${T('SlotMachine.ui.tokens')}</span>
                            <span class="asm-value" id="asm-tokens">0</span>
                        </div>
                        <div class="asm-stat asm-stat-bet">
                            <span class="asm-label">${T('SlotMachine.ui.bet')}</span>
                            <span class="asm-value" id="asm-bet">0</span>
                        </div>
                        <div class="asm-stat">
                            <span class="asm-label">${T('SlotMachine.ui.lastWin')}</span>
                            <span class="asm-value asm-win" id="asm-lastwin">0</span>
                        </div>
                    </div>
                    <div class="asm-controls">
                        <button class="asm-btn asm-bet-btn" id="asm-bet-minus">&#9660; 10</button>
                        <button class="asm-spin" id="asm-spin"><span>${T('SlotMachine.ui.spin')}</span></button>
                        <button class="asm-btn asm-bet-btn" id="asm-bet-plus">10 &#9650;</button>
                    </div>
                    <div class="asm-hint">${T('SlotMachine.ui.hint')}</div>
                    <div class="asm-paytable" id="asm-paytable"></div>
                    <div class="asm-bulbs asm-bulbs-bottom"></div>
                    <button class="asm-close" id="asm-close">&times;</button>
                </div>
            `;

            document.body.appendChild(overlay);

            this._buildBulbs(overlay.querySelector('.asm-bulbs-top'));
            this._buildBulbs(overlay.querySelector('.asm-bulbs-bottom'));
            this._buildReels(overlay.querySelector('#asm-reels'));
            this._buildPaytable(overlay.querySelector('#asm-paytable'));

            this._banner = overlay.querySelector('#asm-banner');
            this._cabinet = overlay.querySelector('#asm-cabinet');
            this._tokensEl = overlay.querySelector('#asm-tokens');
            this._betEl = overlay.querySelector('#asm-bet');
            this._lastWinEl = overlay.querySelector('#asm-lastwin');
            this._leverArm = overlay.querySelector('#asm-lever-arm');

            // Wire interactions
            const fire = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); if (fn) fn(); };
            overlay.querySelector('#asm-spin').addEventListener('click', fire(this._callbacks.onSpin));
            overlay.querySelector('#asm-lever').addEventListener('click', fire(this._callbacks.onSpin));
            overlay.querySelector('#asm-close').addEventListener('click', fire(this._callbacks.onClose));
            overlay.querySelector('#asm-bet-plus').addEventListener('click', fire(() => this._callbacks.onBet && this._callbacks.onBet(10)));
            overlay.querySelector('#asm-bet-minus').addEventListener('click', fire(() => this._callbacks.onBet && this._callbacks.onBet(-10)));
        }

        _buildBulbs(container) {
            const count = 18;
            for (let i = 0; i < count; i++) {
                const b = document.createElement('span');
                b.className = 'asm-bulb';
                b.style.animationDelay = `${(i % 6) * 0.12}s`;
                container.appendChild(b);
            }
        }

        _buildReels(container) {
            container.style.setProperty('--cell-h', `${CELL_H}px`);
            container.style.setProperty('--icon-px', `${ICON_PX}px`);
            container.style.setProperty('--rows', VISIBLE_ROWS);

            for (let r = 0; r < 3; r++) {
                const viewport = document.createElement('div');
                viewport.className = 'asm-reel';

                const strip = document.createElement('div');
                strip.className = 'asm-strip';

                // Repeat the symbol list so the strip can loop seamlessly.
                for (let copy = 0; copy < STRIP_COPIES; copy++) {
                    for (let s = 0; s < SYMBOL_COUNT; s++) {
                        const cell = document.createElement('div');
                        cell.className = 'asm-cell';
                        const ic = document.createElement('div');
                        ic.className = 'asm-icon';
                        ic.setAttribute('style', iconStyle(SYMBOLS[s].icon));
                        cell.appendChild(ic);
                        strip.appendChild(cell);
                    }
                }
                viewport.appendChild(strip);
                container.appendChild(viewport);
                this._reelStrips.push(strip);
            }
        }

        _buildPaytable(container) {
            // Show the top few paying symbols.
            const top = SYMBOLS.map((s, i) => ({ s, i }))
                .sort((a, b) => b.s.mult - a.s.mult)
                .slice(0, Math.min(4, SYMBOL_COUNT));
            top.forEach(({ s }) => {
                const entry = document.createElement('div');
                entry.className = 'asm-pay-entry';
                const trio = document.createElement('div');
                trio.className = 'asm-pay-icons';
                for (let k = 0; k < 3; k++) {
                    const ic = document.createElement('div');
                    ic.className = 'asm-pay-icon';
                    ic.setAttribute('style', iconStyle(s.icon));
                    trio.appendChild(ic);
                }
                const mult = document.createElement('div');
                mult.className = 'asm-pay-mult';
                mult.textContent = `x${s.mult}`;
                entry.appendChild(trio);
                entry.appendChild(mult);
                container.appendChild(entry);
            });
        }

        // Render reel positions every frame.
        renderReels(positions, spinning, stopped) {
            // When idle (not spinning) and nothing has moved since the last render,
            // skip rewriting the three transform styles.
            if (!spinning && !this._lastSpinning && this._lastPositions &&
                this._lastPositions[0] === positions[0] &&
                this._lastPositions[1] === positions[1] &&
                this._lastPositions[2] === positions[2]) {
                return;
            }
            this._lastSpinning = spinning;
            this._lastPositions = [positions[0], positions[1], positions[2]];

            for (let r = 0; r < 3; r++) {
                const p = positions[r];
                // Center symbol floor(p) on the middle visible row.
                const y = -((SYMBOL_COUNT + p - (VISIBLE_ROWS - 1) / 2) * CELL_H);
                const strip = this._reelStrips[r];
                strip.style.transform = `translateY(${y}px)`;

                const blur = spinning && !stopped[r];
                strip.classList.toggle('asm-spin-blur', blur);

                if (stopped[r] && !this._landed[r]) {
                    this._landed[r] = true;
                    strip.classList.remove('asm-land');
                    // force reflow to restart the animation
                    void strip.offsetWidth;
                    strip.classList.add('asm-land');
                }
                if (!stopped[r]) this._landed[r] = false;
            }
        }

        setStats(tokens, bet, lastWin) {
            if (this._tokensEl) this._tokensEl.textContent = tokens;
            if (this._betEl) this._betEl.textContent = bet;
            if (this._lastWinEl) this._lastWinEl.textContent = lastWin;
        }

        setBanner(text) {
            if (this._banner) this._banner.textContent = text;
        }

        // Yank the lever down and let it spring back.
        pullLever() {
            if (!this._leverArm) return;
            this._leverArm.classList.remove('asm-lever-pull');
            void this._leverArm.offsetWidth;
            this._leverArm.classList.add('asm-lever-pull');
        }

        flashBet() {
            const el = this._overlay.querySelector('.asm-stat-bet');
            if (!el) return;
            el.classList.remove('asm-flash');
            void el.offsetWidth;
            el.classList.add('asm-flash');
        }

        celebrate(big) {
            if (!this._cabinet) return;
            const cls = big ? 'asm-jackpot' : 'asm-winpulse';
            this._cabinet.classList.remove('asm-jackpot', 'asm-winpulse');
            void this._cabinet.offsetWidth;
            this._cabinet.classList.add(cls);
            setTimeout(() => {
                if (this._cabinet) this._cabinet.classList.remove(cls);
            }, big ? 1600 : 700);
        }

        destroy() {
            if (this._overlay && this._overlay.parentNode) {
                this._overlay.parentNode.removeChild(this._overlay);
            }
            this._overlay = null;
        }

    }

    //-----------------------------------------------------------------------------
    // Scene_SlotMachine
    //-----------------------------------------------------------------------------

    class Scene_SlotMachine extends Scene_MenuBase {
        initialize() {
            super.initialize();
            this._bet = MIN_BET;
            this._spinning = false;
            this._reels = [0, 0, 0];
            this._targetReels = [0, 0, 0];
            this._spinSpeed = [0, 0, 0];
            this._spinTimer = 0;
            this._animationPhase = 'idle';
            this._lastWin = 0;
            this._reelsStopped = [false, false, false];
            this._spinRequested = false;
            this._closeRequested = false;
        }

        create() {
            super.create();
            this._ui = new SlotMachineDOM({
                onSpin: () => { this._spinRequested = true; },
                onClose: () => { this._closeRequested = true; },
                onBet: (amount) => { this.changeBet(amount); }
            });
            this.refreshStats();
        }

        terminate() {
            super.terminate();
            if (this._ui) this._ui.destroy();
            this._ui = null;
        }

        update() {
            super.update();
            if (this._closeRequested) {
                this._closeRequested = false;
                this.popScene();
                return;
            }
            if (!this._spinning) {
                this.updateBetInput();
                if (this._spinRequested || Input.isTriggered('ok')) {
                    this._spinRequested = false;
                    this.spin();
                }
                if (Input.isTriggered('cancel')) {
                    this.popScene();
                    return;
                }
            }
            this.updateSpinAnimation();
            this.renderReels();
        }

        updateBetInput() {
            if (Input.isRepeated('up')) this.changeBet(10);
            else if (Input.isRepeated('down')) this.changeBet(-10);
            else if (Input.isRepeated('right')) this.changeBet(1);
            else if (Input.isRepeated('left')) this.changeBet(-1);
        }

        changeBet(amount) {
            const oldBet = this._bet;
            this._bet = Math.max(MIN_BET, Math.min(MAX_BET, this._bet + amount));
            if (this._bet !== oldBet) {
                SoundManager.playCursor();
                this.refreshStats();
                if (this._ui) this._ui.flashBet();
            }
        }

        currentTokens() {
            const tokens = $dataItems[TOKEN_ITEM_ID];
            return tokens ? $gameParty.numItems(tokens) : 0;
        }

        refreshStats() {
            if (this._ui) this._ui.setStats(this.currentTokens(), this._bet, this._lastWin);
        }

        spin() {
            const tokens = $dataItems[TOKEN_ITEM_ID];
            if (!tokens) {
                SoundManager.playBuzzer();
                this._ui.setBanner(T('SlotMachine.noTokens'));
                return;
            }
            const tokenCount = $gameParty.numItems(tokens);
            if (tokenCount < this._bet) {
                SoundManager.playBuzzer();
                this._ui.setBanner(T('SlotMachine.notEnoughTokens', { have: tokenCount, need: this._bet }));
                return;
            }

            this._spinning = true;
            this._animationPhase = 'spinning';
            this._spinTimer = 0;
            this._reelsStopped = [false, false, false];

            $gameParty.loseItem(tokens, this._bet);

            for (let i = 0; i < 3; i++) {
                this._targetReels[i] = pickTarget();
                this._spinSpeed[i] = 0.55 + Math.random() * 0.3;
            }

            SoundManager.playOk();
            this._ui.pullLever();
            this._ui.setBanner('Spinning...');
            this.refreshStats();
        }

        updateSpinAnimation() {
            if (!this._spinning) return;
            this._spinTimer++;

            if (this._animationPhase === 'spinning') {
                for (let i = 0; i < 3; i++) {
                    if (!this._reelsStopped[i]) {
                        this._reels[i] += this._spinSpeed[i];
                        if (this._reels[i] >= SYMBOL_COUNT) this._reels[i] -= SYMBOL_COUNT;
                    }
                }

                const stopThresholds = [60, 90, 120];
                for (let i = 0; i < 3; i++) {
                    if (this._spinTimer > stopThresholds[i] && !this._reelsStopped[i]) {
                        this._spinSpeed[i] *= 0.88;
                        if (this._spinSpeed[i] < 0.05) {
                            this._reels[i] = this._targetReels[i];
                            this._reelsStopped[i] = true;
                            SoundManager.playCursor();
                        }
                    }
                }

                if (this._reelsStopped[0] && this._reelsStopped[1] && this._reelsStopped[2]) {
                    this._animationPhase = 'stopping';
                }
            } else if (this._animationPhase === 'stopping') {
                if (this._spinTimer > 150) {
                    this._spinning = false;
                    this._animationPhase = 'idle';
                    this.checkWin();
                }
            }
        }

        renderReels() {
            if (this._ui) this._ui.renderReels(this._reels, this._spinning, this._reelsStopped);
        }

        checkWin() {
            const [a, b, c] = this._targetReels;
            let winAmount = 0;
            let message = '';
            let big = false;

            if (a === b && b === c) {
                const mult = SYMBOLS[a].mult;
                winAmount = this._bet * mult;
                big = mult >= 25;
                message = T('SlotMachine.jackpot', { amount: winAmount, mult });
            } else if (a === b || b === c || a === c) {
                // A pair happens on ~33% of spins with 3 reels (higher with fewer
                // symbols). Paying bet*2 pushed the overall RTP above 100% for the
                // recommended 5-symbol setups. Pay bet*1.5 so the house keeps an
                // edge across the whole recommended 5-10 symbol range.
                winAmount = Math.floor(this._bet * 1.5);
                message = T('SlotMachine.pair', { amount: winAmount });
            }

            if (winAmount > 0) {
                const tokens = $dataItems[TOKEN_ITEM_ID];
                $gameParty.gainItem(tokens, winAmount);
                this._lastWin = winAmount;
                SoundManager.playRecovery();
                this._ui.celebrate(big);
                if (window.MinigameFun) window.MinigameFun.won('Card Counting');
            } else {
                this._lastWin = 0;
                if (window.MinigameFun) window.MinigameFun.lost('Card Counting');
                message = T('SlotMachine.noMatch');
            }

            this._ui.setBanner(message);
            this.refreshStats();
        }
    }

    window.Scene_SlotMachine = Scene_SlotMachine;

})();
