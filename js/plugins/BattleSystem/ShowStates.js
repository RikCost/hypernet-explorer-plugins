//=============================================================================
// StateListMenu.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Adds a menu scene displaying all states and their descriptions in a two-pane layout, with removal conditions.
 * @author OmniLex
 *
 * @command ShowStates
 * @text Show State List
 * @desc Opens the state list scene showing state names, descriptions, and removal conditions.
 *
 * @help
 * This plugin provides a new plugin command 'ShowStates' which, when executed,
 * will open a custom scene displaying all states (with non-empty names) in a
 * selectable list on the left pane and their details on the right pane.
 *
 * On the right pane, each state's note field and its removal conditions are shown.
 *
 * Italian translations are shown automatically when RPG Maker's language is set to Italian.
 *
 * Usage:
 *   PluginCommand: ShowStates
 */
(() => {
    const pluginName = "ShowStates";

    // Build labels from the CURRENT language each time. Capturing them once at
    // IIFE load froze the language (and could be undefined -> English before
    // ConfigManager loaded), so a runtime language switch never took effect.
    const buildLabels = () => ({
        removalHeader: T('Battle.states.removalHeader'),
        atBattleEnd:   T('Battle.states.atBattleEnd'),
        byRestriction: T('Battle.states.byRestriction'),
        byDamage:      T('Battle.states.byDamage'),
        byWalking:     T('Battle.states.byWalking'),
    });

    PluginManager.registerCommand(pluginName, 'ShowStates', () => {
        if (window.Scene_StateList) SceneManager.push(window.Scene_StateList);
    });

    window.ShowStates = {
        // Re-evaluates on every access so consumers (ShowStatesUI) always read
        // labels for the language active at render time.
        get L() { return buildLabels(); },
        getStates: () => $dataStates.filter(s => s && s.name),
    };
})();