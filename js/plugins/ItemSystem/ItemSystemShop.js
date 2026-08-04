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
    this.contents.clear();
    if (this._item) {
      this.drawItemDetails();
    }
  };

  Window_ItemDetail.prototype.getWeaponScalingType = function (weapon) {
    if (!weapon || !DataManager.isWeapon(weapon)) {
      return null;
    }
    const attackSkills = weapon.traits.filter(trait => trait.code === 35);
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
    const lineHeight = this.lineHeight();
    const contentWidth = this.width - this.padding * 2;
    let y = 0;

    const isInShop = SceneManager._scene instanceof Scene_Shop;
    if (!isInShop && item.description) {
      let translatedDescription = item.description;
      if (window.translateText && typeof window.translateText === "function") {
        translatedDescription = window.translateText(item.description);
      }
      const descLines = this.wrapText(translatedDescription, contentWidth - 4);
      for (const line of descLines) {
        this.drawTextEx("\\c[6]" + line, 0, y, contentWidth);
        y += lineHeight;
      }
      y += 16;
    }

    // Procedural lore (resolves {nation}/{leader}/... tokens) in grey flavor.
    if (!isInShop && window.ItemSystemUtils && typeof window.ItemSystemUtils.loreFor === "function") {
      const loreText = window.ItemSystemUtils.loreFor(item);
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
      const rarity = window.ItemSystemUtils.getItemRarity(item);
      this.resetTextColor();
      this.drawIcon(item.iconIndex, x, iconY);
      this.changeTextColor(rarity.colorCode);
      this.drawText(item.name, x + textMargin, y, itemWidth);
      this.resetTextColor();
    }
  };

  Window_ItemDetail.prototype.drawItemStats = function (item, y) {
    const lineHeight = this.lineHeight();
    let currentY = y;
    const categoryName = utils.getItemCategoryName(item);
    if (categoryName) {
      this.drawKeyValue(T('Shop.type'), categoryName, 0, currentY);
      currentY += lineHeight;
    }
    currentY = this.drawMarketPriceInfo(item, currentY);
    const weight = utils.getItemWeight(item);
    this.drawKeyValue(T('Shop.weight'), utils.formatWeight(weight), 0, currentY);
    currentY += lineHeight;

    const isFood = utils.isFoodItem(item);
    if (isFood) {
      const calories = utils.getNutritionValue(item, "calories");
      const protein = utils.getNutritionValue(item, "protein");
      const fat = utils.getNutritionValue(item, "fat");

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

      if (item.effects && item.effects.length > 0) {
        for (const effect of item.effects) {
          const effectText = this.getEffectDescription(effect);
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

    const needRestores = utils.getNeedRestores ? utils.getNeedRestores(item) : [];
    for (const r of needRestores) {
      this.drawKeyValue(r.label, "+" + r.amount + "%", 0, currentY);
      currentY += lineHeight;
    }
  };

  Window_ItemDetail.prototype.drawWeaponStats = function (item, y) {
    const lineHeight = this.lineHeight();
    let currentY = y;

    const modifier = window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifier(item) : null;
    if (modifier) {
      this.drawKeyValue(T('Shop.modifier'), modifier.name, 0, currentY);
      currentY += lineHeight;
    }

    const categoryName = utils.getItemCategoryName(item);
    if (categoryName) {
      this.drawKeyValue(T('Shop.type'), categoryName, 0, currentY);
      currentY += lineHeight;
    }

    const scalingType = this.getWeaponScalingType(item);
    if (scalingType) {
      this.drawKeyValue(T('Shop.scale'), scalingType, 0, currentY);
      currentY += lineHeight;
    }

    const weight = utils.getItemWeight(item);
    this.drawKeyValue(T('Shop.weight'), utils.formatWeight(weight), 0, currentY);
    currentY += lineHeight;

    currentY = this.drawMarketPriceInfo(item, currentY);
    currentY = this.drawEquipCompatibility(item, currentY);

    const price = window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedPrice(item) : item.price;
    if (price > 0) {
      const euroPrice = (price / 100).toFixed(2);
      this.drawKeyValue(T('Shop.price'), euroPrice + " €", 0, currentY);
      currentY += lineHeight;
    }

    const params = [
      [_si18n("ATT"), window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(item, 2) : item.params[2]],
      [_si18n("DEF"), window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(item, 3) : item.params[3]],
      [_si18n("M.ATT"), window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(item, 4) : item.params[4]],
      [_si18n("M.DEF"), window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(item, 5) : item.params[5]],
      [_si18n("AGILITY"), window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(item, 6) : item.params[6]],
      [_si18n("LUCK"), window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(item, 7) : item.params[7]]
    ];
    for (const param of params) {
      if (param[1] !== 0) {
        const sign = param[1] > 0 ? "+" : "";
        this.drawKeyValue(param[0], sign + param[1], 0, currentY);
        currentY += lineHeight;
      }
    }

    if (item.traits && item.traits.length > 0) {
      for (const trait of item.traits) {
        const traitText = this.getTraitDescription(trait);
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

    const categoryName = utils.getItemCategoryName(item);
    if (categoryName) {
      this.drawKeyValue(T('Shop.type'), categoryName, 0, currentY);
      currentY += lineHeight;
    }

    let equipTypeName = $dataSystem.equipTypes[item.etypeId];
    if (window.translateText && typeof window.translateText === "function") {
      equipTypeName = window.translateText(equipTypeName);
    }
    this.drawKeyValue(T('Shop.slot'), equipTypeName, 0, currentY);
    currentY += lineHeight;

    const weight = utils.getItemWeight(item);
    this.drawKeyValue(T('Shop.weight'), utils.formatWeight(weight), 0, currentY);
    currentY += lineHeight;

    currentY = this.drawMarketPriceInfo(item, currentY);
    currentY = this.drawEquipCompatibility(item, currentY);

    if (item.price > 0) {
      const euroPrice = (item.price / 100).toFixed(2);
      this.drawKeyValue(T('Shop.price'), euroPrice + " €", 0, currentY);
      currentY += lineHeight;
    }

    const params = [
      [_si18n("ATT"), item.params[2]],
      [_si18n("DEF"), item.params[3]],
      [_si18n("M.ATT"), item.params[4]],
      [_si18n("M.DEF"), item.params[5]],
      [_si18n("AGILITY"), item.params[6]],
      [_si18n("LUCK"), item.params[7]]
    ];
    for (const param of params) {
      if (param[1] !== 0) {
        const sign = param[1] > 0 ? "+" : "";
        this.drawKeyValue(param[0], sign + param[1], 0, currentY);
        currentY += lineHeight;
      }
    }

    if (item.traits && item.traits.length > 0) {
      for (const trait of item.traits) {
        const traitText = this.getTraitDescription(trait);
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

    const party = $gameParty.members();
    let equipInfoShown = false;

    for (let i = 0; i < party.length; i++) {
      const actor = party[i];
      // Lists who the item suits: any class can equip any weapon, so weapons the
      // member has no proficiency in are left out (see WeaponProficiency).
      const prof = window.WeaponProficiency;
      const canEquip = actor.canEquip(item) && !(prof && prof.isUntrained(actor, item));
      this.resetTextColor();
      const translatedName = window.translateText ? window.translateText(actor.name()) : actor.name();

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
    const scene = SceneManager._scene;
    if (scene instanceof Scene_Shop && scene._shopMapId && scene._shopEventId && $gameSystem._shopStocks) {
      const shopData = ($gameSystem._shopStocks[scene._shopMapId] || {})[scene._shopEventId];
      if (shopData) {
        const cat = (utils.getItemCategoryName(item) || "").toLowerCase();
        const soulCats = ["jungle", "magic", "plants", "monsters"];
        const factor = soulCats.includes(cat) ? (shopData.soulFactor || 1.0) : (shopData.oilFactor || 1.0);
        const pct = Math.round(factor * 100);
        let valueDisplay = pct + "%";

        if (factor > 1.01) this.changeTextColor(ColorManager.textColor(18));
        else if (factor < 0.99) this.changeTextColor(ColorManager.textColor(3));

        this.drawKeyValue(T('Shop.price'), valueDisplay, 0, y);
        this.resetTextColor();
        return y + this.lineHeight();
      }
    }
    return y;
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
    if (!$dataSystem || !$dataSystem.equipTypes || !$dataSystem.equipTypes[etypeId]) {
      return (T('Shop.equipType')) + etypeId;
    }
    let equipTypeName = $dataSystem.equipTypes[etypeId];
    if (window.translateText && typeof window.translateText === "function") {
      equipTypeName = window.translateText(equipTypeName);
    }
    return equipTypeName;
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
    this.contents.clear();
    this.hideBackgroundDimmer();
    this.hide();
  };

  const _Scene_Shop_createHelpWindow = Scene_Shop.prototype.createHelpWindow;
  Scene_Shop.prototype.createHelpWindow = function () {
    _Scene_Shop_createHelpWindow.call(this);
    if (this._helpWindow) {
      this._helpWindow.x = -3000;
      this._helpWindow.y = -3000;
      this._helpWindow.opacity = 0;
      this._helpWindow.contentsOpacity = 0;
      this._helpWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createGoldWindow = Scene_Shop.prototype.createGoldWindow;
  Scene_Shop.prototype.createGoldWindow = function () {
    _Scene_Shop_createGoldWindow.call(this);
    if (this._goldWindow) {
      this._goldWindow.x = -3000;
      this._goldWindow.y = -3000;
      this._goldWindow.opacity = 0;
      this._goldWindow.contentsOpacity = 0;
      this._goldWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createCommandWindow = Scene_Shop.prototype.createCommandWindow;
  Scene_Shop.prototype.createCommandWindow = function () {
    _Scene_Shop_createCommandWindow.call(this);
    if (this._commandWindow) {
      this._commandWindow.x = -3000;
      this._commandWindow.y = -3000;
      this._commandWindow.opacity = 0;
      this._commandWindow.contentsOpacity = 0;
      this._commandWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createDummyWindow = Scene_Shop.prototype.createDummyWindow;
  Scene_Shop.prototype.createDummyWindow = function () {
    _Scene_Shop_createDummyWindow.call(this);
    if (this._dummyWindow) {
      this._dummyWindow.x = -3000;
      this._dummyWindow.y = -3000;
      this._dummyWindow.opacity = 0;
      this._dummyWindow.contentsOpacity = 0;
      this._dummyWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createBuyWindow = Scene_Shop.prototype.createBuyWindow;
  Scene_Shop.prototype.createBuyWindow = function () {
    _Scene_Shop_createBuyWindow.call(this);
    if (this._buyWindow) {
      this._buyWindow.x = -3000;
      this._buyWindow.y = -3000;
      this._buyWindow.opacity = 0;
      this._buyWindow.contentsOpacity = 0;
      this._buyWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createCategoryWindow = Scene_Shop.prototype.createCategoryWindow;
  Scene_Shop.prototype.createCategoryWindow = function () {
    _Scene_Shop_createCategoryWindow.call(this);
    if (this._categoryWindow) {
      this._categoryWindow.x = -3000;
      this._categoryWindow.y = -3000;
      this._categoryWindow.opacity = 0;
      this._categoryWindow.contentsOpacity = 0;
      this._categoryWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createSellWindow = Scene_Shop.prototype.createSellWindow;
  Scene_Shop.prototype.createSellWindow = function () {
    _Scene_Shop_createSellWindow.call(this);
    if (this._sellWindow) {
      this._sellWindow.x = -3000;
      this._sellWindow.y = -3000;
      this._sellWindow.opacity = 0;
      this._sellWindow.contentsOpacity = 0;
      this._sellWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createNumberWindow = Scene_Shop.prototype.createNumberWindow;
  Scene_Shop.prototype.createNumberWindow = function () {
    _Scene_Shop_createNumberWindow.call(this);
    if (this._numberWindow) {
      this._numberWindow.x = -3000;
      this._numberWindow.y = -3000;
      this._numberWindow.opacity = 0;
      this._numberWindow.contentsOpacity = 0;
      this._numberWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_createStatusWindow = Scene_Shop.prototype.createStatusWindow;
  Scene_Shop.prototype.createStatusWindow = function () {
    _Scene_Shop_createStatusWindow.call(this);
    if (this._statusWindow) {
      this._statusWindow.x = -3000;
      this._statusWindow.y = -3000;
      this._statusWindow.opacity = 0;
      this._statusWindow.contentsOpacity = 0;
      this._statusWindow.showBackgroundDimmer = function () { };
    }
  };

  const _Scene_Shop_create = Scene_Shop.prototype.create;
  Scene_Shop.prototype.create = function () {
    _Scene_Shop_create.call(this);
    this.createItemDetailWindow();
    this.initStock();
    this.initUIShopDOM();

    // Map WASD + Q/E keys
    this._originalKeyMapper = Object.assign({}, Input.keyMapper);
    Input.keyMapper[87] = 'up';        // W
    Input.keyMapper[65] = 'shopBack'; // A → always go back to buy tab
    Input.keyMapper[83] = 'down';     // S
    Input.keyMapper[68] = 'right';    // D
    Input.keyMapper[81] = 'pageup';   // Q → L1 (switch to Buy)
    Input.keyMapper[69] = 'pagedown'; // E → R1 (switch to Sell)

    // Move all native windows off-screen
    const windowsToMove = [
      this._goldWindow, this._helpWindow, this._commandWindow, this._dummyWindow,
      this._buyWindow, this._categoryWindow, this._sellWindow, this._numberWindow,
      this._statusWindow, this._itemDetailWindow
    ];
    for (const win of windowsToMove) {
      if (win) {
        win.x = -3000;
        win.y = -3000;
        win.opacity = 0;
        win.contentsOpacity = 0;
      }
    }

    // Global keyboard / escape listener
    this._onShopKeyDown = (event) => {
      if (event.key === "Escape" || event.key === "Esc") {  // i18n-ignore  KeyboardEvent.key values
        event.preventDefault();
        if (SceneManager.isSceneChanging()) return; // already closing this frame
        SoundManager.playCancel();
        if (this._numberWindow && this._numberWindow.active) {
          this._numberWindow.processCancel();
          this.refreshUIShop();
        } else {
          this.popScene();
        }
      }
    };
    window.addEventListener("keydown", this._onShopKeyDown);

    // Global right-click / context menu listener to handle cancellations
    this._onShopContextMenu = (event) => {
      event.preventDefault();
      if (SceneManager.isSceneChanging()) return; // already closing this frame
      SoundManager.playCancel();
      if (this._numberWindow && this._numberWindow.active) {
        this._numberWindow.processCancel();
        this.refreshUIShop();
      } else {
        this.popScene();
      }
    };
    window.addEventListener("contextmenu", this._onShopContextMenu);
  };

  Scene_Shop.prototype.createItemDetailWindow = function () {
    const rect = this.statusWindowRect();
    this._itemDetailWindow = new Window_ItemDetail(rect);
    this._itemDetailWindow.x = -3000;
    this._itemDetailWindow.y = -3000;
    this._itemDetailWindow.opacity = 0;
    this._itemDetailWindow.contentsOpacity = 0;
    this._itemDetailWindow.showBackgroundDimmer = function () { };
    this.addWindow(this._itemDetailWindow);
    this._statusWindow.setDetailWindow(this._itemDetailWindow);
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
    if (this._shopGoods) {
      const scene = SceneManager._scene;
      let shopData = null;
      if (scene instanceof Scene_Shop && scene._shopMapId && scene._shopEventId && $gameSystem._shopStocks) {
        shopData = ($gameSystem._shopStocks[scene._shopMapId] || {})[scene._shopEventId];
      }

      const items = [];
      for (const goods of this._shopGoods) {
        const item = this.goodsToItem(goods);
        if (item) {
          let price = goods[2] === 0 ? item.price : goods[3];

          if (shopData) {
            const cat = (utils.getItemCategoryName(item) || "").toLowerCase();
            const soulCats = ["jungle", "magic", "plants", "monsters"];
            const factor = soulCats.includes(cat) ? (shopData.soulFactor || 1.0) : (shopData.oilFactor || 1.0);
            price = Math.floor(price * factor);
          }
          items.push({ item: item, price: price });
        }
      }

      items.sort((a, b) => {
        const catA = (window.ItemSystemUtils.getItemCategoryName(a.item) || "").toLowerCase();
        const catB = (window.ItemSystemUtils.getItemCategoryName(b.item) || "").toLowerCase();

        if (catA === "medical" && catB !== "medical") return -1;
        if (catB === "medical" && catA !== "medical") return 1;
        if (catA === "trash" && catB !== "trash") return 1;
        if (catB === "trash" && catA !== "trash") return -1;

        if (catA !== catB) {
          return catA.localeCompare(catB);
        }
        return a.price - b.price;
      });

      for (const obj of items) {
        this._data.push(obj.item);
        this._price.push(obj.price);
      }
    }
  };

  // Hide standard windows dynamically
  const _Scene_Shop_update = Scene_Shop.prototype.update;
  Scene_Shop.prototype.update = function () {
    _Scene_Shop_update.call(this);

    // Robust native input/controller backup checks
    if (Input.isTriggered('shopBack') && !(this._numberWindow && this._numberWindow.active)) {
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
    // SceneManager.exit() closes the game.
    if (!SceneManager.isSceneChanging() && (Input.isTriggered('cancel') || TouchInput.isCancelled())) {
      SoundManager.playCancel();
      if (this._numberWindow && this._numberWindow.active) {
        this._numberWindow.processCancel();
        this.refreshUIShop();
      } else {
        this.popScene();
      }
      return;
    }

    this.syncUIShopState();
  };

  Scene_Shop.prototype.terminate = function () {
    const container = document.getElementById("shop-container");
    if (container) container.remove();

    // Clean up event listeners to avoid memory leaks
    if (this._onShopKeyDown) {
      window.removeEventListener("keydown", this._onShopKeyDown);
    }
    if (this._onShopContextMenu) {
      window.removeEventListener("contextmenu", this._onShopContextMenu);
    }

    // Restore original keyMapper
    if (this._originalKeyMapper) {
      Input.keyMapper = this._originalKeyMapper;
    }

    Scene_MenuBase.prototype.terminate.call(this);
  };


  // ============================================================================
  // Premium HTML DOM merchant counter systems
  // ============================================================================
  Scene_Shop.prototype.initUIShopDOM = function () {
    if (!document.getElementById("shop-container")) {
      const container = document.createElement("div");
      container.id = "shop-container";
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

      // Back Button click
      container.querySelector("#shop-close-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        SoundManager.playCancel();
        if (this._numberWindow && this._numberWindow.active) {
          this._numberWindow.processCancel();
          this.refreshUIShop();
        } else {
          this.popScene();
        }
      });

      // Tab clicks
      container.querySelector("#tab-buy").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this._buyWindow.active) {
          SoundManager.playOk();
          this.switchToBuy();
        }
      });

      container.querySelector("#tab-sell").addEventListener("click", (e) => {
        e.stopPropagation();
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
    }
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
    const buyLength = (this._buyWindow._data || []).length;
    const sellLength = (this._sellWindow._data || []).length;
    const stockHash = (this._buyWindow._data || []).map(item => this.getStock(item)).join(",");
    const ownedHash = (this._sellWindow._data || []).map(item => $gameParty.numItems(item)).join(",");

    const sellCatFocus = this._sellCategoryFocus || false;
  return `${isBuyMode}_${isSellMode}_${buyIdx}_${sellIdx}_${catIdx}_${numActive}_${numVal}_${numMax}_${partyGold}_${buyLength}_${sellLength}_${stockHash}_${ownedHash}_${sellCatFocus}`;
  };

  Scene_Shop.prototype.syncUIShopState = function () {
    const container = document.getElementById("shop-container");
    if (!container) return;

    const hash = this.getShopStateHash();
    if (this._lastShopStateHash === hash) return;
    this._lastShopStateHash = hash;


    const isBuyMode = this.isShopBuyMode();
    const isSellMode = this.isShopSellMode();
    const activeIndex = isBuyMode ? this._buyWindow.index() : this._sellWindow.index();

    // 1. Update Gold/Funds
    const currentGold = $gameParty.gold();
    if (this._renderedGold !== currentGold) {
      this._renderedGold = currentGold;
      const fundsText =T('Shop.availableFunds');
      container.querySelector("#shop-funds").innerHTML = `${fundsText}<span style="color: #27ae60;">${(currentGold / 100).toFixed(2)} €</span>`;
    }

    // 2. Update Tabs active state & Category Buttons
    let forceListRedraw = false;
    if (this._renderedIsBuyMode !== isBuyMode) {
      this._renderedIsBuyMode = isBuyMode;
      forceListRedraw = true;

      const tabBuy = container.querySelector("#tab-buy");
      const tabSell = container.querySelector("#tab-sell");
      if (isBuyMode) {
        tabBuy.classList.add("active");
        tabSell.classList.remove("active");
      } else {
        tabBuy.classList.remove("active");
        tabSell.classList.add("active");
      }

      // Populate or clear categories container
      const catContainer = container.querySelector("#shop-categories-container");
      if (isSellMode) {
        const catIdx = this._categoryWindow.index();
        const labels = T.list('Shop.sellCategories');

        let categoriesHTML = `<div class="shop-categories" style="display: flex; gap: 6px; margin-bottom: 12px;">`;
        labels.forEach((lbl, idx) => {
          const activeClass = catIdx === idx ? 'active' : '';
          categoriesHTML += `<div class="category-btn ${activeClass}" data-idx="${idx}" style="flex: 1; font-family: 'Lora', serif; font-size: 0.85em; padding: 6px 2px; text-align: center; cursor: pointer;">${lbl}</div>`;
        });
        categoriesHTML += `</div>`;
        catContainer.innerHTML = categoriesHTML;

        // Bind category button clicks
        catContainer.querySelectorAll(".category-btn").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute("data-idx"));
            SoundManager.playOk();
            this._categoryWindow.select(idx);
            this._categoryWindow.deactivate();
            this._sellWindow.activate();
            this._sellWindow.setCategory(this._categoryWindow.currentSymbol());
            this._sellCategoryFocus = false;
            this._sellWindow.select(0);
            this.refreshUIShop();
          });
        });
      } else {
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
    const listLength = isBuyMode ? (this._buyWindow._data || []).length : (this._sellWindow._data || []).length;
    const stockHash = (this._buyWindow._data || []).map(item => this.getStock(item)).join(",");
    const ownedHash = (this._sellWindow._data || []).map(item => $gameParty.numItems(item)).join(",");

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
    if (forceListRedraw) {
      let itemsHTML = "";
      if (isBuyMode) {
        const buyData = this._buyWindow._data || [];
        if (buyData.length === 0) {
          itemsHTML = `<div style="text-align:center; color:#8c7667; margin-top:40px; font-style:italic;">${T('Shop.noProductsOnSale')}</div>`;
        } else {
          buyData.forEach((item, idx) => {
            if (!item) return;
            const focusedClass = activeIndex === idx ? 'focused' : '';
            const rarity = utils.getItemRarity(item);
            const price = this._buyWindow.price(item);
            const stock = this.getStock(item);
            const owned = $gameParty.numItems(item);
            const stockValText = stock === 999 ? "∞" : stock;
            const stockDisplay = T('Shop.ownedStock', { owned: owned, stock: stockValText });

            itemsHTML += `
              <div class="item-card ${focusedClass}" data-idx="${idx}" data-mode="buy" style="border-left: 4px solid ${rarity.colorCode};">
                  <div class="item-card-left">
                      <div class="item-card-icon" style="${this.getIconStyle(item.iconIndex)}"></div>
                      <div class="item-card-info">
                          <span class="item-card-name">${item.name}</span>
                          <span class="item-card-sub">${utils.getItemCategoryName(item) || T('Shop.asset')}</span>
                      </div>
                  </div>
                  <div class="item-card-right">
                      <span class="item-card-price">${(price / 100).toFixed(2)} €</span>
                      <span class="item-card-stock" style="font-size: 12px; opacity: 0.95; margin-top: 2px;">${stockDisplay}</span>
                  </div>
              </div>
            `;
          });
        }
      } else {
        const sellData = this._sellWindow._data || [];
        if (sellData.length === 0) {
          itemsHTML = `<div style="text-align:center; color:#8c7667; margin-top:40px; font-style:italic;">${T('Shop.inventoryEmpty')}</div>`;
        } else {
          sellData.forEach((item, idx) => {
            if (!item) return;
            const focusedClass = activeIndex === idx && this._sellWindow.active ? 'focused' : '';
            const rarity = utils.getItemRarity(item);
            // Match the gold the player actually receives (sellingPrice()),
            // including the NPC-trade sell factor, so the card doesn't lie.
            const sellFactor = $gameTemp._npcTradeSellFactor ?? 1;
            const price = Math.floor(Math.floor(item.price * 0.1) * sellFactor);
            const owned = $gameParty.numItems(item);
            const stock = this.getStock(item);
            const stockValText = stock === 999 ? "∞" : stock;
            const stockDisplay = T('Shop.ownedStock', { owned: owned, stock: stockValText });

            itemsHTML += `
              <div class="item-card ${focusedClass}" data-idx="${idx}" data-mode="sell" style="border-left: 4px solid ${rarity.colorCode};">
                  <div class="item-card-left">
                      <div class="item-card-icon" style="${this.getIconStyle(item.iconIndex)}"></div>
                      <div class="item-card-info">
                          <span class="item-card-name">${item.name}</span>
                          <span class="item-card-sub">${utils.formatWeight(utils.getItemWeight(item))}</span>
                      </div>
                  </div>
                  <div class="item-card-right">
                      <span class="item-card-price">${(price / 100).toFixed(2)} €</span>
                      <span class="item-card-stock" style="font-size: 12px; opacity: 0.95; margin-top: 2px;">${stockDisplay}</span>
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
          const idx = parseInt(card.getAttribute("data-idx"));
          const mode = card.getAttribute("data-mode");
          if (mode === "buy") {
            if (this._buyWindow.index() !== idx) {
              this._buyWindow.select(idx);
              SoundManager.playCursor();
              this.refreshUIShop();
            } else {
              this._buyWindow.processOk();
            }
          } else {
            if (this._sellWindow.index() !== idx) {
              this._sellWindow.select(idx);
              SoundManager.playCursor();
              this.refreshUIShop();
            } else {
              this._sellWindow.processOk();
            }
          }
        });
      });
    }

    // 6. Update focus class and scroll if index changed
    if (this._renderedSelectedIndex !== activeIndex || forceListRedraw) {
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
    if (this._renderedDetailItem !== selectedItem || forceListRedraw) {
      this._renderedDetailItem = selectedItem;
      const detailViewport = container.querySelector("#detail-viewport");

      if (selectedItem) {
        const rarity = utils.getItemRarity(selectedItem);
        const isFood = utils.isFoodItem(selectedItem);
        const category = utils.getItemCategoryName(selectedItem) || (T('Shop.item'));
        const weight = utils.formatWeight(utils.getItemWeight(selectedItem));

        let scaleBadgeHTML = "";
        if (DataManager.isWeapon(selectedItem)) {
          const scaling = this._itemDetailWindow.getWeaponScalingType(selectedItem);
          if (scaling) {
            scaleBadgeHTML = `
              <div class="detail-spec-badge">
                  <span class="badge-lbl">${T('Shop.ui.scale')}</span>
                  <span class="badge-val">${scaling}</span>
              </div>
            `;
          }
        }

        let slotBadgeHTML = "";
        if (DataManager.isWeapon(selectedItem) || DataManager.isArmor(selectedItem)) {
          let slotName = $dataSystem.equipTypes[selectedItem.etypeId];
          if (window.translateText && typeof window.translateText === "function") slotName = window.translateText(slotName);
          slotBadgeHTML = `
            <div class="detail-spec-badge">
                <span class="badge-lbl">${T('Shop.slot')}</span>
                <span class="badge-val">${slotName || T('Shop.equipSlot')}</span>
            </div>
          `;
        }

        let descHTML = "";
        if (selectedItem.description) {
          let translatedDesc = selectedItem.description;
          if (window.translateText && typeof window.translateText === "function") translatedDesc = window.translateText(selectedItem.description);
          descHTML = `<div class="detail-desc">${translatedDesc}</div>`;
        }

        // Procedural lore (resolves {nation}/{leader}/... tokens) shown below the description.
        if (window.ItemSystemUtils && typeof window.ItemSystemUtils.loreFor === "function") {
          const loreText = window.ItemSystemUtils.loreFor(selectedItem);
          if (loreText) descHTML += `<div class="detail-lore" style="font-style:italic;opacity:0.75;margin-top:4px;">${loreText}</div>`;
        }

        // Params
        let paramsHTML = "";
        const baseParams = [2, 3, 4, 5, 6, 7];
        const paramNames = [_si18n("ATT"), _si18n("DEF"), _si18n("M.ATT"), _si18n("M.DEF"), _si18n("AGILITY"), _si18n("LUCK")];
        let hasParams = false;

        baseParams.forEach((paramId, pIdx) => {
          let val = 0;
          if (DataManager.isWeapon(selectedItem)) {
            val = window.ItemSystemModifiers ? window.ItemSystemModifiers.getModifiedParam(selectedItem, paramId) : selectedItem.params[paramId];
          } else if (DataManager.isArmor(selectedItem)) {
            val = selectedItem.params[paramId];
          }

          if (val !== 0) {
            hasParams = true;
            const sign = val > 0 ? "+" : "";
            const barPct = Math.max(5, Math.min(100, (Math.abs(val) / 40) * 100));
            const color = val > 0 ? "#27ae60" : "#e74c3c";

            paramsHTML += `
              <div class="gauge-row">
                  <span style="font-weight:bold; width:50px;">${paramNames[pIdx]}</span>
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
          const calories = utils.getNutritionValue(selectedItem, "calories");
          const protein = utils.getNutritionValue(selectedItem, "protein");
          const fat = utils.getNutritionValue(selectedItem, "fat");

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
        const needRestores = utils.getNeedRestores ? utils.getNeedRestores(selectedItem) : [];
        if (needRestores.length) {
          const needGauges = needRestores.map(r => `
              <div class="gauge-row">
                  <span style="font-weight:500; width:70px;">${r.label}</span>
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

        // Effects / Traits
        let effectsHTML = "";
        let hasEffects = false;

        if (selectedItem.effects && selectedItem.effects.length > 0) {
          selectedItem.effects.forEach(eff => {
            const effStr = this._itemDetailWindow.getEffectDescription(eff);
            if (effStr) {
              hasEffects = true;
              effectsHTML += `<div style="margin-bottom:6px; font-size:13px; color:#5c4033;">✦ ${effStr}</div>`;
            }
          });
        }

        if (selectedItem.traits && selectedItem.traits.length > 0) {
          selectedItem.traits.forEach(tr => {
            const trStr = this._itemDetailWindow.getTraitDescription(tr);
            if (trStr) {
              hasEffects = true;
              effectsHTML += `<div style="margin-bottom:6px; font-size:13px; color:#5c4033;">✦ ${trStr}</div>`;
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
          const party = $gameParty.members();
          let comps = "";

          party.forEach(actor => {
            // Everyone can equip every weapon now, so highlight the members who
            // are actually proficient with it (see WeaponProficiency).
            const prof = window.WeaponProficiency;
            const canEquip = actor.canEquip(selectedItem) && !(prof && prof.isUntrained(actor, selectedItem));
            const name = window.translateText ? window.translateText(actor.name()) : actor.name();
            const color = canEquip ? "#27ae60" : "rgba(94,47,23,0.4)";
            const dot = canEquip ? "●" : "○";

            comps += `
              <div style="display:flex; align-items:center; gap:8px; font-size:13px; color:${color}; font-weight:${canEquip ? 'bold' : 'normal'};">
                  <span>${dot}</span>
                  <span>${name}</span>
              </div>
            `;
          });

          compatibilityHTML = `
            <div style="margin-bottom:10px;">
                <div class="card-lbl" style="border-bottom: 1px dashed rgba(94,47,23,0.15); padding-bottom:4px; margin-bottom:10px; font-weight:bold; font-size:12px;">
                    ${T('Shop.compatibilityLedger')}
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
                      <span class="detail-name">${selectedItem.name}</span>
                  </div>
              </div>
              
              <div class="detail-spec-grid">
                  <div class="detail-spec-badge">
                      <span class="badge-lbl">${T('Shop.ui.type')}</span>
                      <span class="badge-val">${category}</span>
                  </div>
                  <div class="detail-spec-badge">
                      <span class="badge-lbl">${T('Shop.ui.weight')}</span>
                      <span class="badge-val">${weight}</span>
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
                  ${isBuyMode ? (T('Shop.buy')) : (T('Shop.sell'))}
              </div>
          </div>
        `;

        // Bind BUY/SELL action button
        const actBtn = detailViewport.querySelector("#right-action-btn");
        if (actBtn) {
          actBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isBuyMode) {
              this._buyWindow.processOk();
            } else {
              this._sellWindow.processOk();
            }
          });
        }
      } else {
        detailViewport.innerHTML = `
          <div class="detail-scroll" style="flex: 1; min-height: 0; justify-content:center; align-items:center; text-align:center; color:#8c7667; font-style:italic; display: flex; flex-direction: column;">
              <div style="font-size:36px; margin-bottom:12px; opacity:0.35;"></div>
              <span>${T('Shop.hoverOrSelectAnItem')}</span>
          </div>
        `;
      }
    }

    // 8. Update Quantity Modal Overlay
    const modalActive = this._numberWindow.active;
    const modalNum = modalActive ? this._numberWindow.number() : 0;
    const modalMax = modalActive ? this._numberWindow.max() : 0;

    const modalViewport = container.querySelector("#modal-viewport");
    const modalStateChanged = this._renderedQuantityActive !== modalActive || this._renderedQuantityMax !== modalMax;

    if (!modalStateChanged && this._renderedQuantityNumber !== modalNum) {
      this._renderedQuantityNumber = modalNum;
      const qtyDisplay = modalViewport.querySelector(".qty-val-display");
      if (qtyDisplay) qtyDisplay.textContent = modalNum;
      const totalDisplay = modalViewport.querySelector(".card-val");
      if (totalDisplay && this._numberWindow._price) {
        totalDisplay.textContent = (modalNum * this._numberWindow._price / 100).toFixed(2) + " €";
      }
    } else if (modalStateChanged) {
      this._renderedQuantityActive = modalActive;
      this._renderedQuantityNumber = modalNum;
      this._renderedQuantityMax = modalMax;

      if (modalActive) {
        const numItem = this._numberWindow._item;
        const price = this._numberWindow._price;
        const totalCost = modalNum * price;

        // When the quantity modal is open, the buy window is deactivated
        // (the number window is active instead), so _buyWindow.active is
        // unreliable here. Use the command window's selection to detect mode.
        const isModalBuyMode = this._commandWindow.currentSymbol() === "buy";

        const promptTitle = isModalBuyMode
          ? (T('Shop.buy'))
          : (T('Shop.sell'));

        const subLabel = isModalBuyMode
          ? (T('Shop.totalCost'))
          : (T('Shop.sellValue'));

        modalViewport.innerHTML = `
          <div class="modal-overlay">
              <div class="quantity-box">
                  <h3 class="quantity-title">${promptTitle}</h3>
                  <div style="font-weight:bold; font-size:15px; color:var(--text-success-active); margin-bottom:10px;">${numItem.name}</div>

                  <div class="quantity-slider-row">
                      <div class="qty-arrow" id="qty-dec">－</div>
                      <div class="qty-val-display">${modalNum}</div>
                      <div class="qty-arrow" id="qty-inc">＋</div>
                  </div>

                  <div style="font-size:12px; color:var(--text-info); margin-bottom:14px;">Max: ${modalMax}</div>

                  <div style="border-top:1px dashed var(--border-subtle-translucent-30); padding-top:12px; margin-top:14px;">
                      <div class="card-lbl">${subLabel}</div>
                      <div class="card-val" style="font-size:22px; color:${isModalBuyMode ? 'var(--text-cost-bad)' : 'var(--text-cost-ok)'};">${(totalCost / 100).toFixed(2)} €</div>
                  </div>

                  <div class="quantity-actions">
                      <div class="action-btn confirm" id="qty-confirm">${T('Shop.confirmTransaction')}</div>
                      <div class="action-btn cancel" id="qty-cancel">${T('Shop.cancel')}</div>
                  </div>
              </div>
          </div>
        `;

        // Click Arrow inc, partial update only, no full redraw
        modalViewport.querySelector("#qty-inc").addEventListener("click", (e) => {
          e.stopPropagation();
          if (this._numberWindow.number() < this._numberWindow.max()) {
            this._numberWindow.changeNumber(1);
            SoundManager.playCursor();
            this._updateQuantityModalNumber();
          }
        });

        // Click Arrow dec, partial update only, no full redraw.
        // Pressing minus at 1 wraps to the maximum available quantity.
        modalViewport.querySelector("#qty-dec").addEventListener("click", (e) => {
          e.stopPropagation();
          const w = this._numberWindow;
          if (w.number() > 1) {
            w.changeNumber(-1);
          } else {
            w.changeNumber(w.max() - w.number());
          }
          SoundManager.playCursor();
          this._updateQuantityModalNumber();
        });

        // Confirm
        modalViewport.querySelector("#qty-confirm").addEventListener("click", (e) => {
          e.stopPropagation();
          this._numberWindow.processOk();
          this.refreshUIShop();
        });

        // Cancel
        modalViewport.querySelector("#qty-cancel").addEventListener("click", (e) => {
          e.stopPropagation();
          this._numberWindow.processCancel();
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
    const container = document.getElementById("shop-container");
    if (!container) return;
    const modalViewport = container.querySelector("#modal-viewport");
    if (!modalViewport) return;
    const modalNum = this._numberWindow.number();
    const price = this._numberWindow._price;
    const qtyDisplay = modalViewport.querySelector(".qty-val-display");
    if (qtyDisplay) qtyDisplay.textContent = modalNum;
    const totalDisplay = modalViewport.querySelector(".card-val");
    if (totalDisplay) totalDisplay.textContent = (modalNum * price / 100).toFixed(2) + " €";
    this._renderedQuantityNumber = modalNum;
  };

  Scene_Shop.prototype.getIconStyle = function (iconIndex) {
    const iconSize = 32;
    const cols = 16;
    const x = (iconIndex % cols) * iconSize;
    const y = Math.floor(iconIndex / cols) * iconSize;
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
    const stock = (scene instanceof Scene_Shop) ? scene.getStock(item) : 999;
    let stockText = "";
    if (stock !== 999) {
      stockText = "x" + stock;
    }

    const unit = $dataSystem.currencyUnit;
    const priceDisplay = this.formatMoneyValue(priceValue) + unit;
    const priceWidth = 120;
    const stockWidth = 60;
    const nameWidth = rect.width - priceWidth - stockWidth - this.itemPadding() * 2;

    this.changePaintOpacity(this.isEnabled(item));

    const displayName = this.truncateItemName ? this.truncateItemName(item.name) : item.name;
    const originalName = item.name;
    item.name = displayName;
    this.drawItemName(item, rect.x, rect.y, nameWidth);
    item.name = originalName;

    this.drawText(priceDisplay, rect.x + rect.width - priceWidth - stockWidth - 10, rect.y, priceWidth, "right");

    if (stockText) {
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(stockText, rect.x + rect.width - stockWidth, rect.y, stockWidth, "right");
      this.resetTextColor();
    }

    this.changePaintOpacity(true);
  };

  Window_ShopBuy.prototype.drawItemName = function (item, x, y, width) {
    if (item) {
      const iconY = y + (this.lineHeight() - ImageManager.iconHeight) / 2;
      const textMargin = ImageManager.iconWidth + 4;
      const itemWidth = width || this.innerWidth - textMargin;
      const rarity = window.ItemSystemUtils.getItemRarity(item);

      this.resetTextColor();
      this.drawIcon(item.iconIndex, x, iconY);
      this.changeTextColor(rarity.colorCode);
      this.drawText(item.name, x + textMargin, y, itemWidth);
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
    const item = this._data[index];
    if (!item) return;
    const rect = this.itemLineRect(index);
    const x = rect.x + this.itemPadding();
    const y = rect.y;
    const width = rect.width - this.itemPadding() * 2;
    const priceY = y;

    const priceWidth = 120;
    let priceText = "";
    if (this._price) {
      const price = this._price(item);
      priceText = this.formatMoneyValue(price) + " €";
    }

    const nameWidth = width - priceWidth - 10;
    this.changePaintOpacity(this.isEnabled(item));
    // The widest item name the price column leaves room for, in characters.
    const maxNameLength = 18;
    const displayName = utils.truncateTextWithEllipsis(item.name, maxNameLength);
    this.drawItemName(item, x, y, nameWidth, displayName);
    this.changePaintOpacity(true);

    if (this._price) {
      this.drawText(priceText, x + width - priceWidth, priceY, priceWidth, 'right');
    }

    const grams = utils.getItemWeight(item);
    if (grams > 1) {
      const weightStr = utils.formatWeight(grams);
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
      this.drawIcon(item.iconIndex, x, iconY);

      const rarity = window.ItemSystemUtils.getItemRarity(item);
      this.changeTextColor(rarity.colorCode);
      this.drawText(displayName || item.name, x + textMargin, y, itemWidth);
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
    if (!(scene instanceof Scene_Shop)) return;
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
    if (!(scene instanceof Scene_Shop)) return;
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
    this._categoryWindow.hide();
    this._categoryWindow.deactivate();
    this._sellWindow.hide();
    this._sellWindow.deactivate();
    this._sellCategoryFocus = false;
    this._commandWindow.select(0);
    this.commandBuy();
    this.refreshUIShop();
  };

  Scene_Shop.prototype.onBuyCancel = function () {
    this.popScene();
  };

  Scene_Shop.prototype.onCategoryCancel = function () {
    this.popScene();
  };

  Scene_Shop.prototype.onSellCancel = function () {
    this.popScene();
  };

  //=============================================================================
  // Shop Stock System
  //=============================================================================

  const _Scene_Shop_prepare = Scene_Shop.prototype.prepare;
  Scene_Shop.prototype.prepare = function (goods, purchaseOnly) {
    _Scene_Shop_prepare.call(this, goods, purchaseOnly);
    this._shopMapId = $gameMap.mapId();
    this._shopEventId = $gameMap._interpreter.eventId();
  };

  const getStockKey = (item) => {
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

      if ($gameSystem.stockMarket) {
        const smParams = PluginManager.parameters("StockMarketSystem");
        const initOil = Number(smParams["Initial Oil Price"]) || 30000;
        const initSoul = Number(smParams["Initial SOUL Price"]) || 66666;

        const currentOil = $gameSystem.stockMarket.getOilPrice();
        const currentSoul = $gameSystem.stockMarket.getSoulsPrice();

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
      }

      for (const goods of this._goods) {
        const type = goods[0];
        const id = goods[1];
        let item = null;
        if (type === 0) item = $dataItems[id];
        else if (type === 1) item = $dataWeapons[id];
        else if (type === 2) item = $dataArmors[id];

        if (item) {
          const key = getStockKey(item);
          newShopData[key] = this.generateRandomStock(item);
        }
      }
    }
  };

  Scene_Shop.prototype.generateRandomStock = function (item) {
    const price = item.price;
    let base = 20;
    if (price >= 1000) base = 12;
    if (price >= 5000) base = 8;
    if (price >= 20000) base = 4;
    if (price >= 50000) base = 2;
    if (price >= 100000) base = 1;
    return Math.floor(Math.random() * base) + 1;
  };

  Scene_Shop.prototype.getStock = function (item) {
    if (!this._shopMapId || !this._shopEventId || !$gameSystem._shopStocks) return 999;
    const mapStocks = $gameSystem._shopStocks[this._shopMapId];
    if (!mapStocks) return 999;
    const shopData = mapStocks[this._shopEventId];
    if (!shopData) return 999;
    const key = getStockKey(item);
    return shopData[key] !== undefined ? shopData[key] : 999;
  };

  Scene_Shop.prototype.reduceStock = function (item, amount) {
    if (!this._shopMapId || !this._shopEventId || !$gameSystem._shopStocks) return;
    const shopData = ($gameSystem._shopStocks[this._shopMapId] || {})[this._shopEventId];
    if (!shopData) return;
    const key = getStockKey(item);
    if (shopData[key] !== undefined) {
      shopData[key] = Math.max(0, shopData[key] - amount);
    }
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

  function haggleFactor() {
    return window.SpecializationXP
      ? window.SpecializationXP.discount('Haggling', HAGGLE_PER_LEVEL, HAGGLE_FLOOR) : 1;
  }

  function appraiseFactor() {
    return window.SpecializationXP
      ? window.SpecializationXP.multiplier('Appraising', APPRAISE_PER_LEVEL) : 1;
  }

  Scene_Shop.prototype.sellingPrice = function () {
    const base   = Math.floor(this._item.price * 0.1);
    const factor = $gameTemp._npcTradeSellFactor ?? 1;
    return Math.max(1, Math.floor(base * factor * appraiseFactor()));
  };

  const _Scene_Shop_buyingPrice = Scene_Shop.prototype.buyingPrice;
  Scene_Shop.prototype.buyingPrice = function () {
    const base = _Scene_Shop_buyingPrice.call(this);
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
    const stock = SceneManager._scene instanceof Scene_Shop ? SceneManager._scene.getStock(item) : 999;
    return stock > 0;
  };

  const _Scene_Shop_doBuy = Scene_Shop.prototype.doBuy;
  Scene_Shop.prototype.doBuy = function (number) {
    const spent = number * this.buyingPrice();
    _Scene_Shop_doBuy.call(this, number);
    this.reduceStock(this._item, number);
    this._buyWindow.refresh();
    if (window.SpecializationXP) {
      window.SpecializationXP.awardForValue('Haggling', spent);
    }
  };

  const _Scene_Shop_doSell = Scene_Shop.prototype.doSell;
  Scene_Shop.prototype.doSell = function (number) {
    const earned = number * this.sellingPrice();
    _Scene_Shop_doSell.call(this, number);
    if (window.SpecializationXP) {
      window.SpecializationXP.awardForValue('Appraising', earned);
    }
  };

  Window_ShopNumber.prototype.max = function () {
    return this._max || 1;
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
    const maxInStock = isBuying ? scene.getStock(item) : 999;
    const actualMax = Math.min(max, maxInStock);
    _Window_ShopNumber_setup.call(this, item, actualMax, price);
  };

})();
