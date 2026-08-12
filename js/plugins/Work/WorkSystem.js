/*:
 * @target MZ
 * @plugindesc v1.0.0 Work System - Select jobs, earn money, gain experience through labor
 * @author Omni-Lex
 * @base TimeDateSystem
 * @orderAfter TimeDateSystem
 *
 * @help WorkSystem.js
 * === Work System v1.0.0 ===
 *
 * Requires: TimeDateSystem.js and DataService.js
 *
 * --- Features ---
 * - Select from 30+ different jobs across multiple categories
 * - Choose which party member performs the work
 * - View stat requirements before starting
 * - Warning system for insufficient stats (but allows risky work)
 * - Screen darkens during work shift
 * - Procedural outcome messages based on performance
 * - Time passes during work (integrates with TimeDateSystem)
 * - Earn gold or lose it in disasters
 * - Take damage and suffer status effects from work accidents
 * - Success rates influenced by stats and luck
 *
 * --- Plugin Commands ---
 *
 * @command OpenWorkMenu
 * @text Open Work Menu
 * @desc Opens the work system job selection screen.
 *
 * @command OpenWorkMenuCategory
 * @text Open Work Menu (Category)
 * @desc Opens work menu filtered to a specific category.
 * @arg category
 * @type select
 * @option General
 * @option Combat
 * @option Magical
 * @option Social
 * @option Technical
 * @option Labor
 * @option Criminal
 * @option Faction
 * @default General
 * @desc The job category to display.
 *
 * @command ShowSingleJob
 * @text Show Single Job
 * @desc Shows a specific job without the job list.
 * @arg jobId
 * @type number
 * @min 1
 * @default 1
 * @desc The ID of the job to display.
 *
 * @param timeVariable
 * @text Time Variable
 * @desc Variable ID that stores game time in minutes (from TimeDateSystem).
 * @type variable
 * @default 114
 *
 * @param enableFactionJobs
 * @text Enable Faction Jobs
 * @desc Show faction-specific jobs in the work menu.
 * @type boolean
 * @default true
 *
 * @param showSuccessChance
 * @text Show Success Chance
 * @desc Display calculated success % before working.
 * @type boolean
 * @default true
 *
 * @param workFadeDuration
 * @text Work Fade Duration
 * @desc Frames for screen fade (60 = 1 second).
 * @type number
 * @default 30
 *
 * @param workDuration
 * @text Work Display Duration
 * @desc How long (in frames) the black screen lasts during work.
 * @type number
 * @default 120
 *
 * @param workSoundEffect
 * @text Work Sound Effect
 * @desc SE to play when work begins (leave blank for none).
 * @type file
 * @dir audio/se
 * @default
 */

(() => {
  'use strict';

  const pluginName = "WorkSystem";
  const parameters = PluginManager.parameters(pluginName);

  const settings = {
    timeVariable: Number(parameters.timeVariable || 114),
    enableFactionJobs: parameters.enableFactionJobs === "true",
    showSuccessChance: parameters.showSuccessChance === "true",
    workFadeDuration: Number(parameters.workFadeDuration || 30),
    workDuration: Number(parameters.workDuration || 120),
    workSoundEffect: String(parameters.workSoundEffect || "")
  };

  let _statsI18n = null;

  const _loadStatsI18n = async () => {
    const lang = ConfigManager.language || 'en';
    const url = `js/i18n/${lang}/stats.json`;
    try {
      const response = await fetch(url);
      _statsI18n = await response.json();

      // Force refresh of details panel if it exists and scene is active
      if (SceneManager._scene instanceof Scene_Work && SceneManager._scene._detailsPanel) {
        SceneManager._scene._detailsPanel.refresh();
      }
    } catch (e) {
      console.error('WorkSystem: Failed to load i18n data from ' + url, e);
    }
  };

  const _si18n = (key) => {
    if (_statsI18n && _statsI18n[key]) {
      return _statsI18n[key];
    }
    return key;
  };

  _loadStatsI18n();

  const statKeyMapping = {
    'HP': 'HP',
    'MP': 'MP',
    'ATK': 'ATT',
    'DEF': 'DEF',
    'MAT': 'M.ATT',
    'MDF': 'M.DEF',
    // i18n-ignore-start  the KEYS are stat ids from the job data
    'AGI': 'AGILITY',
    'LUK': 'LUCK',
    'Arcane': 'ARCANE',
    'Substance': 'SUBSTANCE',
    'Stealth': 'STEALTH',
    'Intimidation': 'INTIMIDATION'
  };
  // i18n-ignore-end

  window.WorkSystem = window.WorkSystem || {};
  window.WorkSystem.statKeyMapping = statKeyMapping;
  window.WorkSystem.si18n = _si18n;

  // Resolve a job status (raw name like "Nausea" from Jobs.json, or a numeric
  // state id) to a state id. The name->id map is built lazily from $dataStates
  // by matching state names, then cached. There is no static WorkSystem.Status
  // table, so both the apply and display paths must go through this.
  let _statusMap = null;
  window.WorkSystem.resolveStatusId = function (status) {
    if (status == null) return 0;
    if (!isNaN(status)) return Number(status); // already a numeric state id
    if (!_statusMap && Array.isArray($dataStates)) {
      _statusMap = {};
      for (const st of $dataStates) {
        if (st && st.name) _statusMap[st.name.toUpperCase()] = st.id;
      }
    }
    return (_statusMap && _statusMap[String(status).toUpperCase()]) || 0;
  };

  // Helper function to get job by ID
  window.WorkSystem.getJob = function (jobId) {
    if (!window.WorkSystem || !window.WorkSystem.Jobs) return null;
    return window.WorkSystem.Jobs.find(job => job.id === jobId);
  };

  // Helper function to get jobs by category
  window.WorkSystem.getJobsByCategory = function (category) {
    if (!window.WorkSystem || !window.WorkSystem.Jobs) return [];
    return window.WorkSystem.Jobs.filter(job => job.category === category);
  };

  // Helper function to get faction jobs
  window.WorkSystem.getFactionJobs = function (factionId) {
    if (!window.WorkSystem || !window.WorkSystem.Jobs) return [];
    return window.WorkSystem.Jobs.filter(job => job.factionId === factionId);
  };

  // Helper function to get actor stat (including custom ones)
  window.WorkSystem.getActorStat = function (actor, stat) {
    if (!actor) return 0;
    switch (stat) {
      case 'ATK': return actor.atk;
      case 'DEF': return actor.def;
      case 'MAT': return actor.mat;
      case 'MDF': return actor.mdf;
      case 'AGI': return actor.agi;
      case 'LUK': return actor.luk;
      case 'HP': return actor.mhp;
      case 'MP': return actor.mmp;
      // i18n-ignore-start  stat ids
      case 'Arcane':
      case 'Substance':
      case 'Stealth':
      case 'Intimidation': {
        // ItemSystemEquipment writes custom stats to vars 121-124 (actor 1),
        // 125-128 (actor 2), 129-132 (actor 3). Compute the base for the
        // passed actor instead of reading unrelated vars 86-89.
        const actorId = actor.actorId ? actor.actorId() : 1;
        if (actorId < 1 || actorId > 3) {
          // No custom-stat variables allocated for this actor; derive live if possible.
          if (typeof actor.calculateCustomStats === 'function') {
            const s = actor.calculateCustomStats();
            const key = stat.toLowerCase();
            return s[key] || 0;
          }
          return 0;
        }
        const base = 121 + (actorId - 1) * 4;
        const offset = { 'Arcane': 0, 'Substance': 1, 'Stealth': 2, 'Intimidation': 3 }[stat];
        // i18n-ignore-end
        return $gameVariables.value(base + offset);
      }
      default: return 0;
    }
  };

  // Helper function to check if actor meets requirements
  window.WorkSystem.meetsRequirements = function (actor, job) {
    const requirements = job.requirements;
    const results = {
      meets: true,
      deficits: []
    };

    for (const [stat, required] of Object.entries(requirements)) {
      const actorValue = this.getActorStat(actor, stat);

      if (actorValue < required) {
        results.meets = false;
        results.deficits.push({
          stat: stat,
          required: required,
          current: actorValue,
          deficit: required - actorValue
        });
      }
    }

    return results;
  };

  // Calculate success chance based on stat deficits
  window.WorkSystem.calculateSuccessChance = function (actor, job) {
    const check = this.meetsRequirements(actor, job);
    // Having done the job before is worth as much as the raw stats for it
    // (each job names its trade in Jobs.json "spec"). Three points a tier, and
    // it is the member taking the shift who is judged, not the party's best.
    const trained = (job.spec && window.SpecializationXP)
      ? (window.SpecializationXP.levelOf(actor, job.spec) - 1) * 0.03 : 0;

    if (check.meets) {
      return Math.min(0.95, 0.80 + trained); // 80% base success rate if requirements met
    }

    // Calculate penalty based on deficits
    let totalDeficit = 0;
    let totalRequired = 0;

    for (const deficit of check.deficits) {
      totalDeficit += deficit.deficit;
      totalRequired += deficit.required;
    }

    const deficitRatio = totalDeficit / totalRequired;
    // Training partly covers for stats the worker does not have.
    const successChance = Math.max(0.10, 0.80 + trained - (deficitRatio * 2)); // Minimum 10% chance

    return successChance;
  };

  // ============================================================================
  // Work Manager - Core Logic
  // ============================================================================

  class WorkManager {
    static executeWork(actor, job) {
      const successChance = window.WorkSystem.calculateSuccessChance(actor, job);
      const roll = Math.random();

      let outcomeType;
      if (roll < 0.05) {
        // 5% disaster chance
        outcomeType = 'disaster';
      } else if (roll < successChance) {
        // Success
        if (roll > successChance * 0.8) {
          outcomeType = 'success';
        } else {
          outcomeType = 'partial';
        }
      } else {
        // Failure
        outcomeType = 'failure';
      }

      return this.processOutcome(actor, job, outcomeType);
    }

    static processOutcome(actor, job, outcomeType) {
      const outcome = job.outcomes[outcomeType];

      // Select random message
      const messages = outcome.messages;
      const message = messages[Math.floor(Math.random() * messages.length)];

      // Calculate pay. A tradesman is worth more than a warm body, so the
      // shift pays better once the job's specialization is trained.
      const skill = (job.spec && window.SpecializationXP)
        ? window.SpecializationXP.multiplierFor(actor, job.spec, 0.08) : 1;
      const pay = Math.floor(job.basePay * outcome.payMultiplier * skill);

      // Get damage
      const damage = outcome.damage || {};
      const hpDamage = damage.hp || 0;
      const mpDamage = damage.mp || 0;

      // Get status effects
      const statuses = outcome.status || [];

      return {
        outcomeType: outcomeType,
        message: message,
        pay: pay,
        hpDamage: hpDamage,
        mpDamage: mpDamage,
        statuses: statuses,
        jobName: job.name,
        jobNameIt: job.name_it
      };
    }

    static applyWorkEffects(actor, job, result) {
      // Apply gold gain/loss
      if (result.pay > 0) {
        $gameParty.gainGold(result.pay);
      } else if (result.pay < 0) {
        $gameParty.loseGold(Math.abs(result.pay));
      }

      // A shift is a day of the party's life, so it goes in the diary
      // (Diary.js); the shift is over by the time this runs.
      if (window.Diary) {
        window.Diary.onWorkShift(job.name, result.pay, job.duration || job.hours || 0, actor);
      }

      // A shift worked is a shift learned from, and it is the worker who
      // learns it rather than whoever happens to be leading the party.
      if (job.spec && window.SpecializationXP) {
        window.SpecializationXP.awardCapped(job.spec, 2, { actor, soloist: true });
      }

      // Apply damage
      if (result.hpDamage > 0) {
        actor.gainHp(-result.hpDamage);
      }
      if (result.mpDamage > 0) {
        actor.gainMp(-result.mpDamage);
      }

      // Apply status effects
      for (const statusName of result.statuses) {
        const stateId = window.WorkSystem.resolveStatusId(statusName);
        if (stateId) {
          actor.addState(stateId);
        }
      }

      // Advance time (duration in hours, convert to minutes)
      const timeInMinutes = job.duration * 60;
      const currentTime = $gameVariables.value(settings.timeVariable);
      $gameVariables.setValue(settings.timeVariable, currentTime + timeInMinutes);

      // Reduce hunger/sleep based on work duration
      // Assume 5% hunger and 3% sleep per hour (matching TimeDateSystem rates)
      if (actor.reduceHunger !== undefined) {
        const hungerCost = job.duration * 5;
        const sleepCost = job.duration * 3;

        actor.reduceHunger(hungerCost);
        actor.reduceSleep(sleepCost);
      }
    }
  }

  // ============================================================================
  // Window_WorkJobList - Displays available jobs
  // ============================================================================

  class Window_WorkJobList extends Window_Selectable {
    initialize(rect, category) {
      this._category = category || null;
      super.initialize(rect);
      this.refresh();
      this.select(0);
    }

    maxCols() {
      return 1;
    }

    maxItems() {
      return this._data ? this._data.length : 0;
    }

    item() {
      return this._data[this.index()];
    }

    makeItemList() {
      if (!window.WorkSystem || !window.WorkSystem.Jobs) {
        this._data = [];
        return;
      }

      let jobs = window.WorkSystem.Jobs;

      // Filter by category if specified
      if (this._category) {
        jobs = jobs.filter(job => job.category === this._category);
      }

      // Filter faction jobs based on settings
      if (!settings.enableFactionJobs) {
        jobs = jobs.filter(job => !job.factionId);
      }

      this._data = jobs;
    }

    drawItem(index) {
      const job = this._data[index];
      if (!job) return;

      const rect = this.itemLineRect(index);
      const useItalian = ConfigManager.language === 'it';

      // Job name
      this.resetTextColor();
      const jobName = useItalian && job.name_it ? job.name_it : job.name;
      this.drawText(jobName, rect.x + 4, rect.y, rect.width - 120);

      // Duration
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(`${job.duration}h`, rect.x + rect.width - 150, rect.y, 50, 'right');

      // Pay
      const payColor = job.basePay > 150 ? ColorManager.powerUpColor() : ColorManager.normalColor();
      this.changeTextColor(payColor);
      this.drawText(`€${(job.basePay / 100).toFixed(2)}`, rect.x + rect.width - 90, rect.y, 80, 'right');
    }

    refresh() {
      this.makeItemList();
      super.refresh();
    }

    updateHelp() {
      if (this._helpWindow) {
        const job = this.item();
        if (job) {
          const useItalian = ConfigManager.language === 'it';
          const desc = useItalian && job.description_it ? job.description_it : job.description;
          this._helpWindow.setText(desc);
        }
      }
    }
  }

  // ============================================================================
  // Window_WorkJobDetails - Shows detailed job info and requirements
  // ============================================================================


  // ============================================================================
  // Window_WorkActorSelect - Choose which party member works
  // ============================================================================


  // ============================================================================
  // Window_WorkDetailsPanel - Combined details and actor selection panel
  // ============================================================================

  class Window_WorkDetailsPanel extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._job = null;
      this._actor = null;
      this._actorSelectMode = false;
      this._singleJobMode = false;
      this._actors = [];
      this.deactivate();
      this.refresh();
    }

    setSingleJobMode(enabled) {
      this._singleJobMode = enabled;
    }

    setJob(job) {
      if (this._job !== job) {
        this._job = job;
        this.refresh();
      }
    }

    setActor(actor) {
      if (this._actor !== actor) {
        this._actor = actor;
        this.refresh();
      }
    }

    getSelectedActor() {
      if (this._actorSelectMode && this.index() >= 0) {
        return this._actors[this.index()];
      }
      return this._actor;
    }

    activateActorSelection() {
      this._actorSelectMode = true;
      this._actors = $gameParty.members();
      this.activate();
      this.select(0);
      this.setHandler('ok', this.onActorOk.bind(this));
      this.setHandler('cancel', this.onActorCancel.bind(this));
      this.refresh();
    }

    deactivateActorSelection() {
      this._actorSelectMode = false;
      this.deactivate();
      this.select(-1);
      this.clearHandler('ok');
      this.clearHandler('cancel');
      this.refresh();
    }

    onActorOk() {
      const actor = this.getSelectedActor();
      if (actor && SceneManager._scene.onActorSelected) {
        SceneManager._scene.onActorSelected(actor);
      }
    }

    onActorCancel() {
      if (SceneManager._scene.onActorCancel) {
        SceneManager._scene.onActorCancel();
      }
    }

    maxCols() {
      return this._actorSelectMode ? 4 : 1;
    }

    maxItems() {
      return this._actorSelectMode ? this._actors.length : 0;
    }

    itemHeight() {
      if (this._actorSelectMode) {
        return 100; // Height for actor portraits
      }
      return this.lineHeight();
    }

    drawItem(index) {
      if (!this._actorSelectMode) return;

      const actor = this._actors[index];
      if (!actor) return;

      const rect = this.itemRect(index);
      const x = rect.x + 4;
      const y = rect.y + 4;
      const width = rect.width - 8;

      // Draw actor face
      this.drawActorFace(actor, x, y, width, 80);

      // Draw actor name
      this.drawText(actor.name(), x, y + 80, width, 'center');
    }

    refresh() {
      this.contents.clear();

      if (!this._job) {
        this.drawText(T('WorkSystem.selectJob'), 0, 0, this.contentsWidth(), 'center');
        return;
      }

      if (this._actorSelectMode) {
        this.drawActorSelection();
      } else {
        this.drawJobDetails();
      }
    }

    drawJobDetails() {
      const job = this._job;
      const actor = this._actor || $gameParty.leader();
      const lineHeight = this.lineHeight();
      const useItalian = ConfigManager.language === 'it';
      let y = 0;

      // Job description
      this.changeTextColor(ColorManager.systemColor());
      const descLabel =T('WorkSystem.description');
      this.drawText(descLabel, 0, y, this.contentsWidth());
      y += lineHeight;

      this.resetTextColor();
      const description = useItalian && job.description_it ? job.description_it : job.description;
      const wrappedDesc = this.wrapText(description, this.contentsWidth());
      for (const line of wrappedDesc) {
        this.drawText(line, 10, y, this.contentsWidth() - 10);
        y += lineHeight;
      }

      y += 5;

      // Job info row
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(`${job.category}`, 0, y, 200);
      this.drawText(`${job.duration}h`, 210, y, 100);
      this.changeTextColor(ColorManager.textColor(14));
      this.drawText(`€${(job.basePay / 100).toFixed(2)}`, 320, y, 100);
      y += lineHeight;

      // Faction info if applicable
      if (job.factionId !== undefined && job.factionId !== null) {
        this.changeTextColor(ColorManager.systemColor());
        const factionLabel =T('WorkSystem.faction');
        this.drawText(`${factionLabel}:`, 0, y, 100);
        this.changeTextColor(ColorManager.textColor(17)); // Purple/special color
        const factionName = this.getFactionName(job.factionId);
        this.drawText(factionName, 110, y, 300);
        y += lineHeight;
      }

      y += 10;

      // Split into two columns
      const columnWidth = Math.floor(this.contentsWidth() / 2);
      const leftX = 0;
      const rightX = columnWidth + 20;
      const startY = y;

      // Left column: Locations
      y = startY;
      this.changeTextColor(ColorManager.systemColor());
      const locLabel =T('WorkSystem.locations');
      this.drawText(locLabel, leftX, y, columnWidth);
      y += lineHeight;

      this.resetTextColor();
      if (!job.locations || job.locations.length === 0) {
        const unknownText =T('WorkSystem.unknown');
        this.drawText(unknownText, leftX + 10, y, columnWidth - 10);
      } else {
        for (const location of job.locations) {
          this.drawText('• ' + location, leftX + 10, y, columnWidth - 10);
          y += lineHeight;
          if (y > this.contentsHeight() - lineHeight * 2) break;
        }
      }

      // Right column: Requirements
      y = startY;
      this.changeTextColor(ColorManager.systemColor());
      const reqLabel =T('WorkSystem.requirements');
      this.drawText(reqLabel, rightX, y, columnWidth);
      y += lineHeight;

      const requirements = job.requirements;
      for (const [stat, required] of Object.entries(requirements)) {
        const actorValue = window.WorkSystem.getActorStat(actor, stat);
        const meetsReq = actorValue >= required;

        this.changeTextColor(meetsReq ? ColorManager.powerUpColor() : ColorManager.deathColor());
        this.drawText(`${_si18n(statKeyMapping[stat] || stat)}: ${actorValue} / ${required}`, rightX + 10, y, columnWidth - 10);
        y += lineHeight;
      }

      // Success rate at bottom
      if (settings.showSuccessChance && actor) {
        const successChance = window.WorkSystem.calculateSuccessChance(actor, job);
        const chancePercent = Math.floor(successChance * 100);

        y = this.contentsHeight() - lineHeight * 2;
        this.changeTextColor(ColorManager.systemColor());
        const successLabel =T('WorkSystem.successRate');
        this.drawText(successLabel + ':', rightX, y, 150);

        let chanceColor;
        if (chancePercent >= 70) {
          chanceColor = ColorManager.powerUpColor();
        } else if (chancePercent >= 40) {
          chanceColor = ColorManager.normalColor();
        } else {
          chanceColor = ColorManager.deathColor();
        }
        this.changeTextColor(chanceColor);
        this.drawText(`${chancePercent}%`, rightX + 160, y, 100);
      }
    }

    drawActorSelection() {
      const lineHeight = this.lineHeight();
      const useItalian = ConfigManager.language === 'it';

      // Draw instruction text
      this.changeTextColor(ColorManager.systemColor());
      const instructionText =T('WorkSystem.selectWorker');
      this.drawText(instructionText, 0, 0, this.contentsWidth(), 'center');

      // Draw actor portraits (handled by drawItem)
      super.refresh();
    }

    wrapText(text, maxWidth) {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = this.textWidth(testLine);

        if (testWidth > maxWidth - 20 && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    }

    getActorStat(actor, stat) {
      return window.WorkSystem.getActorStat(actor, stat);
    }

    getFactionName(factionId) {
      // Try to get faction name from FactionDataManager if it exists
      if (typeof $dataFactions !== 'undefined' && $dataFactions && $dataFactions[factionId]) {
        return $dataFactions[factionId].name || T('WorkSystem.factionNumbered', { id: factionId });
      }

      // Fallback names, used only while FactionDataManager has not loaded.
      const factionNames = T.obj('WorkSystem.factionName');

      return factionNames[factionId] || T('WorkSystem.factionNumbered', { id: factionId });
    }
  }

  // ============================================================================
  // Scene_Work - Main work system scene
  // ============================================================================

  class Scene_Work extends Scene_MenuBase {
    create() {
      super.create();
      this._category = $gameTemp._workCategory || null;
      this._singleJobId = $gameTemp._singleJobId || null;
      this._singleJobMode = this._singleJobId !== null;

      $gameTemp._workCategory = null;
      $gameTemp._singleJobId = null;

      if (this._singleJobMode) {
        this.createSingleJobView();
      } else {
        this.createJobListWindow();
        this.createDetailsPanel();
      }

      // Hide standard MZ canvas windows
      if (this._jobListWindow) this._jobListWindow.visible = false;
      if (this._detailsPanel) this._detailsPanel.visible = false;

      this._dndFocusSection = this._singleJobMode ? 'actors' : 'list';
      this._dndActorIndex = 0;

      this.createUIWorkDOM();
    }

    jobListWindowRect() {
      const wx = 0;
      const wy = 0;
      const ww = Graphics.boxWidth;
      const wh = Graphics.boxHeight * 0.40; // Top 40% of screen
      return new Rectangle(wx, wy, ww, wh);
    }

    detailsPanelRect() {
      const wx = 0;
      const wy = this._jobListWindow.y + this._jobListWindow.height;
      const ww = Graphics.boxWidth;
      const wh = Graphics.boxHeight - wy;
      return new Rectangle(wx, wy, ww, wh);
    }

    singleJobRect() {
      const wx = 0;
      const wy = 0;
      const ww = Graphics.boxWidth;
      const wh = Graphics.boxHeight;
      return new Rectangle(wx, wy, ww, wh);
    }

    createJobListWindow() {
      const rect = this.jobListWindowRect();
      this._jobListWindow = new Window_WorkJobList(rect, this._category);
      this._jobListWindow.setHandler('ok', this.onJobOk.bind(this));
      this._jobListWindow.setHandler('cancel', this.popScene.bind(this));
      this._jobListWindow.activate();
      this.addWindow(this._jobListWindow);
    }

    createDetailsPanel() {
      const rect = this.detailsPanelRect();
      this._detailsPanel = new Window_WorkDetailsPanel(rect);
      this.addWindow(this._detailsPanel);
    }

    createSingleJobView() {
      const rect = this.singleJobRect();
      this._detailsPanel = new Window_WorkDetailsPanel(rect);
      this._detailsPanel.setSingleJobMode(true);
      this.addWindow(this._detailsPanel);

      // Load the specific job
      const job = window.WorkSystem.getJob(this._singleJobId);
      if (job) {
        this._detailsPanel.setJob(job);
        this._detailsPanel.setActor($gameParty.leader());

        // Immediately show actor selection
        this._detailsPanel.activateActorSelection();
      } else {
        console.error(`Job ID ${this._singleJobId} not found!`);
        this.popScene();
      }
    }

    onJobOk() {
      // Handled by our custom UI navigation
    }

    onActorSelected(actor) {
      const job = this._singleJobMode ? window.WorkSystem.getJob(this._singleJobId) : this._jobListWindow.item();
      if (job && actor) {
        this.startWork(actor, job);
      }
    }

    onActorCancel() {
      // Handled by our custom UI navigation
    }

    startWork(actor, job) {
      // Store work data and return to map
      $gameTemp._pendingWork = {
        actorId: actor.actorId(),
        job: job
      };

      this.popScene();
    }

    terminate() {
      super.terminate();
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
    }

    createUIWorkDOM() {


      this._dndContainer = document.createElement('div');
      this._dndContainer.id = 'menu-container';
      this._dndContainer.style.position = 'absolute';
      this._dndContainer.style.top = '0';
      this._dndContainer.style.left = '0';
      this._dndContainer.style.width = '100%';
      this._dndContainer.style.height = '100%';
      this._dndContainer.style.zIndex = '1000';
      this._dndContainer.style.background = 'radial-gradient(circle, rgba(18, 10, 5, 0.93) 0%, rgba(5, 3, 1, 0.98) 100%)';
      this._dndContainer.style.display = 'flex';
      this._dndContainer.style.justifyContent = 'center';
      this._dndContainer.style.alignItems = 'center';
      this._dndContainer.style.fontFamily = "'Lora', serif";
      this._dndContainer.style.color = '#2b1c11';
      this._dndContainer.style.boxSizing = 'border-box';

      document.body.appendChild(this._dndContainer);

      this.refreshUIWorkDOM();
    }

    refreshUIWorkDOM() {
      if (!this._dndContainer) return;

      const useItalian = ConfigManager.language === 'it';
      const jobs = this._jobListWindow ? this._jobListWindow._data : [];
      const selectedIndex = this._jobListWindow ? this._jobListWindow.index() : 0;
      const selectedJob = this._singleJobMode ? window.WorkSystem.getJob(this._singleJobId) : (jobs[selectedIndex] || null);

      const actors = $gameParty.members();
      const selectedActorIndex = this._dndActorIndex;
      const selectedActor = actors[selectedActorIndex] || actors[0];

      // Every job trains its own specialization, and that specialization is
      // what decides the shift's pay and its accident odds. Name the one the
      // highlighted job runs on, so the board reads as a board of skills.
      if (window.SpecBadge) {
        if (selectedJob && selectedJob.spec) window.SpecBadge.show(selectedJob.spec);
        else window.SpecBadge.hide();
      }

      let leftPageHTML = "";
      let rightPageHTML = "";

      if (this._singleJobMode) {
        leftPageHTML = this.getJobContractHTML(selectedJob, selectedActor);
        rightPageHTML = this.getActorSelectionHTML(actors, selectedActorIndex, selectedJob);
      } else {
        if (this._dndFocusSection === 'list') {
          leftPageHTML = this.getJobsBoardHTML(jobs, selectedIndex);
          rightPageHTML = this.getJobContractHTML(selectedJob, selectedActor);
        } else {
          leftPageHTML = this.getJobContractHTML(selectedJob, selectedActor);
          rightPageHTML = this.getActorSelectionHTML(actors, selectedActorIndex, selectedJob);
        }
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

      // Auto scroll selected items
      setTimeout(() => {
        if (this._dndContainer) {
          const listEl = this._dndContainer.querySelector('#jobs-list');
          if (listEl) {
            const selectedEl = listEl.querySelector('[style*="background: rgba(74, 29, 15, 0.08)"]');
            if (selectedEl) {
              selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }

          const rosterEl = this._dndContainer.querySelector('#roster-list');
          if (rosterEl) {
            const selectedEl = rosterEl.querySelector('[style*="border: 2px solid #4a1d0f"]');
            if (selectedEl) {
              selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      }, 50);
    }

    getJobsBoardHTML(jobs, selectedIndex) {
      const useItalian = ConfigManager.language === 'it';
      const categoryLabel = this._category ? `: ${this._category.toUpperCase()}` : '';
      const title = useItalian ? `REGISTRO DI GILDA${categoryLabel}` : `GUILD LABOR REGISTRY${categoryLabel}`;

      let listHTML = "";
      if (jobs.length === 0) {
        listHTML = `
          <div style="text-align:center; padding: 40px; font-style:italic; color:#6b5242; font-family:'Lora', serif;">
            ${T('WorkSystem.noGuildLaborRequisitionsCurrently')}
          </div>
        `;
      } else {
        jobs.forEach((job, idx) => {
          const isSelected = idx === selectedIndex && this._dndFocusSection === 'list';
          const jobName = useItalian && job.name_it ? job.name_it : job.name;

          const itemStyle = `
            cursor: pointer;
            padding: 10px 14px;
            border-bottom: 1px dotted rgba(139, 90, 43, 0.25);
            background: ${isSelected ? 'rgba(74, 29, 15, 0.08)' : 'transparent'};
            border-left: 3px solid ${isSelected ? '#8b5a2b' : 'transparent'};
            transition: all 0.2s ease;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-sizing: border-box;
            width: 100%;
          `;

          listHTML += `
            <div class="job-item" style="${itemStyle}" onclick="SceneManager._scene.selectJobItem(${idx})">
              <div style="display:flex; flex-direction:column; gap:2px;">
                <span style="font-family:'Lora', serif; font-size:0.95rem; font-weight:${isSelected ? 'bold' : 'normal'}; color:#1a1a1a;">
                  ${jobName}
                </span>
                <span style="font-size:0.75rem; color:#6b5242; font-family:'Lora', serif;">
                  ${job.category} • ${job.duration}h
                </span>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-family:'Lora', serif; font-size:1rem; font-weight:bold; color:#4a1d0f;">
                  €${(job.basePay / 100).toFixed(2)}
                </span>
              </div>
            </div>
          `;
        });
      }

      return `
        <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:16px;">
          ${title}
        </h2>
        <div id="jobs-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:4px; padding-right:4px;">
          ${listHTML}
        </div>
        <div style="margin-top:auto; border-top:1px dashed rgba(139, 90, 43, 0.4); padding-top:12px; display:flex; justify-content:flex-end; align-items:center; font-size:0.82rem; color:#5c4b3d; font-family:'Lora', serif; box-sizing:border-box; width:100%;">
          <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="background:#8b5a2b; color:#ecdcb9; padding:6px 16px; border-radius:4px; font-weight:bold; cursor:pointer; transition:all 0.2s ease; border:1px solid #4a2711; text-transform:uppercase; font-family:'Lora', serif; font-size:0.9rem;">
            ${T('WorkSystem.dismiss')}
          </div>
        </div>
      `;
    }

    getJobContractHTML(job, actor) {
      const useItalian = ConfigManager.language === 'it';
      if (!job) {
        return `
          <div style="display:flex; justify-content:center; align-items:center; flex:1; height:100%; text-align:center; font-style:italic; color:#5c4b3d; font-family:'Lora', serif; font-size:1.1rem; border:2px dashed #bda881; border-radius:6px; padding:40px;">
            ${T('WorkSystem.selectALaborContractTo')}
          </div>
        `;
      }

      const jobName = useItalian && job.name_it ? job.name_it : job.name;
      const description = useItalian && job.description_it ? job.description_it : job.description;

      const reqCheck = window.WorkSystem.meetsRequirements(actor, job);
      const successChance = window.WorkSystem.calculateSuccessChance(actor, job);
      const chancePercent = Math.floor(successChance * 100);

      let chanceColor = "#822d2d";
      if (chancePercent >= 70) {
        chanceColor = "#3d5e4b";
      } else if (chancePercent >= 40) {
        chanceColor = "#8b5a2b";
      }

      let requirementsHTML = "";
      for (const [stat, required] of Object.entries(job.requirements)) {
        const actorValue = window.WorkSystem.getActorStat(actor, stat);
        const meetsReq = actorValue >= required;
        const mappedName = statKeyMapping[stat] || stat;
        const statLabel = _si18n(mappedName);

        requirementsHTML += `
          <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.15); padding-bottom:4px; color:${meetsReq ? '#3d5e4b' : '#822d2d'}; font-weight:${meetsReq ? 'normal' : 'bold'};">
            <span>${statLabel}</span>
            <span>${actorValue} / ${required}</span>
          </div>
        `;
      }

      let locationsHTML = "";
      if (job.locations && job.locations.length > 0) {
        locationsHTML = `
          <div style="margin-top: 10px;">
            <strong style="color:#5c3516; font-size:0.85rem; text-transform:uppercase;">${T('WorkSystem.deploymentLocations')}:</strong>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
              ${job.locations.map(loc => `<span style="background:rgba(139,90,43,0.1); border:1px solid rgba(139,90,43,0.2); padding:2px 8px; border-radius:3px; font-size:0.75rem; color:#4a1d0f;">${window.WorkSystem.locationLabel ? window.WorkSystem.locationLabel(loc) : loc}</span>`).join('')}
            </div>
          </div>
        `;
      }

      let factionHTML = "";
      if (job.factionId !== undefined && job.factionId !== null) {
        const factionName = this._detailsPanel.getFactionName(job.factionId);
        factionHTML = `
          <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.15); padding-bottom:4px;">
            <strong style="color:#5c3516;">${T('WorkSystem.faction')}:</strong>
            <span style="color:#8b5a2b; font-weight:bold;">${factionName}</span>
          </div>
        `;
      }

      return `
        <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:16px; text-align:center;">
          ${T('WorkSystem.laborContract')}
        </h2>

        <div style="flex:1; display:flex; flex-direction:column; gap:12px; box-sizing: border-box; width:100%;">
          <div style="border: 4px double #4a2711; background: #ecdcb9; padding: 22px; border-radius: 6px; box-shadow: inset 0 0 40px rgba(78,38,12,0.15); font-family:'Lora', serif; display:flex; flex-direction:column; gap:10px; box-sizing: border-box; width:100%;">
            <div style="font-family:'Lora', serif; font-size:1.5rem; color:#4a1d0f; font-weight:bold; border-bottom:2px double rgba(74,29,15,0.3); padding-bottom:6px; text-align:center; text-transform:uppercase;">
              ${jobName}
            </div>

            <div style="font-size:0.9rem; font-style:italic; line-height:1.45; color:#2b1c11; border-bottom:1px dashed rgba(139,90,43,0.25); padding-bottom:10px; margin-bottom:6px; text-align:justify;">
              "${description}"
            </div>

            <div style="display:flex; flex-direction:column; gap:6px; font-size:0.9rem;">
              <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.15); padding-bottom:4px;">
                <strong style="color:#5c3516;">${T('WorkSystem.categoryLabel')}:</strong>
                <span>${job.category}</span>
              </div>
              <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.15); padding-bottom:4px;">
                <strong style="color:#5c3516;">${T('WorkSystem.duration')}:</strong>
                <span>${T('WorkSystem.hoursValue', { hours: job.duration })}</span>
              </div>
              <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.15); padding-bottom:4px; font-weight:bold; color:#3d5e4b;">
                <span>${T('WorkSystem.baseReward')}:</span>
                <span>€${(job.basePay / 100).toFixed(2)}</span>
              </div>
              ${factionHTML}
            </div>

            ${locationsHTML}

            <div style="margin-top: 10px; border-top: 1px dashed rgba(139,90,43,0.25); padding-top: 10px; display:flex; flex-direction:column; gap:6px;">
              <strong style="color:#5c3516; font-size:0.85rem; text-transform:uppercase;">${T('WorkSystem.statRequirements')} (${actor.name()}):</strong>
              <div style="display:flex; flex-direction:column; gap:4px; margin-top:2px;">
                ${requirementsHTML}
              </div>
            </div>

            ${settings.showSuccessChance ? `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; border-top:1px dashed rgba(139,90,43,0.25); padding-top:10px; font-weight:bold; font-size:1rem;">
              <span style="color:#5c3516;">${T('WorkSystem.estimatedSuccessRate')}:</span>
              <span style="color:${chanceColor}; font-family:'Lora', serif; font-size:1.15rem;">${chancePercent}%</span>
            </div>
            ` : ''}

            ${!reqCheck.meets ? `
            <div style="margin-top:8px; padding:8px 12px; background:rgba(130,45,45,0.06); border-left:3px solid #822d2d; border-radius:3px; font-size:0.78rem; color:#822d2d; line-height:1.35; font-style:italic;">
              Warning: Deficits detected! Undertaking this contract will carry higher hazards of failure and injury.
            </div>
            ` : ''}
          </div>
        </div>

        ${this._singleJobMode ? `
        <div style="margin-top:auto; border-top:1px dashed rgba(139, 90, 43, 0.4); padding-top:12px; display:flex; justify-content:flex-start; align-items:center; font-size:0.82rem; color:#5c4b3d; font-family:'Lora', serif; box-sizing:border-box; width:100%;">
          <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="background:#8b5a2b; color:#ecdcb9; padding:6px 16px; border-radius:4px; font-weight:bold; cursor:pointer; transition:all 0.2s ease; border:1px solid #4a2711; text-transform:uppercase; font-family:'Lora', serif; font-size:0.9rem;">
            ${T('WorkSystem.dismiss')}
          </div>
        </div>
        ` : ''}
      `;
    }

    getActorFaceHTML(actor, size = 64) {
      const faceName = actor.faceName();
      if (!faceName) {
        return `<div style="width:${size}px; height:${size}px; border-radius:50%; background:#8b5a2b; color:#ecdcb9; display:flex; align-items:center; justify-content:center; font-family:'Lora', serif; font-size:1.2rem; font-weight:bold;">${actor.name().charAt(0)}</div>`;
      }

      return `
        <div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          border: 2px solid #8b5a2b;
          box-sizing: border-box;
          background-image: url('img/busts/${faceName}.png');
          background-position: 50% 12%;
          background-size: 220%;
          background-repeat: no-repeat;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
          flex-shrink: 0;
        "></div>
      `;
    }

    getActorRequirementDetailHTML(actor, job) {
      let html = "";
      for (const [stat, required] of Object.entries(job.requirements)) {
        const actorValue = window.WorkSystem.getActorStat(actor, stat);
        const isMet = actorValue >= required;
        const mappedName = statKeyMapping[stat] || stat;
        const statLabel = _si18n(mappedName);

        html += `
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:${isMet ? '#3d5e4b' : '#822d2d'}; font-weight:${isMet ? 'normal' : 'bold'}; border-bottom:1px dotted rgba(0,0,0,0.05); padding:1px 0;">
            <span>${statLabel}</span>
            <span>${actorValue} / ${required}</span>
          </div>
        `;
      }
      return html;
    }

    getActorSelectionHTML(actors, selectedActorIndex, selectedJob) {
      const useItalian = ConfigManager.language === 'it';

      let listHTML = "";
      actors.forEach((actor, idx) => {
        const isSelected = idx === selectedActorIndex;
        const isFocused = isSelected && this._dndFocusSection === 'actors';

        const successChance = window.WorkSystem.calculateSuccessChance(actor, selectedJob);
        const chancePercent = Math.floor(successChance * 100);
        let chanceColor = "#822d2d";
        if (chancePercent >= 70) {
          chanceColor = "#3d5e4b";
        } else if (chancePercent >= 40) {
          chanceColor = "#8b5a2b";
        }

        const cardStyle = `
          cursor: pointer;
          padding: 10px 14px;
          border: 2px solid ${isFocused ? '#4a1d0f' : (isSelected ? '#8b5a2b' : 'rgba(139,90,43,0.15)')};
          background: ${isSelected ? '#fff8e8' : '#fcf8f0'};
          border-radius: 6px;
          transition: all 0.2s ease;
          display: flex;
          gap: 12px;
          align-items: center;
          box-sizing: border-box;
          width: 100%;
          margin-bottom: 8px;
          box-shadow: ${isFocused ? '0 4px 8px rgba(74,29,15,0.15)' : '0 1px 3px rgba(0,0,0,0.05)'};
        `;

        listHTML += `
          <div class="roster-item focusable" style="${cardStyle}" onclick="SceneManager._scene.selectActorItem(${idx})">
            ${this.getActorFaceHTML(actor, 54)}
            <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-family:'Lora', serif; font-size:0.95rem; color:#1a1a1a;">
                  ${actor.name()}
                </strong>
                <span style="font-family:'Lora', serif; font-size:0.75rem; font-weight:bold; color:${chanceColor};">
                  ${chancePercent}% SUCCESS
                </span>
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-top:2px;">
                ${this.getActorRequirementDetailHTML(actor, selectedJob)}
              </div>
            </div>
          </div>
        `;
      });

      return `
        <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:16px;">
          ${T('WorkSystem.workerRoster')}
        </h2>

        <div id="roster-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; padding-right:4px;">
          ${listHTML}
        </div>

        <div style="margin-top:12px; border-top:1px dashed rgba(139, 90, 43, 0.4); padding-top:12px; display:flex; flex-direction:column; gap:8px; box-sizing:border-box; width:100%;">
          <div class="action-button focusable" onclick="SceneManager._scene.confirmActorSelection()" style="background:#4a1d0f; color:#ecdcb9; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer; text-align:center; border:2px solid #301107; text-transform:uppercase; font-family:'Lora', serif; font-size:1.05rem; box-shadow:0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
            ${T('WorkSystem.signContract')}
          </div>
          
          ${!this._singleJobMode ? `
          <div class="action-button focusable" onclick="SceneManager._scene.retractActorSelection()" style="background:#8b5a2b; color:#ecdcb9; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer; text-align:center; border:1px solid #4a2711; text-transform:uppercase; font-family:'Lora', serif; font-size:0.9rem; transition: all 0.2s ease;">
            ${T('WorkSystem.retractContract')}
          </div>
          ` : ''}
        </div>
      `;
    }

    selectJobItem(index) {
      if (this._jobListWindow) {
        this._jobListWindow.select(index);
        this._dndFocusSection = 'list';
        SoundManager.playOk();
        this.refreshUIWorkDOM();
      }
    }

    selectActorItem(index) {
      this._dndActorIndex = index;
      this._dndFocusSection = 'actors';
      SoundManager.playOk();
      this.refreshUIWorkDOM();
    }

    confirmActorSelection() {
      const actor = $gameParty.members()[this._dndActorIndex];
      if (actor) {
        SoundManager.playOk();
        this.onActorSelected(actor);
      } else {
        SoundManager.playBuzzer();
      }
    }

    retractActorSelection() {
      SoundManager.playCancel();
      this._dndFocusSection = 'list';
      this._detailsPanel.deactivateActorSelection();
      if (this._jobListWindow) this._jobListWindow.activate();
      this.refreshUIWorkDOM();
    }

    update() {
      super.update();

      if (this._dndContainer) {
        let moved = false;
        const job = this._singleJobMode ? window.WorkSystem.getJob(this._singleJobId) : (this._jobListWindow ? this._jobListWindow.item() : null);

        if (this._dndFocusSection === 'list' && !this._singleJobMode) {
          if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
            const currentIndex = this._jobListWindow.index();
            const maxItems = this._jobListWindow.maxItems();
            if (maxItems > 0) {
              const nextIndex = currentIndex < maxItems - 1 ? currentIndex + 1 : 0;
              this._jobListWindow.select(nextIndex);
              moved = true;
            }
          } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
            const currentIndex = this._jobListWindow.index();
            const maxItems = this._jobListWindow.maxItems();
            if (maxItems > 0) {
              const prevIndex = currentIndex > 0 ? currentIndex - 1 : maxItems - 1;
              this._jobListWindow.select(prevIndex);
              moved = true;
            }
          } else if (Input.isTriggered('right') || this.isKeyPressed('KeyD') || Input.isTriggered('ok')) {
            if (job) {
              this._dndFocusSection = 'actors';
              this._dndActorIndex = 0;
              this._jobListWindow.deactivate();
              this._detailsPanel.activateActorSelection();
              moved = true;
              SoundManager.playOk();
            }
          }
        } else if (this._dndFocusSection === 'actors') {
          const maxActors = $gameParty.size();

          if (Input.isTriggered('down') || Input.isRepeated('down') || this.isKeyPressed('KeyS')) {
            if (maxActors > 0) {
              this._dndActorIndex = (this._dndActorIndex + 1) % maxActors;
              moved = true;
            }
          } else if (Input.isTriggered('up') || Input.isRepeated('up') || this.isKeyPressed('KeyW')) {
            if (maxActors > 0) {
              this._dndActorIndex = (this._dndActorIndex - 1 + maxActors) % maxActors;
              moved = true;
            }
          } else if ((Input.isTriggered('left') || this.isKeyPressed('KeyA')) && !this._singleJobMode) {
            this._dndFocusSection = 'list';
            this._detailsPanel.deactivateActorSelection();
            if (this._jobListWindow) this._jobListWindow.activate();
            moved = true;
            SoundManager.playCancel();
          } else if (Input.isTriggered('ok')) {
            this.confirmActorSelection();
          }
        }

        if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
          if (this._dndFocusSection === 'actors' && !this._singleJobMode) {
            this.retractActorSelection();
          } else {
            SoundManager.playCancel();
            this.popScene();
          }
        }

        if (moved) {
          this.refreshUIWorkDOM();
        }
      }

      // Sync details panel internally in the background
      if (!this._singleJobMode && this._jobListWindow) {
        const job = this._jobListWindow.item();
        const actor = $gameParty.members()[this._dndActorIndex] || $gameParty.leader();
        if (job && actor) {
          this._detailsPanel.setJob(job);
          this._detailsPanel.setActor(actor);
        }
      } else if (this._singleJobMode) {
        const actor = $gameParty.members()[this._dndActorIndex] || $gameParty.leader();
        if (actor) {
          this._detailsPanel.setActor(actor);
        }
      }
    }

    isKeyPressed(key) {
      // Input._currentState is keyed by mapped action name (e.g. 'up'), never by
      // physical codes like 'KeyW', so the old lookup was always undefined (dead).
      // Translate the physical key to the engine action bound to it and use the
      // same trigger test the arrows use.
      const codeToKeyCode = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68 };
      const keyCode = codeToKeyCode[key];
      const action = keyCode != null ? Input.keyMapper[keyCode] : null;
      return action ? Input.isTriggered(action) : false;
    }
  }

  // ============================================================================
  // Map Integration - Execute work on map
  // ============================================================================

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);

    if ($gameTemp._pendingWork && !$gameMessage.isBusy() && !$gamePlayer.isMoving()) {
      this.processWork();
    }
  };

  Scene_Map.prototype.processWork = function () {
    const workData = $gameTemp._pendingWork;
    $gameTemp._pendingWork = null;

    const actor = $gameActors.actor(workData.actorId);
    const job = workData.job;

    if (!actor || !job) return;

    // Start work sequence
    this.startWorkSequence(actor, job);
  };

  Scene_Map.prototype.startWorkSequence = function (actor, job) {
    // Flagged for the travel window (TimeDateSystem's MapInfoHUD): the clock
    // is about to run fast behind the darkened screen, so the card shows.
    this._workSequenceActive = true;

    // Disable player movement
    $gamePlayer.setMoveSpeed(0);

    // Play work sound effect
    if (settings.workSoundEffect) {
      AudioManager.playSe({
        name: settings.workSoundEffect,
        volume: 90,
        pitch: 100,
        pan: 0
      });
    }

    // Fade out screen
    $gameScreen.startFadeOut(settings.workFadeDuration);

    // Wait for fade, then process work
    setTimeout(() => {
      // A map transfer during the fade/work delay swaps in a fresh Scene_Map;
      // don't run work on a stale scene instance.
      if (SceneManager._scene !== this) return;
      this.executeWork(actor, job);
    }, (settings.workFadeDuration / 60) * 1000 + settings.workDuration / 60 * 1000);
  };

  Scene_Map.prototype.executeWork = function (actor, job) {
    // Execute work and get result
    const result = WorkManager.executeWork(actor, job);

    // Apply effects
    WorkManager.applyWorkEffects(actor, job, result);

    // The shift itself is over; the travel window drops with the fade-in.
    this._workSequenceActive = false;

    // Fade back in
    $gameScreen.startFadeIn(settings.workFadeDuration);

    // Re-enable player movement
    $gamePlayer.setMoveSpeed(4);

    // Display result messages
    setTimeout(() => {
      // Guard against a transfer swapping in a fresh Scene_Map mid-fade.
      if (SceneManager._scene !== this) return;
      this.displayWorkResult(actor, job, result);
    }, (settings.workFadeDuration / 60) * 1000);
  };

  Scene_Map.prototype.displayWorkResult = function (actor, job, result) {
    const useItalian = ConfigManager.language === 'it';
    const jobName = useItalian && job.name_it ? job.name_it : job.name;

    // Work complete message
    window.skipLocalization = true;
    $gameMessage.add(T('WorkSystem.finishedWorking', { actor: actor.name(), job: jobName }));
    window.skipLocalization = false;

    // Outcome message
    window.skipLocalization = true;
    $gameMessage.add(result.message);
    window.skipLocalization = false;

    // Pay information
    if (result.pay > 0) {
      window.skipLocalization = true;
      $gameMessage.add(T('WorkSystem.earned', { amount: (result.pay / 100).toFixed(2) }));
      window.skipLocalization = false;
    } else if (result.pay < 0) {
      window.skipLocalization = true;
      $gameMessage.add(T('WorkSystem.lost', { amount: (Math.abs(result.pay) / 100).toFixed(2) }));
      window.skipLocalization = false;
    } else {
      window.skipLocalization = true;
      $gameMessage.add(T('WorkSystem.noPay'));
      window.skipLocalization = false;
    }

    // Damage information
    if (result.hpDamage > 0) {
      window.skipLocalization = true;
      $gameMessage.add(T('WorkSystem.hpDamage', { amount: result.hpDamage }));
      window.skipLocalization = false;
    }
    if (result.mpDamage > 0) {
      window.skipLocalization = true;
      $gameMessage.add(T('WorkSystem.mpDamage', { amount: result.mpDamage }));
      window.skipLocalization = false;
    }

    // Status effects
    if (result.statuses.length > 0) {
      // result.statuses holds raw status names (e.g. "Nausea") or numeric ids,
      // mirroring applyWorkEffects. Resolve each to a state and use its display
      // name, falling back to the raw label when it can't be mapped.
      const stateNames = result.statuses.map(status => {
        const stateId = window.WorkSystem.resolveStatusId(status);
        const state = stateId && $dataStates[stateId];
        return (state && state.name) || String(status);
      }).join(', ');
      window.skipLocalization = true;
      $gameMessage.add(T('WorkSystem.afflicted', { states: stateNames }));
      window.skipLocalization = false;
    }

    // Time passed
    window.skipLocalization = true;
    $gameMessage.add(T('WorkSystem.hoursPassed', { hours: job.duration }));
    window.skipLocalization = false;
  };

  // ============================================================================
  // Plugin Commands
  // ============================================================================

  PluginManager.registerCommand(pluginName, "OpenWorkMenu", args => {
    SceneManager.push(Scene_Work);
  });

  PluginManager.registerCommand(pluginName, "OpenWorkMenuCategory", args => {
    $gameTemp._workCategory = args.category;
    SceneManager.push(Scene_Work);
  });

  PluginManager.registerCommand(pluginName, "ShowSingleJob", args => {
    $gameTemp._singleJobId = Number(args.jobId);
    SceneManager.push(Scene_Work);
  });

  // ============================================================================
  // Add Work option to main menu (optional - can be enabled via menu command)
  // ============================================================================

  // Uncomment below to add "Work" to main menu
  /*
  const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
  Window_MenuCommand.prototype.addOriginalCommands = function() {
    _Window_MenuCommand_addOriginalCommands.call(this);
    this.addCommand("Work", "work", true);
  };

  const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
  Scene_Menu.prototype.createCommandWindow = function() {
    _Scene_Menu_createCommandWindow.call(this);
    this._commandWindow.setHandler("work", this.commandWork.bind(this));
  };

  Scene_Menu.prototype.commandWork = function() {
    SceneManager.push(Scene_Work);
  };
  */

})();
