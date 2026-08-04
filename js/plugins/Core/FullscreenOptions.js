/*:
 * @plugindesc Makes the options window fill the entire game window and auto-sets fullscreen on distributed builds
 * @author Omni-Lex
 *
 * @help This plugin resizes the options window to occupy the entire game window.
 * On distributed games (non-playtesting), fullscreen mode is automatically enabled.
 */

(function() {
    // Auto-set fullscreen on distributed game builds (not during playtesting)
const _Scene_Boot_start = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function() {
        _Scene_Boot_start.call(this);

        if (!Utils.isOptionValid('test')) {
            ConfigManager.fullscreen = true;
            ConfigManager.save(); // persist so the preference survives across sessions

            setTimeout(() => {
                // 1. Force NW.js window focus natively
                if (typeof nw !== 'undefined') {
                    const win = nw.Window.get();
                    win.focus();
                }

                // 2. Request Fullscreen
                if (typeof Graphics.setFullscreen === 'function') {
                    Graphics.setFullscreen(true);
                } else if (typeof Graphics._requestFullScreen === 'function') {
                    Graphics._requestFullScreen();
                }

                // 3. Force the Chromium renderer to redraw by faking a resize event
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 50); 
                
            }, 150);
        }
    };

    // Store the original initialize method
    const _Window_Options_initialize = Window_Options.prototype.initialize;

    // Override the initialize method
    Window_Options.prototype.initialize = function(rect) {
        // Create a rectangle with the size of the game window
        rect = new Rectangle(0, 0, Graphics.boxWidth, Graphics.boxHeight);
        // Call the original method with our modified rectangle
        _Window_Options_initialize.call(this, rect);
    };
})();