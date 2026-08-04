/*:
 * @target MZ
 * @plugindesc Handles battle music selection with independent window and Options menu integration
 * @author Omni-Lex.ai
 *
 * @command openMusicSelectionWindow
 * @text Open Music Selection Window
 * @desc Opens the music selection window in a separate scene
 *
 * @help
 * Music Selection System
 * =====================
 * This plugin provides a standalone music selection system independent from the
 * character creation process. Features include:
 *
 * - Music selection window accessible from Options menu
 * - Configurable battle music tracks
 * - Music preview functionality
 * - Persistent music selection via ConfigManager
 * - Bilingual support (English/Italian)
 *
 * Available Battle Music:
 * - Drums (RandomMind/Battle)
 * - Shortcuts (ZaneMusic/shortcuts)
 * -  (TallBeard)
 * - Melodic Techno (Moogify/MelodicTechno)
 * - Battle1-Battle8 (KADOGAWA)
 *
 * Custom Battle Music:
 * Players can add their own tracks by copying audio files into the
 * audio/bgm/BattleMusic/ folder. Each file is scanned at startup and shown as a
 * selectable track (named after the filename) in every battle music selector.
 * Desktop / NW.js builds only. See the README in that folder.
 */

(() => {
  const pluginName = "MusicSelectionSystem";

  // Special sentinel values
  const MUSIC_NONE     = "__none__";
  const MUSIC_MAP      = "__map__";

  // Folder (under audio/bgm/) players can drop their own battle tracks into.
  const CUSTOM_FOLDER = "BattleMusic";

  // Music tracks available for selection
  const MUSIC_TRACKS = [
    { get name() { return T('MusicSelection.trackNone'); },              value: MUSIC_NONE, composer: "" },
    { get name() { return T('MusicSelection.trackMap'); }, value: MUSIC_MAP,  composer: "" },
    { name: "Drums", value: "RandomMind/Battle", composer: "RandomMind" },  // i18n-ignore  bgm track, named after its file
    { name: "Shortcuts", value: "ZaneMusic/shortcuts", composer: "ZaneMusic" },  // i18n-ignore  bgm track, named after its file
    { name: "Melodic Techno", value: "Moogify/MelodicTechno", composer: "Moogify" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle1", value: "Battle1", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle2", value: "Battle2", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle3", value: "Battle3", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle4", value: "Battle4", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle5", value: "Battle5", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle6", value: "Battle6", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle7", value: "Battle7", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
    { name: "Battle8", value: "Battle8", composer: "KADOGAWA" },  // i18n-ignore  bgm track, named after its file
  ];

  // Scan audio/bgm/BattleMusic for player-supplied tracks (desktop / NW.js only).
  // Each audio file becomes a selectable track whose value is "BattleMusic/<name>".
  function scanCustomTracks() {
    const tracks = [];
    try {
      if (window.Utils && Utils.isNwjs && Utils.isNwjs()) {
        const fs = require("fs");
        const path = require("path");
        const dir = path.join(path.dirname(process.mainModule.filename), "audio", "bgm", CUSTOM_FOLDER);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const seen = {};
        for (const file of fs.readdirSync(dir)) {
          const m = file.match(/^(.+)\.(ogg|m4a|mp3|wav)$/i);
          if (!m) continue;
          const base = m[1];
          if (seen[base]) continue; // ignore duplicate extensions (e.g. .ogg + .m4a)
          seen[base] = true;
          tracks.push({ name: base, value: CUSTOM_FOLDER + "/" + base, composer: "Custom" });  // i18n-ignore  composer id for player-supplied tracks
        }
      }
    } catch (e) {
      console.error("MusicSelectionSystem: failed to scan custom battle music", e);
    }
    return tracks;
  }

  // Append any custom tracks found on disk so they show up in every selector.
  Array.prototype.push.apply(MUSIC_TRACKS, scanCustomTracks());

  // Helper function for localized text
  function getLocalizedText(english, italian) {
    return ConfigManager.language === "it" ? italian : english;
  }

  // Battle Music Configuration
  Object.defineProperty(ConfigManager, "battleMusicName", {
    get: function () {
      return this._battleMusicName !== undefined ? this._battleMusicName : "RandomMind/Battle";
    },
    set: function (value) {
      this._battleMusicName = value;
    },
    configurable: true,
  });

  const _ConfigManager_makeData = ConfigManager.makeData;
  ConfigManager.makeData = function () {
    const config = _ConfigManager_makeData.call(this);
    config.battleMusicName = this.battleMusicName;
    return config;
  };

  const _ConfigManager_applyData = ConfigManager.applyData;
  ConfigManager.applyData = function (config) {
    _ConfigManager_applyData.call(this, config);
    this.battleMusicName = this.readBattleMusicName(config);
  };

  ConfigManager.readBattleMusicName = function (config) {
    return config.battleMusicName !== undefined
      ? config.battleMusicName
      : "RandomMind/Battle";
  };

  // Apply battle music when battle starts
  const _BattleManager_playBattleBgm = BattleManager.playBattleBgm;
  BattleManager.playBattleBgm = function () {
    const sel = ConfigManager.battleMusicName;
    if (sel === MUSIC_NONE) {
      AudioManager.stopBgm();
    } else if (sel === MUSIC_MAP) {
      // Keep current map music playing ,  do nothing
    } else if (sel) {
      AudioManager.playBgm({ name: sel, volume: 90, pitch: 100, pan: 0 });
    } else {
      _BattleManager_playBattleBgm.call(this);
    }
  };

  // Plugin command
  PluginManager.registerCommand(pluginName, "openMusicSelectionWindow", () => {
    if (window.Scene_MusicSelection) SceneManager.push(window.Scene_MusicSelection);
  });

  // Add Battle Music option to Options menu
  if (window.GameOptions) {
    window.GameOptions.registerOption('battleMusicName', T('MusicSelection.battleMusic'),
      () => ConfigManager.battleMusicName,
      function(value) { ConfigManager.battleMusicName = value; ConfigManager.save(); },
      'audio', 'custom',
      function(value) { return this.battleMusicStatusText(); },
      function() { this.changeBattleMusic(); },
      function() {
        const currentIndex = MUSIC_TRACKS.findIndex(t => t.value === ConfigManager.battleMusicName);
        const nextIndex = (currentIndex - 1 + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
        const next = MUSIC_TRACKS[nextIndex];
        ConfigManager.battleMusicName = next.value;
        ConfigManager.save();
        if (next.value === MUSIC_NONE) { AudioManager.stopBgm(); }
        else if (next.value !== MUSIC_MAP) { AudioManager.playBgm({ name: next.value, volume: 60, pitch: 100, pan: 0 }); }
        this.redrawItem(this.findSymbol('battleMusicName'));
        this.playCursorSound();
      }
    );
  } else {
    const _Window_Options_addGeneralOptions = Window_Options.prototype.addGeneralOptions;
    Window_Options.prototype.addGeneralOptions = function () {
      _Window_Options_addGeneralOptions.call(this);
      this.addCommand(T('MusicSelection.battleMusic'), "battleMusicName");
    };

    const _Window_Options_statusText = Window_Options.prototype.statusText;
    Window_Options.prototype.statusText = function (index) {
      const symbol = this.commandSymbol(index);
      if (symbol === "battleMusicName") return this.battleMusicStatusText();
      return _Window_Options_statusText.call(this, index);
    };

    const _Window_Options_processOk = Window_Options.prototype.processOk;
    Window_Options.prototype.processOk = function () {
      const symbol = this.commandSymbol(this.index());
      if (symbol === "battleMusicName") { this.changeBattleMusic(); }
      else { _Window_Options_processOk.call(this); }
    };
  }

  Window_Options.prototype.battleMusicStatusText = function () {
    const track = MUSIC_TRACKS.find(t => t.value === ConfigManager.battleMusicName);
    return track ? track.name : "RandomMind/Battle";
  };

  Window_Options.prototype.changeBattleMusic = function () {
    const currentIndex = MUSIC_TRACKS.findIndex(t => t.value === ConfigManager.battleMusicName);
    const nextIndex = (currentIndex + 1) % MUSIC_TRACKS.length;
    const next = MUSIC_TRACKS[nextIndex];
    ConfigManager.battleMusicName = next.value;
    if (next.value === MUSIC_NONE) { AudioManager.stopBgm(); }
    else if (next.value !== MUSIC_MAP) { AudioManager.playBgm({ name: next.value, volume: 60, pitch: 100, pan: 0 }); }
    this.redrawItem(this.findSymbol("battleMusicName"));
    this.playCursorSound();
  };

  // Public API for MusicSelectionSystemUI.js and CharacterCreation.js
  window.MusicSelectionSystem = { MUSIC_TRACKS, MUSIC_NONE, MUSIC_MAP, getLocalizedText, scanCustomTracks };
})();