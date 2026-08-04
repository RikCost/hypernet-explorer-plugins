/*:
 * @target MZ
 * @plugindesc Creates a banking system with deposits, withdrawals, interest, and loans.
 * @author Omni-Lex (Your Name Here)
 * @url https://yourwebsite.com
 *
 * @param Starting Interest Rate
 * @desc The starting interest rate for money in the bank (in percentage)
 * @default 2
 * @type number
 * @min 0
 * @decimals 1
 *
 * @param Interest Interval
 * @desc How often interest is applied (in game days)
 * @default 7
 * @type number
 * @min 1
 *
 * @param Loan Interest Rate
 * @desc The interest rate for loans (in percentage)
 * @default 5
 * @type number
 * @min 0
 * @decimals 1
 *
 * @param Max Loan Amount
 * @desc The maximum amount the player can borrow
 * @default 10000
 * @type number
 * @min 0
 *
 * @param Loan Duration
 * @desc How long before a loan must be paid back (in game days)
 * @default 30
 * @type number
 * @min 1
 *
 * @command OpenBankMenu
 * @desc Opens the banking system menu
 *
 * @command ProcessDayChange
 * @desc Process a day change for interest and loan calculations
 *
 * @help
 * ===========================================================================
 * Bank and Loan System
 * ===========================================================================
 * This plugin implements a banking system with the following features:
 * - Deposit gold into a bank account
 * - Withdraw gold from your bank account
 * - Earn interest on your bank balance
 * - Take out loans with interest
 * - Get penalized for not paying back loans on time
 * 
 * ===========================================================================
 * How to Use
 * ===========================================================================
 * 1. In an event, use the plugin command "OpenBankMenu" to open the bank menu.
 * 2. Use the plugin command "ProcessDayChange" whenever a game day passes
 *    (typically in your day change events).
 * 
 * ===========================================================================
 * Script Calls
 * ===========================================================================
 * $gameSystem.getBankBalance() - Returns the player's bank balance
 * $gameSystem.getLoanBalance() - Returns the player's current loan amount
 * $gameSystem.getLoanDueDate() - Returns the due date for the current loan
 * 
 */

(() => {
    'use strict';

    const pluginName = "BankLoanSystem";

    //=============================================================================
    // Plugin Parameters
    //=============================================================================

    const parameters = PluginManager.parameters(pluginName);
    const interestRate = Number(parameters['Starting Interest Rate'] || 2) / 100;
    const interestInterval = Number(parameters['Interest Interval'] || 7);
    const loanInterestRate = Number(parameters['Loan Interest Rate'] || 5) / 100;
    const maxLoanAmount = Number(parameters['Max Loan Amount'] || 10000);
    const loanDuration = Number(parameters['Loan Duration'] || 30);

    //=============================================================================
    // Game_System
    //=============================================================================

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        _Game_System_initialize.call(this);
        this._bankBalance = 0;
        this._loanBalance = 0;
        this._loanDueDate = 0;
        this._daysSinceInterest = 0;
        this._currentDay = 0;
    };

    Game_System.prototype.getBankBalance = function () {
        return this._bankBalance || 0;
    };

    Game_System.prototype.getLoanBalance = function () {
        return this._loanBalance || 0;
    };

    Game_System.prototype.getLoanDueDate = function () {
        return this._loanDueDate || 0;
    };

    Game_System.prototype.deposit = function (amount) {
        if (amount > 0 && $gameParty.gold() >= amount) {
            this._bankBalance = (this._bankBalance || 0) + amount;
            $gameParty.loseGold(amount);
            return true;
        }
        return false;
    };

    Game_System.prototype.withdraw = function (amount) {
        if (amount > 0 && (this._bankBalance || 0) >= amount) {
            this._bankBalance -= amount;
            $gameParty.gainGold(amount);
            return true;
        }
        return false;
    };

    Game_System.prototype.takeLoan = function (amount) {
        // Books a bank can follow are books a bank will lend against, so a
        // party that keeps its accounts borrows more (Accounting, spec 1).
        const ceiling = window.SpecializationXP
            ? Math.floor(maxLoanAmount * window.SpecializationXP.multiplier('Accounting', 0.12))
            : maxLoanAmount;
        if (amount > 0 && amount <= ceiling && (this._loanBalance || 0) === 0) {
            this._loanBalance = amount;
            this._loanPrincipal = amount;
            this._loanDueDate = (this._currentDay || 0) + loanDuration;
            $gameParty.gainGold(amount);
            if (window.SpecializationXP) {
                window.SpecializationXP.awardForValue('Accounting', amount);
            }
            return true;
        }
        return false;
    };

    Game_System.prototype.repayLoan = function (amount) {
        if (amount > 0) {
            // Never charge more than the outstanding debt, and only require enough
            // gold to cover the amount actually repaid (not the over-requested amount).
            const repaidAmount = Math.min(amount, this._loanBalance || 0);
            if (repaidAmount > 0 && $gameParty.gold() >= repaidAmount) {
                this._loanBalance -= repaidAmount;
                $gameParty.loseGold(repaidAmount);

                if (this._loanBalance <= 0) {
                    this._loanBalance = 0;
                    this._loanDueDate = 0;
                }
                return true;
            }
        }
        return false;
    };

    Game_System.prototype.processDayChange = function () {
        this._currentDay = (this._currentDay || 0) + 1;
        this._daysSinceInterest = (this._daysSinceInterest || 0) + 1;

        // Apply bank interest
        if (this._daysSinceInterest >= interestInterval) {
            this._bankBalance = (this._bankBalance || 0) + Math.floor((this._bankBalance || 0) * interestRate);
            this._daysSinceInterest = 0;
        }

        // Process loan
        if ((this._loanBalance || 0) > 0) {
            // Check if loan is overdue
            if ((this._currentDay || 0) > (this._loanDueDate || 0)) {
                // Add penalty interest, capped so the debt cannot spiral without limit.
                // Cap total balance at 3x the original principal.
                const penaltyCap = Math.floor((this._loanPrincipal || this._loanBalance || 0) * 3);
                const before = this._loanBalance;
                // Somebody who reads the small print negotiates the penalty
                // down before it compounds out of reach.
                const relief = window.SpecializationXP
                    ? window.SpecializationXP.discount('Accounting', 0.08, 0.6) : 1;
                let next = this._loanBalance + Math.floor((this._loanBalance || 0) * (loanInterestRate * 2) * relief);
                if (next > penaltyCap) next = penaltyCap;
                this._loanBalance = next;

                // Notify the player when a penalty is actually applied.
                if (this._loanBalance > before && window.ParchmentToast) {
                    window.ParchmentToast.show(T('BankLoan.ui.loanOverdue'), { severity: "warning", duration: 180 });
                }
            }
        }
    };

    //=============================================================================
    // Plugin Commands
    //=============================================================================

    PluginManager.registerCommand(pluginName, "OpenBankMenu", args => {
        if (window.HypernetOS && SceneManager._scene instanceof Scene_HypernetOS) {
            if (window.HypernetBankApp) {
                window.HypernetBankApp.launch();
            } else {
                SceneManager.push(Scene_BankSystem);
            }
        } else {
            SceneManager.push(Scene_BankSystem);
        }
    });

    PluginManager.registerCommand(pluginName, "ProcessDayChange", args => {
        $gameSystem.processDayChange();
    });

    if (window.HypernetOS) {
        window.HypernetOS.registerApp({
            id: 'app-bank-system',
            name: T('BankLoan.ui.appName'),
            icon: 84,
            launchFn: function() {
                if (window.HypernetBankApp) {
                    window.HypernetBankApp.launch();
                } else {
                    SceneManager.push(Scene_BankSystem);
                }
            },
            desktopShortcut: true
        });
    }

    // --- HypernetBankApp ---
    window.HypernetBankApp = {
        appInstance: null,
        win: null,
        launch: function(params) {
            if (!window.HypernetWindowManager) return;
            
            if (!this.win || !document.getElementById('app-bank-system')) {
                this.win = window.HypernetWindowManager.createWindow({
                    id: 'app-bank-system',
                    title: T('BankLoan.ui.appName'),
                    icon: 84,
                    width: 950,
                    height: 600,
                    contentHTML: '<div id="bank-system-content" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #ece9d8;"></div>'
                });

                this.appInstance = new Scene_BankSystem();
                this.appInstance._isAppMode = true;
                this.appInstance.create();
                
                this.win.addEventListener('hypernet-closed', () => {
                    if (this.appInstance) {
                        this.appInstance.terminate();
                        this.appInstance = null;
                    }
                    this.win = null;
                });
            } else {
                window.HypernetWindowManager.bringToFront(this.win);
            }
        },
        update: function() {
            if (this.appInstance && this.win) {
                if (this.win.classList.contains('active')) {
                    this.appInstance.update();
                }
            }
        }
    };

    //=============================================================================
    // Window_BankCommand
    //=============================================================================

    function Window_BankCommand() {
        this.initialize(...arguments);
    }

    Window_BankCommand.prototype = Object.create(Window_Command.prototype);
    Window_BankCommand.prototype.constructor = Window_BankCommand;

    Window_BankCommand.prototype.initialize = function (rect) {
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_BankCommand.prototype.makeCommandList = function () {
        this.addCommand(T('BankLoan.ui.deposit'), "deposit");
        this.addCommand(T('BankLoan.ui.withdraw'), "withdraw");
        this.addCommand(T('BankLoan.ui.loan'), "loan");
        this.addCommand(T('BankLoan.ui.repayLoan'), "repay");
        this.addCommand(T('BankLoan.ui.exit'), "cancel");
    };

    //=============================================================================
    // Window_BankStatus
    //=============================================================================

    function Window_BankStatus() {
        this.initialize(...arguments);
    }

    Window_BankStatus.prototype = Object.create(Window_Base.prototype);
    Window_BankStatus.prototype.constructor = Window_BankStatus;

    Window_BankStatus.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.refresh();
    };

    Window_BankStatus.prototype.refresh = function () {
        this.contents.clear();

        const lineHeight = this.lineHeight();
        const x = this.itemPadding();
        let y = 0;

        // Player's money
        this.drawText(T('BankLoan.ui.yourMoney'), x, y, 120);
        this.drawText("€" + ($gameParty.gold() / 100).toFixed(2), x + 140, y, 120, 'right');
        y += lineHeight;

        // Bank balance
        this.drawText(T('BankLoan.ui.bankBalance'), x, y, 120);
        this.drawText("€" + ($gameSystem.getBankBalance() / 100).toFixed(2), x + 140, y, 120, 'right');
        y += lineHeight;

        // Interest rate
        this.drawText(T('BankLoan.ui.interestRate'), x, y, 120);
        this.drawText((interestRate * 100).toFixed(1) + "% / " + interestInterval + " days", x + 140, y, 180, 'right');
        y += lineHeight;

        // Loan information
        if ($gameSystem.getLoanBalance() > 0) {
            this.drawText(T('BankLoan.ui.loanAmount'), x, y, 120);
            this.drawText("€" + ($gameSystem.getLoanBalance() / 100).toFixed(2), x + 140, y, 120, 'right');
            y += lineHeight;

            this.drawText(T('BankLoan.ui.dueDate'), x, y, 120);
            const daysLeft = $gameSystem.getLoanDueDate() - ($gameSystem._currentDay || 0);
            const dueDateText = T('BankLoan.ui.daysLeft', { days: daysLeft });
            this.drawText(dueDateText, x + 140, y, 120, 'right');
            y += lineHeight;

            this.drawText(T('BankLoan.ui.loanRate'), x, y, 120);
            this.drawText((loanInterestRate * 100).toFixed(1) + "%", x + 140, y, 120, 'right');
        } else {
            this.drawText(T('BankLoan.ui.maxLoan'), x, y, 120);
            this.drawText("€" + (maxLoanAmount / 100).toFixed(2), x + 140, y, 120, 'right');
            y += lineHeight;

            this.drawText(T('BankLoan.ui.loanRate'), x, y, 120);
            this.drawText((loanInterestRate * 100).toFixed(1) + "%", x + 140, y, 120, 'right');
            y += lineHeight;

            this.drawText(T('BankLoan.ui.loanDuration'), x, y, 120);
            this.drawText(loanDuration + " days", x + 140, y, 120, 'right');
        }
    };

    //=============================================================================
    // Window_Amount - A simplified window for amount input
    //=============================================================================

    function Window_Amount() {
        this.initialize(...arguments);
    }

    Window_Amount.prototype = Object.create(Window_Base.prototype);
    Window_Amount.prototype.constructor = Window_Amount;

    Window_Amount.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._amount = 0;
        this._maxAmount = 0;
        this._mode = "";
        this.active = false;
        this.refresh();
    };

    Window_Amount.prototype.setMode = function (mode, maxAmount) {
        this._mode = mode;
        this._maxAmount = maxAmount;
        this._amount = 0;
        this.refresh();
        this.activate();
    };

    Window_Amount.prototype.amount = function () {
        return this._amount;
    };

    Window_Amount.prototype.refresh = function () {
        this.contents.clear();
        const lineHeight = this.lineHeight();
        const title = this._mode + " Amount:";
        this.drawText(title, 0, 0, 200);

        const amountText = "€" + (this._amount / 100).toFixed(2);
        this.drawText(amountText, 0, lineHeight, this.width - this.padding * 2, 'right');

        const helpText = "↑↓: ±100  ←→: ±1000";
        this.contents.drawText(helpText, 0, lineHeight * 2, this.width - this.padding * 2, lineHeight);

        const confirmText = T('BankLoan.ui.confirmKeys');
        this.contents.drawText(confirmText, 0, lineHeight * 3, this.width - this.padding * 2, lineHeight);
    };

    Window_Amount.prototype.update = function () {
        Window_Base.prototype.update.call(this);
        if (this.active) {
            this.processDigitChange();
            if (Input.isTriggered('ok')) {
                this.processOk();
            }
            if (Input.isTriggered('cancel')) {
                this.processCancel();
            }
        }
    };

    Window_Amount.prototype.processDigitChange = function () {
        let changed = false;
        let newAmount = this._amount;

        if (Input.isRepeated('up')) {
            newAmount = Math.min(newAmount + 100, this._maxAmount);
            changed = true;
        }
        if (Input.isRepeated('down')) {
            newAmount = Math.max(newAmount - 100, 0);
            changed = true;
        }
        if (Input.isRepeated('right')) {
            newAmount = Math.min(newAmount + 1000, this._maxAmount);
            changed = true;
        }
        if (Input.isRepeated('left')) {
            newAmount = Math.max(newAmount - 1000, 0);
            changed = true;
        }

        if (changed && newAmount !== this._amount) {
            this._amount = newAmount;
            SoundManager.playCursor();
            this.refresh();
        }
    };

    Window_Amount.prototype.processOk = function () {
        this.deactivate();
        this.callOkHandler();
    };

    Window_Amount.prototype.processCancel = function () {
        this.deactivate();
        this.callCancelHandler();
    };

    Window_Amount.prototype.activate = function () {
        this.active = true;
        this.refresh();
    };

    Window_Amount.prototype.deactivate = function () {
        this.active = false;
        this.refresh();
    };

    Window_Amount.prototype.callOkHandler = function () {
        if (this._okHandler) {
            this._okHandler();
        }
    };

    Window_Amount.prototype.callCancelHandler = function () {
        if (this._cancelHandler) {
            this._cancelHandler();
        }
    };

    Window_Amount.prototype.setHandler = function (symbol, method) {
        if (symbol === 'ok') {
            this._okHandler = method;
        } else if (symbol === 'cancel') {
            this._cancelHandler = method;
        }
    };

    //=============================================================================
    // Scene_BankSystem
    //===========================================================================
    function Scene_BankSystem() {
        this.initialize(...arguments);
    }

    Scene_BankSystem.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_BankSystem.prototype.constructor = Scene_BankSystem;

    Scene_BankSystem.prototype.initialize = function () {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_BankSystem.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);

        // Create status window
        const statusRect = this.statusWindowRect();
        this._statusWindow = new Window_BankStatus(statusRect);
        this.addWindow(this._statusWindow);

        // Create command window
        const commandRect = this.commandWindowRect();
        this._commandWindow = new Window_BankCommand(commandRect);
        this._commandWindow.setHandler("deposit", this.commandDeposit.bind(this));
        this._commandWindow.setHandler("withdraw", this.commandWithdraw.bind(this));
        this._commandWindow.setHandler("loan", this.commandLoan.bind(this));
        this._commandWindow.setHandler("repay", this.commandRepay.bind(this));
        this._commandWindow.setHandler("cancel", this.popScene.bind(this));
        this.addWindow(this._commandWindow);

        // Create amount window
        const amountRect = this.amountWindowRect();
        this._amountWindow = new Window_Amount(amountRect);
        this._amountWindow.setHandler('ok', this.onAmountOk.bind(this));
        this._amountWindow.setHandler('cancel', this.onAmountCancel.bind(this));
        this.addWindow(this._amountWindow);
        this._amountWindow.hide(); // Hide the amount window initially

        // Hide MZ standard canvas windows
        if (this._statusWindow) this._statusWindow.visible = false;
        if (this._commandWindow) this._commandWindow.visible = false;
        if (this._amountWindow) this._amountWindow.visible = false;

        this.createUIBankDOM();
    };

    Scene_BankSystem.prototype.popScene = function () {
        if (this._isAppMode) {
            if (window.HypernetBankApp && window.HypernetBankApp.win) {
                window.HypernetWindowManager.closeWindow(window.HypernetBankApp.win);
            }
            return;
        }
        Scene_MenuBase.prototype.popScene.call(this);
    };

    Scene_BankSystem.prototype.statusWindowRect = function () {
        const wx = 0;
        const wy = this.mainAreaTop();
        const ww = Graphics.boxWidth;
        const wh = this.calcWindowHeight(6, true);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_BankSystem.prototype.commandWindowRect = function () {
        const wx = 0;
        const wy = this._statusWindow.y + this._statusWindow.height;
        const ww = Graphics.boxWidth;
        const wh = this.calcWindowHeight(5, true);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_BankSystem.prototype.amountWindowRect = function () {
        const ww = 400;
        const wh = this.calcWindowHeight(5, true);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = (Graphics.boxHeight - wh) / 2;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_BankSystem.prototype.commandDeposit = function () {
        const maxAmount = $gameParty.gold();
        if (maxAmount > 0) {
            this._commandWindow.deactivate();
            this._amountWindow.setMode("Deposit", maxAmount);  // i18n-ignore  mode id
            this._mode = "deposit";
            this.refreshUIBankDOM();
        } else {
            this._commandWindow.activate();
            SoundManager.playBuzzer();
            this.showMessage(T('BankLoan.ui.noMoneyToDeposit'));
        }
    };

    Scene_BankSystem.prototype.commandWithdraw = function () {
        const maxAmount = $gameSystem.getBankBalance();
        if (maxAmount > 0) {
            this._commandWindow.deactivate();
            this._amountWindow.setMode("Withdraw", maxAmount);  // i18n-ignore  mode id
            this._mode = "withdraw";
            this.refreshUIBankDOM();
        } else {
            this._commandWindow.activate();
            SoundManager.playBuzzer();
            this.showMessage(T('BankLoan.ui.noBankMoney'));
        }
    };

    Scene_BankSystem.prototype.commandLoan = function () {
        if ($gameSystem.getLoanBalance() === 0) {
            this._commandWindow.deactivate();
            this._amountWindow.setMode("Loan", maxLoanAmount);  // i18n-ignore  mode id
            this._mode = "loan";
            this.refreshUIBankDOM();
        } else {
            this._commandWindow.activate();
            SoundManager.playBuzzer();
            this.showMessage(T('BankLoan.ui.alreadyBorrowed'));
        }
    };

    Scene_BankSystem.prototype.commandRepay = function () {
        const loanAmount = $gameSystem.getLoanBalance();
        const playerGold = $gameParty.gold();

        if (loanAmount > 0) {
            const maxRepay = Math.min(loanAmount, playerGold);
            if (maxRepay > 0) {
                this._commandWindow.deactivate();
                this._amountWindow.setMode("Repay", maxRepay);  // i18n-ignore  mode id
                this._mode = "repay";
                this.refreshUIBankDOM();
            } else {
                this._commandWindow.activate();
                SoundManager.playBuzzer();
                this.showMessage(T('BankLoan.ui.noMoneyToRepay'));
            }
        } else {
            this._commandWindow.activate();
            SoundManager.playBuzzer();
            this.showMessage(T('BankLoan.ui.noOutstandingLoan'));
        }
    };

    Scene_BankSystem.prototype.onAmountOk = function () {
        const amount = this._amountWindow.amount();
        let success = false;

        if (amount > 0) {
            switch (this._mode) {
                case "deposit":
                    success = $gameSystem.deposit(amount);
                    break;
                case "withdraw":
                    success = $gameSystem.withdraw(amount);
                    break;
                case "loan":
                    success = $gameSystem.takeLoan(amount);
                    break;
                case "repay":
                    success = $gameSystem.repayLoan(amount);
                    break;
            }

            if (success) {
                SoundManager.playShop();
                const actionText = {
                    deposit: "deposited",
                    withdraw: "withdrew",
                    loan: "borrowed",
                    repay: "repaid"
                }[this._mode];

                this.showMessage(T('BankLoan.ui.transactionDone',
                    { action: actionText, amount: (amount / 100).toFixed(2) }));
            } else {
                SoundManager.playBuzzer();
            }
        }

        this._statusWindow.refresh();
        this._commandWindow.activate();
        this._amountWindow.hide();
        this.refreshUIBankDOM();
    };

    Scene_BankSystem.prototype.onAmountCancel = function () {
        this._commandWindow.activate();
        this._amountWindow.hide();
        this.refreshUIBankDOM();
    };

    Scene_BankSystem.prototype.showMessage = function (text) {
        window.skipLocalization = true;
        $gameMessage.add(text);
        window.skipLocalization = false;
    };

    Scene_BankSystem.prototype.terminate = function () {
        Scene_MenuBase.prototype.terminate.call(this);
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

    Scene_BankSystem.prototype.createUIBankDOM = function () {
        this._activeTab = 'transact'; // 'transact', 'loans', 'terms'

        this._dndContainer = document.createElement('div');
        this._dndContainer.id = 'menu-container';
        this._dndContainer.style.width = '100%';
        this._dndContainer.style.height = '100%';
        this._dndContainer.style.display = 'flex';
        this._dndContainer.style.flexDirection = 'column';
        this._dndContainer.style.fontFamily = "'Tahoma', sans-serif";
        this._dndContainer.style.color = '#000';
        this._dndContainer.style.boxSizing = 'border-box';

        if (this._isAppMode) {
            const parent = document.getElementById('bank-system-content');
            if (parent) {
                parent.appendChild(this._dndContainer);
                this.refreshUIBankDOM();
                return;
            }
        }

        // Fallback for non-app mode
        this._dndContainer.style.position = 'absolute';
        this._dndContainer.style.top = '0';
        this._dndContainer.style.left = '0';
        this._dndContainer.style.zIndex = '1000';
        this._dndContainer.style.background = 'radial-gradient(circle, rgba(18, 10, 5, 0.93) 0%, rgba(5, 3, 1, 0.98) 100%)';
        this._dndContainer.style.display = 'flex';
        this._dndContainer.style.justifyContent = 'center';
        this._dndContainer.style.alignItems = 'center';
        this._dndContainer.style.fontFamily = "'Lora', serif";
        this._dndContainer.style.color = '#2b1c11';
        this._dndContainer.style.boxSizing = 'border-box';
        document.body.appendChild(this._dndContainer);

        this.refreshUIBankDOM();
    };

    Scene_BankSystem.prototype.switchXPTab = function (tabName) {
        if (this._activeTab !== tabName) {
            this._activeTab = tabName;
            if (window.SoundManager) SoundManager.playOk();
            // Cancel any active input when switching tabs
            if (this._amountWindow && this._amountWindow.active) {
                this._amountWindow.deactivate();
                this._amountWindow.hide();
            }
            this.refreshUIBankDOM();
        }
    };

    Scene_BankSystem.prototype.refreshUIBankDOM = function () {
        if (!this._dndContainer) return;

        if (this._isAppMode) {
            const useItalian = ConfigManager.language === 'it';
            const bankBalance = $gameSystem.getBankBalance();
            const loanBalance = $gameSystem.getLoanBalance();
            const loanDueDate = $gameSystem.getLoanDueDate();
            const currentDay = $gameSystem._currentDay || 0;
            const daysLeft = loanDueDate - currentDay;
            const gold = $gameParty.gold();

            const isAmountActive = this._amountWindow && this._amountWindow.active;
            const currentAmount = isAmountActive ? this._amountWindow.amount() : 0;
            const maxAmount = isAmountActive ? this._amountWindow._maxAmount : 0;
            const activeMode = isAmountActive ? this._amountWindow._mode : "";

            let contentHTML = "";

            if (this._activeTab === 'transact') {
                // TAB 1: Deposits & Withdrawals
                let leftHTML = `
                    <h2 class="cc-header-gothic">${T('BankLoan.ui.accountsDeposits')}</h2>
                    <div class="stat-card" style="display:flex; flex-direction:column; gap:6px; font-size:11px; margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.personalWallet')}:</span>
                            <span style="font-weight:bold; color:#000;">€${(gold / 100).toFixed(2)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.bankBalance')}:</span>
                            <span style="font-weight:bold; color:#008000;">€${(bankBalance / 100).toFixed(2)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.interestRate')}:</span>
                            <span style="color:#000;">${T('BankLoan.ui.ratePerDays', { rate: (interestRate * 100).toFixed(1), days: interestInterval })}</span>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                        <div class="action-button" onclick="SceneManager._scene.selectBankCommand(0)">
                            ${T('BankLoan.ui.depositFunds')}
                        </div>
                        <div class="action-button" onclick="SceneManager._scene.selectBankCommand(1)">
                            ${T('BankLoan.ui.withdrawFunds')}
                        </div>
                    </div>
                `;

                let rightHTML = "";
                if (isAmountActive && (activeMode.toLowerCase() === 'deposit' || activeMode.toLowerCase() === 'withdraw')) {
                    rightHTML = this.getTransactionDeedHTML(activeMode, currentAmount, maxAmount);
                } else {
                    rightHTML = `
                        <h2 class="cc-header-gothic">${T('BankLoan.ui.depositGuidelines')}</h2>
                        <div style="font-size:11px; line-height:1.4; color:#333; display:flex; flex-direction:column; gap:8px;">
                            <p style="margin:0;">${T('BankLoan.ui.secureYourHardEarnedFunds')}</p>
                            <div style="background:#e5effa; border:1px solid #7f9db9; padding:6px; border-radius:3px; font-weight:bold; color:#0b2f70;">
                                ${T('BankLoan.ui.currentYield')}: ${(interestRate * 100).toFixed(1)}% ${T('BankLoan.ui.every')} ${interestInterval} ${T('BankLoan.ui.days')}.
                            </div>
                        </div>
                    `;
                }

                contentHTML = `
                    <div style="display:flex; gap:16px; height:100%; width:100%;">
                        <div style="width:40%; display:flex; flex-direction:column;">${leftHTML}</div>
                        <div style="width:1px; background:#7f9db9; margin: 0 4px; height:100%;"></div>
                        <div style="width:55%; display:flex; flex-direction:column;">${rightHTML}</div>
                    </div>
                `;

            } else if (this._activeTab === 'loans') {
                // TAB 2: Loans & Liabilities
                let leftHTML = `
                    <h2 class="cc-header-gothic">${T('BankLoan.ui.debtLiabilities')}</h2>
                    <div class="stat-card" style="display:flex; flex-direction:column; gap:6px; font-size:11px; margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px; color:${loanBalance > 0 ? '#a00' : 'inherit'}; font-weight:${loanBalance > 0 ? 'bold' : 'normal'};">
                            <span>${T('BankLoan.ui.outstandingDebt')}:</span>
                            <span>€${(loanBalance / 100).toFixed(2)}</span>
                        </div>
                        ${loanBalance > 0 ? `
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.daysUntilDue')}:</span>
                            <span style="color:#a00; font-weight:bold;">${daysLeft} days left</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.premiumInterest')}:</span>
                            <span>${(loanInterestRate * 100).toFixed(1)}%</span>
                        </div>
                        ` : `
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.maxDebtLimit')}:</span>
                            <span>€${(maxLoanAmount / 100).toFixed(2)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:3px;">
                            <span style="color:#555;">${T('BankLoan.ui.durationStandard')}:</span>
                            <span>${loanDuration} days</span>
                        </div>
                        `}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                        <div class="action-button" onclick="SceneManager._scene.selectBankCommand(2)">
                            ${T('BankLoan.ui.requestLoan')}
                        </div>
                        <div class="action-button" onclick="SceneManager._scene.selectBankCommand(3)">
                            ${T('BankLoan.ui.repayDebt')}
                        </div>
                    </div>
                `;

                let rightHTML = "";
                if (isAmountActive && (activeMode.toLowerCase() === 'loan' || activeMode.toLowerCase() === 'repay')) {
                    rightHTML = this.getTransactionDeedHTML(activeMode, currentAmount, maxAmount);
                } else {
                    rightHTML = `
                        <h2 class="cc-header-gothic">${T('BankLoan.ui.loanPolicies')}</h2>
                        <div style="font-size:11px; line-height:1.4; color:#333; display:flex; flex-direction:column; gap:8px;">
                            <p style="margin:0;">${T('BankLoan.ui.guildApprovedLoansProvideEmergency')}</p>
                            <div style="background:#fff8e8; border:1px solid #ff9900; padding:6px; border-radius:3px; font-weight:bold; color:#b85c00;">
                                ${T('BankLoan.ui.notice')}: ${T('BankLoan.ui.unresolvedDebtsDirectlyImpactCredit')}
                            </div>
                        </div>
                    `;
                }

                contentHTML = `
                    <div style="display:flex; gap:16px; height:100%; width:100%;">
                        <div style="width:40%; display:flex; flex-direction:column;">${leftHTML}</div>
                        <div style="width:1px; background:#7f9db9; margin: 0 4px; height:100%;"></div>
                        <div style="width:55%; display:flex; flex-direction:column;">${rightHTML}</div>
                    </div>
                `;

            } else {
                // TAB 3: Guild Terms
                contentHTML = `
                    <div style="flex:1; display:flex; flex-direction:column; overflow-y:auto; padding-right:4px;">
                        ${this.getBankGuidelinesHTML()}
                    </div>
                `;
            }

            this._dndContainer.innerHTML = `
                <div class="cc-pockets-spread">
                    <!-- XP Tabs Navigation -->
                    <div class="xp-tabs">
                        <div class="xp-tab ${this._activeTab === 'transact' ? 'active' : ''}" onclick="SceneManager._scene.switchXPTab('transact')">
                            ${T('BankLoan.ui.depositsWithdrawals')}
                        </div>
                        <div class="xp-tab ${this._activeTab === 'loans' ? 'active' : ''}" onclick="SceneManager._scene.switchXPTab('loans')">
                            ${T('BankLoan.ui.loansLiabilities')}
                        </div>
                        <div class="xp-tab ${this._activeTab === 'terms' ? 'active' : ''}" onclick="SceneManager._scene.switchXPTab('terms')">
                            ${T('BankLoan.ui.regulatoryTerms')}
                        </div>
                    </div>

                    <!-- XP Tab Page Container -->
                    <div class="cc-page">
                        ${contentHTML}
                    </div>

                    <!-- Footer Bar -->
                    <div style="margin-top:4px; border-top:1px solid #7f9db9; padding-top:6px; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#555; width:100%;">
                        <span>${T('BankLoan.ui.navHint')}</span>
                        <div class="back-button btn-stamp" onclick="SceneManager._scene.popScene()" style="padding:2px 12px; cursor:pointer;">
                            ${T('BankLoan.ui.dismiss')}
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        const useItalian = ConfigManager.language === 'it';
        const bankBalance = $gameSystem.getBankBalance();
        const loanBalance = $gameSystem.getLoanBalance();
        const loanDueDate = $gameSystem.getLoanDueDate();
        const currentDay = $gameSystem._currentDay || 0;
        const daysLeft = loanDueDate - currentDay;
        const gold = $gameParty.gold();

        const isAmountActive = this._amountWindow && this._amountWindow.active;
        const currentAmount = isAmountActive ? this._amountWindow.amount() : 0;
        const maxAmount = isAmountActive ? this._amountWindow._maxAmount : 0;
        const activeMode = isAmountActive ? this._amountWindow._mode : "";

        const selectedIndex = this._commandWindow ? this._commandWindow.index() : 0;

        let leftPageHTML = this.getBankPocketsHTML(selectedIndex, gold, bankBalance, loanBalance, daysLeft);
        let rightPageHTML = "";

        if (isAmountActive) {
            rightPageHTML = this.getTransactionDeedHTML(activeMode, currentAmount, maxAmount);
        } else {
            rightPageHTML = this.getBankGuidelinesHTML();
        }

        this._dndContainer.innerHTML = `
            <div class="cc-pockets-spread" style="width: 1400px; height: 900px;">
                <!-- Spine Shading -->
                <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 32px; height: 100%; background: linear-gradient(90deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.35) 50%, rgba(0, 0, 0, 0.15) 100%); pointer-events: none; z-index: 10;"></div>

                <!-- Left Page -->
                <div class="cc-page cc-page-left" style="padding: 28px 36px; display: flex; flex-direction: column; width:50%; box-sizing: border-box;">
                    ${leftPageHTML}
                </div>

                <!-- Right Page -->
                <div class="cc-page cc-page-right" style="padding: 28px 36px; display: flex; flex-direction: column; width:50%; box-sizing: border-box;">
                    ${rightPageHTML}
                </div>
            </div>
        `;
    };

    Scene_BankSystem.prototype.getBankPocketsHTML = function (selectedIndex, gold, bankBalance, loanBalance, daysLeft) {
        const useItalian = ConfigManager.language === 'it';
        const commands = [
            { symbol: "deposit", label: T('BankLoan.ui.depositFunds2') },
            { symbol: "withdraw", label: T('BankLoan.ui.withdrawFunds2') },
            { symbol: "loan", label: T('BankLoan.ui.petitionDebtDeed') },
            { symbol: "repay", label: T('BankLoan.ui.repayOutstandingLoan') },
            { symbol: "cancel", label: T('BankLoan.ui.dismissPockets') }
        ];

        let commandListHTML = "";
        commands.forEach((cmd, idx) => {
            const isSelected = idx === selectedIndex && (!this._amountWindow || !this._amountWindow.active);

            const itemStyle = `
                cursor: pointer;
                padding: 10px 14px;
                margin-bottom: 6px;
                border: 2px solid ${isSelected ? '#8b5a2b' : 'rgba(139, 90, 43, 0.15)'};
                background: ${isSelected ? 'rgba(74, 29, 15, 0.08)' : '#fcf8f0'};
                border-radius: 6px;
                font-family: 'Lora', serif;
                font-size: 1rem;
                font-weight: bold;
                color: ${isSelected ? '#4a1d0f' : '#5c4b3d'};
                transition: all 0.2s ease;
                text-align: center;
                box-shadow: ${isSelected ? '0 3px 6px rgba(74,29,15,0.15)' : 'none'};
            `;

            commandListHTML += `
                <div class="bank-command focusable" style="${itemStyle}" onclick="SceneManager._scene.selectBankCommand(${idx})">
                    ${cmd.label}
                </div>
            `;
        });

        return `
            <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:12px; text-align:center;">
                ${T('BankLoan.ui.monetaryAccountPockets')}
            </h2>

            <div style="border: 2px solid rgba(139,90,43,0.3); background: #faf4e8; border-radius: 6px; padding: 14px; margin-bottom: 12px; font-family:'Lora', serif; font-size:0.9rem; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px;">
                    <span style="color:#5c3516; font-weight:bold;">${T('BankLoan.ui.personalHoldings')}:</span>
                    <span style="font-family:'Lora', serif; font-weight:bold; color:#4a1d0f;">€${(gold / 100).toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px;">
                    <span style="color:#5c3516; font-weight:bold;">${T('BankLoan.ui.bankBalance')}:</span>
                    <span style="font-family:'Lora', serif; font-weight:bold; color:#3d5e4b;">€${(bankBalance / 100).toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px; font-size:0.8rem; color:#6b5242; font-style:italic;">
                    <span>${T('BankLoan.ui.depositYieldRate')}:</span>
                    <span>${T('BankLoan.ui.ratePerDays', { rate: (interestRate * 100).toFixed(1), days: interestInterval })}</span>
                </div>

                <div style="margin-top: 4px; border-top: 1px dashed rgba(139,90,43,0.3); padding-top: 6px; display:flex; flex-direction:column; gap:4px;">
                    <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px; color:${loanBalance > 0 ? '#822d2d' : 'inherit'}; font-weight:${loanBalance > 0 ? 'bold' : 'normal'};">
                        <span>${T('BankLoan.ui.outstandingGuildDebt')}:</span>
                        <span style="font-family:'Lora', serif;">€${(loanBalance / 100).toFixed(2)}</span>
                    </div>
                    ${loanBalance > 0 ? `
                    <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px; font-size:0.8rem; color:#822d2d;">
                        <span>${T('BankLoan.ui.debtMaturityTerm')}:</span>
                        <span>${daysLeft} days left</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px; font-size:0.8rem; color:#6b5242;">
                        <span>${T('BankLoan.ui.interestPremiumRate')}:</span>
                        <span>${(loanInterestRate * 100).toFixed(1)}%</span>
                    </div>
                    ` : `
                    <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px; font-size:0.8rem; color:#6b5242;">
                        <span>${T('BankLoan.ui.maxDebtLimit')}:</span>
                        <span>€${(maxLoanAmount / 100).toFixed(2)}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.2); padding-bottom:2px; font-size:0.8rem; color:#6b5242;">
                        <span>${T('BankLoan.ui.maturityStandard')}:</span>
                        <span>${loanDuration} days</span>
                    </div>
                    `}
                </div>
            </div>

            <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
                ${commandListHTML}
            </div>
        `;
    };

    Scene_BankSystem.prototype.getTransactionDeedHTML = function (activeMode, currentAmount, maxAmount) {
        const useItalian = ConfigManager.language === 'it';
        let title = "";
        let description = "";

        switch (activeMode.toLowerCase()) {
            case "deposit":
                title = T('BankLoan.ui.depositFunds2');
                description = T('BankLoan.ui.authorizeTheTransferOfHoldings');
                break;
            case "withdraw":
                title = T('BankLoan.ui.withdrawFunds2');
                description = T('BankLoan.ui.submitAPetitionToRelease');
                break;
            case "loan":
                title = T('BankLoan.ui.loanPetition');
                description = T('BankLoan.ui.petitionForAStandardDebt');
                break;
            case "repay":
                title = T('BankLoan.ui.debtRetirement');
                description = T('BankLoan.ui.transferPersonalCoinToRetire');
                break;
        }

        if (this._isAppMode) {
            return `
                <h2 class="cc-header-gothic" style="text-align:center;">
                    ${title}
                </h2>

                <div style="flex:1; display:flex; flex-direction:column; gap:8px; box-sizing: border-box; width:100%;">
                    <div style="border: 1px solid #7f9db9; background: #fcfcfc; padding: 12px; border-radius: 3px; display:flex; flex-direction:column; gap:8px; box-sizing: border-box; width:100%;">
                        <div style="font-size:11px; font-style:italic; line-height:1.35; color:#555; border-bottom:1px dashed #ccc; padding-bottom:6px; text-align:center;">
                            "${description}"
                        </div>

                        <div style="display:flex; flex-direction:column; align-items:center; gap:2px; margin: 4px 0;">
                            <span style="font-size:9px; text-transform:uppercase; color:#0b2f70; font-weight:bold;">
                                ${T('BankLoan.ui.proposedTransactionBalance')}
                            </span>
                            <div style="font-size:22px; font-weight:bold; color:#0054e3; line-height:1.1;">
                                €${(currentAmount / 100).toFixed(2)}
                            </div>
                            <span style="font-size:10px; color:#666;">
                                ${T('BankLoan.ui.permittedThreshold')}: €${(maxAmount / 100).toFixed(2)}
                            </span>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
                            <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(-1000)">
                                - €10.00
                            </div>
                            <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(1000)">
                                + €10.00
                            </div>
                            <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(-100)">
                                - €1.00
                            </div>
                            <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(100)">
                                + €1.00
                            </div>
                            <div class="btn-stamp focusable btn-max" onclick="SceneManager._scene.adjustAmount(${maxAmount}, true)" style="grid-column: span 2;">
                                ${T('BankLoan.ui.proposeMaximumThreshold')}
                            </div>
                        </div>
                    </div>
                </div>

                <div style="margin-top:auto; border-top:1px solid #7f9db9; padding-top:8px; display:flex; flex-direction:column; gap:4px; box-sizing:border-box; width:100%;">
                    <div class="action-button focusable" onclick="SceneManager._scene.confirmTransaction()">
                        ${T('BankLoan.ui.confirmTransaction')}
                    </div>
                    <div class="action-button focusable" onclick="SceneManager._scene.cancelTransaction()" style="background:#e1e1e1 !important; color:#000 !important; border-color:#7f9db9 !important;">
                        ${T('BankLoan.ui.voidApplication')}
                    </div>
                </div>
            `;
        }

        return `
            <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:12px; text-align:center;">
                ${title}
            </h2>

            <div style="flex:1; display:flex; flex-direction:column; gap:12px; font-family:'Lora', serif; box-sizing: border-box; width:100%;">
                <div style="border: 4px double #4a2711; background: #ecdcb9; padding: 18px; border-radius: 6px; box-shadow: inset 0 0 40px rgba(78,38,12,0.15); display:flex; flex-direction:column; gap:10px; box-sizing: border-box; width:100%;">
                    <div style="font-size:0.85rem; font-style:italic; line-height:1.4; color:#2b1c11; border-bottom:1px dashed rgba(139,90,43,0.25); padding-bottom:8px; text-align:center;">
                        "${description}"
                    </div>

                    <div style="display:flex; flex-direction:column; align-items:center; gap:4px; margin: 6px 0;">
                        <span style="font-size:0.75rem; text-transform:uppercase; color:#5c3516; letter-spacing:1px;">
                            ${T('BankLoan.ui.proposedTransactionBalance')}
                        </span>
                        <div style="font-family:'Lora', serif; font-size:2.4rem; font-weight:bold; color:#4a1d0f; text-shadow:1px 1px 1px rgba(255,255,255,0.8); line-height:1.1;">
                            €${(currentAmount / 100).toFixed(2)}
                        </div>
                        <span style="font-size:0.7rem; color:#6b5242; font-style:italic;">
                            ${T('BankLoan.ui.permittedThreshold')}: €${(maxAmount / 100).toFixed(2)}
                        </span>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                        <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(-1000)" style="background:#8b5a2b; color:#ecdcb9; padding:6px; border-radius:4px; font-size:0.8rem; font-weight:bold; text-align:center; border:1px solid #4a2711; cursor:pointer; transition: all 0.2s ease;">
                            - €10.00
                        </div>
                        <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(1000)" style="background:#8b5a2b; color:#ecdcb9; padding:6px; border-radius:4px; font-size:0.8rem; font-weight:bold; text-align:center; border:1px solid #4a2711; cursor:pointer; transition: all 0.2s ease;">
                            + €10.00
                        </div>
                        <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(-100)" style="background:#8b5a2b; color:#ecdcb9; padding:6px; border-radius:4px; font-size:0.8rem; font-weight:bold; text-align:center; border:1px solid #4a2711; cursor:pointer; transition: all 0.2s ease;">
                            - €1.00
                        </div>
                        <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(100)" style="background:#8b5a2b; color:#ecdcb9; padding:6px; border-radius:4px; font-size:0.8rem; font-weight:bold; text-align:center; border:1px solid #4a2711; cursor:pointer; transition: all 0.2s ease;">
                            + €1.00
                        </div>
                        <div class="btn-stamp focusable" onclick="SceneManager._scene.adjustAmount(${maxAmount}, true)" style="grid-column: span 2; background:#5c3516; color:#ecdcb9; padding:8px; border-radius:4px; font-size:0.85rem; font-weight:bold; text-align:center; border:1px solid #301107; cursor:pointer; text-transform:uppercase; font-family:'Lora', serif; transition: all 0.2s ease;">
                            ${T('BankLoan.ui.proposeMaximumThreshold')}
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-top:auto; border-top:1px dashed rgba(139, 90, 43, 0.4); padding-top:12px; display:flex; flex-direction:column; gap:8px; box-sizing:border-box; width:100%;">
                <div class="action-button focusable" onclick="SceneManager._scene.confirmTransaction()" style="background:#4a1d0f; color:#ecdcb9; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer; text-align:center; border:2px solid #301107; text-transform:uppercase; font-family:'Lora', serif; font-size:1.05rem; box-shadow:0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
                    ${T('BankLoan.ui.sealTransactionVoucher')}
                </div>
                <div class="action-button focusable" onclick="SceneManager._scene.cancelTransaction()" style="background:#8b5a2b; color:#ecdcb9; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer; text-align:center; border:1px solid #4a2711; text-transform:uppercase; font-family:'Lora', serif; font-size:0.9rem; transition: all 0.2s ease;">
                    ${T('BankLoan.ui.voidApplication')}
                </div>
            </div>
        `;
    };

    Scene_BankSystem.prototype.getBankGuidelinesHTML = function () {
        const useItalian = ConfigManager.language === 'it';

        if (this._isAppMode) {
            return `
                <h2 class="cc-header-gothic" style="text-align:center;">
                    ${T('BankLoan.ui.imperialDepositStatutes')}
                </h2>

                <div style="flex:1; display:flex; flex-direction:column; gap:8px; line-height:1.4; font-size:11px; text-align:justify; color:#333;">
                    <p style="margin:0;">
                        ${T('BankLoan.ui.welcomeToTheImperialVault')}
                    </p>

                    <div style="border-top:1px dashed #ccc; border-bottom:1px dashed #ccc; padding:6px 0; display:flex; flex-direction:column; gap:2px; font-weight:bold; color:#0b2f70;">
                        <div>• ${T('BankLoan.ui.allDebtsNotRetiredWithin')}</div>
                        <div>• ${T('BankLoan.ui.standardDepositYieldsDynamicallyRespond')}</div>
                    </div>

                    <p style="margin:0;">
                        ${T('BankLoan.ui.selectTheDesiredTabAbove')}
                    </p>
                </div>
            `;
        }

        return `
            <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:12px; text-align:center;">
                ${T('BankLoan.ui.imperialDepositStatutes')}
            </h2>

            <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:16px; font-family:'Lora', serif; line-height:1.55; text-align:justify; color:#3d2f24; padding:0 10px;">
                <p style="margin:0; font-size:0.9rem;">
                    ${T('BankLoan.ui.welcomeToTheImperialVault')}
                </p>

                <div style="border-top:1px dashed rgba(139,90,43,0.3); border-bottom:1px dashed rgba(139,90,43,0.3); padding:8px 0; width:100%; display:flex; flex-direction:column; gap:4px; font-size:0.8rem; font-style:italic; color:#4a1d0f;">
                    <div>• ${T('BankLoan.ui.allDebtsNotRetiredWithin')}</div>
                    <div>• ${T('BankLoan.ui.standardDepositYieldsDynamicallyRespond')}</div>
                </div>

                <p style="margin:0; font-size:0.9rem;">
                    ${T('BankLoan.ui.selectTheDesiredFinancialAction')}
                </p>
            </div>
        `;
    };

    Scene_BankSystem.prototype.selectBankCommand = function (index) {
        if (this._commandWindow) {
            this._commandWindow.select(index);
            SoundManager.playOk();
            this._commandWindow.callOkHandler();
            this.refreshUIBankDOM();
        }
    };

    Scene_BankSystem.prototype.adjustAmount = function (value, isSet = false) {
        if (this._amountWindow && this._amountWindow.active) {
            let amt = isSet ? value : this._amountWindow.amount() + value;
            amt = Math.max(0, Math.min(amt, this._amountWindow._maxAmount));
            this._amountWindow._amount = amt;
            SoundManager.playCursor();
            this.refreshUIBankDOM();
        }
    };

    Scene_BankSystem.prototype.confirmTransaction = function () {
        if (this._amountWindow && this._amountWindow.active) {
            this._amountWindow.processOk();
            this.refreshUIBankDOM();
        }
    };

    Scene_BankSystem.prototype.cancelTransaction = function () {
        if (this._amountWindow && this._amountWindow.active) {
            this._amountWindow.processCancel();
            this.refreshUIBankDOM();
        }
    };

    Scene_BankSystem.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);

        if (this._dndContainer) {
            let moved = false;
            const isAmountActive = this._amountWindow && this._amountWindow.active;

            if (this._isAppMode) {
                if (!isAmountActive) {
                    if (Input.isTriggered('pageup') || this.isKeyPressed('KeyQ')) {
                        const tabs = ['transact', 'loans', 'terms'];
                        const idx = tabs.indexOf(this._activeTab);
                        const nextTab = tabs[(idx - 1 + tabs.length) % tabs.length];
                        this.switchXPTab(nextTab);
                        moved = true;
                    } else if (Input.isTriggered('pagedown') || this.isKeyPressed('KeyE')) {
                        const tabs = ['transact', 'loans', 'terms'];
                        const idx = tabs.indexOf(this._activeTab);
                        const nextTab = tabs[(idx + 1) % tabs.length];
                        this.switchXPTab(nextTab);
                        moved = true;
                    } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                        SoundManager.playCancel();
                        this.popScene();
                        return;
                    }
                } else {
                    if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
                        this.adjustAmount(-100);
                        moved = true;
                    } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
                        this.adjustAmount(100);
                        moved = true;
                    } else if (Input.isTriggered('left') || Input.isRepeated('left') || this.isKeyPressed('KeyA')) {
                        this.adjustAmount(-1000);
                        moved = true;
                    } else if (Input.isTriggered('right') || Input.isRepeated('right') || this.isKeyPressed('KeyD')) {
                        this.adjustAmount(1000);
                        moved = true;
                    } else if (Input.isTriggered('ok')) {
                        this.confirmTransaction();
                        moved = true;
                    } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                        this.cancelTransaction();
                        moved = true;
                    }
                }
            } else {
                if (!isAmountActive && this._commandWindow) {
                    if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
                        const currentIndex = this._commandWindow.index();
                        const maxItems = this._commandWindow.maxItems();
                        if (maxItems > 0) {
                            const nextIndex = currentIndex < maxItems - 1 ? currentIndex + 1 : 0;
                            this._commandWindow.select(nextIndex);
                            moved = true;
                        }
                    } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
                        const currentIndex = this._commandWindow.index();
                        const maxItems = this._commandWindow.maxItems();
                        if (maxItems > 0) {
                            const prevIndex = currentIndex > 0 ? currentIndex - 1 : maxItems - 1;
                            this._commandWindow.select(prevIndex);
                            moved = true;
                        }
                    } else if (Input.isTriggered('ok')) {
                        SoundManager.playOk();
                        this._commandWindow.callOkHandler();
                        moved = true;
                    } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                        SoundManager.playCancel();
                        this.popScene();
                    }
                } else if (isAmountActive && this._amountWindow) {
                    if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
                        this.adjustAmount(-100);
                        moved = true;
                    } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
                        this.adjustAmount(100);
                        moved = true;
                    } else if (Input.isTriggered('left') || Input.isRepeated('left') || this.isKeyPressed('KeyA')) {
                        this.adjustAmount(-1000);
                        moved = true;
                    } else if (Input.isTriggered('right') || Input.isRepeated('right') || this.isKeyPressed('KeyD')) {
                        this.adjustAmount(1000);
                        moved = true;
                    } else if (Input.isTriggered('ok')) {
                        this.confirmTransaction();
                        moved = true;
                    } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                        this.cancelTransaction();
                        moved = true;
                    }
                }
            }

            if (moved) {
                this.refreshUIBankDOM();
            }
        }
    };

    Scene_BankSystem.prototype.isKeyPressed = function (key) {
        return Input._currentState[key] && !Input._previousState[key];
    };

})();