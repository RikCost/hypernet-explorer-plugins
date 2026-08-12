/*:
 * @target MZ
 * @plugindesc v1.0.0 Job Offers Menu - Browse available jobs with locations
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help WorkSystemJobOffers.js
 * === Job Offers Menu v1.0.0 ===
 *
 * Adds a "Job Offers" menu command that shows random available jobs.
 * Displays job details including duration, hourly pay, and locations.
 *
 * Requirements:
 * - DataService.js must be loaded first
 *
 * --- Plugin Commands ---
 *
 * @command openJobOffers
 * @text Open Job Offers Menu
 * @desc Opens the Job Offers browser showing random available jobs.
 *
 * @param numberOfJobs
 * @text Number of Jobs Shown
 * @type number
 * @min 3
 * @max 20
 * @default 8
 * @desc How many random jobs to display in the Job Offers menu
 *
 * @param showInMenu
 * @text Show in Main Menu
 * @type boolean
 * @default true
 * @desc Add "Job Offers" command to main menu
 *
 * @param menuCommandName
 * @text Menu Command Name
 * @type text
 * @default Job Offers
 * @desc Name of the menu command (English)
 *
 * @param menuCommandName_IT
 * @text Menu Command Name (Italian)
 * @type text
 * @default Offerte di Lavoro
 * @desc Name of the menu command (Italian)
 */

(() => {
  'use strict';

  const pluginName = "WorkSystemJobOffers";
  const parameters = PluginManager.parameters(pluginName);
  const numberOfJobs = Number(parameters['numberOfJobs'] || 8);
  const showInMenu = parameters['showInMenu'] === 'true';

  //=============================================================================
  // Location labels
  //=============================================================================
  // A job's locations are raw map ids. They read as "<map group> - <map name>":
  // the first half is the map's <MapGroup: Name> note tag (resolved through
  // NPCSystem's group registry, which is what the rest of the game reads for
  // town membership), the second half is the map's own display name. Reading a
  // display name means parsing that map's JSON, so every answer is memoized for
  // the session, per language.
  const _locationLabels = {};

  // Display name off the map itself, falling back to the MapInfos name with the
  // editor's numbering prefix stripped ("705 - North Docks" -> "North Docks").
  function mapDisplayName(mapId) {
    let data = null;
    if (typeof $dataMap !== 'undefined' && $dataMap && $dataMap.id === mapId) data = $dataMap;
    else if (window.NPCSystem && window.NPCSystem.loadMapData) {
      try { data = window.NPCSystem.loadMapData(mapId); } catch (e) { data = null; }
    }
    if (data && data.displayName) return data.displayName;

    const info = (typeof $dataMapInfos !== 'undefined' && $dataMapInfos) ? $dataMapInfos[mapId] : null;
    const name = (info && info.name) ? String(info.name) : '';
    const stripped = name.replace(/^\s*[A-Za-z]{0,2}\d+\s*-\s*/, '').trim();
    return stripped || name.trim();
  }

  // Readable name of the group the map belongs to, "" when it belongs to none.
  function mapGroupLabel(mapId) {
    let groupName = null;
    try {
      if (window.NPCSystem && window.NPCSystem.findMapGroupByMap) {
        groupName = window.NPCSystem.findMapGroupByMap(mapId);
      }
    } catch (e) { groupName = null; }
    if (!groupName) return '';

    // Procedural settlements ("Proc:x,y") carry their own readable label.
    const grp = (typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._npcMapGroups)
      ? $gameSystem._npcMapGroups[groupName] : null;
    if (grp && grp.displayName) return grp.displayName;
    if (/^Proc:/i.test(groupName)) return '';

    // Group keys are written without spaces ("FrozenStation"); the town of that
    // name in Destinations.json knows how it is meant to read.
    return (window.WorkSystem && window.WorkSystem.destinationName)
      ? window.WorkSystem.destinationName(groupName) : groupName;
  }

  function locationLabel(mapId) {
    const id = Number(mapId);
    if (!Number.isFinite(id) || id <= 0) return String(mapId == null ? '' : mapId);

    const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || 'en';
    const cacheKey = `${lang}:${id}`;
    if (_locationLabels[cacheKey]) return _locationLabels[cacheKey];

    const location = mapDisplayName(id);
    const group = mapGroupLabel(id);
    let label;
    if (group && location) label = T('WorkSystem.locationInGroup', { group: group, location: location });
    else label = location || group || T('WorkSystem.mapNumbered', { id: id });

    _locationLabels[cacheKey] = label;
    return label;
  }

  window.WorkSystem = window.WorkSystem || {};
  window.WorkSystem.locationLabel = locationLabel;

  //=============================================================================
  // Plugin Commands
  //=============================================================================

  PluginManager.registerCommand(pluginName, "openJobOffers", args => {
    SceneManager.push(Scene_JobOffers);
  });

  if (window.HypernetOS) {
    window.HypernetOS.registerApp({
      id: 'app-job-offers',
      name: T('WorkSystem.jobBoardApp'),
      icon: 244,
      launchFn: function() {
        if (window.HypernetJobsApp) {
          window.HypernetJobsApp.launch();
        } else {
          SceneManager.push(Scene_JobOffers);
        }
      },
      desktopShortcut: true
    });
  }

  //=============================================================================
  // Window_MenuCommand - Add Job Offers to main menu
  //=============================================================================



  //=============================================================================
  // Scene_JobOffers - Main job offers scene
  //=============================================================================

  // --- HypernetJobsApp ---
  window.HypernetJobsApp = {
    appInstance: null,
    win: null,
    launch: function(params) {
      if (!window.HypernetWindowManager) return;
      
      if (!this.win || !document.getElementById('app-job-offers')) {
        this.win = window.HypernetWindowManager.createWindow({
          id: 'app-job-offers',
          title: T('WorkSystem.jobBoardApp'),
          icon: 244,
          width: 950,
          height: 600,
          contentHTML: '<div id="job-offers-content" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #ece9d8;"></div>'
        });

        this.appInstance = new Scene_JobOffers();
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

  class Scene_JobOffers extends Scene_MenuBase {
    create() {
      super.create();
      this.createJobListWindow();
      this.createDetailWindow();

      // Hide native windows to display DOM
      if (this._jobListWindow) this._jobListWindow.visible = false;
      if (this._detailWindow) this._detailWindow.visible = false;

      this._dndFocusSection = 'list';
      this._dndActorIndex = 0;

      this.createUIJobOffersDOM();
      // Populate the DOM immediately. In app mode update() bails out early (the
      // OS focus ring drives input), so without this initial render the window
      // would stay blank until a navigation event fired.
      this.refreshUIJobOffersDOM();
    }

    createJobListWindow() {
      const rect = new Rectangle(0, 0, 0, 0);
      this._jobListWindow = new Window_JobOffersList(rect);
      this.addWindow(this._jobListWindow);
    }

    createDetailWindow() {
      const rect = new Rectangle(0, 0, 0, 0);
      this._detailWindow = new Window_JobDetails(rect);
      this._jobListWindow.setDetailWindow(this._detailWindow);
      this.addWindow(this._detailWindow);
    }

    onJobOk() {
      // Handled by custom D&D navigation
    }

    onActorSelected(actor) {
      const job = this._jobListWindow.currentJob();
      if (job && actor) {
        this.startWork(actor, job);
      }
    }

    startWork(actor, job) {
      // Store work data and return to map
      $gameTemp._pendingWork = {
        actorId: actor.actorId(),
        job: job
      };
      this.popScene();
    }

    popScene() {
      if (this._isAppMode) {
        if (window.HypernetJobsApp && window.HypernetJobsApp.win) {
          window.HypernetWindowManager.closeWindow(window.HypernetJobsApp.win);
        }
        return;
      }
      super.popScene();
    }

    terminate() {
      if (!this._isAppMode) super.terminate();
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

    createUIJobOffersDOM() {
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
        const parent = document.getElementById('job-offers-content');
        if (parent) {
          parent.appendChild(this._dndContainer);
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
      document.body.appendChild(this._dndContainer);
    }

    refreshUIJobOffersDOM() {
      if (!this._dndContainer) return;

      const useItalian = ConfigManager.language === 'it';
      const jobs = this._jobListWindow ? this._jobListWindow._data : [];
      const selectedIndex = this._jobListWindow ? this._jobListWindow.index() : 0;
      const selectedJob = jobs[selectedIndex] || null;

      const actors = $gameParty.members();
      const selectedActorIndex = this._dndActorIndex;
      const selectedActor = actors[selectedActorIndex] || actors[0];

      let leftPageHTML = "";
      let rightPageHTML = "";

      if (this._dndFocusSection === 'list') {
        leftPageHTML = this.getJobsOffersBoardHTML(jobs, selectedIndex);
        rightPageHTML = this.getJobOfferContractHTML(selectedJob, selectedActor);
      } else {
        leftPageHTML = this.getJobOfferContractHTML(selectedJob, selectedActor);
        rightPageHTML = this.getActorSelectionHTML(actors, selectedActorIndex, selectedJob);
      }

      const spreadWidth = this._isAppMode ? "100%" : "1400px";
      const spreadHeight = this._isAppMode ? "100%" : "900px";

      if (this._isAppMode) {
        this._dndContainer.innerHTML = `
          <div class="cc-pockets-spread" style="width: 100%; height: 100%;">
            <!-- Left Page -->
            <div class="cc-page cc-page-left">
              ${leftPageHTML}
            </div>

            <!-- Right Page -->
            <div class="cc-page cc-page-right">
              ${rightPageHTML}
            </div>
          </div>
        `;
      } else {
        this._dndContainer.innerHTML = `
          <div class="cc-pockets-spread" style="width: ${spreadWidth}; height: ${spreadHeight};">
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
      }

      // Scroll selected list items into view
      setTimeout(() => {
        if (this._dndContainer) {
          const listEl = this._dndContainer.querySelector('#jobs-list');
          if (listEl) {
            const selectedEl = listEl.querySelector(this._isAppMode ? '.selected' : '[style*="background: rgba(74, 29, 15, 0.08)"]');
            if (selectedEl) {
              selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }

          const rosterEl = this._dndContainer.querySelector('#roster-list');
          if (rosterEl) {
            const selectedEl = rosterEl.querySelector(this._isAppMode ? '.selected' : '[style*="border: 2px solid #4a1d0f"]');
            if (selectedEl) {
              selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      }, 50);
    }

    getJobsOffersBoardHTML(jobs, selectedIndex) {
      const useItalian = ConfigManager.language === 'it';
      const title =T('WorkSystem.jobBoardOffers');
      // In OS app mode the active RMMZ scene is Scene_HypernetOS (no job handlers),
      // so inline onclicks must target the live app instance instead.
      const sref = this._isAppMode ? 'window.HypernetJobsApp.appInstance' : 'SceneManager._scene';

      if (this._isAppMode) {
        let listHTML = "";
        if (jobs.length === 0) {
          listHTML = `
              <div style="text-align:center; padding: 40px; font-style:italic; color:#666;">
                ${T('WorkSystem.noJobOffersCurrentlyAvailable')}
              </div>
            `;
        } else {
          jobs.forEach((job, idx) => {
            const isSelected = idx === selectedIndex && this._dndFocusSection === 'list';
            const jobName = useItalian && job.name_it ? job.name_it : job.name;
            const hourlyPay = Math.round(job.basePay / job.duration);

            listHTML += `
                <div class="job-item ${isSelected ? 'selected' : ''}" onclick="${sref}.selectJobItem(${idx})">  <!-- i18n-ignore  inline handler -->
                  <div style="display:flex; flex-direction:column; gap:2px;">
                    <span style="font-size:12px; font-weight:bold; color:#000;">
                      ${jobName}
                    </span>
                    <span style="font-size:10px; color:#555;">
                      ${job.category} • ${job.duration}h
                    </span>
                  </div>
                  <div style="display:flex; flex-direction:column; align-items:flex-end;">
                    <span style="font-size:12px; font-weight:bold; color:#0054e3;">
                      ${(hourlyPay / 100).toFixed(2)}€/hr
                    </span>
                  </div>
                </div>
              `;
          });
        }

        return `
            <h2 class="cc-header-gothic">
              ${title}
            </h2>
            <div id="jobs-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:4px; padding-right:4px;">
              ${listHTML}
            </div>
            <div style="margin-top:auto; border-top:1px solid #7f9db9; padding-top:8px; display:flex; justify-content:flex-end; align-items:center; font-size:11px; color:#555; width:100%;">
              <div class="back-button focusable" onclick="${sref}.popScene()" style="padding:4px 12px; cursor:pointer;">
                ${T('WorkSystem.dismiss')}
              </div>
            </div>
          `;
      }

      let listHTML = "";
      if (jobs.length === 0) {
        listHTML = `
            <div style="text-align:center; padding: 40px; font-style:italic; color:#6b5242; font-family:'Lora', serif;">
              ${T('WorkSystem.noJobOffersCurrentlyAvailable')}
            </div>
          `;
      } else {
        jobs.forEach((job, idx) => {
          const isSelected = idx === selectedIndex && this._dndFocusSection === 'list';
          const jobName = useItalian && job.name_it ? job.name_it : job.name;
          const hourlyPay = Math.round(job.basePay / job.duration);

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
              <div class="job-item" style="${itemStyle}" onclick="${sref}.selectJobItem(${idx})">
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
                    ${(hourlyPay / 100).toFixed(2)}€/hr
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
            <div class="back-button focusable" onclick="${sref}.popScene()" style="background:#8b5a2b; color:#ecdcb9; padding:6px 16px; border-radius:4px; font-weight:bold; cursor:pointer; transition:all 0.2s ease; border:1px solid #4a2711; text-transform:uppercase; font-family:'Lora', serif; font-size:0.9rem;">
              ${T('WorkSystem.dismiss')}
            </div>
          </div>
        `;
    }

    getLocationName(mapId) {
      return locationLabel(mapId);
    }

    getJobOfferContractHTML(job, actor) {
      const useItalian = ConfigManager.language === 'it';
      if (!job) {
        if (this._isAppMode) {
          return `
              <div style="display:flex; justify-content:center; align-items:center; flex:1; height:100%; text-align:center; font-style:italic; color:#555; border:1px dashed #7f9db9; border-radius:3px; padding:20px; font-size:11px; background:#fcfcfc;">
                ${T('WorkSystem.selectAJobOfferTo')}
              </div>
            `;
        }
        return `
            <div style="display:flex; justify-content:center; align-items:center; flex:1; height:100%; text-align:center; font-style:italic; color:#5c4b3d; font-family:'Lora', serif; font-size:1.1rem; border:2px dashed #bda881; border-radius:6px; padding:40px;">
              ${T('WorkSystem.selectAJobOfferTo')}
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

      const statKeyMapping = window.WorkSystem && window.WorkSystem.statKeyMapping ? window.WorkSystem.statKeyMapping : {};
      const _si18n = window.WorkSystem && window.WorkSystem.si18n ? window.WorkSystem.si18n : (k) => k;

      if (this._isAppMode) {
        let chanceColorXP = "#a00";
        if (chancePercent >= 70) {
          chanceColorXP = "#008000";
        } else if (chancePercent >= 40) {
          chanceColorXP = "#b85c00";
        }

        let requirementsHTML = "";
        for (const [stat, required] of Object.entries(job.requirements)) {
          const actorValue = window.WorkSystem.getActorStat(actor, stat);
          const meetsReq = actorValue >= required;
          const mappedName = statKeyMapping[stat] || stat;
          const statLabel = _si18n(mappedName);

          requirementsHTML += `
              <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:2px; color:${meetsReq ? '#008000' : '#a00'}; font-weight:${meetsReq ? 'normal' : 'bold'}; font-size:11px;">
                <span>${statLabel}</span>
                <span>${actorValue} / ${required}</span>
              </div>
            `;
        }

        let locationsHTML = "";
        if (job.locations && job.locations.length > 0) {
          locationsHTML += `
              <div style="margin-top: 8px;">
                <strong style="color:#0b2f70; font-size:10px; text-transform:uppercase;">${T('WorkSystem.availableLocations')}:</strong>
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:2px;">
                  ${job.locations.map(loc => `<span style="background:#e5effa; border:1px solid #7f9db9; padding:1px 6px; border-radius:2px; font-size:10px; color:#0b2f70;">${this.getLocationName(loc)}</span>`).join('')}
                </div>
              </div>
            `;
        }

        let factionHTML = "";
        if (job.factionId !== undefined && job.factionId !== null) {
          const factionName = this._detailWindow.getFactionName(job.factionId);
          factionHTML = `
              <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:2px; font-size:11px;">
                <strong style="color:#333;">${T('WorkSystem.faction')}:</strong>
                <span style="color:#0054e3; font-weight:bold;">${factionName}</span>
              </div>
            `;
        }

        return `
            <h2 class="cc-header-gothic" style="text-align:center;">
              ${T('WorkSystem.proposalContract')}
            </h2>

            <div style="flex:1; display:flex; flex-direction:column; gap:8px; box-sizing: border-box; width:100%; min-height:0; overflow-y:auto; padding-right:2px;">
              <div style="border: 1px solid #7f9db9; background: #fcfcfc; padding: 12px; border-radius: 3px; display:flex; flex-direction:column; gap:8px; box-sizing: border-box; width:100%;">
                <div style="font-size:13px; color:#0b2f70; font-weight:bold; border-bottom:1px solid #7f9db9; padding-bottom:4px; text-align:center; text-transform:uppercase;">
                  ${jobName}
                </div>

                <div style="font-size:11px; font-style:italic; line-height:1.35; color:#444; border-bottom:1px dashed #ccc; padding-bottom:6px; margin-bottom:4px; text-align:justify;">
                  "${description}"
                </div>

                <div style="display:flex; flex-direction:column; gap:4px; font-size:11px;">
                  <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:2px;">
                    <strong style="color:#333;">${T('WorkSystem.categoryLabel')}:</strong>
                    <span>${job.category}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:2px;">
                    <strong style="color:#333;">${T('WorkSystem.duration')}:</strong>
                    <span>${T('WorkSystem.hoursValue', { hours: job.duration })}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; border-bottom:1px dotted #ccc; padding-bottom:2px; font-weight:bold; color:#008000;">
                    <span>${T('WorkSystem.totalReward')}:</span>
                    <span>€${(job.basePay / 100).toFixed(2)}</span>
                  </div>
                  ${factionHTML}
                </div>

                ${locationsHTML}

                <div style="margin-top: 6px; border-top: 1px dashed #ccc; padding-top: 6px; display:flex; flex-direction:column; gap:4px;">
                  <strong style="color:#0b2f70; font-size:10px; text-transform:uppercase;">${T('WorkSystem.requiredStats')} (${actor.name()}):</strong>
                  <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
                    ${requirementsHTML}
                  </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; border-top:1px dashed #ccc; padding-top:6px; font-weight:bold; font-size:11px;">
                  <span style="color:#333;">${T('WorkSystem.estimatedSuccessRate')}:</span>
                  <span style="color:${chanceColorXP}; font-size:13px;">${chancePercent}%</span>
                </div>

                ${!reqCheck.meets ? `
                <div style="margin-top:6px; padding:6px; background:#fff8e8; border-left:3px solid #ff9900; border-radius:2px; font-size:10px; color:#b85c00; line-height:1.3; font-style:italic;">
                  Deficits detected! Undertaking this contract will carry higher hazards of failure and injury.
                </div>
                ` : ''}
              </div>
            </div>
          `;
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
        locationsHTML += `
            <div style="margin-top: 10px;">
              <strong style="color:#5c3516; font-size:0.85rem; text-transform:uppercase;">${T('WorkSystem.availableLocations')}:</strong>
              <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
                ${job.locations.map(loc => `<span style="background:rgba(139,90,43,0.1); border:1px solid rgba(139,90,43,0.2); padding:2px 8px; border-radius:3px; font-size:0.75rem; color:#4a1d0f;">${this.getLocationName(loc)}</span>`).join('')}
              </div>
            </div>
          `;
      }

      let factionHTML = "";
      if (job.factionId !== undefined && job.factionId !== null) {
        const factionName = this._detailWindow.getFactionName(job.factionId);
        factionHTML = `
            <div style="display:flex; justify-content:space-between; border-bottom:1px dotted rgba(139,90,43,0.15); padding-bottom:4px;">
              <strong style="color:#5c3516;">${T('WorkSystem.faction')}:</strong>
              <span style="color:#8b5a2b; font-weight:bold;">${factionName}</span>
            </div>
          `;
      }

      return `
          <h2 class="cc-header-gothic" style="font-size:1.85rem; margin-bottom:16px; text-align:center;">
            ${T('WorkSystem.proposalContract')}
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
                  <span>${T('WorkSystem.totalReward')}:</span>
                  <span>€${(job.basePay / 100).toFixed(2)}</span>
                </div>
                ${factionHTML}
              </div>

              ${locationsHTML}

              <div style="margin-top: 10px; border-top: 1px dashed rgba(139,90,43,0.25); padding-top: 10px; display:flex; flex-direction:column; gap:6px;">
                <strong style="color:#5c3516; font-size:0.85rem; text-transform:uppercase;">${T('WorkSystem.requiredStats')} (${actor.name()}):</strong>
                <div style="display:flex; flex-direction:column; gap:4px; margin-top:2px;">
                  ${requirementsHTML}
                </div>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; border-top:1px dashed rgba(139,90,43,0.25); padding-top:10px; font-weight:bold; font-size:1rem;">
                <span style="color:#5c3516;">${T('WorkSystem.estimatedSuccessRate')}:</span>
                <span style="color:${chanceColor}; font-family:'Lora', serif; font-size:1.15rem;">${chancePercent}%</span>
              </div>

              ${!reqCheck.meets ? `
              <div style="margin-top:8px; padding:8px 12px; background:rgba(130,45,45,0.06); border-left:3px solid #822d2d; border-radius:3px; font-size:0.78rem; color:#822d2d; line-height:1.35; font-style:italic;">
                Deficits detected! Undertaking this contract will carry higher hazards of failure and injury.
              </div>
              ` : ''}
            </div>
          </div>
        `;
    }

    getActorFaceHTML(actor, size = 64) {
      const faceName = actor.faceName();
      const borderCSS = this._isAppMode ? "2px solid #7f9db9" : "2px solid #8b5a2b";
      const bgCSS = this._isAppMode ? "#0054e3" : "#8b5a2b";
      const textCSS = this._isAppMode ? "#fff" : "#ecdcb9";

      if (!faceName) {
        return `<div style="width:${size}px; height:${size}px; border-radius:50%; background:${bgCSS}; color:${textCSS}; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:bold;">${actor.name().charAt(0)}</div>`;
      }

      return `
          <div style="
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            border: ${borderCSS};
            box-sizing: border-box;
            background-image: url('img/busts/${faceName}.png');
            background-position: 50% 12%;
            background-size: 220%;
            background-repeat: no-repeat;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
            flex-shrink: 0;
          "></div>
        `;
    }

    getActorRequirementDetailHTML(actor, job) {
      const statKeyMapping = window.WorkSystem && window.WorkSystem.statKeyMapping ? window.WorkSystem.statKeyMapping : {};
      const _si18n = window.WorkSystem && window.WorkSystem.si18n ? window.WorkSystem.si18n : (k) => k;

      let html = "";
      for (const [stat, required] of Object.entries(job.requirements)) {
        const actorValue = window.WorkSystem.getActorStat(actor, stat);
        const isMet = actorValue >= required;
        const mappedName = statKeyMapping[stat] || stat;
        const statLabel = _si18n(mappedName);

        const color = this._isAppMode 
          ? (isMet ? '#008000' : '#a00') 
          : (isMet ? '#3d5e4b' : '#822d2d');

        html += `
            <div style="display:flex; justify-content:space-between; font-size:10px; color:${color}; font-weight:${isMet ? 'normal' : 'bold'}; border-bottom:1px dotted rgba(0,0,0,0.05); padding:1px 0;">
              <span>${statLabel}</span>
              <span>${actorValue} / ${required}</span>
            </div>
          `;
      }
      return html;
    }

    getActorSelectionHTML(actors, selectedActorIndex, selectedJob) {
      const useItalian = ConfigManager.language === 'it';
      const sref = this._isAppMode ? 'window.HypernetJobsApp.appInstance' : 'SceneManager._scene';

      if (this._isAppMode) {
        let listHTML = "";
        actors.forEach((actor, idx) => {
          const isSelected = idx === selectedActorIndex;
          const isFocused = isSelected && this._dndFocusSection === 'actors';

          const successChance = window.WorkSystem.calculateSuccessChance(actor, selectedJob);
          const chancePercent = Math.floor(successChance * 100);
          let chanceColor = "#a00";
          if (chancePercent >= 70) {
            chanceColor = "#008000";
          } else if (chancePercent >= 40) {
            chanceColor = "#b85c00";
          }

          listHTML += `
              <div class="roster-item focusable ${isSelected ? 'selected' : ''}" onclick="${sref}.selectActorItem(${idx})">  <!-- i18n-ignore  inline handler -->
                ${this.getActorFaceHTML(actor, 44)}
                <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="font-size:11px; color:#000;">
                      ${actor.name()}
                    </strong>
                    <span style="font-size:10px; font-weight:bold; color:${chanceColor};">
                      ${chancePercent}% SUCCESS
                    </span>
                  </div>
                  <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-top:2px;">
                    ${this.getActorRequirementDetailHTML(actor, selectedJob)}
                  </div>
                </div>
              </div>
            `;
        });

        return `
            <h2 class="cc-header-gothic">
              ${T('WorkSystem.candidateRoster')}
            </h2>

            <div id="roster-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; padding-right:4px;">
              ${listHTML}
            </div>

            <div style="margin-top:8px; border-top:1px solid #7f9db9; padding-top:8px; display:flex; flex-direction:column; gap:4px; box-sizing:border-box; width:100%;">
              <div class="action-button focusable" onclick="${sref}.confirmActorSelection()" style="width:100%;">
                ${T('WorkSystem.acceptJobOffer')}
              </div>
              
              <div class="action-button focusable" onclick="${sref}.retractActorSelection()" style="background:#e1e1e1 !important; color:#000 !important; border-color:#7f9db9 !important; width:100%;">
                ${T('WorkSystem.retractCandidate')}
              </div>
            </div>
          `;
      }

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
            <div class="roster-item focusable" style="${cardStyle}" onclick="${sref}.selectActorItem(${idx})">
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
            ${T('WorkSystem.candidateRoster')}
          </h2>

          <div id="roster-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; padding-right:4px;">
            ${listHTML}
          </div>

          <div style="margin-top:12px; border-top:1px dashed rgba(139, 90, 43, 0.4); padding-top:12px; display:flex; flex-direction:column; gap:8px; box-sizing:border-box; width:100%;">
            <div class="action-button focusable" onclick="${sref}.confirmActorSelection()" style="background:#4a1d0f; color:#ecdcb9; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer; text-align:center; border:2px solid #301107; text-transform:uppercase; font-family:'Lora', serif; font-size:1.05rem; box-shadow:0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
              ${T('WorkSystem.acceptJobOffer')}
            </div>
            
            <div class="action-button focusable" onclick="${sref}.retractActorSelection()" style="background:#8b5a2b; color:#ecdcb9; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer; text-align:center; border:1px solid #4a2711; text-transform:uppercase; font-family:'Lora', serif; font-size:0.9rem; transition: all 0.2s ease;">
              ${T('WorkSystem.retractCandidate')}
            </div>
          </div>
        `;
    }

    selectJobItem(index) {
      if (this._jobListWindow) {
        this._jobListWindow.select(index);
        this._dndFocusSection = 'list';
        SoundManager.playOk();
        this.refreshUIJobOffersDOM();
      }
    }

    selectActorItem(index) {
      this._dndActorIndex = index;
      this._dndFocusSection = 'actors';
      SoundManager.playOk();
      this.refreshUIJobOffersDOM();
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
      this.refreshUIJobOffersDOM();
    }

    update() {
      // In OS app mode the Scene_HypernetOS focus ring drives keyboard/controller
      // navigation (job items, roster cards and buttons are all .focusable), so the
      // scene must stay out of the input loop to avoid double-processing.
      if (this._isAppMode) return;

      super.update();

      if (this._dndContainer) {
        let moved = false;
        const job = this._jobListWindow ? this._jobListWindow.currentJob() : null;

        if (this._dndFocusSection === 'list') {
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
          } else if (Input.isTriggered('left') || this.isKeyPressed('KeyA')) {
            this._dndFocusSection = 'list';
            moved = true;
            SoundManager.playCancel();
          } else if (Input.isTriggered('ok')) {
            this.confirmActorSelection();
          }
        }

        if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
          if (this._dndFocusSection === 'actors') {
            this.retractActorSelection();
          } else {
            SoundManager.playCancel();
            this.popScene();
          }
        }

        if (moved) {
          this.refreshUIJobOffersDOM();
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

  //=============================================================================
  // Window_JobOffersList - Job list window
  //=============================================================================

  class Window_JobOffersList extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._data = [];
      this._detailWindow = null;
      this.refresh();
    }

    maxCols() {
      return 1;
    }

    maxItems() {
      return this._data ? this._data.length : 0;
    }

    setDetailWindow(window) {
      this._detailWindow = window;
      this.updateDetailWindow();
    }

    currentJob() {
      return this._data[this.index()];
    }

    makeItemList() {
      // A job offer is somebody hiring. There is nobody left to hire anyone in
      // an empty world, so the board is bare rather than re-shuffled every
      // time it is opened. See WorldManager.populationMode.
      const WM = window.WorldManager;
      if (WM && typeof WM.isEmptyWorld === "function" && WM.isEmptyWorld()) return [];
      if (!window.WorkSystem || !window.WorkSystem.Jobs) {
        console.error("WorkSystem.Jobs not loaded!");
        return [];
      }

      const allJobs = window.WorkSystem.Jobs;
      const shuffled = [...allJobs].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, numberOfJobs);
    }

    refresh() {
      this._data = this.makeItemList();
      super.refresh();
    }

    drawItem(index) {
      const job = this._data[index];
      if (!job) return;

      const rect = this.itemLineRect(index);
      const language = ConfigManager.language || 'en';
      const jobName = language === 'it' ? job.name_it : job.name;
      const hourlyPay = Math.round(job.basePay / job.duration);

      // Draw job name
      this.changeTextColor(ColorManager.systemColor());
      this.drawText(jobName, rect.x, rect.y, rect.width - 150);

      // Draw duration and hourly pay
      this.changeTextColor(ColorManager.normalColor());
      const payText = `${(hourlyPay / 100).toFixed(2)}€/hr`;
      const durationText = `${job.duration}h`;
      const infoText = `${durationText} | ${payText}`;
      this.drawText(infoText, rect.x + rect.width - 150, rect.y, 150, 'right');
    }

    select(index) {
      super.select(index);
      this.updateDetailWindow();
    }

    updateDetailWindow() {
      if (this._detailWindow) {
        const job = this.currentJob();
        this._detailWindow.setJob(job);
      }
    }
  }

  //=============================================================================
  // Window_JobDetails - Combined detail display window
  //=============================================================================

  class Window_JobDetails extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this._job = null;
    }

    setJob(job) {
      if (this._job !== job) {
        this._job = job;
        this.refresh();
      }
    }

    refresh() {
      this.contents.clear();
      if (!this._job) return;

      const language = ConfigManager.language || 'en';
      const lineHeight = this.lineHeight();
      let y = 0;

      // Job description
      this.changeTextColor(ColorManager.systemColor());
      const descLabel =T('WorkSystem.description');
      this.drawText(descLabel, 0, y, this.contentsWidth());
      y += lineHeight;

      this.changeTextColor(ColorManager.normalColor());
      const description = language === 'it' ? this._job.description_it : this._job.description;
      const wrappedDesc = this.wrapText(description, this.contentsWidth());
      for (const line of wrappedDesc) {
        this.drawText(line, 0, y, this.contentsWidth());
        y += lineHeight;
      }

      // Total pay
      y += 5;
      this.changeTextColor(ColorManager.systemColor());
      const totalPayLabel =T('WorkSystem.totalPay');
      this.drawText(`${totalPayLabel}: `, 0, y, 200);
      this.changeTextColor(ColorManager.normalColor());
      this.drawText(`${(this._job.basePay / 100).toFixed(2)}€`, 200, y, this.contentsWidth() - 200);
      y += lineHeight;

      // Faction info if applicable
      if (this._job.factionId !== undefined && this._job.factionId !== null) {
        this.changeTextColor(ColorManager.systemColor());
        const factionLabel =T('WorkSystem.faction');
        this.drawText(`${factionLabel}:`, 0, y, 200);
        this.changeTextColor(ColorManager.textColor(17)); // Purple/special color
        const factionName = this.getFactionName(this._job.factionId);
        this.drawText(factionName, 200, y, this.contentsWidth() - 200);
        y += lineHeight;
      }

      y += 10;

      // Divide into two columns for locations and requirements
      const columnWidth = Math.floor(this.contentsWidth() / 2);
      const leftX = 0;
      const rightX = columnWidth + 20;
      const startY = y;

      // Left column: Locations
      y = startY;
      this.changeTextColor(ColorManager.systemColor());
      const locationsLabel =T('WorkSystem.availableLocations');
      this.drawText(locationsLabel, leftX, y, columnWidth);
      y += lineHeight;

      this.changeTextColor(ColorManager.normalColor());
      if (!this._job.locations || this._job.locations.length === 0) {
        const unknownText =T('WorkSystem.unknown');
        this.drawText(unknownText, leftX + 10, y, columnWidth - 10);
      } else {
        for (const location of this._job.locations) {
          this.drawText('• ' + this.getLocationName(location), leftX + 10, y, columnWidth - 10);
          y += lineHeight;
        }
      }

      // Right column: Requirements
      y = startY;
      this.changeTextColor(ColorManager.systemColor());
      const reqText =T('WorkSystem.requirements');
      this.drawText(reqText, rightX, y, columnWidth);
      y += lineHeight;

      const requirements = this._job.requirements;
      const actor = $gameParty.leader();

      for (const [stat, value] of Object.entries(requirements)) {
        let actorValue = this.getActorStat(actor, stat);
        const meetsReq = actorValue >= value;

        this.changeTextColor(meetsReq ? ColorManager.normalColor() : ColorManager.deathColor());

        const mappedStat = window.WorkSystem && window.WorkSystem.statKeyMapping ? window.WorkSystem.statKeyMapping[stat] : stat;
        const translatedStat = window.WorkSystem && window.WorkSystem.si18n ? window.WorkSystem.si18n(mappedStat) : stat;

        this.drawText(`${translatedStat}: ${value} (${actorValue})`, rightX + 10, y, columnWidth - 10);
        y += lineHeight;
      }
    }

    wrapText(text, maxWidth) {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = this.textWidth(testLine);

        if (testWidth > maxWidth && currentLine) {
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

    getLocationName(mapId) {
      return locationLabel(mapId);
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

  // Export windows for external use
  window.Scene_JobOffers = Scene_JobOffers;
  window.Window_JobOffersList = Window_JobOffersList;
  window.Window_JobDetails = Window_JobDetails;

  console.log('WorkSystemJobOffers loaded');

})();
