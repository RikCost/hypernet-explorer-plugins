/*:
 * @target MZ
 * @plugindesc Blade Seed System UI, book-spread HTML overlay
 * @author OmniLex
 * @requires BladeSeedSystem.js
 *
 * @help
 * Provides the HTML book-spread scenes for BladeSeedSystem.js.
 * Must be placed AFTER BladeSeedSystem.js in the plugin list.
 *
 * Scene_BladeSeedBind:  weapon selection → preview → confirm binding
 * Scene_BladeSeedStatus: spirit info / stats / skill learning
 *
 * Navigation: ↑↓ / WASD; L1/R1 cycle right-page tabs; OK / Esc confirm/cancel.
 */

(() => {
  'use strict';

  if (!window.BladeSeed) throw new Error('BladeSeedSystemUI.js requires BladeSeedSystem.js!');

  const BD = window.BladeSeed;

  // Element accent colours (CSS var references)
  const _EL_CLR = {
    1: 'var(--text-text-alt-8)',
    2: 'var(--text-text-alt-15)',
    3: 'var(--text-text-alt-16)',
    4: 'var(--text-text-alt-14-hover)',
    5: 'var(--text-text-alt-3)',
    6: 'var(--text-text-alt-4)',
    7: 'var(--text-text-alt-22)',
    8: 'var(--text-text-alt-17)',
    9: 'var(--text-text-alt-19)',
  };

  // ── WASD helper ───────────────────────────────────────────────────────────
  function makeWasd(scene) {
    const s = {
      pending: { up: false, down: false },
      held:    { up: false, down: false },
      frames:  { up: 0,     down: 0 },
      onDown: (e) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k === 'w') { s.pending.up   = true; s.held.up   = true; e.preventDefault(); }
        if (k === 's') { s.pending.down  = true; s.held.down  = true; e.preventDefault(); }
      },
      onUp: (e) => {
        const k = e.key.toLowerCase();
        if (k === 'w') { s.held.up   = false; s.frames.up   = 0; }
        if (k === 's') { s.held.down  = false; s.frames.down  = 0; }
      },
      tick() {
        for (const d of ['up', 'down']) {
          if (s.held[d]) {
            s.frames[d]++;
            const t = s.frames[d];
            if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
              s.pending[d] = true;
            }
          } else {
            s.frames[d] = 0;
          }
        }
        const up   = Input.isRepeated('up')   || s.pending.up;
        const down = Input.isRepeated('down') || s.pending.down;
        s.pending.up = s.pending.down = false;
        return { up, down };
      },
      attach() {
        window.addEventListener('keydown', s.onDown);
        window.addEventListener('keyup',   s.onUp);
      },
      detach() {
        window.removeEventListener('keydown', s.onDown);
        window.removeEventListener('keyup',   s.onUp);
      },
    };
    return s;
  }

  // ── Spirit image draw helper ──────────────────────────────────────────────
  function drawSpiritImage(cv, spirit) {
    if (!cv || !spirit) return;
    const img = spirit.getCurrentImage ? spirit.getCurrentImage() : null;
    if (!img) return;
    try {
      const bmp = BD.loadBladeSeedImage(img);
      const draw = () => {
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const sw = Math.min(bmp.width, 64), sh = Math.min(bmp.height, 64);
        const src = bmp._canvas || bmp._image;
        if (src) ctx.drawImage(src, 0, 0, sw, sh, 0, 0, cv.width, cv.height);
      };
      bmp.isReady() ? draw() : bmp.addLoadListener(draw);
    } catch (_) {}
  }

  // ── Overlay teardown helper ───────────────────────────────────────────────
  function fadeRemove(el) {
    if (!el) return;
    el.style.transition    = 'opacity 0.18s ease-out';
    el.style.opacity       = '0';
    el.style.pointerEvents = 'none';
    setTimeout(() => el.parentNode?.removeChild(el), 200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scene_BladeSeedBind, weapon selection → preview → bind
  // ═══════════════════════════════════════════════════════════════════════════
  class Scene_BladeSeedBind extends Scene_MenuBase {
    create() {
      super.create();
      this._phase   = 'weaponSelect';
      this._weapons = BD.getCompatibleWeaponTypes($gameActors.actor(1));
      this._selIdx  = 0;
      this._spirit  = null;
      this._wt      = null;
      this._wName   = '';
      this._wasd    = makeWasd(this);

      this._wasd.attach();

      this._el = document.createElement('div');
      this._el.id = 'blade-bind-container';
      this._el.style.cssText = 'opacity:0;transition:opacity 0.2s ease-out;';
      document.body.appendChild(this._el);

      this._render();
      requestAnimationFrame(() => { if (this._el) this._el.style.opacity = '1'; });
    }

    update() {
      Scene_MenuBase.prototype.update.call(this);
      const { up, down } = this._wasd.tick();

      if (this._phase === 'weaponSelect') {
        if (up   && this._selIdx > 0)                     { this._selIdx--; SoundManager.playCursor(); this._updateSel(); }
        if (down && this._selIdx < this._weapons.length-1){ this._selIdx++; SoundManager.playCursor(); this._updateSel(); }
        if (Input.isTriggered('ok'))                        this._onWeaponOk();
        if (Input.isTriggered('cancel') || Input.isTriggered('escape')) this._onCancel();
      } else {
        if (Input.isTriggered('ok'))                        this._onConfirm();
        if (Input.isTriggered('cancel') || Input.isTriggered('escape')) this._onBack();
      }
    }

    terminate() {
      this._wasd.detach();
      const el = this._el; this._el = null;
      fadeRemove(el);
      Scene_MenuBase.prototype.terminate.call(this);
    }

    _onWeaponOk() {
      const wt = this._weapons[this._selIdx];
      if (!wt) return;
      this._wt     = wt;
      this._spirit = new BD.SpiritCompanion();
      this._spirit.addWeaponSkill(wt);
      this._wName  = BD.generateWeaponName(this._spirit.element, wt);
      this._phase  = 'preview';
      SoundManager.playOk();
      this._render();
    }

    _onReshuffle() {
      if (this._phase !== 'preview') return;
      this._spirit = new BD.SpiritCompanion();
      this._spirit.addWeaponSkill(this._wt);
      this._wName  = BD.generateWeaponName(this._spirit.element, this._wt);
      SoundManager.playCursor();
      this._render();
    }

    _onConfirm() {
      if (this._phase !== 'preview') return;
      const wid  = parseInt(this._wt.weaponId);
      const sp   = this._spirit;
      $gameSystem._bladeSeed = {
        bound: true, weaponName: this._wName, weaponId: wid,
        weaponTypeId: $dataWeapons[wid].wtypeId, spirit: sp,
        level: 1, experience: 0, learningPoints: 0,
        originalWeaponName: $dataWeapons[wid].name,
      };
      $gameSystem._bladeSeedWeaponData = Object.assign(
        JSON.parse(JSON.stringify($dataWeapons[wid])), { name: this._wName });
      $gameParty.gainItem($dataWeapons[wid], 1);
      const actor = $gameActors.actor(1);
      actor.changeEquip(0, $dataWeapons[wid]);
      actor._sealedSlots = actor._sealedSlots || {};
      actor._sealedSlots[0] = true;
      actor._bladeSeedBonus = {
        0: sp.currentStats.mhp, 1: sp.currentStats.mmp, 2: sp.currentStats.atk,
        3: sp.currentStats.def, 4: sp.currentStats.mat, 5: sp.currentStats.mdf,
        6: sp.currentStats.agi, 7: sp.currentStats.luk,
      };
      sp.getLearnedSkills().forEach(sk => {
        if (!actor.hasSkill(sk.skillId)) actor.learnSkill(sk.skillId);
      });
      SoundManager.playEquip();
      $gameMessage.add(T('BladeSeed.bound', { weapon: this._wName }));
      $gameMessage.add(T('BladeSeed.spiritElement', { element: BD.elementNames[sp.element] }));
      SceneManager.pop();
    }

    _onBack() {
      if (this._phase === 'preview') {
        this._phase = 'weaponSelect'; SoundManager.playCancel(); this._render();
      } else {
        this._onCancel();
      }
    }

    _onCancel() { SoundManager.playCancel(); SceneManager.pop(); }

    // ── DOM ──────────────────────────────────────────────────────────────────

    _render() {
      if (!this._el) return;

      if (this._phase === 'weaponSelect') {
        this._el.innerHTML = `
          <div class="book-spread">
            <div class="left-page">
              <div class="page-header-bar">
                <button class="back-button">← ${T('BladeSeed.cancel')}</button>
                <h2 class="title">${T('BladeSeed.forgeTitle')}</h2>
              </div>
              <div class="bs-warning">${T('BladeSeed.irreversible')}</div>
              <div class="bs-weapon-list">
                ${this._weapons.map((wt, i) => {
                  const sel  = i === this._selIdx ? ' selected' : '';
                  const wd   = $dataWeapons[parseInt(wt.weaponId)];
                  const skill = wt.startingSkill ? $dataSkills[wt.startingSkill] : null;
                  return `<div class="item-slot${sel}" data-idx="${i}">
                    <div class="item-slot-info">
                      <span class="item-slot-name">${wt.name}</span>
                      <span class="item-slot-meta">
                        ${wd ? `<span class="item-slot-count">ATK +${wd.params[2]}</span>` : ''}
                        ${skill ? `<span class="bs-skill-hint">${skill.name}</span>` : ''}
                      </span>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>
            <div class="right-page">
              <div class="item-inspect--empty">
                <div class="inspect-placeholder-icon"></div>
                <p class="inspect-placeholder-text">${T('BladeSeed.ui.selectWeaponType')}</p>
              </div>
            </div>
          </div>`;

        this._el.querySelector('.back-button')
          ?.addEventListener('mousedown', () => this._onCancel());
        this._el.querySelectorAll('.item-slot').forEach((el, i) => {
          el.addEventListener('mouseenter', () => {
            if (this._selIdx !== i) { this._selIdx = i; SoundManager.playCursor(); this._updateSel(); }
          });
          el.addEventListener('mousedown', () => this._onWeaponOk());
        });

      } else {
        const sp      = this._spirit;
        const elClr   = _EL_CLR[sp.element] || 'var(--text-primary-hover)';
        const learned = sp.getLearnedSkills();
        const st      = sp.currentStats;

        this._el.innerHTML = `
          <div class="book-spread">
            <div class="left-page">
              <div class="page-header-bar">
                <button class="back-button" id="bsb-back">← ${T('BladeSeed.back')}</button>
                <h2 class="title bs-weapon-title">${this._wName}</h2>
                <span class="bs-el-badge" style="color:${elClr}">${BD.elementNames[sp.element]}</span>
              </div>
              <div class="inspect-section-title">${T('BladeSeed.weapon')}</div>
              <div class="inspect-spec-row">
                <span class="inspect-spec-label">${T('BladeSeed.type')}</span>
                <span class="inspect-spec-value">${this._wt.name}</span>
              </div>
              <div class="inspect-spec-row">
                <span class="inspect-spec-label">${T('BladeSeed.element')}</span>
                <span class="inspect-spec-value" style="color:${elClr}">${BD.elementNames[sp.element]}</span>
              </div>
              <div class="inspect-spec-row">
                <span class="inspect-spec-label">${T('BladeSeed.spirit')}</span>
                <span class="inspect-spec-value">${sp.name}</span>
              </div>
              <div class="inspect-section-title">${T('BladeSeed.initialSkills')}</div>
              ${learned.map(s => `<div class="inspect-spec-row">
                <span class="inspect-spec-label">${s.name}</span>
                <span class="inspect-spec-value bs-src-label">${s.source === 'weapon' ? T('BladeSeed.weapon') : T('BladeSeed.spirit')}</span>
              </div>`).join('')}
            </div>
            <div class="right-page">
              <div class="inspect-header">
                <div class="inspect-frame">
                  <canvas id="bsb-spirit-img" width="64" height="64"></canvas>
                </div>
                <div class="inspect-title-box">
                  <div class="inspect-name">${sp.name}</div>
                  <div class="inspect-rarity">${T('BladeSeed.elementSpirit', { element: BD.elementNames[sp.element] })}</div>
                </div>
              </div>
              <div class="inspect-lore">
                <div class="inspect-section-title">${T('BladeSeed.spiritStats')}</div>
                <div class="bs-stat-grid">
                  ${[['HP',st.mhp],['MP',st.mmp],['ATK',st.atk],['DEF',st.def],
                     ['MAT',st.mat],['MDF',st.mdf],['AGI',st.agi],['LUK',st.luk]]
                    .map(([n,v]) => `<div class="bs-stat-cell">
                      <span class="bs-stat-label">${n}</span>
                      <span class="bs-stat-value">+${v}</span>
                    </div>`).join('')}
                </div>
              </div>
              <div class="bs-actions">
                <button class="bs-btn bs-btn-confirm" id="bsb-confirm">${T('BladeSeed.bind')}</button>
                <button class="bs-btn bs-btn-reshuffle" id="bsb-reshuffle">↺ ${T('BladeSeed.reshuffle')}</button>
                <button class="bs-btn bs-btn-cancel" id="bsb-cancel">✕ ${T('BladeSeed.cancel')}</button>
              </div>
            </div>
          </div>`;

        drawSpiritImage(this._el.querySelector('#bsb-spirit-img'), sp);
        this._el.querySelector('#bsb-back')?.addEventListener('mousedown', () => this._onBack());
        this._el.querySelector('#bsb-confirm')?.addEventListener('mousedown', () => this._onConfirm());
        this._el.querySelector('#bsb-reshuffle')?.addEventListener('mousedown', () => this._onReshuffle());
        this._el.querySelector('#bsb-cancel')?.addEventListener('mousedown', () => this._onCancel());
      }
    }

    _updateSel() {
      if (!this._el) return;
      this._el.querySelectorAll('.item-slot').forEach((el, i) =>
        el.classList.toggle('selected', i === this._selIdx));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scene_BladeSeedStatus, spirit info, stats, skill management
  // ═══════════════════════════════════════════════════════════════════════════
  class Scene_BladeSeedStatus extends Scene_MenuBase {
    create() {
      super.create();
      this._rightTab  = 'stats';  // 'stats' | 'skills'
      this._skillMode = 'learn';  // 'learn' | 'learned'
      this._selIdx    = 0;
      this._wasd      = makeWasd(this);
      this._wasd.attach();

      this._el = document.createElement('div');
      this._el.id = 'blade-status-container';
      this._el.style.cssText = 'opacity:0;transition:opacity 0.2s ease-out;';
      document.body.appendChild(this._el);

      this._render();
      requestAnimationFrame(() => { if (this._el) this._el.style.opacity = '1'; });
    }

    update() {
      Scene_MenuBase.prototype.update.call(this);
      const { up, down } = this._wasd.tick();

      // L1 / R1, cycle right-page tabs
      if (Input.isTriggered('pageup') || Input.isTriggered('pagedown')) {
        const tabs = ['stats', 'skills'];
        const cur  = tabs.indexOf(this._rightTab);
        this._rightTab = tabs[(cur + (Input.isTriggered('pageup') ? -1 : 1) + tabs.length) % tabs.length];
        this._selIdx   = 0;
        SoundManager.playCursor();
        this._render();
        return;
      }

      if (this._rightTab === 'skills') {
        const list = this._skillList();
        if (up   && this._selIdx > 0)           { this._selIdx--; SoundManager.playCursor(); this._updateSkillSel(); }
        if (down && this._selIdx < list.length-1){ this._selIdx++; SoundManager.playCursor(); this._updateSkillSel(); }
        if (Input.isTriggered('ok') && this._skillMode === 'learn') this._learnSkill();
      }

      if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
        SoundManager.playCancel(); SceneManager.pop();
      }
    }

    terminate() {
      this._wasd.detach();
      const el = this._el; this._el = null;
      fadeRemove(el);
      Scene_MenuBase.prototype.terminate.call(this);
    }

    _skillList() {
      const sp = $gameSystem._bladeSeed?.spirit;
      if (!sp) return [];
      return this._skillMode === 'learn' ? sp.getUnlearnedSkills() : sp.getLearnedSkills();
    }

    _learnSkill() {
      const list  = this._skillList();
      const skill = list[this._selIdx];
      if (!skill) return;
      const spirit = $gameSystem._bladeSeed.spirit;
      const idx    = spirit.skills.findIndex(s => s.skillId === skill.skillId);
      if (idx >= 0 && spirit.canLearnSkill(idx)) {
        spirit.learnSkill(idx);
        SoundManager.playUseSkill();
        $gameMessage.add(T('BladeSeed.learnedSkill', { skill: skill.name }));
        this._selIdx = Math.min(this._selIdx, Math.max(0, this._skillList().length - 1));
        this._render();
      } else {
        SoundManager.playBuzzer();
      }
    }

    _render() {
      if (!this._el) return;
      const data   = $gameSystem._bladeSeed;
      const spirit = data?.spirit;

      if (!data?.bound || !spirit) {
        this._el.innerHTML = `
          <div class="book-spread">
            <div class="left-page">
              <div class="page-header-bar">
                <button class="back-button">← ${T('BladeSeed.back')}</button>
                <h2 class="title">${T('BladeSeed.title')}</h2>
              </div>
              <p class="item-grid-empty">${T('BladeSeed.noneBound')}</p>
            </div>
            <div class="right-page"></div>
          </div>`;
        this._el.querySelector('.back-button')
          ?.addEventListener('mousedown', () => { SoundManager.playCancel(); SceneManager.pop(); });
        return;
      }

      const elClr   = _EL_CLR[spirit.element] || 'var(--text-primary-hover)';
      const stage   = spirit.getEvolutionStage ? spirit.getEvolutionStage() : 1;
      const expRate = Math.min(1, spirit.experience / spirit.getExpForNextLevel());
      const lp      = data.learningPoints || 0;
      const evoText = spirit.level < 10 ? T('BladeSeed.nextEvolution', { level: 10 })
                    : spirit.level < 30 ? T('BladeSeed.nextEvolution', { level: 30 })
                    : T('BladeSeed.fullyEvolved');

      // Right-page tab header
      const rightTabBar = ['stats', 'skills'].map(t => {
        const label  = t === 'stats' ? T('BladeSeed.tabStats') : T('BladeSeed.tabSkills');
        const active = this._rightTab === t ? ' active' : '';
        return `<div class="backpack-tab${active}" data-tab="${t}">${label}</div>`;
      }).join('');

      // Right content
      let rightContent = '';
      if (this._rightTab === 'stats') {
        const s = spirit.currentStats;
        rightContent = `
          <div class="inspect-section-title">${T('BladeSeed.statBonuses')}</div>
          <div class="bs-stat-grid">
            ${[[T('BladeSeed.stat.mhp'),s.mhp],[T('BladeSeed.stat.mmp'),s.mmp],
               [T('BladeSeed.stat.atk'),s.atk],[T('BladeSeed.stat.def'),s.def],
               [T('BladeSeed.stat.mat'),s.mat],[T('BladeSeed.stat.mdf'),s.mdf],
               [T('BladeSeed.stat.agi'),s.agi],[T('BladeSeed.stat.luk'),s.luk]]
              .map(([n,v]) => `<div class="bs-stat-cell">
                <span class="bs-stat-label">${n}</span>
                <span class="bs-stat-value">+${v}</span>
              </div>`).join('')}
          </div>`;
      } else {
        const list = this._skillList();
        const subTabs = ['learn', 'learned'].map(t => {
          const label  = t === 'learn' ? T('BladeSeed.tabLearn') : T('BladeSeed.tabLearned');
          const active = this._skillMode === t ? ' active' : '';
          return `<div class="backpack-tab${active}" data-subtab="${t}">${label}</div>`;
        }).join('');

        const helpSkill = list[this._selIdx];
        const helpText  = helpSkill ? ($dataSkills[helpSkill.skillId]?.description || '') : '';

        rightContent = `
          <div class="backpack-tabs">${subTabs}</div>
          <div class="bs-skill-list">
            ${list.length ? list.map((sk, i) => {
              const sel      = i === this._selIdx ? ' selected' : '';
              const canAff   = this._skillMode === 'learn' ? lp >= sk.cost : true;
              const noCls    = canAff ? '' : ' bs-skill-no';
              return `<div class="item-slot${sel}${noCls}" data-si="${i}">
                <div class="item-slot-info">
                  <span class="item-slot-name">${sk.name}${sk.source === 'weapon' ? ` <em style="opacity:.65">${T('BladeSeed.ui.weaponTag')}</em>` : ''}</span>
                  ${this._skillMode === 'learn'
                    ? `<span class="item-slot-count ${canAff ? '' : 'bs-skill-no'}">${sk.cost} LP</span>`
                    : ''}
                </div>
              </div>`;
            }).join('')
            : `<p class="item-grid-empty">${T('BladeSeed.noSkills')}</p>`}
          </div>
          ${helpText ? `<div class="bs-skill-help">${helpText}</div>` : ''}`;
      }

      this._el.innerHTML = `
        <div class="book-spread">
          <div class="left-page">
            <div class="page-header-bar">
              <button class="back-button">← ${T('BladeSeed.back')}</button>
              <h2 class="title bs-weapon-title">${data.weaponName}</h2>
            </div>
            <div class="bs-spirit-portrait">
              <canvas id="bss-spirit-img" width="64" height="64"></canvas>
            </div>
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${T('BladeSeed.spirit')}</span>
              <span class="inspect-spec-value">${spirit.name}</span>
            </div>
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${T('BladeSeed.element')}</span>
              <span class="inspect-spec-value" style="color:${elClr}">${BD.elementNames[spirit.element]}</span>
            </div>
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${T('BladeSeed.level')}</span>
              <span class="inspect-spec-value">${T('BladeSeed.levelStage', { level: spirit.level, stage: stage })}</span>
            </div>
            <div class="inspect-spec-row">
              <span class="inspect-spec-label">${T('BladeSeed.learningPoints')}</span>
              <span class="inspect-spec-value bs-lp-val">${T('BladeSeed.lp', { points: lp })}</span>
            </div>
            <div class="bs-exp-bar-wrap">
              <div class="bs-exp-bar" style="width:${Math.round(expRate * 100)}%"></div>
            </div>
            <div class="bs-exp-text">${T('BladeSeed.expLine', { exp: spirit.experience, next: spirit.getExpForNextLevel() })}</div>
            <div class="bs-evo-text">${evoText}</div>
          </div>
          <div class="right-page">
            <div class="backpack-tabs">${rightTabBar}</div>
            <div class="bs-right-content">${rightContent}</div>
          </div>
        </div>`;

      drawSpiritImage(this._el.querySelector('#bss-spirit-img'), spirit);

      this._el.querySelector('.back-button')
        ?.addEventListener('mousedown', () => { SoundManager.playCancel(); SceneManager.pop(); });

      this._el.querySelectorAll('[data-tab]').forEach(el =>
        el.addEventListener('mousedown', () => {
          const t = el.dataset.tab;
          if (t !== this._rightTab) { this._rightTab = t; this._selIdx = 0; SoundManager.playCursor(); this._render(); }
        }));

      this._el.querySelectorAll('[data-subtab]').forEach(el =>
        el.addEventListener('mousedown', () => {
          const t = el.dataset.subtab;
          if (t !== this._skillMode) { this._skillMode = t; this._selIdx = 0; SoundManager.playCursor(); this._render(); }
        }));

      this._el.querySelectorAll('[data-si]').forEach((el, i) => {
        el.addEventListener('mouseenter', () => {
          if (this._selIdx !== i) { this._selIdx = i; SoundManager.playCursor(); this._updateSkillSel(); }
        });
        el.addEventListener('mousedown', () => { if (this._skillMode === 'learn') this._learnSkill(); });
      });
    }

    _updateSkillSel() {
      if (!this._el) return;
      this._el.querySelectorAll('[data-si]').forEach((el, i) =>
        el.classList.toggle('selected', i === this._selIdx));
      const list     = this._skillList();
      const skill    = list[this._selIdx];
      const helpEl   = this._el.querySelector('.bs-skill-help');
      if (helpEl && skill) helpEl.textContent = $dataSkills[skill.skillId]?.description || '';
      const sel = this._el.querySelector('[data-si].selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
  }

  window.Scene_BladeSeedBind   = Scene_BladeSeedBind;
  window.Scene_BladeSeedStatus = Scene_BladeSeedStatus;

})();
