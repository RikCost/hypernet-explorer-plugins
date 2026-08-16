/*:
 * @target MZ
 * @plugindesc Inventory Scene UI v1.1.0, DOM overlay for ItemSystemInventory
 * @author Omni-Lex
 * @help ItemSystemInventoryUI.js
 *
 * DOM layer for Scene_EnhancedItem.
 * Must be listed AFTER ItemSystemInventory.js in the Plugin Manager.
 *
 * Implements:
 *  - D&D backpack parchment overlay (book-spread layout)
 *  - Full keyboard + controller support (WASD, arrows, L1/R1, gamepad B = cancel)
 *  - 2-column grid navigation
 *  - L1 / R1  →  cycle through category tabs from anywhere
 */

(function () {
  'use strict';

  if (!window.Scene_EnhancedItem) {
    throw new Error('ItemSystemInventoryUI.js requires ItemSystemInventory.js to be loaded first!');
  }

  // Category names come from item notes, so they reach the page as data rather
  // than as text this file wrote: they are escaped before they are printed and
  // before they are put in an attribute a click handler reads back.
  const escapeHtml = (text) =>
    String(text === undefined || text === null ? '' : text).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  // ==========================================================================
  // Shared item inspect service (idempotent across plugins)
  // ==========================================================================
  // The backpack's right page, as one callable. Any other menu that inspects an
  // item (the main menu's search page, ...) renders the identical card from the
  // identical code instead of a second, drifting copy of it, exactly as
  // window.SkillDetails does for skills.
  if (!window.ItemInspect) {
    window.ItemInspect = (() => {

      // Rarity is sourced from the theme-defined --rarity-* tokens so the grid
      // stripe and the inspect-panel label always match the active theme palette.
      const rarityOf = (item) => {
        const make = (key, name) => ({ name, key, color: `var(--rarity-${key})` });
        if (!item) return make('common', T('Inventory.rarity.common'));
        if (item.meta && item.meta.Rarity) {
          const r = item.meta.Rarity.trim().toLowerCase();
          if (r === 'mythic' || r === 'legendary') return make('legendary', T('Inventory.rarity.mythic'));
          if (r === 'epic')                        return make('epic',      T('Inventory.rarity.epic'));
          if (r === 'rare')                        return make('rare',      T('Inventory.rarity.rare'));
          if (r === 'uncommon')                    return make('uncommon',  T('Inventory.rarity.uncommon'));
          if (r === 'common')                      return make('common',    T('Inventory.rarity.common'));
        }
        if (item.price >= 1200) return make('legendary', T('Inventory.rarity.mythic'));
        if (item.price >= 600)  return make('rare',      T('Inventory.rarity.rare'));
        if (item.price >= 200)  return make('uncommon',  T('Inventory.rarity.uncommon'));
        return make('common', T('Inventory.rarity.common'));
      };

      const typeLabelOf = (item) => {
        if (!item) return T('Inventory.itemType.standard');
        if (DataManager.isWeapon(item)) return T('Inventory.itemType.weapon');
        if (DataManager.isArmor(item))  return T('Inventory.itemType.armor');
        const has = (cat) => !!(window.ItemSystemUtils && window.ItemSystemUtils.hasItemCategory(item, cat));
        if (has('Food'      /* i18n-ignore: category tag */)) return T('Inventory.itemType.food');
        if (has('Medical'   /* i18n-ignore: category tag */)) return T('Inventory.itemType.medical');
        if (has('Tools'     /* i18n-ignore: category tag */)) return T('Inventory.itemType.tools');
        if (has('Materials' /* i18n-ignore: category tag */)) return T('Inventory.itemType.materials');
        return T('Inventory.itemType.standard');
      };

      // The plain, informative phrase from the database (what the item does).
      // ItemDescription keeps $dataItems in sync with the world seed, so reading
      // the field here is enough.
      const descriptionOf = (item) => {
        if (!item || !item.description) return '';
        let text = String(item.description).trim();
        if (!text) return '';
        if (window.translateText && typeof window.translateText === 'function') text = window.translateText(text);
        return text.replace(/\n/g, '<br>');
      };

      const loreOf = (item, itemType) => {
        if (!item) return '';
        if (item.meta && item.meta.Lore && String(item.meta.Lore).trim().length > 0) {
          // The tag holds a key; loreTemplate turns it into the template.
          let lore = (window.ItemSystemUtils && window.ItemSystemUtils.loreTemplate)
            ? window.ItemSystemUtils.loreTemplate(item.meta.Lore)
            : String(item.meta.Lore).trim();
          if (window.ItemSystemUtils && typeof window.ItemSystemUtils.fillLore === 'function') lore = window.ItemSystemUtils.fillLore(lore, item.id);
          return lore;
        }
        // No description fallback here: the short description is drawn on its own
        // line above the lore (descriptionOf), so repeating it would print the
        // same sentence twice.
        if (itemType === T('Inventory.itemType.medical')) return T('Inventory.blurb.remedy');
        if (itemType === T('Inventory.itemType.food'))    return T('Inventory.blurb.provision');
        if (itemType === T('Inventory.itemType.weapon'))  return T('Inventory.blurb.armament');
        if (itemType === T('Inventory.itemType.armor'))   return T('Inventory.blurb.shield');
        if (itemType === T('Inventory.itemType.tools'))   return T('Inventory.blurb.apparatus');
        return T('Inventory.blurb.specimen');
      };

      // ---- Metadata sections -------------------------------------------------
      const getParamName = (id) => (['HP','MP','STR','CON','INT','WIS','DEX','PSI'][id] || T('Inventory.spec.stat'));

      const translateFormula = (formula) => {
        if (!formula) return '';
        return formula
          .replace(/\b[ab]\.mhp\b/gi, T('Inventory.spec.maxHp')).replace(/\b[ab]\.mmp\b/gi, T('Inventory.spec.maxMp'))
          .replace(/\b[ab]\.hp\b/gi,  'HP').replace(/\b[ab]\.mp\b/gi,  'MP').replace(/\b[ab]\.tp\b/gi, 'AP')
          .replace(/\b[ab]\.atk\b/gi, 'STR').replace(/\b[ab]\.def\b/gi, 'CON')
          .replace(/\b[ab]\.mat\b/gi, 'INT').replace(/\b[ab]\.mdf\b/gi, 'WIS')
          .replace(/\b[ab]\.agi\b/gi, 'DEX').replace(/\b[ab]\.luk\b/gi, 'PSI');
      };
      const getHitTypeName    = (h) => (T.list('Inventory.spec.hitType')[h] || T.list('Inventory.spec.hitType')[0]);
      const getOccasionName   = (o) => (T.list('Inventory.spec.occasion')[o] || T.list('Inventory.spec.occasion')[0]);
      const getScopeName      = (s) => (T.list('Inventory.spec.scope')[s] || T('Inventory.spec.none'));
      const getDamageTypeName = (t) => (T.list('Inventory.spec.damageType')[t] || T('Inventory.spec.none'));

      const parseRecipeToNames = (recipeStr) => {
        if (!recipeStr) return '';
        return recipeStr.split(',').map(part => {
          const m = part.trim().match(/^(\d+)x(\d+)$/i);
          if (m) { const obj = $dataItems[parseInt(m[1],10)]; return obj ? `${obj.name} x${m[2]}` : T('Inventory.section.unknownStack', { n: m[2] }); }
          return part.trim();
        }).join(', ');
      };

      const buildSpecRows = (specs) => specs.map(s => `
        <div class="inspect-spec-row">
          <span class="inspect-spec-label">${s.label}:</span>
          <span class="inspect-spec-value" ${s.colored ? `style="color:${s.colored};"` : ''}>${s.val}</span>
        </div>`).join('');

      // Everything under the header: description, lore, and every spec block the
      // item has anything to say in.
      function detailsHTML(selectedItem) {
        if (!selectedItem) return '';
        const isWeapon = DataManager.isWeapon(selectedItem);
        const isArmor  = DataManager.isArmor(selectedItem);
        const isItem   = DataManager.isItem(selectedItem);
        const itemType = typeLabelOf(selectedItem);
        const loreText = loreOf(selectedItem, itemType);

        const generalSpecs = [];
        if (isWeapon) { generalSpecs.push({ label: T('Inventory.spec.label.weaponType'), val: $dataSystem.weaponTypes[selectedItem.wtypeId] || T('Inventory.spec.label.weaponFallback') }); }
        else if (isArmor) {
          generalSpecs.push({ label: T('Inventory.spec.label.armorType'), val: $dataSystem.armorTypes[selectedItem.atypeId] || T('Inventory.spec.label.armorFallback') });
          generalSpecs.push({ label: T('Inventory.spec.label.equipSlot'), val: $dataSystem.equipTypes[selectedItem.etypeId] || T('Inventory.spec.label.slotFallback') });
        } else if (isItem) {
          generalSpecs.push({ label: T('Inventory.spec.label.consumable'), val: selectedItem.consumable ? T('Inventory.spec.yes') : T('Inventory.spec.no') });
          generalSpecs.push({ label: T('Inventory.spec.label.occasion'),   val: getOccasionName(selectedItem.occasion) });
          generalSpecs.push({ label: T('Inventory.spec.label.scope'),      val: getScopeName(selectedItem.scope) });
        }

        const paramSpecs = [];
        if (selectedItem.params) {
          selectedItem.params.forEach((val, pIdx) => {
            if (val !== 0) paramSpecs.push({ label: getParamName(pIdx), val: (val > 0 ? '+' : '') + val });
          });
        }

        const invocationSpecs = [];
        if (isItem) {
          if (selectedItem.speed !== 0)         invocationSpecs.push({ label: T('Inventory.spec.label.speedAdjust'),       val: (selectedItem.speed > 0 ? '+' : '') + selectedItem.speed });
          if (selectedItem.successRate !== 100) invocationSpecs.push({ label: T('Inventory.spec.label.successRate'),        val: selectedItem.successRate + '%' });
          if (selectedItem.repeats > 1)         invocationSpecs.push({ label: T('Inventory.spec.label.repeatActions'),      val: 'x' + selectedItem.repeats });
          if (selectedItem.tpGain > 0)          invocationSpecs.push({ label: T('Inventory.spec.label.apGain'),             val: '+' + selectedItem.tpGain });
          if (selectedItem.hitType !== 0)       invocationSpecs.push({ label: T('Inventory.spec.label.hitClassification'),  val: getHitTypeName(selectedItem.hitType) });
        }

        const damageSpecs = [];
        if (selectedItem.damage && selectedItem.damage.type > 0) {
          damageSpecs.push({ label: T('Inventory.spec.label.damageType'), val: getDamageTypeName(selectedItem.damage.type) });
          if (selectedItem.damage.elementId > 0) damageSpecs.push({ label: T('Inventory.spec.label.attackElement'), val: $dataSystem.elements[selectedItem.damage.elementId] || T('Inventory.spec.noneValue') });
          const formula = selectedItem.damage.formula ? selectedItem.damage.formula.trim() : '';
          if (formula && formula !== '0' && formula !== '0.0') damageSpecs.push({ label: T('Inventory.spec.label.formula'), val: translateFormula(formula) });
          if (selectedItem.damage.variance > 0)  damageSpecs.push({ label: T('Inventory.spec.label.variance'),    val: selectedItem.damage.variance + '%' });
          if (selectedItem.damage.critical)      damageSpecs.push({ label: T('Inventory.spec.label.canCritical'), val: T('Inventory.spec.yes') });
        }

        // Effects are grouped by kind so a long state list collapses into a
        // single "Remove States: A, B, C" bullet instead of one bullet each.
        const effectsOrdered = [];
        const effectGroups   = {};
        const addEffectGroup = (key, label, entry) => {
          let g = effectGroups[key];
          if (!g) { g = effectGroups[key] = { label, items: [] }; effectsOrdered.push({ group: g }); }
          g.items.push(entry);
        };
        const addEffectSolo = (text) => { if (text) effectsOrdered.push({ text }); };
        if (selectedItem.effects) {
          selectedItem.effects.forEach(eff => {
            const v1 = eff.value1; const v2 = eff.value2; const did = eff.dataId;
            if      (eff.code === 21) { const s = $dataStates[did]; if (s && s.name) addEffectGroup('addState', T('Inventory.effect.addStates'), `${s.name} ${Math.round(v1*100)}%`); }
            else if (eff.code === 22) { const s = $dataStates[did]; if (s && s.name) { const pct = Math.round(v1*100); addEffectGroup('remState', T('Inventory.effect.removeStates'), `${s.name}${pct === 100 ? '' : ` (${pct}%)`}`); } }
            else if (eff.code === 31) addEffectGroup('addBuff',   T('Inventory.effect.addBuffs'),      T('Inventory.effect.turns', { param: getParamName(did), n: v1 }));
            else if (eff.code === 32) addEffectGroup('addDebuff', T('Inventory.effect.addDebuffs'),    T('Inventory.effect.turns', { param: getParamName(did), n: v1 }));
            else if (eff.code === 33) addEffectGroup('remBuff',   T('Inventory.effect.removeBuffs'),   getParamName(did));
            else if (eff.code === 34) addEffectGroup('remDebuff', T('Inventory.effect.removeDebuffs'), getParamName(did));
            else if (eff.code === 11 && (v1 !== 0 || v2 !== 0)) addEffectSolo(T('Inventory.effect.recoverHp', { amount: `${v1>0?Math.round(v1*100)+'%':''}${v1>0&&v2>0?' + ':''}${v2>0?v2:''}` }));
            else if (eff.code === 12 && (v1 !== 0 || v2 !== 0)) addEffectSolo(T('Inventory.effect.recoverMp', { amount: `${v1>0?Math.round(v1*100)+'%':''}${v1>0&&v2>0?' + ':''}${v2>0?v2:''}` }));
            else if (eff.code === 13) addEffectSolo(T('Inventory.effect.gainAp', { n: did }));
            else if (eff.code === 41) addEffectGroup('grow', T('Inventory.effect.grow'), `${getParamName(did)} +${v1}`);
            else if (eff.code === 42) { const sk = $dataSkills[did]; if (sk && sk.name) addEffectGroup('learn', T('Inventory.effect.learnSkills'), sk.name); }
          });
        }

        const traitsList = [];
        if (selectedItem.traits) {
          selectedItem.traits.forEach(tr => {
            const val = tr.value; const did = tr.dataId; let desc = '';
            if      (tr.code === 11) { const el = $dataSystem.elements[did]; desc = T('Inventory.trait.resistance', { element: el || T('Inventory.trait.elementFallback'), pct: Math.round(val*100) }); }
            else if (tr.code === 12) desc = T('Inventory.trait.debuffRate', { param: getParamName(did), pct: Math.round(val*100) });
            else if (tr.code === 13) { const s = $dataStates[did]; if (s&&s.name) desc = T('Inventory.trait.susceptibility', { state: s.name, pct: Math.round(val*100) }); }
            else if (tr.code === 14) { const s = $dataStates[did]; if (s&&s.name) desc = T('Inventory.trait.resistState', { state: s.name }); }
            else if (tr.code === 21) { const el = $dataSystem.elements[did]; desc = T('Inventory.trait.attackElement', { element: el || T('Inventory.trait.physicalFallback') }); }
            else if (tr.code === 22) desc = T('Inventory.trait.attackSpeed', { value: `${val>0?'+':''}${val}` });
            else if (tr.code === 23) desc = T('Inventory.trait.attackTimes', { value: val });
            else if (tr.code === 31) desc = T('Inventory.trait.paramRate', { param: getParamName(did), pct: Math.round(val*100) });
            else if (tr.code === 32) { const exN = T.list('Inventory.xparam'); desc = T('Inventory.trait.xparamLine', { name: exN[did] || T('Inventory.trait.specialStat'), value: `${val>=0?'+':''}${Math.round(val*100)}` }); }
            else if (tr.code === 33) { const spN = T.list('Inventory.sparam'); desc = T('Inventory.trait.sparamLine', { name: spN[did] || T('Inventory.trait.specialProperty'), pct: Math.round(val*100) }); }
            else if (tr.code === 51) { const wt = $dataSystem.weaponTypes[did]; desc = T('Inventory.trait.allowsWeapon', { type: wt || T('Inventory.spec.label.weaponFallback') }); }
            else if (tr.code === 52) { const at = $dataSystem.armorTypes[did];  desc = T('Inventory.trait.allowsArmor', { type: at || T('Inventory.spec.label.armorFallback') }); }
            else if (tr.code === 53) { const eq = $dataSystem.equipTypes[did];  desc = T('Inventory.trait.lockSlot', { slot: eq || T('Inventory.spec.label.slotFallback') }); }
            else if (tr.code === 54) { const eq = $dataSystem.equipTypes[did];  desc = T('Inventory.trait.sealSlot', { slot: eq || T('Inventory.spec.label.slotFallback') }); }
            else if (tr.code === 55) desc = T('Inventory.trait.dualWielding');
            if (desc) traitsList.push(desc);
          });
        }

        const noteTags = []; const nutritionSpecs = [];
        if (selectedItem.note) {
          const matches = selectedItem.note.match(/<([^>]+)>/g);
          if (matches) {
            matches.forEach(m => {
              const inner = m.slice(1,-1).trim();
              const colonIdx = inner.indexOf(':');
              let name = inner; let val = '';
              if (colonIdx !== -1) { name = inner.substring(0, colonIdx).trim(); val = inner.substring(colonIdx+1).trim(); }
              const nl = name.toLowerCase();
              if (nl === 'movement' || nl === 'weight' || nl === 'category' || nl === 'uncraftable') return;
              if (nl === 'needrestore') return; // rendered as its own "Needs Restored" section below
              // <Lore:> holds a bank key, not a sentence. It is already resolved
              // and printed as the flavour paragraph above, so listing it here
              // only leaks the key ("LoreItems.119") onto the page.
              if (nl === 'lore') return;
              if (nl === 'calories' || nl === 'fat' || nl === 'protein') { nutritionSpecs.push({ label: nl.charAt(0).toUpperCase()+nl.slice(1), val }); return; }
              if (nl === 'recipe') { noteTags.push({ name: T('Inventory.section.craftingRecipe'), value: parseRecipeToNames(val) }); return; }
              // <Nature:> says whether a thing is worked by hand or by art.
              // "Both" is the database's way of saying "nothing magical about
              // it", which is what the player wants to read.
              if (nl === 'nature') {
                const nature = val.toLowerCase() === 'both' ? 'Mundane' /* i18n-ignore: note-tag value, named below */ : val;
                const key = 'Inventory.nature.' + nature.toLowerCase();
                noteTags.push({ name: T('Inventory.nature.label'), value: T.has(key) ? T(key) : nature });
                return;
              }
              noteTags.push({ name: name.charAt(0).toUpperCase()+name.slice(1), value: val || T('Inventory.spec.yes') });
            });
          }
        }

        // The short description states what the item does; the lore below it is
        // the combinatorial, world-seeded flavour. Both are shown.
        const shortDesc = descriptionOf(selectedItem);
        let detailedInfoHTML = '';
        if (shortDesc) detailedInfoHTML += `<div class="inspect-desc">${shortDesc}</div>`;
        if (loreText)  detailedInfoHTML += `<div class="inspect-flavour">${loreText}</div>`;

        if (generalSpecs.length)    { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.specifications')}</div>`         + buildSpecRows(generalSpecs); }
        if (paramSpecs.length)      { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.attributeModifiers')}</div>`   + paramSpecs.map(s => `<div class="inspect-spec-row"><span class="inspect-spec-label">${s.label}:</span><span class="inspect-spec-value" style="color:${s.val.startsWith('+')?'#2e7d32':'#c62828'};">${s.val}</span></div>`).join(''); }
        if (invocationSpecs.length) { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.invocationStats')}</div>`      + buildSpecRows(invocationSpecs); }
        if (damageSpecs.length)     { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.combatApplication')}</div>`    + buildSpecRows(damageSpecs); }
        if (effectsOrdered.length) {
          detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.medicalEffects')}</div>` + effectsOrdered.map(e =>
            e.group
              ? `<div class="inspect-bullet-item"><span class="inspect-effect-label">${e.group.label}:</span> ${e.group.items.join(', ')}</div>`
              : `<div class="inspect-bullet-item">${e.text}</div>`
          ).join('');
        }
        if (traitsList.length)      { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.specialProperties')}</div>`   + traitsList.map(t => `<div class="inspect-bullet-item">${t}</div>`).join(''); }
        if (nutritionSpecs.length)  { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.nutritionalProfile')}</div>`  + buildSpecRows(nutritionSpecs); }
        const needRestores = window.ItemSystemUtils && window.ItemSystemUtils.getNeedRestores ? window.ItemSystemUtils.getNeedRestores(selectedItem) : [];
        if (needRestores.length) {
          detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.needsRestored')}</div>` + needRestores.map(r => `
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${r.label}:</span>
              <span class="inspect-spec-value" style="color:${r.color};font-weight:bold;">+${r.amount}%</span>
            </div>`).join('');
        }
        // What this item is medicine for. A course is only worth anything taken
        // daily, so the number of doses each illness asks for is printed beside
        // it; anything it merely holds at bay is listed separately.
        const medicine = window.ItemSystemUtils && window.ItemSystemUtils.getMedicineInfo
          ? window.ItemSystemUtils.getMedicineInfo(selectedItem) : null;
        if (medicine) {
          detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.medicine')}</div>`;
          detailedInfoHTML += `
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${T('Shop.medicineClass')}:</span>
              <span class="inspect-spec-value">${medicine.label}</span>
            </div>`;
          if (medicine.cures.length) {
            detailedInfoHTML += medicine.cures.slice(0, 24).map(c => `
              <div class="inspect-spec-row">
                <span class="inspect-spec-label">${c.name}:</span>
                <span class="inspect-spec-value">${T('Inventory.medicineDoses', { days: c.days })}</span>
              </div>`).join('');
            if (medicine.cures.length > 24) {
              detailedInfoHTML += `<div class="inspect-bullet-item">${T('Shop.medicineMore', { count: medicine.cures.length - 24 })}</div>`;
            }
          }
          if (medicine.treats.length) {
            detailedInfoHTML += `<div class="inspect-bullet-item"><span class="inspect-effect-label">${T('Shop.medicineTreats')}:</span> ${medicine.treats.map(t => t.name).join(', ')}</div>`;
          }
        }
        const cravingsFed = window.ItemSystemUtils && window.ItemSystemUtils.getAddictionRelief ? window.ItemSystemUtils.getAddictionRelief(selectedItem) : [];
        if (cravingsFed.length) {
          detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.cravingsFed')}</div>` + cravingsFed.map(r => `
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${r.label}:</span>
              <span class="inspect-spec-value" style="color:#7B6A55;font-weight:bold;">-${r.amount}%</span>
            </div>`).join('');
        }
        if (noteTags.length)        { detailedInfoHTML += `<div class="inspect-section-title">${T('Inventory.section.blueprints')}</div>` + noteTags.map(tag => `<div class="inspect-spec-row"><span class="inspect-spec-label">${tag.name}:</span><span class="inspect-spec-value" style="font-style: normal;max-width:60%;text-align:right;word-wrap:break-word;">${tag.value}</span></div>`).join(''); }

        return detailedInfoHTML;
      }

      // The whole card. `opts.nameExtraHTML` rides beside the name (the backpack
      // hangs its favourite star there), `opts.actionsHTML` fills the button
      // strip, and `opts.extraHTML` is dropped between the meta grid and the
      // details (the search page mounts its 3D weapon viewport there).
      function build(item, opts) {
        if (!item) return '';
        const o = opts || {};
        const canvasId = o.canvasId || 'inspect-canvas';
        const rarity   = rarityOf(item);
        const itemType = typeLabelOf(item);
        const weightVal = (window.ItemSystemUtils && window.ItemSystemUtils.getItemWeight ? window.ItemSystemUtils.getItemWeight(item) : 0) / 1000;
        const valueVal  = ((item.price || 0) / 100).toFixed(2);

        return `
        <div class="item-inspect">
          <div class="inspect-header">
            <div class="inspect-frame">
              <canvas id="${canvasId}" width="32" height="32" style="width:36px;height:36px;image-rendering:pixelated;"></canvas>
            </div>
            <div class="inspect-title-box">
              <h3 class="inspect-name">${item.name}${o.nameExtraHTML || ''}</h3>
              <div class="inspect-rarity" style="color:${rarity.color};">${rarity.name} ${itemType}</div>
            </div>
          </div>
          <div class="inspect-meta-grid" style="${weightVal === 0 ? 'grid-template-columns:1fr;' : ''}">
            ${weightVal > 0 ? `<div class="inspect-meta-item"><span>${T('Inventory.section.unitWeight')}</span><span class="inspect-meta-val">${weightVal.toFixed(2)} kg</span></div>` : ''}
            <div class="inspect-meta-item"><span>${T('Inventory.section.marketValue')}</span><span class="inspect-meta-val">${valueVal} €</span></div>
          </div>
          ${o.extraHTML || ''}
          <div class="inspect-lore">${detailsHTML(item)}</div>
          <div class="inspect-actions">${o.actionsHTML || ''}</div>
        </div>`;
      }

      // The icon painter every caller of build() needs for its header canvas.
      function drawIcon(iconIndex, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const bitmap = ImageManager.loadSystem('IconSet');
        const draw = () => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.clearRect(0, 0, 32, 32);
          ctx.imageSmoothingEnabled = false;
          const sx = (iconIndex % 16) * 32;
          const sy = Math.floor(iconIndex / 16) * 32;
          ctx.drawImage(bitmap.canvas, sx, sy, 32, 32, 0, 0, 32, 32);
        };
        if (bitmap.isReady()) draw(); else bitmap.addLoadListener(draw);
      }

      return { rarityOf, typeLabelOf, descriptionOf, loreOf, detailsHTML, build, drawIcon };
    })();
  }

  // =========================================================================
  // Scene_EnhancedItem.prototype.create, DOM extension
  // =========================================================================

  const _Scene_EnhancedItem_create = Scene_EnhancedItem.prototype.create;
  Scene_EnhancedItem.prototype.create = function () {
    _Scene_EnhancedItem_create.call(this);

    // WASD state
    this._wasdInput      = { up: false, down: false, left: false, right: false };
    this._wasdHeld       = { up: false, down: false, left: false, right: false };
    this._wasdHoldFrames = { up: 0,     down: 0,     left: 0,     right: 0     };

    this._wasdListener = (event) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === 'w') { this._wasdInput.up    = true; this._wasdHeld.up    = true; event.preventDefault(); }
      if (key === 's') { this._wasdInput.down  = true; this._wasdHeld.down  = true; event.preventDefault(); }
      if (key === 'a') { this._wasdInput.left  = true; this._wasdHeld.left  = true; event.preventDefault(); }
      if (key === 'd') { this._wasdInput.right = true; this._wasdHeld.right = true; event.preventDefault(); }
    };
    this._wasdUpListener = (event) => {
      const key = event.key.toLowerCase();
      if (key === 'w') { this._wasdHeld.up    = false; this._wasdHoldFrames.up    = 0; }
      if (key === 's') { this._wasdHeld.down  = false; this._wasdHoldFrames.down  = 0; }
      if (key === 'a') { this._wasdHeld.left  = false; this._wasdHoldFrames.left  = 0; }
      if (key === 'd') { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
    };
    window.addEventListener('keydown', this._wasdListener);
    window.addEventListener('keyup',   this._wasdUpListener);

    // DOM state
    this._activeUICategory    = 'All'; // i18n-ignore: category id
    this._activeCategoryIndex = 0;
    this._dndSelectedIndex    = 0;
    this._dndActiveSection    = 'items';
    this._selectedActionIndex = 0;
    this._selectedTargetIndex = 0;
    this._dndTargetingMode    = false;
    this._dndTargetingItem    = null;
    this._dndActionsList      = [];
    this._discardModalOpen    = false;
    this._discardPendingItem  = null;
    this._discardModalFocusIdx = 0;
    this._discardQty          = 1;
    this._searchText          = '';
    this._dndSortKey          = 'name';
    this._dndSortDirection    = 'asc';
    this._lastGridDataKey     = '';

    this.createUIbackpackOverlay();
  };

  // =========================================================================
  // update / terminate
  // =========================================================================

  Scene_EnhancedItem.prototype.update = function () {
    Scene_MenuBase.prototype.update.call(this);
    UIbackpackInputManager.update();
  };

  Scene_EnhancedItem.prototype.terminate = function () {
    if (this._wasdListener) {
      window.removeEventListener('keydown', this._wasdListener);
      window.removeEventListener('keyup',   this._wasdUpListener);
      this._wasdListener   = null;
      this._wasdUpListener = null;
    }

    UIbackpackInputManager.deactivate();

    // The bar's root is a child of the container about to be torn down.
    if (window.ItemHotbar) window.ItemHotbar.disposeInventoryBar();

    if (this._dndContainer) {
      const container = this._dndContainer;
      container.style.transition  = 'opacity 0.2s ease-out';
      container.style.opacity     = '0';
      container.style.pointerEvents = 'none';
      setTimeout(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container);
      }, 200);
      this._dndContainer = null;
    }

    Scene_MenuBase.prototype.terminate.call(this);
  };

  // =========================================================================
  // createUIbackpackOverlay
  // =========================================================================

  Scene_EnhancedItem.prototype.createUIbackpackOverlay = function () {
    this._dndContainer = document.createElement('div');
    this._dndContainer.id = 'menu-container';
    this._dndContainer.style.opacity    = '0';
    this._dndContainer.style.transition = 'opacity 0.22s ease-out';
    document.body.appendChild(this._dndContainer);

    this._rightClickStartedHere = false;
    this._dndContainer.addEventListener('mousedown', (event) => {
      if (event.button === 2) { this._rightClickStartedHere = true; event.stopPropagation(); }
    });
    this._dndContainer.addEventListener('mouseup', (event) => {
      if (event.button === 2) event.stopPropagation();
    });
    this._dndContainer.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this._rightClickStartedHere) return;
      this._rightClickStartedHere = false;
      const scene = SceneManager._scene;
      if (scene && scene.isActive()) {
        if (scene._discardModalOpen) { SoundManager.playCancel(); scene.cancelDiscard(); }
        else { UIbackpackInputManager.handleCancel(); }
      }
    });
    this._dndContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const content = this._dndContainer.querySelector('#backpack-grid');
      if (content) content.scrollTop += e.deltaY;
    }, { passive: false });

    this.refreshUIbackpack();
    UIbackpackInputManager.activate(this);

    setTimeout(() => {
      if (this._dndContainer) this._dndContainer.style.opacity = '1';
    }, 16);
  };

  // =========================================================================
  // refreshUIbackpack, full DOM rebuild (called on tab/data change)
  // =========================================================================

  Scene_EnhancedItem.prototype.refreshUIbackpack = function () {
    if (!this._dndContainer) return;

    const itemsList = this.getFilteredUIItems();

    const setupLazyLoading = (gridContainer) => {
      if (!gridContainer) return;
      if (typeof IntersectionObserver === 'undefined') {
        itemsList.forEach((item, idx) => this.drawUIItemIcon(item.iconIndex, `item-canvas-${idx}`));
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const slot      = entry.target;
            const canvasId  = slot.getAttribute('data-canvas-id');
            const iconIndex = parseInt(slot.getAttribute('data-icon-index'), 10);
            this.drawUIItemIcon(iconIndex, canvasId);
            observer.unobserve(slot);
          }
        });
      }, { root: gridContainer, rootMargin: '50px' });
      gridContainer.querySelectorAll('.item-slot').forEach(slot => observer.observe(slot));
    };

    if (this._dndSelectedIndex >= itemsList.length) {
      this._dndSelectedIndex = Math.max(0, itemsList.length - 1);
    }
    const selectedItem    = itemsList[this._dndSelectedIndex] || null;
    this._dndSelectedItem = selectedItem;

    // ---- Category tab row ----
    // Read off the pockets rather than fixed: every category actually carried
    // has a tab, in alphabetical order behind All and Favourites, and the row
    // wraps to as many lines as that takes.
    const categories = this.uiCategories();
    // The last of a category can leave the pockets while its tab is the one
    // being read; the filter falls back to All rather than showing nothing
    // under a tab that is no longer there to press.
    if (!categories.includes(this._activeUICategory)) {
      this._activeUICategory = categories[0];
      this._activeCategoryIndex = 0;
    }

    const tabsHTML = `
      <div class="backpack-tabs-row">${categories.map((cat, idx) => {
        const isActive = this._activeUICategory === cat ? 'active' : '';
        const isFocused = (this._dndActiveSection === 'categories' && this._activeCategoryIndex === idx) ? 'selected' : '';
        // `cat` is the category name the scene filters on; only the caption is
        // localised, and a category nobody has translated reads as itself.
        const caption = this.uiCategoryLabel(cat);
        return `<div class="backpack-tab ${isActive} ${isFocused}" onclick="SceneManager._scene.setUICategory(this.dataset.cat)" data-cat="${escapeHtml(cat)}">${escapeHtml(caption)}</div>`;
      }).join('')}</div>
    `;

    // ---- Item grid ----
    let gridHTML = '';
    // Signature of what the grid actually shows (identity, order, stack size,
    // favorite mark). Equipping swaps one weapon out and the replaced one back
    // in, so the list length alone never notices the change and the slots keep
    // their stale onclick indices.
    let gridSignature = '';
    // Under All the pockets are read as a categorized list: a full-width
    // heading opens each group. The headings are not .item-slot elements, so
    // the slot indices the grid is navigated and clicked by stay untouched.
    const grouped = this.isUIGroupedView();
    let lastGroup = null;
    if (itemsList.length === 0) {
      gridHTML = `<div class="item-grid-empty">${T('Inventory.empty')}</div>`;
    } else {
      itemsList.forEach((item, idx) => {
        if (grouped) {
          const group = this.uiGroupOf(item);
          if (group !== lastGroup) {
            lastGroup = group;
            gridHTML += `<div class="backpack-group-title">${escapeHtml(this.uiCategoryLabel(group))}</div>`;
          }
        }
        const isFocused  = (this._dndActiveSection === 'items' && this._dndSelectedIndex === idx) ? 'selected' : '';
        const count      = $gameParty.numItems(item);
        const weight     = window.ItemSystemUtils && window.ItemSystemUtils.getItemWeight ? window.ItemSystemUtils.getItemWeight(item) : 0;
        const weightTotal = ((weight * count) / 1000).toFixed(2);
        const canvasId   = `item-canvas-${idx}`;
        const rarity     = this.getUIItemRarity(item);
        const kind       = DataManager.isWeapon(item) ? 'w' : DataManager.isArmor(item) ? 'a' : 'i';
        gridSignature   += `${kind}${item.id}x${count}${this.isItemFavorited(item) ? '*' : ''},`;
        gridHTML += `
          <div class="item-slot ${isFocused}" data-icon-index="${item.iconIndex}" data-canvas-id="${canvasId}" onclick="SceneManager._scene.selectUIItem(${idx})">
            <div class="item-rarity-bar" style="background:${rarity.color};"></div>
            <div class="item-slot-icon">
              <canvas id="${canvasId}" width="32" height="32" style="width:32px;height:32px;"></canvas>
            </div>
            <div class="item-slot-info">
              <div class="item-slot-name">${this.isItemFavorited(item) ? '★ ' : ''}${item.name}</div>
              <div class="item-slot-meta">
                ${weight > 0 ? `<span>${weightTotal} kg</span>` : '<span></span>'}
                <span class="item-slot-count">x${count}</span>
              </div>
            </div>
          </div>`;
      });
    }

    // ---- Weight bar ----
    const currentWeight  = (window.ItemSystemUtils ? window.ItemSystemUtils.calculateTotalWeight() : 0) / 1000;
    const maxWeight      = (window.ItemSystemUtils ? window.ItemSystemUtils.calculateMaxCarryWeight() : 60000) / 1000;
    const weightPercent  = Math.min(100, Math.floor((currentWeight / maxWeight) * 100));
    const backpackTitle  = T('Inventory.title');
    const backBtnText    = T('Inventory.back');
    const searchPlaceholder = T('Inventory.searchPlaceholder');

    // The carry gauge rides in the quick-slot header rather than owning a band
    // of its own above it: two lines of chrome for one number was a waste of the
    // page, and the weight is read while looking at the slots anyway. The
    // .weight-lbl-row / .weight-progress-fill hooks are kept so the in-place
    // refresh below still finds the value and the bar.
    const weightGaugeHTML = `
      <div class="weight-status">
        <div class="weight-lbl-row">
          <span>${T('Inventory.ui.carryWeight')}</span>
          <span>${currentWeight.toFixed(2)} / ${maxWeight.toFixed(2)} kg</span>
        </div>
        <div class="weight-progress">
          <div class="weight-progress-fill" style="width:${weightPercent}%;"></div>
        </div>
      </div>`;

    // ---- Sort tags ----
    const sortTagsHTML = ['name', 'weight', 'price'].map(key => {
      const isActive = this._dndSortKey === key;
      const arrow    = this._dndSortDirection === 'asc' ? '▲' : '▼';
      const label    = T('Inventory.sort.' + key);
      return `<div class="sort-tag ${isActive ? 'active' : ''}" onclick="SceneManager._scene.toggleUISort('${key}')">${label}${isActive ? ' ' + arrow : ''}</div>`;
    }).join('');

    // ---- Left page HTML ----
    const leftPageHTML = `
      <div class="left-page">
        <div class="page-header-bar">
          <div class="back-button" onclick="SceneManager._scene.onItemCancel()">${backBtnText}</div>
          <h2 class="title">${backpackTitle}</h2>
        </div>
        <div class="backpack-tabs">${tabsHTML}</div>
        <div class="backpack-search">
          <input type="text" id="backpack-search-input" class="backpack-search-input"
            placeholder="${searchPlaceholder}" autocomplete="off"
            value="${this._searchText || ''}"
            oninput="SceneManager._scene.onSearchInput(this.value)"
            onkeydown="event.stopPropagation(); if(event.key==='Escape'){this.blur();SceneManager._scene.clearSearch();}"
            onkeyup="event.stopPropagation();"
            onkeypress="event.stopPropagation();"/>
          <div class="backpack-sort-tags">${sortTagsHTML}</div>
        </div>
        <div class="backpack-grid" id="backpack-grid">${gridHTML}</div>
        ${window.ItemHotbar ? window.ItemHotbar.inventoryBarHTML(weightGaugeHTML) : `<div class="backpack-hotbar"><div class="backpack-hotbar-head">${weightGaugeHTML}</div></div>`}
      </div>`;

    const gridDataKey = `${this._activeUICategory}_${this._searchText || ''}_${this._dndSortKey}_${this._dndSortDirection}_${itemsList.length}_${gridSignature}`;
    const leftPageContainer = this._dndContainer.querySelector('.left-page');

    // ---- Right page HTML ----
    let rightPageInnerHTML = '';

    if (this._dndTargetingMode && this._dndTargetingItem) {
      const item = this._dndTargetingItem;
      let targetsHTML = '';
      $gameParty.members().forEach((actor, idx) => {
        const isFocused = (this._dndActiveSection === 'targets' && this._selectedTargetIndex === idx) ? 'selected' : '';
        targetsHTML += `<div class="target-option ${isFocused}" onclick="SceneManager._scene.applyUITarget(${idx})">${actor.name()} (HP: ${actor.hp}/${actor.mhp})</div>`;
      });
      if (item.scope === 8 || item.scope === 10) {
        const allFocused = (this._dndActiveSection === 'targets' && this._selectedTargetIndex === $gameParty.members().length) ? 'selected' : '';
        targetsHTML += `<div class="target-option ${allFocused}" onclick="SceneManager._scene.applyUITarget(${$gameParty.members().length})">${T('Inventory.ui.allPartyCompanions')}</div>`;
      }
      const specialCommands = this.parseSpecialCommands(item);
      specialCommands.forEach((specCmd, sIdx) => {
        const globalIdx = $gameParty.members().length + (item.scope === 8 || item.scope === 10 ? 1 : 0) + sIdx;
        const isFocused = (this._dndActiveSection === 'targets' && this._selectedTargetIndex === globalIdx) ? 'selected' : '';
        targetsHTML += `<div class="target-option ${isFocused}" onclick="SceneManager._scene.triggerUISpecialAction('${specCmd}')" style="background:#4a2711;border-color:#bba16d;color:#ecdcb9;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">${T('Inventory.ui.special', { command: specCmd })}</div>`;
      });
      rightPageInnerHTML = `
        <div class="target-overlay">
          <h3 class="target-title">${T('Inventory.ui.useItemOn', { item: item.name })}</h3>
          <div class="inspect-actions">
            ${targetsHTML}
            <div class="inspect-btn" onclick="SceneManager._scene.cancelUITargeting()" style="margin-top:15px;border-color:#555;color:#555;">${T('Inventory.ui.cancel')}</div>
          </div>
        </div>`;
    } else if (!selectedItem) {
      rightPageInnerHTML = `
        <div class="item-inspect item-inspect--empty" style="justify-content:center;text-align:center;padding:40px 10px;">
          <div class="inspect-placeholder-icon"></div>
          <h3 class="title">${T('Inventory.ui.inspectionLog')}</h3>
          <p class="inspect-placeholder-text">${T('Inventory.ui.inspectionPlaceholder')}</p>
        </div>`;
    } else {
      const isWeapon = DataManager.isWeapon(selectedItem);
      const isArmor  = DataManager.isArmor(selectedItem);

      // Action buttons
      let actionBtnsHTML = '';
      let btnIdx = 0;
      this._dndActionsList = [];

      const isUseable    = selectedItem.occasion === 0 || selectedItem.occasion === 2;
      const isEquippable = isWeapon || isArmor;

      if (isUseable) {
        const isFocused = (this._dndActiveSection === 'actions' && this._selectedActionIndex === btnIdx) ? 'selected' : '';
        actionBtnsHTML += `<div class="inspect-btn ${isFocused}" onclick="SceneManager._scene.triggerUIItemAction('use')">${T('Inventory.ui.useItem')}</div>`;
        this._dndActionsList.push('use'); btnIdx++;
      }
      if (isEquippable) {
        const isFocused = (this._dndActiveSection === 'actions' && this._selectedActionIndex === btnIdx) ? 'selected' : '';
        actionBtnsHTML += `<div class="inspect-btn ${isFocused}" onclick="SceneManager._scene.triggerUIItemAction('equip')">${T('Inventory.ui.equip')}</div>`;
        this._dndActionsList.push('equip'); btnIdx++;
      }

      if (window.Game_Map && Game_Map.prototype.isThrowBlocked) {
        const isThrowFocused = (this._dndActiveSection === 'actions' && this._selectedActionIndex === btnIdx) ? 'selected' : '';
        actionBtnsHTML += `<div class="inspect-btn ${isThrowFocused}" onclick="SceneManager._scene.triggerUIItemAction('throw')">${T('Inventory.ui.throw')}</div>`;
        this._dndActionsList.push('throw'); btnIdx++;
      }

      const isDiscardFocused = (this._dndActiveSection === 'actions' && this._selectedActionIndex === btnIdx) ? 'selected' : '';
      actionBtnsHTML += `<div class="inspect-btn inspect-btn--danger ${isDiscardFocused}" onclick="SceneManager._scene.triggerUIItemAction('discard')">${T('Inventory.ui.discard')}</div>`;
      this._dndActionsList.push('discard'); btnIdx++;

      // The card itself, from the shared inspect service (window.ItemInspect):
      // the main menu's search page renders the identical panel from it.
      const favStar = this.canFavoriteItem(selectedItem)
        ? `<span class="inspect-favorite-star ${this.isItemFavorited(selectedItem) ? 'active' : ''}" title="${T('Inventory.hotbar.starHint')}" onclick="event.stopPropagation(); SceneManager._scene.toggleFavoriteStatus(SceneManager._scene._dndSelectedItem);">${this.isItemFavorited(selectedItem) ? '★' : '☆'}</span>`
        : '';
      rightPageInnerHTML = window.ItemInspect.build(selectedItem, {
        nameExtraHTML: favStar,
        actionsHTML:   actionBtnsHTML
      });
    }

    const rightPageHTML = `<div class="right-page">${rightPageInnerHTML}</div>`;

    if (!leftPageContainer) {
      this._lastGridDataKey = gridDataKey;
      this._lastTabsKey = categories.join('|');
      this._dndContainer.innerHTML = `<div class="book-spread inspect-pockets">${leftPageHTML}${rightPageHTML}</div>`;
      setupLazyLoading(this._dndContainer.querySelector('#backpack-grid'));
    } else {
      // In-place update: tabs. The row itself is only rebuilt when the set of
      // categories changes — using the last of something takes its tab away —
      // and otherwise just has its active and focused marks moved.
      const tabsKey = categories.join('|');
      const tabsContainer = leftPageContainer.querySelector('.backpack-tabs');
      if (tabsContainer && this._lastTabsKey !== tabsKey) {
        this._lastTabsKey = tabsKey;
        tabsContainer.innerHTML = tabsHTML;
      }
      const tabs = leftPageContainer.querySelectorAll('.backpack-tab');
      tabs.forEach((tab, idx) => {
        const cat = categories[idx];
        tab.classList.toggle('active',    this._activeUICategory === cat);
        tab.classList.toggle('selected',  this._dndActiveSection === 'categories' && this._activeCategoryIndex === idx);
      });

      // Grid: full rebuild only on data change; otherwise just toggle selection
      const gridContainer = leftPageContainer.querySelector('#backpack-grid');
      if (gridContainer) {
        if (this._lastGridDataKey !== gridDataKey) {
          this._lastGridDataKey = gridDataKey;
          gridContainer.innerHTML = gridHTML;
          setupLazyLoading(gridContainer);
        } else {
          gridContainer.querySelectorAll('.item-slot').forEach((slot, idx) => {
            slot.classList.toggle('selected', idx === this._dndSelectedIndex && this._dndActiveSection === 'items');
          });
        }
      }

      // Sort tags + weight bar
      const sortTagsContainer = leftPageContainer.querySelector('.backpack-sort-tags');
      if (sortTagsContainer) sortTagsContainer.innerHTML = sortTagsHTML;
      const weightValueEl = leftPageContainer.querySelector('.weight-lbl-row span:last-child');
      if (weightValueEl) weightValueEl.textContent = `${currentWeight.toFixed(2)} / ${maxWeight.toFixed(2)} kg` /* i18n-ignore: unit */;
      const weightFillEl = leftPageContainer.querySelector('.weight-progress-fill');
      if (weightFillEl) weightFillEl.style.width = `${weightPercent}%`;

      // Right page
      const rightPageContainer = this._dndContainer.querySelector('.right-page');
      if (rightPageContainer) rightPageContainer.innerHTML = rightPageInnerHTML;
    }

    // The mount point survives the in-place updates above, so the bar is only
    // ever re-rendered into it, never rebuilt from scratch with the page.
    if (window.ItemHotbar) window.ItemHotbar.renderInventoryBar(this);

    if (selectedItem) this.drawUIItemIcon(selectedItem.iconIndex, 'inspect-canvas');

    if (this._dndActiveSection === 'items') {
      const selectedElem = this._dndContainer.querySelector('.item-slot.selected');
      if (selectedElem) selectedElem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  // =========================================================================
  // Helper rendering methods
  // =========================================================================

  Scene_EnhancedItem.prototype.drawUIItemIcon = function (iconIndex, canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const bitmap = ImageManager.loadSystem('IconSet');
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 32, 32);
      ctx.imageSmoothingEnabled = false;
      const pw = 32; const ph = 32;
      const sx = (iconIndex % 16) * pw;
      const sy = Math.floor(iconIndex / 16) * ph;
      ctx.drawImage(bitmap.canvas, sx, sy, pw, ph, 0, 0, 32, 32);
    };
    if (bitmap.isReady()) draw();
    else bitmap.addLoadListener(draw);
  };

  // Rarity, description and lore all live in the shared inspect service now, so
  // the grid stripe here and the inspect card read the same values from the same
  // code. These stay as thin aliases because the grid and other scenes call them.
  Scene_EnhancedItem.prototype.getUIItemRarity = function (item) {
    return window.ItemInspect.rarityOf(item);
  };

  Scene_EnhancedItem.prototype.getUIItemDescription = function (item) {
    return window.ItemInspect.descriptionOf(item);
  };

  Scene_EnhancedItem.prototype.getUIItemLore = function (item, itemType) {
    return window.ItemInspect.loreOf(item, itemType);
  };

  // =========================================================================
  // Discard modal
  // =========================================================================

  Scene_EnhancedItem.prototype.showDiscardModal = function (item) {
    if (!this._dndContainer || !item) return;
    this._discardModalOpen    = true;
    this._discardModalFocusIdx = 0;
    this._discardPendingItem  = item;
    this._discardQty          = 1;
    const el = document.createElement('div');
    el.id        = 'discard-modal';
    el.className = 'army-dialog-overlay';
    this._dndContainer.appendChild(el);
    this.renderDiscardModal();
  };

  Scene_EnhancedItem.prototype.renderDiscardModal = function () {
    const el   = document.getElementById('discard-modal');
    const item = this._discardPendingItem;
    if (!el || !item) return;
    const owned = $gameParty.numItems(item);
    const qty   = Math.max(1, Math.min(this._discardQty, owned));
    this._discardQty = qty;
    const confirmSel = this._discardModalFocusIdx === 0 ? 'selected' : '';
    const cancelSel  = this._discardModalFocusIdx === 1 ? 'selected' : '';
    el.innerHTML = `
      <div class="army-dialog">
        <h3>${T('Inventory.ui.discardItem')}</h3>
        <p>${T('Inventory.ui.discardBody', { qty: `<strong>${qty}</strong>`, item: `<strong>${item.name}</strong>`, owned: owned })}</p>
        <div class="army-dialog-buttons">
          <div class="army-dialog-btn" id="discard-qty-minus" onclick="SceneManager._scene.adjustDiscardQty(-1)">-</div>
          <div class="army-dialog-btn" id="discard-qty-plus" onclick="SceneManager._scene.adjustDiscardQty(1)">+</div>
        </div>
        <div class="army-dialog-buttons">
          <div class="army-dialog-btn ${confirmSel}" id="discard-confirm-btn" onclick="SceneManager._scene.confirmDiscard()">${T('Inventory.ui.discard')}</div>
          <div class="army-dialog-btn ${cancelSel}" id="discard-cancel-btn" onclick="SceneManager._scene.cancelDiscard()">${T('Inventory.ui.cancel')}</div>
        </div>
      </div>`;
  };

  Scene_EnhancedItem.prototype.adjustDiscardQty = function (delta) {
    const item = this._discardPendingItem;
    if (!item) return;
    const owned = $gameParty.numItems(item);
    const next  = Math.max(1, Math.min(this._discardQty + delta, owned));
    if (next !== this._discardQty) { SoundManager.playCursor(); this._discardQty = next; this.renderDiscardModal(); }
  };

  Scene_EnhancedItem.prototype.confirmDiscard = function () {
    const item = this._discardPendingItem;
    if (item) {
      const owned = $gameParty.numItems(item);
      const qty   = Math.max(1, Math.min(this._discardQty, owned));
      SoundManager.playCancel();
      $gameParty.loseItem(item, qty);
      if ($gameParty.numItems(item) <= 0) { this._dndActiveSection = 'items'; this._dndSelectedIndex = 0; }
    }
    this.closeDiscardModal();
  };

  Scene_EnhancedItem.prototype.cancelDiscard = function () {
    SoundManager.playCancel();
    this.closeDiscardModal();
  };

  Scene_EnhancedItem.prototype.closeDiscardModal = function () {
    this._discardModalOpen   = false;
    this._discardPendingItem = null;
    const modal = document.getElementById('discard-modal');
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    this.refreshUIbackpack();
  };

  // =========================================================================
  // Targeting
  // =========================================================================

  Scene_EnhancedItem.prototype.cancelUITargeting = function () {
    this._dndTargetingMode  = false;
    this._dndTargetingItem  = null;
    this._dndActiveSection  = 'actions';
    this.refreshUIbackpack();
  };

  Scene_EnhancedItem.prototype.applyUITarget = function (targetIdx) {
    const item = this._dndTargetingItem;
    if (!item) return;
    const partySize = $gameParty.members().length;
    if (targetIdx === partySize) {
      // useItemOnAllParty plays the item sound itself; don't double it.
      this.useItemOnAllParty(item);
    } else {
      const actor = $gameParty.members()[targetIdx];
      if (actor) {
        if (DataManager.isItem(item)) {
          if (this.isItemTargetRequired(item)) {
            if (actor.canUse && !actor.canUse(item)) { SoundManager.playBuzzer(); return; }
            // useItemOnActor plays the item sound itself.
            this.useItemOnActor(actor, item);
          } else {
            // useItemWithoutTarget plays the item sound itself.
            this.useItemWithoutTarget(item);
          }
        } else {
          SoundManager.playEquip();
          this.equipItemToActor(item, actor);
        }
      }
    }
    const count = $gameParty.numItems(item);
    if (count <= 0) {
      this._dndTargetingMode = false; this._dndTargetingItem = null;
      this._dndActiveSection = 'items'; this._dndSelectedIndex = 0;
    } else {
      this._dndTargetingMode = false; this._dndTargetingItem = null;
      this._dndActiveSection = 'actions';
    }
    this.refreshUIbackpack();
  };

  // =========================================================================
  // Actions
  // =========================================================================

  Scene_EnhancedItem.prototype.triggerUIItemAction = function (action) {
    const item = this._dndSelectedItem;
    if (!item) return;
    if (action === 'use') {
      const specialCommands = this.parseSpecialCommands(item);
      if (this.isItemTargetRequired(item) || specialCommands.length > 0) {
        SoundManager.playOk();
        this._dndTargetingMode = true; this._dndTargetingItem = item;
        this._dndActiveSection = 'targets'; this._selectedTargetIndex = 0;
        this.refreshUIbackpack();
      } else {
        // useItemWithoutTarget plays the item sound itself; don't double it.
        this.useItemWithoutTarget(item);
        const count = $gameParty.numItems(item);
        if (count <= 0) { this._dndActiveSection = 'items'; this._dndSelectedIndex = 0; }
        this.refreshUIbackpack();
      }
    } else if (action === 'equip') {
      const compatibleActors = this.findCompatibleActors(item);
      if (compatibleActors.length === 0) {
        SoundManager.playBuzzer();
      } else if (compatibleActors.length === 1) {
        SoundManager.playEquip();
        this.equipItemToActor(item, compatibleActors[0]);
        this.refreshUIbackpack();
      } else {
        SoundManager.playOk();
        this._dndTargetingMode = true; this._dndTargetingItem = item;
        this._dndActiveSection = 'targets'; this._selectedTargetIndex = 0;
        this.refreshUIbackpack();
      }
    } else if (action === 'throw') {
      this.throwUIItem(item);
    } else if (action === 'discard') {
      this.showDiscardModal(item);
    }
  };

  // =========================================================================
  // Throw, hands the item off to ThrowItemPlugin's map targeting flow
  // =========================================================================

  Scene_EnhancedItem.prototype.throwUIItem = function (item) {
    if (!item) return;
    if (!(window.Game_Map && Game_Map.prototype.isThrowBlocked)) { SoundManager.playBuzzer(); return; }
    if ($gameParty.numItems(item) <= 0) { SoundManager.playBuzzer(); return; }

    let itemType = 'item';
    if (DataManager.isWeapon(item))     itemType = 'weapon';
    else if (DataManager.isArmor(item)) itemType = 'armor';

    // Scene_Map.start (ThrowItemPlugin) reads this and opens map targeting.
    $gameSystem._pendingThrowItem = {
      itemType:  itemType,
      itemId:    item.id,
      iconIndex: item.iconIndex
    };

    SoundManager.playOk();
    this.popScene();
    SceneManager.goto(Scene_Map);
  };

  // Favourites live on the hotbar (ItemSystemHotbar.js); the star is just the
  // shorthand for "first free slot".
  Scene_EnhancedItem.prototype.isItemFavorited = function (item) {
    return !!window.ItemHotbar && window.ItemHotbar.isFavorited(item);
  };

  Scene_EnhancedItem.prototype.canFavoriteItem = function (item) {
    return !!window.ItemHotbar && window.ItemHotbar.isFavoritable(item);
  };

  Scene_EnhancedItem.prototype.toggleFavoriteStatus = function (item) {
    if (!window.ItemHotbar || !window.ItemHotbar.toggle(item)) {
      SoundManager.playBuzzer();
      return;
    }
    SoundManager.playOk();
    this.refreshUIbackpack();
  };

  Scene_EnhancedItem.prototype.triggerUISpecialAction = function (specialName) {
    const item = this._dndTargetingItem || this._dndSelectedItem;
    if (!item) return;
    // SPECIAL_COMMANDS is defined in ItemSystemInventory.js; access via closure
    if (window._InventorySpecialCommands) {
      const cfg = window._InventorySpecialCommands[specialName];
      if (cfg && cfg.commonEventId) {
        SoundManager.playOk();
        $gameTemp._specialActionItemId = item.id;
        // Books quote themselves; everything else runs the verb's common event.
        const quoted = specialName === "Read" && // i18n-ignore: verb id window._InventoryQueueBookExcerpt &&
                       window._InventoryQueueBookExcerpt(item);
        if (!quoted) {
          $gameTemp.reserveCommonEvent(cfg.commonEventId);
        }
        this.popScene();
        SceneManager.goto(Scene_Map);
        return;
      }
    }
    SoundManager.playBuzzer();
  };

  // =========================================================================
  // Category / sort / search helpers
  // =========================================================================

  Scene_EnhancedItem.prototype.setUICategory = function (cat) {
    SoundManager.playCursor();
    const cats = this.uiCategories();
    // A tab that is no longer on the row (the last of that category was used,
    // dropped or sold while the page was open) drops back to All rather than
    // leaving the pockets looking empty with no way out of the filter.
    this._activeUICategory    = cats.includes(cat) ? cat : cats[0];
    this._activeCategoryIndex = Math.max(0, cats.indexOf(this._activeUICategory));
    this._dndSelectedIndex    = 0;
    this.refreshUIbackpack();
  };

  Scene_EnhancedItem.prototype.toggleUISort = function (key) {
    SoundManager.playOk();
    if (this._dndSortKey === key) {
      this._dndSortDirection = this._dndSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._dndSortKey       = key;
      this._dndSortDirection = 'asc';
    }
    this._dndSelectedIndex = 0;
    this.refreshUIbackpack();
  };

  Scene_EnhancedItem.prototype.selectUIItem = function (idx) {
    if (this._dndSelectedIndex === idx && this._dndActiveSection === 'items') {
      if (this._dndSelectedItem && this._dndActionsList.length > 0) {
        SoundManager.playOk();
        this._dndActiveSection    = 'actions';
        this._selectedActionIndex = 0;
        this.refreshUIbackpack();
        return;
      }
    }
    SoundManager.playCursor();
    this._dndActiveSection = 'items';
    this._dndSelectedIndex = idx;
    this.refreshUIbackpack();
  };

  Scene_EnhancedItem.prototype.onSearchInput = function (text) {
    this._searchText       = text;
    this._dndSelectedIndex = 0;
    this.refreshUIbackpack();
  };

  Scene_EnhancedItem.prototype.clearSearch = function () {
    this._searchText       = '';
    const input = document.getElementById('backpack-search-input');
    if (input) input.value = '';
    this._dndSelectedIndex = 0;
    this.refreshUIbackpack();
  };

  // =========================================================================
  // UIbackpackInputManager
  // =========================================================================

  const UIbackpackInputManager = {
    _scene:  null,
    _active: false,

    activate(scene)  { this._scene = scene; this._active = true; },
    deactivate()     { this._active = false; this._scene = null; },

    update() {
      if (!this._active || !this._scene) return;
      const scene = this._scene;

      // Search bar has focus, pass all keys to browser
      const searchInput = document.getElementById('backpack-search-input');
      if (searchInput && document.activeElement === searchInput) return;

      // WASD hold-repeat simulation (matches MZ arrow-key timing)
      for (const dir of ['up', 'down', 'left', 'right']) {
        if (scene._wasdHeld && scene._wasdHeld[dir]) {
          scene._wasdHoldFrames[dir]++;
          const t = scene._wasdHoldFrames[dir];
          if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
            scene._wasdInput[dir] = true;
          }
        } else if (scene._wasdHoldFrames) {
          scene._wasdHoldFrames[dir] = 0;
        }
      }

      const isDown  = Input.isRepeated('down')  || (scene._wasdInput && scene._wasdInput.down);
      const isUp    = Input.isRepeated('up')    || (scene._wasdInput && scene._wasdInput.up);
      const isLeft  = Input.isRepeated('left')  || (scene._wasdInput && scene._wasdInput.left);
      const isRight = Input.isRepeated('right') || (scene._wasdInput && scene._wasdInput.right);

      // Consume WASD flags
      if (scene._wasdInput) {
        scene._wasdInput.up = scene._wasdInput.down = scene._wasdInput.left = scene._wasdInput.right = false;
      }

      // L1 / R1, cycle tabs from anywhere (use isTriggered: no repeat)
      if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
        const tabs = scene.uiCategories();
        const dir  = Input.isTriggered('pageup') ? -1 : 1;
        const cur  = tabs.indexOf(scene._activeUICategory);
        const next = (cur + dir + tabs.length) % tabs.length;
        SoundManager.playCursor();
        scene._activeUICategory    = tabs[next];
        scene._activeCategoryIndex = next;
        scene._dndSelectedIndex    = 0;
        scene._dndActiveSection    = 'items';
        scene.refreshUIbackpack();
        return;
      }

      // Discard modal takes full input priority
      if (scene._discardModalOpen) {
        if (Input.isTriggered('left')) {
          scene.adjustDiscardQty(-1);
        } else if (Input.isTriggered('right')) {
          scene.adjustDiscardQty(1);
        } else if (Input.isTriggered('up') || Input.isTriggered('down')) {
          SoundManager.playCursor();
          scene._discardModalFocusIdx = 1 - scene._discardModalFocusIdx;
          scene.renderDiscardModal();
        } else if (Input.isTriggered('ok')) {
          if (scene._discardModalFocusIdx === 0) scene.confirmDiscard();
          else scene.cancelDiscard();
        } else if (Input.isTriggered('escape') || Input.isTriggered('cancel')) {
          scene.cancelDiscard();
        }
        return;
      }

      // 1-9 drops the inspected item straight into that quick slot, the same
      // assignment a click on the slot makes. Not while the target picker is
      // up: there the question on the page is who, not which slot.
      if (!scene._dndTargetingMode) {
        for (let n = 1; n <= 9; n++) {
          if (Input.isTriggered(String(n))) { this.handleSlotAssign(n - 1); return; }
        }
      }

      if      (isDown)  this.handleMove('down');
      else if (isUp)    this.handleMove('up');
      else if (isLeft)  this.handleMove('left');
      else if (isRight) this.handleMove('right');
      else if (Input.isTriggered('ok'))                                                      this.handleOk();
      else if (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled()) this.handleCancel();
    },

    // Assign the inspected item to a quick slot by its number. Pressing the
    // number of the slot the item already sits in takes it back off the bar,
    // exactly as clicking that slot does (ItemSystemHotbar.js).
    handleSlotAssign(slot) {
      const scene = this._scene;
      const item  = scene._dndSelectedItem;
      if (!window.ItemHotbar || !window.ItemHotbar.isFavoritable(item)) {
        SoundManager.playBuzzer();
        return;
      }
      if (window.ItemHotbar.slotOf(item) === slot) window.ItemHotbar.clear(slot);
      else window.ItemHotbar.assign(slot, item);
      SoundManager.playOk();
      scene.refreshUIbackpack();
    },

    handleMove(dir) {
      const scene   = this._scene;
      const section = scene._dndActiveSection;

      if (section === 'categories') {
        const cats  = scene.uiCategories();
        const count = cats.length;
        if (dir === 'left') {
          SoundManager.playCursor();
          scene._activeCategoryIndex  = (scene._activeCategoryIndex - 1 + count) % count;
          scene._activeUICategory     = cats[scene._activeCategoryIndex];
          scene._dndSelectedIndex     = 0;
          scene.refreshUIbackpack();
        } else if (dir === 'right') {
          SoundManager.playCursor();
          scene._activeCategoryIndex  = (scene._activeCategoryIndex + 1) % count;
          scene._activeUICategory     = cats[scene._activeCategoryIndex];
          scene._dndSelectedIndex     = 0;
          scene.refreshUIbackpack();
        } else if (dir === 'down') {
          if (scene.getFilteredUIItems().length > 0) {
            SoundManager.playCursor();
            scene._dndActiveSection = 'items';
            scene._dndSelectedIndex = 0;
            scene.refreshUIbackpack();
          }
        }
        // up in categories: already at top, do nothing

      } else if (section === 'items') {
        const COLS  = 2;
        const items = scene.getFilteredUIItems();
        const total = items.length;
        const idx   = scene._dndSelectedIndex;

        const scrollToSelected = () => {
          const container = document.getElementById('menu-container');
          if (container) {
            const focused = container.querySelector('.item-slot.selected');
            if (focused) focused.scrollIntoView({ block: 'nearest' });
          }
        };

        if (dir === 'up') {
          if (idx - COLS >= 0) {
            SoundManager.playCursor();
            scene._dndSelectedIndex = idx - COLS;
            scene.refreshUIbackpack();
            scrollToSelected();
          } else {
            SoundManager.playCursor();
            scene._dndActiveSection = 'categories';
            scene.refreshUIbackpack();
          }
        } else if (dir === 'down') {
          if (idx + COLS < total) {
            SoundManager.playCursor();
            scene._dndSelectedIndex = idx + COLS;
            scene.refreshUIbackpack();
            scrollToSelected();
          }
          // bottom row: stay put
        } else if (dir === 'left') {
          if (idx % COLS !== 0) {
            // not at left column: move left within row
            SoundManager.playCursor();
            scene._dndSelectedIndex = idx - 1;
            scene.refreshUIbackpack();
          } else {
            // left column boundary: back to categories
            SoundManager.playCursor();
            scene._dndActiveSection = 'categories';
            scene.refreshUIbackpack();
          }
        } else if (dir === 'right') {
          if (idx % COLS !== COLS - 1 && idx + 1 < total) {
            // not at right column and next item exists: move right within row
            SoundManager.playCursor();
            scene._dndSelectedIndex = idx + 1;
            scene.refreshUIbackpack();
          } else if (scene._dndSelectedItem && scene._dndActionsList.length > 0) {
            // at right column or last item: open actions panel
            SoundManager.playCursor();
            scene._dndActiveSection    = 'actions';
            scene._selectedActionIndex = 0;
            scene.refreshUIbackpack();
          }
        }

      } else if (section === 'actions') {
        // The action buttons sit on a single row, so left/right walks them and
        // stepping off the left edge (or pressing up) returns to the pockets.
        const count = scene._dndActionsList.length;
        if (dir === 'right' && scene._selectedActionIndex < count - 1) {
          SoundManager.playCursor(); scene._selectedActionIndex++; scene.refreshUIbackpack();
        } else if (dir === 'left' && scene._selectedActionIndex > 0) {
          SoundManager.playCursor(); scene._selectedActionIndex--; scene.refreshUIbackpack();
        } else if (dir === 'left' || dir === 'up') {
          SoundManager.playCursor(); scene._dndActiveSection = 'items'; scene.refreshUIbackpack();
        }

      } else if (section === 'targets') {
        const item         = scene._dndTargetingItem;
        const partySize    = $gameParty.members().length;
        const specCmds     = scene.parseSpecialCommands(item);
        const hasAllParty  = (item.scope === 8 || item.scope === 10);
        const totalTargets = partySize + (hasAllParty ? 1 : 0) + specCmds.length;

        if (dir === 'up' && scene._selectedTargetIndex > 0) {
          SoundManager.playCursor(); scene._selectedTargetIndex--; scene.refreshUIbackpack();
        } else if (dir === 'down' && scene._selectedTargetIndex < totalTargets - 1) {
          SoundManager.playCursor(); scene._selectedTargetIndex++; scene.refreshUIbackpack();
        }
      }
    },

    handleOk() {
      const scene   = this._scene;
      const section = scene._dndActiveSection;

      if (section === 'categories') {
        SoundManager.playOk();
        scene._dndActiveSection = 'items'; scene._dndSelectedIndex = 0;
        scene.refreshUIbackpack();
      } else if (section === 'items') {
        if (scene._dndSelectedItem && scene._dndActionsList.length > 0) {
          SoundManager.playOk();
          scene._dndActiveSection    = 'actions';
          scene._selectedActionIndex = 0;
          scene.refreshUIbackpack();
        }
      } else if (section === 'actions') {
        const action = scene._dndActionsList[scene._selectedActionIndex];
        if (action) scene.triggerUIItemAction(action);
      } else if (section === 'targets') {
        const item          = scene._dndTargetingItem;
        const partySize     = $gameParty.members().length;
        const hasAllParty   = (item.scope === 8 || item.scope === 10);
        const specialStart  = partySize + (hasAllParty ? 1 : 0);
        if (scene._selectedTargetIndex < specialStart) {
          scene.applyUITarget(scene._selectedTargetIndex);
        } else {
          const specCmds = scene.parseSpecialCommands(item);
          const specIdx  = scene._selectedTargetIndex - specialStart;
          if (specIdx >= 0 && specIdx < specCmds.length) scene.triggerUISpecialAction(specCmds[specIdx]);
        }
      }
    },

    handleCancel() {
      const scene   = this._scene;
      const section = scene._dndActiveSection;

      if (scene._searchText) {
        SoundManager.playCancel(); scene.clearSearch(); return;
      }
      if (section === 'targets') {
        SoundManager.playCancel(); scene.cancelUITargeting();
      } else if (section === 'actions') {
        SoundManager.playCancel(); scene._dndActiveSection = 'items'; scene.refreshUIbackpack();
      } else {
        SoundManager.playCancel(); scene.popScene();
      }
    }
  };

})();
