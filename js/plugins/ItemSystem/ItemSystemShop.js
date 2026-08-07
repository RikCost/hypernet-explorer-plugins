/*:
 * @target MZ
 * @plugindesc v1.0.0 Shop System - Unified item details and shop enhancements with alchemical layouts
 * @author Omni-Lex
 * @help ItemSystemShop.js
 *
 * Unified item detail display showing stats, effects, and compatibility
 * with high-fidelity HTML overlays for merchant transaction tables.
 * Requires ItemSystemUtils.js to be loaded first.
 */

(function () {
  "use strict";

  if (!window.ItemSystemUtils) {
    throw new Error("ItemSystemShop requires ItemSystemUtils.js to be loaded first!");
  }

  const utils = window.ItemSystemUtils;

  let _statsI18n = null;

  const _loadStatsI18n = async () => {
    const lang = ConfigManager.language || 'en';
    const url = `js/i18n/${lang}/stats.json`;
    try {
      const response = await fetch(url);
      _statsI18n = await response.json();
    } catch (e) {
      console.warn('ItemSystemShop: Stats i18n file missing, utilizing localized dictionary fallbacks.');
    }
  };

  const _si18n = (key) => {
    if (_statsI18n && _statsI18n[key]) {
      return _statsI18n[key];
    }
    const fallbacks = {
      'ATT': 'STR', 'DEF': 'CON', 'M.ATT': 'INT', 'M.DEF': 'WIS', 'AGILITY': 'DEX', 'LUCK': 'PSI'
    };
    return fallbacks[key] || key;
  };

  _loadStatsI18n();

  //=============================================================================
  // Safety layer
  //=============================================================================
  // The shop paints itself as a DOM overlay driven from the scene's update
  // loop. One bad item, one missing element or one container left behind by a
  // previous shop used to throw on every frame and take the game down with it,
  // so everything that touches foreign data or the document goes through these.

  const _warnedOnce = new Set();
  const warnOnce = (label, e) => {
    if (_warnedOnce.has(label)) return;
    _warnedOnce.add(label);
    console.error("[ItemSystemShop] " + label, e);
  };

  // Run fn; never let it escape. Returns fallback when it throws.
  const safe = (label, fn, fallback) => {
    try {
      return fn();
    } catch (e) {
      warnOnce(label, e);
      return fallback;
    }
  };

  // Item names, categories and procedural lore all end up inside innerHTML.
  // An unescaped angle bracket does not just look wrong: it can truncate the
  // markup, after which every querySelector below returns null.
  const esc = (text) =>
    String(text === undefined || text === null ? "" : text).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const rarityColor = (item) => {
    const tier = safe("getItemRarity", () => utils.getItemRarity(item), null);
    return (tier && tier.colorCode) || "#FFFFFF";
  };

  const categoryOf = (item) =>
    safe("getItemCategoryName", () => utils.getItemCategoryName(item), null) || "";

  const weightOf = (item) => safe("getItemWeight", () => utils.getItemWeight(item), 1);

  const formatWeight = (grams) =>
    safe("formatWeight", () => utils.formatWeight(grams), String(grams));

  const needRestoresOf = (item) =>
    safe("getNeedRestores", () => (utils.getNeedRestores ? utils.getNeedRestores(item) : []), []) || [];

  // What the item takes off an addiction craving, so a buyer can tell a bottle
  // that only feeds a habit from one that feeds a body.
  const addictionReliefOf = (item) =>
    safe("getAddictionRelief", () => (utils.getAddictionRelief ? utils.getAddictionRelief(item) : []), []) || [];

  const loreOf = (item) =>
    safe("loreFor", () => (utils.loreFor ? utils.loreFor(item) : ""), "") || "";

  const translate = (text) =>
    safe("translateText", () => {
      if (text && typeof window.translateText === "function") return window.translateText(text);
      return text;
    }, text);

  // A data param slot that a malformed or third-party item may simply not have.
  const paramOf = (item, paramId) => {
    const raw = item && Array.isArray(item.params) ? item.params[paramId] : 0;
    return Number.isFinite(raw) ? raw : 0;
  };

  const modifiedParamOf = (item, paramId) => {
    const mods = window.ItemSystemModifiers;
    if (mods && typeof mods.getModifiedParam === "function") {
      const value = safe("getModifiedParam", () => mods.getModifiedParam(item, paramId), null);
      if (Number.isFinite(value)) return value;
    }
    return paramOf(item, paramId);
  };

  const money = (value) => (Number.isFinite(value) ? value / 100 : 0).toFixed(2);

  // The database name of an equip slot, or its number when the slot is one this
  // game's System.json does not declare.
  const equipTypeName = (etypeId) => {
    const names = $dataSystem && $dataSystem.equipTypes;
    const name = names && names[etypeId];
    return name || (T('Shop.equipType') + etypeId);
  };

  const partyMembers = () =>
    safe("partyMembers", () => ($gameParty ? $gameParty.members() : []), []) || [];

  const actorLabel = (actor) =>
    safe("actorName", () => translate(actor.name()), "") || "";

  // The stock/price record of the shop currently open, or null when this shop
  // keeps no record (an event with no id, a shop opened straight from a plugin).
  const currentShopData = (scene) => {
    const s = scene || SceneManager._scene;
    if (!(s instanceof Scene_Shop)) return null;
    if (!s._shopMapId || !s._shopEventId) return null;
    const stocks = $gameSystem && $gameSystem._shopStocks;
    if (!stocks) return null;
    const forMap = stocks[s._shopMapId];
    return (forMap && forMap[s._shopEventId]) || null;
  };

  // Categories priced off the SOUL index rather than the oil index.
  const SOUL_CATEGORIES = ["jungle", "magic", "plants", "monsters"];  // i18n-ignore  <category:> tag values

  const marketFactor = (shopData, item) => {
    if (!shopData) return 1.0;
    const cat = categoryOf(item).toLowerCase();
    const raw = SOUL_CATEGORIES.includes(cat) ? shopData.soulFactor : shopData.oilFactor;
    const factor = Number(raw);
    return Number.isFinite(factor) && factor > 0 ? factor : 1.0;
  };

  // Who the item suits: any class can equip any weapon now, so a member with no
  // proficiency in it does not count as compatible (see WeaponProficiency).
  const isProficientWith = (actor, item) =>
    safe("isProficientWith", () => {
      if (!actor || !item || typeof actor.canEquip !== "function") return false;
      if (!actor.canEquip(item)) return false;
      const prof = window.WeaponProficiency;
      if (prof && typeof prof.isUntrained === "function" && prof.isUntrained(actor, item)) return false;
      return true;
    }, false);

  //=============================================================================
  // MASTER Item Detail Window - SHARED by both Shop and Inventory
  //=============================================================================

  function Window_ItemDetail() {
    this.initialize(...arguments);
  }

  Window_ItemDetail.prototype = Object.create(Window_Base.prototype);
  Window_ItemDetail.prototype.constructor = Window_ItemDetail;

  Window_ItemDetail.prototype.initialize = function (rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this._item = null;
    this.refresh();
  };

  Window_ItemDetail.prototype.setItem = function (item) {
    if (this._item !== item) {
      this._item = item;
      this.refresh();
    }
  };

  Window_ItemDetail.prototype.refresh = function () {
    if (!this.contents) return;
    this.contents.clear();
    if (this._item) {
      safe("drawItemDetails", () => this.drawItemDetails(), null);
    }
  };

  Window_ItemDetail.prototype.getWeaponScalingType = function (weapon) {
    if (!weapon || !DataManager.isWeapon(weapon) || !Array.isArray(weapon.traits)) {
      return null;
    }
    const attackSkills = weapon.traits.filter(trait => trait && trait.code === 35);
    if (attackSkills.length === 0) {
      return 'STR';
    }
    for (let i = 0; i < attackSkills.length; i++) {
      const skillId = attackSkills[i].dataId;
      switch (skillId) {
        case 840: return 'DEX';
        case 841: return 'MIX';
        case 842: return 'PSI';
        case 843: return 'INT';
        case 844: return 'CON';
        case 845: return 'WIS';
      }
    }
    return null;
  };

  Window_ItemDetail.prototype.drawItemDetails = function () {
    const item = this._item;
    if (!item) return;
    const lineHeight = this.lineHeight();
    const contentWidth = this.width - this.padding * 2;
    let y = 0;

    const isInShop = SceneManager._scene instanceof Scene_Shop;
    if (!isInShop && item.description) {
      const translatedDescription = translate(item.description);
      const descLines = this.wrapText(translatedDescription, contentWidth - 4);
      for (const line of descLines) {
        this.drawTextEx("\\c[6]" + line, 0, y, contentWidth);
        y += lineHeight;
      }
      y += 16;
    }

    // Procedural lore (resolves {nation}/{leader}/... tokens) in grey flavor.
    if (!isInShop) {
      const loreText = loreOf(item);
      if (loreText) {
        for (const line of this.wrapText(loreText, contentWidth - 4)) {
          this.drawTextEx("\\c[8]" + line, 0, y, contentWidth);
          y += lineHeight;
        }
        y += 16;
      }
    }

    if (DataManager.isItem(item)) {
      this.drawItemStats(item, y);
    } else if (DataManager.isWeapon(item)) {
      this.drawWeaponStats(item, y);
    } else if (DataManager.isArmor(item)) {
      this.drawArmorStats(item, y);
    }
  };

  Window_ItemDetail.prototype.drawItemName = function (item, x, y, width) {
    if (item) {
      const iconY = y + (this.lineHeight() - ImageManager.iconHeight) / 2;
      const textMargin = ImageManager.iconWidth + 4;
      const itemWidth = width || this.innerWidth - textMargin;
      this.resetTextColor();
      this.drawIcon(item.iconIndex || 0, x, iconY);
      this.changeTextColor(rarityColor(item));
      this.drawText(item.name || "", x + textMargin, y, itemWidth);
      this.resetTextColor();
    }
  };

  Window_ItemDetail.prototype.drawItemStats = function (item, y) {
    const lineHeight = this.lineHeight();
    let currentY = y;
    const categoryName = categoryOf(item);
    if (categoryName) {
      this.drawKeyValue(T('Shop.type'), categoryName, 0, currentY);
      currentY += lineHeight;
    }
    currentY = this.drawMarketPriceInfo(item, currentY);
    const weight = weightOf(item);
    this.drawKeyValue(T('Shop.weight'), formatWeight(weight), 0, currentY);
    currentY += lineHeight;

    const isFood = safe("isFoodItem", () => utils.isFoodItem(item), false);
    if (isFood) {
      const calories = safe("nutrition", () => utils.getNutritionValue(item, "calories"), 0);
      const protein = safe("nutrition", () => utils.getNutritionValue(item, "protein"), 0);
      const fat = safe("nutrition", () => utils.getNutritionValue(item, "fat"), 0);

      if (calories > 0) {
        this.drawKeyValue(T('Shop.calories'), calories.toString(), 0, currentY);
        currentY += lineHeight;
      }
      if (protein > 0) {
        this.drawKeyValue(T('Shop.protein'), protein + "g", 0, currentY);
        currentY += lineHeight;
      }
      if (fat > 0) {
        this.drawKeyValue(T('Shop.fat'), fat + "g", 0, currentY);
        currentY += lineHeight;
      }
    } else {
      if (item.consumable !== undefined && item.occasion !== 3) {
        this.drawKeyValue(T('Shop.use'),
          item.consumable ? (T('Shop.single')) : (T('Shop.unlimited')),
          0, currentY
        );
        currentY += lineHeight;
      }
      if (item.scope > 0) {
        this.drawKeyValue(T('Shop.target'), this.getScopeName(item.scope), 0, currentY);
        currentY += lineHeight;
      }

      const hasCombatStats =
        (item.speed !== undefined && item.speed !== 0) ||
        (item.successRate !== undefined && item.successRate < 100) ||
        (item.repeats && item.repeats > 1) ||
        (item.tpGain !== undefined && item.tpGain !== 0) ||
        (item.damage && item.damage.type > 0);

      if (hasCombatStats) {
        if (item.repeats && item.repeats > 1) {
          this.drawKeyValue(T('Shop.hits'), item.repeats + (T('Shop.times')), 0, currentY);
          currentY += lineHeight;
        }
        if (item.tpGain !== undefined && item.tpGain !== 0) {
          this.drawKeyValue(T('Shop.ap'), item.tpGain.toString(), 0, currentY);
          currentY += lineHeight;
        }
        if (item.damage && item.damage.type > 0) {
          if (item.damage.elementId > 1) {
            const elementName = this.getElementName(item.damage.elementId);
            if (elementName) {
              this.drawKeyValue(T('Shop.element'), elementName, 0, currentY);
              currentY += lineHeight;
            }
          }
          if (item.damage.critical !== undefined) {
            this.drawKeyValue(T('Shop.crit'), item.damage.critical ? (T('Shop.yes')) : "No", 0, currentY);
            currentY += lineHeight;
          }
        }
      }

      if (Array.isArray(item.effects) && item.effects.length > 0) {
        for (const effect of item.effects) {
          const effectText = safe("getEffectDescription", () => this.getEffectDescription(effect), null);
          if (effectText) {
            const parts = effectText.split(": ");
            if (parts.length > 1) {
              this.drawKeyValue(parts[0], parts[1], 0, currentY);
            } else {
              this.drawTextEx("\\c[6]" + effectText, 0, currentY, this.width - this.padding * 2);
            }
            currentY += lineHeight;
          }
        }
      }
    }

    const needRestores = needRestoresOf(item);
    for (const r of needRestores) {
      this.drawKeyValue(r.label, "+" + r.amount + "%", 0, currentY);
      currentY += lineHeight;
    }

    // Cravings read the other way round: this is what comes OFF the meter.
    for (const r of addictionReliefOf(item)) {
      this.drawKeyValue(r.label, "-" + r.amount + "%", 0, currentY);
      currentY += lineHeight;
    }
  };

  Window_ItemDetail.prototype.drawWeaponStats = function (item, y) {
    const lineHeight = this.lineHeight();
    let currentY = y;

    const mods = window.ItemSystemModifiers;
    const modifier = mods && typeof mods.getModifier === "function"
      ? safe("getModifier", () => mods.getModifier(item), null) : null;
    if (modifier && modifier.name) {
      this.drawKeyValue(T('Shop.modifier'), modifier.name, 0, currentY);
      currentY += lineHeight;
    }

    const categoryName = categoryOf(item);
    if (categoryName) {
      this.drawKeyValue(T('Shop.type'), categoryName, 0, currentY);
      currentY += lineHeight;
    }

    const scalingType = this.getWeaponScalingType(item);
    if (scalingType) {
      this.drawKeyValue(T('Shop.scale'), scalingType, 0, currentY);
      currentY += lineHeight;
    }

    const weight = weightOf(item);
    this.drawKeyValue(T('Shop.weight'), formatWeight(weight), 0, currentY);
    currentY += lineHeight;

    currentY = this.drawMarketPriceInfo(item, currentY);
    currentY = this.drawEquipCompatibility(item, currentY);

    const price = mods && typeof mods.getModifiedPrice === "function"
      ? safe("getModifiedPrice", () => mods.getModifiedPrice(item), item.price) : item.price;
    if (price > 0) {
      this.drawKeyValue(T('Shop.price'), money(price) + " €", 0, currentY);
      currentY += lineHeight;
    }

    const params = [
      [_si18n("ATT"), modifiedParamOf(item, 2)],
      [_si18n("DEF"), modifiedParamOf(item, 3)],
      [_si18n("M.ATT"), modifiedParamOf(item, 4)],
      [_si18n("M.DEF"), modifiedParamOf(item, 5)],
      [_si18n("AGILITY"), modifiedParamOf(item, 6)],
      [_si18n("LUCK"), modifiedParamOf(item, 7)]
    ];
    for (const param of params) {
      if (param[1] !== 0) {
        const sign = param[1] > 0 ? "+" : "";
        this.drawKeyValue(param[0], sign + param[1], 0, currentY);
        currentY += lineHeight;
      }
    }

    if (Array.isArray(item.traits) && item.traits.length > 0) {
      for (const trait of item.traits) {
        const traitText = safe("getTraitDescription", () => this.getTraitDescription(trait), null);
        if (traitText) {
          const parts = traitText.split(": ");
          if (parts.length > 1) {
            this.drawKeyValue(parts[0], parts[1], 0, currentY);
          } else {
            this.drawTextEx("\\c[6]" + traitText, 0, currentY, this.width - this.padding * 2);
          }
          currentY += lineHeight;
        }
      }
    }
  };

  Window_ItemDetail.prototype.drawArmorStats = function (item, y) {
    const lineHeight = this.lineHeight();
    let currentY = y;

    const categoryName = categoryOf(item);
    if (categoryName) {
      this.drawKeyValue(T('Shop.type'), categoryName, 0, currentY);
      currentY += lineHeight;
    }

    this.drawKeyValue(T('Shop.slot'), translate(equipTypeName(item.etypeId)), 0, currentY);
    currentY += lineHeight;

    const weight = weightOf(item);
    this.drawKeyValue(T('Shop.weight'), formatWeight(weight), 0, currentY);
    currentY += lineHeight;

    currentY = this.drawMarketPriceInfo(item, currentY);
    currentY = this.drawEquipCompatibility(item, currentY);

    if (item.price > 0) {
      this.drawKeyValue(T('Shop.price'), money(item.price) + " €", 0, currentY);
      currentY += lineHeight;
    }

    const params = [
      [_si18n("ATT"), paramOf(item, 2)],
      [_si18n("DEF"), paramOf(item, 3)],
      [_si18n("M.ATT"), paramOf(item, 4)],
      [_si18n("M.DEF"), paramOf(item, 5)],
      [_si18n("AGILITY"), paramOf(item, 6)],
      [_si18n("LUCK"), paramOf(item, 7)]
    ];
    for (const param of params) {
      if (param[1] !== 0) {
        const sign = param[1] > 0 ? "+" : "";
        this.drawKeyValue(param[0], sign + param[1], 0, currentY);
        currentY += lineHeight;
      }
    }

    if (Array.isArray(item.traits) && item.traits.length > 0) {
      for (const trait of item.traits) {
        const traitText = safe("getTraitDescription", () => this.getTraitDescription(trait), null);
        if (traitText) {
          const parts = traitText.split(": ");
          if (parts.length > 1) {
            this.drawKeyValue(parts[0], parts[1], 0, currentY);
          } else {
            this.drawTextEx("\\c[6]" + traitText, 0, currentY, this.width - this.padding * 2);
          }
          currentY += lineHeight;
        }
      }
    }
  };

  Window_ItemDetail.prototype.drawEquipCompatibility = function (item, y) {
    const lineHeight = this.lineHeight();
    let currentY = y;

    this.changeTextColor(ColorManager.systemColor());
    this.drawText(T('Shop.equipBy'), 0, currentY, this.width - this.padding * 2);
    currentY += lineHeight;

    const party = partyMembers();
    let equipInfoShown = false;

    for (let i = 0; i < party.length; i++) {
      const actor = party[i];
      const canEquip = isProficientWith(actor, item);
      this.resetTextColor();
      const translatedName = actorLabel(actor);

      if (canEquip) {
        this.drawText(translatedName, 20, currentY, this.width - this.padding * 2 - 20);
        currentY += lineHeight;
        equipInfoShown = true;
      }
    }

    if (!equipInfoShown) {
      this.resetTextColor();
      this.drawText(T('Shop.noOneInParty'), 20, currentY, this.width - this.padding * 2 - 20);
      currentY += lineHeight;
    }

    return currentY;
  };

  Window_ItemDetail.prototype.drawMarketPriceInfo = function (item, y) {
    const shopData = currentShopData();
    if (!shopData) return y;
    const factor = marketFactor(shopData, item);
    const valueDisplay = Math.round(factor * 100) + "%";

    if (factor > 1.01) this.changeTextColor(ColorManager.textColor(18));
    else if (factor < 0.99) this.changeTextColor(ColorManager.textColor(3));

    this.drawKeyValue(T('Shop.price'), valueDisplay, 0, y);
    this.resetTextColor();
    return y + this.lineHeight();
  };

  Window_ItemDetail.prototype.drawKeyValue = function (key, value, x, y) {
    const width = this.width - this.padding * 2;
    const isInShop = SceneManager._scene instanceof Scene_Shop;
    const keyWidth = isInShop ? Math.floor(width / 2.5) : Math.floor(width / 3);

    this.changeTextColor(ColorManager.systemColor());
    this.drawText(key, x, y, keyWidth);
    this.resetTextColor();
    this.drawText(value, x + keyWidth, y, width - keyWidth, "left");
  };

  Window_ItemDetail.prototype.drawHorzLine = function (y) {
    const lineY = y + this.lineHeight() / 2 - 1;
    const width = this.width - this.padding * 2;
    this.contents.fillRect(0, lineY, width, 2, ColorManager.systemColor());
  };

  Window_ItemDetail.prototype.wrapText = function (text, maxWidth) {
    if (!text) return [];
    const result = [];
    const words = text.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const testWidth = this.textSizeEx(testLine).width;
      if (testWidth > maxWidth && currentLine) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }

    const finalResult = [];
    for (const line of result) {
      const subLines = line.split("\n");
      for (const subLine of subLines) {
        finalResult.push(subLine);
      }
    }
    return finalResult;
  };

  Window_ItemDetail.prototype.getItemTypeName = function (item) {
    if (DataManager.isItem(item)) {
      return item.itypeId === 1 ? (T('Shop.regularItem')) : (T('Shop.keyItem'));
    } else if (DataManager.isWeapon(item)) {
      return T('Shop.weapon');
    } else if (DataManager.isArmor(item)) {
      return T('Shop.armor');
    }
    return T('Shop.unknown');
  };

  // The engine's scope number is the id; only the label is translated, so a
  // scope this game never uses falls through to the unknown label.
  Window_ItemDetail.prototype.getScopeName = function (scope) {
    const key = 'Shop.scope.' + String(scope);
    return T.has(key) ? T(key) : T('Shop.scope.unknown');
  };

  Window_ItemDetail.prototype.getOccasionName = function (occasion) {
    const key = 'Shop.occasion.' + String(occasion);
    return T.has(key) ? T(key) : T('Shop.occasion.unknown');
  };

  Window_ItemDetail.prototype.getDamageTypeName = function (type) {
    const key = 'Shop.damageType.' + String(type);
    return T.has(key) ? T(key) : T('Shop.damageType.none');
  };

  Window_ItemDetail.prototype.getElementName = function (elementId) {
    if (!elementId || elementId <= 1) return null;
    if ($dataSystem && $dataSystem.elements && $dataSystem.elements[elementId]) {
      let elementName = $dataSystem.elements[elementId];
      if (window.translateText && typeof window.translateText === "function") {
        elementName = window.translateText(elementName);
      }
      return elementName;
    }
    return T('Shop.elementN', { id: elementId });
  };

  Window_ItemDetail.prototype.getFormulaPreview = function (formula) {
    if (!formula) return "?";
    let display = formula;
    display = display.replace(/a\.atk/g, _si18n("ATT"))
      .replace(/b\.def/g, _si18n("DEF"))
      .replace(/a\.mat/g, _si18n("M.ATT"))
      .replace(/b\.mdf/g, _si18n("M.DEF"))
      .replace(/a\.agi/g, _si18n("AGILITY"))
      .replace(/b\.luk/g, _si18n("LUCK"));
    return display;
  };

  Window_ItemDetail.prototype.getEffectDescription = function (effect) {
    if (!effect) return null;

    switch (effect.code) {
      case Game_Action.EFFECT_RECOVER_HP:
        const hpPercent = effect.value1 * 100;
        const hpFlat = effect.value2;
        if (hpPercent === 0 && hpFlat === 0) return null;
        if (hpPercent === 0) return (T('Shop.hp')) + hpFlat;
        if (hpFlat === 0) return (T('Shop.hp')) + hpPercent + "%";
        const hpSign = hpFlat > 0 ? "+ " : "";
        return (T('Shop.hp')) + hpPercent + "% " + hpSign + hpFlat;
      case Game_Action.EFFECT_RECOVER_MP:
        const mpPercent = effect.value1 * 100;
        const mpFlat = effect.value2;
        if (mpPercent === 0 && mpFlat === 0) return null;
        if (mpPercent === 0) return (T('Shop.mp')) + mpFlat;
        if (mpFlat === 0) return (T('Shop.mp')) + mpPercent + "%";
        const mpSign = mpFlat > 0 ? "+ " : "";
        return (T('Shop.mp')) + mpPercent + "% " + mpSign + mpFlat;
      case Game_Action.EFFECT_GAIN_TP:
        if (effect.value1 === 0) return null;
        return (T('Shop.ap2')) + effect.value1;
      case Game_Action.EFFECT_ADD_STATE:
        if (effect.value1 === 0) return null;
        return ((T('Shop.status')) + this.getStateName(effect.dataId));
      case Game_Action.EFFECT_REMOVE_STATE:
        if (effect.value1 === 0) return null;
        return ((T('Shop.cura')) + this.getStateName(effect.dataId));
      case Game_Action.EFFECT_ADD_BUFF:
        if (effect.value1 === 0) return null;
        return (((T('Shop.buff')) + this.getParameterName(effect.dataId) + " (" + effect.value1 + (T('Shop.turns'))));
      case Game_Action.EFFECT_ADD_DEBUFF:
        if (effect.value1 === 0) return null;
        return (((T('Shop.debuff')) + this.getParameterName(effect.dataId) + " (" + effect.value1 + (T('Shop.turns'))));
      case Game_Action.EFFECT_REMOVE_BUFF:
        return ((T('Shop.buff2')) + this.getParameterName(effect.dataId));
      case Game_Action.EFFECT_REMOVE_DEBUFF:
        return ((T('Shop.debuff2')) + this.getParameterName(effect.dataId));
      case Game_Action.EFFECT_SPECIAL:
        return T('Shop.special');
      case Game_Action.EFFECT_GROW:
        if (effect.value1 === 0) return null;
        return (((T('Shop.grow')) + this.getParameterName(effect.dataId) + " +" + effect.value1));
      case Game_Action.EFFECT_LEARN_SKILL:
        return ((T('Shop.learn')) + this.getSkillName(effect.dataId));
      case Game_Action.EFFECT_COMMON_EVENT:
        return T('Shop.event');
      default:
        return null;
    }
  };

  Window_ItemDetail.prototype.getTraitDescription = function (trait) {
    if (!trait) return null;

    const code = trait.code;
    const dataId = trait.dataId;
    const value = trait.value;

    switch (code) {
      case Game_BattlerBase.TRAIT_ELEMENT_RATE:
        if (value === 1) return null;
        return "Elem: " + this.getElementName(dataId) + " x" + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_DEBUFF_RATE:
        if (value === 1) return null;
        return "Debuff: " + this.getParameterName(dataId) + " x" + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_STATE_RATE:
        if (value === 1) return null;
        return (T('Shop.state')) + this.getStateName(dataId) + " x" + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_STATE_RESIST:
        return (T('Shop.resist')) + this.getStateName(dataId);
      case Game_BattlerBase.TRAIT_PARAM:
        if (value === 1) return null;
        return (T('Shop.stat')) + this.getParameterName(dataId) + " x" + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_XPARAM:
        if (value === 0) return null;
        return (T('Shop.skill')) + this.getXParameterName(dataId) + " +" + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_SPARAM:
        if (value === 0 || value === 1) return null;
        return (T('Shop.skill')) + this.getSParameterName(dataId) + " x" + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_ATTACK_ELEMENT:
        return (T('Shop.element2')) + this.getElementName(dataId);
      case Game_BattlerBase.TRAIT_ATTACK_STATE:
        if (value === 0) return null;
        return (T('Shop.state')) + this.getStateName(dataId) + " " + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_ATTACK_SPEED:
        if (value === 0) return null;
        return (T('Shop.speed')) + value;
      case Game_BattlerBase.TRAIT_ATTACK_TIMES:
        if (value === 0) return null;
        return (T('Shop.times2')) + value;
      case Game_BattlerBase.TRAIT_STYPE_ADD:
        return (T('Shop.type2')) + this.getSkillTypeName(dataId);
      case Game_BattlerBase.TRAIT_STYPE_SEAL:
        return (T('Shop.seal')) + this.getSkillTypeName(dataId);
      case Game_BattlerBase.TRAIT_SKILL_ADD:
        return (T('Shop.skill')) + this.getSkillName(dataId);
      case Game_BattlerBase.TRAIT_SKILL_SEAL:
        return (T('Shop.seal')) + this.getSkillName(dataId);
      case Game_BattlerBase.TRAIT_EQUIP_WTYPE:
        return "Equip: " + this.getWeaponTypeName(dataId);
      case Game_BattlerBase.TRAIT_EQUIP_ATYPE:
        return "Equip: " + this.getArmorTypeName(dataId);
      case Game_BattlerBase.TRAIT_EQUIP_LOCK:
        return (T('Shop.lock')) + this.getEquipTypeName(dataId);
      case Game_BattlerBase.TRAIT_EQUIP_SEAL:
        return (T('Shop.seal')) + this.getEquipTypeName(dataId);
      case Game_BattlerBase.TRAIT_SLOT_TYPE:
        return "Slot: " + dataId;
      case Game_BattlerBase.TRAIT_ACTION_PLUS:
        if (value === 0) return null;
        return (T('Shop.extra')) + Math.floor(value * 100) + "%";
      case Game_BattlerBase.TRAIT_SPECIAL_FLAG:
        return (T('Shop.special2')) + this.getSpecialFlagName(dataId);
      default:
        return null;
    }
  };

  Window_ItemDetail.prototype.getStateName = function (stateId) {
    return $dataStates[stateId] ? $dataStates[stateId].name : T('Shop.stateN', { id: stateId });
  };
  Window_ItemDetail.prototype.getParameterName = function (paramId) {
    return TextManager.param(paramId) || T('Shop.paramN', { id: paramId });
  };
  Window_ItemDetail.prototype.getXParameterName = function (xparamId) {
    const names = T.list('Shop.xparams');
    return names[xparamId] || T('Shop.xparamN', { id: xparamId });
  };
  Window_ItemDetail.prototype.getSParameterName = function (sparamId) {
    const names = T.list('Shop.sparams');
    return names[sparamId] || T('Shop.sparamN', { id: sparamId });
  };
  Window_ItemDetail.prototype.getSkillTypeName = function (stypeId) {
    return $dataSystem.skillTypes[stypeId] || T('Shop.skillTypeN', { id: stypeId });
  };
  Window_ItemDetail.prototype.getSkillName = function (skillId) {
    return $dataSkills[skillId] ? $dataSkills[skillId].name : T('Shop.skillN', { id: skillId });
  };
  Window_ItemDetail.prototype.getWeaponTypeName = function (wtypeId) {
    if (!$dataSystem || !$dataSystem.weaponTypes || !$dataSystem.weaponTypes[wtypeId]) {
      return (T('Shop.weaponType')) + wtypeId;
    }
    let weaponTypeName = $dataSystem.weaponTypes[wtypeId];
    if (window.translateText && typeof window.translateText === "function") {
      weaponTypeName = window.translateText(weaponTypeName);
    }
    return weaponTypeName;
  };

  Window_ItemDetail.prototype.getArmorTypeName = function (atypeId) {
    if (!$dataSystem || !$dataSystem.armorTypes || !$dataSystem.armorTypes[atypeId]) {
      return (T('Shop.armorType')) + atypeId;
    }
    let armorTypeName = $dataSystem.armorTypes[atypeId];
    if (window.translateText && typeof window.translateText === "function") {
      armorTypeName = window.translateText(armorTypeName);
    }
    return armorTypeName;
  };

  Window_ItemDetail.prototype.getEquipTypeName = function (etypeId) {
    return translate(equipTypeName(etypeId));
  };

  //=============================================================================
  // SHOP-SPECIFIC BRIDGING CODE
  //=============================================================================

  const _Window_ShopStatus_initialize = Window_ShopStatus.prototype.initialize;
  Window_ShopStatus.prototype.initialize = function (rect) {
    _Window_ShopStatus_initialize.call(this, rect);
    this._detailWindow = null;
  };

  Window_ShopStatus.prototype.setDetailWindow = function (detailWindow) {
    this._detailWindow = detailWindow;
  };

  const _Window_ShopStatus_setItem = Window_ShopStatus.prototype.setItem;
  Window_ShopStatus.prototype.setItem = function (item) {
    _Window_ShopStatus_setItem.call(this, item);
    if (this._detailWindow) {
      this._detailWindow.setItem(item);
    }
  };

  Window_ShopStatus.prototype.refresh = function () {
    if (this.contents) this.contents.clear();
    this.hideBackgroundDimmer();
    this.hide();
  };

  // Every native shop window is replaced by the DOM overlay below, so each one
  // is parked off-screen and silenced the moment it is built. They are all the
  // same three lines, so the hooks are installed from one table instead of nine
  // hand-written copies that could each miss a null check.
  const HIDDEN_SHOP_WINDOWS = {
    createHelpWindow: '_helpWindow',
    createGoldWindow: '_goldWindow',
    createCommandWindow: '_commandWindow',
    createDummyWindow: '_dummyWindow',
    createBuyWindow: '_buyWindow',
    createCategoryWindow: '_categoryWindow',
    createSellWindow: '_sellWindow',
    createNumberWindow: '_numberWindow',
    createStatusWindow: '_statusWindow'
  };

  const parkWindow = (win) => {
    if (!win) return;
    win.x = -3000;
    win.y = -3000;
    win.opacity = 0;
    win.contentsOpacity = 0;
    win.showBackgroundDimmer = function () { };
  };

  for (const [method, field] of Object.entries(HIDDEN_SHOP_WINDOWS)) {
    const base = Scene_Shop.prototype[method];
    Scene_Shop.prototype[method] = function () {
      base.call(this);
      parkWindow(this[field]);
    };
  }

  // The six keys the shop borrows while it is open.
  const SHOP_KEY_BINDINGS = {
    87: 'up',        // W
    65: 'shopBack',  // A → always go back to buy tab
    83: 'down',      // S
    68: 'right',     // D
    81: 'pageup',    // Q → L1 (switch to Buy)
    69: 'pagedown'   // E → R1 (switch to Sell)
  };

  // What those keys meant before a shop borrowed them, kept module-wide rather
  // than per scene. A scene-local copy looked right but a shop that opened while
  // another was still standing recorded the shop's OWN bindings as the originals
  // and left WASD stuck in shop mode for the rest of the session.
  //
  // Borrowing is idempotent: shops never legitimately nest (the engine
  // terminates the outgoing scene before creating the incoming one), so a second
  // borrow keeps the first set of originals and any single release restores
  // them. Restoring key by key also leaves alone whatever another plugin
  // remapped in the meantime, which swapping the whole keyMapper back would undo.
  let _shopKeyOriginals = null;

  const borrowShopKeys = () => {
    if (!_shopKeyOriginals) {
      _shopKeyOriginals = {};
      for (const code of Object.keys(SHOP_KEY_BINDINGS)) {
        _shopKeyOriginals[code] = Input.keyMapper[code];
      }
    }
    for (const code of Object.keys(SHOP_KEY_BINDINGS)) {
      Input.keyMapper[code] = SHOP_KEY_BINDINGS[code];
    }
  };

  const releaseShopKeys = () => {
    if (!_shopKeyOriginals) return;
    for (const code of Object.keys(_shopKeyOriginals)) {
      const previous = _shopKeyOriginals[code];
      if (previous === undefined) delete Input.keyMapper[code];
      else Input.keyMapper[code] = previous;
    }
    _shopKeyOriginals = null;
  };

  const _Scene_Shop_create = Scene_Shop.prototype.create;
  Scene_Shop.prototype.create = function () {
    _Scene_Shop_create.call(this);
    this.createItemDetailWindow();
    this.initStock();
    this.initUIShopDOM();

    // Both sides of the counter are skills: what the party pays and what it
    // gets paid. Name them while the shop is open.
    if (window.SpecBadge) safe("SpecBadge", () => window.SpecBadge.show(['Haggling', 'Appraising']), null);  // i18n-ignore  Specialization.json ids

    borrowShopKeys();
    this._shopKeysBorrowed = true;

    // Safety net: a plugin loading after this one may replace a create* hook
    // without calling ours, and an unparked native window would then be drawn
    // on top of the overlay.
    for (const field of Object.values(HIDDEN_SHOP_WINDOWS)) parkWindow(this[field]);
    parkWindow(this._itemDetailWindow);

    // Global keyboard / escape listener. Both listeners live on window, so they
    // must check they still belong to the scene on screen: a shop that failed to
    // tear down would otherwise keep closing whatever scene came after it.
    this._onShopKeyDown = (event) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;  // i18n-ignore  KeyboardEvent.key values
      if (SceneManager._scene !== this) return;
      event.preventDefault();
      this.cancelShopAction();
    };
    window.addEventListener("keydown", this._onShopKeyDown);

    // Global right-click / context menu listener to handle cancellations
    this._onShopContextMenu = (event) => {
      event.preventDefault();
      if (SceneManager._scene !== this) return;
      this.cancelShopAction();
    };
    window.addEventListener("contextmenu", this._onShopContextMenu);
  };

  // Every window this scene drives. Anything reaching into them goes through
  // isShopReady() first: the DOM overlay is refreshed from the update loop and
  // from click handlers, either of which can outlive the windows themselves.
  Scene_Shop.prototype.isShopReady = function () {
    return !!(this._buyWindow && this._sellWindow && this._categoryWindow &&
      this._numberWindow && this._commandWindow);
  };

  // The one way out of the shop. A second popScene in the same frame empties
  // the scene stack and SceneManager.exit() closes the game, which is what a
  // stray click, a gamepad B and the Escape listener firing together used to do.
  // The scene's own flag is checked as well as the engine's: this shop pops
  // itself exactly once whatever any other plugin has done to isSceneChanging.
  Scene_Shop.prototype.closeShop = function () {
    if (this._shopClosing) return;
    if (SceneManager._scene !== this) return;
    if (SceneManager.isSceneChanging()) return;
    this._shopClosing = true;
    this.popScene();
  };

  // Back out of the quantity modal if it is open, otherwise leave the shop.
  Scene_Shop.prototype.cancelShopAction = function () {
    if (this._shopClosing) return;
    if (SceneManager._scene !== this || SceneManager.isSceneChanging()) return;
    SoundManager.playCancel();
    if (this._numberWindow && this._numberWindow.active) {
      this._numberWindow.processCancel();
      this.refreshUIShop();
    } else {
      this.closeShop();
    }
  };

  Scene_Shop.prototype.createItemDetailWindow = function () {
    const rect = this.statusWindowRect();
    this._itemDetailWindow = new Window_ItemDetail(rect);
    parkWindow(this._itemDetailWindow);
    this.addWindow(this._itemDetailWindow);
    if (this._statusWindow && this._statusWindow.setDetailWindow) {
      this._statusWindow.setDetailWindow(this._itemDetailWindow);
    }
  };

  const _Window_ShopBuy_updateHelp = Window_ShopBuy.prototype.updateHelp;
  Window_ShopBuy.prototype.updateHelp = function () {
    _Window_ShopBuy_updateHelp.call(this);
    if (this._statusWindow) {
      this._statusWindow.setItem(this.item());
    }
  };

  Window_ShopBuy.prototype.makeItemList = function () {
    this._data = [];
    this._price = [];
    if (!Array.isArray(this._shopGoods)) return;

    const shopData = currentShopData();
    const items = [];

    // One malformed goods entry must not empty the whole shelf, so each is
    // resolved on its own.
    for (const goods of this._shopGoods) {
      const item = safe("goodsToItem", () => this.goodsToItem(goods), null);
      if (!item) continue;
      const listed = goods[2] === 0 ? item.price : goods[3];
      let price = Number.isFinite(listed) ? listed : 0;
      if (shopData) price = Math.floor(price * marketFactor(shopData, item));
      items.push({ item: item, price: Math.max(0, price), category: categoryOf(item).toLowerCase() });
    }

    items.sort((a, b) => {
      const catA = a.category;
      const catB = b.category;

      if (catA === "medical" && catB !== "medical") return -1;   // i18n-ignore  <category:> tag values
      if (catB === "medical" && catA !== "medical") return 1;    // i18n-ignore
      if (catA === "trash" && catB !== "trash") return 1;        // i18n-ignore
      if (catB === "trash" && catA !== "trash") return -1;       // i18n-ignore

      if (catA !== catB) {
        return catA.localeCompare(catB);
      }
      return a.price - b.price;
    });

    for (const obj of items) {
      this._data.push(obj.item);
      this._price.push(obj.price);
    }
  };

  // Base price() looks the item up by identity in _data. An item the list does
  // not hold (a stale selection after a refresh) used to return undefined and
  // poison every total downstream with NaN.
  Window_ShopBuy.prototype.price = function (item) {
    const index = this._data ? this._data.indexOf(item) : -1;
    const price = index >= 0 && this._price ? this._price[index] : 0;
    return Number.isFinite(price) ? price : 0;
  };

  // Drives the DOM overlay and carries the input the parked native windows can
  // no longer receive. Nothing below runs for a scene that is closing, has lost
  // its windows, or is no longer the one on screen.
  const _Scene_Shop_update = Scene_Shop.prototype.update;
  Scene_Shop.prototype.update = function () {
    _Scene_Shop_update.call(this);
    if (this._shopClosing || !this.isShopReady() || SceneManager._scene !== this) return;

    // Robust native input/controller backup checks
    if (Input.isTriggered('shopBack') && !this._numberWindow.active) {
      if (this._sellWindow.active || this._categoryWindow.active) {
        SoundManager.playCursor();
        this.switchToBuy();
        return;
      }
    }

    // Guard against double handling: the active buy/sell window's native cancel
    // handler may have already called popScene this frame (it fires whenever the
    // 'cancel' symbol is triggered, including Player 2's cancel and gamepad B,
    // which the split-screen input override folds into Input.isRepeated/isTriggered).
    // Without this check a second popScene here empties the scene stack and
    // SceneManager.exit() closes the game, so cancelShopAction is a no-op once
    // the scene is already on its way out.
    if (!SceneManager.isSceneChanging() && (Input.isTriggered('cancel') || TouchInput.isCancelled())) {
      this.cancelShopAction();
      return;
    }

    this.syncUIShopState();
  };

  const _Scene_Shop_terminate = Scene_Shop.prototype.terminate;
  Scene_Shop.prototype.terminate = function () {
    this.destroyUIShopDOM();

    // Clean up event listeners to avoid memory leaks
    if (this._onShopKeyDown) {
      window.removeEventListener("keydown", this._onShopKeyDown);
      this._onShopKeyDown = null;
    }
    if (this._onShopContextMenu) {
      window.removeEventListener("contextmenu", this._onShopContextMenu);
      this._onShopContextMenu = null;
    }

    // Hand the borrowed keys back exactly once per shop that took them.
    if (this._shopKeysBorrowed) {
      this._shopKeysBorrowed = false;
      releaseShopKeys();
    }

    _Scene_Shop_terminate.call(this);
  };


  // ============================================================================
  // Premium HTML DOM merchant counter systems
  // ============================================================================
  // The overlay this scene owns, or null once it has gone. Never look the id up
  // directly: a container left behind by an earlier shop carries that id too,
  // and its click handlers still point at that dead scene.
  Scene_Shop.prototype.shopContainer = function () {
    const container = this._shopContainer;
    if (!container || !container.isConnected) return null;
    return container;
  };

  Scene_Shop.prototype.destroyUIShopDOM = function () {
    if (this._shopContainer) {
      this._shopContainer.remove();
      this._shopContainer = null;
    }
    // Anything an earlier shop failed to clear goes with it.
    const stray = document.getElementById("shop-container");
    if (stray) stray.remove();
  };

  Scene_Shop.prototype.initUIShopDOM = function () {
    // Always start from a clean container bound to THIS scene. Reusing one left
    // over from a previous shop kept every button wired to a scene that is no
    // longer on screen, so a click would pop a stack that no longer held it.
    this.destroyUIShopDOM();

    const container = document.createElement("div");
    container.id = "shop-container";
    this._shopContainer = container;
    document.body.appendChild(container);

    container.innerHTML = `
        <div class="shop-spread" style="display: flex; width: 100%; height: 100%; box-sizing: border-box;">
            <div class="shop-left" style="flex: 3; padding: 10px 20px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; height: 100%;">
                <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px;">
                    <div class="back-button focusable" id="shop-close-btn" style="position: absolute; left: 0; font-family: 'Lora', serif; font-size: 0.8rem; background: #8b5a2b; color: #ecdcb9; padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; border: 1.5px solid #4a2711; text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; height: fit-content; line-height: normal; user-select: none;">
                        ${T('Shop.back')}
                    </div>
                    <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${T('Shop.shop')}</h2>
                </div>
                <div id="shop-funds" style="font-size: 17px; font-family: 'Lora', serif; text-align: center; margin-top: -10px; margin-bottom: 12px; font-weight: bold; color: #5e2f17; letter-spacing: 0.5px;">
                    ${T('Shop.availableFunds')} <span style="color: #27ae60;">0.00 €</span>
                </div>
                <div class="shop-tabs">
                    <div class="shop-tab" id="tab-buy">${T('Shop.acquireGoods')}</div>
                    <div class="shop-tab" id="tab-sell">${T('Shop.liquidateAssets')}</div>
                </div>
                <div id="shop-categories-container"></div>
                <div class="catalog-viewport" style="flex: 1; overflow-y: auto; padding-right: 4px;"></div>
            </div>
            
            <div class="shop-right" style="flex: 2; padding: 10px 20px 10px 30px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; height: 100%;">
                <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 8px; margin-bottom: 20px; min-height: 40px;">
                    <h2 class="title" style="border: none; margin: 0; padding: 0; text-align: center;">${T('Shop.description')}</h2>
                </div>
                <div id="detail-viewport" style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;"></div>
            </div>
            
            <div id="modal-viewport"></div>
        </div>
      `;

    // Every handler below runs from the browser, outside the game loop, so each
    // one first asks whether this scene is still the one on screen and still
    // holds its windows.
    const onShopClick = (selector, handler) => {
      const node = container.querySelector(selector);
      if (!node) {
        warnOnce("missing element " + selector, null);
        return;
      }
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        if (SceneManager._scene !== this || !this.isShopReady()) return;
        safe("click " + selector, () => handler(), null);
      });
    };

    // Back Button click
    onShopClick("#shop-close-btn", () => this.cancelShopAction());

    // Tab clicks
    onShopClick("#tab-buy", () => {
      if (!this._buyWindow.active) {
        SoundManager.playOk();
        this.switchToBuy();
      }
    });

    onShopClick("#tab-sell", () => {
      const isSellMode = this._sellWindow.active || this._categoryWindow.active;
      if (!isSellMode) {
        SoundManager.playOk();
        this.switchToSell();
      }
    });

    // Mousewheel Scroll support for catalog viewport
    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const viewport = container.querySelector(".catalog-viewport");
      if (viewport) {
        viewport.scrollTop += e.deltaY;
      }
    }, { passive: false });
  };

  // While the quantity modal is open the buy/sell windows are deactivated, so the
  // active-window flags can't tell us which tab we're on. Fall back to the command
  // window's current symbol so the background keeps the correct tab during a purchase.
  Scene_Shop.prototype.isShopBuyMode = function () {
    if (this._numberWindow && this._numberWindow.active) {
      return this._commandWindow.currentSymbol() === "buy";
    }
    return this._buyWindow.active;
  };

  Scene_Shop.prototype.isShopSellMode = function () {
    if (this._numberWindow && this._numberWindow.active) {
      return this._commandWindow.currentSymbol() === "sell";
    }
    return this._sellWindow.active || this._categoryWindow.active;
  };

  Scene_Shop.prototype.buyData = function () {
    return (this._buyWindow && this._buyWindow._data) || [];
  };

  Scene_Shop.prototype.sellData = function () {
    return (this._sellWindow && this._sellWindow._data) || [];
  };

  Scene_Shop.prototype.getShopStateHash = function () {
    const isBuyMode = this.isShopBuyMode();
    const isSellMode = this.isShopSellMode();
    const buyIdx = this._buyWindow.index();
    const sellIdx = this._sellWindow.index();
    const catIdx = this._categoryWindow.index();
    const numActive = this._numberWindow.active;
    const numVal = this._numberWindow.number();
    const numMax = this._numberWindow.max();
    const partyGold = $gameParty.gold();
    const buyData = this.buyData();
    const sellData = this.sellData();
    const stockHash = buyData.map(item => this.getStock(item)).join(",");
    // One pass over the party's gear per frame instead of one per listed item.
    const worn = wornCounts();
    const ownedHash = sellData.map(item => $gameParty.numItems(item) + (worn.get(item) || 0)).join(",");

    const sellCatFocus = this._sellCategoryFocus || false;
    return `${isBuyMode}_${isSellMode}_${buyIdx}_${sellIdx}_${catIdx}_${numActive}_${numVal}_${numMax}_${partyGold}_${buyData.length}_${sellData.length}_${stockHash}_${ownedHash}_${sellCatFocus}`;
  };

  Scene_Shop.prototype.syncUIShopState = function () {
    if (!this.isShopReady()) return;
    const container = this.shopContainer();
    if (!container) return;

    // This runs once a frame off live game data. An exception used to throw
    // again on the next frame, and the next, until the game died; here the
    // overlay is rebuilt once and, if that fails too, the shop closes cleanly
    // rather than taking the session with it.
    try {
      this.renderUIShopState(container);
      this._shopRenderFailures = 0;
    } catch (e) {
      warnOnce("syncUIShopState", e);
      this._shopRenderFailures = (this._shopRenderFailures || 0) + 1;
      if (this._shopRenderFailures === 1) {
        // Rebuild now, draw on the next frame: re-entering the renderer from
        // inside its own catch would only nest the failure.
        safe("rebuild overlay", () => {
          this.initUIShopDOM();
          this._lastShopStateHash = null;
        }, null);
      } else {
        console.error("[ItemSystemShop] overlay cannot be drawn, closing the shop.", e);
        this.closeShop();
      }
    }
  };

  Scene_Shop.prototype.renderUIShopState = function (container) {
    const hash = this.getShopStateHash();
    if (this._lastShopStateHash === hash) return;
    this._lastShopStateHash = hash;


    const isBuyMode = this.isShopBuyMode();
    const isSellMode = this.isShopSellMode();
    const activeIndex = isBuyMode ? this._buyWindow.index() : this._sellWindow.index();

    // 1. Update Gold/Funds
    const currentGold = $gameParty.gold();
    const fundsNode = container.querySelector("#shop-funds");
    if (this._renderedGold !== currentGold && fundsNode) {
      this._renderedGold = currentGold;
      fundsNode.innerHTML = `${esc(T('Shop.availableFunds'))}<span style="color: #27ae60;">${money(currentGold)} €</span>`;
    }

    // 2. Update Tabs active state & Category Buttons
    let forceListRedraw = false;
    if (this._renderedIsBuyMode !== isBuyMode) {
      this._renderedIsBuyMode = isBuyMode;
      forceListRedraw = true;

      const tabBuy = container.querySelector("#tab-buy");
      const tabSell = container.querySelector("#tab-sell");
      if (tabBuy) tabBuy.classList.toggle("active", isBuyMode);
      if (tabSell) tabSell.classList.toggle("active", !isBuyMode);

      // Populate or clear categories container
      const catContainer = container.querySelector("#shop-categories-container");
      if (catContainer && isSellMode) {
        const catIdx = this._categoryWindow.index();
        const labels = T.list('Shop.sellCategories');

        let categoriesHTML = `<div class="shop-categories" style="display: flex; gap: 6px; margin-bottom: 12px;">`;
        labels.forEach((lbl, idx) => {
          const activeClass = catIdx === idx ? 'active' : '';
          categoriesHTML += `<div class="category-btn ${activeClass}" data-idx="${idx}" style="flex: 1; font-family: 'Lora', serif; font-size: 0.85em; padding: 6px 2px; text-align: center; cursor: pointer;">${esc(lbl)}</div>`;
        });
        categoriesHTML += `</div>`;
        catContainer.innerHTML = categoriesHTML;

        // Bind category button clicks
        catContainer.querySelectorAll(".category-btn").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (SceneManager._scene !== this || !this.isShopReady()) return;
            safe("category click", () => {
              const idx = parseInt(btn.getAttribute("data-idx"), 10);
              if (!Number.isFinite(idx)) return;
              SoundManager.playOk();
              this._categoryWindow.select(idx);
              this._categoryWindow.deactivate();
              this._sellWindow.activate();
              this._sellWindow.setCategory(this._categoryWindow.currentSymbol());
              this._sellCategoryFocus = false;
              this._sellWindow.select(0);
              this.refreshUIShop();
            }, null);
          });
        });
      } else if (catContainer) {
        catContainer.innerHTML = "";
      }
    }

    // 3. Update Category selection
    if (isSellMode) {
      const catIdx = this._categoryWindow.index();
      const sellCatFocus = this._sellCategoryFocus || false;
      if (this._renderedCategoryIndex !== catIdx || this._renderedSellCategoryFocus !== sellCatFocus) {
        this._renderedCategoryIndex = catIdx;
        this._renderedSellCategoryFocus = sellCatFocus;
        forceListRedraw = true;

        const btns = container.querySelectorAll(".category-btn");
        btns.forEach((btn, idx) => {
          if (idx === catIdx) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });

        const shopCats = container.querySelector(".shop-categories");
        if (shopCats) {
          shopCats.style.outline = sellCatFocus ? "2px solid #8b5a2b" : "";
          shopCats.style.outlineOffset = sellCatFocus ? "2px" : "";
          shopCats.style.borderRadius = sellCatFocus ? "4px" : "";
        }
      }
    } else {
      this._renderedCategoryIndex = null;
      this._renderedSellCategoryFocus = null;
    }

    // 4. Verify if items data changed
    const worn = wornCounts();
    const listLength = isBuyMode ? this.buyData().length : this.sellData().length;
    const stockHash = this.buyData().map(item => this.getStock(item)).join(",");
    const ownedHash = this.sellData().map(item => $gameParty.numItems(item) + (worn.get(item) || 0)).join(",");

    if (
      this._renderedListLength !== listLength ||
      this._renderedStockHash !== stockHash ||
      this._renderedOwnedHash !== ownedHash
    ) {
      this._renderedListLength = listLength;
      this._renderedStockHash = stockHash;
      this._renderedOwnedHash = ownedHash;
      forceListRedraw = true;
    }

    // 5. Redraw Item Cards List if forced
    const viewport = container.querySelector(".catalog-viewport");
    if (forceListRedraw && viewport) {
      let itemsHTML = "";
      if (isBuyMode) {
        const buyData = this.buyData();
        if (buyData.length === 0) {
          itemsHTML = `<div style="text-align:center; color:#8c7667; margin-top:40px; font-style:italic;">${esc(T('Shop.noProductsOnSale'))}</div>`;
        } else {
          buyData.forEach((item, idx) => {
            if (!item) return;
            const focusedClass = activeIndex === idx ? 'focused' : '';
            const price = this._buyWindow.price(item);
            const stock = this.getStock(item);
            const owned = $gameParty.numItems(item);
            const stockValText = stock === UNLIMITED_STOCK ? "∞" : stock;
            const stockDisplay = T('Shop.ownedStock', { owned: owned, stock: stockValText });

            itemsHTML += `
              <div class="item-card ${focusedClass}" data-idx="${idx}" data-mode="buy" style="border-left: 4px solid ${rarityColor(item)};">
                  <div class="item-card-left">
                      <div class="item-card-icon" style="${this.getIconStyle(item.iconIndex)}"></div>
                      <div class="item-card-info">
                          <span class="item-card-name">${esc(item.name)}</span>
                          <span class="item-card-sub">${esc(categoryOf(item) || T('Shop.asset'))}</span>
                      </div>
                  </div>
                  <div class="item-card-right">
                      <span class="item-card-price">${money(price)} €</span>
                      <span class="item-card-stock" style="font-size: 12px; opacity: 0.95; margin-top: 2px;">${esc(stockDisplay)}</span>
                  </div>
              </div>
            `;
          });
        }
      } else {
        const sellData = this.sellData();
        if (sellData.length === 0) {
          itemsHTML = `<div style="text-align:center; color:#8c7667; margin-top:40px; font-style:italic;">${esc(T('Shop.inventoryEmpty'))}</div>`;
        } else {
          sellData.forEach((item, idx) => {
            if (!item) return;
            const focusedClass = activeIndex === idx && this._sellWindow.active ? 'focused' : '';
            // Match the gold the player actually receives (sellingPrice()),
            // including the NPC-trade sell factor, so the card doesn't lie.
            const price = baseSellPrice(item);
            const wornHere = worn.get(item) || 0;
            const owned = $gameParty.numItems(item) + wornHere;
            const stock = this.getStock(item);
            const stockValText = stock === UNLIMITED_STOCK ? "∞" : stock;
            let stockDisplay = T('Shop.ownedStock', { owned: owned, stock: stockValText });
            // Gear on someone's back is sellable too, but say so: the sale
            // takes it off them.
            if (wornHere > 0) stockDisplay += ` ${T('Shop.wornCount', { count: wornHere })}`;

            itemsHTML += `
              <div class="item-card ${focusedClass}" data-idx="${idx}" data-mode="sell" style="border-left: 4px solid ${rarityColor(item)};">
                  <div class="item-card-left">
                      <div class="item-card-icon" style="${this.getIconStyle(item.iconIndex)}"></div>
                      <div class="item-card-info">
                          <span class="item-card-name">${esc(item.name)}</span>
                          <span class="item-card-sub">${esc(formatWeight(weightOf(item)))}</span>
                      </div>
                  </div>
                  <div class="item-card-right">
                      <span class="item-card-price">${money(price)} €</span>
                      <span class="item-card-stock" style="font-size: 12px; opacity: 0.95; margin-top: 2px;">${esc(stockDisplay)}</span>
                  </div>
              </div>
            `;
          });
        }
      }
      viewport.innerHTML = itemsHTML;

      // Card clicks event listeners
      viewport.querySelectorAll(".item-card").forEach(card => {
        card.addEventListener("click", (e) => {
          e.stopPropagation();
          if (SceneManager._scene !== this || !this.isShopReady()) return;
          safe("card click", () => {
            const idx = parseInt(card.getAttribute("data-idx"), 10);
            if (!Number.isFinite(idx)) return;
            const mode = card.getAttribute("data-mode");
            const win = mode === "buy" ? this._buyWindow : this._sellWindow;
            if (win.index() !== idx) {
              win.select(idx);
              SoundManager.playCursor();
              this.refreshUIShop();
            } else {
              win.processOk();
            }
          }, null);
        });
      });
    }

    // 6. Update focus class and scroll if index changed
    if (viewport && (this._renderedSelectedIndex !== activeIndex || forceListRedraw)) {
      this._renderedSelectedIndex = activeIndex;

      viewport.querySelectorAll(".item-card").forEach((card, idx) => {
        if (idx === activeIndex) {
          card.classList.add("focused");
          // Smooth scroll into viewport if not visible
          card.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
          card.classList.remove("focused");
        }
      });
    }

    // 7. Update Item Detail Viewport on Right Page
    const selectedItem = isBuyMode ? this._buyWindow.item() : this._sellWindow.item();
    const detailViewport = container.querySelector("#detail-viewport");
    if (detailViewport && (this._renderedDetailItem !== selectedItem || forceListRedraw)) {
      this._renderedDetailItem = selectedItem;

      if (selectedItem) {
        const isFood = safe("isFoodItem", () => utils.isFoodItem(selectedItem), false);
        const category = categoryOf(selectedItem) || T('Shop.item');
        const weight = formatWeight(weightOf(selectedItem));

        let scaleBadgeHTML = "";
        if (DataManager.isWeapon(selectedItem) && this._itemDetailWindow) {
          const scaling = this._itemDetailWindow.getWeaponScalingType(selectedItem);
          if (scaling) {
            scaleBadgeHTML = `
              <div class="detail-spec-badge">
                  <span class="badge-lbl">${esc(T('Shop.ui.scale'))}</span>
                  <span class="badge-val">${esc(scaling)}</span>
              </div>
            `;
          }
        }

        let slotBadgeHTML = "";
        if (DataManager.isWeapon(selectedItem) || DataManager.isArmor(selectedItem)) {
          const slotName = translate(equipTypeName(selectedItem.etypeId));
          slotBadgeHTML = `
            <div class="detail-spec-badge">
                <span class="badge-lbl">${esc(T('Shop.slot'))}</span>
                <span class="badge-val">${esc(slotName || T('Shop.equipSlot'))}</span>
            </div>
          `;
        }

        let descHTML = "";
        if (selectedItem.description) {
          descHTML = `<div class="detail-desc">${esc(translate(selectedItem.description))}</div>`;
        }

        // Procedural lore (resolves {nation}/{leader}/... tokens) shown below the description.
        const loreText = loreOf(selectedItem);
        if (loreText) descHTML += `<div class="detail-lore" style="font-style:italic;opacity:0.75;margin-top:4px;">${esc(loreText)}</div>`;

        // Params
        let paramsHTML = "";
        const baseParams = [2, 3, 4, 5, 6, 7];
        const paramNames = [_si18n("ATT"), _si18n("DEF"), _si18n("M.ATT"), _si18n("M.DEF"), _si18n("AGILITY"), _si18n("LUCK")];
        let hasParams = false;

        baseParams.forEach((paramId, pIdx) => {
          let val = 0;
          if (DataManager.isWeapon(selectedItem)) {
            val = modifiedParamOf(selectedItem, paramId);
          } else if (DataManager.isArmor(selectedItem)) {
            val = paramOf(selectedItem, paramId);
          }

          if (val !== 0) {
            hasParams = true;
            const sign = val > 0 ? "+" : "";
            const barPct = Math.max(5, Math.min(100, (Math.abs(val) / 40) * 100));
            const color = val > 0 ? "#27ae60" : "#e74c3c";

            paramsHTML += `
              <div class="gauge-row">
                  <span style="font-weight:bold; width:50px;">${esc(paramNames[pIdx])}</span>
                  <div class="gauge-bar-outer">
                      <div class="gauge-bar-inner" style="width:${barPct}%; background:${color};"></div>
                  </div>
                  <span style="font-weight:bold; width:35px; text-align:right; color:${color};">${sign}${val}</span>
              </div>
            `;
          }
        });

        let combatSectionHTML = "";
        if (hasParams) {
          combatSectionHTML = `
            <div class="gauges-section">
                <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                    ${T('Shop.itemParameters')}
                </div>
                ${paramsHTML}
            </div>
          `;
        }

        // Food & Nutrition
        let nutritionSectionHTML = "";
        if (isFood) {
          const calories = safe("nutrition", () => utils.getNutritionValue(selectedItem, "calories"), 0);
          const protein = safe("nutrition", () => utils.getNutritionValue(selectedItem, "protein"), 0);
          const fat = safe("nutrition", () => utils.getNutritionValue(selectedItem, "fat"), 0);

          let nutGauges = "";
          if (calories > 0) {
            const calPct = Math.max(5, Math.min(100, (calories / 800) * 100));
            nutGauges += `
              <div class="gauge-row">
                  <span style="font-weight:500; width:70px;">${T('Shop.calories')}</span>
                  <div class="gauge-bar-outer">
                      <div class="gauge-bar-inner" style="width:${calPct}%; background:#d35400;"></div>
                  </div>
                  <span style="font-weight:bold; width:60px; text-align:right; color:#d35400;">${calories} kcal</span>
              </div>
            `;
          }
          if (protein > 0) {
            const protPct = Math.max(5, Math.min(100, (protein / 30) * 100));
            nutGauges += `
              <div class="gauge-row">
                  <span style="font-weight:500; width:70px;">${T('Shop.protein')}</span>
                  <div class="gauge-bar-outer">
                      <div class="gauge-bar-inner" style="width:${protPct}%; background:#27ae60;"></div>
                  </div>
                  <span style="font-weight:bold; width:60px; text-align:right; color:#27ae60;">${protein}g</span>
              </div>
            `;
          }
          if (fat > 0) {
            const fatPct = Math.max(5, Math.min(100, (fat / 25) * 100));
            nutGauges += `
              <div class="gauge-row">
                  <span style="font-weight:500; width:70px;">${T('Shop.fat')}</span>
                  <div class="gauge-bar-outer">
                      <div class="gauge-bar-inner" style="width:${fatPct}%; background:#e67e22;"></div>
                  </div>
                  <span style="font-weight:bold; width:60px; text-align:right; color:#e67e22;">${fat}g</span>
              </div>
            `;
          }

          if (nutGauges) {
            nutritionSectionHTML = `
              <div class="gauges-section">
                  <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                      ${T('Shop.vitalNutritionMetrics')}
                  </div>
                  ${nutGauges}
              </div>
            `;
          }
        }

        // Needs restored (non-food consumables: Sleep / Hygiene / Social / Fun)
        let needsSectionHTML = "";
        const needRestores = needRestoresOf(selectedItem);
        if (needRestores.length) {
          const needGauges = needRestores.map(r => `
              <div class="gauge-row">
                  <span style="font-weight:500; width:70px;">${esc(r.label)}</span>
                  <div class="gauge-bar-outer">
                      <div class="gauge-bar-inner" style="width:${r.amount}%; background:${r.color};"></div>
                  </div>
                  <span style="font-weight:bold; width:60px; text-align:right; color:${r.color};">+${r.amount}%</span>
              </div>`).join("");
          needsSectionHTML = `
              <div class="gauges-section">
                  <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                      ${T('Shop.needsRestored')}
                  </div>
                  ${needGauges}
              </div>
            `;
        }

        // Cravings fed (nicotine, drink, caffeine, narcotics, a bet)
        const cravingRelief = addictionReliefOf(selectedItem);
        if (cravingRelief.length) {
          const cravingGauges = cravingRelief.map(r => `
              <div class="gauge-row">
                  <span style="font-weight:500; width:70px;">${esc(r.label)}</span>
                  <div class="gauge-bar-outer">
                      <div class="gauge-bar-inner" style="width:${r.amount}%; background:#7B6A55;"></div>
                  </div>
                  <span style="font-weight:bold; width:60px; text-align:right; color:#7B6A55;">-${r.amount}%</span>
              </div>`).join("");
          needsSectionHTML += `
              <div class="gauges-section">
                  <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                      ${T('Shop.cravingsFed')}
                  </div>
                  ${cravingGauges}
              </div>
            `;
        }

        // Effects / Traits
        let effectsHTML = "";
        let hasEffects = false;

        const detail = this._itemDetailWindow;
        if (detail && Array.isArray(selectedItem.effects)) {
          selectedItem.effects.forEach(eff => {
            const effStr = safe("getEffectDescription", () => detail.getEffectDescription(eff), null);
            if (effStr) {
              hasEffects = true;
              effectsHTML += `<div style="margin-bottom:6px; font-size:13px; color:#5c4033;">✦ ${esc(effStr)}</div>`;
            }
          });
        }

        if (detail && Array.isArray(selectedItem.traits)) {
          selectedItem.traits.forEach(tr => {
            const trStr = safe("getTraitDescription", () => detail.getTraitDescription(tr), null);
            if (trStr) {
              hasEffects = true;
              effectsHTML += `<div style="margin-bottom:6px; font-size:13px; color:#5c4033;">✦ ${esc(trStr)}</div>`;
            }
          });
        }

        let effectsSectionHTML = "";
        if (hasEffects) {
          effectsSectionHTML = `
            <div style="margin-bottom:18px;">
                <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                    ${T('Shop.signalsChemicalProperties')}
                </div>
                <div style="background:rgba(0,0,0,0.015); border:1px solid rgba(94,47,23,0.06); border-radius:4px; padding:10px 14px;">
                    ${effectsHTML}
                </div>
            </div>
          `;
        }

        // Compatibility
        let compatibilityHTML = "";
        if (DataManager.isWeapon(selectedItem) || DataManager.isArmor(selectedItem)) {
          let comps = "";

          partyMembers().forEach(actor => {
            const canEquip = isProficientWith(actor, selectedItem);
            const color = canEquip ? "#27ae60" : "rgba(94,47,23,0.4)";
            const dot = canEquip ? "●" : "○";

            comps += `
              <div style="display:flex; align-items:center; gap:8px; font-size:13px; color:${color}; font-weight:${canEquip ? 'bold' : 'normal'};">
                  <span>${dot}</span>
                  <span>${esc(actorLabel(actor))}</span>
              </div>
            `;
          });

          compatibilityHTML = `
            <div style="margin-bottom:10px;">
                <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                    ${esc(T('Shop.compatibilityLedger'))}
                </div>
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; padding-left:4px;">
                    ${comps}
                </div>
            </div>
          `;
        }

        detailViewport.innerHTML = `
          <div class="detail-scroll" style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto;">
              <div class="detail-header">
                  <div class="item-card-icon" style="${this.getIconStyle(selectedItem.iconIndex)} scale: 1.25;"></div>
                  <div class="detail-info">
                      <span class="detail-name">${esc(selectedItem.name)}</span>
                  </div>
              </div>

              <div class="detail-spec-grid">
                  <div class="detail-spec-badge">
                      <span class="badge-lbl">${esc(T('Shop.ui.type'))}</span>
                      <span class="badge-val">${esc(category)}</span>
                  </div>
                  <div class="detail-spec-badge">
                      <span class="badge-lbl">${esc(T('Shop.ui.weight'))}</span>
                      <span class="badge-val">${esc(weight)}</span>
                  </div>
                  ${scaleBadgeHTML}
                  ${slotBadgeHTML}
              </div>
              
              ${descHTML}
              ${combatSectionHTML}
              ${nutritionSectionHTML}
              ${needsSectionHTML}
              ${effectsSectionHTML}
              ${compatibilityHTML}
              
              <div class="action-btn confirm" id="right-action-btn" style="margin-top: auto; font-size: 16px; padding: 12px 6px; flex-shrink: 0; flex: none;">
                  ${esc(isBuyMode ? T('Shop.buy') : T('Shop.sell'))}
              </div>
          </div>
        `;

        // Bind BUY/SELL action button
        const actBtn = detailViewport.querySelector("#right-action-btn");
        if (actBtn) {
          actBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (SceneManager._scene !== this || !this.isShopReady()) return;
            safe("action button", () => {
              const win = isBuyMode ? this._buyWindow : this._sellWindow;
              win.processOk();
            }, null);
          });
        }
      } else {
        detailViewport.innerHTML = `
          <div class="detail-scroll" style="flex: 1; min-height: 0; justify-content:center; align-items:center; text-align:center; color:#8c7667; font-style:italic; display: flex; flex-direction: column;">
              <div style="font-size:36px; margin-bottom:12px; opacity:0.35;"></div>
              <span>${esc(T('Shop.hoverOrSelectAnItem'))}</span>
          </div>
        `;
      }
    }

    // 8. Update Quantity Modal Overlay
    const modalViewport = container.querySelector("#modal-viewport");
    if (!modalViewport) return;

    const numberWindow = this._numberWindow;
    const modalActive = numberWindow.active;
    const modalNum = modalActive ? numberWindow.number() : 0;
    const modalMax = modalActive ? numberWindow.max() : 0;
    const unitPrice = Number.isFinite(numberWindow._price) ? numberWindow._price : 0;

    const modalStateChanged = this._renderedQuantityActive !== modalActive || this._renderedQuantityMax !== modalMax;

    if (!modalStateChanged && this._renderedQuantityNumber !== modalNum) {
      this._renderedQuantityNumber = modalNum;
      const qtyDisplay = modalViewport.querySelector(".qty-val-display");
      if (qtyDisplay) qtyDisplay.textContent = modalNum;
      const totalDisplay = modalViewport.querySelector(".card-val");
      if (totalDisplay) totalDisplay.textContent = money(modalNum * unitPrice) + " €";
    } else if (modalStateChanged) {
      this._renderedQuantityActive = modalActive;
      this._renderedQuantityNumber = modalNum;
      this._renderedQuantityMax = modalMax;

      // A modal with nothing to price is not a modal: the number window can be
      // active with its item already gone (a stock refresh mid-purchase).
      if (modalActive && numberWindow._item) {
        const numItem = numberWindow._item;
        const totalCost = modalNum * unitPrice;

        // When the quantity modal is open, the buy window is deactivated
        // (the number window is active instead), so _buyWindow.active is
        // unreliable here. Use the command window's selection to detect mode.
        const isModalBuyMode = this._commandWindow.currentSymbol() === "buy";

        const promptTitle = isModalBuyMode ? T('Shop.buy') : T('Shop.sell');
        const subLabel = isModalBuyMode ? T('Shop.totalCost') : T('Shop.sellValue');

        modalViewport.innerHTML = `
          <div class="modal-overlay">
              <div class="quantity-box">
                  <h3 class="quantity-title">${esc(promptTitle)}</h3>
                  <div style="font-weight:bold; font-size:15px; color:var(--text-success-active); margin-bottom:10px;">${esc(numItem.name)}</div>

                  <div class="quantity-slider-row">
                      <div class="qty-arrow" id="qty-dec">－</div>
                      <div class="qty-val-display">${modalNum}</div>
                      <div class="qty-arrow" id="qty-inc">＋</div>
                  </div>

                  <div style="font-size:12px; color:var(--text-info); margin-bottom:14px;">${esc(T('Shop.max'))} ${modalMax}</div>

                  <div style="border-top:1px dashed var(--border-subtle-translucent-30); padding-top:12px; margin-top:14px;">
                      <div class="card-lbl">${esc(subLabel)}</div>
                      <div class="card-val" style="font-size:22px; color:${isModalBuyMode ? 'var(--text-cost-bad)' : 'var(--text-cost-ok)'};">${money(totalCost)} €</div>
                  </div>

                  <div class="quantity-actions">
                      <div class="action-btn confirm" id="qty-confirm">${esc(T('Shop.confirmTransaction'))}</div>
                      <div class="action-btn cancel" id="qty-cancel">${esc(T('Shop.cancel'))}</div>
                  </div>
              </div>
          </div>
        `;

        const onModalClick = (selector, handler) => {
          const node = modalViewport.querySelector(selector);
          if (!node) {
            warnOnce("missing element " + selector, null);
            return;
          }
          node.addEventListener("click", (e) => {
            e.stopPropagation();
            if (SceneManager._scene !== this || !this.isShopReady()) return;
            if (!this._numberWindow.active) return;
            safe("click " + selector, () => handler(this._numberWindow), null);
          });
        };

        // Click Arrow inc, partial update only, no full redraw
        onModalClick("#qty-inc", (w) => {
          if (w.number() < w.max()) {
            w.changeNumber(1);
            SoundManager.playCursor();
            this._updateQuantityModalNumber();
          }
        });

        // Click Arrow dec, partial update only, no full redraw.
        // Pressing minus at 1 wraps to the maximum available quantity.
        onModalClick("#qty-dec", (w) => {
          if (w.number() > 1) {
            w.changeNumber(-1);
          } else {
            w.changeNumber(w.max() - w.number());
          }
          SoundManager.playCursor();
          this._updateQuantityModalNumber();
        });

        onModalClick("#qty-confirm", (w) => {
          w.processOk();
          this.refreshUIShop();
        });

        onModalClick("#qty-cancel", (w) => {
          w.processCancel();
          this.refreshUIShop();
        });
      } else {
        modalViewport.innerHTML = "";
      }
    }
  };

  Scene_Shop.prototype.refreshUIShop = function () {
    this._lastShopStateHash = null;
    this._renderedIsBuyMode = null;
    this._renderedCategoryIndex = null;
    this._renderedSellCategoryFocus = null;
    this._renderedGold = null;
    this._renderedListLength = null;
    this._renderedStockHash = null;
    this._renderedOwnedHash = null;
    this._renderedSelectedIndex = null;
    this._renderedDetailItem = null;
    this._renderedQuantityActive = null;
    this._renderedQuantityNumber = null;
    this._renderedQuantityMax = null;
    this.syncUIShopState();
  };

  Scene_Shop.prototype._updateQuantityModalNumber = function () {
    const container = this.shopContainer();
    if (!container || !this._numberWindow) return;
    const modalViewport = container.querySelector("#modal-viewport");
    if (!modalViewport) return;
    const modalNum = this._numberWindow.number();
    const price = Number.isFinite(this._numberWindow._price) ? this._numberWindow._price : 0;
    const qtyDisplay = modalViewport.querySelector(".qty-val-display");
    if (qtyDisplay) qtyDisplay.textContent = modalNum;
    const totalDisplay = modalViewport.querySelector(".card-val");
    if (totalDisplay) totalDisplay.textContent = money(modalNum * price) + " €";
    this._renderedQuantityNumber = modalNum;
  };

  Scene_Shop.prototype.getIconStyle = function (iconIndex) {
    const iconSize = 32;
    const cols = 16;
    const index = Number.isFinite(iconIndex) && iconIndex >= 0 ? Math.floor(iconIndex) : 0;
    const x = (index % cols) * iconSize;
    const y = Math.floor(index / cols) * iconSize;
    return `background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; image-rendering: pixelated; display: inline-block;`;
  };


  //=============================================================================
  // Override Window_ShopBuy draw items & draws
  //=============================================================================

  Window_ShopBuy.prototype.drawItem = function (index) {
    const item = this.itemAt(index);
    if (!item) return;
    const priceValue = this.price(item);
    const rect = this.itemLineRect(index);
    const scene = SceneManager._scene;
    const stock = (scene instanceof Scene_Shop) ? scene.getStock(item) : UNLIMITED_STOCK;
    const stockText = stock === UNLIMITED_STOCK ? "" : "x" + stock;

    const unit = $dataSystem.currencyUnit;
    const priceDisplay = this.formatMoneyValue(priceValue) + unit;
    const priceWidth = 120;
    const stockWidth = 60;
    const nameWidth = rect.width - priceWidth - stockWidth - this.itemPadding() * 2;

    this.changePaintOpacity(this.isEnabled(item));

    // The name is passed in, never written onto the item: assigning to
    // item.name edits the shared $dataItems/$dataWeapons entry, and any throw
    // between the two assignments left the truncated name in the database for
    // the rest of the session.
    const displayName = this.truncateItemName ? this.truncateItemName(item.name) : item.name;
    this.drawItemName(item, rect.x, rect.y, nameWidth, displayName);

    this.drawText(priceDisplay, rect.x + rect.width - priceWidth - stockWidth - 10, rect.y, priceWidth, "right");

    if (stockText) {
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(stockText, rect.x + rect.width - stockWidth, rect.y, stockWidth, "right");
      this.resetTextColor();
    }

    this.changePaintOpacity(true);
  };

  Window_ShopBuy.prototype.drawItemName = function (item, x, y, width, displayName) {
    if (item) {
      const iconY = y + (this.lineHeight() - ImageManager.iconHeight) / 2;
      const textMargin = ImageManager.iconWidth + 4;
      const itemWidth = width || this.innerWidth - textMargin;

      this.resetTextColor();
      this.drawIcon(item.iconIndex || 0, x, iconY);
      this.changeTextColor(rarityColor(item));
      this.drawText(displayName || item.name || "", x + textMargin, y, itemWidth);
      this.resetTextColor();
    }
  };

  //=============================================================================
  // Override Sell Window
  //=============================================================================

  Window_ShopSell.prototype.maxCols = function () {
    return 1;
  };

  Window_ShopSell.prototype.itemHeight = function () {
    return this.lineHeight();
  };

  Window_ShopSell.prototype.drawItem = function (index) {
    const item = this.itemAt(index);
    if (!item) return;
    const rect = this.itemLineRect(index);
    const x = rect.x + this.itemPadding();
    const y = rect.y;
    const width = rect.width - this.itemPadding() * 2;

    const priceWidth = 120;
    const priceText = this.formatMoneyValue(baseSellPrice(item)) + " €";

    const nameWidth = width - priceWidth - 10;
    this.changePaintOpacity(this.isEnabled(item));
    // The widest item name the price column leaves room for, in characters.
    const maxNameLength = 18;
    const displayName = safe("truncate", () => utils.truncateTextWithEllipsis(item.name || "", maxNameLength), item.name);
    this.drawItemName(item, x, y, nameWidth, displayName);
    this.changePaintOpacity(true);

    this.drawText(priceText, x + width - priceWidth, y, priceWidth, 'right');

    const grams = weightOf(item);
    if (grams > 1) {
      const weightStr = formatWeight(grams);
      const weightY = y + this.lineHeight();
      const weightWidth = 100;
      this.drawText(weightStr, x + width - weightWidth, weightY, weightWidth, 'right');
    }

    this.changePaintOpacity(true);
  };

  Window_ShopSell.prototype.drawItemName = function (item, x, y, width, displayName) {
    if (item) {
      const iconY = y + (this.lineHeight() - ImageManager.iconHeight) / 2;
      const textMargin = ImageManager.iconWidth + 4;
      const itemWidth = Math.max(0, width - textMargin);
      this.resetTextColor();
      this.drawIcon(item.iconIndex || 0, x, iconY);
      this.changeTextColor(rarityColor(item));
      this.drawText(displayName || item.name || "", x + textMargin, y, itemWidth);
      this.resetTextColor();
    }
  };

  const _Scene_Shop_sellWindowRect = Scene_Shop.prototype.sellWindowRect;
  Scene_Shop.prototype.sellWindowRect = function () {
    const rect = _Scene_Shop_sellWindowRect.call(this);
    return rect;
  };

  window.Window_ItemDetail = Window_ItemDetail;

  // Remove Cancel from command window
  Window_ShopCommand.prototype.makeCommandList = function () {
    this.addCommand(TextManager.buy, "buy");
    this.addCommand(TextManager.sell, "sell");
  };

  Window_ShopCommand.prototype.maxCols = function () {
    return 2;
  };

  Window_ShopCommand.prototype.processTouch = function () {
    if (this.isOpen()) {
      const hitIndex = this.hitIndex();
      if (hitIndex >= 0) {
        if (TouchInput.isHovered()) {
          this.select(hitIndex);
        }
        if (TouchInput.isTriggered()) {
          this.select(hitIndex);
          this.processOk();
        }
      }
    }
  };

  const _Scene_Shop_start = Scene_Shop.prototype.start;
  Scene_Shop.prototype.start = function () {
    _Scene_Shop_start.call(this);
    if (!this.isShopReady()) return;
    // The command window is the tab bar the overlay draws for itself, so it is
    // never given focus: the shop opens straight onto the buy list.
    this._commandWindow.deactivate();
    this._commandWindow.select(0);
    this.commandBuy();
  };

  Window_ShopBuy.prototype.cursorRight = function (wrap) {
    if (SceneManager._scene instanceof Scene_Shop) {
      SceneManager._scene.switchToSell();
    }
  };

  Window_ShopBuy.prototype.cursorPagedown = function () {
    if (SceneManager._scene instanceof Scene_Shop) {
      SoundManager.playCursor();
      SceneManager._scene.switchToSell();
    }
  };

  Window_ShopBuy.prototype.cursorPageup = function () {};

  Window_ShopSell.prototype.cursorLeft = function (wrap) {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Shop) || !scene.isShopReady()) return;
    if (scene._sellCategoryFocus) {
      const catIdx = scene._categoryWindow.index();
      if (catIdx > 0) {
        SoundManager.playCursor();
        scene._categoryWindow.select(catIdx - 1);
        scene._sellWindow.setCategory(scene._categoryWindow.currentSymbol());
        scene._sellWindow.select(-1);
        scene._sellWindow.refresh();
        scene.refreshUIShop();
      } else {
        scene.switchToBuy();
      }
    } else {
      scene._sellCategoryFocus = true;
      scene._sellWindow.select(-1);
      SoundManager.playCursor();
      scene.refreshUIShop();
    }
  };

  Window_ShopSell.prototype.cursorRight = function (wrap) {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Shop) || !scene.isShopReady()) return;
    if (scene._sellCategoryFocus) {
      const catIdx = scene._categoryWindow.index();
      const maxIdx = scene._categoryWindow.maxItems() - 1;
      if (catIdx < maxIdx) {
        SoundManager.playCursor();
        scene._categoryWindow.select(catIdx + 1);
        scene._sellWindow.setCategory(scene._categoryWindow.currentSymbol());
        scene._sellWindow.select(-1);
        scene._sellWindow.refresh();
        scene.refreshUIShop();
      }
    }
  };

  Window_ShopSell.prototype.cursorDown = function (wrap) {
    const scene = SceneManager._scene;
    if (scene instanceof Scene_Shop && scene._sellCategoryFocus) {
      if (this.maxItems() > 0) {
        scene._sellCategoryFocus = false;
        this.select(0);
        SoundManager.playCursor();
        scene.refreshUIShop();
      }
      return;
    }
    Window_Selectable.prototype.cursorDown.call(this, wrap);
  };

  Window_ShopSell.prototype.cursorUp = function (wrap) {
    const scene = SceneManager._scene;
    if (scene instanceof Scene_Shop && !scene._sellCategoryFocus && this.index() === 0) {
      scene._sellCategoryFocus = true;
      this.select(-1);
      SoundManager.playCursor();
      scene.refreshUIShop();
      return;
    }
    Window_Selectable.prototype.cursorUp.call(this, wrap);
  };

  Window_ShopSell.prototype.cursorPageup = function () {
    if (SceneManager._scene instanceof Scene_Shop) {
      SoundManager.playCursor();
      SceneManager._scene.switchToBuy();
    }
  };

  Window_ShopSell.prototype.cursorPagedown = function () {};

  const _Window_ItemCategory_cursorLeft = Window_ItemCategory.prototype.cursorLeft;
  Window_ItemCategory.prototype.cursorLeft = function (wrap) {
    if (this.index() === 0 && SceneManager._scene instanceof Scene_Shop) {
      SceneManager._scene.switchToBuy();
    } else {
      _Window_ItemCategory_cursorLeft.call(this, wrap);
    }
  };

  Scene_Shop.prototype.switchToSell = function () {
    if (!this.isShopReady()) return;
    this._buyWindow.hide();
    this._buyWindow.deactivate();
    this._commandWindow.select(1);
    this.commandSell();
    this._categoryWindow.deactivate();
    this._sellCategoryFocus = true;
    this._sellWindow.activate();
    this._sellWindow.setCategory(this._categoryWindow.currentSymbol());
    this._sellWindow.refresh();
    this._sellWindow.select(-1);
    this.refreshUIShop();
  };

  Scene_Shop.prototype.switchToBuy = function () {
    if (!this.isShopReady()) return;
    this._categoryWindow.hide();
    this._categoryWindow.deactivate();
    this._sellWindow.hide();
    this._sellWindow.deactivate();
    this._sellCategoryFocus = false;
    this._commandWindow.select(0);
    this.commandBuy();
    this.refreshUIShop();
  };

  // Cancelling out of any of the three lists leaves the shop, through the one
  // guarded exit so a cancel that arrives twice in a frame only pops once.
  Scene_Shop.prototype.onBuyCancel = function () {
    this.closeShop();
  };

  Scene_Shop.prototype.onCategoryCancel = function () {
    this.closeShop();
  };

  Scene_Shop.prototype.onSellCancel = function () {
    this.closeShop();
  };

  //=============================================================================
  // Shop Stock System
  //=============================================================================

  const _Scene_Shop_prepare = Scene_Shop.prototype.prepare;
  Scene_Shop.prototype.prepare = function (goods, purchaseOnly) {
    _Scene_Shop_prepare.call(this, goods, purchaseOnly);
    // A shop pushed straight from a plugin (an NPC trade, the daily shop) has no
    // event behind it, and then it simply keeps no stock record.
    this._shopMapId = $gameMap ? $gameMap.mapId() : 0;
    this._shopEventId = ($gameMap && $gameMap._interpreter) ? $gameMap._interpreter.eventId() : 0;
  };

  // A shop that keeps no stock record sells without limit.
  const UNLIMITED_STOCK = 999;

  const getStockKey = (item) => {
    if (!item) return null;
    if (DataManager.isItem(item)) return "i_" + item.id;
    if (DataManager.isWeapon(item)) return "w_" + item.id;
    if (DataManager.isArmor(item)) return "a_" + item.id;
    return "u_" + item.id;
  };

  const getShopDateKey = () => {
    // Var 113 may hold a number; coerce to string before substring or it throws.
    const dateStr = String($gameVariables.value(113) || "");
    return dateStr.substring(0, 11);
  };

  Scene_Shop.prototype.initStock = function () {
    if (!this._shopMapId || !this._shopEventId) return;

    if (!$gameSystem._shopStocks) $gameSystem._shopStocks = {};
    const stocks = $gameSystem._shopStocks;
    const mapId = this._shopMapId;
    const eventId = this._shopEventId;
    const dateKey = getShopDateKey();

    if (!stocks[mapId]) stocks[mapId] = {};
    if (!stocks[mapId][eventId]) stocks[mapId][eventId] = { date: "" };

    const shopData = stocks[mapId][eventId];

    if (shopData.date !== dateKey) {
      stocks[mapId][eventId] = { date: dateKey, oilFactor: 1.0, soulFactor: 1.0 };
      const newShopData = stocks[mapId][eventId];

      // The market only moves prices when it is a live StockMarketSystem
      // instance. A save written without that plugin restores a plain object
      // with no methods on it, and asking that object for a price threw before
      // the shop had drawn a single item.
      const market = $gameSystem.stockMarket;
      if (market && typeof market.getOilPrice === "function" && typeof market.getSoulsPrice === "function") {
        safe("market factors", () => {
          const smParams = PluginManager.parameters("StockMarketSystem");
          const initOil = Number(smParams["Initial Oil Price"]) || 30000;
          const initSoul = Number(smParams["Initial SOUL Price"]) || 66666;

          const currentOil = Number(market.getOilPrice());
          const currentSoul = Number(market.getSoulsPrice());
          if (!Number.isFinite(currentOil) || !Number.isFinite(currentSoul)) return;

          const maxOil = 80000;
          const minOil = 3000;
          let oilFactor = 1.0;
          if (currentOil >= initOil) {
            oilFactor = 1.0 + ((currentOil - initOil) / (maxOil - initOil)) * 2.0;
          } else {
            oilFactor = 1.0 - ((initOil - currentOil) / (initOil - minOil)) * 0.5;
          }
          newShopData.oilFactor = Math.max(0.5, Math.min(3.0, oilFactor));
          newShopData.soulFactor = Math.max(0.5, Math.min(3.0, currentSoul / initSoul));
        }, null);
      }

      for (const goods of (this._goods || [])) {
        if (!Array.isArray(goods)) continue;
        const type = goods[0];
        const id = goods[1];
        let item = null;
        if (type === 0) item = $dataItems[id];
        else if (type === 1) item = $dataWeapons[id];
        else if (type === 2) item = $dataArmors[id];

        const key = getStockKey(item);
        if (key) newShopData[key] = this.generateRandomStock(item);
      }
    }
  };

  Scene_Shop.prototype.generateRandomStock = function (item) {
    const price = (item && Number.isFinite(item.price)) ? item.price : 0;
    let base = 20;
    if (price >= 1000) base = 12;
    if (price >= 5000) base = 8;
    if (price >= 20000) base = 4;
    if (price >= 50000) base = 2;
    if (price >= 100000) base = 1;
    return Math.floor(Math.random() * base) + 1;
  };

  Scene_Shop.prototype.getStock = function (item) {
    const shopData = currentShopData(this);
    if (!shopData) return UNLIMITED_STOCK;
    const key = getStockKey(item);
    if (!key) return UNLIMITED_STOCK;
    const stock = shopData[key];
    return Number.isFinite(stock) ? stock : UNLIMITED_STOCK;
  };

  Scene_Shop.prototype.reduceStock = function (item, amount) {
    const shopData = currentShopData(this);
    if (!shopData) return;
    const key = getStockKey(item);
    if (!key || !Number.isFinite(shopData[key])) return;
    shopData[key] = Math.max(0, shopData[key] - amount);
  };

  // Trading is a skill like any other. Haggling (127) cuts what the party pays,
  // Appraising (496) raises what it is paid, and both train on the value of the
  // deal (see window.SpecializationXP). The rates are deliberately lopsided:
  // selling already returns only 10% of an item's price, so even Master
  // Appraising against Master Haggling leaves resale well under cost. Do not
  // widen them without re-checking that, or the shop becomes a money printer.
  const HAGGLE_PER_LEVEL = 0.05;   // up to -20% on the price paid
  const HAGGLE_FLOOR = 0.75;
  const APPRAISE_PER_LEVEL = 0.10; // up to +40% on the price received

  // A factor that came back missing or nonsensical must not silently scale a
  // price to zero or NaN.
  const sanePositive = (value, fallback) =>
    (Number.isFinite(value) && value > 0) ? value : fallback;

  function haggleFactor() {
    const xp = window.SpecializationXP;
    if (!xp || typeof xp.discount !== "function") return 1;
    return sanePositive(safe("haggleFactor", () => xp.discount('Haggling', HAGGLE_PER_LEVEL, HAGGLE_FLOOR), 1), 1);
  }

  function appraiseFactor() {
    const xp = window.SpecializationXP;
    if (!xp || typeof xp.multiplier !== "function") return 1;
    return sanePositive(safe("appraiseFactor", () => xp.multiplier('Appraising', APPRAISE_PER_LEVEL), 1), 1);
  }

  // What a shop pays for an item before the party's Appraising is counted: the
  // listed tenth, scaled by the NPC-trade factor. The sell cards read from this
  // too, so a card can never quote a price the till does not honour.
  const baseSellPrice = (item) => {
    const price = (item && Number.isFinite(item.price)) ? item.price : 0;
    const factor = sanePositive($gameTemp && $gameTemp._npcTradeSellFactor, 1);
    return Math.max(0, Math.floor(Math.floor(price * 0.1) * factor));
  };

  Scene_Shop.prototype.sellingPrice = function () {
    if (!this._item) return 0;
    return Math.max(1, Math.floor(baseSellPrice(this._item) * appraiseFactor()));
  };

  const _Scene_Shop_buyingPrice = Scene_Shop.prototype.buyingPrice;
  Scene_Shop.prototype.buyingPrice = function () {
    const base = safe("buyingPrice", () => _Scene_Shop_buyingPrice.call(this), 0);
    if (!Number.isFinite(base)) return 1;
    return Math.max(1, Math.floor(base * haggleFactor()));
  };

  const _Scene_Shop_terminate_npcTrade = Scene_Shop.prototype.terminate;
  Scene_Shop.prototype.terminate = function () {
    _Scene_Shop_terminate_npcTrade.call(this);
    $gameTemp._npcTradeSellFactor = null;
  };

  const _Window_ShopBuy_isEnabled = Window_ShopBuy.prototype.isEnabled;
  Window_ShopBuy.prototype.isEnabled = function (item) {
    const enabled = _Window_ShopBuy_isEnabled.call(this, item);
    if (!enabled) return false;
    const scene = SceneManager._scene;
    const stock = scene instanceof Scene_Shop ? scene.getStock(item) : UNLIMITED_STOCK;
    return stock > 0;
  };

  const awardTradeXp = (spec, value) => {
    const xp = window.SpecializationXP;
    if (!xp || typeof xp.awardForValue !== "function") return;
    if (!Number.isFinite(value) || value <= 0) return;
    safe("awardForValue " + spec, () => xp.awardForValue(spec, value), null);
  };

  const _Scene_Shop_doBuy = Scene_Shop.prototype.doBuy;
  Scene_Shop.prototype.doBuy = function (number) {
    const spent = number * this.buyingPrice();
    _Scene_Shop_doBuy.call(this, number);
    this.reduceStock(this._item, number);
    if (this._buyWindow) this._buyWindow.refresh();
    awardTradeXp('Haggling', spent);  // i18n-ignore  Specialization.json id
  };

  const _Scene_Shop_doSell = Scene_Shop.prototype.doSell;
  Scene_Shop.prototype.doSell = function (number) {
    const earned = number * this.sellingPrice();
    _Scene_Shop_doSell.call(this, number);
    awardTradeXp('Appraising', earned);  // i18n-ignore  Specialization.json id
  };

  //=============================================================================
  // Selling worn equipment
  //=============================================================================
  // A shop always buys gear, whether it is in the bag or on someone's back.
  // The engine only ever offers $gameParty.allItems(), which excludes equipped
  // weapons and armors, so a player had to visit the equip menu first. Here the
  // sell list also carries what the party is wearing, and the sale unequips as
  // many copies as it needs before the items leave the inventory.

  const equipHolders = () =>
    safe("equipHolders", () => ($gameParty.allMembers ? $gameParty.allMembers() : $gameParty.members()), []) || [];

  // Every piece of gear the party is wearing, counted in one pass. Callers that
  // ask about a whole list (the sell cards, the state hash) take this map rather
  // than walking the party once per item.
  window.ItemSystemShop = window.ItemSystemShop || {};
  const wornCounts = () => {
    const counts = new Map();
    for (const actor of equipHolders()) {
      const equips = safe("actor.equips", () => actor.equips(), []) || [];
      for (const equip of equips) {
        if (equip) counts.set(equip, (counts.get(equip) || 0) + 1);
      }
    }
    return counts;
  };
  window.ItemSystemShop.wornCounts = wornCounts;

  // How many copies of an item the party is wearing right now.
  const equippedCount = (item) => {
    if (!item || DataManager.isItem(item)) return 0;
    return wornCounts().get(item) || 0;
  };
  window.ItemSystemShop.equippedCount = equippedCount;

  // What the party can actually hand over: the bag plus what it is wearing.
  const sellableCount = (item) => $gameParty.numItems(item) + equippedCount(item);
  window.ItemSystemShop.sellableCount = sellableCount;

  // Take `count` copies off whoever is wearing them. changeEquip hands the old
  // piece back to the party, so the ordinary loseItem in doSell can take it.
  // Returns how many actually came off: a locked or sealed slot refuses, and
  // counting those as sold would pay the party for gear it never handed over.
  const unequipForSale = (item, count) => {
    if (!item || count <= 0) return 0;
    let removed = 0;
    for (const actor of equipHolders()) {
      const equips = safe("actor.equips", () => actor.equips(), []) || [];
      for (let slotId = 0; slotId < equips.length && removed < count; slotId++) {
        if (equips[slotId] !== item) continue;
        safe("changeEquip", () => actor.changeEquip(slotId, null), null);
        const stillWorn = safe("actor.equips", () => actor.equips()[slotId], item);
        if (stillWorn !== item) removed++;
      }
      if (removed >= count) break;
    }
    return removed;
  };

  const _Window_ShopSell_makeItemList = Window_ShopSell.prototype.makeItemList;
  Window_ShopSell.prototype.makeItemList = function () {
    _Window_ShopSell_makeItemList.call(this);
    if (!Array.isArray(this._data)) this._data = [];
    for (const item of wornCounts().keys()) {
      if (this.includes(item) && !this._data.includes(item)) {
        this._data.push(item);
      }
    }
  };

  Scene_Shop.prototype.maxSell = function () {
    return sellableCount(this._item);
  };

  const _Scene_Shop_doSell_equipped = Scene_Shop.prototype.doSell;
  Scene_Shop.prototype.doSell = function (number) {
    const inBag = $gameParty.numItems(this._item);
    // Sell no more than the party can actually part with: what is in the bag
    // plus whatever really came off someone's back.
    const takenOff = unequipForSale(this._item, number - inBag);
    const sellable = Math.min(number, inBag + takenOff);
    if (sellable <= 0) return;
    _Scene_Shop_doSell_equipped.call(this, sellable);
  };

  Window_ShopNumber.prototype.max = function () {
    return Math.max(1, this._max || 1);
  };

  // Base engine hardcodes 2 digits (max 99); stacks now go up to 9999.
  Window_ShopNumber.prototype.maxDigits = function () {
    return 4;
  };

  const _Window_ShopNumber_setup = Window_ShopNumber.prototype.setup;
  // Native signature is setup(item, max, price). The previous override mislabelled
  // the args, which fed the price into the max slot (and stock into the price slot),
  // breaking both the displayed total and the stock cap. Cap the purchasable MAX by
  // the shop's remaining stock (buying only; selling is already capped by owned count).
  Window_ShopNumber.prototype.setup = function (item, max, price) {
    const scene = SceneManager._scene;
    const isBuying = scene instanceof Scene_Shop &&
      scene._commandWindow && scene._commandWindow.currentSymbol() === "buy";
    const maxInStock = isBuying ? scene.getStock(item) : UNLIMITED_STOCK;
    const requested = Number.isFinite(max) ? max : 1;
    const actualMax = Math.max(1, Math.min(requested, maxInStock));
    _Window_ShopNumber_setup.call(this, item, actualMax, Number.isFinite(price) ? price : 0);
  };

})();
