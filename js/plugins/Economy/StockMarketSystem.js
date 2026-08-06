/*:
 * @plugindesc Stock Market System v3.0 - Unified Single-Page  Trading Terminal.
 * @author Omni-Lex (Preset Options Only Version), updated by OmniLex, modified for direct gold and parchment overlays
 * 
 * @param Initial Oil Price
 * @desc Starting price for oil stocks (in cents, e.g., 10000 = €100.00)
 * @default 10000
 * 
 * @param Initial SOUL Price
 * @desc Starting price for souls stocks (in cents, e.g., 66666 = €666.66)
 * @default 66666
 * 
 * @param SOUL Median Price
 * @desc Target median price for SOUL stocks that prices will gravitate towards (in cents)
 * @default 66666
 * 
 * @param Volatility
 * @desc Base volatility for stocks. Oil is much higher internally.
 * @default 0.2
 * 
 * @param Update Interval
 * @desc How often the stocks update in milliseconds
 * @default 2000
 * 
 * @param History Length
 * @desc Number of price points to keep in history
 * @default 50
 * 
 * @param Minimum Price
 * @desc A final safety floor for all stock prices (in cents).
 * @default 1000
 * 
 * @param Oil Shares Variable
 * @desc Variable ID to store OIL shares count (0 = disabled)
 * @default 51
 * 
 * @param Soul Shares Variable
 * @desc Variable ID to store SOUL shares count (0 = disabled)
 * @default 52
 * 
 * @param Soul Median Variable
 * @desc Variable ID to control SOUL median price (0 = disabled, uses plugin parameter)
 * @default 53
 * 
 * @command OpenStockMarket
 * @desc Opens the stock market screen
 */

(function () {
  "use strict";

  //=============================================================================
  // Plugin Parameters
  //=============================================================================

  const pluginName = "StockMarketSystem";
  const parameters = PluginManager.parameters(pluginName);

  const initialOilPrice = Number(parameters["Initial Oil Price"]) || 30000;
  const initialSoulsPrice = Number(parameters["Initial SOUL Price"]) || 66666;
  const volatility = Number(parameters["Volatility"]) || 0.2;
  const updateInterval = Number(parameters["Update Interval"]) || 2000;
  const historyLength = Number(parameters["History Length"]) || 50;
  const minimumPrice = Number(parameters["Minimum Price"]) || 1000;
  const oilSharesVariableId = Number(parameters["Oil Shares Variable"]) || 51;
  const soulSharesVariableId = Number(parameters["Soul Shares Variable"]) || 52;
  const soulMedianVariableId = Number(parameters["Soul Median Variable"]) || 53;

  // Copy lives in js/i18n/<lang>/plugins/StockMarket.json.
  const _smi18n = (path, vars) => T('StockMarket.' + path, vars || {});


  //=============================================================================
  // Money Formatting Helpers
  //=============================================================================

  function formatMoney(cents) {
    const euros = Math.floor(cents / 100);
    const centsPart = cents % 100;
    return `€${euros}.${centsPart.toString().padStart(2, "0")}`;
  }

  function getPlayerGoldInCents() {
    return $gameParty.gold();
  }

  function goldToEurosForDisplay(gold) {
    return formatMoney(gold);
  }

  //=============================================================================
  // Variable Synchronization Helpers
  //=============================================================================

  function getOilSharesFromVariable() {
    if (oilSharesVariableId > 0 && $dataSystem && $gameVariables) {
      const value = $gameVariables.value(oilSharesVariableId);
      return Math.max(0, Number(value) || 0);
    }
    return 0;
  }

  function getSoulSharesFromVariable() {
    if (soulSharesVariableId > 0 && $dataSystem && $gameVariables) {
      const value = $gameVariables.value(soulSharesVariableId);
      return Math.max(0, Number(value) || 0);
    }
    return 0;
  }

  function getSoulMedianFromVariable() {
    if (soulMedianVariableId > 0 && $dataSystem && $gameVariables) {
      const value = $gameVariables.value(soulMedianVariableId);
      const medianValue = Number(value) || 0;
      return medianValue > 0 ? medianValue : 66666;
    }
    return 66666;
  }

  function setOilSharesVariable(shares) {
    if (oilSharesVariableId > 0 && $gameVariables) {
      $gameVariables.setValue(oilSharesVariableId, shares);
    }
  }

  function setSoulSharesVariable(shares) {
    if (soulSharesVariableId > 0 && $gameVariables) {
      $gameVariables.setValue(soulSharesVariableId, shares);
    }
  }

  //=============================================================================
  // Stock Market System - Core Class
  //=============================================================================

  class StockMarketSystem {
    constructor() {
      this.initialize();
    }

    initialize() {
      this._oilShares = getOilSharesFromVariable();
      this._soulsShares = getSoulSharesFromVariable();

      // Cost basis (total gold actually paid for the currently held shares).
      // Lets the Assets pockets show "bought value" alongside current vault value.
      this._oilCostBasis = 0;
      this._soulsCostBasis = 0;

      this._oilHistory = this.generateRandomHistory(initialOilPrice, historyLength, "oil");
      this._soulsHistory = this.generateRandomHistory(initialSoulsPrice, historyLength, "souls");
      this._oilPrice = this._oilHistory[this._oilHistory.length - 1];
      this._soulsPrice = this._soulsHistory[this._soulsHistory.length - 1];
      this._updateCounter = 0;
      this._lastUpdateTime = 0;
      // The price series is world-shared (same market for every savegame of a
      // world). Adopt the world's stored prices if it already has some.
      this.loadWorldMarket();
    }

    // Prices/history are world state (shared across savegames of a world), so
    // they live in save/worlds/<name>/market.json via WorldManager rather than
    // in the binary save. Shares owned and cost basis stay party-private (see
    // toJSON below).
    _worldMarketAvailable() {
      return !!(window.WorldManager && typeof window.WorldManager.getField === "function");
    }

    syncWorldMarket() {
      if (!this._worldMarketAvailable()) return;
      const WM = window.WorldManager;
      WM.setField("market", "oilPrice", this._oilPrice);
      WM.setField("market", "soulsPrice", this._soulsPrice);
      WM.setField("market", "oilHistory", this._oilHistory);
      WM.setField("market", "soulsHistory", this._soulsHistory);
      WM.setField("market", "updateCounter", this._updateCounter);
    }

    loadWorldMarket() {
      if (!this._worldMarketAvailable()) return;
      const WM = window.WorldManager;
      const oilHist = WM.getField("market", "oilHistory");
      const soulHist = WM.getField("market", "soulsHistory");
      if (Array.isArray(oilHist) && oilHist.length) {
        this._oilHistory = oilHist.map(Number);
        const p = WM.getField("market", "oilPrice");
        this._oilPrice = p !== undefined ? Number(p) : this._oilHistory[this._oilHistory.length - 1];
      }
      if (Array.isArray(soulHist) && soulHist.length) {
        this._soulsHistory = soulHist.map(Number);
        const p = WM.getField("market", "soulsPrice");
        this._soulsPrice = p !== undefined ? Number(p) : this._soulsHistory[this._soulsHistory.length - 1];
      }
      const uc = WM.getField("market", "updateCounter");
      if (uc !== undefined) this._updateCounter = Number(uc);
    }

    // Binary save keeps only party-private holdings. Prices/history are stored
    // in the world folder (see syncWorldMarket).
    toJSON() {
      return {
        oilShares: this._oilShares,
        soulsShares: this._soulsShares,
        oilCostBasis: this._oilCostBasis,
        soulsCostBasis: this._soulsCostBasis,
      };
    }

    fromJSON(jsonObj) {
      if (!jsonObj) return;

      const savedOilShares = jsonObj.oilShares !== undefined ? Number(jsonObj.oilShares) : 0;
      const savedSoulShares = jsonObj.soulsShares !== undefined ? Number(jsonObj.soulsShares) : 0;
      const variableOilShares = getOilSharesFromVariable();
      const variableSoulShares = getSoulSharesFromVariable();

      this._oilShares = variableOilShares > 0 ? variableOilShares : savedOilShares;
      this._soulsShares = variableSoulShares > 0 ? variableSoulShares : savedSoulShares;

      setOilSharesVariable(this._oilShares);
      setSoulSharesVariable(this._soulsShares);

      this._oilCostBasis = jsonObj.oilCostBasis !== undefined ? Number(jsonObj.oilCostBasis) : 0;
      this._soulsCostBasis = jsonObj.soulsCostBasis !== undefined ? Number(jsonObj.soulsCostBasis) : 0;
      // Back-compat: adopt prices from an old binary save that still carried
      // them, then hand them to the world store. New prices come from the world.
      if (jsonObj.updateCounter !== undefined) this._updateCounter = Number(jsonObj.updateCounter);
      if (jsonObj.oilPrice !== undefined) this._oilPrice = Number(jsonObj.oilPrice);
      if (jsonObj.soulsPrice !== undefined) this._soulsPrice = Number(jsonObj.soulsPrice);
      if (Array.isArray(jsonObj.oilHistory)) this._oilHistory = jsonObj.oilHistory.map(Number);
      if (Array.isArray(jsonObj.soulsHistory)) this._soulsHistory = jsonObj.soulsHistory.map(Number);
      this._lastUpdateTime = 0;
      // Prefer the world's shared prices when present; otherwise seed the world
      // with whatever we have.
      this.loadWorldMarket();
      this.syncWorldMarket();
    }

    update() {
      if (!this._lastUpdateTime) {
        this._lastUpdateTime = Date.now();
        return false;
      }
      if (Date.now() - this._lastUpdateTime >= updateInterval) {
        this._lastUpdateTime = Date.now();
        this.updatePrices();
        return true;
      }
      return false;
    }

    updatePrices() {
      this._oilPrice = this.generateNewPrice(this._oilPrice, "oil");
      this._soulsPrice = this.generateNewPrice(this._soulsPrice, "souls");
      this._oilHistory.push(this._oilPrice);
      if (this._oilHistory.length > historyLength) this._oilHistory.shift();
      this._soulsHistory.push(this._soulsPrice);
      if (this._soulsHistory.length > historyLength) this._soulsHistory.shift();
      this._updateCounter++;
      // Persist the new prices to the world store so every savegame of this
      // world sees the same market (WorldManager.flush writes it on save).
      this.syncWorldMarket();
    }

    generateNewPrice(currentPrice, stockType) {
      let newPrice;

      if (stockType === "souls") {
        const targetPrice = getSoulMedianFromVariable();
        const reversionStrength = 0.1;
        const fluctuation = (Math.random() - 0.5) * 500;
        const pullToMean = (targetPrice - currentPrice) * reversionStrength;
        newPrice = currentPrice + pullToMean + fluctuation;
      } else {
        const minPrice = 3000;
        const maxPrice = 80000;
        const centerPrice = (minPrice + maxPrice) / 2;
        const reversionStrength = 0.01;

        const pullToCenter = (centerPrice - currentPrice) * reversionStrength;
        const randomWalk = (Math.random() - 0.5) * (currentPrice * volatility * 2.5);

        // The simulated world tilts the market (NPCWorldWeb): settlement
        // booms/busts, epidemics and national economy mood become sentiment
        // drift, and bad times make crashes likelier than rallies.
        const sentiment = window.NPCWorldWeb?.marketSentiment?.() ?? 0;
        const sentimentDrift = currentPrice * 0.02 * sentiment;

        let shock = 0;
        if (Math.random() < 0.05) {
          const upChance = 0.5 + sentiment * 0.3;
          shock = (Math.random() < upChance ? 1 : -1) * currentPrice * 0.2;
        }

        newPrice = currentPrice + pullToCenter + randomWalk + sentimentDrift + shock;
        newPrice = Math.max(minPrice, Math.min(newPrice, maxPrice));
      }

      newPrice = Math.max(newPrice, minimumPrice);
      return Math.round(newPrice);
    }

    getOilPrice() { return this._oilPrice; }
    getSoulsPrice() { return this._soulsPrice; }
    getOilShares() { return this._oilShares; }
    getSoulsShares() { return this._soulsShares; }

    // Trading teaches on the money actually made, not on the money moved: a
    // position closed at a loss taught the market something, but not the
    // trader. Uses the cost basis already tracked per commodity, so what is
    // rewarded is realized profit (Stock Trading, specialization 259).
    _trainOnRealizedProfit(revenueInGold, costBasis, sharesHeld, sharesSold) {
      if (!window.SpecializationXP) return;
      const avgCost = sharesHeld > 0 ? (costBasis || 0) / sharesHeld : 0;
      const profit = revenueInGold - avgCost * sharesSold;
      if (profit > 0) {
        window.SpecializationXP.awardForValue('Stock Trading', profit);
      }
    }

    buyOil(shares) {
      if (shares <= 0) return false;
      const costInGold = Math.round(shares * this._oilPrice);
      if (costInGold <= $gameParty.gold()) {
        $gameParty.loseGold(costInGold);
        this._oilShares += shares;
        this._oilCostBasis = (this._oilCostBasis || 0) + costInGold;
        setOilSharesVariable(this._oilShares);
        return true;
      }
      return false;
    }

    sellOil(shares) {
      if (shares > 0 && shares <= this._oilShares) {
        const revenueInGold = Math.round(shares * this._oilPrice);
        $gameParty.gainGold(revenueInGold);
        this._trainOnRealizedProfit(revenueInGold, this._oilCostBasis, this._oilShares, shares);
        // Drop the average cost basis of the sold shares.
        this._oilCostBasis = this._oilShares > 0
          ? (this._oilCostBasis || 0) * (1 - shares / this._oilShares)
          : 0;
        this._oilShares -= shares;
        setOilSharesVariable(this._oilShares);
        return true;
      }
      return false;
    }

    buySouls(shares) {
      if (shares <= 0) return false;
      const costInGold = Math.round(shares * this._soulsPrice);
      if (costInGold <= $gameParty.gold()) {
        $gameParty.loseGold(costInGold);
        this._soulsShares += shares;
        this._soulsCostBasis = (this._soulsCostBasis || 0) + costInGold;
        setSoulSharesVariable(this._soulsShares);
        return true;
      }
      return false;
    }

    sellSouls(shares) {
      if (shares > 0 && shares <= this._soulsShares) {
        const revenueInGold = Math.round(shares * this._soulsPrice);
        $gameParty.gainGold(revenueInGold);
        this._trainOnRealizedProfit(revenueInGold, this._soulsCostBasis, this._soulsShares, shares);
        this._soulsCostBasis = this._soulsShares > 0
          ? (this._soulsCostBasis || 0) * (1 - shares / this._soulsShares)
          : 0;
        this._soulsShares -= shares;
        setSoulSharesVariable(this._soulsShares);
        return true;
      }
      return false;
    }

    generateRandomHistory(basePrice, length, stockType) {
      const history = [];
      let currentPrice = basePrice;
      const minOilPrice = 3000;
      const maxOilPrice = 80000;

      for (let i = 0; i < length; i++) {
        if (stockType === "souls") {
          const targetPrice = getSoulMedianFromVariable();
          const reversionStrength = 0.1;
          const fluctuation = (Math.random() - 0.5) * 500;
          currentPrice += (targetPrice - currentPrice) * reversionStrength + fluctuation;
        } else {
          const centerPrice = (minOilPrice + maxOilPrice) / 2;
          const pullToCenter = (centerPrice - currentPrice) * 0.01;
          const randomWalk = (Math.random() - 0.5) * (currentPrice * volatility * 2.5);
          currentPrice += pullToCenter + randomWalk;
          if (Math.random() < 0.05) {
            currentPrice *= 1 + (Math.random() - 0.5) * 0.2;
          }
          currentPrice = Math.max(minOilPrice, Math.min(currentPrice, maxOilPrice));
        }
        history.push(Math.round(currentPrice));
      }
      return history;
    }

    getOilHistory() { return this._oilHistory; }
    getSoulsHistory() { return this._soulsHistory; }

    // Total gold paid for the currently held shares (0 if untracked, e.g. shares
    // granted directly via the share variables rather than bought in-market).
    getOilCostBasis() { return Math.round(this._oilCostBasis || 0); }
    getSoulsCostBasis() { return Math.round(this._soulsCostBasis || 0); }

    getNetWorthFormatted() {
      return formatMoney(
        getPlayerGoldInCents() +
        Math.round(this._oilShares * this._oilPrice) +
        Math.round(this._soulsShares * this._soulsPrice)
      );
    }

    checkBankruptcy() { }

    syncWithVariables() {
      if (oilSharesVariableId > 0) {
        const variableOilShares = getOilSharesFromVariable();
        if (variableOilShares !== this._oilShares) {
          this._oilShares = Math.max(0, variableOilShares);
        }
      }
      if (soulSharesVariableId > 0) {
        const variableSoulShares = getSoulSharesFromVariable();
        if (variableSoulShares !== this._soulsShares) {
          this._soulsShares = Math.max(0, variableSoulShares);
        }
      }
    }

    getCurrentSoulMedian() { return getSoulMedianFromVariable(); }
  }


  //=============================================================================
  // Game_System Integration
  //=============================================================================

  const _Game_System_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function () {
    _Game_System_initialize.call(this);
    this.stockMarket = new StockMarketSystem();
  };

  const _Game_System_onAfterLoad = Game_System.prototype.onAfterLoad;
  Game_System.prototype.onAfterLoad = function () {
    if (_Game_System_onAfterLoad) _Game_System_onAfterLoad.call(this);
    // Capture the loaded plain object BEFORE replacing the field (the old code
    // overwrote it first, then fed the fresh instance to itself, wiping shares).
    const saved = this.stockMarket;
    this.stockMarket = new StockMarketSystem();
    this.stockMarket.fromJSON(saved);
  };

  // Push current prices into the world store during save serialization so
  // WorldManager.flush() (which runs after) persists market.json.
  const _SM_DataManager_makeSaveContents = DataManager.makeSaveContents;
  DataManager.makeSaveContents = function () {
    if ($gameSystem && $gameSystem.stockMarket && $gameSystem.stockMarket.syncWorldMarket) {
      $gameSystem.stockMarket.syncWorldMarket();
    }
    return _SM_DataManager_makeSaveContents.call(this);
  };

  const _SceneManager_updateScene = SceneManager.updateScene;
  SceneManager.updateScene = function () {
    _SceneManager_updateScene.call(this);
    if (
      this._scene &&
      $gameSystem &&
      $gameSystem.stockMarket &&
      $gameSystem.stockMarket.update &&
      $gameSystem.stockMarket.update() &&
      this._scene instanceof Scene_StockMarket
    ) {
      this._scene.refreshUIStock();
    }
  };

  const _Game_Variables_setValue = Game_Variables.prototype.setValue;
  Game_Variables.prototype.setValue = function (variableId, value) {
    _Game_Variables_setValue.call(this, variableId, value);
    if ($gameSystem && $gameSystem.stockMarket) {
      if (variableId === oilSharesVariableId || variableId === soulSharesVariableId) {
        $gameSystem.stockMarket.syncWithVariables();
      }
    }
  };


  // ============================================================================
  // Scene_StockMarket
  // ============================================================================
  // --- HypernetStockApp ---
  window.HypernetStockApp = {
    appInstance: null,
    win: null,
    launch: function(params) {
      if (!window.HypernetWindowManager) return;
      
      if (!this.win || !document.getElementById('app-stock-market')) {
        this.win = window.HypernetWindowManager.createWindow({
          id: 'app-stock-market',
          title: T('StockMarket.appName'),
          icon: 229,
          width: 980,
          height: 620,
          contentHTML: '<div id="stock-market-content" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #ece9d8;"></div>'
        });

        this.appInstance = new Scene_StockMarket();
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
        if ($gameSystem && $gameSystem.stockMarket && $gameSystem.stockMarket.update()) {
          this.appInstance.refreshUIStock();
        }
        if (this.win.classList.contains('active')) {
          this.appInstance.update();
        }
      }
    }
  };

  // ============================================================================
  // Scene_StockMarket
  // ============================================================================
  class Scene_StockMarket extends Scene_MenuBase {
    constructor() {
      super();
      this._activeTab = 'buy';
      this._selectedAsset = 'oil';
      this._expanded = false;

      this._activeArea = 'tabs';
      this._selectedQtyIndex = 0;
      this._prevPrices = { oil: initialOilPrice, souls: initialSoulsPrice };
    }

    create() {
      super.create();
      // Name the skill this menu runs on while it is open.
      if (window.SpecBadge) window.SpecBadge.show('Stock Trading');  // i18n-ignore  Specialization.json id
      this.createHelpWindow();
      this.createInfoWindow();
      this.createCommandWindow();
      this.createSelectionWindow();
      this.createAmountWindow();

      if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
      if (this._infoWindow) { this._infoWindow.hide(); }
      if (this._commandWindow) { this._commandWindow.deactivate(); this._commandWindow.hide(); }
      if (this._selectionWindow) { this._selectionWindow.deactivate(); this._selectionWindow.hide(); }
      if (this._amountWindow) { this._amountWindow.deactivate(); this._amountWindow.hide(); }

      const stockMarket = $gameSystem.stockMarket;
      this._prevPrices.oil = stockMarket.getOilPrice();
      this._prevPrices.souls = stockMarket.getSoulsPrice();

      this.initUIStockDOM();
      this.refreshUIStock();
    }

    update() {
      // Standalone scene: drive navigation with RPG Maker Input.
      // Inside HypernetOS the desktop owns keyboard / controller / mouse focus
      // (the trade widgets are .focusable), so the internal Input loop is
      // skipped to avoid both systems reacting to the same arrow press.
      if (!this._isAppMode) {
        super.update();
        this.updateUIStockInput();
      }
    }

    terminate() {
      const container = document.getElementById("stock-container");
      if (container) container.remove();
      if (!this._isAppMode) super.terminate();
    }

    initUIStockDOM() {


      if (this._isAppMode) {
        const parent = document.getElementById("stock-market-content");
        if (parent) {
          const container = document.createElement("div");
          container.id = "stock-container";
          parent.appendChild(container);
          return;
        }
      }

      if (!document.getElementById("stock-container")) {
        const container = document.createElement("div");
        container.id = "stock-container";
        document.body.appendChild(container);
      }
    }

    refreshUIStock() {
      const container = document.getElementById("stock-container");
      if (!container) return;

      const stockMarket = $gameSystem.stockMarket;
      const lang = ConfigManager.language || 'en';
      const isIt = lang === 'it';

      const currentOil = stockMarket.getOilPrice();
      const currentSouls = stockMarket.getSoulsPrice();

      const deltaOil = currentOil - this._prevPrices.oil;
      const deltaSouls = currentSouls - this._prevPrices.souls;

      const pctOil = this._prevPrices.oil > 0 ? (deltaOil / this._prevPrices.oil) * 100 : 0;
      const pctSouls = this._prevPrices.souls > 0 ? (deltaSouls / this._prevPrices.souls) * 100 : 0;

      const badgeOilHTML = this.getBadgeHTML(currentOil, deltaOil, pctOil);
      const badgeSoulsHTML = this.getBadgeHTML(currentSouls, deltaSouls, pctSouls);

      const tabBuyActive = this._activeTab === 'buy' ? 'active' : '';
      const tabSellActive = this._activeTab === 'sell' ? 'active' : '';

      const tabsHTML = `
        <div class="roster-tabs">
            <div class="roster-tab focusable ${tabBuyActive}" id="tab-buy" tabindex="0">${isIt ? "ACQUISISCI BENI" : "ACQUIRE ASSETS"}</div>
            <div class="roster-tab focusable ${tabSellActive}" id="tab-sell" tabindex="0">${isIt ? "LIQUIDA BENI" : "LIQUIDATE ASSETS"}</div>
        </div>
      `;

      const moneyLabel = T('StockMarket.portfolio.liquid');
      const worthLabel = T('StockMarket.portfolio.netWorth');

      const portfolioHTML = `
        <div class="portfolio-header">
            <div class="portfolio-card">
                <div class="card-lbl">${moneyLabel}</div>
                <div class="card-val">${goldToEurosForDisplay(getPlayerGoldInCents())}</div>
            </div>
            <div class="portfolio-card">
                <div class="card-lbl">${worthLabel}</div>
                <div class="card-val" style="color: #27ae60;">${stockMarket.getNetWorthFormatted()}</div>
            </div>
        </div>
      `;

      const summaryHTML = `
        <div class="portfolio-card" style="text-align: left; padding: 10px 14px; background: rgba(0,0,0,0.03); border: 1px solid #7f9db9; box-shadow: none; flex: 1; display:flex; flex-direction:column; justify-content:center;">
            <div class="card-lbl" style="border-bottom: 1px dashed #7f9db9; padding-bottom: 4px; margin-bottom: 8px; font-weight: bold; color: #0b2f70; font-size: 11px;">
                ${isIt ? "RESOCONTO PORTAFOGLIO" : "PORTFOLIO POCKETS SUMMARY"}
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color:#000;">
                <span style="font-weight: 500;">${T('StockMarket.ui.oilTether')}</span>
                <span style="font-weight: bold; color: #0b2f70;">${stockMarket.getOilShares()} ${T('StockMarket.commands.shares')} (${formatMoney(Math.round(stockMarket.getOilShares() * stockMarket.getOilPrice()))})</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color:#000;">
                <span style="font-weight: 500;">${T('StockMarket.ui.soulCrystal')}</span>
                <span style="font-weight: bold; color: #0b2f70;">${stockMarket.getSoulsShares()} ${T('StockMarket.commands.shares')} (${formatMoney(Math.round(stockMarket.getSoulsShares() * stockMarket.getSoulsPrice()))})</span>
            </div>
        </div>
      `;

      const oilExpanded = this._selectedAsset === 'oil' && this._expanded ? 'expanded' : '';
      const soulsExpanded = this._selectedAsset === 'souls' && this._expanded ? 'expanded' : '';

      const oilFocused = this._activeArea === 'assets' && this._selectedAsset === 'oil' ? 'focused' : '';
      const soulsFocused = this._activeArea === 'assets' && this._selectedAsset === 'souls' ? 'focused' : '';

      const oilQtyGridHTML = this.getQuantityGridHTML('oil');
      const soulsQtyGridHTML = this.getQuantityGridHTML('souls');

      const assetsHTML = `
        <div class="asset-row focusable ${oilFocused} ${oilExpanded}" id="row-oil" tabindex="0">
            <div class="asset-main">
                <span class="asset-name">${_smi18n('stockNames.oil')} <span class="asset-qty">(${stockMarket.getOilShares()} ${isIt ? "quote" : "shares"})</span></span>
                <span class="asset-value">${formatMoney(Math.round(stockMarket.getOilShares() * stockMarket.getOilPrice()))}</span>
            </div>
            <div class="quantity-expansion">
                ${oilQtyGridHTML}
            </div>
        </div>
        <div class="asset-row focusable ${soulsFocused} ${soulsExpanded}" id="row-souls" tabindex="0">
            <div class="asset-main">
                <span class="asset-name">${_smi18n('stockNames.souls')} <span class="asset-qty">(${stockMarket.getSoulsShares()} ${isIt ? "quote" : "shares"})</span></span>
                <span class="asset-value">${formatMoney(Math.round(stockMarket.getSoulsShares() * stockMarket.getSoulsPrice()))}</span>
            </div>
            <div class="quantity-expansion">
                ${soulsQtyGridHTML}
            </div>
        </div>
      `;

      container.innerHTML = `
        <div class="stock-spread">
            <div class="stock-top">
                <h2 class="stock-title">${isIt ? "PROIETTORE QUANTISTICO" : "QUANTUM TRADING PROJECTOR"}</h2>
                <div class="graph-box">
                    <canvas id="stock-canvas" width="940" height="146"></canvas>
                    <div class="stock-legend">
                        <div class="legend-item"><span class="legend-color" style="background:#2ecc71;"></span>${isIt ? "Petrolio" : "Oil Tether"}</div>
                        <div class="legend-item"><span class="legend-color" style="background:#9b59b6;"></span>${isIt ? "Anime" : "Soul Crystal"}</div>
                        <div class="legend-item"><span class="legend-color" style="border-top: 1px dashed rgba(155, 89, 182, 0.6); width: 14px; height: 1px;"></span>${isIt ? "Median Soul Target" : "Soul Median Target"}</div>
                    </div>
                </div>
                <div class="stock-prices-footer">
                    ${badgeOilHTML}
                    ${badgeSoulsHTML}
                </div>
            </div>
            
            <div class="stock-bottom">
                <div class="portfolio-pane">
                    <h3 class="stock-title">${isIt ? "BILANCIO & CASSA" : "POCKETS STATUS PORTFOLIO"}</h3>
                    ${portfolioHTML}
                    ${summaryHTML}
                </div>
                
                <div class="trade-pane">
                    <h3 class="stock-title">${isIt ? "NEGOZIO TITOLI" : "ACQUISITION & TRADE DECK"}</h3>
                    ${tabsHTML}
                    <div style="flex:1; overflow-y:auto; padding-right:4px;">
                        ${assetsHTML}
                    </div>
                </div>
            </div>
        </div>
      `;

      this.paintStockGraph();

      const tabBuy = container.querySelector("#tab-buy");
      if (tabBuy) {
        tabBuy.addEventListener("click", () => {
          this._activeTab = 'buy';
          this._expanded = false;
          this._activeArea = 'tabs';
          SoundManager.playOk();
          this.refreshUIStock();
        });
      }

      const tabSell = container.querySelector("#tab-sell");
      if (tabSell) {
        tabSell.addEventListener("click", () => {
          this._activeTab = 'sell';
          this._expanded = false;
          this._activeArea = 'tabs';
          SoundManager.playOk();
          this.refreshUIStock();
        });
      }

      const rowOil = container.querySelector("#row-oil");
      if (rowOil) {
        rowOil.addEventListener("click", (e) => {
          if (e.target.closest(".qty-btn")) return;
          this._selectedAsset = 'oil';
          this._expanded = !this._expanded;
          this._activeArea = 'assets';
          this._selectedQtyIndex = 0;
          SoundManager.playOk();
          this.refreshUIStock();
        });
      }

      const rowSouls = container.querySelector("#row-souls");
      if (rowSouls) {
        rowSouls.addEventListener("click", (e) => {
          if (e.target.closest(".qty-btn")) return;
          this._selectedAsset = 'souls';
          this._expanded = !this._expanded;
          this._activeArea = 'assets';
          this._selectedQtyIndex = 0;
          SoundManager.playOk();
          this.refreshUIStock();
        });
      }

      const qtyBtns = container.querySelectorAll(".qty-btn");
      qtyBtns.forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.classList.contains("disabled")) {
            SoundManager.playBuzzer();
            return;
          }
          const val = btn.getAttribute("data-val");
          const asset = btn.getAttribute("data-asset");
          this.executeUITransaction(asset, val);
        });
      });
    }

    getBadgeHTML(price, delta, percent) {
      const isUp = delta >= 0;
      const arrow = isUp ? '▲' : '▼';
      const color = isUp ? '#27ae60' : '#e74c3c';
      const deltaText = `${isUp ? '+' : ''}${percent.toFixed(1)}%`;
      return `
        <div class="ticker-badge">
            <span>${formatMoney(price)}</span>
            <span style="color:${color}; font-size:11px;">${arrow} ${deltaText}</span>
        </div>
      `;
    }

    getQuantityGridHTML(asset) {
      const stockMarket = $gameSystem.stockMarket;
      const isOil = asset === 'oil';
      const price = isOil ? stockMarket.getOilPrice() : stockMarket.getSoulsPrice();
      const currentShares = isOil ? stockMarket.getOilShares() : stockMarket.getSoulsShares();
      const gold = getPlayerGoldInCents();
      const isIt = ConfigManager.language === 'it';

      let quantities = [1, 5, 10, 25, 50, 100, 250, 500];
      if (this._activeTab === 'sell') {
        quantities = [1, 5, 10, 25, 50, 100, 250, 'all'];
      }

      let gridHTML = "";
      quantities.forEach((qty, index) => {
        let enabled = true;
        let subText = "";
        let displayQty = qty;

        if (this._activeTab === 'buy') {
          const cost = Math.round(qty * price);
          subText = formatMoney(cost);
          enabled = gold >= cost;
        } else {
          if (qty === 'all') {
            displayQty = isIt ? "TUTTO" : "ALL";
            subText = formatMoney(Math.round(currentShares * price));
            enabled = currentShares > 0;
          } else {
            subText = formatMoney(Math.round(qty * price));
            enabled = currentShares >= qty;
          }
        }

        const isFocused = this._activeArea === 'quantities' && this._selectedAsset === asset && this._selectedQtyIndex === index ? 'focused' : '';
        const disabledClass = enabled ? '' : 'disabled';

        gridHTML += `
          <div class="qty-btn focusable ${disabledClass} ${isFocused}" id="qty-${asset}-${index}" data-val="${qty}" data-asset="${asset}" tabindex="0">
              <span>${qty === 'all' ? displayQty : `+${qty}`}</span>
              <span class="qty-btn-sub">${subText}</span>
          </div>
        `;
      });

      return gridHTML;
    }

    paintStockGraph() {
      const canvas = document.getElementById("stock-canvas");
      if (!canvas) return;

      const box = canvas.parentElement;
      if (box && this._isAppMode) {
        canvas.width = box.clientWidth || 940;
        canvas.height = box.clientHeight - 24;
      }

      const ctx = canvas.getContext("2d");

      const stockMarket = $gameSystem.stockMarket;
      const oilHistory = stockMarket.getOilHistory();
      const soulsHistory = stockMarket.getSoulsHistory();

      const allValues = [...oilHistory, ...soulsHistory];
      if (allValues.length === 0) return;

      const min = Math.min(...allValues) * 0.92;
      const max = Math.max(...allValues) * 1.08;

      const padLeft = 60;
      const padRight = 20;
      const padTop = 20;
      const padBottom = 20;

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const gy = padTop + (h - padTop - padBottom) * (i / 5);
        ctx.beginPath();
        ctx.moveTo(padLeft, gy);
        ctx.lineTo(w - padRight, gy);
        ctx.stroke();

        const priceLabelVal = max - (max - min) * (i / 5);
        ctx.fillStyle = "#555555";
        ctx.font = "9px Tahoma";
        ctx.textAlign = "right";
        ctx.fillText(formatMoney(Math.round(priceLabelVal)), padLeft - 8, gy + 3);
      }

      const currentMedian = stockMarket.getCurrentSoulMedian();
      if (currentMedian >= min && currentMedian <= max) {
        const medianY = padTop + (h - padTop - padBottom) - (((currentMedian - min) / (max - min)) * (h - padTop - padBottom));
        ctx.strokeStyle = "rgba(155, 89, 182, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padLeft, medianY);
        ctx.lineTo(w - padRight, medianY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      this.drawTrendline(ctx, oilHistory, "#2ecc71", min, max, w, h, padLeft, padRight, padTop, padBottom);
      this.drawTrendline(ctx, soulsHistory, "#9b59b6", min, max, w, h, padLeft, padRight, padTop, padBottom);
    }

    drawTrendline(ctx, history, color, min, max, w, h, padL, padR, padT, padB) {
      if (!history || history.length < 2) return;

      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      ctx.beginPath();
      const points = history.map((price, i) => {
        const px = padL + i * (plotW / (history.length - 1));
        const py = padT + plotH - (((price - min) / (max - min)) * plotH || 0);
        return { x: px, y: py };
      });

      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.lineTo(points[points.length - 1].x, padT + plotH);
      ctx.lineTo(points[0].x, padT + plotH);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, color.replace(")", ", 0.15)").replace("rgb", "rgba").replace("#2ecc71", "rgba(46,204,113,0.15)").replace("#9b59b6", "rgba(155,89,182,0.15)"));
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    updateUIStockInput() {
      // L1/R1 cycle buy/sell tabs from anywhere in the scene
      if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
        this._activeTab = this._activeTab === 'buy' ? 'sell' : 'buy';
        this._expanded = false;
        SoundManager.playCursor();
        this.refreshUIStock();
        return;
      }
      if (this._activeArea === 'tabs') {
        if (Input.isRepeated('right')) {
          this._activeTab = 'sell';
          this._expanded = false;
          SoundManager.playCursor();
          this.refreshUIStock();
        } else if (Input.isRepeated('left')) {
          this._activeTab = 'buy';
          this._expanded = false;
          SoundManager.playCursor();
          this.refreshUIStock();
        } else if (Input.isRepeated('down')) {
          this._activeArea = 'assets';
          this._selectedAsset = 'oil';
          SoundManager.playCursor();
          this.refreshUIStock();
        } else if (Input.isTriggered('ok')) {
          this._activeArea = 'assets';
          this._selectedAsset = 'oil';
          SoundManager.playOk();
          this.refreshUIStock();
        } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
          if (!this._isAppMode) {
            this.popScene();
            SoundManager.playCancel();
          }
        }
      } else if (this._activeArea === 'assets') {
        if (Input.isRepeated('up')) {
          if (this._selectedAsset === 'oil') {
            this._activeArea = 'tabs';
          } else {
            this._selectedAsset = 'oil';
          }
          SoundManager.playCursor();
          this.refreshUIStock();
        } else if (Input.isRepeated('down')) {
          if (this._selectedAsset === 'oil') {
            this._selectedAsset = 'souls';
            SoundManager.playCursor();
            this.refreshUIStock();
          }
        } else if (Input.isTriggered('ok')) {
          this._expanded = true;
          this._activeArea = 'quantities';
          this._selectedQtyIndex = 0;
          SoundManager.playOk();
          this.refreshUIStock();
        } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
          this._activeArea = 'tabs';
          this._expanded = false;
          SoundManager.playCancel();
          this.refreshUIStock();
        }
      } else if (this._activeArea === 'quantities') {
        const maxQtyIndex = 7;
        if (Input.isRepeated('right')) {
          this._selectedQtyIndex = (this._selectedQtyIndex + 1) % (maxQtyIndex + 1);
          SoundManager.playCursor();
          this.refreshUIStock();
        } else if (Input.isRepeated('left')) {
          this._selectedQtyIndex = (this._selectedQtyIndex - 1 + maxQtyIndex + 1) % (maxQtyIndex + 1);
          SoundManager.playCursor();
          this.refreshUIStock();
        } else if (Input.isTriggered('ok')) {
          const qtyValues = [1, 5, 10, 25, 50, 100, 250, this._activeTab === 'sell' ? 'all' : 500];
          const qty = qtyValues[this._selectedQtyIndex];

          const stockMarket = $gameSystem.stockMarket;
          const isOil = this._selectedAsset === 'oil';
          const price = isOil ? stockMarket.getOilPrice() : stockMarket.getSoulsPrice();
          const currentShares = isOil ? stockMarket.getOilShares() : stockMarket.getSoulsShares();
          const gold = getPlayerGoldInCents();

          let enabled = true;
          if (this._activeTab === 'buy') {
            enabled = gold >= Math.round(qty * price);
          } else {
            enabled = qty === 'all' ? currentShares > 0 : currentShares >= qty;
          }

          if (enabled) {
            this.executeUITransaction(this._selectedAsset, qty);
          } else {
            SoundManager.playBuzzer();
          }
        } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
          this._activeArea = 'assets';
          this._expanded = false;
          SoundManager.playCancel();
          this.refreshUIStock();
        }
      }
    }

    executeUITransaction(asset, val) {
      const stockMarket = $gameSystem.stockMarket;
      let success = false;
      const isOil = asset === 'oil';

      this._prevPrices.oil = stockMarket.getOilPrice();
      this._prevPrices.souls = stockMarket.getSoulsPrice();

      if (this._activeTab === 'buy') {
        const qty = parseInt(val);
        success = isOil ? stockMarket.buyOil(qty) : stockMarket.buySouls(qty);
      } else {
        if (val === 'all') {
          const qty = isOil ? stockMarket.getOilShares() : stockMarket.getSoulsShares();
          success = isOil ? stockMarket.sellOil(qty) : stockMarket.sellSouls(qty);
        } else {
          const qty = parseInt(val);
          success = isOil ? stockMarket.sellOil(qty) : stockMarket.sellSouls(qty);
        }
      }

      if (success) {
        SoundManager.playShop();
      } else {
        SoundManager.playBuzzer();
      }
      this.refreshUIStock();
    }

    createHelpWindow() {
      const rect = new Rectangle(0, this.mainAreaTop(), Graphics.boxWidth, this.calcWindowHeight(1, false));
      this._helpWindow = new Window_Help(rect);
      this.addWindow(this._helpWindow);
    }
    createInfoWindow() {
      const rect = new Rectangle(0, 0, 100, 100);
      this._infoWindow = new Window_StockInfo(rect);
      this.addWindow(this._infoWindow);
    }
    createCommandWindow() {
      const rect = new Rectangle(0, 0, 100, 100);
      this._commandWindow = new Window_StockCommand(rect);
      this.addWindow(this._commandWindow);
    }
    createSelectionWindow() {
      const rect = new Rectangle(0, 0, 100, 100);
      this._selectionWindow = new Window_StockSelection(rect);
      this.addWindow(this._selectionWindow);
    }
    createAmountWindow() {
      const rect = new Rectangle(0, 0, 100, 100);
      this._amountWindow = new Window_StockAmount(rect);
      this.addWindow(this._amountWindow);
    }
    activateCommandWindow() { }
    refreshDynamicWindows() { }
  }

  window.Scene_StockMarket = Scene_StockMarket;


  // ============================================================================
  // STUB COMPATIBILITY WINDOW CLASSES
  // ============================================================================
  class Window_StockInfo extends Window_Base {
    refresh() { }
  }
  class Window_StockGraph extends Window_Base {
    refresh() { }
  }
  class Window_StockCommand extends Window_HorzCommand {
    makeCommandList() { }
  }
  class Window_StockSelection extends Window_Command {
    setMode() { }
    setTitle() { }
  }
  class Window_StockAmount extends Window_Command {
    setMode() { }
    setTitle() { }
  }


  // ============================================================================
  // PLUGIN COMMANDS & REGISTRATIONS
  // ============================================================================
  PluginManager.registerCommand(pluginName, "OpenStockMarket", () => {
    if ($gameSystem && !$gameSystem.stockMarket.update) {
      $gameSystem.stockMarket = new StockMarketSystem();
    }
    if (window.HypernetOS && SceneManager._scene instanceof Scene_HypernetOS) {
      window.HypernetStockApp.launch();
    } else {
      SceneManager.push(Scene_StockMarket);
    }
  });

  if (window.HypernetOS) {
    window.HypernetOS.registerApp({
      id: 'app-stock-market',
      name: T('StockMarket.appName'),
      icon: 229,
      launchFn: function() {
        if ($gameSystem && !$gameSystem.stockMarket.update) {
          $gameSystem.stockMarket = new StockMarketSystem();
        }
        if (window.HypernetStockApp) {
          window.HypernetStockApp.launch();
        } else {
          SceneManager.push(Scene_StockMarket);
        }
      },
      desktopShortcut: true
    });
  }

  const _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function (command, args) {
    _Game_Interpreter_pluginCommand.call(this, command, args);
    if (command === "OpenStockMarket") {
      if ($gameSystem && !$gameSystem.stockMarket.update) {
        $gameSystem.stockMarket = new StockMarketSystem();
      }
      if (window.HypernetOS && SceneManager._scene instanceof Scene_HypernetOS) {
        window.HypernetStockApp.launch();
      } else {
        SceneManager.push(Scene_StockMarket);
      }
    }
  };
})();