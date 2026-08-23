/*:
 * @target MZ
 * @plugindesc 3D Political Graph v1.1.0 — Interactive 3D Political Compass with Character Creation Gold UI Theme
 * @author Antigravity
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Political Graph Plugin v1.1.0 (Character Creation Theme Update)
 * ============================================================================
 * Displays a 3D Political Cube featuring:
 *   - X-Axis (Economic): Left (-100) <---> Right (+100)
 *   - Y-Axis (Authoritarian): Libertarian (-100) <---> Authoritarian (+100)
 *   - Z-Axis (Esoteric): Mundane / Rational (-100) <---> Magic / Occult (+100)
 *
 * Plotting all 228 ideologies from js/db/WorldGen/Ideology.json in interactive
 * 3D space styled matching the Character Creation parchment & gold UI palette.
 */

(() => {
  'use strict';

  const PLUGIN_NAME = '3DPoliticalGraph';

  // ==========================================================================
  // Public Namespace & API
  // ==========================================================================
  window.PoliticalGraph3D = {
    open(options = {}) {
      if (SceneManager._scene instanceof Scene_3DPoliticalGraph) {
        SceneManager._scene.configure(options);
        return;
      }
      Scene_3DPoliticalGraph.initialOptions = options;
      SceneManager.push(Scene_3DPoliticalGraph);
    },
    openModal(options = {}) {
      this.open(Object.assign({ isModal: true }, options));
    },
    close() {
      if (SceneManager._scene instanceof Scene_3DPoliticalGraph) {
        SceneManager.pop();
      }
    },
    getScores(ideologyId) {
      const list = window.PoliticalGraph3D.getIdeologyData();
      return list.find(item => item.id === ideologyId) || null;
    },
    getAllScores() {
      return window.PoliticalGraph3D.getIdeologyData();
    },
    getIdeologyData() {
      if (window.WorldGen && Array.isArray(window.WorldGen.Ideology)) {
        return window.WorldGen.Ideology;
      }
      return [];
    }
  };

  window.Political3DGraph = window.PoliticalGraph3D;

  if (typeof PluginManager !== 'undefined' && PluginManager.registerCommand) {
    PluginManager.registerCommand(PLUGIN_NAME, 'Open3DPoliticalGraph', args => {
      const focusId = args ? args.focusId : '';
      window.PoliticalGraph3D.open({ focusId });
    });

    PluginManager.registerCommand(PLUGIN_NAME, 'FocusIdeology', args => {
      const ideologyId = args ? args.ideologyId : 'center_left_technocrat';
      window.PoliticalGraph3D.open({ focusId: ideologyId });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'P' || e.key === 'p') {
      if (SceneManager._scene instanceof Scene_Map && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const activeElem = document.activeElement;
        if (activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'TEXTAREA')) return;
        window.PoliticalGraph3D.open();
      }
    }
  });

  // ==========================================================================
  // Scene_3DPoliticalGraph Implementation
  // ==========================================================================
  class Scene_3DPoliticalGraph extends Scene_MenuBase {
    initialize() {
      super.initialize();
      this.configure(Scene_3DPoliticalGraph.initialOptions || {});
      Scene_3DPoliticalGraph.initialOptions = null;
      this._ideologies = [];
      this._filteredIdeologies = [];
      this._selectedIdeology = null;
      this._hoveredIdeology = null;

      // 3D Orbit Camera State
      this._rotX = 0.42;
      this._rotY = -0.75;
      this._zoom = 1.0;
      this._autoRotate = false;

      // Interaction State
      this._isDragging = false;
      this._lastMouseX = 0;
      this._lastMouseY = 0;

      // Filters
      this._searchQuery = '';
      this._filterQuadrant = 'ALL';
    }

    configure(options) {
      this._options = options || {};
      this._onSelectCallback = this._options.onSelect || null;
      this._isModal = !!this._options.isModal || !!this._onSelectCallback;
    }

    create() {
      super.create();
      this.createBackground();
      this.loadIdeologyData();
      this.createDOMOverlay();
      this.createCanvas3D();
      this.applyInitialFocus();
    }

    loadIdeologyData() {
      this._ideologies = window.PoliticalGraph3D.getIdeologyData();
      if (!this._ideologies || this._ideologies.length === 0) {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'js/db/WorldGen/Ideology.json', false);
          xhr.send();
          if (xhr.status === 200) {
            this._ideologies = JSON.parse(xhr.responseText);
          }
        } catch (e) {
          console.warn('[3DPoliticalGraph] Could not load Ideology.json fallback:', e);
        }
      }
      this.applyFilters();
    }

    applyFilters() {
      const q = this._searchQuery.toLowerCase().trim();
      this._filteredIdeologies = this._ideologies.filter(item => {
        if (!item || !item.axes) return false;

        if (q.length > 0) {
          const idMatch = item.id.toLowerCase().includes(q);
          const nameMatch = item.name && item.name.toLowerCase().includes(q);
          const localizedName = this.getLocalizedName(item).toLowerCase();
          if (!idMatch && !nameMatch && !localizedName.includes(q)) return false;
        }

        const econ = item.axes.econ || 0;
        const auth = item.axes.auth || 0;
        const myst = item.axes.myst !== undefined ? item.axes.myst : (item.axes.esoteric || 0);

        switch (this._filterQuadrant) {
          case 'AUTH_LEFT': return econ <= 0 && auth >= 0;
          case 'AUTH_RIGHT': return econ >= 0 && auth >= 0;
          case 'LIB_LEFT': return econ <= 0 && auth <= 0;
          case 'LIB_RIGHT': return econ >= 0 && auth <= 0;
          case 'MAGIC': return myst >= 25;
          case 'MUNDANE': return myst <= -25;
          default: return true;
        }
      });
    }

    getLocalizedName(item) {
      if (!item) return '';
      if (typeof window.i18n === 'function') {
        const loc = window.i18n(item.name || `ideology.${item.id}`);
        if (loc && !loc.startsWith('ideology.')) return loc;
      }
      return item.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    applyInitialFocus() {
      if (this._options && this._options.focusId) {
        const found = this._ideologies.find(i => i.id === this._options.focusId);
        if (found) {
          this.selectIdeology(found);
        }
      }
      if (!this._selectedIdeology && this._filteredIdeologies.length > 0) {
        this.selectIdeology(this._filteredIdeologies[0]);
      }
    }

    selectIdeology(item) {
      this._selectedIdeology = item;
      this.updateDetailPanel();
    }

    confirmSelection() {
      if (this._selectedIdeology && typeof this._onSelectCallback === 'function') {
        this._onSelectCallback(this._selectedIdeology.id, this._selectedIdeology);
      }
      SceneManager.pop();
    }

    // ==========================================================================
    // DOM UI Overlay Construction (Character Creation Theme: Gold & Dark Parchment)
    // ==========================================================================
    createDOMOverlay() {
      this._overlay = document.createElement('div');
      this._overlay.id = 'political-graph-3d-overlay';
      this._overlay.style.cssText = `
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        color: #f0e6d2;
        box-sizing: border-box;
        overflow: hidden;
        user-select: none;
        z-index: 10;
      `;

      // Header Bar
      const header = document.createElement('div');
      header.style.cssText = `
        position: absolute; top: 15px; left: 20px; right: 20px;
        height: 56px;
        display: flex; align-items: center; justify-content: space-between;
        background: rgba(18, 14, 10, 0.94);
        border: 1px solid rgba(218, 165, 32, 0.4);
        border-radius: 8px;
        padding: 0 24px;
        pointer-events: auto;
        box-shadow: 0 4px 25px rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(12px);
      `;
      header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px;">
          <span style="font-size: 26px;">🌌</span>
          <span style="font-size: 22px; font-weight: 700; color: #f5d061; letter-spacing: 1.2px; text-transform: uppercase; font-family: Georgia, serif;">
            3D Political Graph
          </span>
          <span style="font-size: 13px; font-weight: 600; background: rgba(218, 165, 32, 0.15); color: #f5d061; padding: 4px 12px; border-radius: 14px; border: 1px solid rgba(218, 165, 32, 0.35);">
            ${this._isModal ? 'Select Ideology Mode' : 'Econ / Auth / Esoteric'}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 14px;" id="header-controls"></div>
      `;
      this._overlay.appendChild(header);

      const headerControls = header.querySelector('#header-controls');

      // Search Input
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search 228 ideologies...';
      searchInput.style.cssText = `
        background: rgba(0, 0, 0, 0.65);
        border: 1px solid rgba(218, 165, 32, 0.35);
        border-radius: 6px;
        color: #f0e6d2;
        padding: 8px 14px;
        font-size: 14px;
        width: 220px;
        outline: none;
        transition: border 0.2s;
      `;
      searchInput.addEventListener('focus', () => searchInput.style.borderColor = '#f5d061');
      searchInput.addEventListener('blur', () => searchInput.style.borderColor = 'rgba(218, 165, 32, 0.35)');
      searchInput.addEventListener('input', (e) => {
        this._searchQuery = e.target.value;
        this.applyFilters();
        this.updateIdeologyList();
      });
      headerControls.appendChild(searchInput);

      // Confirm Selection Button
      if (this._isModal) {
        const selectBtn = document.createElement('button');
        selectBtn.innerText = '✔ Select Ideology';
        selectBtn.style.cssText = `
          background: rgba(218, 165, 32, 0.3);
          border: 1px solid #f5d061;
          color: #ffffff;
          padding: 8px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 700;
          font-size: 14px;
          transition: all 0.2s;
          box-shadow: 0 0 10px rgba(218, 165, 32, 0.3);
        `;
        selectBtn.addEventListener('mouseenter', () => {
          selectBtn.style.background = 'rgba(218, 165, 32, 0.5)';
          selectBtn.style.boxShadow = '0 0 15px rgba(245, 208, 97, 0.6)';
        });
        selectBtn.addEventListener('mouseleave', () => {
          selectBtn.style.background = 'rgba(218, 165, 32, 0.3)';
          selectBtn.style.boxShadow = '0 0 10px rgba(218, 165, 32, 0.3)';
        });
        selectBtn.addEventListener('click', () => this.confirmSelection());
        headerControls.appendChild(selectBtn);
      }

      // Close Button
      const closeBtn = document.createElement('button');
      closeBtn.innerText = '✕ ESC';
      closeBtn.style.cssText = `
        background: rgba(180, 50, 50, 0.25);
        border: 1px solid rgba(235, 80, 80, 0.5);
        color: #ffaaaa;
        padding: 8px 18px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 700;
        font-size: 14px;
        transition: all 0.2s;
      `;
      closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'rgba(220, 60, 60, 0.45)');
      closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'rgba(180, 50, 50, 0.25)');
      closeBtn.addEventListener('click', () => SceneManager.pop());
      headerControls.appendChild(closeBtn);

      // Toolbar Controls Bar (Camera Presets & Filter Pills)
      const toolbar = document.createElement('div');
      toolbar.style.cssText = `
        position: absolute; top: 82px; left: 20px; right: 420px;
        display: flex; gap: 10px; align-items: center;
        pointer-events: auto;
        overflow-x: auto;
        padding-bottom: 5px;
      `;

      const cameraPresets = [
        { label: ' Isometric 3D', action: () => { this._rotX = 0.42; this._rotY = -0.75; this._zoom = 1.0; } },
        { label: ' Top (2D Compass)', action: () => { this._rotX = 1.57; this._rotY = 0; this._zoom = 1.1; } },
        { label: ' Front (Econ-Magic)', action: () => { this._rotX = 0; this._rotY = 0; this._zoom = 1.0; } },
        { label: ' Side (Auth-Magic)', action: () => { this._rotX = 0; this._rotY = 1.57; this._zoom = 1.0; } },
        { label: ' Auto-Orbit', action: (btn) => {
            this._autoRotate = !this._autoRotate;
            btn.style.borderColor = this._autoRotate ? '#f5d061' : 'rgba(218, 165, 32, 0.25)';
            btn.style.background = this._autoRotate ? 'rgba(218, 165, 32, 0.3)' : 'rgba(24, 18, 12, 0.85)';
          }
        }
      ];

      cameraPresets.forEach(preset => {
        const btn = document.createElement('button');
        btn.innerText = preset.label;
        btn.style.cssText = `
          background: rgba(24, 18, 12, 0.85);
          border: 1px solid rgba(218, 165, 32, 0.25);
          color: #e8ded0;
          padding: 7px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          transition: all 0.2s;
        `;
        btn.addEventListener('click', () => preset.action(btn));
        btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(50, 38, 25, 0.9)');
        btn.addEventListener('mouseleave', () => {
          if (preset.label.includes('Auto-Orbit') && this._autoRotate) return;
          btn.style.background = 'rgba(24, 18, 12, 0.85)';
        });
        toolbar.appendChild(btn);
      });

      const div = document.createElement('div');
      div.style.cssText = `width: 1px; height: 24px; background: rgba(218, 165, 32, 0.3); margin: 0 4px;`;
      toolbar.appendChild(div);

      const filterPills = [
        { id: 'ALL', label: 'All (228)' },
        { id: 'AUTH_LEFT', label: 'Auth-Left (Red)' },
        { id: 'AUTH_RIGHT', label: 'Auth-Right (Blue)' },
        { id: 'LIB_LEFT', label: 'Lib-Left (Green)' },
        { id: 'LIB_RIGHT', label: 'Lib-Right (Yellow)' },
        { id: 'MAGIC', label: 'High Magic 🔮' },
        { id: 'MUNDANE', label: 'High Mundane ⚙️' }
      ];

      this._pillButtons = [];
      filterPills.forEach(pill => {
        const btn = document.createElement('button');
        btn.innerText = pill.label;
        const isSelected = this._filterQuadrant === pill.id;
        btn.style.cssText = `
          background: ${isSelected ? 'rgba(218, 165, 32, 0.35)' : 'rgba(18, 14, 10, 0.7)'};
          border: 1px solid ${isSelected ? '#f5d061' : 'rgba(218, 165, 32, 0.2)'};
          color: ${isSelected ? '#fff8e0' : '#a89f91'};
          padding: 6px 12px;
          border-radius: 14px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${isSelected ? '700' : '500'};
          white-space: nowrap;
          transition: all 0.2s;
        `;
        btn.addEventListener('click', () => {
          this._filterQuadrant = pill.id;
          this._pillButtons.forEach(b => {
            b.btn.style.background = 'rgba(18, 14, 10, 0.7)';
            b.btn.style.borderColor = 'rgba(218, 165, 32, 0.2)';
            b.btn.style.color = '#a89f91';
            b.btn.style.fontWeight = '500';
          });
          btn.style.background = 'rgba(218, 165, 32, 0.35)';
          btn.style.borderColor = '#f5d061';
          btn.style.color = '#fff8e0';
          btn.style.fontWeight = '700';
          this.applyFilters();
          this.updateIdeologyList();
        });
        toolbar.appendChild(btn);
        this._pillButtons.push({ id: pill.id, btn });
      });

      this._overlay.appendChild(toolbar);

      // Sidebar Container (Expanded width: 380px with larger fonts)
      const sidebar = document.createElement('div');
      sidebar.id = 'political-graph-sidebar';
      sidebar.style.cssText = `
        position: absolute; top: 82px; right: 20px; bottom: 20px;
        width: 380px;
        background: rgba(18, 14, 10, 0.94);
        border: 1px solid rgba(218, 165, 32, 0.35);
        border-radius: 8px;
        display: flex; flex-direction: column;
        pointer-events: auto;
        box-shadow: 0 4px 25px rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(12px);
        overflow: hidden;
      `;
      sidebar.innerHTML = `
        <div style="padding: 18px; border-bottom: 1px solid rgba(218, 165, 32, 0.2); background: rgba(218, 165, 32, 0.05);">
          <div id="sidebar-title" style="font-size: 20px; font-weight: 700; color: #f5d061; font-family: Georgia, serif; margin-bottom: 4px;">Select an Ideology</div>
          <div id="sidebar-subtitle" style="font-size: 13px; color: #a89f91;">Click any 3D node or list item</div>
        </div>
        <div id="sidebar-details" style="padding: 18px; flex-shrink: 0; border-bottom: 1px solid rgba(218, 165, 32, 0.2); font-size: 14px;"></div>
        <div style="padding: 10px 18px; background: rgba(0,0,0,0.3); font-size: 12px; font-weight: 700; color: #cda851; text-transform: uppercase; letter-spacing: 1.2px;">
          Ideologies (<span id="filtered-count">0</span>)
        </div>
        <div id="sidebar-list" style="flex: 1; overflow-y: auto; padding: 10px;"></div>
      `;
      this._overlay.appendChild(sidebar);

      document.body.appendChild(this._overlay);
      this.updateIdeologyList();
      this.updateDetailPanel();
    }

    updateIdeologyList() {
      const listContainer = document.getElementById('sidebar-list');
      const countSpan = document.getElementById('filtered-count');
      if (!listContainer) return;

      if (countSpan) countSpan.innerText = this._filteredIdeologies.length;
      listContainer.innerHTML = '';

      this._filteredIdeologies.forEach(item => {
        const name = this.getLocalizedName(item);
        const row = document.createElement('div');
        const isSelected = this._selectedIdeology && this._selectedIdeology.id === item.id;

        const myst = item.axes.myst !== undefined ? item.axes.myst : (item.axes.esoteric || 0);
        let esotericTag = myst > 25 ? '🔮 Magic' : myst < -25 ? '⚙️ Mundane' : '☯️ Neutral';

        row.style.cssText = `
          padding: 10px 14px;
          margin-bottom: 6px;
          border-radius: 6px;
          background: ${isSelected ? 'rgba(218, 165, 32, 0.25)' : 'rgba(255, 255, 255, 0.03)'};
          border: 1px solid ${isSelected ? '#f5d061' : 'rgba(218, 165, 32, 0.1)'};
          cursor: pointer;
          display: flex; justify-content: space-between; align-items: center;
          transition: background 0.15s;
        `;
        row.innerHTML = `
          <div>
            <div style="font-size: 14px; font-weight: 600; color: ${isSelected ? '#ffffff' : '#f0e6d2'}; margin-bottom: 2px;">${name}</div>
            <div style="font-size: 12px; color: #a89f91;">E: ${item.axes.econ} | A: ${item.axes.auth} | Z: ${myst}</div>
          </div>
          <span style="font-size: 11px; padding: 3px 8px; border-radius: 6px; background: rgba(0,0,0,0.4); color: #f5d061; border: 1px solid rgba(218, 165, 32, 0.2);">${esotericTag}</span>
        `;
        row.addEventListener('click', () => {
          this.selectIdeology(item);
          this.updateIdeologyList();
        });
        row.addEventListener('dblclick', () => {
          this.selectIdeology(item);
          if (this._isModal) this.confirmSelection();
        });
        row.addEventListener('mouseenter', () => {
          this._hoveredIdeology = item;
          if (!isSelected) row.style.background = 'rgba(218, 165, 32, 0.12)';
        });
        row.addEventListener('mouseleave', () => {
          this._hoveredIdeology = null;
          if (!isSelected) row.style.background = 'rgba(255, 255, 255, 0.03)';
        });
        listContainer.appendChild(row);
      });
    }

    updateDetailPanel() {
      const title = document.getElementById('sidebar-title');
      const subtitle = document.getElementById('sidebar-subtitle');
      const details = document.getElementById('sidebar-details');
      if (!details || !this._selectedIdeology) return;

      const item = this._selectedIdeology;
      const name = this.getLocalizedName(item);

      const econ = item.axes.econ || 0;
      const auth = item.axes.auth || 0;
      const myst = item.axes.myst !== undefined ? item.axes.myst : (item.axes.esoteric || 0);

      let quadrantStr = '';
      if (auth >= 0 && econ < 0) quadrantStr = 'Authoritarian Left (Red)';
      else if (auth >= 0 && econ >= 0) quadrantStr = 'Authoritarian Right (Blue)';
      else if (auth < 0 && econ < 0) quadrantStr = 'Libertarian Left (Green)';
      else quadrantStr = 'Libertarian Right (Yellow)';

      let esotericStr = myst > 25 ? 'High Magic / Esoteric' : myst < -25 ? 'High Mundane / Rationalist' : 'Balanced Esoteric';

      if (title) title.innerText = name;
      if (subtitle) subtitle.innerText = `${quadrantStr} • ${esotericStr}`;

      let adherents = [];
      if (window.NPCPolitics && typeof window.NPCPolitics.getPower === 'function') {
        try {
          const powers = window.NPCPolitics.listPowers ? window.NPCPolitics.listPowers() : [];
          powers.forEach(pName => {
            const pow = window.NPCPolitics.getPower(pName);
            if (pow && pow.parties) {
              pow.parties.forEach(party => {
                if (party.creedId === item.id || party.ideology === item.id) {
                  adherents.push(`${party.name || party.id} (${pName})`);
                }
              });
            }
          });
        } catch (e) {}
      }

      let adherentsHTML = adherents.length > 0
        ? adherents.slice(0, 4).map(a => `<li style="margin-bottom: 4px;">${a}</li>`).join('')
        : `<span style="color: #a89f91; font-style: italic;">No active political parties in present session</span>`;

      const confirmBtnHTML = this._isModal ? `
        <button id="modal-confirm-btn" style="
          width: 100%; margin-top: 14px; padding: 10px;
          background: rgba(218, 165, 32, 0.35); border: 1px solid #f5d061;
          color: #ffffff; font-size: 15px; font-weight: 700; border-radius: 6px; cursor: pointer;
          box-shadow: 0 0 10px rgba(218, 165, 32, 0.3); transition: all 0.2s;
        ">Select ${name}</button>
      ` : '';

      details.innerHTML = `
        <div style="margin-bottom: 14px; font-size: 14px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: #a89f91;">Economic Axis (X):</span>
            <span style="font-weight: 700; color: ${econ < 0 ? '#ff7777' : '#77b5ff'};">${econ} (${econ < 0 ? 'Left' : 'Right'})</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: #a89f91;">Authoritarian Axis (Y):</span>
            <span style="font-weight: 700; color: ${auth >= 0 ? '#ff9955' : '#55ff99'};">${auth} (${auth >= 0 ? 'Authoritarian' : 'Libertarian'})</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: #a89f91;">Esoteric Dimension (Z):</span>
            <span style="font-weight: 700; color: ${myst > 0 ? '#d070ff' : '#00e5ff'};">${myst} (${myst > 0 ? 'Magic' : 'Mundane'})</span>
          </div>
        </div>
        <div style="background: rgba(0,0,0,0.35); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(218, 165, 32, 0.15);">
          <div style="font-size: 11px; color: #cda851; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; letter-spacing: 1px;">Known World Adherents:</div>
          <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #f0e6d2;">${adherentsHTML}</ul>
        </div>
        ${confirmBtnHTML}
      `;

      if (this._isModal) {
        const cBtn = document.getElementById('modal-confirm-btn');
        if (cBtn) cBtn.addEventListener('click', () => this.confirmSelection());
      }
    }

    createCanvas3D() {
      this._canvas = document.createElement('canvas');
      this._canvas.id = 'political-graph-3d-canvas';
      this._canvas.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        z-index: 5; pointer-events: auto;
      `;
      document.body.appendChild(this._canvas);
      this._ctx = this._canvas.getContext('2d');

      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());

      this._canvas.addEventListener('mousedown', (e) => {
        if (e.target !== this._canvas) return;
        this._isDragging = true;
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
      });

      window.addEventListener('mousemove', (e) => {
        if (!this._isDragging) {
          this.checkNodeHover(e.clientX, e.clientY);
          return;
        }
        const dx = e.clientX - this._lastMouseX;
        const dy = e.clientY - this._lastMouseY;
        this._rotY += dx * 0.008;
        this._rotX += dy * 0.008;
        this._rotX = Math.max(-1.5, Math.min(1.5, this._rotX));
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
      });

      window.addEventListener('mouseup', () => this._isDragging = false);

      this._canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) this._zoom = Math.min(2.8, this._zoom * 1.08);
        else this._zoom = Math.max(0.4, this._zoom / 1.08);
      }, { passive: false });

      this._canvas.addEventListener('click', (e) => {
        if (this._hoveredNode) {
          this.selectIdeology(this._hoveredNode);
          this.updateIdeologyList();
        }
      });
    }

    resizeCanvas() {
      if (!this._canvas) return;
      this._canvas.width = window.innerWidth;
      this._canvas.height = window.innerHeight;
    }

    update() {
      super.update();
      if (Input.isTriggered('escape') || Input.isTriggered('cancel')) {
        SceneManager.pop();
        return;
      }
      if (this._autoRotate) {
        this._rotY += 0.005;
      }
      this.render3D();
    }

    checkNodeHover(mx, my) {
      if (!this._nodeScreenPositions) return;
      let closest = null;
      let minDst = 20;

      this._nodeScreenPositions.forEach(node => {
        const dx = mx - node.sx;
        const dy = my - node.sy;
        const dst = Math.sqrt(dx * dx + dy * dy);
        if (dst < minDst) {
          minDst = dst;
          closest = node.item;
        }
      });

      if (this._hoveredIdeology !== closest) {
        this._hoveredIdeology = closest;
        this._hoveredNode = closest;
        this._canvas.style.cursor = closest ? 'pointer' : 'default';
      }
    }

    // 3D Isometric Projection Transformation (Scaled up to render BIGGER!)
    project3D(x, y, z, width, height) {
      const nx = x / 100.0;
      const ny = y / 100.0;
      const nz = z / 100.0;

      const cosY = Math.cos(this._rotY);
      const sinY = Math.sin(this._rotY);
      const x1 = nx * cosY - ny * sinY;
      const y1 = nx * sinY + ny * cosY;
      const z1 = nz;

      const cosX = Math.cos(this._rotX);
      const sinX = Math.sin(this._rotX);
      const y2 = y1 * cosX - z1 * sinX;
      const z2 = y1 * sinX + z1 * cosX;

      const cameraDistance = 3.5;
      // Increased scale factor from 0.28 to 0.46 to render the 3D graph much larger
      const scale = (width * 0.46 * this._zoom) / (cameraDistance - z2 * 0.35);

      const centerX = width * 0.38;
      const centerY = height * 0.52;

      const sx = centerX + x1 * scale;
      const sy = centerY - y2 * scale;

      return { sx, sy, depth: z2, scale };
    }

    render3D() {
      if (!this._ctx || !this._canvas) return;
      const ctx = this._ctx;
      const w = this._canvas.width;
      const h = this._canvas.height;

      // Dark parchment radial gradient background
      const bgGrad = ctx.createRadialGradient(w * 0.38, h * 0.5, w * 0.1, w * 0.38, h * 0.5, w * 0.85);
      bgGrad.addColorStop(0, '#16120e');
      bgGrad.addColorStop(1, '#0a0806');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      this.render3DCubeWireframe(ctx, w, h);

      this._nodeScreenPositions = [];
      const nodesToRender = [];

      this._filteredIdeologies.forEach(item => {
        const econ = item.axes.econ || 0;
        const auth = item.axes.auth || 0;
        const myst = item.axes.myst !== undefined ? item.axes.myst : (item.axes.esoteric || 0);

        const proj = this.project3D(econ, auth, myst, w, h);
        nodesToRender.push({ item, econ, auth, myst, ...proj });
        this._nodeScreenPositions.push({ item, sx: proj.sx, sy: proj.sy });
      });

      nodesToRender.sort((a, b) => a.depth - b.depth);

      if (this._selectedIdeology) {
        this.renderNodeLasers(ctx, this._selectedIdeology, w, h, true);
      }
      if (this._hoveredIdeology && this._hoveredIdeology !== this._selectedIdeology) {
        this.renderNodeLasers(ctx, this._hoveredIdeology, w, h, false);
      }

      nodesToRender.forEach(node => {
        const isSelected = this._selectedIdeology && this._selectedIdeology.id === node.item.id;
        const isHovered = this._hoveredIdeology && this._hoveredIdeology.id === node.item.id;

        let color = '#ffffff';
        if (node.auth >= 0 && node.econ < 0) color = '#ff5555';
        else if (node.auth >= 0 && node.econ >= 0) color = '#4488ff';
        else if (node.auth < 0 && node.econ < 0) color = '#44cc66';
        else color = '#e6b800';

        // Larger node sizes
        let radius = isSelected ? 12 * (node.scale / 160) : isHovered ? 9 * (node.scale / 160) : 6.5 * (node.scale / 160);
        radius = Math.max(3.5, Math.min(18, radius));

        ctx.beginPath();
        ctx.arc(node.sx, node.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (node.myst > 30) {
          ctx.strokeStyle = 'rgba(200, 100, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (node.myst < -30) {
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.sx, node.sy, radius + 5, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#ffffff' : '#f5d061';
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.stroke();

          // Larger Node Label Text
          ctx.font = isSelected ? 'bold 15px Georgia, serif' : 'bold 13px sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 4;
          ctx.fillText(this.getLocalizedName(node.item), node.sx + radius + 8, node.sy + 5);
          ctx.shadowBlur = 0;
        }
      });
    }

    render3DCubeWireframe(ctx, w, h) {
      const b = 100;

      const p1 = this.project3D(-b, -b, -b, w, h);
      const p2 = this.project3D(0, -b, -b, w, h);
      const p3 = this.project3D(b, -b, -b, w, h);
      const p4 = this.project3D(-b, 0, -b, w, h);
      const p5 = this.project3D(0, 0, -b, w, h);
      const p6 = this.project3D(b, 0, -b, w, h);
      const p7 = this.project3D(-b, b, -b, w, h);
      const p8 = this.project3D(0, b, -b, w, h);
      const p9 = this.project3D(b, b, -b, w, h);

      const fillQuad = (pts, color) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].sx, pts[0].sy);
        ctx.lineTo(pts[1].sx, pts[1].sy);
        ctx.lineTo(pts[2].sx, pts[2].sy);
        ctx.lineTo(pts[3].sx, pts[3].sy);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };

      fillQuad([p4, p5, p8, p7], 'rgba(235, 65, 65, 0.15)');
      fillQuad([p5, p6, p9, p8], 'rgba(65, 135, 235, 0.15)');
      fillQuad([p1, p2, p5, p4], 'rgba(65, 205, 95, 0.15)');
      fillQuad([p2, p3, p6, p5], 'rgba(235, 195, 45, 0.15)');

      const corners = [
        [-b,-b,-b], [b,-b,-b], [b,b,-b], [-b,b,-b],
        [-b,-b, b], [b,-b, b], [b,b, b], [-b,b, b]
      ];
      const projs = corners.map(c => this.project3D(c[0], c[1], c[2], w, h));

      ctx.strokeStyle = 'rgba(218, 165, 32, 0.35)';
      ctx.lineWidth = 1.5;

      const drawLoop = (indices) => {
        ctx.beginPath();
        ctx.moveTo(projs[indices[0]].sx, projs[indices[0]].sy);
        for (let i = 1; i < indices.length; i++) {
          ctx.lineTo(projs[indices[i]].sx, projs[indices[i]].sy);
        }
        ctx.closePath();
        ctx.stroke();
      };

      drawLoop([0,1,2,3]);
      drawLoop([4,5,6,7]);

      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(projs[i].sx, projs[i].sy);
        ctx.lineTo(projs[i+4].sx, projs[i+4].sy);
        ctx.stroke();
      }

      const origin = this.project3D(0, 0, 0, w, h);
      const xAxis = this.project3D(b + 20, 0, 0, w, h);
      const yAxis = this.project3D(0, b + 20, 0, w, h);
      const zAxis = this.project3D(0, 0, b + 20, w, h);

      // Axis Lines & Bigger Labels
      ctx.font = 'bold 15px Georgia, serif';

      ctx.beginPath();
      ctx.moveTo(origin.sx, origin.sy);
      ctx.lineTo(xAxis.sx, xAxis.sy);
      ctx.strokeStyle = '#70b5ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#70b5ff';
      ctx.fillText('Right (+Econ)', xAxis.sx + 6, xAxis.sy + 4);

      ctx.beginPath();
      ctx.moveTo(origin.sx, origin.sy);
      ctx.lineTo(yAxis.sx, yAxis.sy);
      ctx.strokeStyle = '#ff9955';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#ff9955';
      ctx.fillText('Auth (+Authoritarian)', yAxis.sx + 6, yAxis.sy + 4);

      ctx.beginPath();
      ctx.moveTo(origin.sx, origin.sy);
      ctx.lineTo(zAxis.sx, zAxis.sy);
      ctx.strokeStyle = '#d070ff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#d070ff';
      ctx.fillText('Magic (+Esoteric)', zAxis.sx + 6, zAxis.sy + 4);
    }

    renderNodeLasers(ctx, item, w, h, isSelected) {
      const econ = item.axes.econ || 0;
      const auth = item.axes.auth || 0;
      const myst = item.axes.myst !== undefined ? item.axes.myst : (item.axes.esoteric || 0);

      const target = this.project3D(econ, auth, myst, w, h);
      const dropPlane = this.project3D(econ, auth, -100, w, h);
      const axisPoint = this.project3D(0, 0, myst, w, h);

      ctx.save();
      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      ctx.moveTo(target.sx, target.sy);
      ctx.lineTo(dropPlane.sx, dropPlane.sy);
      ctx.strokeStyle = isSelected ? 'rgba(255, 255, 255, 0.85)' : 'rgba(245, 208, 97, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(target.sx, target.sy);
      ctx.lineTo(axisPoint.sx, axisPoint.sy);
      ctx.strokeStyle = isSelected ? 'rgba(220, 120, 255, 0.85)' : 'rgba(208, 112, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    }

    destroy() {
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      super.destroy();
    }
  }

  window.Scene_3DPoliticalGraph = Scene_3DPoliticalGraph;

})();
