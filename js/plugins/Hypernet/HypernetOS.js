/*:
 * @target MZ
 * @plugindesc v2.1.0 Simulated Esoteric Operating System (Windows XP inspired) for RPG Maker MZ.
 * @author Omni-Lex
 *
 * @help
 * HypernetOS.js
 *
 * This plugin creates a highly complex, modular, and fully functional simulated
 * Windows XP Luna-themed Operating System inside RPG Maker MZ.
 *
 * Accessibility / Input:
 *   - WASD or Arrow keys: move the focus ring between interactive elements.
 *   - Tab / Shift+Tab: cycle through interactive elements.
 *   - Enter / Space: activate the focused element.
 *   - Escape: leave a text field, then close the active window, then exit the OS.
 *   - Controller D-pad: same as WASD/Arrows. Button A: activate focus.
 *   - Controller left stick: free virtual mouse cursor. Button A: click.
 *   - Controller B: close active window / exit the OS.
 *
 * Exposes a modular API for registering apps:
 * window.HypernetOS.registerApp({ id, name, icon, launchFn, desktopShortcut })
 * 
 * @command OpenHypernetOS
 * @desc Opens the Hypernet OS desktop environment.
 * 
 * @command OpenApp
 * @desc Opens the Hypernet OS and auto-launches a specific app.
 * @arg appId
 * @type select
 * @option Browser
 * @value browser
 * @option Shop
 * @value shop
 * @desc The ID of the app to launch.
 */

(() => {
    'use strict';

    const pluginName = "HypernetOS";

    // --- Plugin Commands ---
    PluginManager.registerCommand(pluginName, "OpenHypernetOS", args => {
        SceneManager.push(Scene_HypernetOS);
    });

    PluginManager.registerCommand(pluginName, "OpenApp", args => {
        SceneManager.push(Scene_HypernetOS);
        SceneManager.prepareNextScene({ autoLaunch: args.appId });
    });

    // --- Legacy MV-style string command support ---
    const _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.call(this, command, args);
        if (command === "OpenHypernetOS") {
            SceneManager.push(Scene_HypernetOS);
        } else if (command === "OpenApp" && args[0]) {
            SceneManager.push(Scene_HypernetOS);
            SceneManager.prepareNextScene({ autoLaunch: args[0] });
        }
    };

    // --- Core HypernetOS API & Registry ---
    window.HypernetOS = {
        _apps: {},

        // The whole network went quiet on 1 January 2000 in an empty world:
        // nothing has been reported, filed, priced or measured since, so every
        // app that prints how fresh its data is prints that date. Apps ask
        // through staleDate(): it answers null in an ordinary world, which
        // means "use your own answer".
        EMPTY_WORLD_DATE: '01/01/2000',

        isEmptyWorld: function () {
            const WM = window.WorldManager;
            return !!(WM && typeof WM.isEmptyWorld === 'function' && WM.isEmptyWorld());
        },

        // The date an app should report as its last update, or null to use its
        // own. One reader, so a new app carrying a timestamp needs no rule of
        // its own to agree with the rest of the desktop.
        staleDate: function () {
            return this.isEmptyWorld() ? this.EMPTY_WORLD_DATE : null;
        },

        registerApp: function(options) {
            const { id, name, icon, launchFn, desktopShortcut = true, desktopAnchor = 'left' } = options;
            this._apps[id] = { id, name, icon, launchFn, desktopShortcut, desktopAnchor };

            // Proactively refresh desktop and start menu if scene is active
            this.refreshDesktopIcons();
            this.refreshStartMenu();
        },
        
        launchApp: function(id) {
            const app = this._apps[id];
            if (app && typeof app.launchFn === 'function') {
                try {
                    // Close start menu on launch
                    const startMenu = document.getElementById('hypernet-start-menu');
                    const startBtn = document.getElementById('hypernet-start-btn');
                    if (startMenu) startMenu.classList.remove('open');
                    if (startBtn) startBtn.classList.remove('active');
                    
                    if (window.HypernetOS.Kernel) {
                        const proc = window.HypernetOS.Kernel.spawnProcess(app.name || id, app);
                        if (!proc) return; // OOM or spawn failure
                        window.HypernetOS.currentLaunchingPid = proc.pid;
                    }

                    app.launchFn();
                    window.HypernetOS.currentLaunchingPid = null;

                    if (window.SoundManager) SoundManager.playOk();
                } catch (err) {
                    console.error(`Error launching app ${id}:`, err);
                }
            } else {
                console.warn(`App "${id}" is not registered or missing launchFn.`);
            }
        },
        
        getIconHTML: function(icon, size = 32) {
            if (typeof icon === 'number') {
                const cols = 16;
                const col = icon % cols;
                const row = Math.floor(icon / cols);
                const posX = -(col * 32);
                const posY = -(row * 32);
                return `
                    <div style="width: ${size}px; height: ${size}px; overflow: hidden; display: inline-block; position: relative; flex-shrink: 0; border-radius: 4px; vertical-align: middle; background: transparent">
                        <div style="position: absolute; top: 0; left: 0; width: 512px; height: 2048px; background-image: url('img/system/IconSet.png'); background-position: ${posX}px ${posY}px; background-repeat: no-repeat; transform: scale(${size / 32}); transform-origin: 0 0; image-rendering: pixelated"></div>
                    </div>
                `;
            }
            if (typeof icon === 'string') {
                if (icon.trim().startsWith('<')) {
                    return icon;
                }
                if (icon.match(/\.(png|jpg|jpeg|webp|gif)/i)) {
                    return `<img src="${icon}" style="width: ${size}px; height: ${size}px; display: inline-block; object-fit: contain" />`;
                }
                return `<span class="hypernet-icon-text" style="font-size: ${size * 0.7}px; line-height: ${size}px; display: inline-block; vertical-align: middle">${icon}</span>`;
            }
            return '';
        },
        
        refreshDesktopIcons: function() {
            const iconsContainer = document.getElementById('hypernet-desktop-icons-container');
            if (!iconsContainer) return;

            const grid = this.DesktopGrid;
            iconsContainer.innerHTML = '';
            grid.icons = [];

            Object.values(this._apps).forEach(app => {
                if (app.desktopShortcut === false) return;

                const iconDiv = document.createElement('div');
                iconDiv.className = 'desktop-icon';
                if (app.desktopAnchor === 'right') iconDiv.classList.add('anchored-right');
                iconDiv.title = app.name;
                iconDiv.dataset.appId = app.id;
                iconDiv.innerHTML = `
                    <div class="desktop-icon-img">${this.getIconHTML(app.icon, 72)}</div>
                    <div class="desktop-icon-text">${app.name}</div>
                `;

                // Classic double click, but single click for accessibility/RPG gameplay.
                // A drag that just ended swallows the click it would otherwise fire.
                iconDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (iconDiv._hnDragged) { iconDiv._hnDragged = false; return; }
                    this.launchApp(app.id);
                });

                grid.attachDrag(iconDiv);
                iconsContainer.appendChild(iconDiv);
                grid.icons.push({ app, el: iconDiv, cell: null });
            });

            grid.assignCells();
            grid.layout();
        },

        // --- Desktop icon grid -------------------------------------------------
        // Shortcuts sit on a fixed cell grid the player can rearrange by dragging
        // them with the mouse; each drop is remembered in the save file. The last
        // column is reserved for right-anchored apps (registerApp
        // desktopAnchor: 'right'), which keeps them on their own, away from the
        // general icon field.
        DesktopGrid: {
            CELL_W: 190,
            CELL_H: 200,
            PAD: 15,
            icons: [],
            _ghost: null,

            // Cells keep their full size while everything fits; on a small desktop
            // they shrink (and the icons go compact) rather than letting shortcuts
            // pile up in the last column.
            metrics: function() {
                const desk = document.getElementById('hypernet-os-desktop');
                const w = desk ? desk.clientWidth : window.innerWidth;
                const h = desk ? desk.clientHeight : Math.max(1, window.innerHeight - 40);
                const anchoredCount = this.icons.filter(i => i.app.desktopAnchor === 'right').length;
                const leftCount = this.icons.length - anchoredCount;
                const hasAnchored = anchoredCount > 0;

                const SCALES = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52];
                let cellW = this.CELL_W, cellH = this.CELL_H, cols = 1, rows = 1;
                for (let s = 0; s < SCALES.length; s++) {
                    cellW = Math.round(this.CELL_W * SCALES[s]);
                    cellH = Math.round(this.CELL_H * SCALES[s]);
                    cols = Math.max(hasAnchored ? 2 : 1, Math.floor((w - this.PAD * 2) / cellW));
                    rows = Math.max(1, Math.floor((h - this.PAD * 2) / cellH));
                    const leftCols = hasAnchored ? cols - 1 : cols;
                    const fits = leftCols * rows >= leftCount && (!hasAnchored || rows >= anchoredCount);
                    if (fits) break;
                }

                return {
                    w, h, cols, rows, cellW, cellH, hasAnchored,
                    reservedCol: hasAnchored ? cols - 1 : -1,
                    compact: cellW < this.CELL_W - 10
                };
            },

            // Saved positions live on $gameSystem so a rearranged desktop survives
            // saving and loading. Missing before the game objects exist (plugin
            // load time), which simply means "no saved layout yet".
            savedLayout: function() {
                if (typeof $gameSystem === 'undefined' || !$gameSystem) return null;
                if (!$gameSystem._hypernetIconLayout) $gameSystem._hypernetIconLayout = {};
                return $gameSystem._hypernetIconLayout;
            },

            isLegalCell: function(entry, cell, m) {
                if (!cell) return false;
                if (cell.c < 0 || cell.r < 0 || cell.c >= m.cols || cell.r >= m.rows) return false;
                const anchored = entry.app.desktopAnchor === 'right';
                if (m.reservedCol < 0) return true;
                return anchored ? cell.c === m.reservedCol : cell.c !== m.reservedCol;
            },

            // Honour every valid saved position first, then fill the remaining
            // icons into the first free legal cell, column by column.
            assignCells: function() {
                const m = this.metrics();
                const saved = this.savedLayout() || {};
                const taken = new Set();
                const key = (c, r) => c + ',' + r;

                this.icons.forEach(entry => { entry.cell = null; });

                this.icons.forEach(entry => {
                    const s = saved[entry.app.id];
                    if (!s) return;
                    const cell = { c: s.c, r: s.r };
                    if (!this.isLegalCell(entry, cell, m) || taken.has(key(cell.c, cell.r))) return;
                    entry.cell = cell;
                    taken.add(key(cell.c, cell.r));
                });

                this.icons.forEach(entry => {
                    if (entry.cell) return;
                    const anchored = entry.app.desktopAnchor === 'right';
                    const cols = anchored ? [m.reservedCol < 0 ? m.cols - 1 : m.reservedCol]
                                          : Array.from({ length: m.cols }, (_, i) => i)
                                                 .filter(c => c !== m.reservedCol);
                    for (const c of cols) {
                        for (let r = 0; r < m.rows; r++) {
                            if (taken.has(key(c, r))) continue;
                            entry.cell = { c, r };
                            taken.add(key(c, r));
                            return;
                        }
                    }
                    // Grid full: stack the overflow in the last legal column.
                    entry.cell = { c: cols[cols.length - 1] || 0, r: m.rows - 1 };
                });
            },

            cellRect: function(cell, m) {
                return {
                    left: this.PAD + cell.c * m.cellW,
                    top: this.PAD + cell.r * m.cellH
                };
            },

            cellFromPoint: function(x, y, m) {
                const c = Math.floor((x - this.PAD) / m.cellW);
                const r = Math.floor((y - this.PAD) / m.cellH);
                return {
                    c: Math.max(0, Math.min(m.cols - 1, c)),
                    r: Math.max(0, Math.min(m.rows - 1, r))
                };
            },

            layout: function() {
                const container = document.getElementById('hypernet-desktop-icons-container');
                if (!container) return;
                const m = this.metrics();

                this.icons.forEach(entry => {
                    if (!entry.cell) return;
                    const pos = this.cellRect(entry.cell, m);
                    entry.el.style.left = pos.left + 'px';
                    entry.el.style.top = pos.top + 'px';
                    entry.el.style.width = (m.cellW - 14) + 'px';
                    entry.el.classList.toggle('compact', m.compact);
                });

                // Thin rule marking off the reserved column.
                let divider = container.querySelector('.desktop-icon-divider');
                if (m.reservedCol > 0) {
                    if (!divider) {
                        divider = document.createElement('div');
                        divider.className = 'desktop-icon-divider';
                        container.appendChild(divider);
                    }
                    divider.style.left = (this.PAD + m.reservedCol * m.cellW - 8) + 'px';
                    divider.style.top = this.PAD + 'px';
                    divider.style.height = (m.rows * m.cellH) + 'px';
                } else if (divider) {
                    divider.parentNode.removeChild(divider);
                }
            },

            persist: function() {
                const saved = this.savedLayout();
                if (!saved) return;
                this.icons.forEach(entry => {
                    if (entry.cell) saved[entry.app.id] = { c: entry.cell.c, r: entry.cell.r };
                });
            },

            showGhost: function(cell, legal, m) {
                const container = document.getElementById('hypernet-desktop-icons-container');
                if (!container) return;
                if (!this._ghost || !this._ghost.isConnected) {
                    this._ghost = document.createElement('div');
                    this._ghost.className = 'desktop-icon-ghost';
                    container.appendChild(this._ghost);
                }
                const pos = this.cellRect(cell, m);
                this._ghost.style.display = 'block';
                this._ghost.style.left = pos.left + 'px';
                this._ghost.style.top = pos.top + 'px';
                this._ghost.style.width = (m.cellW - 14) + 'px';
                this._ghost.style.height = (m.cellH - 14) + 'px';
                this._ghost.classList.toggle('illegal', !legal);
            },

            hideGhost: function() {
                if (this._ghost) this._ghost.style.display = 'none';
            },

            attachDrag: function(el) {
                el.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    const entry = this.icons.find(i => i.el === el);
                    if (!entry || !entry.cell) return;

                    const container = document.getElementById('hypernet-desktop-icons-container');
                    if (!container) return;

                    const startX = e.clientX;
                    const startY = e.clientY;
                    const rect = el.getBoundingClientRect();
                    const offX = startX - rect.left;
                    const offY = startY - rect.top;
                    const origin = { c: entry.cell.c, r: entry.cell.r };
                    let dragging = false;
                    let target = origin;
                    let targetLegal = true;

                    const onMove = (ev) => {
                        if (!dragging) {
                            if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
                            dragging = true;
                            el.classList.add('dragging');
                        }
                        const cr = container.getBoundingClientRect();
                        const left = ev.clientX - offX - cr.left;
                        const top = ev.clientY - offY - cr.top;
                        el.style.left = left + 'px';
                        el.style.top = top + 'px';

                        const m = this.metrics();
                        target = this.cellFromPoint(left + el.offsetWidth / 2, top + el.offsetHeight / 2, m);
                        targetLegal = this.isLegalCell(entry, target, m);
                        this.showGhost(target, targetLegal, m);
                    };

                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove, true);
                        document.removeEventListener('mouseup', onUp, true);
                        if (!dragging) return;

                        el.classList.remove('dragging');
                        this.hideGhost();
                        // Suppress the click this mouseup is about to fire, so
                        // dropping an icon never also launches its app. Cleared on
                        // the next tick in case the drop landed outside the icon
                        // and no click follows at all.
                        el._hnDragged = true;
                        setTimeout(() => { el._hnDragged = false; }, 0);

                        if (targetLegal && (target.c !== origin.c || target.r !== origin.r)) {
                            const m = this.metrics();
                            const other = this.icons.find(i => i !== entry && i.cell &&
                                i.cell.c === target.c && i.cell.r === target.r);
                            // An occupied cell swaps the two icons, but only if the
                            // displaced one may legally live where this one came from.
                            if (!other) {
                                entry.cell = target;
                            } else if (this.isLegalCell(other, origin, m)) {
                                other.cell = origin;
                                entry.cell = target;
                            }
                            this.persist();
                            if (window.SoundManager) SoundManager.playCursor();
                        }
                        this.layout();
                    };

                    document.addEventListener('mousemove', onMove, true);
                    document.addEventListener('mouseup', onUp, true);
                });
            }
        },

        refreshStartMenu: function() {
            const listContainer = document.getElementById('start-menu-apps-list');
            if (!listContainer) return;

            listContainer.innerHTML = '';
            Object.values(this._apps).forEach(app => {
                const item = document.createElement('div');
                item.className = 'start-menu-app-item';
                item.innerHTML = `
                    <div class="start-menu-app-icon">${this.getIconHTML(app.icon, 24)}</div>
                    <div class="start-menu-app-name">${app.name}</div>
                `;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.launchApp(app.id);
                });
                listContainer.appendChild(item);
            });
        },

        refreshTaskbarTabs: function() {
            const bar = document.getElementById('hypernet-taskbar-tabs');
            if (!bar) return;
            bar.innerHTML = '';
            
            this.WindowManager.windows.forEach(win => {
                const title = win.dataset.title || T('HypernetOS.untitledWindow');
                const iconHTML = win.dataset.iconHTML || '';
                const isActive = win.classList.contains('active');
                const isMinimized = win.classList.contains('minimized');
                
                const tab = document.createElement('div');
                tab.className = `taskbar-tab ${isActive ? 'active' : ''} ${isMinimized ? 'minimized' : ''}`;
                tab.innerHTML = `
                    ${iconHTML ? `<span class="taskbar-tab-icon">${iconHTML}</span>` : ''}
                    <span class="taskbar-tab-text">${title}</span>
                `;
                
                tab.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isActive) {
                        this.WindowManager.toggleMinimize(win);
                    } else {
                        if (isMinimized) {
                            this.WindowManager.toggleMinimize(win);
                        } else {
                            this.WindowManager.bringToFront(win);
                        }
                    }
                });
                
                bar.appendChild(tab);
            });
        }
    };

    // --- Kernel & Esoteric File System ---
    const fs = (typeof require !== 'undefined') ? require('fs') : null;
    const path = (typeof require !== 'undefined') ? require('path') : null;

    class Process {
        constructor(pid, name, executable) {
            this.pid = pid;
            this.name = name;
            this.executable = executable; // function or object
            this.status = 'READY'; // READY, RUNNING, SUSPENDED, KILLED
            this.cpuUsage = 0; // Simulated %
            this.memoryUsage = Math.floor(Math.random() * 20) + 5; // Simulating 5-25MB usage
        }
        tick() {
            if (this.status === 'RUNNING' && this.executable && typeof this.executable.update === 'function') {
                this.executable.update();
            }
        }
    }

    window.HypernetOS.Kernel = {
        processes: [],
        pidCounter: 1000,
        totalRAM: 512, // MB (2001 computer)
        totalCPU: 0,
        
        spawnProcess: function(name, executable) {
            const usedRAM = this.getUsedRAM();
            const process = new Process(this.pidCounter++, name, executable);
            
            if (usedRAM + process.memoryUsage > this.totalRAM) {
                console.error(`OOM: Cannot allocate ${process.memoryUsage}MB for ${name}.`);
                if (window.SoundManager) SoundManager.playBuzzer();
                return null;
            }
            
            process.status = 'RUNNING';
            this.processes.push(process);
            return process;
        },
        
        killProcess: function(pid) {
            const idx = this.processes.findIndex(p => p.pid == pid);
            if (idx > -1) {
                this.processes[idx].status = 'KILLED';
                this.processes.splice(idx, 1);
            }
        },
        
        getUsedRAM: function() {
            return this.processes.reduce((sum, p) => sum + p.memoryUsage, 0);
        },
        
        tick: function() {
            let baseCPU = 2; 
            this.processes.forEach(p => {
                if (p.status === 'RUNNING') {
                    p.tick();
                    p.cpuUsage = Math.max(0, Math.floor(Math.random() * 5)); // Simulate active cpu load per app
                    baseCPU += p.cpuUsage;
                }
            });
            this.totalCPU = Math.min(100, baseCPU);
        }
    };

    window.HypernetOS.EFS = {
        getBasePath: function() {
            if (!fs || !path) return null;
            const base = path.dirname(process.mainModule.filename);
            const saveId = (typeof $gameSystem !== 'undefined' && $gameSystem) ? $gameSystem.savefileId() : 1;
            const dir = path.join(base, 'save', 'filesystem', `save${saveId}`);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            return dir;
        },
        
        readFile: function(relPath) {
            const base = this.getBasePath();
            if (!base) return null;
            const fullPath = path.join(base, relPath);
            if (fs.existsSync(fullPath)) {
                return fs.readFileSync(fullPath, 'utf8');
            }
            return null;
        },
        
        writeFile: function(relPath, content) {
            const base = this.getBasePath();
            if (!base) return false;
            const fullPath = path.join(base, relPath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, 'utf8');
            return true;
        },
        
        readDir: function(relPath) {
            const base = this.getBasePath();
            if (!base) return [];
            const fullPath = relPath ? path.join(base, relPath) : base;
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                return fs.readdirSync(fullPath);
            }
            return [];
        },
        
        mkdir: function(relPath) {
            const base = this.getBasePath();
            if (!base) return false;
            const fullPath = path.join(base, relPath);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                return true;
            }
            return false;
        }
    };

    window.HypernetOS.Syscalls = {
        spawn: (name, executable) => window.HypernetOS.Kernel.spawnProcess(name, executable),
        kill: (pid) => window.HypernetOS.Kernel.killProcess(pid),
        readFile: (path) => window.HypernetOS.EFS.readFile(path),
        writeFile: (path, data) => window.HypernetOS.EFS.writeFile(path, data),
        readDir: (path) => window.HypernetOS.EFS.readDir(path),
        mkdir: (path) => window.HypernetOS.EFS.mkdir(path),
        createWindow: (options) => window.HypernetOS.WindowManager.createWindow(options),
        closeWindow: (win) => window.HypernetOS.WindowManager.closeWindow(win)
    };

    // --- Dynamic Window Manager ---
    // Cheap accessor for the currently-active window. bringToFront() keeps the
    // cache warm; this only re-queries the DOM when the cached node is gone or no
    // longer marked active (window closed / minimized / focus changed elsewhere).
    window.HypernetOS._getActiveWindow = function() {
        const cached = window.HypernetOS._activeWindowCache;
        if (cached && cached.isConnected && cached.classList.contains('active')) {
            return cached;
        }
        const found = document.querySelector('.hypernet-os-window.active');
        window.HypernetOS._activeWindowCache = found;
        return found;
    };

    // Height of #hypernet-taskbar (see hypernet.css); windows are kept clear of it.
    const TASKBAR_H = 40;

    window.HypernetOS.WindowManager = {
        windows: [],
        zIndexCounter: 100,

        createWindow: function(options) {
            let { id, title, contentHTML, width = 800, height = 600, icon = '' } = options;

            // Make every OS app window slightly bigger, clamped to the viewport
            // (leave room for margins and the taskbar) so large windows never overflow.
            const WINDOW_SCALE = 1.18;
            width = Math.min(Math.round(width * WINDOW_SCALE), window.innerWidth - 20);
            height = Math.min(Math.round(height * WINDOW_SCALE), window.innerHeight - 60);

            // Check if window already exists
            const existing = document.getElementById(id);
            if (existing) {
                if (existing.classList.contains('minimized')) {
                    this.toggleMinimize(existing);
                }
                this.bringToFront(existing);
                return existing;
            }

            const win = document.createElement('div');
            win.id = id;
            win.className = 'hypernet-os-window';
            win.dataset.title = title;
            if (window.HypernetOS.currentLaunchingPid) {
                win.dataset.pid = window.HypernetOS.currentLaunchingPid;
            }
            
            const iconHTML = window.HypernetOS.getIconHTML(icon, 16);
            win.dataset.iconHTML = iconHTML;
            
            // Initial positioning (center/cascade offset). The cascade is capped
            // at whatever room is left over the taskbar: on a short screen (a
            // 1280x800 handheld) a window clamped to the full viewport height has
            // no slack at all, and an uncapped cascade walked the fourth or fifth
            // window's titlebar off the bottom, taking the only way to drag it
            // back with it.
            const maxX = Math.max(10, window.innerWidth - width - 10);
            const maxY = Math.max(10, window.innerHeight - height - TASKBAR_H - 10);
            const startX = Math.min(maxX,
                Math.max(10, (window.innerWidth - width) / 2 + (this.windows.length * 25)));
            const startY = Math.min(maxY,
                Math.max(10, (window.innerHeight - height - 40) / 2 + (this.windows.length * 25)));
            
            win.style.width = width + 'px';
            win.style.height = height + 'px';
            win.style.left = startX + 'px';
            win.style.top = startY + 'px';
            win.style.zIndex = ++this.zIndexCounter;

            win.innerHTML = `
                <div class="hypernet-window-border">
                    <div class="hypernet-window-titlebar">
                        <div class="hypernet-window-title">
                            ${iconHTML ? `<span class="hypernet-window-icon">${iconHTML}</span>` : ''}
                            ${title}
                        </div>
                        <div class="hypernet-window-controls">
                            <button class="hypernet-btn hypernet-btn-min" title="${T('HypernetOS.minimize')}">0</button>
                            <button class="hypernet-btn hypernet-btn-max" title="${T('HypernetOS.maximize')}">1</button>
                            <button class="hypernet-btn hypernet-btn-close" title="${T('HypernetOS.close')}">r</button>
                        </div>
                    </div>
                    <div class="hypernet-window-content">
                        ${contentHTML}
                    </div>
                    <!-- Resizer Handles -->
                    <div class="resize-handle resize-n"></div>
                    <div class="resize-handle resize-e"></div>
                    <div class="resize-handle resize-s"></div>
                    <div class="resize-handle resize-w"></div>
                    <div class="resize-handle resize-ne"></div>
                    <div class="resize-handle resize-nw"></div>
                    <div class="resize-handle resize-se"></div>
                    <div class="resize-handle resize-sw"></div>
                </div>
            `;

            document.getElementById('hypernet-os-desktop').appendChild(win);
            this.windows.push(win);

            this.setupWindowEvents(win);
            this.bringToFront(win);
            
            // Refresh tabs
            window.HypernetOS.refreshTaskbarTabs();

            // Open Animation
            win.style.transform = 'scale(0.95)';
            win.style.opacity = '0';
            requestAnimationFrame(() => {
                win.style.transition = 'transform 0.15s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.15s ease';
                win.style.transform = 'scale(1)';
                win.style.opacity = '1';
                setTimeout(() => { win.style.transition = ''; }, 150);
            });

            return win;
        },

        // An app whose client area is an iframe (the browser) swallows every
        // mousemove and mouseup the moment the pointer crosses into it, which
        // strands a titlebar drag or a border resize halfway through. Marking
        // the desktop while either is running lets the CSS switch iframes off
        // for the duration, so the OS titlebar and handles stay in charge.
        setDragState: function(active) {
            const desktop = document.getElementById('hypernet-os-desktop');
            if (desktop) desktop.classList.toggle('os-window-dragging', !!active);
        },

        setupWindowEvents: function(win) {
            const titlebar = win.querySelector('.hypernet-window-titlebar');
            const closeBtn = win.querySelector('.hypernet-btn-close');
            const maxBtn = win.querySelector('.hypernet-btn-max');
            const minBtn = win.querySelector('.hypernet-btn-min');
            
            // Focus on click
            win.addEventListener('mousedown', () => this.bringToFront(win));
            
            // Close Action
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeWindow(win);
            });

            // Maximize Action
            maxBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMaximize(win);
            });

            // Minimize Action
            minBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMinimize(win);
            });

            // Window Dragging
            let isDragging = false;
            let dragOffsetX = 0;
            let dragOffsetY = 0;

            titlebar.addEventListener('mousedown', (e) => {
                if (win.classList.contains('maximized')) return;
                // Exclude window control buttons from drag triggers
                if (e.target.closest('.hypernet-btn')) return;
                
                isDragging = true;
                this.bringToFront(win);
                this.setDragState(true);

                const rect = win.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                
                const onMouseMove = (ev) => {
                    if (!isDragging) return;
                    
                    // Constrain within screen boundaries roughly
                    let x = ev.clientX - dragOffsetX;
                    let y = ev.clientY - dragOffsetY;
                    
                    // Taskbar heights restriction
                    const maxTop = window.innerHeight - 40 - 30;
                    y = Math.max(0, Math.min(y, maxTop));
                    
                    win.style.left = x + 'px';
                    win.style.top = y + 'px';
                };
                
                const onMouseUp = () => {
                    isDragging = false;
                    this.setDragState(false);
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // Border Drag Resizing
            const handles = win.querySelectorAll('.resize-handle');
            handles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    if (win.classList.contains('maximized')) return;
                    this.bringToFront(win);
                    this.setDragState(true);

                    const direction = handle.className.replace('resize-handle resize-', '');
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startRect = win.getBoundingClientRect();
                    const minWidth = 320;
                    const minHeight = 200;

                    const onMouseMove = (ev) => {
                        let newWidth = startRect.width;
                        let newHeight = startRect.height;
                        let newLeft = startRect.left;
                        let newTop = startRect.top;

                        if (direction.includes('e')) newWidth = startRect.width + (ev.clientX - startX);
                        if (direction.includes('w')) {
                            const diff = startX - ev.clientX;
                            if (startRect.width + diff >= minWidth) {
                                newWidth = startRect.width + diff;
                                newLeft = startRect.left - diff;
                            }
                        }
                        if (direction.includes('s')) newHeight = startRect.height + (ev.clientY - startY);
                        if (direction.includes('n')) {
                            const diff = startY - ev.clientY;
                            if (startRect.height + diff >= minHeight) {
                                newHeight = startRect.height + diff;
                                newTop = startRect.top - diff;
                            }
                        }

                        if (newWidth >= minWidth) {
                            win.style.width = newWidth + 'px';
                            win.style.left = newLeft + 'px';
                        }
                        if (newHeight >= minHeight) {
                            win.style.height = newHeight + 'px';
                            win.style.top = newTop + 'px';
                        }
                    };

                    const onMouseUp = () => {
                        this.setDragState(false);
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            });
        },

        bringToFront: function(win) {
            this.zIndexCounter++;
            win.style.zIndex = this.zIndexCounter;
            
            this.windows.forEach(w => w.classList.remove('active'));
            win.classList.add('active');
            // Cache the active window so per-frame nav code avoids a document query.
            window.HypernetOS._activeWindowCache = win;

            window.HypernetOS.refreshTaskbarTabs();
        },

        // Pull every open window back inside the desktop. Window geometry is
        // stored in absolute pixels, so a viewport that gets shorter or narrower
        // (a resolution switch, leaving fullscreen, a Steam Deck moving between
        // its own 1280x800 panel and a docked display) would otherwise leave
        // windows hanging off the edge with their titlebars out of reach.
        reflowWindows: function() {
            const vw = window.innerWidth, vh = window.innerHeight;
            for (const win of this.windows) {
                if (!win || !win.isConnected) continue;
                if (win.classList.contains('maximized')) continue;
                const w = Math.min(win.offsetWidth, vw - 20);
                const h = Math.min(win.offsetHeight, vh - TASKBAR_H - 20);
                if (w !== win.offsetWidth) win.style.width = w + 'px';
                if (h !== win.offsetHeight) win.style.height = h + 'px';
                const x = Math.min(Math.max(0, vw - w - 10), Math.max(10, parseInt(win.style.left, 10) || 10));
                const y = Math.min(Math.max(0, vh - h - TASKBAR_H - 10), Math.max(10, parseInt(win.style.top, 10) || 10));
                win.style.left = x + 'px';
                win.style.top = y + 'px';
            }
        },

        toggleMaximize: function(win) {
            if (win.classList.contains('maximized')) {
                win.classList.remove('maximized');
                win.style.left = win.dataset.prevLeft;
                win.style.top = win.dataset.prevTop;
                win.style.width = win.dataset.prevWidth;
                win.style.height = win.dataset.prevHeight;
                win.querySelector('.hypernet-btn-max').textContent = '1';
                win.querySelector('.hypernet-btn-max').title = 'Maximize';
            } else {
                win.dataset.prevLeft = win.style.left;
                win.dataset.prevTop = win.style.top;
                win.dataset.prevWidth = win.style.width;
                win.dataset.prevHeight = win.style.height;
                
                win.classList.add('maximized');
                win.style.left = '0';
                win.style.top = '0';
                win.style.width = '100vw';
                win.style.height = 'calc(100vh - 40px)';
                win.querySelector('.hypernet-btn-max').textContent = '2';
                win.querySelector('.hypernet-btn-max').title = 'Restore Down';
            }
            window.HypernetOS.refreshTaskbarTabs();
        },

        toggleMinimize: function(win) {
            if (win.classList.contains('minimized')) {
                win.classList.remove('minimized');
                win.style.display = 'block';
                void win.offsetWidth; // Force layout
                win.style.transform = 'scale(1)';
                win.style.opacity = '1';
                this.bringToFront(win);
            } else {
                win.style.transform = 'scale(0.8) translateY(150px)';
                win.style.opacity = '0';
                win.classList.remove('active');
                setTimeout(() => {
                    win.classList.add('minimized');
                    win.style.display = 'none';
                    // Focus another window if any
                    const remaining = this.windows.filter(w => !w.classList.contains('minimized'));
                    if (remaining.length > 0) {
                        this.bringToFront(remaining[remaining.length - 1]);
                    } else {
                        window.HypernetOS.refreshTaskbarTabs();
                    }
                }, 150);
            }
        },

        closeWindow: function(win) {
            if (win.dataset.pid && window.HypernetOS.Kernel) {
                window.HypernetOS.Kernel.killProcess(win.dataset.pid);
            }
            win.style.transition = 'transform 0.12s ease-in, opacity 0.12s ease-in';
            win.style.transform = 'scale(0.9)';
            win.style.opacity = '0';
            setTimeout(() => {
                if (win.parentNode) win.parentNode.removeChild(win);
                this.windows = this.windows.filter(w => w !== win);
                win.dispatchEvent(new Event('hypernet-closed'));
                window.HypernetOS.refreshTaskbarTabs();
            }, 120);
        },

        closeAll: function() {
            this.windows.forEach(win => {
                if (win.parentNode) win.parentNode.removeChild(win);
            });
            this.windows = [];
            window.HypernetOS.refreshTaskbarTabs();
        }
    };

    // Alias for backwards compatibility
    window.HypernetWindowManager = window.HypernetOS.WindowManager;

    // --- Scene_HypernetOS (RMMZ Desktop View) ---
    function Scene_HypernetOS() {
        this.initialize(...arguments);
    }

    Scene_HypernetOS.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_HypernetOS.prototype.constructor = Scene_HypernetOS;
    window.Scene_HypernetOS = Scene_HypernetOS;

    Scene_HypernetOS.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
        this._autoLaunchApp = null;
        this._clockInterval = null;
    };

    Scene_HypernetOS.prototype.prepare = function(params) {
        if (params && params.autoLaunch) {
            this._autoLaunchApp = params.autoLaunch;
            this._autoLaunchParams = params.shopParams || null;
        }
    };

    Scene_HypernetOS.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createBackground();
        this.loadFontsAndStylesheets();
        this.createDesktop();
        this.setupKeyboardHooks();
        this.startClock();
    };

    Scene_HypernetOS.prototype.createBackground = function() {
        this._backgroundSprite = new Sprite();
        this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
        this.addChild(this._backgroundSprite);
        
        const dimmer = new Sprite();
        dimmer.bitmap = new Bitmap(Graphics.width, Graphics.height);
        dimmer.bitmap.fillAll('rgba(0, 0, 0, 0.4)');
        this.addChild(dimmer);
    };

    Scene_HypernetOS.prototype.loadFontsAndStylesheets = function() {
        // Load custom fonts for modern premium look (Outfit for UI, Tahoma for classic feel)
        if (!document.getElementById('hypernet-os-fonts')) {
            const fonts = document.createElement('link');
            fonts.id = 'hypernet-os-fonts';
            fonts.rel = 'stylesheet';
            fonts.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700&family=Tahoma:wght@400;700&display=swap';
            document.head.appendChild(fonts);
        }

        // Complete Windows XP Luna styling
        if (!document.getElementById('hypernet-os-styles')) {
            const link = document.createElement('link');
            link.id = 'hypernet-os-styles';
            link.rel = 'stylesheet';
            link.href = 'css/hypernet.css';
            document.head.appendChild(link);
        }
    };

    Scene_HypernetOS.prototype.createDesktop = function() {
        const existing = document.getElementById('hypernet-os-container');
        if (existing) {
            existing.parentNode.removeChild(existing);
        }

        this._container = document.createElement('div');
        this._container.id = 'hypernet-os-container';
        
        // Grab Lead character name/face for Start Menu
        let userName = T('HypernetOS.defaultUser');
        let userAvatarHTML = '';
        if ($gameParty.leader()) {
            userName = $gameParty.leader().name();
            // Optional: Draw lead's RMMZ icon as avatar
            userAvatarHTML = window.HypernetOS.getIconHTML(245, 28) || '';
        }

        this._container.innerHTML = `
            <div id="hypernet-os-desktop">
                <div id="hypernet-desktop-icons-container"></div>
            </div>

            <!-- Windows XP Start Menu -->
            <div id="hypernet-start-menu">
                <div class="start-menu-header">
                    <div class="start-menu-avatar">${userAvatarHTML}</div>
                    <div class="start-menu-username">${userName}</div>
                </div>
                <div class="start-menu-body">
                    <div class="start-menu-left" id="start-menu-apps-list">
                        <!-- Dynamically filled with registered apps -->
                    </div>
                    <div class="start-menu-right">
                        <div class="start-menu-link" id="link-my-computer">
                            <div class="start-menu-link-icon">${window.HypernetOS.getIconHTML(86, 16)}</div>
                            <div>${T('HypernetOS.myComputer')}</div>
                        </div>
                        <div class="start-menu-link" id="link-my-documents">
                            <div class="start-menu-link-icon">${window.HypernetOS.getIconHTML(191, 16)}</div>
                            <div>${T('HypernetOS.myDocuments')}</div>
                        </div>
                        <div class="start-menu-divider"></div>
                        <div class="start-menu-link" id="link-control-panel">
                            <div class="start-menu-link-icon">${window.HypernetOS.getIconHTML(234, 16)}</div>
                            <div>${T('HypernetOS.controlPanel')}</div>
                        </div>
                        <div class="start-menu-link" id="link-web-browser">
                            <div class="start-menu-link-icon">${window.HypernetOS.getIconHTML(188, 16)}</div>
                            <div>${T('HypernetOS.hypernetExplorer')}</div>
                        </div>
                    </div>
                </div>
                <div class="start-menu-footer">
                    <div class="start-menu-btn" id="start-btn-logoff">
                        <div class="start-menu-btn-icon" style="background: #e6b0aa; color: #78281f">↩</div>
                        <div>${T('HypernetOS.logOff')}</div>
                    </div>
                    <div class="start-menu-btn" id="start-btn-turnoff">
                        <div class="start-menu-btn-icon" style="background: #ec7063; color: #512e2e"></div>
                        <div>${T('HypernetOS.turnOff')}</div>
                    </div>
                </div>
            </div>

            <!-- Bottom Taskbar -->
            <div id="hypernet-taskbar">
                <button id="hypernet-start-btn">
                    <div class="start-btn-logo">
                        <div class="logo-sq l-red"></div>
                        <div class="logo-sq l-green"></div>
                        <div class="logo-sq l-blue"></div>
                        <div class="logo-sq l-yellow"></div>
                    </div>
                    start
                </button>
                <div id="hypernet-taskbar-tabs"></div>
                <div id="hypernet-system-tray">
                    <div class="tray-icon" title="${T('HypernetOS.networkEstablished')}"></div>
                    <div class="tray-icon" title="${T('HypernetOS.encryptionMax')}"></div>
                    <div id="tray-clock">12:00 PM</div>
                </div>
            </div>
        `;

        document.body.appendChild(this._container);

        // Virtual analog cursor: lets a controller drive the OS desktop with the
        // left stick (A = click). The OS is otherwise mouse-only. pointer-events:none
        // so it never blocks document.elementFromPoint hit-testing underneath it.
        const aCursor = document.createElement('div');
        aCursor.id = 'hypernet-os-analog-cursor';
        aCursor.style.cssText = 'position:fixed; left:0; top:0; width:20px; height:20px; ' +
            'pointer-events:none; z-index:2147483647; display:none;';
        aCursor.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20">' +
            '<path d="M2,2 L2,16 L6,12 L9,18 L11,17 L8,11 L14,11 Z" ' +  // i18n-ignore  svg path data
            'fill="#ffffff" stroke="#000000" stroke-width="1.2"/></svg>';  // i18n-ignore  svg attributes
        this._container.appendChild(aCursor);
        this._analogCursor = aCursor;
        this._cursorX = window.innerWidth / 2;
        this._cursorY = window.innerHeight / 2;
        this._cursorAHeld = false;
        this._lastHoverEl = null;

        // Spatial focus navigation highlight: a ring drawn around the currently
        // focused interactive element. Driven by WASD / arrow keys and the
        // controller D-pad so the whole OS is operable without a mouse.
        const navHl = document.createElement('div');
        navHl.id = 'hypernet-os-nav-highlight';
        navHl.style.cssText = 'position:fixed; left:0; top:0; width:0; height:0; ' +
            'pointer-events:none; z-index:2147483646; display:none; box-sizing:border-box; ' +
            'border:2px solid #ffd54a; border-radius:4px; ' +
            'box-shadow:0 0 0 2px rgba(0,0,0,0.55), 0 0 10px 2px rgba(255,213,74,0.85); ' +
            'transition:left 0.07s ease, top 0.07s ease, width 0.07s ease, height 0.07s ease;';
        this._container.appendChild(navHl);
        this._navHighlight = navHl;
        this._focusEl = null;
        this._navMode = null;      // 'focus' (keyboard/d-pad) | 'cursor' (analog stick)
        this._navLastDir = null;
        this._navRepeatAt = 0;

        // Bind Start Button events
        const startBtn = document.getElementById('hypernet-start-btn');
        const startMenu = document.getElementById('hypernet-start-menu');
        
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = startMenu.classList.contains('open');
            if (isOpen) {
                startMenu.classList.remove('open');
                startBtn.classList.remove('active');
            } else {
                startMenu.classList.add('open');
                startBtn.classList.add('active');
                if (window.SoundManager) SoundManager.playCursor();
            }
        });

        // Close Start Menu if clicking anywhere else
        this._documentClickHandler = (e) => {
            if (startMenu && startBtn && !startMenu.contains(e.target) && !startBtn.contains(e.target)) {
                startMenu.classList.remove('open');
                startBtn.classList.remove('active');
            }
        };
        document.addEventListener('click', this._documentClickHandler);

        // Right click anywhere on the OS surface is the mouse equivalent of
        // Escape / controller B: it closes the frontmost window, and leaves the
        // OS when the desktop is bare. The native context menu never shows.
        this._contextMenuHandler = (e) => {
            if (!this.isActive()) return;
            e.preventDefault();

            // A right click inside a text field is left to the field itself, so
            // typing in Notepad or a terminal is never interrupted.
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (startMenu && startMenu.classList.contains('open')) {
                startMenu.classList.remove('open');
                startBtn.classList.remove('active');
                return;
            }

            this.closeTopWindowOrExit();
        };
        this._container.addEventListener('contextmenu', this._contextMenuHandler);

        // Start Menu Navigation Links
        document.getElementById('link-my-computer').addEventListener('click', () => {
            window.HypernetOS.launchApp('my-computer');
        });
        document.getElementById('link-my-documents').addEventListener('click', () => {
            window.HypernetOS.launchApp('my-documents');
        });
        document.getElementById('link-control-panel').addEventListener('click', () => {
            window.HypernetOS.launchApp('control-panel');
        });
        document.getElementById('link-web-browser').addEventListener('click', () => {
            window.HypernetOS.launchApp('app-hypernet-browser');
        });

        // Logoff and Turnoff Computer Buttons
        document.getElementById('start-btn-logoff').addEventListener('click', () => {
            this.onExitClick();
        });
        document.getElementById('start-btn-turnoff').addEventListener('click', () => {
            this.onTurnOffClick();
        });

        // Re-flow the icon grid and the open windows when the game window /
        // resolution changes.
        this._desktopResizeHandler = () => {
            window.HypernetOS.refreshDesktopIcons();
            window.HypernetOS.WindowManager.reflowWindows();
        };
        window.addEventListener('resize', this._desktopResizeHandler);

        // Initial populates of registered apps on desktop and start menu
        window.HypernetOS.refreshDesktopIcons();
        window.HypernetOS.refreshStartMenu();
        window.HypernetOS.refreshTaskbarTabs();

        // Auto launch if requested from prepareNextScene
        if (this._autoLaunchApp) {
            setTimeout(() => {
                const appId = (this._autoLaunchApp === 'browser') ? 'app-hypernet-browser' : 
                              (this._autoLaunchApp === 'shop') ? 'app-hypernet-shop' : this._autoLaunchApp;
                
                const app = window.HypernetOS._apps[appId];
                if (app && typeof app.launchFn === 'function') {
                    app.launchFn(this._autoLaunchParams);
                } else {
                    window.HypernetOS.launchApp(appId);
                }
            }, 150);
        }
    };

    Scene_HypernetOS.prototype.startClock = function() {
        const updateClock = () => {
            const clockEl = document.getElementById('tray-clock');
            if (!clockEl) return;
            const now = new Date();
            let hours = now.getHours();
            let minutes = now.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'
            minutes = minutes < 10 ? '0' + minutes : minutes;
            clockEl.textContent = `${hours}:${minutes} ${ampm}`;
        };
        
        updateClock();
        this._clockInterval = setInterval(updateClock, 1000);
    };

    Scene_HypernetOS.prototype.setupKeyboardHooks = function() {
        this._handleKeyDown = (event) => {
            if (!this.isActive()) return;

            const isTyping = document.activeElement &&
                (document.activeElement.tagName === 'INPUT' ||
                 document.activeElement.tagName === 'TEXTAREA' ||
                 document.activeElement.tagName === 'IFRAME');

            const key = event.key.toUpperCase();

            // Some apps run their own complete keyboard/controller navigation
            // (e.g. the Stockbusters shop grid) and mark their window
            // data-self-nav. The OS yields directional / OK / cancel keys to them
            // and lets their own handler drive selection and back/close, so the
            // two navigation systems never fight over the same press.
            const selfNav = this._activeWindowIsSelfNav();

            const NAV_DIRS = {
                ARROWUP: 'up', ARROWDOWN: 'down', ARROWLEFT: 'left', ARROWRIGHT: 'right',
                W: 'up', S: 'down', A: 'left', D: 'right'
            };

            if (key === 'ESCAPE') {
                event.preventDefault();

                // While editing a text field, Escape leaves the field rather
                // than closing the window underneath it.
                if (isTyping && document.activeElement.tagName !== 'IFRAME') {
                    document.activeElement.blur();
                    return;
                }

                // A self-nav app owns Escape too (it walks its own stack back and
                // closes its window at the top level).
                if (selfNav) return;

                this.closeTopWindowOrExit();
                return;
            }

            // Text fields keep their native key behavior (caret movement,
            // typing W/A/S/D, Enter to submit). Don't hijack navigation there.
            if (isTyping) return;

            // Yield navigation/activation keys to a self-nav app, but still
            // swallow the browser's default scroll on arrows/space.
            if (selfNav) {
                if (NAV_DIRS[key] || key === 'TAB' || key === ' ' ||
                    key === 'SPACEBAR' || event.key === ' ') {
                    event.preventDefault();
                }
                return;
            }

            // Spatial navigation: arrow keys + WASD move the focus ring.
            if (NAV_DIRS[key]) {
                event.preventDefault();
                this._moveFocus(NAV_DIRS[key]);
                return;
            }

            // Tab cycles through interactive elements (Shift+Tab reverses).
            if (key === 'TAB') {
                event.preventDefault();
                this._cycleFocus(event.shiftKey ? -1 : 1);
                return;
            }

            // Enter / Space activate the focused element.
            if (key === 'ENTER' || key === ' ' || event.key === ' ' || key === 'SPACEBAR') {
                if (this._focusEl) {
                    event.preventDefault();
                    this._activateFocus();
                }
            }
        };
        document.addEventListener('keydown', this._handleKeyDown);
    };

    // --- Spatial focus navigation -------------------------------------------

    // True when the focused window declares data-self-nav, meaning the app
    // inside it runs its own keyboard / controller navigation and the OS focus
    // ring should stand down for directional / activation / cancel input.
    Scene_HypernetOS.prototype._activeWindowIsSelfNav = function() {
        const activeWin = window.HypernetOS._getActiveWindow();
        return !!(activeWin && activeWin.dataset && activeWin.dataset.selfNav === '1');
    };

    // Collect every visible, interactive element currently on the OS surface.
    Scene_HypernetOS.prototype._getFocusables = function() {
        if (!this._container) return [];
        const selector = [
            '.desktop-icon', '#hypernet-start-btn', '.start-menu-app-item',
            '.start-menu-link', '.start-menu-btn', '.taskbar-tab', '.tray-icon',
            '.hypernet-btn', 'button', 'a[href]', 'select', 'textarea',
            'input:not([type=hidden])', '[onclick]',
            // Project-wide convention: apps tag any click-driven element (plain
            // <div>s with a click listener, not just <button>/<a>) as .focusable
            // so it can be reached by the WASD/arrow/D-pad focus ring. Also honor
            // explicit tabindex and let the focus ring land on embedded iframes.
            '.focusable', '[tabindex]:not([tabindex="-1"])', 'iframe'
        ].join(', ');
        const seen = new Set();
        const out = [];
        this._container.querySelectorAll(selector).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);
            if (el.disabled) return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;          // hidden / collapsed
            if (!el.offsetParent && el.style.position !== 'fixed') return;
            // Skip elements scrolled fully off-screen.
            if (r.bottom < 0 || r.top > window.innerHeight ||
                r.right < 0 || r.left > window.innerWidth) return;
            out.push(el);
        });
        return out;
    };

    Scene_HypernetOS.prototype._setFocus = function(el, silent) {
        if (!el) return;
        this._navMode = 'focus';
        this._focusEl = el;
        // Remember a stable key so the ring can re-acquire this control if the
        // app rebuilds its innerHTML (e.g. a live ticker refresh) and replaces
        // the focused node with a fresh one carrying the same id.
        this._focusKey = el.id || el.getAttribute('data-focus-key') || null;
        if (this._analogCursor) this._analogCursor.style.display = 'none';
        // Synthesize hover so :hover styling and mouseover handlers respond.
        if (this._lastHoverEl && this._lastHoverEl !== el) {
            this._dispatchMouse(this._lastHoverEl, 'mouseout');
        }
        this._dispatchMouse(el, 'mouseover');
        this._lastHoverEl = el;
        if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        this._updateFocusHighlight();
        if (!silent && window.SoundManager) SoundManager.playCursor();
    };

    Scene_HypernetOS.prototype._moveFocus = function(dir) {
        const list = this._getFocusables();
        if (list.length === 0) return;

        // First nav input (or focus lost) just reveals the nearest element.
        if (!this._focusEl || !this._focusEl.isConnected || list.indexOf(this._focusEl) === -1) {
            this._setFocus(list[0]);
            return;
        }

        const cur = this._focusEl.getBoundingClientRect();
        const cx = cur.left + cur.width / 2;
        const cy = cur.top + cur.height / 2;

        let best = null;
        let bestScore = Infinity;
        for (const el of list) {
            if (el === this._focusEl) continue;
            const r = el.getBoundingClientRect();
            const dx = (r.left + r.width / 2) - cx;
            const dy = (r.top + r.height / 2) - cy;
            let primary, cross;
            if (dir === 'left')       { if (dx >= -1) continue; primary = -dx; cross = Math.abs(dy); }
            else if (dir === 'right') { if (dx <= 1)  continue; primary = dx;  cross = Math.abs(dy); }
            else if (dir === 'up')    { if (dy >= -1) continue; primary = -dy; cross = Math.abs(dx); }
            else                      { if (dy <= 1)  continue; primary = dy;  cross = Math.abs(dx); }
            // Prefer aligned elements: cross-axis drift is penalized heavily.
            const score = primary + cross * 2;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        if (best) this._setFocus(best);
    };

    Scene_HypernetOS.prototype._cycleFocus = function(step) {
        const list = this._getFocusables();
        if (list.length === 0) return;
        let idx = this._focusEl ? list.indexOf(this._focusEl) : -1;
        idx = (idx + step + list.length) % list.length;
        this._setFocus(list[idx]);
    };

    Scene_HypernetOS.prototype._activateFocus = function() {
        const el = this._focusEl;
        if (!el || !el.isConnected) return;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            // Drop into the field so the player can type / pick.
            el.focus();
            return;
        }
        if (typeof el.focus === 'function') el.focus();
        this._dispatchMouse(el, 'mousedown');
        this._dispatchMouse(el, 'mouseup');
        if (typeof el.click === 'function') el.click();
    };

    // Keep the highlight ring glued to the focused element each frame; clear it
    // if the element vanished (window closed, menu collapsed) or the player
    // switched to the analog cursor.
    Scene_HypernetOS.prototype._updateFocusHighlight = function() {
        const hl = this._navHighlight;
        if (!hl) return;
        // If an app re-rendered its content and detached the focused node, try to
        // re-bind to the replacement element by its stable key so the focus ring
        // and keyboard/controller selection survive the refresh seamlessly.
        if (this._navMode === 'focus' && this._focusKey && this._container &&
            (!this._focusEl || !this._focusEl.isConnected)) {
            let re = null;
            try {
                const sel = (window.CSS && CSS.escape) ? '#' + CSS.escape(this._focusKey) : '#' + this._focusKey;
                re = this._container.querySelector(sel);
            } catch (e) { /* invalid id selector */ }
            if (!re) re = this._container.querySelector('[data-focus-key="' + this._focusKey + '"]');
            if (re) this._focusEl = re;
        }
        if (this._navMode !== 'focus' || !this._focusEl || !this._focusEl.isConnected) {
            hl.style.display = 'none';
            this._focusHlSig = null;
            return;
        }
        // Skip the getBoundingClientRect + style writes when the focused element and
        // its layout inputs (cumulative offset up the offsetParent chain, scroll of
        // ancestors, size) are unchanged since last frame. Reconstructing the offset
        // this way is cheap and catches window drags/scrolls without a full rect read.
        // Note: CSS transforms (e.g. minimize animation) are not reflected in the
        // signature, so the ring may briefly lag a transform-animating window.
        const el = this._focusEl;
        let oTop = 0, oLeft = 0;
        for (let n = el; n; n = n.offsetParent) { oTop += n.offsetTop || 0; oLeft += n.offsetLeft || 0; }
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            oTop -= n.scrollTop || 0; oLeft -= n.scrollLeft || 0;
        }
        const sig = el.tagName + '|' + oLeft + '|' + oTop + '|' + el.offsetWidth + '|' + el.offsetHeight;
        if (this._focusHlEl === el && this._focusHlSig === sig) return;
        this._focusHlEl = el;
        this._focusHlSig = sig;
        const r = this._focusEl.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) { hl.style.display = 'none'; return; }
        hl.style.display = 'block';
        hl.style.left = (r.left - 3) + 'px';
        hl.style.top = (r.top - 3) + 'px';
        hl.style.width = (r.width + 6) + 'px';
        hl.style.height = (r.height + 6) + 'px';
    };

    // Controller D-pad mirrors WASD/arrows; button 0 (A) activates focus when in
    // focus mode, otherwise clicks the analog cursor (handled in updateAnalogCursor).
    Scene_HypernetOS.prototype.updateGamepadNav = function() {
        // A self-nav app reads the D-pad / A button itself (via RPG Maker Input),
        // so the OS ring stays out of its way.
        if (this._activeWindowIsSelfNav()) { this._navLastDir = null; return; }
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let up = false, down = false, left = false, right = false, aPressed = false;
        for (const pad of pads) {
            if (!pad || !pad.connected) continue;
            const b = pad.buttons;
            if (b[12] && b[12].pressed) up = true;
            if (b[13] && b[13].pressed) down = true;
            if (b[14] && b[14].pressed) left = true;
            if (b[15] && b[15].pressed) right = true;
            if (b[0] && b[0].pressed) aPressed = true;
        }

        const dir = up ? 'up' : down ? 'down' : left ? 'left' : right ? 'right' : null;
        const now = performance.now();
        if (dir) {
            if (dir !== this._navLastDir) {
                this._moveFocus(dir);
                this._navLastDir = dir;
                this._navRepeatAt = now + 380;   // initial hold delay
            } else if (now >= this._navRepeatAt) {
                this._moveFocus(dir);
                this._navRepeatAt = now + 150;   // repeat rate
            }
        } else {
            this._navLastDir = null;
        }

        // A button activates the focus ring when keyboard/D-pad nav is active.
        if (this._navMode === 'focus') {
            if (aPressed && !this._cursorAHeld) {
                this._cursorAHeld = true;
                this._activateFocus();
            } else if (!aPressed) {
                this._cursorAHeld = false;
            }
        }
    };

    // The single "go back" action shared by Escape, the controller's B button and
    // a right click on the desktop: close the frontmost window, or leave the OS
    // when nothing is open. The active window is preferred, falling back to the
    // highest window still on screen so a stale focus state never swallows the
    // press.
    Scene_HypernetOS.prototype.closeTopWindowOrExit = function() {
        const active = document.querySelector('.hypernet-os-window.active:not(.minimized)');
        const win = active || window.HypernetOS.WindowManager.windows
            .filter(w => w.isConnected && !w.classList.contains('minimized'))
            .sort((a, b) => (parseInt(a.style.zIndex, 10) || 0) - (parseInt(b.style.zIndex, 10) || 0))
            .pop();

        if (win) {
            if (window.SoundManager) SoundManager.playCancel();
            window.HypernetOS.WindowManager.closeWindow(win);
        } else {
            this.onExitClick();
        }
    };

    Scene_HypernetOS.prototype.onExitClick = function() {
        if (window.SoundManager) SoundManager.playCancel();
        this.popScene();
    };

    // "Turn Off" leaves the OS entirely, exactly like "Log Off". The old black
    // "safe to turn off" screen that kept the scene alive underneath is gone.
    Scene_HypernetOS.prototype.onTurnOffClick = function() {
        // Close the start menu so it isn't left open when the scene is rebuilt.
        const startMenu = document.getElementById('hypernet-start-menu');
        const startBtn = document.getElementById('hypernet-start-btn');
        if (startMenu) startMenu.classList.remove('open');
        if (startBtn) startBtn.classList.remove('active');

        this.onExitClick();
    };

    // Controller support: B button mirrors Escape (close active window, then
    // exit the OS). Polled via the Gamepad API directly so the raw Escape
    // keydown handler above never double-fires.
    Scene_HypernetOS.prototype.updateGamepadClose = function() {
        // A self-nav app handles B (cancel) itself to walk its own stack back and
        // close at the top level, so the OS does not pre-empt it.
        if (this._activeWindowIsSelfNav()) { this._gamepadBHeld = false; return; }
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let bPressed = false;
        for (const pad of pads) {
            if (pad && pad.connected && pad.buttons[1] && pad.buttons[1].pressed) bPressed = true;
        }
        if (bPressed && !this._gamepadBHeld) {
            this._gamepadBHeld = true;
            this.closeTopWindowOrExit();
        } else if (!bPressed) {
            this._gamepadBHeld = false;
        }
    };

    Scene_HypernetOS.prototype._dispatchMouse = function(el, type) {
        if (!el) return;
        el.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
            clientX: this._cursorX, clientY: this._cursorY
        }));
    };

    // Left analog stick moves a virtual cursor; gamepad A (button 0) clicks
    // whatever element it is over. Hover events are synthesized so :hover styles
    // and mouseover handlers behave like a real pointer.
    Scene_HypernetOS.prototype.updateAnalogCursor = function() {
        if (!window.AnalogStickInput || !this._analogCursor) return;

        const ax = AnalogStickInput.leftX();
        const ay = AnalogStickInput.leftY();
        if (ax !== 0 || ay !== 0) {
            // Moving the stick switches out of focus-ring mode into free cursor.
            this._navMode = 'cursor';
            if (this._navHighlight) this._navHighlight.style.display = 'none';
            const speed = 11; // px/frame at full deflection
            this._cursorX = Math.max(0, Math.min(window.innerWidth - 1, this._cursorX + ax * speed));
            this._cursorY = Math.max(0, Math.min(window.innerHeight - 1, this._cursorY + ay * speed));
            this._analogCursor.style.display = 'block';
            this._analogCursor.style.left = this._cursorX + 'px';
            this._analogCursor.style.top = this._cursorY + 'px';

            const el = document.elementFromPoint(this._cursorX, this._cursorY);
            if (el !== this._lastHoverEl) {
                this._dispatchMouse(this._lastHoverEl, 'mouseout');
                this._dispatchMouse(el, 'mouseover');
                this._lastHoverEl = el;
            }
            this._dispatchMouse(el, 'mousemove');
        }

        // A button = click at the cursor (edge-triggered)
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let aPressed = false;
        for (const pad of pads) {
            if (pad && pad.connected && pad.buttons[0] && pad.buttons[0].pressed) aPressed = true;
        }
        // A-click here only when the analog cursor is the active input mode;
        // in focus-ring mode updateGamepadNav() owns the A button instead.
        if (this._navMode !== 'focus') {
            if (aPressed && !this._cursorAHeld) {
                this._cursorAHeld = true;
                const el = document.elementFromPoint(this._cursorX, this._cursorY);
                if (el) {
                    this._dispatchMouse(el, 'mousedown');
                    this._dispatchMouse(el, 'mouseup');
                    if (typeof el.click === 'function') el.click();
                }
            } else if (!aPressed) {
                this._cursorAHeld = false;
            }
        }
    };

    Scene_HypernetOS.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        this.updateGamepadClose();
        this.updateGamepadNav();
        this.updateAnalogCursor();
        this._updateFocusHighlight();
        if (window.HypernetOS.Kernel) window.HypernetOS.Kernel.tick();
        if (window.HypercapitalisEmporiumApp && typeof window.HypercapitalisEmporiumApp.update === 'function') window.HypercapitalisEmporiumApp.update();
        if (window.HypernetStockApp && typeof window.HypernetStockApp.update === 'function') window.HypernetStockApp.update();
        if (window.HypernetNewsApp && typeof window.HypernetNewsApp.update === 'function') window.HypernetNewsApp.update();
        if (window.HypernetJobsApp && typeof window.HypernetJobsApp.update === 'function') window.HypernetJobsApp.update();
        if (window.HypernetBankApp && typeof window.HypernetBankApp.update === 'function') window.HypernetBankApp.update();
    };

    Scene_HypernetOS.prototype.terminate = function() {
        Scene_MenuBase.prototype.terminate.call(this);

        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }

        // Remove keyboard hooks
        if (this._handleKeyDown) {
            document.removeEventListener('keydown', this._handleKeyDown);
        }

        // Remove the desktop grid re-flow hook
        if (this._desktopResizeHandler) {
            window.removeEventListener('resize', this._desktopResizeHandler);
            this._desktopResizeHandler = null;
        }

        // Remove document click hook (Start Menu close-on-outside-click)
        if (this._documentClickHandler) {
            document.removeEventListener('click', this._documentClickHandler);
            this._documentClickHandler = null;
        }

        // Remove the right-click (close frontmost window) hook
        if (this._contextMenuHandler) {
            if (this._container) {
                this._container.removeEventListener('contextmenu', this._contextMenuHandler);
            }
            this._contextMenuHandler = null;
        }

        // Close all windows
        window.HypernetOS.WindowManager.closeAll();

        // Cleanup DOM element
        if (this._container) {
            if (this._container.parentNode) {
                this._container.parentNode.removeChild(this._container);
            }
            this._container = null;
        }
    };

    // --- Built-in OS Applications ---

    // 1. Task Manager
    window.HypernetOS.registerApp({
        id: 'sys-task-mgr',
        name: T('HypernetOS.taskManager'),
        icon: 111,
        desktopShortcut: false, // Maybe in start menu only? Wait, we can put it on desktop for easy access. Let's make it true.
        launchFn: function() {
            const content = `
                <div class="sys-task-mgr-container">
                    <div class="sys-task-mgr-header">
                        <strong>${T('HypernetOS.systemLoad')}</strong> <span id="task-mgr-cpu">0%</span> CPU | 
                        <strong>${T('HypernetOS.memory')}</strong> <span id="task-mgr-ram">0</span> / <span id="task-mgr-ram-total">0</span> MB
                    </div>
                    <table class="sys-task-mgr-table">
                        <thead>
                            <tr class="sys-task-mgr-thead-tr">
                                <th class="sys-task-mgr-td">${T('HypernetOS.colPid')}</th>
                                <th class="sys-task-mgr-td">${T('HypernetOS.colImageName')}</th>
                                <th class="sys-task-mgr-td">${T('HypernetOS.colMemUsage')}</th>
                                <th class="sys-task-mgr-td">${T('HypernetOS.colCpu')}</th>
                                <th class="sys-task-mgr-td">${T('HypernetOS.colStatus')}</th>
                            </tr>
                        </thead>
                        <tbody id="task-mgr-list"></tbody>
                    </table>
                </div>
            `;
            const win = window.HypernetOS.Syscalls.createWindow({
                id: 'win-task-mgr',
                title: T('HypernetOS.taskManagerTitle'),
                contentHTML: content,
                width: 450,
                height: 350,
                icon: 111
            });

            // Set up update loop on the process
            const kernel = window.HypernetOS.Kernel;
            const proc = kernel.processes.find(p => p.pid === window.HypernetOS.currentLaunchingPid);
            if (proc) {
                // Cached element refs (looked up once the window exists) and a frame
                // counter so the whole process table is only rebuilt ~once/second
                // instead of every kernel tick.
                const els = { win: null, cpu: null, ram: null, list: null };
                let frame = 0;
                proc.executable = {
                    update: function() {
                        if (!els.win || !els.win.isConnected) {
                            els.win = document.getElementById('win-task-mgr');
                            if (!els.win) return; // Window closed
                            els.cpu = document.getElementById('task-mgr-cpu');
                            els.ram = document.getElementById('task-mgr-ram');
                            els.ramTotal = document.getElementById('task-mgr-ram-total');
                            els.list = document.getElementById('task-mgr-list');
                            frame = 0; // force a rebuild on (re)acquire
                        }
                        if ((frame++ % 60) !== 0) return;

                        if (els.cpu) els.cpu.innerText = kernel.totalCPU + '%';
                        if (els.ram) els.ram.innerText = kernel.getUsedRAM();
                        if (els.ramTotal) els.ramTotal.innerText = kernel.totalRAM;

                        if (els.list) {
                            els.list.innerHTML = kernel.processes.map(p => `
                            <tr class="sys-task-mgr-tbody-tr">
                                <td class="sys-task-mgr-td">${p.pid}</td>
                                <td class="sys-task-mgr-td">${p.name}</td>
                                <td class="sys-task-mgr-td">${p.memoryUsage} MB</td>
                                <td class="sys-task-mgr-td">${p.cpuUsage}%</td>
                                <td class="sys-task-mgr-td" style="color: ${p.status === 'RUNNING' ? 'green' : 'gray'}">${p.status}</td>
                            </tr>
                        `).join('');
                        }
                    }
                };
            }
        }
    });

    // 2. Esoteric Terminal
    window.HypernetOS.registerApp({
        id: 'sys-terminal',
        name: T('HypernetOS.commandPrompt'),
        icon: 84, // console icon
        desktopShortcut: true,
        launchFn: function() {
            const content = `
                <div class="sys-terminal-container" id="term-container">
                    <div id="term-output">
                        Hypernet Esoteric OS [Version 2.0.0]<br>
                        (C) Copyright 1985-2001 E-Corp.<br><br>
                    </div>
                    <div class="sys-terminal-input-wrapper">
                        <span id="term-prompt">C:\\></span>
                        <input type="text" id="term-input" class="sys-terminal-input" autocomplete="off" spellcheck="false" autofocus>
                    </div>
                </div>
            `;
            const win = window.HypernetOS.Syscalls.createWindow({
                id: 'win-terminal',
                title: 'C:\\system32\\cmd.exe',  // i18n-ignore  shell path
                contentHTML: content,
                width: 600,
                height: 400,
                icon: 84
            });

            // Focus logic
            const termContainer = document.getElementById('term-container');
            const termInput = document.getElementById('term-input');
            const termOutput = document.getElementById('term-output');
            const termPrompt = document.getElementById('term-prompt');
            
            termContainer.addEventListener('click', () => termInput.focus());

            // The `autofocus` attribute does not fire for innerHTML-injected
            // inputs, so focus the prompt explicitly. Without this the field is
            // not the active element and W/A/S/D drive the OS focus ring instead
            // of being typed into the command line.
            setTimeout(() => termInput.focus(), 50);

            let currentPath = '';

            const printLine = (text) => {
                termOutput.innerHTML += text + '<br>';
                termContainer.scrollTop = termContainer.scrollHeight;
            };

            termInput.addEventListener('keydown', (e) => {
                // Keep keystrokes inside the field so the document-level OS
                // handler never treats W/A/S/D as focus navigation while typing.
                // Escape is allowed to bubble so it can still leave/close the app.
                if (e.key !== 'Escape') e.stopPropagation();
                if (e.key === 'Enter') {
                    const val = termInput.value.trim();
                    printLine(termPrompt.innerText + ' ' + val);
                    termInput.value = '';
                    
                    if (val === '') return;
                    
                    const args = val.split(' ');
                    const cmd = args.shift().toLowerCase();
                    
                    try {
                        if (cmd === 'help') {
                            T.list('HypernetOS.terminalHelp').forEach(printLine);
                        } else if (cmd === 'clear' || cmd === 'cls') {
                            termOutput.innerHTML = '';
                        } else if (cmd === 'echo') {
                            printLine(args.join(' '));
                        } else if (cmd === 'dir') {
                            const efs = window.HypernetOS.EFS;
                            const items = efs.readDir(currentPath);
                            if (items && items.length > 0) {
                                items.forEach(i => printLine('  ' + i));
                            } else {
                                printLine(T('HypernetOS.emptyDir'));
                            }
                        } else if (cmd === 'cd') {
                            if (!args[0]) {
                                printLine(currentPath || 'C:\\');
                            } else {
                                const target = args[0] === '..' ? '' : (currentPath ? currentPath + '/' + args[0] : args[0]);
                                // In a full implementation we'd check if dir exists.
                                currentPath = target;
                                termPrompt.innerText = 'C:\\' + currentPath.replace(/\//g, '\\') + '>';
                            }
                        } else if (cmd === 'run') {
                            if (!args[0]) {
                                printLine(T('HypernetOS.runUsage'));
                            } else if (window.HypernetOS._apps[args[0]]) {
                                printLine(T('HypernetOS.launching', { app: args[0] }));
                                window.HypernetOS.launchApp(args[0]);
                            } else {
                                printLine(T('HypernetOS.appNotFound', { app: args[0] }));
                            }
                        } else {
                            printLine(T('HypernetOS.notRecognized', { cmd: cmd }));
                        }
                    } catch (err) {
                        printLine('Error: ' + err.message);
                    }
                    termContainer.scrollTop = termContainer.scrollHeight;
                }
            });
        }
    });

    // --- Hyper Colosseum App ---
    window.HypernetOS.registerApp({
        id: 'app-colosseum',
        name: T('HypernetOS.colosseum'),
        icon: '',
        desktopShortcut: true,
        launchFn: function () {
            const BRACKETS = [
                { idx: 1,  min: 1,   max: 10,   label: '1 – 10' },
                { idx: 2,  min: 11,  max: 20,   label: '11 – 20' },
                { idx: 3,  min: 21,  max: 30,   label: '21 – 30' },
                { idx: 4,  min: 31,  max: 40,   label: '31 – 40' },
                { idx: 5,  min: 41,  max: 50,   label: '41 – 50' },
                { idx: 6,  min: 51,  max: 60,   label: '51 – 60' },
                { idx: 7,  min: 61,  max: 70,   label: '61 – 70' },
                { idx: 8,  min: 71,  max: 80,   label: '71 – 80' },
                { idx: 9,  min: 81,  max: 90,   label: '81 – 90' },
                { idx: 10, min: 91,  max: 100,  label: '91 – 100' },
                { idx: 11, min: 101, max: 200,  label: '101 – 200' },
                { idx: 12, min: 201, max: 300,  label: '201 – 300' },
                { idx: 13, min: 301, max: 400,  label: '301 – 400' },
                { idx: 14, min: 401, max: 500,  label: '401 – 500' },
                { idx: 15, min: 501, max: 9999, label: '501+' }
            ];

            let selectedIdx = 0;

            const countEnemies = (min, max) => {
                if (typeof ArenaBattleHandler === 'undefined' || !$dataTroops) return 0;
                let n = 0;
                for (let i = 1; i < $dataTroops.length; i++) {
                    const t = $dataTroops[i];
                    if (!t || t.members.length !== 1) continue;
                    const enemy = $dataEnemies[t.members[0].enemyId];
                    if (!enemy) continue;
                    const { level } = ArenaBattleHandler.parseEnemyNotes(enemy);
                    const lv = Number(level) || 0;
                    if (lv >= min && lv <= max) n++;
                }
                return n;
            };

            const renderList = () => {
                const el = document.getElementById('colosseum-list');
                if (!el) return;
                el.innerHTML = BRACKETS.map((b, i) => {
                    const cnt = countEnemies(b.min, b.max);
                    const sel = i === selectedIdx;
                    // Stable id + .focusable + data-focus-key so the OS focus ring
                    // (keyboard / WASD / D-pad) re-acquires the row after re-render.
                    return `
                        <div id="hc-bracket-${i}" class="focusable" data-focus-key="hc-bracket-${i}" tabindex="0"
                             onclick="window._hcSelect(${i})"
                             style="display:flex; justify-content:space-between; align-items:center; padding:5px 10px; cursor:pointer; border-bottom:1px solid #e8e8e8; background:${sel ? '#316ac5' : 'transparent'}; color:${sel ? '#fff' : '#222'}; font-size:15px; user-select:none">
                            <span>Lv.&nbsp;${b.label}</span>
                            <span style="opacity:0.75; font-size:13px">${cnt}&nbsp;✦</span>
                        </div>`;
                }).join('');
            };

            const renderRight = () => {
                const el = document.getElementById('colosseum-right');
                if (!el) return;
                const b = BRACKETS[selectedIdx];
                const cnt = countEnemies(b.min, b.max);
                const midLv = Math.floor((b.min + Math.min(b.max, 99)) / 2);
                el.innerHTML = `
                    <div style="margin-bottom:8px">
                        <div style="font-size:21px; font-weight:bold; font-family:Georgia,serif; color:#8B1A00; margin-bottom:2px">
                            ${T('HypernetOS.levelBracket', { range: b.label })}
                        </div>
                        <div style="font-size:14px; color:#666">${T.n('HypernetOS.eligibleVessels', cnt)}</div>
                    </div>
                    <div style="background:#f8f8f8; border:1px solid #ddd; padding:10px; font-size:14px; color:#444; line-height:1.75">
                        <strong style="display:block; color:#333; margin-bottom:5px">${T('HypernetOS.randomPartyProtocol')}</strong>
                        <ul style="margin:0; padding-left:16px">
                            <li>${T('HypernetOS.protoDraft')}</li>
                            <li>${T('HypernetOS.protoLevel', { level: midLv })}</li>
                            <li>${T('HypernetOS.protoGear')}</li>
                            <li>${T('HypernetOS.protoHealing')}</li>
                            <li>${T('HypernetOS.protoWin')}</li>
                            <li>${T('HypernetOS.protoRestore')}</li>
                        </ul>
                    </div>
                    <div style="flex:1"></div>
                    <button id="hc-enter-btn" data-focus-key="hc-enter-btn" onclick="window._hcEnter()"
                            style="width:100%; padding:11px; background:linear-gradient(135deg, #6B0000, #C0392B); color:#FFD700; border:1px solid #FF6B6B; font-size:16px; font-weight:bold; font-family:Georgia,serif; letter-spacing:1.5px; cursor:pointer; margin-top:10px; box-shadow:0 2px 5px rgba(0,0,0,0.35); text-shadow:0 1px 2px #000">
                        &nbsp;&nbsp;${T('HypernetOS.enterColosseum')}
                    </button>
                `;
            };

            const contentHTML = `
                <div style="display:flex; flex-direction:column; height:100%; font-family:Tahoma,sans-serif; overflow:hidden; background:#ece9d8">
                    <div style="background:linear-gradient(135deg, #1a0300 0%, #8B1A00 55%, #B22222 100%); padding:11px 16px; display:flex; align-items:center; gap:12px; border-bottom:2px solid #6B0000; flex-shrink:0">
                        <div style="font-size:2.2rem; line-height:1"></div>
                        <div>
                            <div style="color:#FFD700; font-weight:bold; font-size:17px; letter-spacing:2px; font-family:Georgia,serif; text-shadow:1px 1px 2px #000">${T('HypernetOS.colosseumBanner')}</div>
                            <div style="color:#ffccaa; font-size:13px; margin-top:2px">${T('HypernetOS.colosseumTagline')}</div>
                        </div>
                        <div style="margin-left:auto; font-size:13px; color:#ff9966; text-align:right; line-height:1.5">${T('HypernetOS.partyRestoredNote')}</div>
                    </div>
                    <div style="display:flex; flex:1; overflow:hidden">
                        <div style="width:200px; min-width:200px; display:flex; flex-direction:column; border-right:1px solid #aaa; overflow:hidden">
                            <div style="background:#316ac5; color:#fff; padding:3px 8px; font-size:14px; font-weight:bold; flex-shrink:0; letter-spacing:0.3px">${T('HypernetOS.levelBrackets')}</div>
                            <div id="colosseum-list" style="flex:1; overflow-y:auto; background:#fff"></div>
                        </div>
                        <div id="colosseum-right" style="flex:1; display:flex; flex-direction:column; padding:14px; gap:8px; overflow-y:auto"></div>
                    </div>
                    <div style="border-top:1px solid #a0a0a0; padding:2px 8px; background:#ece9d8; font-size:13px; color:#555; flex-shrink:0">
                        ${T('HypernetOS.colosseumHint')}
                    </div>
                </div>`;

            const win = window.HypernetOS.Syscalls.createWindow({
                id: 'win-colosseum',
                title: T('HypernetOS.colosseum'),
                contentHTML,
                width: 680,
                height: 460,
                icon: ''
            });

            window._hcSelect = function (idx) {
                selectedIdx = idx;
                if (window.SoundManager) SoundManager.playCursor();
                renderList();
                renderRight();
            };

            window._hcEnter = function () {
                if (typeof ArenaBattleHandler === 'undefined' || !ArenaBattleHandler.startRandomGauntlet) {
                    console.error('HyperColosseum: ArenaBattleHandler not available.');
                    return;
                }
                const b = BRACKETS[selectedIdx];
                if (window.SoundManager) SoundManager.playOk();
                window.HypernetOS.WindowManager.closeWindow(win);
                SceneManager.pop();
                try {
                    ArenaBattleHandler.startRandomGauntlet(b.idx);
                } catch (e) {
                    // Never crash to the RPG Maker error screen ("It is now safe
                    // to turn off your computer"). Log and fall back to the map.
                    console.error('HyperColosseum: failed to start gauntlet.', e);
                    if (window.SoundManager) SoundManager.playBuzzer();
                }
            };

            win.addEventListener('hypernet-closed', () => {
                delete window._hcSelect;
                delete window._hcEnter;
            });

            renderList();
            renderRight();
        }
    });

})();
