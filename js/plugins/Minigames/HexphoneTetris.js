//=============================================================================
// HexphoneTetris.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc [v2.0.0] DEPRECATED - Tetris is now built into HexphoneSystem
 * @author Omni-Lex
 * @help HexphoneTetris.js
 *
 * Tetris (and Snake) are implemented directly inside HexphoneSystem.js
 * since v3.0.0. This plugin is kept only so old plugin lists do not break;
 * it does nothing when the built-in game is present.
 *
 * To add a new phone game from your own plugin, call:
 *   window.registerHexphoneGame('MyGame', {
 *       create: () => ({
 *           update(scene) { ... },        // once per frame while playing
 *           draw(bitmap) { ... },         // 250x170 LCD content bitmap
 *           onKey(value) { ... }          // keypad digits, '*', '#', 'menu'
 *       })
 *   });
 */

(() => {
    'use strict';
    // Intentionally empty: superseded by the Tetris built into HexphoneSystem.js
})();
