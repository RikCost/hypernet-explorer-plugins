/*:
 * @target MZ
 * @plugindesc v1.1.0 Fixes null reference errors during map transitions
 * @author Fix for hypernet-explorer
 * @help
 * Fixes the "Cannot read property 'scrollType' of null" error that occurs
 * when transitioning between procedural maps at borders.
 *
 * Root cause: Game_Map.isLoopHorizontal() and isLoopVertical() methods
 * access $dataMap.scrollType without null-checking $dataMap first.
 *
 * Also fixes "Cannot read property 'list' of undefined" thrown from
 * Game_Event.start() when a player walks into an event whose live
 * _pageIndex no longer matches its current $dataMap page array (a page
 * removed by an edit, or an event instance left over from before a map
 * reload). Root cause: Game_Event.list() calls this.page().list without
 * checking that page() found a page at all.
 */

(() => {
    'use strict';

    // Fix Game_Map.isLoopHorizontal - add null check on $dataMap
    const _Game_Map_isLoopHorizontal = Game_Map.prototype.isLoopHorizontal;
    Game_Map.prototype.isLoopHorizontal = function() {
        if (!$dataMap) {
            return false; // Return false during map transitions when $dataMap is null
        }
        return _Game_Map_isLoopHorizontal.call(this);
    };

    // Fix Game_Map.isLoopVertical - add null check on $dataMap
    const _Game_Map_isLoopVertical = Game_Map.prototype.isLoopVertical;
    Game_Map.prototype.isLoopVertical = function() {
        if (!$dataMap) {
            return false; // Return false during map transitions when $dataMap is null
        }
        return _Game_Map_isLoopVertical.call(this);
    };

    // Fix Game_Event.list - add null check on page(), which returns
    // undefined when _pageIndex no longer matches a real page.
    Game_Event.prototype.list = function() {
        const page = this.page();
        return page ? page.list : [];
    };

})();
