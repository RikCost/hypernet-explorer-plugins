/*:
 * @target MZ
 * @plugindesc RimWorld-style Mod Manager. Loads mods from a "mods" folder, overrides files, and manages load order.
 * @author Gemini
 *
 * @help
 * ModManager.js
 * 
 * ============================================================================
 * Overview
 * ============================================================================
 * This plugin allows you to have a "mods" folder in your project root.
 * Inside "mods", each folder is treated as a separate mod.
 * Mods can replicate the game's folder structure to override default files
 * or add entirely new ones.
 * 
 * Example Structure:
 * MyGame/
 *   data/
 *   img/
 *   mods/
 *     MyFirstMod/
 *       data/
 *         Actors.json (Overrides default Actors.json)
 *         CustomData.json (Loaded dynamically into $dataCustom.CustomData)
 *       img/
 *         pictures/
 *           new_pic.png (Can be used in game like a normal picture)
 *     AnotherMod/
 *       ...
 * 
 * ============================================================================
 * Controls in Mod Manager Menu
 * ============================================================================
 * - Enter/OK: Toggle Mod ON/OFF
 * - Left/Right (or Q/W): Move Mod Up/Down in priority.
 *   (Mods at the BOTTOM of the list load LAST, overwriting mods above them).
 * 
 * NOTE: This plugin requires NW.js (PC/Mac Deployment or Playtest).
 */

var Imported = Imported || {};
Imported.ModManager = true;

var ModManager = ModManager || {};
ModManager.mods = [];
ModManager.fs = null;
ModManager.path = null;
ModManager.basePath = "";

// Global object to store custom added JSONs
window.$dataCustom = {};

//-----------------------------------------------------------------------------
// Core System
//-----------------------------------------------------------------------------

(() => {
    if (!Utils.isNwjs()) {
        console.warn("ModManager: NW.js is required. Mod Manager disabled.");
        return;
    }

    ModManager.fs = require('fs');
    ModManager.path = require('path');

    // Get root directory of the game
    const path = require('path');
    const base = path.dirname(process.mainModule.filename);
    ModManager.basePath = base;
    ModManager.modsDir = path.join(base, 'mods');
    ModManager.configFile = path.join(base, 'mod_config.json');
    ModManager.STEAM_APP_ID = 4193010;

    // Steam Workshop EItemState bit flags (ISteamUGC#EItemState).
    const WS_STATE = { Subscribed: 1, Installed: 4, NeedsUpdate: 8, Downloading: 16, DownloadPending: 32 };

    ModManager.initialize = function () {
        this.ensureModsFolder();
        this.loadModConfig();
        this.scanForNewMods();

        // Initialize Steam and pull in subscribed Workshop mods.
        this.initSteamWorkshop();

        this.saveModConfig(); // Clean up config
    };

    ModManager.initSteamWorkshop = function () {
        try {
            // Reuse a client another plugin already initialised, otherwise create one.
            // steamworks.js caches the native module + a single runCallbacks interval, so
            // a second init() here is safe and does not double-pump callbacks.
            if (window.__hypernetSteamClient) {
                this.steamClient = window.__hypernetSteamClient;
            } else {
                const steamworks = require('../libs/steamworks');
                this.steamClient = steamworks.init(this.STEAM_APP_ID);
                window.__hypernetSteamClient = this.steamClient;
            }

            if (!this.steamClient || !this.steamClient.workshop) {
                console.warn("ModManager: Steam is up but the workshop module is missing. " +
                    "Update js/libs/steamworks to a full steamworks.js build to enable Workshop mods.");  // i18n-ignore  console diagnostic
                this.steamClient = null;
                return;
            }
            this.scanSteamWorkshop();
        } catch (e) {
            console.log("ModManager: Steam not available; Workshop mods disabled.", e && e.message);
            this.steamClient = null;
        }
    };

    ModManager.ensureModsFolder = function () {
        if (!this.fs.existsSync(this.modsDir)) {
            this.fs.mkdirSync(this.modsDir);
        }
    };

    ModManager.loadModConfig = function () {
        if (this.fs.existsSync(this.configFile)) {
            try {
                const data = this.fs.readFileSync(this.configFile, 'utf8');
                this.mods = JSON.parse(data);
            } catch (e) {
                console.error("Failed to load mod config.", e);
                this.mods = [];
            }
        } else {
            this.mods = [];
        }
    };

    ModManager.saveModConfig = function () {
        try {
            this.fs.writeFileSync(this.configFile, JSON.stringify(this.mods, null, 2));
        } catch (e) {
            console.error("Failed to save mod config.", e);
        }
    };

    ModManager.scanForNewMods = function () {
        const folders = this.fs.readdirSync(this.modsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // Remove deleted mods from config (only for local mods)
        this.mods = this.mods.filter(mod => mod.path || folders.includes(mod.name));

        // Add new mods to config (default to active: false)
        const existingModNames = this.mods.map(m => m.name);
        for (const folder of folders) {
            if (!existingModNames.includes(folder)) {
                this.mods.push({ name: folder, active: false });
            }
        }
    };

    // Pulls every subscribed Workshop item into the mod list. Installed items are wired
    // up by their absolute content folder; not-yet-downloaded items are queued for
    // download and picked up on a later scan (relaunch or ModManager.refreshWorkshop()).
    ModManager.scanSteamWorkshop = function () {
        if (!this.steamClient) return;
        const workshop = this.steamClient.workshop;
        if (!workshop || typeof workshop.getSubscribedItems !== 'function') {
            console.warn("ModManager: Steam workshop API unavailable.");
            return;
        }

        let itemIds;
        try {
            itemIds = workshop.getSubscribedItems() || [];
        } catch (e) {
            console.error("ModManager: getSubscribedItems failed:", e);
            return;
        }

        const seenNames = [];
        for (const itemId of itemIds) {
            const modName = `Workshop_${itemId.toString()}`;
            seenNames.push(modName);

            let info = null;
            try { info = workshop.installInfo(itemId); } catch (e) { info = null; }

            let state = 0;
            try { if (typeof workshop.state === 'function') state = workshop.state(itemId); } catch (e) { state = 0; }
            const needsUpdate = (state & WS_STATE.NeedsUpdate) !== 0;

            if (info && info.folder && this.fs.existsSync(info.folder)) {
                const existing = this.mods.find(m => m.name === modName);
                if (existing) {
                    existing.path = info.folder;
                    existing.workshop = true;
                    if (typeof existing.active !== 'boolean') existing.active = true;
                } else {
                    // New subscription defaults to active so it loads immediately.
                    this.mods.push({ name: modName, active: true, path: info.folder, workshop: true });
                }
                if (needsUpdate) this.requestWorkshopDownload(itemId, modName, "update available");  // i18n-ignore  console diagnostic
            } else {
                // Subscribed but not on disk yet: request a high-priority download.
                this.requestWorkshopDownload(itemId, modName, "not installed yet");  // i18n-ignore  console diagnostic
            }
        }

        // Drop Workshop mods the player has unsubscribed from (leave local mods alone).
        this.mods = this.mods.filter(m => !m.workshop || seenNames.includes(m.name));
    };

    ModManager.requestWorkshopDownload = function (itemId, modName, reason) {
        const workshop = this.steamClient && this.steamClient.workshop;
        if (!workshop || typeof workshop.download !== 'function') return;
        try {
            workshop.download(itemId, true);
            console.log(`ModManager: Workshop item ${modName} ${reason}; download requested (will load after it finishes).`);
        } catch (e) {
            console.warn(`ModManager: failed to request download for ${modName}:`, e && e.message);
        }
    };

    // Re-scan subscribed Workshop items at runtime (e.g. after a download completes).
    // Returns true if a Steam client is available. Callers should reload data/images
    // afterwards or prompt the player to restart for a clean apply.
    ModManager.refreshWorkshop = function () {
        if (!this.steamClient) return false;
        this.scanSteamWorkshop();
        this.saveModConfig();
        return true;
    };

    // --- Optional: publish a local mod folder to the Steam Workshop -----------------
    // Usage (from console or a plugin command):
    //   await ModManager.publishMod('MyFirstMod', { title: 'My Mod', description: '...', previewPath: 'C:/abs/preview.png', tags: ['Gameplay'] })
    // Returns the new Workshop item id (bigint). Update later with updatePublishedMod().
    ModManager.publishMod = async function (localModName, details) {
        const workshop = this.steamClient && this.steamClient.workshop;
        if (!workshop || typeof workshop.createItem !== 'function') throw new Error("Steam Workshop unavailable");
        const modDir = this.path.join(this.modsDir, localModName);
        if (!this.fs.existsSync(modDir)) throw new Error("Mod folder not found: " + localModName);

        const created = await workshop.createItem(this.STEAM_APP_ID);
        const update = Object.assign({
            title: localModName,
            description: "",
            contentPath: modDir,
            tags: []
        }, details || {});
        await workshop.updateItem(created.itemId, update, this.STEAM_APP_ID);
        console.log("ModManager: published Workshop item", created.itemId.toString(),
            created.needsToAcceptAgreement ? "(user must accept the Workshop legal agreement in the browser popup)" : "");
        return created.itemId;
    };

    ModManager.updatePublishedMod = async function (itemId, localModName, details) {
        const workshop = this.steamClient && this.steamClient.workshop;
        if (!workshop || typeof workshop.updateItem !== 'function') throw new Error("Steam Workshop unavailable");
        const modDir = this.path.join(this.modsDir, localModName);
        if (!this.fs.existsSync(modDir)) throw new Error("Mod folder not found: " + localModName);
        const id = (typeof itemId === 'bigint') ? itemId : BigInt(itemId);
        const update = Object.assign({ contentPath: modDir }, details || {});
        return workshop.updateItem(id, update, this.STEAM_APP_ID);
    };

    // Resolves a path. If an active mod overrides it, returns the mod path.
    ModManager.resolvePath = function (localPath) {
        if (!Utils.isNwjs()) return localPath;

        // Traverse backwards so mods at the bottom of the list (highest priority) get checked first
        for (let i = this.mods.length - 1; i >= 0; i--) {
            const mod = this.mods[i];
            if (mod.active) {
                const moddedPath = mod.path ? this.path.join(mod.path, localPath) : this.path.join(this.modsDir, mod.name, localPath);
                if (this.fs.existsSync(moddedPath)) {
                    // Return formatted for web request
                    if (mod.path) {
                        return "file:///" + moddedPath.replace(/\\/g, "/");
                    }
                    return `mods/${mod.name}/${localPath}`;  // i18n-ignore  asset path
                }
            }
        }
        return localPath; // Fallback to base game path
    };

    // Load custom JSONs dynamically
    ModManager.loadCustomData = function () {
        for (const mod of this.mods) {
            if (!mod.active) continue;

            const modDataDir = mod.path ? this.path.join(mod.path, 'data') : this.path.join(this.modsDir, mod.name, 'data');
            if (this.fs.existsSync(modDataDir)) {
                const files = this.fs.readdirSync(modDataDir).filter(f => f.endsWith('.json'));

                for (const file of files) {
                    const baseName = file.replace('.json', '');
                    // i18n-ignore-start  RPG Maker data file names, matched literally
                    const standardMZFiles = [
                        "Actors", "Classes", "Skills", "Items", "Weapons", "Armors",
                        "Enemies", "Troops", "States", "Animations", "Tilesets",
                        "CommonEvents", "System", "MapInfos"
                    ];
                    // i18n-ignore-end

                    // If it's NOT a standard RM file, load it custom
                    if (!standardMZFiles.includes(baseName) && !baseName.startsWith("Map")) {  // i18n-ignore  data file prefix
                        const url = mod.path ? "file:///" + this.path.join(modDataDir, file).replace(/\\/g, "/") : `mods/${mod.name}/data/${file}`;  // i18n-ignore  asset path
                        this.loadCustomDataFile(baseName, url);
                    }
                }
            }
        }
    };

    ModManager.loadCustomDataFile = function (name, src) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", src);
        xhr.overrideMimeType("application/json");
        xhr.onload = () => {
            if (xhr.status < 400) {
                try {
                    $dataCustom[name] = JSON.parse(xhr.responseText);
                    console.log(`Loaded custom mod data: ${name}`);
                } catch (e) {
                    console.warn(`ModManager: failed to parse custom mod data '${name}', skipping.`, e);
                }
            }
        };
        xhr.send();
    };

    // Initialize the manager immediately
    ModManager.initialize();

    //-----------------------------------------------------------------------------
    // Core Overrides for Path Redirection
    //-----------------------------------------------------------------------------

    // Override DataManager to intercept JSON loads
    const _DataManager_loadDataFile = DataManager.loadDataFile;
    DataManager.loadDataFile = function (name, src) {
        const originalPath = "data/" + src;
        const redirectedPath = ModManager.resolvePath(originalPath);

        // Temporarily change src to our redirected path
        // MZ internally prepends "data/", so we have to adjust if it's modded.
        if (redirectedPath !== originalPath) {
            // It's a modded path. We'll use a custom XHR for standard data to bypass MZ's strict pathing
            const xhr = new XMLHttpRequest();
            xhr.open("GET", redirectedPath);
            xhr.overrideMimeType("application/json");
            xhr.onload = () => this.onXhrLoad(xhr, name, src, redirectedPath);
            xhr.onerror = () => this.onXhrError(name, src, redirectedPath);
            window[name] = null;
            xhr.send();
        } else {
            _DataManager_loadDataFile.call(this, name, src);
        }
    };

    // Trigger custom data loading after main database loads
    const _DataManager_loadDatabase = DataManager.loadDatabase;
    DataManager.loadDatabase = function () {
        _DataManager_loadDatabase.call(this);
        ModManager.loadCustomData();
    };

    // Override ImageManager to intercept Image loads
    const _ImageManager_loadBitmap = ImageManager.loadBitmap;
    ImageManager.loadBitmap = function (folder, filename) {
        if (filename) {
            const originalPath = folder + Utils.encodeURI(filename) + ".png";
            const redirectedPath = ModManager.resolvePath(originalPath);
            if (redirectedPath !== originalPath) {
                // If it's modded, strip the filename out so we can pass the whole redirected path
                // This is a bit hacky due to MZ's architecture, but effective.
                let url = redirectedPath;
                return Bitmap.load(url);
            }
        }
        return _ImageManager_loadBitmap.call(this, folder, filename);
    };

    // Override AudioManager to intercept Audio loads
    const _AudioManager_createBuffer = AudioManager.createBuffer;
    AudioManager.createBuffer = function (folder, name) {
        const ext = this.audioFileExt();
        const originalPath = (this._path || "audio/") + folder + Utils.encodeURI(name) + ext;
        const redirectedPath = ModManager.resolvePath(originalPath);

        // WebAudio doesn't strictly prepend the folder if we pass a full URL
        let url = redirectedPath;
        const buffer = new WebAudio(url);
        buffer.name = name;
        buffer.frameCount = this.frameCount;
        return buffer;
    };


    //-----------------------------------------------------------------------------
    // Title Menu Integration & UI
    //-----------------------------------------------------------------------------

    const _Window_TitleCommand_makeCommandList = Window_TitleCommand.prototype.makeCommandList;
    Window_TitleCommand.prototype.makeCommandList = function () {
        _Window_TitleCommand_makeCommandList.call(this);
        this.addCommand(T('ModManager.menu'), 'mods');
    };

    const _Scene_Title_createCommandWindow = Scene_Title.prototype.createCommandWindow;
    Scene_Title.prototype.createCommandWindow = function () {
        _Scene_Title_createCommandWindow.call(this);
        this._commandWindow.setHandler('mods', this.commandMods.bind(this));
    };

    Scene_Title.prototype.commandMods = function () {
        this._commandWindow.close();
        SceneManager.push(window.Scene_ModManager);
    };

})();