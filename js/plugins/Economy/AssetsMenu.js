/*:
 * @target MZ
 * @plugindesc Assets Pockets v1.0.0 - Parchment portfolio overlay: properties, stocks, bank, loans + live oil/soul graph.
 * @author Esoteric Heavy Industries
 * @help AssetsMenu.js
 *
 * Adds a Scene_AssetsMenu opened from the "Assets" command in the main menu
 * (CustomMainMenuLayout.js). Styled after ItemSystemInventoryUI.js as a
 * double-page parchment book-spread.
 *
 * Left page  : portfolio summary (cash, bank, net worth, debt) + a scrollable
 *              pockets of every owned asset with its current vault value and the
 *              value it was bought for.
 * Right page : a live oil / soul-crystal price graph (mirrors the stock market)
 *              over the detail card of the selected asset.
 *
 * Data sources (all read-only):
 *  - StockMarketSystem.js : $gameSystem.stockMarket (oil/soul shares + history)
 *  - RealEstateMarket.js  : $gameSystem.realEstateData (owned properties)
 *  - ProceduralHouseSystem.js : window.ProceduralHouseSystem.listOwnedHouses()
 *  - BankLoanSystem.js    : $gameSystem.getBankBalance/getLoanBalance/getLoanDueDate
 *
 * Currency convention across the project: 100 gold = 1.00 EUR.
 *
 * Load AFTER StockMarketSystem, RealEstateMarket, ProceduralHouseSystem,
 * BankLoanSystem and CustomMainMenuLayout.
 */

(function () {
  'use strict';

  // Extend RPG Maker's default gold cap (99,999,999). With 100 gold = €1 the
  // vanilla cap tops out at ~€1M, which the CEO start and share fortunes blow
  // straight through. Lift it to €10 billion so large portfolios cash out cleanly.
  const MAX_GOLD = 1000000000000; // 1e12 gold = €10,000,000,000
  Game_Party.prototype.maxGold = function () { return MAX_GOLD; };

  // 100 gold = 1.00 EUR everywhere in the project.
  function euro(gold) {
    const g = Math.round(Number(gold) || 0);
    const neg = g < 0;
    const abs = Math.abs(g);
    const main = Math.floor(abs / 100);
    const cents = (abs % 100).toString().padStart(2, '0');
    return `${neg ? '-' : ''}€${main.toLocaleString()}.${cents}`;
  }

  function isItalian() {
    return ConfigManager.language === 'it';
  }

  // ===========================================================================
  // Asset gathering
  // ===========================================================================

  // Builds a flat, render-ready list of owned assets. Each entry:
  //   { cat, name, sub, value, bought, color, liability, details:[{label,val}] }
  // value/bought are in gold (cents). liability rows count negatively to net worth.
  function gatherAssets() {
    const it = isItalian();
    const assets = [];

    // --- Stocks ---
    const sm = $gameSystem && $gameSystem.stockMarket;
    if (sm && typeof sm.getOilShares === 'function') {
      const stocks = [
        { key: 'oil', name: 'OIL',
          shares: sm.getOilShares(), price: sm.getOilPrice(),
          bought: sm.getOilCostBasis ? sm.getOilCostBasis() : 0, color: '#2e7d32' },
        { key: 'souls', name: 'SOUL',
          shares: sm.getSoulsShares(), price: sm.getSoulsPrice(),
          bought: sm.getSoulsCostBasis ? sm.getSoulsCostBasis() : 0, color: '#7b3f9e' },
      ];
      stocks.forEach(s => {
        if (s.shares <= 0) return;
        const value = Math.round(s.shares * s.price);
        const hasBasis = s.bought > 0;
        assets.push({
          cat: T('Assets.ui.securities'),
          name: s.name,
          sub: `${s.shares} ${T('Assets.ui.shares')} @ ${euro(s.price)}`,
          value,
          bought: hasBasis ? s.bought : null,
          color: s.color,
          details: [
            { label: T('Assets.ui.shares2'), val: String(s.shares) },
            { label: T('Assets.ui.unitPrice'), val: euro(s.price) },
            { label: T('Assets.ui.vaultValue'), val: euro(value) },
            { label: T('Assets.ui.boughtValue'), val: hasBasis ? euro(s.bought) : (T('Assets.ui.untracked')) },
            ...(hasBasis ? [{ label: T('Assets.ui.profitLoss'),
              val: euro(value - s.bought), pnl: value - s.bought }] : []),
          ],
        });
      });
    }

    // --- Real estate (RealEstateMarket.js owned properties) ---
    const re = $gameSystem && $gameSystem.realEstateData;
    if (re && Array.isArray(re.properties) && Array.isArray(re.ownedProperties)) {
      re.ownedProperties.forEach(pid => {
        const prop = re.properties.find(p => p && p.id === pid);
        if (!prop) return;
        // Apply any active news price effects to derive the current vault value.
        let mult = 1;
        if (window.$newsManager && window.$newsManager.getActiveEffectsForLocation) {
          const effects = window.$newsManager.getActiveEffectsForLocation(prop.location) || [];
          effects.forEach(e => { mult *= (e.priceEffect || 1); });
        }
        const currentEuros = Math.floor(prop.price * mult);
        const value = currentEuros * 100;     // euros -> gold
        const bought = prop.price * 100;
        const rent = (prop.currentOccupants || 0) * (prop.rentPerOccupant || 0);
        assets.push({
          cat: T('Assets.ui.realEstate'),
          name: prop.name,
          sub: `${prop.location} • ${'★'.repeat(prop.stars)}`,
          value,
          bought,
          color: '#8b5a2b',
          details: [
            { label: T('Assets.ui.type'), val: prop.type },
            { label: T('Assets.ui.location'), val: prop.location },
            { label: T('Assets.ui.rating'), val: `${'★'.repeat(prop.stars)}${'☆'.repeat(5 - prop.stars)}` },
            { label: T('Assets.ui.vaultValue'), val: euro(value) },
            { label: T('Assets.ui.bookValue'), val: euro(bought) },
            { label: T('Assets.ui.occupancy'), val: `${prop.currentOccupants || 0} / ${prop.maxOccupants}` },
            { label: T('Assets.ui.dailyRent'), val: `€${rent.toLocaleString()}` },
          ],
        });
      });
    }

    // --- Rented properties (RealEstateMarket.js — player is a tenant, not the
    //     owner; no vault value, just a recurring monthly cost that is charged
    //     on the 1st of each in-game month, or the tenancy is repossessed) ---
    if (re && Array.isArray(re.properties) && Array.isArray(re.rentedProperties)) {
      re.rentedProperties.forEach(pid => {
        const prop = re.properties.find(p => p && p.id === pid);
        if (!prop) return;
        // Mirrors RealEstateMarket.js's RENT_MONTHLY_RATE (3% of base price/month).
        const monthlyCost = Math.max(1, Math.round(prop.price * 0.03)) * 100; // gold
        assets.push({
          cat: T('Assets.ui.rentals'),
          name: prop.name,
          sub: `${prop.location} • ${'★'.repeat(prop.stars)} • ${T('Assets.ui.monthlyRent')}`,
          value: monthlyCost,
          bought: null,
          color: '#a0764a',
          liability: true,
          details: [
            { label: T('Assets.ui.type'), val: prop.type },
            { label: T('Assets.ui.location'), val: prop.location },
            { label: T('Assets.ui.rating'), val: `${'★'.repeat(prop.stars)}${'☆'.repeat(5 - prop.stars)}` },
            { label: T('Assets.ui.monthlyRent2'), val: euro(monthlyCost) },
            { label: T('Assets.ui.status'), val: T('Assets.ui.rentedNotOwnedChargedEvery') },
          ],
        });
      });
    }

    // --- Procedural houses (ProceduralHouseSystem.js owned floors) ---
    if (window.ProceduralHouseSystem && typeof window.ProceduralHouseSystem.listOwnedHouses === 'function') {
      const houses = window.ProceduralHouseSystem.listOwnedHouses() || [];
      houses.forEach(h => {
        const floorTxt = h.floor > 0 ? ` • ${T('Assets.ui.floor')} ${h.floor}` : '';
        assets.push({
          cat: T('Assets.ui.properties'),
          name: `${h.mapName}${floorTxt}`,
          sub: `${T('Assets.ui.entrance')} X:${h.x} Y:${h.y}`,
          value: h.value,
          bought: h.value,
          color: '#5c7a3d',
          details: [
            { label: T('Assets.ui.entranceMap'), val: h.mapName },
            { label: T('Assets.ui.coordinates'), val: `X: ${h.x}, Y: ${h.y}` },
            { label: T('Assets.ui.floor'), val: String(h.floor) },
            { label: T('Assets.ui.mapId'), val: h.mapId != null ? String(h.mapId) : '—' },
            { label: T('Assets.ui.vaultValue'), val: euro(h.value) },
            { label: T('Assets.ui.boughtValue'), val: euro(h.value) },
          ],
        });
      });
    }

    // --- Companion residences (a recruited NPC's owned/resided procedural
    //     house, inherited on join — see NPCSystemParty.registerNPCHouse) ---
    if ($gameSystem && Array.isArray($gameSystem._npcInheritedHouses)) {
      $gameSystem._npcInheritedHouses.forEach(hh => {
        assets.push({
          cat: T('Assets.ui.residences'),
          name: hh.mapName || (T('Assets.ui.residence')),
          sub: T('Assets.ui.npcHome', { name: hh.npcName }),
          value: hh.value || 0,
          bought: 0,
          color: '#5c7a3d',
          details: [
            { label: T('Assets.ui.resident'), val: hh.npcName || '—' },
            { label: T('Assets.ui.map'), val: hh.mapName || '—' },
            { label: T('Assets.ui.mapId'), val: hh.mapId != null ? String(hh.mapId) : '—' },
            { label: T('Assets.ui.vaultValue'), val: euro(hh.value || 0) },
            { label: T('Assets.ui.buildRights'), val: T('Assets.ui.owner') },
          ],
        });
      });
    }

    // --- Company shareholdings (RealEstateMarket company exchange) ---
    if (window.AssetRegistry && typeof window.AssetRegistry.getHoldings === 'function') {
      const holdings = window.AssetRegistry.getHoldings() || [];
      holdings.forEach(c => {
        const pnl = c.value - c.costBasis;
        assets.push({
          cat: T('Assets.ui.equities'),
          name: c.name,
          sub: `${c.sharesOwned.toLocaleString()} ${T('Assets.ui.shares')} @ ${euro(c.price * 100)}`,
          value: c.value,
          bought: c.costBasis > 0 ? c.costBasis : null,
          color: c.color || '#7b3f9e',
          details: [
            { label: T('Assets.ui.sector'), val: c.sector || '—' },
            { label: T('Assets.ui.shares2'), val: c.sharesOwned.toLocaleString() },
            { label: T('Assets.ui.ownership'), val: `${c.ownershipPct.toFixed(2)}%` },
            { label: T('Assets.ui.unitPrice'), val: euro(c.price * 100) },
            { label: T('Assets.ui.vaultValue'), val: euro(c.value) },
            { label: T('Assets.ui.boughtValue'), val: c.costBasis > 0 ? euro(c.costBasis) : (T('Assets.ui.untracked')) },
            ...(c.costBasis > 0 ? [{ label: T('Assets.ui.profitLoss'), val: euro(pnl), pnl }] : []),
          ],
        });
      });
    }

    // --- Owned Places (registered Destinations) ---
    if (window.AssetRegistry && typeof window.AssetRegistry.getOwnedPlaces === 'function') {
      const places = window.AssetRegistry.getOwnedPlaces() || [];
      places.forEach(p => {
        const coords = p.base ? `X:${p.base.x} Y:${p.base.y}` : '—';
        // p.key is the Destinations.json key; the readable name of the place
        // lives in that entry's "name" field.
        const placeName = window.WorkSystem?.destinationName
          ? window.WorkSystem.destinationName(p.key) : p.key;
        assets.push({
          cat: T('Assets.ui.places'),
          name: placeName,
          sub: coords,
          value: p.value || 0,
          bought: null,
          color: '#4a7a8c',
          details: [
            { label: T('Assets.ui.location'), val: placeName },
            { label: T('Assets.ui.baseCoordinates'), val: coords },
            { label: T('Assets.ui.vaultValue'), val: euro(p.value || 0) },
          ],
        });
      });
    }

    // --- Livestock (AnimalGrowthSystem.js animals bought in the Build menu) ---
    if (window.AnimalGrowthSystem && typeof window.AnimalGrowthSystem.listOwnedAnimals === 'function') {
      const animals = window.AnimalGrowthSystem.listOwnedAnimals() || [];
      animals.forEach(a => {
        const produceRows = a.produces.map(p => ({
          label: p.name,
          val: p.ready
            ? (T('Assets.ui.ready'))
            : `${T('Assets.ui.in')} ${p.daysLeft} ${T('Assets.ui.d')} (×${p.yieldMin}–${p.yieldMax} / ${p.intervalDays}${T('Assets.ui.d')})`,
        }));
        assets.push({
          cat: T('Assets.ui.livestock'),
          name: `${a.animalId} (${a.stageName})`,
          sub: `${a.mapName} • X:${a.x} Y:${a.y}`,
          value: a.value,
          bought: a.paid > 0 ? a.paid : null,
          color: '#7a6a3d',
          animal: a,
          details: [
            { label: T('Assets.ui.species'), val: a.animalId },
            { label: T('Assets.ui.stage'), val: a.stageName },
            { label: T('Assets.ui.location'), val: a.mapName },
            { label: T('Assets.ui.coordinates'), val: `X: ${a.x}, Y: ${a.y}` },
            { label: T('Assets.ui.saleValue'), val: euro(a.value) },
            { label: T('Assets.ui.boughtValue'), val: a.paid > 0 ? euro(a.paid) : (T('Assets.ui.untracked')) },
            ...(a.stage === 'baby'
              ? [{ label: T('Assets.ui.growth'), val: `${a.growthPct}% (${T('Assets.ui.adultIn')} ~${a.daysToAdult} ${T('Assets.ui.days')})` }]
              : []),
            ...(produceRows.length ? produceRows : [{ label: T('Assets.ui.produce'), val: T('Assets.ui.none') }]),
          ],
        });
      });
    }

    // --- Diplomatic posts (ONUAssembly.js seats at the assembly) ---
    // A seat is not a thing the party owns, it is a wage a member draws, so it
    // is listed at its yearly value and never counted as a saleable holding.
    if (window.ONUAssembly && typeof window.ONUAssembly.listPosts === 'function') {
      const posts = window.ONUAssembly.listPosts() || [];
      posts.forEach(p => {
        assets.push({
          cat: T('Assets.ui.diplomacy'),
          name: T('Assets.ui.diplomatFor', { faction: p.factionName }),
          sub: `${p.actorName} • ${p.standingLabel}`,
          value: p.weeklyPay * 52,
          bought: null,
          color: '#4f6b8a',
          diplomat: p,
          details: [
            { label: T('Assets.ui.delegate'), val: p.actorName },
            { label: T('Assets.ui.delegation'), val: p.factionName },
            ...(p.leader ? [{ label: T('Assets.ui.headOfDelegation'), val: p.leader }] : []),
            ...(p.sg ? [] : [{ label: T('Assets.ui.standing'), val: `${p.standingLabel} (${p.standing})` }]),
            { label: T('Assets.ui.weeklyStipend'), val: euro(p.weeklyPay) },
            { label: T('Assets.ui.annualValue'), val: euro(p.weeklyPay * 52) },
            { label: T('Assets.ui.weeksServed'), val: String(p.weeksServed) },
          ],
        });
      });
    }

    // --- Bank deposit ---
    if ($gameSystem && typeof $gameSystem.getBankBalance === 'function') {
      const bal = $gameSystem.getBankBalance();
      if (bal > 0) {
        assets.push({
          cat: T('Assets.ui.bank'),
          name: T('Assets.ui.bankDeposit'),
          sub: T('Assets.ui.savingsAccount'),
          value: bal,
          bought: bal,
          color: '#b8860b',
          details: [
            { label: T('Assets.ui.balance'), val: euro(bal) },
          ],
        });
      }
    }

    // --- Loans (liability) ---
    if ($gameSystem && typeof $gameSystem.getLoanBalance === 'function') {
      const loan = $gameSystem.getLoanBalance();
      if (loan > 0) {
        const due = typeof $gameSystem.getLoanDueDate === 'function' ? $gameSystem.getLoanDueDate() : null;
        const curDay = $gameSystem._currentDay || 0;
        const daysLeft = due != null ? Math.max(0, due - curDay) : null;
        assets.push({
          cat: T('Assets.ui.liabilities'),
          name: T('Assets.ui.bankLoan'),
          sub: daysLeft != null ? `${T('Assets.ui.dueIn')} ${daysLeft} ${T('Assets.ui.days')}` : (T('Assets.ui.outstanding')),
          value: loan,
          bought: null,
          color: '#b3322b',
          liability: true,
          details: [
            { label: T('Assets.ui.balanceOwed'), val: euro(loan) },
            ...(daysLeft != null ? [{ label: T('Assets.ui.daysRemaining'), val: String(daysLeft) }] : []),
          ],
        });
      }
    }

    return assets;
  }

  // ===========================================================================
  // Scene_AssetsMenu
  // ===========================================================================

  class Scene_AssetsMenu extends Scene_MenuBase {
    create() {
      super.create();
      this._selIndex = 0;
      this._btnIndex = -1;   // cursor over the selected asset's action buttons
      this._confirmResign = null; // actorId whose seat is one press from being given up
      this._assets = [];
      this._lastOil = 0;
      this._lastSouls = 0;

      // WASD support (mirrors ItemSystemInventoryUI's robust listener approach).
      this._wasdQueued = { up: false, down: false };
      this._wasdListener = (event) => {
        if (event.repeat) return;
        const k = event.key.toLowerCase();
        if (k === 'w') { this._wasdQueued.up = true; event.preventDefault(); }
        if (k === 's') { this._wasdQueued.down = true; event.preventDefault(); }
      };
      window.addEventListener('keydown', this._wasdListener);

      this.createDOM();
    }

    createDOM() {
      this._container = document.createElement('div');
      this._container.id = 'menu-container';
      this._container.style.opacity = '0';
      this._container.style.transition = 'opacity 0.22s ease-out';
      document.body.appendChild(this._container);

      // Right-click anywhere exits, like the other parchment overlays.
      this._rightClickStartedHere = false;
      this._container.addEventListener('mousedown', (e) => {
        if (e.button === 2) { this._rightClickStartedHere = true; e.stopPropagation(); }
      });
      this._container.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this._rightClickStartedHere) return;
        this._rightClickStartedHere = false;
        SoundManager.playCancel();
        this.popScene();
      });

      this.refreshDOM();
      setTimeout(() => { if (this._container) this._container.style.opacity = '1'; }, 16);
    }

    refreshDOM() {
      if (!this._container) return;
      const it = isItalian();
      this._assets = gatherAssets();
      if (this._selIndex >= this._assets.length) this._selIndex = Math.max(0, this._assets.length - 1);
      this._btnIndex = -1;   // the rebuilt detail card starts with no button focused

      const sm = $gameSystem && $gameSystem.stockMarket;
      if (sm) { this._lastOil = sm.getOilPrice(); this._lastSouls = sm.getSoulsPrice(); }

      // Portfolio totals.
      const cash = $gameParty ? $gameParty.gold() : 0;
      let totalAssets = cash;
      let totalLiabilities = 0;
      this._assets.forEach(a => {
        if (a.liability) totalLiabilities += a.value; else totalAssets += a.value;
      });
      const netWorth = totalAssets - totalLiabilities;

      // ---- Left page: summary + pockets list ----
      const summaryCard = (lbl, val, color) => `
        <div class="assets-sum-card">
          <span class="assets-sum-lbl">${lbl}</span>
          <span class="assets-sum-val" style="color:${color}">${val}</span>
        </div>`;

      const summaryHTML = `
        <div class="assets-summary">
          ${summaryCard(T('Assets.ui.cash'), euro(cash), '#4a2711')}
          ${summaryCard(T('Assets.ui.assets'), euro(totalAssets), '#2e7d32')}
          ${summaryCard(T('Assets.ui.debt'), euro(totalLiabilities), '#b3322b')}
          ${summaryCard(T('Assets.ui.netWorth'), euro(netWorth), netWorth >= 0 ? '#1f6f3f' : '#b3322b')}
        </div>`;

      let listHTML = '';
      if (this._assets.length === 0) {
        listHTML = `<div class="assets-empty">${T('Assets.ui.noAssetsOwnedYetAcquire')}</div>`;
      } else {
        let lastCat = null;
        this._assets.forEach((a, idx) => {
          if (a.cat !== lastCat) {
            lastCat = a.cat;
            listHTML += `<div class="assets-cat-header">${a.cat}</div>`;
          }
          const sel = idx === this._selIndex ? 'selected' : '';
          const valColor = a.liability ? '#b3322b' : '#1f6f3f';
          const sign = a.liability ? '-' : '';
          listHTML += `
            <div class="item-slot assets-row ${sel}" onclick="SceneManager._scene.selectAsset(${idx})">
              <div class="assets-row-bar" style="background:${a.color}"></div>
              <div class="assets-row-info">
                <div class="assets-row-name">${a.name}</div>
                <div class="assets-row-sub">${a.sub}</div>
              </div>
              <div class="assets-row-vals">
                <span class="assets-row-val" style="color:${valColor}">${sign}${euro(a.value)}</span>
                ${a.bought != null ? `<span class="assets-row-bought">${T('Assets.ui.paid')} ${euro(a.bought)}</span>` : ''}
              </div>
            </div>`;
        });
      }

      const leftPageHTML = `
        <div class="left-page">
          <div class="page-header-bar">
            <div class="back-button" onclick="SceneManager._scene.popScene()">${T('Assets.ui.back')}</div>
            <h2 class="title">${T('Assets.ui.assets')}</h2>
          </div>
          ${summaryHTML}
          <div class="assets-list" id="assets-list">${listHTML}</div>
        </div>`;

      // ---- Right page: live graph + selected detail ----
      const rightPageHTML = `
        <div class="right-page">
          <div class="assets-graph-box">
            <div class="assets-graph-title">${T('Assets.ui.stockMarket')}</div>
            <canvas id="assets-graph" width="560" height="200"></canvas>
            <div class="assets-graph-legend">
              <div class="assets-legend-item"><span class="assets-legend-dot" style="background:#2ecc71"></span>OIL</div>
              <div class="assets-legend-item"><span class="assets-legend-dot" style="background:#9b59b6"></span>SOUL</div>
            </div>
          </div>
          <div class="assets-detail" id="assets-detail">${this.buildDetailHTML()}</div>
        </div>`;

      this._container.innerHTML = `<div class="book-spread">${leftPageHTML}${rightPageHTML}</div>`;

      this.paintGraph();
      this.paintAnimalSprite();
      this.scrollToSelected();
    }

    buildDetailHTML() {
      const it = isItalian();
      const a = this._assets[this._selIndex];
      if (!a) {
        return `<div class="assets-detail-empty">${T('Assets.ui.selectAnAssetFromThe')}</div>`;
      }
      const rows = a.details.map(d => {
        let style = '';
        if (d.pnl !== undefined) style = `color:${d.pnl >= 0 ? '#1f6f3f' : '#b3322b'};font-weight:bold;`;
        return `<div class="inspect-spec-row">
          <span class="inspect-spec-label">${d.label}:</span>
          <span class="inspect-spec-value" style="${style}">${d.val}</span>
        </div>`;
      }).join('');
      return `
        <div class="assets-detail-head" style="border-color:${a.color}">
          <h3 class="assets-detail-name">${a.name}</h3>
          <div class="assets-detail-cat" style="color:${a.color}">${a.cat}</div>
        </div>
        ${a.animal ? this.buildAnimalPortraitHTML(a.animal) : ''}
        <div class="inspect-section-title">${T('Assets.ui.pocketsDetail')}</div>
        ${rows}
        ${this.buildAssetActionsHTML(a)}`;
    }

    // Livestock gets its sprite drawn above the spec rows.
    buildAnimalPortraitHTML(animal) {
      return `<canvas class="ag-sprite-canvas" id="assets-animal-sprite"
        data-sprite="${animal.sprite}" data-stage="${animal.stage}"
        width="128" height="104"></canvas>`;
    }

    // Two asset classes can be acted on from here: livestock (collect what it
    // has made, sell it back, or take it out of the portfolio for good by
    // making it a pet) and a diplomatic seat (resign it). The buttons the
    // selected asset offers are declared once, in the order drawn: the markup,
    // the keyboard cursor and the pad confirm all read this one list.
    assetButtons(asset) {
      if (!asset) return [];
      if (asset.animal) {
        const animal = asset.animal;
        return [
          { key: 'collect', cls: '', label: T('Assets.ui.collect'), enabled: animal.hasReady },
          { key: 'sell', cls: ' ag-action-sell', label: `${T('Assets.ui.sell')} ${euro(animal.value)}`, enabled: true },
          { key: 'pet', cls: ' ag-action-pet', label: T('Assets.ui.makePet'), enabled: true },
        ];
      }
      if (asset.diplomat) {
        // Resigning is destructive and costly, so it asks once first.
        const armed = this._confirmResign === asset.diplomat.actorId;
        return [
          {
            key: 'resign',
            cls: ' ag-action-sell',
            label: armed ? T('Assets.ui.resignConfirm') : T('Assets.ui.resignPost'),
            enabled: true,
          },
        ];
      }
      return [];
    }

    buildAssetActionsHTML(asset) {
      const btns = this.assetButtons(asset);
      if (!btns.length) return '';
      const html = btns.map((b, i) => {
        const focus = i === this._btnIndex ? ' focused' : '';
        const dis = b.enabled ? '' : ' disabled';
        const click = b.enabled
          ? ` onclick="SceneManager._scene.runAssetAction('${b.key}')"` : '';
        return `<div class="ag-action-btn${b.cls}${focus}${dis}" data-btn="${i}"${click}>${b.label}</div>`;
      }).join('');
      return `<div class="ag-actions">${html}</div>`;
    }

    // Moves the button cursor over the enabled buttons of the selected asset.
    moveAssetButton(delta) {
      const a = this._assets[this._selIndex];
      const btns = this.assetButtons(a);
      const enabled = btns.map((b, i) => (b.enabled ? i : -1)).filter(i => i >= 0);
      if (enabled.length === 0) return false;
      const at = enabled.indexOf(this._btnIndex);
      const next = at < 0
        ? enabled[delta > 0 ? 0 : enabled.length - 1]
        : enabled[(at + delta + enabled.length) % enabled.length];
      this._btnIndex = next;
      SoundManager.playCursor();
      this.refreshAssetButtons();
      return true;
    }

    refreshAssetButtons() {
      if (!this._container) return;
      this._container.querySelectorAll('.ag-action-btn').forEach(el => {
        el.classList.toggle('focused', Number(el.dataset.btn) === this._btnIndex);
      });
    }

    // Fires whichever button the cursor is on (pad / keyboard confirm).
    triggerAssetButton() {
      const a = this._assets[this._selIndex];
      const btn = this.assetButtons(a)[this._btnIndex];
      if (!btn || !btn.enabled) return false;
      this.runAssetAction(btn.key);
      return true;
    }

    runAssetAction(key) {
      const a = this._assets[this._selIndex];
      if (!a) return;
      if (a.animal) {
        const uid = a.animal.uid;
        if (key === 'collect') this.collectAnimal(uid);
        else if (key === 'sell') this.sellAnimal(uid);
        else if (key === 'pet') this.makeAnimalPet(uid);
        return;
      }
      if (a.diplomat && key === 'resign') this.resignPost(a.diplomat);
    }

    // Giving up a seat costs a great deal of standing, so the first press only
    // arms the button and the second one goes through with it.
    resignPost(post) {
      if (this._confirmResign !== post.actorId) {
        this._confirmResign = post.actorId;
        SoundManager.playCursor();
        const held = this._btnIndex;
        this.refreshDOM();
        this._btnIndex = held;
        this.refreshAssetButtons();
        return;
      }
      this._confirmResign = null;
      if (window.ONUAssembly && window.ONUAssembly.resign(post.actorId)) {
        SoundManager.playOk();
      } else {
        SoundManager.playBuzzer();
      }
      this._btnIndex = -1;
      this.refreshDOM();
    }

    // Draws the sprite of the selected animal, if the detail card shows one.
    paintAnimalSprite() {
      const cv = this._container && this._container.querySelector('#assets-animal-sprite');
      if (!cv || !window.AnimalGrowthSystem) return;
      window.AnimalGrowthSystem.drawSpriteOnCanvas(cv, cv.dataset.sprite, cv.dataset.stage);
    }

    // ---- Livestock actions ----

    animalAt(uid) {
      return this._assets.find(a => a.animal && a.animal.uid === uid);
    }

    collectAnimal(uid) {
      const ags = window.AnimalGrowthSystem;
      if (!ags) return;
      const items = ags.collectFromPlacement(uid) || [];
      if (items.length === 0) { SoundManager.playBuzzer(); return; }
      SoundManager.playShop();
      const it = isItalian();
      const names = items.map(r => {
        const item = $dataItems[r.itemId];
        return `${item ? item.name : `#${r.itemId}`} ×${r.qty}`;
      }).join(', ');
      this.notify(`${T('Assets.ui.collected')}: ${names}`);
      this.refreshDOM();
    }

    sellAnimal(uid) {
      const ags = window.AnimalGrowthSystem;
      if (!ags) return;
      const sold = ags.sellPlacement(uid);
      if (!sold) { SoundManager.playBuzzer(); return; }
      SoundManager.playShop();
      const it = isItalian();
      this.notify(`${T('Assets.ui.sold')} ${sold.animalId} — ${euro(sold.value)}`);
      this.refreshDOM();
    }

    makeAnimalPet(uid) {
      const ags = window.AnimalGrowthSystem;
      if (!ags) return;
      const entry = this.animalAt(uid);
      const pet = ags.petPlacement(uid);
      if (!pet) { SoundManager.playBuzzer(); return; }
      SoundManager.playOk();
      const it = isItalian();
      const name = entry ? entry.animal.animalId : pet.name;
      this.notify(T('Assets.ui.nowAPet', { name: name }));
      this.refreshDOM();
    }

    notify(text) {
      if (window.ParchmentToast && typeof window.ParchmentToast.show === 'function') {
        window.ParchmentToast.show(text, { severity: 'info', duration: 180 });
      }
    }

    // Repaints the oil/soul trend graph from the shared stock-market history.
    paintGraph() {
      const canvas = this._container && this._container.querySelector('#assets-graph');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const sm = $gameSystem && $gameSystem.stockMarket;
      if (!sm || typeof sm.getOilHistory !== 'function') return;
      const oil = sm.getOilHistory() || [];
      const souls = sm.getSoulsHistory() || [];
      const all = [...oil, ...souls];
      if (all.length < 2) return;

      const min = Math.min(...all) * 0.92;
      const max = Math.max(...all) * 1.08;
      const padL = 56, padR = 14, padT = 14, padB = 16;

      ctx.strokeStyle = 'rgba(74,39,17,0.12)';
      ctx.lineWidth = 1;
      ctx.font = '9px Tahoma';
      ctx.fillStyle = '#6b5242';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const gy = padT + (h - padT - padB) * (i / 4);
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
        const v = max - (max - min) * (i / 4);
        ctx.fillText(euro(Math.round(v)), padL - 6, gy + 3);
      }

      const trend = (hist, color) => {
        if (!hist || hist.length < 2) return;
        const plotW = w - padL - padR, plotH = h - padT - padB;
        ctx.beginPath();
        hist.forEach((p, i) => {
          const px = padL + i * (plotW / (hist.length - 1));
          const py = padT + plotH - (((p - min) / (max - min)) * plotH || 0);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      };
      trend(oil, '#2ecc71');
      trend(souls, '#9b59b6');
    }

    scrollToSelected() {
      const list = this._container && this._container.querySelector('#assets-list');
      if (!list) return;
      const sel = list.querySelector('.assets-row.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    selectAsset(idx) {
      if (idx < 0 || idx >= this._assets.length) return;
      SoundManager.playCursor();
      this._selIndex = idx;
      this._btnIndex = -1;   // a new asset starts with no button focused
      // Moving off an armed resign disarms it: the warning belongs to the row
      // it was raised on, not to the menu.
      this._confirmResign = null;
      // Only the detail panel needs to change on selection.
      const detail = this._container && this._container.querySelector('#assets-detail');
      if (detail) { detail.innerHTML = this.buildDetailHTML(); this.paintAnimalSprite(); }
      const list = this._container && this._container.querySelector('#assets-list');
      if (list) {
        list.querySelectorAll('.assets-row').forEach((el, i) => {
          el.classList.toggle('selected', i === this._selIndex);
        });
      }
      this.scrollToSelected();
    }

    moveSelection(delta) {
      if (this._assets.length === 0) return;
      const next = (this._selIndex + delta + this._assets.length) % this._assets.length;
      this.selectAsset(next);
    }

    update() {
      super.update();
      if (!this._container) return;

      // Keyboard / gamepad navigation.
      let handled = false;
      if (Input.isRepeated('down') || this._wasdQueued.down) { this.moveSelection(1); handled = true; }
      else if (Input.isRepeated('up') || this._wasdQueued.up) { this.moveSelection(-1); handled = true; }
      this._wasdQueued.up = this._wasdQueued.down = false;

      // Livestock and diplomatic seats carry actions: left/right walks the
      // selected asset's buttons and confirm fires the focused one.
      if (!handled && Input.isRepeated('right')) { handled = this.moveAssetButton(1); }
      else if (!handled && Input.isRepeated('left')) { handled = this.moveAssetButton(-1); }
      if (!handled && Input.isTriggered('ok')) { handled = this.triggerAssetButton(); }

      if (!handled && (Input.isTriggered('cancel') || Input.isTriggered('escape') || TouchInput.isCancelled())) {
        SoundManager.playCancel();
        this.popScene();
        return;
      }

      // Live refresh: when the shared market ticks, repaint the graph and the
      // value columns in place without rebuilding the whole spread.
      const sm = $gameSystem && $gameSystem.stockMarket;
      if (sm && (sm.getOilPrice() !== this._lastOil || sm.getSoulsPrice() !== this._lastSouls)) {
        this.liveUpdate();
      }
    }

    // Refreshes prices/values in place: summary totals, pockets value columns,
    // detail panel and the trend graph. Falls back to a full rebuild only if the
    // asset set itself changed (e.g. a position was opened/closed while open).
    liveUpdate() {
      if (!this._container) return;
      this._assets = gatherAssets();
      const sm = $gameSystem && $gameSystem.stockMarket;
      if (sm) { this._lastOil = sm.getOilPrice(); this._lastSouls = sm.getSoulsPrice(); }

      const rows = this._container.querySelectorAll('.assets-row');
      if (rows.length !== this._assets.length) { this.refreshDOM(); return; }

      // Summary totals.
      const cash = $gameParty ? $gameParty.gold() : 0;
      let totalAssets = cash, totalLiabilities = 0;
      this._assets.forEach(a => {
        if (a.liability) totalLiabilities += a.value; else totalAssets += a.value;
      });
      const netWorth = totalAssets - totalLiabilities;
      const sumVals = this._container.querySelectorAll('.assets-sum-val');
      if (sumVals.length === 4) {
        sumVals[0].textContent = euro(cash);
        sumVals[1].textContent = euro(totalAssets);
        sumVals[2].textContent = euro(totalLiabilities);
        sumVals[3].textContent = euro(netWorth);
        sumVals[3].style.color = netWorth >= 0 ? '#1f6f3f' : '#b3322b';
      }

      // Pockets value columns.
      rows.forEach((row, i) => {
        const a = this._assets[i];
        if (!a) return;
        const valEl = row.querySelector('.assets-row-val');
        if (valEl) valEl.textContent = `${a.liability ? '-' : ''}${euro(a.value)}`;
      });

      // Detail card (selected asset values may have changed).
      const detail = this._container.querySelector('#assets-detail');
      if (detail) { detail.innerHTML = this.buildDetailHTML(); this.paintAnimalSprite(); }

      this.paintGraph();
    }

    terminate() {
      if (this._wasdListener) {
        window.removeEventListener('keydown', this._wasdListener);
        this._wasdListener = null;
      }
      if (this._container) {
        const c = this._container;
        c.style.transition = 'opacity 0.2s ease-out';
        c.style.opacity = '0';
        c.style.pointerEvents = 'none';
        setTimeout(() => { if (c && c.parentNode) c.parentNode.removeChild(c); }, 200);
        this._container = null;
      }
      super.terminate();
    }
  }

  window.Scene_AssetsMenu = Scene_AssetsMenu;

})();
