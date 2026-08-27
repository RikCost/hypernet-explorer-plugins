//=============================================================================
// TunableRadio.js - FIXED VERSION
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v1.1.1] Tunable Radio System - Fixed Subfolder Scanning
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help TunableRadio.js
 * 
 * @param noiseFile
 * @text Noise File
 * @desc BGM file to play for static/noise (without extension)
 * @type string
 * @default Noise
 * 
 * @param showInMenu
 * @text Show in Menu
 * @desc Add Radio option to the main menu
 * @type boolean
 * @default true
 * 
 * @param menuText
 * @text Menu Text
 * @desc Text to display in the menu for radio option
 * @type string
 * @default Radio
 * 
 * @param bgmFolders
 * @text BGM Subfolders
 * @desc Comma-separated list of subfolders to scan (leave empty for root only)
 * @type string
 * @default ComigoGames,Moogify,Nocoldiz,Old,RandomMind,TallBeard
 * 
 * @param enableFavorites
 * @text Enable Favorites
 * @desc Allow players to mark stations as favorites
 * @type boolean
 * @default true
 * 
 * @param enableAutoScan
 * @text Enable Auto Scan
 * @desc Add auto-scan feature to find next valid station
 * @type boolean
 * @default true
 * 
 * @param radioVolume
 * @text Radio Volume
 * @desc Default volume for radio playback (0-100)
 * @type number
 * @min 0
 * @max 100
 * @default 85
 * 
 * @param showStationInfo
 * @text Show Station Info
 * @desc Display additional station information
 * @type boolean
 * @default true
 * 
 * @param saveLastStation
 * @text Save Last Station
 * @desc Remember last tuned station between game sessions
 * @type boolean
 * @default true
 * 
 * @command openRadio
 * @text Open Radio
 * @desc Opens the radio interface
 * 
 * @command closeRadio
 * @text Close Radio
 * @desc Closes the radio interface
 * 
 * @command scanStations
 * @text Scan for Stations
 * @desc Rescans BGM folder for new music files
 * 
 * @command setVolume
 * @text Set Radio Volume
 * @desc Sets the radio volume
 * @arg volume
 * @type number
 * @min 0
 * @max 100
 * @default 85
 * 
 * This plugin creates a tunable radio system with AM, FM, and EM bands.
 * Automatically scans BGM folder and subfolders for music files.
 * Creates valid frequencies for each song found.
 * 
 * Features:
 * - Dynamic frequency generation based on actual BGM files
 * - Subfolder support for organized music libraries
 * - Favorites system to mark preferred stations
 * - Auto-scan to find next available station
 * - Volume control and station information
 * - Save/load last tuned station
 * 
 * Controls:
 * - Left/Right: Change frequency
 * - Up/Down: Change band
 * - Page Up/Down: Auto-scan for stations
 * - Enter/Space: Toggle favorite
 * - Shift + Left/Right: Quick tune to favorites
 * - Shift + Up/Down: Adjust volume
 * 
 * Use the "Open Radio" plugin command to show the radio interface.
 * Make sure you have a "Noise.ogg" file in your BGM folder for static.
 */

(() => {
    'use strict';

    const pluginName = 'TunableRadio';
    // Verbose BGM-scan / plugin-command logging is off by default; set to true to
    // trace station scanning. Warnings and errors still log unconditionally.
    const DEBUG = false;
    const dlog = (...args) => { if (DEBUG) console.log(...args); };
    const parameters = PluginManager.parameters(pluginName);
    const noiseFile = parameters['noiseFile'] || 'Noise';
    const showInMenu = parameters['showInMenu'] === 'true';
    const menuText = parameters['menuText'] || 'Radio';
    const bgmFolders = parameters['bgmFolders'] ? parameters['bgmFolders'].split(',').map(s => s.trim()) : [];
    const enableFavorites = parameters['enableFavorites'] === 'true';
    const enableAutoScan = parameters['enableAutoScan'] === 'true';
    const radioVolume = parseInt(parameters['radioVolume']) || 85;
    const showStationInfo = parameters['showStationInfo'] === 'true';
    const saveLastStation = parameters['saveLastStation'] === 'true';

    // Radio system state
    let radioData = {
        isOpen: false,
        currentBand: 0, // 0: AM, 1: FM, 2: EM
        currentFrequency: 0,
        stations: [], // Will be populated dynamically
        bandNames: ['AM', 'FM', 'EM'],
        frequencies: [], // Will be generated based on actual songs
        currentlyPlaying: null,
        totalStations: 0,
        favorites: [], // Array of favorite stations {band, frequency}
        currentVolume: radioVolume,
        isScanning: false,
        scanDirection: 1, // 1 for forward, -1 for backward
        stationInfo: {}, // Additional info for stations
        lastStation: { band: 0, frequency: 0 } // Save last tuned station
    };

    // Key mappings
    Input.keyMapper[27] = 'escape'; // Escape key
    Input.keyMapper[33] = 'pageup'; // Page Up
    Input.keyMapper[34] = 'pagedown'; // Page Down
    Input.keyMapper[13] = 'ok'; // Enter key
    Input.keyMapper[32] = 'ok'; // Space key

    // Determine music genre based on filename and path
    function determineGenre(name, path) {
        const lowerName = name.toLowerCase();
        const lowerPath = path.toLowerCase();

        // Check by subfolder first (more accurate)
        if (lowerPath.includes('comigogames/') || lowerPath.includes('comigogames')) return 'ComigoGames';  // i18n-ignore  genre / folder id
        if (lowerPath.includes('moogify/') || lowerPath.includes('moogify')) return 'Moogify';  // i18n-ignore  genre / folder id
        if (lowerPath.includes('nocoldiz/') || lowerPath.includes('nocoldiz')) return 'Nocoldiz';  // i18n-ignore  genre / folder id
        if (lowerPath.includes('old/') || lowerPath.includes('old')) return 'Old/Classic';  // i18n-ignore  genre / folder id
        if (lowerPath.includes('randommind/') || lowerPath.includes('randommind')) return 'RandomMind';  // i18n-ignore  genre / folder id
        if (lowerPath.includes('') || lowerPath.includes('tallbeard')) return 'TallBeard';  // i18n-ignore  genre / folder id

        // Fallback to filename-based detection
        if (lowerName.includes('battle')) return 'Battle';  // i18n-ignore  genre / folder id
        if (lowerName.includes('town') || lowerName.includes('city')) return 'Town';  // i18n-ignore  genre / folder id
        if (lowerName.includes('field') || lowerName.includes('world')) return 'Field';  // i18n-ignore  genre / folder id
        if (lowerName.includes('dungeon') || lowerName.includes('cave')) return 'Dungeon';  // i18n-ignore  genre / folder id
        if (lowerName.includes('theme') || lowerName.includes('main')) return 'Theme';  // i18n-ignore  genre / folder id
        if (lowerName.includes('boss') || lowerName.includes('final')) return 'Boss';  // i18n-ignore  genre / folder id
        if (lowerName.includes('menu') || lowerName.includes('title')) return 'Menu';  // i18n-ignore  genre / folder id
        if (lowerName.includes('sad') || lowerName.includes('emotional')) return 'Emotional';  // i18n-ignore  genre / folder id
        if (lowerName.includes('happy') || lowerName.includes('cheerful')) return 'Upbeat';  // i18n-ignore  genre / folder id

        return 'Misc';  // i18n-ignore  genre / folder id
    }

    // The genre id above is written into radioData.stationInfo and persisted,
    // so it stays English; this is the label the readout prints.
    const genreLabel = (id) => {
        const key = 'Radio.genre.' + String(id || '');
        return T.has(key) ? T(key) : String(id || '');
    };

    // Save radio data to game variables
    function saveRadioData() {
        if (saveLastStation && $dataSystem && $gameVariables) {
            $gameVariables.setValue(1001, JSON.stringify({
                lastStation: radioData.lastStation,
                favorites: radioData.favorites,
                volume: radioData.currentVolume
            }));
        }
    }

    // Load radio data from game variables
    function loadRadioData() {
        if (saveLastStation && $dataSystem && $gameVariables) {
            try {
                const savedData = JSON.parse($gameVariables.value(1001) || '{}');
                if (savedData.lastStation) {
                    radioData.lastStation = savedData.lastStation;
                    radioData.currentBand = savedData.lastStation.band || 0;
                    radioData.currentFrequency = savedData.lastStation.frequency || 0;
                }
                if (savedData.favorites) {
                    radioData.favorites = savedData.favorites;
                }
                if (savedData.volume) {
                    radioData.currentVolume = savedData.volume;
                }
            } catch (e) {
                console.warn('Could not load radio data:', e);
            }
        }
    }

    // Generate realistic frequencies based on number of songs
    function generateFrequencies(bgmList) {
        const totalSongs = bgmList.length;
        const songsPerBand = Math.ceil(totalSongs / 3);

        radioData.frequencies = {
            AM: [],
            FM: [],
            EM: []
        };

        // AM frequencies (540-1700 kHz)
        for (let i = 0; i < songsPerBand; i++) {
            const freq = 540 + (i * (1160 / Math.max(songsPerBand - 1, 1)));
            radioData.frequencies.AM.push(freq.toFixed(0) + ' kHz');
        }

        // FM frequencies (88.1-107.9 MHz)
        for (let i = 0; i < songsPerBand; i++) {
            const freq = 88.1 + (i * (19.8 / Math.max(songsPerBand - 1, 1)));
            radioData.frequencies.FM.push(freq.toFixed(1) + ' MHz');
        }

        // EM frequencies (1420-10000 MHz)
        for (let i = 0; i < songsPerBand; i++) {
            const freq = 1420 + (i * (8580 / Math.max(songsPerBand - 1, 1)));
            radioData.frequencies.EM.push(freq.toFixed(0) + ' MHz');
        }
    }

    // Distribute stations across bands
    function distributeStations(bgmList) {
        radioData.stations = {
            AM: [],
            FM: [],
            EM: []
        };

        const bands = ['AM', 'FM', 'EM'];
        let currentBand = 0;

        bgmList.forEach((bgm, index) => {
            const band = bands[currentBand];
            radioData.stations[band].push(bgm);
            currentBand = (currentBand + 1) % 3;
        });

        // Ensure each band has at least one empty slot for tuning
        bands.forEach(band => {
            while (radioData.stations[band].length < radioData.frequencies[band].length) {
                radioData.stations[band].push(null);
            }
        });
    }

    // NEW: Enhanced BGM file scanner that properly handles subfolders
    async function scanBGMFiles() {
        dlog('Starting enhanced BGM file scan...');
        const bgmList = [];
        const supportedExtensions = ['.ogg'];

        try {
            // Method 1: Try NW.js file system scanning (most reliable)
            if (await tryNWJSScanning(bgmList, supportedExtensions)) {
                dlog('Used NW.js file system scanning');
                return bgmList;
            }

            // Method 2: Try browser-based approaches
            if (await tryBrowserScanning(bgmList, supportedExtensions)) {
                dlog('Used browser-based scanning');
                return bgmList;
            }

            // Method 3: Fallback to AudioManager and DataSystem
            await tryFallbackScanning(bgmList);
            dlog('Used fallback scanning method');

        } catch (e) {
            console.error('Error during BGM scanning:', e);
            await tryFallbackScanning(bgmList);
        }

        return bgmList;
    }

    // Enhanced NW.js scanning
    async function tryNWJSScanning(bgmList, extensions) {
        if (typeof require === 'undefined') return false;

        try {
            const fs = require('fs');
            const path = require('path');

            dlog('Scanning with NW.js file system...');

            // Scan root BGM folder
            await scanNWJSFolder('audio/bgm/', '', bgmList, extensions, fs, path);  // i18n-ignore  asset path

            // Scan specified subfolders
            for (const folder of bgmFolders) {
                if (folder.trim()) {
                    const folderPath = `audio/bgm/${folder.trim()}/`;  // i18n-ignore  asset path
                    await scanNWJSFolder(folderPath, folder.trim(), bgmList, extensions, fs, path);
                }
            }

            return bgmList.length > 0;
        } catch (e) {
            console.warn('NW.js scanning failed:', e);
            return false;
        }
    }

    // Enhanced NW.js folder scanning with recursive support
    async function scanNWJSFolder(folderPath, folderName, bgmList, extensions, fs, path) {
        try {
            const fullPath = path.join(process.cwd(), folderPath);
            dlog(`Checking folder: ${fullPath}`);

            if (!fs.existsSync(fullPath)) {
                console.warn(`Folder not found: ${fullPath}`);
                return;
            }

            const files = fs.readdirSync(fullPath);
            dlog(`Found ${files.length} items in ${folderPath}`);

            for (const file of files) {
                const filePath = path.join(fullPath, file);
                const stat = fs.statSync(filePath);

                if (stat.isDirectory()) {
                    // Recursively scan subdirectories
                    const subFolderName = folderName ? `${folderName}/${file}` : file;
                    await scanNWJSFolder(`${folderPath}${file}/`, subFolderName, bgmList, extensions, fs, path);
                } else if (stat.isFile()) {
                    const ext = path.extname(file).toLowerCase();
                    if (extensions.includes(ext)) {
                        const nameWithoutExt = path.basename(file, ext);
                        if (nameWithoutExt !== noiseFile) {
                            const displayName = folderName ? `${folderName}: ${nameWithoutExt}` : nameWithoutExt;
                            const relativePath = folderName ? `${folderName}/${nameWithoutExt}` : nameWithoutExt;

                            // Check for duplicates
                            if (!bgmList.some(bgm => bgm.path === relativePath)) {
                                bgmList.push({
                                    name: displayName,
                                    path: relativePath,
                                    folder: folderName || 'root',
                                    fullPath: filePath
                                });
                                dlog(`Found: ${displayName}`);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`Error scanning folder ${folderPath}:`, e);
        }
    }

    // Enhanced browser scanning
    async function tryBrowserScanning(bgmList, extensions) {
        dlog('Trying browser-based scanning...');

        // Try to access window.nw for NW.js detection
        if (typeof window !== 'undefined' && window.nw) {
            return await tryNWAPIScanning(bgmList, extensions);
        }

        // Try IndexedDB scanning for cached files
        return await tryIndexedDBScanning(bgmList);
    }

    // Try NW.js API if available
    async function tryNWAPIScanning(bgmList, extensions) {
        try {
            // This would use NW.js specific APIs if available
            dlog('NW.js API scanning not implemented yet');
            return false;
        } catch (e) {
            console.warn('NW.js API scanning failed:', e);
            return false;
        }
    }

    // Enhanced IndexedDB scanning
    async function tryIndexedDBScanning(bgmList) {
        try {
            dlog('Trying IndexedDB scanning...');

            // Check if there are cached BGM files in browser storage
            if (typeof indexedDB !== 'undefined') {
                // This would scan browser cache for BGM files
                // Implementation depends on how RMMZ caches files
                dlog('IndexedDB available but scanning method needs implementation');
            }

            return false;
        } catch (e) {
            console.warn('IndexedDB scanning failed:', e);
            return false;
        }
    }

    // Enhanced fallback scanning
    async function tryFallbackScanning(bgmList) {
        dlog('Using fallback scanning methods...');

        // Method 1: Try to scan from DataManager
        await scanFromDataManager(bgmList);

        // Method 2: Try to scan from AudioManager cache
        await scanFromAudioManager(bgmList);

        // Method 3: Try to scan from ImageManager (sometimes has file lists)
        await scanFromImageManager(bgmList);

        // Method 4: Manual file detection attempts
        await tryManualFileDetection(bgmList);
    }

    // Enhanced DataManager scanning
    async function scanFromDataManager(bgmList) {
        try {
            dlog('Scanning from DataManager...');

            // Check various data sources
            const sources = [
                $dataSystem?.bgmList,
                $dataSystem?.bgslist,
                $dataSystem?.audioList
            ];

            for (const source of sources) {
                if (source && Array.isArray(source)) {
                    source.forEach(item => {
                        if (item && item.name && item.name !== noiseFile) {
                            addBGMToList(bgmList, item.name, item.name, 'datamanager');
                        }
                    });
                }
            }

            // Also check if DataManager has file manifest
            if (DataManager._databaseFiles) {
                DataManager._databaseFiles.forEach(file => {
                    if (file.src && file.src.includes('bgm')) {
                        const name = file.src.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, '');
                        if (name !== noiseFile) {
                            addBGMToList(bgmList, name, name, 'manifest');
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('DataManager scanning failed:', e);
        }
    }

    // Enhanced AudioManager scanning
    async function scanFromAudioManager(bgmList) {
        try {
            dlog('Scanning from AudioManager...');

            // Check AudioManager cache
            if (AudioManager._bgmBuffer && AudioManager._bgmBuffer._reservedSe) {
                Object.keys(AudioManager._bgmBuffer._reservedSe).forEach(name => {
                    if (name && name !== noiseFile) {
                        addBGMToList(bgmList, name, name, 'audiomanager');
                    }
                });
            }

            // Check other AudioManager properties
            const audioSources = [
                AudioManager._staticBuffers,
                AudioManager._referencedBgm,
                AudioManager._bgmCache
            ];

            audioSources.forEach(source => {
                if (source && typeof source === 'object') {
                    Object.keys(source).forEach(key => {
                        if (key && key !== noiseFile && !key.includes('system')) {
                            addBGMToList(bgmList, key, key, 'audiocache');
                        }
                    });
                }
            });
        } catch (e) {
            console.warn('AudioManager scanning failed:', e);
        }
    }

    // Scan from ImageManager (sometimes has file lists)
    async function scanFromImageManager(bgmList) {
        try {
            dlog('Scanning from ImageManager...');

            if (ImageManager._cache) {
                Object.keys(ImageManager._cache).forEach(key => {
                    if (key.includes('bgm') || key.includes('audio')) {
                        const name = key.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, '');
                        if (name && name !== noiseFile) {
                            addBGMToList(bgmList, name, name, 'imagemanager');
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('ImageManager scanning failed:', e);
        }
    }

    // Manual file detection for known folders
    async function tryManualFileDetection(bgmList) {
        dlog('Trying manual file detection...');

        const testFolders = bgmFolders.length > 0 ? bgmFolders : ['ComigoGames', 'Moogify', 'Nocoldiz', 'Old', 'RandomMind', 'TallBeard'];  // i18n-ignore  bgm folder names
        const commonFiles = [
            'battle', 'town', 'field', 'dungeon', 'boss', 'theme', 'menu', 'title',
            'victory', 'defeat', 'fanfare', 'sad', 'happy', 'mystery', 'calm'
        ];

        // Try to detect files by attempting to load them
        for (const folder of testFolders) {
            for (const baseName of commonFiles) {
                for (let i = 1; i <= 5; i++) {
                    const variants = [
                        `${baseName}`,
                        `${baseName}${i}`,
                        `${baseName}_${i}`,
                        `${folder}_${baseName}`,
                        `${folder.toLowerCase()}_${baseName}`
                    ];

                    for (const variant of variants) {
                        const path = `${folder}/${variant}`;
                        if (await testFileExists(path)) {
                            addBGMToList(bgmList, `${folder}: ${variant}`, path, folder);
                        }
                    }
                }
            }
        }
    }

    // Test if a BGM file exists by trying to load it
    async function testFileExists(path) {
        return new Promise((resolve) => {
            try {
                const audio = new Audio();
                audio.onloadeddata = () => resolve(true);
                audio.onerror = () => resolve(false);
                audio.onabort = () => resolve(false);

                // Try common extensions
                const extensions = ['.ogg', '.m4a', '.wav', '.mp3'];
                let tested = 0;

                const testExtension = (ext) => {
                    audio.src = `audio/bgm/${path}${ext}`;  // i18n-ignore  asset path
                    setTimeout(() => {
                        tested++;
                        if (tested >= extensions.length) {
                            resolve(false);
                        }
                    }, 100);
                };

                extensions.forEach(testExtension);
            } catch (e) {
                resolve(false);
            }
        });
    }

    // Helper function to add BGM to list with duplicate checking
    function addBGMToList(bgmList, displayName, path, folder) {
        if (!bgmList.some(bgm => bgm.path === path)) {
            bgmList.push({
                name: displayName,
                path: path,
                folder: folder
            });
            dlog(`Added: ${displayName} (${folder})`);
        }
    }

    // Initialize the radio system
    async function initializeRadio() {
        dlog('Initializing Enhanced Radio System...');
        dlog(`Configured subfolders: ${bgmFolders.join(', ')}`);

        // Scan for actual BGM files using enhanced methods
        const bgmList = await scanBGMFiles();

        // Remove duplicates and noise file
        const uniqueBGM = bgmList.filter((bgm, index, self) =>
            index === self.findIndex(b => b.path === bgm.path) &&
            bgm.name !== noiseFile &&
            bgm.path !== noiseFile
        );

        radioData.totalStations = uniqueBGM.length;

        if (uniqueBGM.length === 0) {
            console.warn('No BGM files found for radio stations');
            // Add a placeholder station
            uniqueBGM.push({
                name: T('Radio.noMusicFound'),
                path: null,
                folder: 'system'
            });
            radioData.totalStations = 1;
        } else {
            dlog(`Found ${uniqueBGM.length} BGM files for radio stations`);

            // Log found files by folder
            const byFolder = {};
            uniqueBGM.forEach(bgm => {
                const folder = bgm.folder || 'unknown';
                if (!byFolder[folder]) byFolder[folder] = [];
                byFolder[folder].push(bgm.name);
            });

            // Show organized results
            dlog('Files found by source:');
            Object.keys(byFolder).sort().forEach(folder => {
                const icon = folder === 'root' ? '' :
                    folder === 'ComigoGames' ? '' :  // i18n-ignore  console icon table
                        folder === 'Moogify' ? '' :  // i18n-ignore  console icon table
                            folder === 'Nocoldiz' ? '' :  // i18n-ignore  console icon table
                                folder === 'Old' ? '' :  // i18n-ignore  console icon table
                                    folder === 'RandomMind' ? '' :  // i18n-ignore  console icon table
                                        folder === 'TallBeard' ? '♂' : '';  // i18n-ignore  console icon table
                dlog(`  ${icon} ${folder}: ${byFolder[folder].length} files`);

                // Show first few files as examples
                const examples = byFolder[folder].slice(0, 3);
                examples.forEach(name => {
                    dlog(`    • ${name}`);
                });
                if (byFolder[folder].length > 3) {
                    dlog(`    ... and ${byFolder[folder].length - 3} more`);
                }
            });
        }

        // Generate frequencies and distribute across bands
        generateFrequencies(uniqueBGM);
        distributeStations(uniqueBGM);

        // Generate station info
        uniqueBGM.forEach((bgm, index) => {
            if (bgm.path) {
                radioData.stationInfo[bgm.path] = {
                    genre: determineGenre(bgm.name, bgm.path),
                    duration: 'Unknown',  // i18n-ignore  stored station field
                    bitrate: '128 kbps',  // i18n-ignore  stored station field
                    addedTime: new Date().toLocaleDateString(),
                    folder: bgm.folder || 'unknown'
                };
            }
        });

        // Load saved data after initialization
        loadRadioData();

        dlog('Enhanced Radio System initialized successfully');
        dlog(`Total stations: ${radioData.totalStations}`);
        dlog(`Stations per band: AM=${radioData.stations.AM.filter(s => s && s.path).length}, FM=${radioData.stations.FM.filter(s => s && s.path).length}, EM=${radioData.stations.EM.filter(s => s && s.path).length}`);
    }

    // Play current station
    function playCurrentStation() {
        const band = radioData.bandNames[radioData.currentBand];
        const stationsInBand = radioData.stations[band];
        const currentFreq = Math.min(radioData.currentFrequency, stationsInBand.length - 1);
        const station = stationsInBand[currentFreq];

        if (station && station.path) {
            // Play the BGM
            const bgm = {
                name: station.path,
                volume: radioData.currentVolume,
                pitch: 100,
                pan: 0
            };
            AudioManager.playBgm(bgm);
            radioData.currentlyPlaying = station.path;
        } else {
            // Play noise/static
            const noiseBgm = {
                name: noiseFile,
                volume: Math.max(20, radioData.currentVolume - 20), // Quieter static
                pitch: 100 + Math.random() * 10 - 5, // Variable pitch for realism
                pan: 0
            };
            AudioManager.playBgm(noiseBgm);
            radioData.currentlyPlaying = noiseFile;
        }
    }

    // Get station statistics
    function getStationStats() {
        let totalStations = 0;
        let stationsByBand = { AM: 0, FM: 0, EM: 0 };
        let favoriteCount = radioData.favorites.length;

        radioData.bandNames.forEach(band => {
            const validStations = radioData.stations[band].filter(station => station && station.path);
            stationsByBand[band] = validStations.length;
            totalStations += validStations.length;
        });

        return {
            total: totalStations,
            byBand: stationsByBand,
            favorites: favoriteCount
        };
    }

    //=============================================================================
    // Simplified Window_Radio (Hidden, maintained for compatibility)
    //=============================================================================
    class Window_Radio extends Window_Base {
        constructor() {
            super(new Rectangle(0, 0, 1, 1));
            this.visible = false;
        }
        refresh() { }
        isCurrentStationFavorite() {
            return radioData.favorites.some(fav =>
                fav.band === radioData.currentBand &&
                fav.frequency === radioData.currentFrequency
            );
        }
    }

    //=============================================================================
    // Scene_Radio (Skeuomorphic Retro Analog Radio Console Redesign)
    //=============================================================================
    class Scene_Radio extends Scene_MenuBase {
        create() {
            super.create();
            this.createRadioWindow();
            this.createUIRadioDOM();
        }

        createRadioWindow() {
            this._radioWindow = new Window_Radio();
            this._radioWindow.visible = false;
            this.addWindow(this._radioWindow);
        }

        createUIRadioDOM() {
            // Include fonts if not present


            this._dndContainer = document.createElement('div');
            this._dndContainer.id = 'menu-container';
            this._dndContainer.style.position = 'absolute';
            this._dndContainer.style.top = '0';
            this._dndContainer.style.left = '0';
            this._dndContainer.style.width = '100%';
            this._dndContainer.style.height = '100%';
            this._dndContainer.style.zIndex = '1000';
            this._dndContainer.style.background = 'radial-gradient(circle, rgba(18, 10, 5, 0.94) 0%, rgba(5, 3, 1, 0.98) 100%)';
            this._dndContainer.style.display = 'flex';
            this._dndContainer.style.justifyContent = 'center';
            this._dndContainer.style.alignItems = 'center';
            this._dndContainer.style.fontFamily = "'Lora', serif";
            this._dndContainer.style.color = '#ecdcb9';
            this._dndContainer.style.boxSizing = 'border-box';

            document.body.appendChild(this._dndContainer);

            // Append custom skeuomorphic CSS styles
            this.refreshUIRadioDOM();
        }

        refreshUIRadioDOM() {
            if (!this._dndContainer) return;

            const band = radioData.bandNames[radioData.currentBand];
            const stationsInBand = radioData.stations[band];
            const maxFreqIndex = Math.max(0, stationsInBand.length - 1);
            const currentFreqIndex = Math.min(radioData.currentFrequency, maxFreqIndex);

            // Render AM/FM/EM Tick Scales dynamically
            let amTicks = "";
            let fmTicks = "";
            let emTicks = "";
            for (let i = 0; i <= 6; i++) {
                const pct = (i / 6) * 100;
                const amVal = 540 + i * 193;
                const fmVal = (88.1 + i * 3.3).toFixed(1);
                const emVal = 1420 + i * 1430;
                amTicks += `<span style="position:absolute; left:${pct}%; transform:translateX(-50%); font-size:0.732rem; color:rgba(255,180,50,0.65)">${amVal}</span>`;
                fmTicks += `<span style="position:absolute; left:${pct}%; transform:translateX(-50%); font-size:0.732rem; color:rgba(255,180,50,0.65)">${fmVal}</span>`;
                emTicks += `<span style="position:absolute; left:${pct}%; transform:translateX(-50%); font-size:0.732rem; color:rgba(255,180,50,0.65)">${emVal}</span>`;
            }

            this._dndContainer.innerHTML = `
                <div id="skeuo-radio-frame">
                    <!-- Cabinet Header -->
                    <div id="radio-cabinet-header">
                        <div id="brand-logo">${T('Radio.receiver')}</div>
                        <div id="power-toggle" onclick="SceneManager._scene.goBack()" title="${T('Radio.closeRadio')}"></div>
                    </div>

                    <!-- Main Grid -->
                    <div id="radio-main-grid">
                        <!-- Left Speaker -->
                        <div class="speaker-grill-outer">
                            <div class="speaker-grill-inner">
                                <div class="equalizer-container" id="eq-left"></div>
                            </div>
                        </div>

                        <!-- Main Dial Console -->
                        <div id="tuning-console">
                            <!-- Dial Glass Face -->
                            <div id="dial-glass-face">
                                <!-- Dial Needle -->
                                <div id="dial-needle"></div>

                                <!-- AM Scale -->
                                <div class="dial-scale">
                                    <span class="dial-scale-label">AM</span>
                                    <div style="width:100%; height:100%; position:relative; margin-left:24px; width:calc(100% - 30px)">
                                        ${amTicks}
                                    </div>
                                </div>

                                <!-- FM Scale -->
                                <div class="dial-scale">
                                    <span class="dial-scale-label" style="color:#ffcc00">FM</span>
                                    <div style="width:100%; height:100%; position:relative; margin-left:24px; width:calc(100% - 30px)">
                                        ${fmTicks}
                                    </div>
                                </div>

                                <!-- EM Scale -->
                                <div class="dial-scale">
                                    <span class="dial-scale-label" style="color:#ff4400">EM</span>
                                    <div style="width:100%; height:100%; position:relative; margin-left:24px; width:calc(100% - 30px)">
                                        ${emTicks}
                                    </div>
                                </div>
                            </div>

                            <!-- Readout Row -->
                            <div id="digital-readout-row">
                                <div id="nixie-display">--.-</div>
                                <div style="display:flex; align-items:center; gap:8px">
                                    <span style="font-size:0.793rem; color:#8c7667; font-family:'Lora', serif; letter-spacing:0.5px; font-weight:bold">${T('Radio.magicEye')}</span>
                                    <div id="magic-eye-tube" style="width:22px; height:22px; border-radius:50%; border:2px solid #222; background:#331100; box-shadow:inset 0 0 5px rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center">
                                        <div id="magic-eye-glow" style="width:14px; height:14px; border-radius:50%; background:#ff4400; box-shadow:0 0 8px #ff4400; transition:all 0.12s ease"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- Information Screen -->
                            <div id="station-info-screen">
                                <div id="song-title-marquee" style="font-weight:bold; letter-spacing:0.5px; white-space:nowrap; text-transform:uppercase">...</div>
                                <div id="station-sub-details" style="color:#00aa44; font-size:0.854rem; margin-top:2px">...</div>
                            </div>
                        </div>

                        <!-- Right Speaker -->
                        <div class="speaker-grill-outer">
                            <div class="speaker-grill-inner">
                                <div class="equalizer-container" id="eq-right"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Lower Control Deck -->
                    <div id="radio-control-deck">
                        <!-- Volume Knob -->
                        <div class="control-knob-container">
                            <div class="knob-label">${T('Radio.volume')}</div>
                            <div class="knob-base" id="knob-volume">
                                <div class="knob-pointer"></div>
                            </div>
                        </div>

                        <!-- Band Mechanical Keys -->
                        <div id="band-push-buttons">
                            <div class="band-btn" id="btn-band-am" onclick="SceneManager._scene.setBand(0)">AM</div>
                            <div class="band-btn" id="btn-band-fm" onclick="SceneManager._scene.setBand(1)">FM</div>
                            <div class="band-btn" id="btn-band-em" onclick="SceneManager._scene.setBand(2)">EM</div>
                        </div>

                        <!-- Utility Action Keys -->
                        <div id="action-deck-buttons">
                            <div class="utility-btn" id="btn-fav" onclick="SceneManager._scene.toggleFavorite()">★</div>
                            <div class="utility-btn" id="btn-scan" onclick="SceneManager._scene.triggerScan()">${T('Radio.scan')}</div>
                        </div>

                        <!-- Tuning Knob -->
                        <div class="control-knob-container">
                            <div class="knob-label">${T('Radio.tuning')}</div>
                            <div class="knob-base" id="knob-tuning">
                                <div class="knob-pointer"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            this.updateSkeuoRadioDOM();
        }

        updateSkeuoRadioDOM() {
            if (!this._dndContainer) return;

            const band = radioData.bandNames[radioData.currentBand];
            const stationsInBand = radioData.stations[band];
            const maxFreqIndex = Math.max(0, stationsInBand.length - 1);
            const currentFreqIndex = Math.min(radioData.currentFrequency, maxFreqIndex);

            const frequencyStr = radioData.frequencies[band][currentFreqIndex] || 'N/A';
            const station = stationsInBand[currentFreqIndex];
            const isFavorite = this._radioWindow.isCurrentStationFavorite();
            const hasMusic = station && station.path;

            // Cache the DOM refs once (re-acquire if the window was rebuilt), instead
            // of ~12 getElementById lookups every frame.
            let els = this._skeuoEls;
            if (!els || !els.nixie || !els.nixie.isConnected) {
                els = this._skeuoEls = {
                    nixie: document.getElementById('nixie-display'),
                    needle: document.getElementById('dial-needle'),
                    eyeGlow: document.getElementById('magic-eye-glow'),
                    songMarquee: document.getElementById('song-title-marquee'),
                    subDetails: document.getElementById('station-sub-details'),
                    btnAM: document.getElementById('btn-band-am'),
                    btnFM: document.getElementById('btn-band-fm'),
                    btnEM: document.getElementById('btn-band-em'),
                    btnFav: document.getElementById('btn-fav'),
                    knobVol: document.getElementById('knob-volume'),
                    knobTune: document.getElementById('knob-tuning')
                };
                this._skeuoLast = {}; // force all writes on fresh nodes
            }
            const last = this._skeuoLast || (this._skeuoLast = {});

            // 1. Nixie Readout Display
            const nixie = els.nixie;
            if (nixie && last.nixie !== frequencyStr) { nixie.innerText = frequencyStr; last.nixie = frequencyStr; }

            // 2. Needle position on amber Dial Glass
            const needle = els.needle;
            if (needle) {
                const percentage = maxFreqIndex > 0 ? (currentFreqIndex / maxFreqIndex) * 100 : 50;
                // Needle is offset by dial label text padding
                const needleLeft = `calc(32px + ${percentage}% * 0.88)`;
                if (last.needle !== needleLeft) { needle.style.left = needleLeft; last.needle = needleLeft; }
            }

            // 3. Magic Eye Vacuum Tube Glow
            const eyeGlow = els.eyeGlow;
            if (eyeGlow) {
                if (hasMusic) {
                    eyeGlow.style.background = '#00ff66';
                    eyeGlow.style.boxShadow = '0 0 12px #00ff66, 0 0 4px #00ff66';
                    eyeGlow.style.transform = `scale(${1.0 + Math.random() * 0.05})`;
                } else if (radioData.isScanning) {
                    eyeGlow.style.background = '#ff8800';
                    eyeGlow.style.boxShadow = '0 0 10px #ff8800';
                    eyeGlow.style.transform = 'scale(0.85)';
                } else {
                    // White noise/static flicker
                    eyeGlow.style.background = '#ff4400';
                    eyeGlow.style.boxShadow = `0 0 ${6 + Math.random() * 4}px #ff4400`;
                    eyeGlow.style.transform = `scale(${0.9 + Math.random() * 0.1})`;
                }
            }

            // 4. Information Green Screen Details
            const songMarquee = els.songMarquee;
            const subDetails = els.subDetails;
            const useTranslation = ConfigManager.language === 'it';

            if (songMarquee && subDetails) {
                let marqueeText, marqueeColor, subText;
                if (hasMusic) {
                    marqueeText = `♪ ${station.name}`;
                    marqueeColor = '#00ff66';

                    const info = radioData.stationInfo[station.path];
                    if (info) {
                        subText = T('Radio.onAirInfo', { genre: genreLabel(info.genre), quality: info.bitrate });
                    } else {
                        subText = T('Radio.onAirStereo');
                    }
                } else {
                    marqueeText = `--- STATIC NOISE ---`;
                    marqueeColor = '#7f8c8d';
                    subText = `OFF AIR • TUNING BETWEEN BANDS`;
                }
                if (last.marqueeText !== marqueeText) { songMarquee.innerText = marqueeText; last.marqueeText = marqueeText; }
                if (last.marqueeColor !== marqueeColor) { songMarquee.style.color = marqueeColor; last.marqueeColor = marqueeColor; }
                if (last.subText !== subText) { subDetails.innerText = subText; last.subText = subText; }
            }

            // 5. Band Buttons Mechanical Active State
            const amClass = `band-btn ${radioData.currentBand === 0 ? 'active' : ''}`;
            const fmClass = `band-btn ${radioData.currentBand === 1 ? 'active' : ''}`;
            const emClass = `band-btn ${radioData.currentBand === 2 ? 'active' : ''}`;
            if (els.btnAM && last.amClass !== amClass) { els.btnAM.className = amClass; last.amClass = amClass; }
            if (els.btnFM && last.fmClass !== fmClass) { els.btnFM.className = fmClass; last.fmClass = fmClass; }
            if (els.btnEM && last.emClass !== emClass) { els.btnEM.className = emClass; last.emClass = emClass; }

            // 6. Favorites Active Star Button State
            const btnFav = els.btnFav;
            if (btnFav) {
                const favClass = isFavorite ? `utility-btn gold-star` : `utility-btn`;
                if (last.favClass !== favClass) { btnFav.className = favClass; last.favClass = favClass; }
            }

            // 7. Rotating volume & tuning knobs
            const knobVol = els.knobVol;
            const knobTune = els.knobTune;
            if (knobVol) {
                const volRot = (radioData.currentVolume / 100) * 270 - 135;
                if (last.volRot !== volRot) { knobVol.style.transform = `rotate(${volRot}deg)`; last.volRot = volRot; }
            }
            if (knobTune) {
                const tuneRot = radioData.currentFrequency * 35;
                if (last.tuneRot !== tuneRot) { knobTune.style.transform = `rotate(${tuneRot}deg)`; last.tuneRot = tuneRot; }
            }
        }

        updateEqualizers() {
            if (!this._dndContainer) return;
            const band = radioData.bandNames[radioData.currentBand];
            const stationsInBand = radioData.stations[band];
            const currentFreqIndex = Math.min(radioData.currentFrequency, stationsInBand.length - 1);
            const station = stationsInBand[currentFreqIndex];
            const hasMusic = station && station.path;

            // Cache the container refs; only re-query if a cached node was detached
            // (window rebuilt). Avoids two getElementById calls per invocation.
            if (!this._eqLeftEl || !this._eqLeftEl.isConnected ||
                !this._eqRightEl || !this._eqRightEl.isConnected) {
                this._eqLeftEl = document.getElementById('eq-left');
                this._eqRightEl = document.getElementById('eq-right');
            }
            const eqLeft = this._eqLeftEl;
            const eqRight = this._eqRightEl;

            if (eqLeft && eqRight) {
                const numBars = 16;

                // Build the bar <div>s once and reuse them; only their height/background
                // are mutated per frame. This avoids tearing down and re-parsing 32 nodes
                // via innerHTML every frame (continuous DOM teardown/reflow).
                const ensureBars = (container) => {
                    if (container.childElementCount !== numBars) {
                        container.innerHTML = "";
                        for (let i = 0; i < numBars; i++) {
                            const bar = document.createElement('div');
                            bar.style.cssText = "width: 3px; height: 4%; border-radius: 2px; transition: height 0.08s ease;";
                            container.appendChild(bar);
                        }
                        this._lastEqColor = null; // force a background repaint on the fresh bars
                    }
                    return container.children;
                };

                const leftBars = ensureBars(eqLeft);
                const rightBars = ensureBars(eqRight);

                const musicColor = "linear-gradient(to top, #00ff66 0%, #ffff00 70%, #ff3300 100%)";  // i18n-ignore  css gradient
                const staticColor = "linear-gradient(to top, #7f8c8d 0%, #5a6466 100%)";  // i18n-ignore  css gradient
                const barColor = (!hasMusic && !radioData.isScanning) ? staticColor : musicColor;

                for (let i = 0; i < numBars; i++) {
                    let height = 4; // Flat default
                    if (radioData.isScanning) {
                        height = 2; // Scanning
                    } else if (hasMusic) {
                        height = Math.floor(Math.random() * 85) + 12;
                    } else {
                        // Jittery static spikes
                        height = Math.random() > 0.88 ? Math.floor(Math.random() * 50) + 6 : Math.floor(Math.random() * 8) + 3;
                    }

                    const heightStr = height + "%";
                    leftBars[i].style.height = heightStr;
                    rightBars[i].style.height = heightStr;
                }

                // The gradient only changes when the music/scanning state changes, so
                // only rewrite backgrounds then rather than every frame.
                if (this._lastEqColor !== barColor) {
                    this._lastEqColor = barColor;
                    for (let i = 0; i < numBars; i++) {
                        leftBars[i].style.background = barColor;
                        rightBars[i].style.background = barColor;
                    }
                }
            }
        }

        setBand(bandIndex) {
            radioData.currentBand = bandIndex;
            radioData.currentFrequency = 0;
            this.updateStation();
        }

        // AM, FM, EM: the three plates on the set, which up and down step
        // through. The step used to be written out twice inside the input
        // handler instead of going through setBand, so the plates and the keys
        // were two ways of doing the same thing that did not share a line.
        cycleBand(direction) {
            const bands = (radioData.bandNames || []).length || 3;
            const next = (radioData.currentBand + direction + bands) % bands;
            this.setBand(next);
        }

        // The power switch on the panel, which is also what Cancel does. It had
        // no method behind it at all, so pressing it did nothing for anybody.
        goBack() {
            SoundManager.playCancel();
            this.popScene();
        }

        toggleFavorite() {
            const currentFav = radioData.favorites.findIndex(fav =>
                fav.band === radioData.currentBand &&
                fav.frequency === radioData.currentFrequency
            );

            if (currentFav !== -1) {
                radioData.favorites.splice(currentFav, 1);
                SoundManager.playCancel();
            } else {
                radioData.favorites.push({
                    band: radioData.currentBand,
                    frequency: radioData.currentFrequency
                });
                SoundManager.playOk();
            }

            this.updateSkeuoRadioDOM();
            saveRadioData();
        }

        // The SCAN plate. PageUp and PageDown scan too (both ways, from the
        // shoulder buttons on a pad), through the same startAutoScan.
        triggerScan() {
            if (enableAutoScan) {
                this.startAutoScan(1);
            }
        }

        update() {
            super.update();
            this.handleRadioInput();

            // Equalizer bars carry a 0.08s CSS transition, so refreshing at ~10Hz
            // (every 6 frames) is visually identical to per-frame while doing 6x
            // less DOM work.
            if (Graphics.frameCount % 6 === 0) {
                this.updateEqualizers();
            }

            // Frame flicker details
            if (Graphics.frameCount % 5 === 0) {
                this.updateSkeuoRadioDOM();
            }
        }

        handleRadioInput() {
            const band = radioData.bandNames[radioData.currentBand];

            // Stop scanning on any key trigger
            if (radioData.isScanning) {
                if (Input.isTriggered('left') || Input.isTriggered('right') || Input.isTriggered('up') || Input.isTriggered('down') || Input.isTriggered('ok') || Input.isTriggered('escape') || Input.isTriggered('cancel')) {
                    radioData.isScanning = false;
                    this.updateSkeuoRadioDOM();
                }
            }

            if (Input.isTriggered('left')) {
                if (Input.isPressed('shift') && enableFavorites) {
                    this.tuneToPreviousFavorite();
                } else {
                    radioData.currentFrequency = (radioData.currentFrequency - 1 + radioData.stations[band].length) % radioData.stations[band].length;
                    this.updateStation();
                }
            } else if (Input.isTriggered('right')) {
                if (Input.isPressed('shift') && enableFavorites) {
                    this.tuneToNextFavorite();
                } else {
                    radioData.currentFrequency = (radioData.currentFrequency + 1) % radioData.stations[band].length;
                    this.updateStation();
                }
            } else if (Input.isTriggered('up')) {
                if (Input.isPressed('shift')) this.adjustVolume(5);
                else this.cycleBand(-1);
            } else if (Input.isTriggered('down')) {
                if (Input.isPressed('shift')) this.adjustVolume(-5);
                else this.cycleBand(1);
            } else if (Input.isTriggered('pageup') && enableAutoScan) {
                this.startAutoScan(-1);
            } else if (Input.isTriggered('pagedown') && enableAutoScan) {
                this.startAutoScan(1);
            } else if (Input.isTriggered('ok') && enableFavorites) {
                this.toggleFavorite();
            } else if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
                this.goBack();
            }
        }

        updateStation() {
            this.updateSkeuoRadioDOM();
            playCurrentStation();
            this.saveCurrentStation();
            SoundManager.playCursor();
        }

        startAutoScan(direction) {
            radioData.isScanning = true;
            radioData.scanDirection = direction;
            this.autoScanStep();
        }

        autoScanStep() {
            if (!radioData.isScanning) return;

            const band = radioData.bandNames[radioData.currentBand];
            let stationsInBand = radioData.stations[band];
            let attempts = 0;
            const maxAttempts = radioData.totalStations * 3;

            while (attempts < maxAttempts) {
                if (radioData.scanDirection > 0) {
                    radioData.currentFrequency = (radioData.currentFrequency + 1) % stationsInBand.length;
                    if (radioData.currentFrequency === 0) {
                        radioData.currentBand = (radioData.currentBand + 1) % 3;
                        const newBand = radioData.bandNames[radioData.currentBand];
                        stationsInBand = radioData.stations[newBand];
                    }
                } else {
                    radioData.currentFrequency = (radioData.currentFrequency - 1 + stationsInBand.length) % stationsInBand.length;
                    if (radioData.currentFrequency === stationsInBand.length - 1) {
                        radioData.currentBand = (radioData.currentBand - 1 + 3) % 3;
                        const newBand = radioData.bandNames[radioData.currentBand];
                        stationsInBand = radioData.stations[newBand];
                        radioData.currentFrequency = stationsInBand.length - 1;
                    }
                }

                const currentStation = radioData.stations[radioData.bandNames[radioData.currentBand]][radioData.currentFrequency];
                if (currentStation && currentStation.path) {
                    radioData.isScanning = false;
                    this.updateStation();
                    SoundManager.playOk();
                    return;
                }

                attempts++;
            }

            radioData.isScanning = false;
            this.updateSkeuoRadioDOM();
            SoundManager.playBuzzer();
        }

        tuneToPreviousFavorite() {
            const favorites = radioData.favorites.slice().reverse();
            let currentIndex = favorites.findIndex(fav =>
                fav.band === radioData.currentBand &&
                fav.frequency === radioData.currentFrequency
            );

            if (currentIndex === -1 && favorites.length > 0) {
                const lastFav = favorites[0];
                radioData.currentBand = lastFav.band;
                radioData.currentFrequency = lastFav.frequency;
                this.updateStation();
            } else if (currentIndex < favorites.length - 1) {
                const nextFav = favorites[currentIndex + 1];
                radioData.currentBand = nextFav.band;
                radioData.currentFrequency = nextFav.frequency;
                this.updateStation();
            }
        }

        tuneToNextFavorite() {
            const currentIndex = radioData.favorites.findIndex(fav =>
                fav.band === radioData.currentBand &&
                fav.frequency === radioData.currentFrequency
            );

            if (currentIndex === -1 && radioData.favorites.length > 0) {
                const firstFav = radioData.favorites[0];
                radioData.currentBand = firstFav.band;
                radioData.currentFrequency = firstFav.frequency;
                this.updateStation();
            } else if (currentIndex < radioData.favorites.length - 1) {
                const nextFav = radioData.favorites[currentIndex + 1];
                radioData.currentBand = nextFav.band;
                radioData.currentFrequency = nextFav.frequency;
                this.updateStation();
            } else if (radioData.favorites.length > 0) {
                const firstFav = radioData.favorites[0];
                radioData.currentBand = firstFav.band;
                radioData.currentFrequency = firstFav.frequency;
                this.updateStation();
            }
        }

        adjustVolume(change) {
            radioData.currentVolume = Math.max(0, Math.min(100, radioData.currentVolume + change));
            this.updateSkeuoRadioDOM();

            if (radioData.currentlyPlaying && AudioManager._bgmBuffer) {
                AudioManager._bgmBuffer.volume = radioData.currentVolume / 100;
            }

            saveRadioData();
            SoundManager.playCursor();
        }

        saveCurrentStation() {
            radioData.lastStation = {
                band: radioData.currentBand,
                frequency: radioData.currentFrequency
            };
            saveRadioData();
        }

        terminate() {
            super.terminate();
            radioData.isOpen = false;
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
    }

    // Open radio interface
    function openRadio() {
        if (radioData.isOpen) return;

        radioData.isOpen = true;
        SceneManager.push(Scene_Radio);
        playCurrentStation();
    }

    // Close radio interface
    function closeRadio() {
        if (!radioData.isOpen) return;

        if (SceneManager._scene instanceof Scene_Radio) {
            SceneManager.pop();
        }
        radioData.isOpen = false;
    }

    // Expose a small public API so other plugins (e.g. VehicleSystem) can open
    // the radio without going through the main menu or a plugin command.
    window.TunableRadio = {
        open: openRadio,
        close: closeRadio,
        get Scene() { return Scene_Radio; }
    };

    // Add radio to main menu
    if (showInMenu) {
        const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
        Window_MenuCommand.prototype.addOriginalCommands = function () {
            _Window_MenuCommand_addOriginalCommands.call(this);
            this.addCommand(menuText, 'radio', true);
        };

        const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function () {
            _Scene_Menu_createCommandWindow.call(this);
            this._commandWindow.setHandler('radio', this.commandRadio.bind(this));
        };

        Scene_Menu.prototype.commandRadio = function () {
            SceneManager.push(Scene_Radio);
        };
    }

    // Enhanced scene management
    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);

        // Auto-scan animation update
        if (radioData.isScanning && radioData.isOpen && SceneManager._scene instanceof Scene_Radio) {
            if (Graphics.frameCount % 30 === 0) { // Scan every 30 frames (0.5 seconds)
                SceneManager._scene.autoScanStep();
            }
        }
    };

    // Initialize when the game starts or on new game
    const _Scene_Boot_start = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function () {
        _Scene_Boot_start.call(this);
        // Initialize radio system asynchronously
        initializeRadio().catch(e => {
            console.error('Failed to initialize radio system:', e);
        });
    };

    // Auto-scan on new game
    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        _DataManager_setupNewGame.call(this);
        dlog('New game started - Rescanning BGM files for radio...');
        // Re-scan BGM files for new game
        setTimeout(() => {
            initializeRadio().then(() => {
                dlog('Radio system ready for new game!');
            }).catch(e => {
                console.error('Failed to scan BGM files on new game:', e);
            });
        }, 100); // Small delay to ensure game is fully loaded
    };

    // Plugin commands
    PluginManager.registerCommand(pluginName, "openRadio", args => {
        openRadio();
    });

    PluginManager.registerCommand(pluginName, "closeRadio", args => {
        closeRadio();
    });

    PluginManager.registerCommand(pluginName, "scanStations", args => {
        dlog('Manual rescan requested - Scanning BGM folder for stations...');
        initializeRadio().then(() => {
            $gameMessage.add(T('Radio.stationsUpdated'));
            dlog('Manual scan completed');
        }).catch(e => {
            console.error('Manual scan failed:', e);
            $gameMessage.add(T('Radio.scanFailed'));
        });
    });

    PluginManager.registerCommand(pluginName, "setVolume", args => {
        const volume = parseInt(args.volume) || 85;
        radioData.currentVolume = Math.max(0, Math.min(100, volume));

        // Update current playing volume
        if (radioData.currentlyPlaying && AudioManager._bgmBuffer) {
            AudioManager._bgmBuffer.volume = radioData.currentVolume / 100;
        }

        saveRadioData();
        $gameMessage.add(T('Radio.volumeSet', { volume: radioData.currentVolume }));
    });

    // Event listener for game save/load
    const _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _DataManager_makeSaveContents.call(this);
        saveRadioData();
        return contents;
    };

    const _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _DataManager_extractSaveContents.call(this, contents);
        // Radio data will be loaded when initializeRadio is called
    };

    // Cleanup on game end
    const _SceneManager_terminate = SceneManager.terminate;
    SceneManager.terminate = function () {
        saveRadioData();
        _SceneManager_terminate.call(this);
    };

    // Enhanced Debug functions (can be called from console)
    window.RadioDebug = {
        getStats: () => getStationStats(),
        listStations: () => {
            dlog('Radio Stations:');
            radioData.bandNames.forEach(band => {
                dlog(`${band} Band:`);
                radioData.stations[band].forEach((station, index) => {
                    if (station && station.path) {
                        const freq = radioData.frequencies[band][index];
                        const isFav = radioData.favorites.some(fav => fav.band === radioData.currentBand && fav.frequency === index);
                        const info = radioData.stationInfo[station.path];
                        dlog(`  ${freq}: ${station.name} ${isFav ? '★' : ''} [${info?.folder || 'unknown'}]`);
                    } else {
                        const freq = radioData.frequencies[band][index];
                        dlog(`  ${freq}: [STATIC]`);
                    }
                });
            });
        },
        addFavorite: (band, frequency) => {
            const bandIndex = radioData.bandNames.indexOf(band.toUpperCase());
            if (bandIndex !== -1) {
                radioData.favorites.push({ band: bandIndex, frequency: frequency });
                saveRadioData();
                dlog(`Added ${band} ${frequency} to favorites`);
            }
        },
        clearFavorites: () => {
            radioData.favorites = [];
            saveRadioData();
            dlog('Cleared all favorites');
        },
        rescanFiles: async () => {
            dlog('Rescanning BGM files...');
            await initializeRadio();
            dlog('Rescan completed');
        },
        showFileLocations: () => {
            dlog('BGM File Locations being scanned:');
            dlog('  Root: audio/bgm/');  // i18n-ignore  asset path
            const defaultFolders = ['ComigoGames', 'Moogify', 'Nocoldiz', 'Old', 'RandomMind', 'TallBeard'];  // i18n-ignore  bgm folder names
            const foldersToScan = bgmFolders.length > 0 ? bgmFolders : defaultFolders;
            foldersToScan.forEach(folder => {
                dlog(`  Subfolder: audio/bgm/${folder}/`);  // i18n-ignore  asset path
            });
            dlog('Supported formats: .ogg');
            dlog('Music sources: ComigoGames, Moogify, Nocoldiz, Old/Classic, RandomMind, TallBeard');
        },
        showCurrentData: () => {
            dlog('Current Radio Data:');
            dlog(`Total Stations Found: ${radioData.totalStations}`);
            dlog('Stations by Band:');
            radioData.bandNames.forEach(band => {
                const validStations = radioData.stations[band]?.filter(s => s && s.path) || [];
                dlog(`  ${band}: ${validStations.length} stations`);
                validStations.forEach((station, i) => {
                    dlog(`    ${i + 1}. ${station.name} (${station.folder})`);
                });
            });
        },
        testFileScanning: async () => {
            dlog('Testing file scanning methods...');
            const bgmList = [];

            dlog('1. Testing NW.js scanning...');
            if (await tryNWJSScanning(bgmList, ['.ogg'])) {
                dlog(`NW.js found ${bgmList.length} files`);
            } else {
                dlog('NW.js scanning failed');
            }

            dlog('2. Testing fallback methods...');
            const fallbackList = [];
            await tryFallbackScanning(fallbackList);
            dlog(`Fallback methods found ${fallbackList.length} files`);

            return { nwjs: bgmList, fallback: fallbackList };
        }
    };

})();