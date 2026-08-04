/*:
 * @target MZ
 * @plugindesc v1.0.0 Simulated Virtual File System (VFS) and Registry Manager for HypernetOS.
 * @author Omni-Lex
 * 
 * @help
 * HypernetFileSystem.js
 * 
 * Exposes:
 * - window.HypernetFileSystem.resolvePath(path)
 * - window.HypernetFileSystem.readDir(path)
 * - window.HypernetFileSystem.readFile(path)
 * - window.HypernetFileSystem.writeFile(path, content, mime)
 * - window.HypernetFileSystem.deleteFile(path)
 * - window.HypernetFileSystem.getRegistry(key, defaultValue)
 * - window.HypernetFileSystem.setRegistry(key, value)
 * 
 * Natively persists inside RPG Maker MZ save files via $gameSystem.
 */

(() => {
    'use strict';

    // Hook Game_System to auto-initialize OS data on new game
    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        this.initHypernetOSData();
    };

    Game_System.prototype.initHypernetOSData = function() {
        if (!this._hypernetVFS) {
            this._hypernetVFS = {
                // i18n-ignore-start  VFS path keys, matched literally
                "C:": {
                    type: "directory",
                    name: "C:",
                    children: {
                        "Desktop": {
                            type: "directory",
                            name: "Desktop",
                            children: {}
                        },
                        "Documents": {
                            type: "directory",
                            name: "Documents",
                            children: {
                                "welcome.txt": {
                                    type: "file",
                                    name: "welcome.txt",
                                    mime: "txt",
                                    content: T('HypernetFS.welcomeTxt')
                                },
                                "pockets.txt": {
                                    type: "file",
                                    name: "pockets.txt",
                                    mime: "txt",
                                    content: T('HypernetFS.pocketsTxt')
                                },
                                "diary.txt": {
                                    type: "file",
                                    name: "diary.txt",
                                    mime: "txt",
                                    content: T('HypernetFS.diaryTxt')
                                }
                            }
                        },
                        "System": {
                            type: "directory",
                            name: "System",
                            children: {}
                        }
                        // i18n-ignore-end
                    }
                }
            };
        }
        if (!this._hypernetRegistry) {
            this._hypernetRegistry = {
                "wallpaper": "bliss",
                "theme": "luna-blue"
            };
        }
    };

    window.HypernetFileSystem = {
        getVFS: function() {
            if (typeof $gameSystem !== 'undefined') {
                if (!$gameSystem._hypernetVFS || !$gameSystem._hypernetRegistry) {
                    $gameSystem.initHypernetOSData();
                }
                return $gameSystem._hypernetVFS;
            }
            return null;
        },

        getRegistry: function(key, defaultValue) {
            if (typeof $gameSystem !== 'undefined') {
                if (!$gameSystem._hypernetRegistry) {
                    $gameSystem.initHypernetOSData();
                }
                return $gameSystem._hypernetRegistry[key] !== undefined ? $gameSystem._hypernetRegistry[key] : defaultValue;
            }
            return defaultValue;
        },

        setRegistry: function(key, value) {
            if (typeof $gameSystem !== 'undefined') {
                if (!$gameSystem._hypernetRegistry) {
                    $gameSystem.initHypernetOSData();
                }
                $gameSystem._hypernetRegistry[key] = value;
                
                // If desktop exists, apply visual wallpaper update in real-time
                const desktop = document.getElementById('hypernet-os-desktop');
                if (desktop && key === 'wallpaper') {
                    this.applyWallpaperStyle(desktop, value);
                }
                return true;
            }
            return false;
        },

        applyWallpaperStyle: function(element, wallpaper) {
            if (!element) return;
            element.style.background = ''; // reset inline
            element.className = ''; // reset classes
            
            if (wallpaper === 'bliss') {
                element.style.background = 'linear-gradient(to bottom, #1e5288 0%, #307ec7 40%, #a4c9eb 55%, #66b539 56%, #3a7c1b 100%)';
            } else if (wallpaper === 'teal') {
                element.style.background = '#008080';
            } else if (wallpaper === 'space') {
                element.style.background = 'radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%)';
            } else if (wallpaper === 'gold') {
                element.style.background = 'linear-gradient(135deg, #1f1a16 0%, #3d2f25 100%)';
                element.style.border = '1px solid #c5a059';
            } else {
                element.style.background = wallpaper; // Treat as direct color/url
            }
        },

        // Helper to normalize path, e.g. "C:\\Documents\\welcome.txt" -> ["C:", "Documents", "welcome.txt"]
        _parsePath: function(pathStr) {
            if (!pathStr) return [];
            return pathStr.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
        },

        resolvePath: function(pathStr) {
            const parts = this._parsePath(pathStr);
            let current = this.getVFS();
            if (!current) return null;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (i === 0) {
                    // Match drive letters like "C:"
                    if (current[part]) {
                        current = current[part];
                    } else {
                        return null;
                    }
                } else {
                    if (current.type === 'directory' && current.children && current.children[part]) {
                        current = current.children[part];
                    } else {
                        return null; // Path breaks
                    }
                }
            }
            return current;
        },

        readDir: function(pathStr) {
            const dir = this.resolvePath(pathStr);
            if (dir && dir.type === 'directory') {
                return Object.values(dir.children).map(child => ({
                    name: child.name,
                    type: child.type,
                    mime: child.mime || null
                }));
            }
            return null;
        },

        readFile: function(pathStr) {
            const file = this.resolvePath(pathStr);
            if (file && file.type === 'file') {
                return file.content;
            }
            return null;
        },

        writeFile: function(pathStr, content, mime = 'txt') {
            const parts = this._parsePath(pathStr);
            if (parts.length < 2) return false;

            const fileName = parts.pop();
            const parentPath = parts.join('/');
            const parentDir = this.resolvePath(parentPath);

            if (parentDir && parentDir.type === 'directory') {
                parentDir.children[fileName] = {
                    type: "file",
                    name: fileName,
                    mime: mime,
                    content: content
                };
                return true;
            }
            return false;
        },

        deleteFile: function(pathStr) {
            const parts = this._parsePath(pathStr);
            if (parts.length < 2) return false;

            const fileName = parts.pop();
            const parentPath = parts.join('/');
            const parentDir = this.resolvePath(parentPath);

            if (parentDir && parentDir.type === 'directory' && parentDir.children[fileName]) {
                delete parentDir.children[fileName];
                return true;
            }
            return false;
        }
    };

    // Override Scene_HypernetOS.prototype.createDesktop to apply wallpaper preference automatically
    if (typeof Scene_HypernetOS !== 'undefined') {
        const _Scene_HypernetOS_createDesktop = Scene_HypernetOS.prototype.createDesktop;
        Scene_HypernetOS.prototype.createDesktop = function() {
            _Scene_HypernetOS_createDesktop.call(this);
            const desktop = document.getElementById('hypernet-os-desktop');
            if (desktop) {
                const wallpaperVal = window.HypernetFileSystem.getRegistry("wallpaper", "bliss");
                window.HypernetFileSystem.applyWallpaperStyle(desktop, wallpaperVal);
            }
        };
    }

})();
