//=============================================================================
// WeaponSystem.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v4.0.0 Weapon sounds, ammo and the first-person 3D weapon overlay
 * @author Assistant
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @param pitchVariation
 * @text Pitch Variation
 * @type number
 * @min 0
 * @max 50
 * @default 10
 * @desc Random pitch variation percentage (0-50). Default: 10%
 *
 * @param volume
 * @text Volume
 * @type number
 * @min 0
 * @max 100
 * @default 90
 * @desc Volume for weapon sounds (0-100). Default: 90
 *
 * @param useSubfolder
 * @text Use Weapons Subfolder
 * @type boolean
 * @default true
 * @desc Load sounds from audio/se/Weapons/ subfolder?
 *
 * @param weaponSpriteX
 * @text Weapon X Position
 * @type number
 * @min -9999
 * @max 9999
 * @default 650
 * @desc X position of the held weapon, in game pixels from the left.
 *
 * @param weaponSpriteY
 * @text Weapon Y Position
 * @type number
 * @min -9999
 * @max 9999
 * @default 450
 * @desc Y position of the held weapon, in game pixels from the top.
 *
 * @param debugMode
 * @text Debug Mode
 * @type boolean
 * @default false
 * @desc Enable console logging for debugging?
 *
 * @help WeaponSystem.js
 *
 * Weapon sounds, the ammo/reload system, and the first-person weapon the
 * player looks down at in battle.
 *
 * ============================================================================
 * Every weapon is a 3D model
 * ============================================================================
 *
 * There is no 2D weapon path and no weapon picture folder. What the player
 * holds is a THREE.Group, drawn in the shared overlay in Weapon3DOverlay.js
 * (WeaponThreeScene / Sprite_3DWeapon), and built either from a <3DModel:>
 * GLB or, for every weapon in the database, procedurally by
 * WeaponSystemProcedural.js and its Weapon3D_* family files. An empty right
 * hand is not empty either: it holds the fist of the character's archetype.
 *
 * Spriteset_Battle keeps at most two of them, one per hand
 * (setHeldWeaponModel), and the left hand only appears when the actor is dual
 * wielding or holding claws.
 *
 * ============================================================================
 * Weapon Note Tags
 * ============================================================================
 *
 * MOVEMENT:
 * <Movement: anim1, anim2, anim3>
 * - Names a clip from js/db/Sprites/MovementKeyFrame3d.json to attack with.
 * - Without it the motion comes from the weapon's own measured length and
 *   weight (WeaponSystemProcedural.motionFor), so most weapons need no tag.
 *
 * SHAPE (read by WeaponSystemProcedural):
 * <Whip> / <Flail>
 * - The two shapes that hang off the grip rather than extending it. They get
 *   a rope rig, their own rest pose and their own swing.
 *
 * <Segments: X>
 * - How many links that rope is built from.
 *
 * <3DModel: path> / <3DScale: X> / <3DRotation: x, y, z>
 * - Use an authored GLB instead of a procedural model.
 *
 * SOUND SYSTEM:
 * <weaponSound: filename>
 * - Sets a single sound file for the weapon
 * - Example: <weaponSound: Sword1>
 *
 * <weaponSounds: file1, file2, file3>
 * - Sets multiple sounds that will be chosen randomly
 * - Example: <weaponSounds: Sword1, Sword2, Sword3>
 *
 * <NoMultiAttackSound>
 * - Prevents playing different sounds for each hit in multi-attacks
 * - Only the first hit will play a sound
 *
 * <Weight: grams>
 * - Drives both the attack motion and the recoil of a firearm.
 *
 * BULLET SYSTEM:
 * <Bullets: X>
 * - Set max bullets for weapon (default: unlimited)
 * - Example: <Bullets: 6>
 *
 * <ReloadSound: filename>
 * - Sound effect from audio/se for reloading
 * - Example: <ReloadSound: Reload>
 *
 * ============================================================================
 * File Locations
 * ============================================================================
 *
 * Weapon Sounds (if subfolder enabled): audio/se/Weapons/
 * Weapon Sounds (if subfolder disabled): audio/se/
 * Attack clips: js/db/Sprites/MovementKeyFrame3d.json
 *
 * ============================================================================
 * Terms of Use
 * ============================================================================
 *
 * Free for commercial and non-commercial use.
 *
 * ============================================================================
 * Changelog
 * ============================================================================
 *
 * v4.0.0 - Removed the 2D weapon layer entirely: every weapon renders in 3D
 * v3.2.0 - Added multi-frame sprite animation support and Static animation
 * v3.1.0 - Added smooth FPS-style weapon animations with 16 frames each
 * v3.0.0 - Merged bullet system and weapon sounds into unified plugin
 * v2.0.0 - Added FPS-style weapon sprite display
 * v1.0.0 - Initial release
 */

(() => {
  "use strict";

  const pluginName = "WeaponSystem";
  const parameters = PluginManager.parameters(pluginName);
  const pitchVariation = Number(parameters["pitchVariation"] || 10);
  const volume = Number(parameters["volume"] || 90);
  const useSubfolder = parameters["useSubfolder"] !== "false";
  const weaponSpriteX = Number(parameters["weaponSpriteX"] || 650);
  const weaponSpriteY = Number(parameters["weaponSpriteY"] || 450);
  const debugMode = parameters["debugMode"] === "true";

  // Debug logging helper
  const debugLog = (...args) => {
    if (debugMode) {
      console.log("[WeaponSystem]", ...args);
    }
  };
  // Resolution scaling helpers
  const getResolutionScale = () => {
    if ($gameSystem && $gameSystem.getCurrentResolution) {
      const resolution = $gameSystem.getCurrentResolution();
      return resolution === "16:9" ? { x: 1.568, y: 1.154 } : { x: 1, y: 1 };
    }
    return { x: 1, y: 1 };
  };

  const getScaledWeaponX = (isLeftHand = false) => {
    const scale = getResolutionScale();
    if (isLeftHand) {
      // Left hand weapons: scale from left edge
      return Math.round(200 * scale.x);
    }
    // Right hand weapons: scale from their base position.
    // Shift left so the weapon clears the battle command menu on the right edge.
    return Math.round(weaponSpriteX * scale.x) - 120;
  };

  const getScaledWeaponY = () => {
    const scale = getResolutionScale();
    return Math.round(weaponSpriteY * scale.y);
  };

  // Default sounds per weapon type (System.json weaponTypes), for whichever
  // weapon carries no <WeaponSound(s):> tag of its own. Blades and blunt
  // weapons keep the plain swing bank as their common ground and layer a
  // sharper or heavier set on top of it, so a dagger and a warhammer no
  // longer share one whoosh.
  const DEFAULT_WEAPON_SOUNDS = {
    1: ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8",
        "knifeSlice", "knifeSlice2", "blade_01", "blade_02", "blade_03"], // Light: knives, daggers, shivs
    2: ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8",
        "Sword1", "Sword2", "Sword3", "sword_sound"], // Sword
    3: ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8",
        "Hammer1", "Hammer2"], // Heavy: maces, clubs, hammers, flails
    4: ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8",
        "Slash1", "Slash2", "Slash3"], // Axe
    5: ["Whip1", "Whip2", "Whip3", "Whip4"], // Whip
    6: ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8", "Magic2"], // Staff
    7: ["Bow"], // Bow
    8: ["Bow"], // Projectile (name-routed further, see PROJECTILE_NAME_SOUND_RULES)
    9: ["Pistol1", "Pistol2", "Pistol3", "Pistol4", "Pistol5"], // Gun (name-routed further, see GUN_NAME_SOUND_RULES)
    10: ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8",
         "knifeSlice", "knifeSlice2"], // Claw
    11: ["Punch1", "Punch2", "Punch3"], // Glove
    12: ["Spear1", "Spear2", "Swing1", "Swing2"] // Spear
  };

  // A firearm database entry is a name, not a caliber: "Shotgun", "Sniper
  // Rifle" and "Desert Eagle" all share wtypeId 9 (Gun), so an explicit
  // <WeaponSound:> tag would have to be hand-authored on every one of the
  // hundreds of procedurally named variants. Routed by name instead, closest
  // match first; anything left over keeps the generic Pistol bank above.
  const GUN_NAME_SOUND_RULES = [
    { test: /shotgun|blunderbuss|riot gun/i,
      sounds: ["Shotgun1", "Shotgun2", "Shotgun3", "Shotgun4", "Shotgun5", "Shotgun6", "Shotgun7", "Shotgun8"],
      reload: "Reload3" },
    { test: /taser|stun|shock|\bemp\b|neural|scrambler/i,
      sounds: ["Buzzer1"],
      reload: "Reload" },
    { test: /sniper|bolt-action|bolt action/i,
      sounds: ["Sniper1", "Sniper2", "Sniper3"],
      reload: "Reload4" },
    { test: /\bsmg\b|uzi|submachine/i,
      sounds: ["SMG1", "SMG2", "SMG3", "SMG4", "SMG5", "UziAutomatic"],
      reload: "Reload5" },
    { test: /desert eagle|hand cannon/i,
      sounds: ["DesertEagle", "DoubleGunshot"],
      reload: "Reload6" },
    { test: /revolver|six-shooter|six shooter|peacemaker|pepperbox|percussion/i,
      sounds: ["DoubleGunshot", "Pistol1", "Pistol2", "Pistol3", "Pistol4", "Pistol5"],
      reload: "Reload7" },
    { test: /rifle|musket|carbine/i,
      sounds: ["Sniper1", "Sniper2", "Sniper3"],
      reload: "Reload4" }
  ];

  // The projectile slot (wtypeId 8) holds slings, blowguns, crossbows and a
  // handful of sci-fi throwables, none of which move or sound like each
  // other; routed the same way as guns, by name, on top of the generic Bow
  // fallback above.
  const PROJECTILE_NAME_SOUND_RULES = [
    { test: /bow|crossbow/i, sounds: ["Bow"], reload: "ReloadBow" },
    { test: /sling|atlatl|bola/i, sounds: ["Whip1", "Whip2"], reload: null },
    { test: /taser|\bemp\b|neural|scrambler|disruptor/i, sounds: ["Buzzer1"], reload: null },
    { test: /grenade|explos|launcher/i, sounds: ["Shotgun1", "Shotgun2"], reload: "Reload3" }
  ];

  // Static animation keyframes (no movement, just holds position)
  // Add this near the top of the file where STATIC_ANIMATION is defined (around line 138)
  // Mirrored swing animation for left hand
  // Add this near the top of the file where STATIC_ANIMATION is defined (around line 138)
  // Mirrored swing animation for left hand

  //=============================================================================
  // DataManager
  //=============================================================================

  const _DataManager_createGameObjects = DataManager.createGameObjects;
  DataManager.createGameObjects = function () {
    _DataManager_createGameObjects.call(this);
    $gameParty.initBulletData();
  };

  const _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
  DataManager.isDatabaseLoaded = function () {
    if (!_DataManager_isDatabaseLoaded.call(this)) {
      return false;
    }
    if (!this._weaponSystemProcessed) {
      this.processWeaponSystemNotetags();
      this._weaponSystemProcessed = true;
    }
    return true;
  };

  DataManager.processWeaponSystemNotetags = function () {
    debugLog("Processing weapon system notetags...");
    for (const weapon of $dataWeapons) {
      if (!weapon) continue;
      this.extractWeaponSystemData(weapon);
    }
    for (const armor of $dataArmors) {
      if (!armor) continue;
      this.extractWeaponSystemData(armor); // Reuse same extraction method
    }
    debugLog("Weapon system processing complete");
  };

  DataManager.extractWeaponSystemData = function (weapon) {
    weapon.weaponSounds = [];
    weapon.noMultiAttackSound = false;
    weapon.weaponAnimations = [];
    weapon.maxBullets = null;
    weapon.reloadSound = null;
    weapon.weight = 300;
    weapon.segments = null;
    // The three shapes that hang or fold off the grip rather than extending
    // it, which changes the model, its rest pose and the blow it can throw.
    weapon.isWhip = false;
    weapon.isFlail = false;
    weapon.isNunchaku = false;
    weapon.model3d = null;
    weapon.model3dScale = 800.0;
    weapon.model3dScaleAuthored = false;
    weapon.model3dRotation = null;
    const note = weapon.note || "";

    if (note.match(/<Whip>/i)) {
      weapon.isWhip = true;
      debugLog(`Weapon ${weapon.name}: Whip physics enabled`);
    }
    if (note.match(/<Flail>/i)) {
      weapon.isFlail = true;
      debugLog(`Weapon ${weapon.name}: Flail physics enabled`);
    }
    if (note.match(/<Nunchaku>/i)) {
      weapon.isNunchaku = true;
      debugLog(`Weapon ${weapon.name}: Nunchaku motion enabled`);
    }
    // Sound system tags
    if (note.match(/<NoMultiAttackSound>/i)) {
      weapon.noMultiAttackSound = true;
      debugLog(`Weapon ${weapon.name}: NoMultiAttackSound enabled`);
    }
    const singleMatch = note.match(/<WeaponSound:\s*(.+?)>/i);
    if (singleMatch) {
      const sound = singleMatch[1].trim();
      weapon.weaponSounds.push(sound);
      debugLog(`Weapon ${weapon.name}: Added single sound "${sound}"`);
    }
    const segmentsMatch = note.match(/<Segments:\s*(\d+)>/i);
    if (segmentsMatch) {
      weapon.segments = parseInt(segmentsMatch[1]);
      debugLog(`Weapon ${weapon.name}: Segments set to ${weapon.segments}`);
    }

    const weightMatch = note.match(/<Weight:\s*(\d+)>/i);
    if (weightMatch) {
      weapon.weight = parseInt(weightMatch[1]);
      debugLog(`Weapon ${weapon.name}: Weight set to ${weapon.weight}g`);
    } else {
      weapon.weight = 300; // Default weight
    }
    const multiMatch = note.match(/<WeaponSounds:\s*(.+?)>/i);
    if (multiMatch) {
      const sounds = multiMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
      weapon.weaponSounds = weapon.weaponSounds.concat(sounds);
      debugLog(`Weapon ${weapon.name}: Added multiple sounds`, sounds);
    }

    // An authored clip name overrides the motion the weapon's own length and
    // weight imply (WeaponSystemProcedural.motionFor), which is what an
    // untagged weapon swings with.
    const animMatch = note.match(/<Movement:\s*(.+?)>/i);
    if (animMatch) {
      const anims = animMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
      weapon.weaponAnimations = anims;
      debugLog(`Weapon ${weapon.name}: Movement`, anims);
    }

    // Bullet system tags
    const bulletsMatch = note.match(/<Bullets:\s*(\d+)>/i);
    if (bulletsMatch) {
      weapon.maxBullets = parseInt(bulletsMatch[1]);
      debugLog(`Weapon ${weapon.name}: Max bullets ${weapon.maxBullets}`);
    }

    const reloadMatch = note.match(/<ReloadSound:\s*(\w+)>/i);
    if (reloadMatch) {
      weapon.reloadSound = reloadMatch[1];
      debugLog(`Weapon ${weapon.name}: Reload sound "${weapon.reloadSound}"`);
    }

    // Name-based sound routing for guns and projectiles: only when the
    // weapon carries no explicit tag of its own, so an authored one always
    // wins.
    if (weapon.weaponSounds.length === 0) {
      const rules = weapon.wtypeId === 9 ? GUN_NAME_SOUND_RULES
        : weapon.wtypeId === 8 ? PROJECTILE_NAME_SOUND_RULES
        : null;
      const rule = rules && rules.find((r) => r.test.test(weapon.name || ""));
      if (rule) {
        weapon.weaponSounds = [...rule.sounds];
        if (!weapon.reloadSound && rule.reload) weapon.reloadSound = rule.reload;
        debugLog(`Weapon ${weapon.name}: name-routed sound bank`, rule.sounds);
      }
    }

    // Every bow reloads with its own nock-and-draw, not the generic click.
    if (weapon.wtypeId === 7 && !weapon.reloadSound) {
      weapon.reloadSound = "ReloadBow";
    }

    if (weapon.weaponSounds.length > 0) {
      weapon.weaponSounds = [...new Set(weapon.weaponSounds)];
    }

    // Process skills for movement tags
    for (const skill of $dataSkills) {
      if (!skill) continue;
      skill.weaponAnimations = [];

      const skillNote = skill.note || "";
      const skillAnimMatch = skillNote.match(/<Movement:\s*(.+?)>/i);
      if (skillAnimMatch) {
        const anims = skillAnimMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
        skill.weaponAnimations = anims;
        debugLog(`Skill ${skill.name}: Movement`, anims);
      }
    }

    const model3dMatch = note.match(/<3DModel:\s*(.+?)>/i);
    if (model3dMatch) weapon.model3d = model3dMatch[1].trim();

    // On a <3DModel> weapon this is the GLB's absolute scale. On a procedural
    // one the size comes from the bounding-box fit, so an authored value acts
    // as a relative multiplier on it (the flag tells the two apart from the
    // 800.0 default).
    const scale3dMatch = note.match(/<3DScale:\s*([\d.]+)>/i);
    if (scale3dMatch) {
      weapon.model3dScale = parseFloat(scale3dMatch[1]);
      weapon.model3dScaleAuthored = true;
    }

    const rot3dMatch = note.match(/<3DRotation:\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)>/i);
    if (rot3dMatch) weapon.model3dRotation = { x: parseFloat(rot3dMatch[1]), y: parseFloat(rot3dMatch[2]), z: parseFloat(rot3dMatch[3]) };
  };

  //=============================================================================
  // Game_Party - Bullet Data Management
  //=============================================================================

  Game_Party.prototype.initBulletData = function () {
    if (!this._bulletData) {
      this._bulletData = {};
    }
  };

  Game_Party.prototype.getBulletData = function (actorId, weaponId) {
    this.initBulletData();
    const key = `${actorId}_${weaponId}`;
    return this._bulletData[key];
  };

  Game_Party.prototype.setBulletData = function (actorId, weaponId, value) {
    this.initBulletData();
    const key = `${actorId}_${weaponId}`;
    this._bulletData[key] = value;
  };

  //=============================================================================
  // Game_Actor - Weapon System
  //=============================================================================

  // Sound system methods







  /**
   * What a weapon sounds like, whoever is holding it and wherever it is being
   * held: its own <weaponSound(s)> if it declares any, otherwise the default
   * bank for its type. No weapon at all is a bare hand, which is what the
   * Glove bank (type 11) is.
   */
  const weaponSoundsFor = (weapon) => {
    if (!weapon) return DEFAULT_WEAPON_SOUNDS[11];
    if (weapon.weaponSounds && weapon.weaponSounds.length > 0) {
      return weapon.weaponSounds;
    }
    if (weapon.wtypeId && DEFAULT_WEAPON_SOUNDS[weapon.wtypeId]) {
      return DEFAULT_WEAPON_SOUNDS[weapon.wtypeId];
    }
    return null;
  };

  /**
   * Plays one entry of a sound list, pitch-varied.
   * @returns {number} the pitch it was played at, so a caller can layer another
   *   SE over it in tune, or 0 when the list has nothing to say.
   */
  const playSoundList = (sounds) => {
    if (!sounds || sounds.length === 0) return 0;

    const soundName = sounds[Math.floor(Math.random() * sounds.length)];
    const randomPitch = 100 + (Math.random() * pitchVariation * 2 - pitchVariation);
    const pitch = Math.round(Math.max(50, Math.min(150, randomPitch)));
    const finalSoundName =
      useSubfolder && !soundName.includes("/") ? "Weapons/" + soundName : soundName;

    debugLog(`Playing weapon sound "${finalSoundName}" (pitch: ${pitch})`);
    try {
      AudioManager.playSe({
        name: finalSoundName,
        volume: volume,
        pitch: pitch,
        pan: 0,
      });
    } catch (error) {
      console.error("[WeaponSystem] Error playing sound:", error);
      return 0;
    }
    return pitch;
  };

  const playWeaponSoundFor = (weapon) => playSoundList(weaponSoundsFor(weapon));

  // What a ranged weapon sounds like once it has run dry and Attack becomes
  // Bash: a plain melee strike with the weapon in hand, not a gunshot or a
  // bowstring, so it borrows the generic swing bank instead of its own.
  const BASH_SOUNDS = ["Swing1", "Swing2", "Swing3", "Swing4", "Swing5", "Swing6", "Swing7", "Swing8"];

  // The one reading of what a weapon sounds like, so anything holding one
  // outside a battle (the dream's first-person weapon, DreamSystem.js) makes
  // the same noise the same weapon makes in the party's hands.
  window.WeaponSounds = { soundsFor: weaponSoundsFor, play: playWeaponSoundFor };

  Game_Actor.prototype.getWeaponSounds = function () {
    if (this.isOutOfBullets()) return BASH_SOUNDS;
    return weaponSoundsFor(this.weapons()[0]);
  };

  Game_Actor.prototype.hasNoMultiAttackSound = function () {
    const weapons = this.weapons();
    if (weapons.length === 0) return false;

    const weapon = weapons[0];
    return weapon && weapon.noMultiAttackSound === true;
  };

  Game_Actor.prototype.playWeaponSound = function () {
    const pitch = playSoundList(this.getWeaponSounds());
    // Layer the elemental shimmer SE over the weapon sound when applicable.
    if (pitch) this.playWeaponShimmerSE(pitch);
  };

  // Bullet system methods
  Game_Actor.prototype.getWeaponBulletConfig = function () {
    const weapons = this.weapons();
    if (weapons.length === 0) return null;

    const weapon = weapons[0];
    if (!weapon || !weapon.maxBullets) return null;

    return {
      max: weapon.maxBullets,
      weaponId: weapon.id,
    };
  };

  Game_Actor.prototype.getCurrentBullets = function () {
    const config = this.getWeaponBulletConfig();
    if (!config) return null;

    let current = $gameParty.getBulletData(this.actorId(), config.weaponId);
    if (current === undefined) {
      current = config.max;
      $gameParty.setBulletData(this.actorId(), config.weaponId, current);
    }
    return current;
  };

  Game_Actor.prototype.setCurrentBullets = function (value) {
    const config = this.getWeaponBulletConfig();
    if (!config) return;

    const clamped = Math.max(0, Math.min(value, config.max));
    $gameParty.setBulletData(this.actorId(), config.weaponId, clamped);
  };

  Game_Actor.prototype.consumeBullet = function () {
    const current = this.getCurrentBullets();
    if (current !== null && current > 0) {
      this.setCurrentBullets(current - 1);
    }
  };

  Game_Actor.prototype.reloadBullets = function () {
    const config = this.getWeaponBulletConfig();
    if (!config) return;

    this.setCurrentBullets(config.max);

    const weapons = this.weapons();
    if (weapons.length > 0) {
      const weapon = weapons[0];
      const soundName = weapon.reloadSound || "Reload";  // i18n-ignore  audio/se/Weapons filename

      AudioManager.playSe({
        name: "Weapons/" + soundName,
        volume: 90,
        pitch: 100,
        pan: 0,
      });

      const scene = SceneManager._scene;
      if (scene && scene._spriteset && scene._spriteset._3dWeaponSprites) {
        const sprite3d = scene._spriteset._3dWeaponSprites['right'];
        if (sprite3d) sprite3d.playReload();
      }
    }
  };

  Game_Actor.prototype.isOutOfBullets = function () {
    const current = this.getCurrentBullets();
    return current !== null && current <= 0;
  };

  Game_Actor.prototype.canAttackWithBullets = function () {
    const config = this.getWeaponBulletConfig();
    if (!config) return true;

    const current = this.getCurrentBullets();
    return current > 0;
  };

  //=============================================================================
  // Game_Action - Bullet Consumption
  //=============================================================================

  const _Game_Action_apply = Game_Action.prototype.apply;
  Game_Action.prototype.apply = function (target) {
    const subject = this.subject();

    if (this.isAttack() && subject.isActor()) {
      // Out of bullets: Attack is now Bash, an ordinary strike with whatever
      // is in hand rather than a shot, so it still lands and costs no ammo.
      if (subject.canAttackWithBullets()) {
        subject.consumeBullet();
      }
    }

    _Game_Action_apply.call(this, target);
  };

  const _Game_Action_numRepeats = Game_Action.prototype.numRepeats;
  Game_Action.prototype.numRepeats = function () {
    const subject = this.subject();

    if (this.isAttack() && subject && subject.isActor()) {
      const current = subject.getCurrentBullets();
      // A full or partial magazine still caps the repeat count at what's
      // left; an empty one no longer caps it at zero hits, that's the Bash.
      if (current !== null && current > 0) {
        const normalRepeats = _Game_Action_numRepeats.call(this);
        return Math.min(normalRepeats, current);
      }
    }

    return _Game_Action_numRepeats.call(this);
  };

  //=============================================================================
  // Window_BattleLog - Weapon Sounds
  //=============================================================================

  const _Window_BattleLog_startAction = Window_BattleLog.prototype.startAction;
  Window_BattleLog.prototype.startAction = function (subject, action, targets) {
    if (action && subject && subject.isActor()) {

      if (action.isAttack()) {
        this._lastAttacker = subject;
        this._multiAttackHitCount = 0;
        this._skillAnimations = null;
        debugLog(`Tracking attacker: ${subject.name()}`);
      } else if (action.isSkill()) {
        const skill = action.item();
        const weapons = subject.weapons();
        const wtypeId = (weapons.length && weapons[0]) ? weapons[0].wtypeId : 0;
        // A weapon that shoots plays its own shot for a skill as well as for a
        // plain attack. What a bow, a sling or a gun does is decided by the
        // weapon and not by the name the skill asked for
        // (WeaponSystemProcedural.rangedMotionFor), so there is no sword swing
        // to suppress here: suppressing it is what left an archer standing
        // still for every skill they used, holding a bow that never moved.
        const shoots = wtypeId === 7 || wtypeId === 8 || wtypeId === 9;
        const declared = !!(skill && skill.weaponAnimations && skill.weaponAnimations.length > 0);
        // Claws and gloves are still left out: they have no motion of their own
        // to fall back on, so a skill would swing them like a sword.
        const swings = declared && wtypeId !== 10 && wtypeId !== 11;

        if (shoots && (declared || action.isPhysical())) {
          this._lastAttacker = subject;
          this._multiAttackHitCount = 0;
          // null: its own shot, not whatever movement the skill named.
          this._skillAnimations = null;
          debugLog(`Skill ${skill.name} shoots with the weapon's own motion`);
        } else if (swings) {
          this._lastAttacker = subject;
          this._multiAttackHitCount = 0;
          this._skillAnimations = skill.weaponAnimations;
          debugLog(
            `Skill ${skill.name} has animations:`,
            this._skillAnimations
          );
        } else {
          this._lastAttacker = null;
          this._multiAttackHitCount = 0;
          this._skillAnimations = null;
        }
      } else if (action.isSkill()) {
        // Check if skill has Movement animations
        const skill = action.item();
        if (
          skill &&
          skill.weaponAnimations &&
          skill.weaponAnimations.length > 0
        ) {
          this._lastAttacker = subject;
          this._multiAttackHitCount = 0;
          this._skillAnimations = skill.weaponAnimations;
          debugLog(
            `Skill ${skill.name} has animations:`,
            this._skillAnimations
          );
        } else {
          this._lastAttacker = null;
          this._multiAttackHitCount = 0;
          this._skillAnimations = null;
        }
      } else {
        this._lastAttacker = null;
        this._multiAttackHitCount = 0;
        this._skillAnimations = null;
      }
    } else {
      this._lastAttacker = null;
      this._multiAttackHitCount = 0;
      this._skillAnimations = null;
    }

    _Window_BattleLog_startAction.call(this, subject, action, targets);
  };
  const _Window_BattleLog_displayActionResults =
    Window_BattleLog.prototype.displayActionResults;
  Window_BattleLog.prototype.displayActionResults = function (subject, target) {
    // Play weapon animation on ANY attack action result (hit, miss, evade, counter, etc.)
    if (
      target &&
      target.result().used &&
      this._lastAttacker &&
      this._lastAttacker.isActor()
    ) {
      const actor = this._lastAttacker;
      const weapons = actor.weapons();
      const isDualWielding = weapons.length >= 2;

      // Determine weapon index for dual wield
      let weaponIndex = 0;
      if (isDualWielding) {
        this._multiAttackHitCount = this._multiAttackHitCount || 0;
        const weapon1Repeats = weapons[0] ? actor.attackTimesAdd() + 1 : 1;
        weaponIndex = this._multiAttackHitCount < weapon1Repeats ? 0 : 1;
      }

      // Play animation even on miss/evade/counter
      // Map-battle mode runs the battle log over Spriteset_Map, which has no
      // weapon sprites, so only call it where the method actually exists.
      const spriteset = SceneManager._scene && SceneManager._scene._spriteset;
      // A critical hit is a different blow, not the same one with a bigger
      // number over it, so the swing is told which one it is.
      if (spriteset && typeof spriteset.playWeaponAnimation === "function") {
        spriteset.playWeaponAnimation(
          this._skillAnimations,
          weaponIndex,
          { crit: !!target.result().critical }
        );
      }

      // Play sound on hit, or on miss/block/counter for ranged weapons (types 7, 8, 9)
      const shouldPlaySound = target.result().isHit() || (() => {
        const weapons = actor.weapons();
        if (weapons.length === 0) return false;
        const weapon = weapons[0];
        return weapon && (weapon.wtypeId === 7 || weapon.wtypeId === 8 || weapon.wtypeId === 9);
      })();

      if (shouldPlaySound && !this._skillAnimations) {
        const noMultiSound = actor.hasNoMultiAttackSound();
        this._multiAttackHitCount = this._multiAttackHitCount || 0;

        if (this._multiAttackHitCount === 0 || !noMultiSound) {
          actor.playWeaponSound();
        }
      }

      this._multiAttackHitCount = (this._multiAttackHitCount || 0) + 1;
    }

    _Window_BattleLog_displayActionResults.call(this, subject, target);
  };
  // In Window_BattleLog.prototype.displayHpDamage - Replace the existing method:
  const _Window_BattleLog_displayHpDamage =
    Window_BattleLog.prototype.displayHpDamage;
  Window_BattleLog.prototype.displayHpDamage = function (target) {
    if (
      target &&
      target.isActor() &&
      SceneManager._scene._spriteset &&
      SceneManager._scene._spriteset._shieldSprite
    ) {
      SceneManager._scene._spriteset._shieldSprite.playBlockAnimation();
      debugLog("Shield block animation triggered");
    }

    // In Window_BattleLog.prototype.displayHpDamage - Replace the sound playing section:
    if (
      target &&
      target.isEnemy() &&
      this._lastAttacker &&
      this._lastAttacker.isActor()
    ) {
      this._multiAttackHitCount = this._multiAttackHitCount || 0;
      const noMultiSound = this._lastAttacker.hasNoMultiAttackSound();

      // NEW: Determine which weapon is hitting based on attack count for dual wield
      const weapons = this._lastAttacker.weapons();
      const isDualWielding = weapons.length >= 2;
      let weaponIndex = 0;

      if (isDualWielding) {
        // Calculate which weapon should animate based on hit count
        const weapon1Repeats = weapons[0]
          ? this._lastAttacker.attackTimesAdd() + 1
          : 1;
        weaponIndex = this._multiAttackHitCount < weapon1Repeats ? 0 : 1;
      }

      const spriteset = SceneManager._scene && SceneManager._scene._spriteset;
      if (spriteset && typeof spriteset.playWeaponAnimation === "function") {
        spriteset.playWeaponAnimation(this._skillAnimations, weaponIndex, {
          crit: !!target.result().critical
        });
      }

      // NEW: Play sound for the correct weapon based on weaponIndex
      if (!this._skillAnimations) {
        if (this._multiAttackHitCount === 0 || !noMultiSound) {
          // Get sounds from the correct weapon
          let sounds = null;
          if (isDualWielding && weaponIndex === 1 && weapons[1]) {
            // Left hand weapon - get its specific sounds
            const leftWeapon = weapons[1];
            if (leftWeapon.weaponSounds && leftWeapon.weaponSounds.length > 0) {
              sounds = leftWeapon.weaponSounds;
            } else if (
              leftWeapon.wtypeId &&
              DEFAULT_WEAPON_SOUNDS[leftWeapon.wtypeId]
            ) {
              sounds = DEFAULT_WEAPON_SOUNDS[leftWeapon.wtypeId];
            }
          } else {
            // Right hand weapon - use existing method
            sounds = this._lastAttacker.getWeaponSounds();
          }

          // Play the sound
          if (sounds && sounds.length > 0) {
            const soundName = sounds[Math.floor(Math.random() * sounds.length)];
            const basePitch = 100;
            const variation = pitchVariation;
            const randomPitch =
              basePitch + (Math.random() * variation * 2 - variation);
            const pitch = Math.round(Math.max(50, Math.min(150, randomPitch)));

            let finalSoundName = soundName;
            if (useSubfolder && !soundName.includes("/")) {
              finalSoundName = "Weapons/" + soundName;
            }

            const se = {
              name: finalSoundName,
              volume: volume,
              pitch: pitch,
              pan: 0,
            };

            AudioManager.playSe(se);
            debugLog(
              `Damage Display: Actor ${this._lastAttacker.name()} hit enemy ${target.name()} with weapon ${weaponIndex + 1
              } (Hit #${this._multiAttackHitCount + 1
              }), playing sound "${finalSoundName}"`
            );
          }
        } else {
          debugLog(
            `Damage Display: Skipping sound for hit #${this._multiAttackHitCount + 1
            } (NoMultiAttackSound enabled)`
          );
        }
      }

      this._multiAttackHitCount++;
    }

    _Window_BattleLog_displayHpDamage.call(this, target);
  };
  const _Window_BattleLog_endAction = Window_BattleLog.prototype.endAction;
  Window_BattleLog.prototype.endAction = function (subject) {
    this._multiAttackHitCount = 0;
    this._lastAttacker = null;
    _Window_BattleLog_endAction.call(this, subject);
  };
  // Add this after the existing _Scene_Battle_start alias
  // Replace the existing _Scene_Battle_start alias
  const _Scene_Battle_start = Scene_Battle.prototype.start;
  Scene_Battle.prototype.start = function () {
    _Scene_Battle_start.call(this);

    // Rebuild the held models from the current equipment when a battle opens,
    // starting from nothing so a weapon swapped between fights cannot linger.
    if (this._spriteset) {
      if (this._spriteset.clearWeaponModels) this._spriteset.clearWeaponModels();
      this._spriteset.updateWeaponSprite();

      // Ensure bullet gauge is set for first actor
      const actor = $gameParty.battleMembers()[0];
      if (actor && this._spriteset._bulletGauge) {
        this._spriteset._bulletGauge.setActor(actor);
      }
    }
  };
  //=============================================================================
  // Weapon Shimmer - elemental state tint
  //=============================================================================
  // States tagged <weaponShimmer: Element> tint the wielder's weapon sprite.
  // The tint color is read from the same state's <Hex: #RRGGBB> tag.
  function getStateShimmerColor(state) {
    if (!state) return null;
    if (state._weaponShimmerColor !== undefined) return state._weaponShimmerColor;
    let color = null;
    if (state.note && /<weaponShimmer\b/i.test(state.note)) {
      const hex = state.note.match(/<Hex:\s*#?([0-9a-fA-F]{6})>/);
      color = hex ? parseInt(hex[1], 16) : 0xffffff;
    }
    state._weaponShimmerColor = color;
    return color;
  }

  // Elemental SE filenames (under audio/se/) for a shimmer state's
  // <weaponShimmerSE: a, b, c, d> tag. Returns a cached array (possibly empty).
  function getStateShimmerSE(state) {
    if (!state) return [];
    if (state._weaponShimmerSE !== undefined) return state._weaponShimmerSE;
    let list = [];
    const m = state.note && state.note.match(/<weaponShimmerSE:\s*([^>]+)>/i);
    if (m) {
      list = m[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
    state._weaponShimmerSE = list;
    return list;
  }

  // Track shimmer states in application order so the most recent one wins.
  const _Game_BattlerBase_addNewState = Game_BattlerBase.prototype.addNewState;
  Game_BattlerBase.prototype.addNewState = function (stateId) {
    _Game_BattlerBase_addNewState.call(this, stateId);
    if (getStateShimmerColor($dataStates[stateId]) != null) {
      if (!this._weaponShimmerStack) this._weaponShimmerStack = [];
      const i = this._weaponShimmerStack.indexOf(stateId);
      if (i >= 0) this._weaponShimmerStack.splice(i, 1);
      this._weaponShimmerStack.push(stateId);
    }
  };

  const _Game_BattlerBase_eraseState = Game_BattlerBase.prototype.eraseState;
  Game_BattlerBase.prototype.eraseState = function (stateId) {
    _Game_BattlerBase_eraseState.call(this, stateId);
    if (this._weaponShimmerStack) {
      const i = this._weaponShimmerStack.indexOf(stateId);
      if (i >= 0) this._weaponShimmerStack.splice(i, 1);
    }
  };

  const _Game_BattlerBase_clearStates = Game_BattlerBase.prototype.clearStates;
  Game_BattlerBase.prototype.clearStates = function () {
    _Game_BattlerBase_clearStates.call(this);
    this._weaponShimmerStack = [];
  };

  // Id of the most recently applied, still-active shimmer state (or 0).
  Game_BattlerBase.prototype.getLatestWeaponShimmerStateId = function () {
    const stack = this._weaponShimmerStack;
    if (!stack || stack.length === 0) return 0;
    for (let i = stack.length - 1; i >= 0; i--) {
      const stateId = stack[i];
      if (this.isStateAffected(stateId)) return stateId;
    }
    return 0;
  };

  // Color of the most recently applied, still-active shimmer state (or null).
  Game_BattlerBase.prototype.getLatestWeaponShimmerColor = function () {
    const stateId = this.getLatestWeaponShimmerStateId();
    return stateId ? getStateShimmerColor($dataStates[stateId]) : null;
  };

  // Play the elemental SE of the latest shimmer state alongside the weapon
  // sound. `pitch` is matched to the weapon swing so the two read as one hit.
  Game_BattlerBase.prototype.playWeaponShimmerSE = function (pitch) {
    const stateId = this.getLatestWeaponShimmerStateId();
    if (!stateId) return;
    const list = getStateShimmerSE($dataStates[stateId]);
    if (!list || list.length === 0) return;
    const name = list[Math.floor(Math.random() * list.length)];
    try {
      AudioManager.playSe({
        name: name,
        volume: Math.round(volume * 0.85),
        pitch: pitch || 100,
        pan: 0,
      });
    } catch (error) {
      console.error("[WeaponSystem] Error playing shimmer SE:", error);
    }
  };
  //=============================================================================
  // Sprite_BulletGauge - Bullet Display
  //=============================================================================

  function Sprite_BulletGauge() {
    this.initialize(...arguments);
  }

  Sprite_BulletGauge.prototype = Object.create(Sprite.prototype);
  Sprite_BulletGauge.prototype.constructor = Sprite_BulletGauge;

  Sprite_BulletGauge.prototype.initialize = function () {
    Sprite.prototype.initialize.call(this);
    this._actor = null;
    this._lastCurrent = -1;
    this._lastMax = -1;
    this.bitmap = new Bitmap(120, 40);
    const scale = getResolutionScale();
    this.x = Math.round(300 * scale.x);
    this.y = Math.round(70 * scale.y);
  };

  Sprite_BulletGauge.prototype.setActor = function (actor) {
    if (this._actor !== actor) {
      this._actor = actor;
      this._lastCurrent = -1;
      this._lastMax = -1;
    }
  };

  Sprite_BulletGauge.prototype.update = function () {
    Sprite.prototype.update.call(this);

    if (this._actor) {
      const config = this._actor.getWeaponBulletConfig();
      if (config) {
        const current = this._actor.getCurrentBullets();
        if (current !== this._lastCurrent || config.max !== this._lastMax) {
          this.refresh(current, config.max);
          this._lastCurrent = current;
          this._lastMax = config.max;
        }
        this.visible = true;
      } else {
        this.visible = false;
      }
    } else {
      this.visible = false;
    }
  };

  // Replace the Sprite_BulletGauge.prototype.refresh method (around line 1988)
  Sprite_BulletGauge.prototype.refresh = function (current, max) {
    this.bitmap.clear();

    // Determine icon based on weapon type
    let iconIndex = 104; // Default bullet icon
    if (this._actor) {
      const weapons = this._actor.weapons();
      if (weapons.length > 0 && weapons[0]) {
        const weapon = weapons[0];
        if (weapon.wtypeId === 7) {
          iconIndex = 102; // Bow/arrow icon
        }
      }
    }

    // Draw weapon icon
    const iconBitmap = ImageManager.loadSystem("IconSet");
    const pw = ImageManager.iconWidth;
    const ph = ImageManager.iconHeight;
    const sx = (iconIndex % 16) * pw;
    const sy = Math.floor(iconIndex / 16) * ph;

    this.bitmap.blt(iconBitmap, sx, sy, pw, ph, 0, 0);

    // Draw bullet count text next to icon
    this.bitmap.fontSize = 24;
    this.bitmap.textColor = "#FFFFFF";
    this.bitmap.outlineWidth = 4;
    this.bitmap.outlineColor = "#000000";
    this.bitmap.drawText(`x ${current}`, 36, 4, 80, 32, "left");
  };

  //=============================================================================
  // Spriteset_Battle - Weapon and Bullet Display
  //=============================================================================

  const _Spriteset_Battle_createLowerLayer =
    Spriteset_Battle.prototype.createLowerLayer;
  Spriteset_Battle.prototype.createLowerLayer = function () {
    _Spriteset_Battle_createLowerLayer.call(this);
    this.createWeaponSprite();
    this.createBulletGauge();
  };
  Spriteset_Battle.prototype.createWeaponSprite = function () {
    // Defensive guard: Map Battle Mode (MapBattleMode.js) never actually
    // constructs a Spriteset_Battle, but skip the weapon overlay here too in
    // case any other code path ever instantiates one while it's active.
    if (window.MapBattleMode && window.MapBattleMode.isActive()) return;
    this._3dWeaponSprites = {};
    this.updateWeaponSprite();
  };

  Spriteset_Battle.prototype.getCurrentBattleActor = function (
    allowFallback = true
  ) {
    // The actor currently taking a turn (selecting a command or acting)
    const active =
      BattleManager.actor() ||
      (BattleManager._subject && BattleManager._subject.isActor()
        ? BattleManager._subject
        : null);

    if (window.$gameSplitScreen && window.$gameSplitScreen.active) {
      const activator = $gameMessage._eventActivator || "p1";
      if (activator === "p2" && $gameParty.battleMembers().length >= 2) {
        return active || (allowFallback ? $gameParty.battleMembers()[1] : null);
      }
    }

    return active || (allowFallback ? $gameParty.battleMembers()[0] : null);
  };

  Spriteset_Battle.prototype.createBulletGauge = function () {
    // The floating bullet/projectile count below the enemy bar is intentionally
    // not created: the live projectile count now lives on the Attack command.
    // Other code paths reference _bulletGauge guarded by `&&`, so leaving it
    // undefined is safe.
  };

  /** Drop every held model, e.g. leaving the scene or entering card mode. */
  Spriteset_Battle.prototype.clearWeaponModels = function () {
    if (!this._3dWeaponSprites) return;
    for (const key in this._3dWeaponSprites) {
      const s = this._3dWeaponSprites[key];
      if (s && s.terminate) s.terminate();
    }
    this._3dWeaponSprites = {};
  };

  /**
   * Fade every held model out of frame, the battle being over. The models are
   * kept alive until the scene terminates so the fade actually plays, and no
   * weapon is put back in frame in the meantime.
   */
  Spriteset_Battle.prototype.fadeOutWeaponModels = function () {
    this._weaponModelsExiting = true;
    if (!this._3dWeaponSprites) return;
    for (const key in this._3dWeaponSprites) {
      const s = this._3dWeaponSprites[key];
      if (s && s.beginExit) s.beginExit();
    }
  };

  /**
   * Put whatever the acting actor is holding in frame. Two models at most, one
   * per hand: a character with six arms still only swings two things a turn
   * (Game_Actor#activeWeapons), and a shield counts as one of them, so sword
   * and board, two swords and two shields are all drawn the same way. An empty
   * right hand is not empty, it holds the fist of the character's archetype
   * (WeaponSystemProcedural.unarmedWeaponFor).
   */
  Spriteset_Battle.prototype.updateWeaponSprite = function () {
    if (this._weaponModelsExiting) return;
    if (!this._3dWeaponSprites) this._3dWeaponSprites = {};

    // In card combat mode (RoguelikeCardSystem, Switch 45, locked at character
    // creation) attacks are cards rather than weapon swings, so nothing is held.
    const cardMode = window.isCardCombatMode ? window.isCardCombatMode() : $gameSwitches.value(45);
    if (cardMode || !window.Sprite_3DWeapon) {
      this.clearWeaponModels();
      return;
    }

    if (window.WeaponSystemProcedural) WeaponSystemProcedural.patchSprite3DWeapon();

    // Only show a weapon for the actor actually taking a turn (no player-1
    // fallback), so nothing flashes at battle start before turn order resolves.
    const actor = this.getCurrentBattleActor(false);
    if (!actor) {
      this.clearWeaponModels();
      return;
    }

    // The weapons swinging this turn come first; a shield fills whichever hand
    // is left over. Both are drawn through the same model pipeline, the shield
    // wrapped as a weapon by WeaponSystemProcedural.shieldWeaponFor.
    const weapons = actor.weapons();
    const held = window.HandSlots ? window.HandSlots.heldItems(actor) : [];
    const shields = held.filter(item => item && item.etypeId === 2);
    const shieldModel = (armor) => (armor && window.WeaponSystemProcedural)
      ? WeaponSystemProcedural.shieldWeaponFor(armor)
      : null;

    let rightWeapon = weapons[0] || null;
    let rightShield = null;
    if (!rightWeapon && shields.length) rightShield = shields.shift();
    if (!rightWeapon && !rightShield && window.WeaponSystemProcedural) {
      rightWeapon = WeaponSystemProcedural.unarmedWeaponFor(actor);
    }

    // Claws are a pair even when the database lists one of them.
    const isClaws = !!(weapons[0] && weapons[0].wtypeId === 10);
    let leftWeapon = weapons[1] || null;
    let leftShield = null;
    if (!leftWeapon && shields.length) leftShield = shields.shift();
    if (!leftWeapon && !leftShield && isClaws) leftWeapon = weapons[0];

    this.setHeldWeaponModel('right', rightWeapon || shieldModel(rightShield));
    this.setHeldWeaponModel('left', leftWeapon || shieldModel(leftShield));
  };

  /** Show `weapon` in `hand`, rebuilding the model only when it changed. */
  Spriteset_Battle.prototype.setHeldWeaponModel = function (hand, weapon) {
    if (!this._3dWeaponSprites) this._3dWeaponSprites = {};
    const held = this._3dWeaponSprites[hand];
    if (!weapon) {
      if (held) {
        held.terminate();
        delete this._3dWeaponSprites[hand];
      }
      return null;
    }
    if (!held || held._weapon !== weapon) {
      const isLeft = hand === 'left';
      // The incoming model is built BEFORE the outgoing one is let go. When
      // this is the only weapon on screen, terminating first drops the last
      // reference to the shared overlay, and a swap must never leave the
      // layer holding nothing.
      const next = new Sprite_3DWeapon(
        weapon, getScaledWeaponX(isLeft), getScaledWeaponY());
      // terminate() runs disposeWeaponObject3D; a bare scene.remove would leak
      // the model's GPU buffers on every swap.
      if (held) held.terminate();
      this._3dWeaponSprites[hand] = next;
    }
    const sprite = this._3dWeaponSprites[hand];
    if (sprite._model && !sprite._exiting) {
      sprite._model.visible = true;
      sprite._visible = true;
    }
    return sprite;
  };

  /**
   * The enemy the weapon in the party's hands is turned toward: what a gun or a
   * bow is aimed at, and what a blade swings at. Whoever is being picked in the
   * target window wins, then the target of the action being carried out, then
   * whichever enemy is still standing.
   */
  Spriteset_Battle.prototype.weaponAimBattler = function () {
    const scene = SceneManager._scene;
    const win = scene && scene._enemyWindow;
    if (win && win.active && win.visible && typeof win.enemy === "function") {
      const picked = win.enemy();
      if (picked && picked.isAlive()) return picked;
    }
    const targets = BattleManager._targets;
    if (targets) {
      for (const t of targets) {
        if (t && t.isEnemy && t.isEnemy() && t.isAlive()) return t;
      }
    }
    const alive = $gameTroop ? $gameTroop.aliveMembers() : null;
    return alive && alive.length ? alive[0] : null;
  };

  /** Where that enemy is, in game pixels, or null when there is nobody to aim at. */
  Spriteset_Battle.prototype.weaponAimPoint = function () {
    const enemy = this.weaponAimBattler();
    if (!enemy) return null;
    // A 3D battler is wherever its model projects to; the 2D sprite behind it
    // never moves, so asking the sprite first would aim at an empty slot.
    let p = this.getBattlerPartPosition
      ? this.getBattlerPartPosition(enemy, null)
      : null;
    if (!p) {
      const sprite = this.findTargetSprite(enemy);
      if (!sprite) return null;
      // Sprite_Enemy is anchored at the battler's feet: aim at its middle.
      p = { x: sprite.x, y: sprite.y - (sprite.height || 120) / 2 };
    }
    // Both of those are battlefield-local; the weapon overlay is in game pixels.
    const field = this._battleField;
    return { x: p.x + (field ? field.x : 0), y: p.y + (field ? field.y : 0) };
  };

  // Add helper method to find enemy sprite
  Spriteset_Battle.prototype.findTargetSprite = function (target) {
    if (!this._enemySprites) return null;

    for (const sprite of this._enemySprites) {
      if (sprite._battler === target) {
        return sprite;
      }
    }
    return null;
  };

  /**
   * The next entry of a weapon's <Movement:> list. A weapon that authored six
   * movements meant all six of them, and taking only the first one is what had
   * every flail in the game playing the same swing for a whole fight. The
   * cursor lives on the weapon data object, which is rebuilt from the note tags
   * every time the database loads, so there is nothing to save.
   */
  function nextWeaponMovement(weapon) {
    const anims = weapon && weapon.weaponAnimations;
    if (!anims || anims.length === 0) return null;
    if (anims.length === 1) return anims[0];
    const next = ((weapon._movementCursor || 0) + 1) % anims.length;
    weapon._movementCursor = next;
    return anims[next];
  }

  /**
   * Swing whichever hand is acting. The clip is the skill's own movement if it
   * declares one, otherwise the next of the weapon's <Movement:> entries,
   * otherwise the motion its shape implies (WeaponSystemProcedural.motionFor).
   * @param {object} [opts] - what kind of blow this is, {crit:boolean}.
   */
  Spriteset_Battle.prototype.playWeaponAnimation = function (
    animationOverride = null,
    weaponIndex = 0,
    opts = null
  ) {
    if (!window.Sprite_3DWeapon) return;
    if (this._weaponModelsExiting) return;
    const actor = this.getCurrentBattleActor();
    if (!actor) return;
    if (window.WeaponSystemProcedural) WeaponSystemProcedural.patchSprite3DWeapon();

    const weapons = actor.weapons();
    const isLeftHand = weaponIndex === 1;

    let weapon = weapons[weaponIndex];
    if (!weapon && !isLeftHand && window.WeaponSystemProcedural) {
      weapon = WeaponSystemProcedural.unarmedWeaponFor(actor);
    }
    if (!weapon) return;

    const sprite = this.setHeldWeaponModel(isLeftHand ? 'left' : 'right', weapon);
    if (!sprite) return;
    // No <Movement:> tag means "whatever this weapon does", NOT a sword swing:
    // defaulting to Swing here is what had untagged firearms and slings
    // clubbing the enemy with the stock. WeaponSystemProcedural.motionForWeapon
    // answers it from the weapon's own type and length.
    const animName = nextWeaponMovement(weapon);
    sprite.playAnimation(animationOverride || animName, opts);
  };

  const _Spriteset_Battle_update = Spriteset_Battle.prototype.update;
  Spriteset_Battle.prototype.update = function () {
    _Spriteset_Battle_update.call(this);
    let anyModelVisible = false;
    if (this._3dWeaponSprites) {
      // Where the enemy is, resolved once a frame and shared by both hands: a
      // weapon that shoots turns to face it, and one that is swung sends its
      // blow at it. Costs one projection of the enemy's model.
      let aimPoint;
      for (const key in this._3dWeaponSprites) {
        const spr = this._3dWeaponSprites[key];
        if (aimPoint === undefined) aimPoint = this.weaponAimPoint();
        spr._aimPoint = aimPoint;
        spr.update();
        if (spr._model && spr._model.visible) {
          anyModelVisible = true;
        }
      }
    }
    // Batch the shared three.js overlay render once per frame (formerly done
    // per weapon instance inside each Sprite_3DWeapon.update). Only render when
    // at least one weapon model is visible, plus one last pass on the frame the
    // last one goes: the overlay canvas keeps whatever was drawn into it, so
    // without it a faded-out weapon would stay painted over the battle.
    if ((anyModelVisible || this._weaponOverlayDrawn) && window.WeaponThreeScene &&
        typeof window.WeaponThreeScene.render === 'function') {
      window.WeaponThreeScene.render();
    }
    this._weaponOverlayDrawn = anyModelVisible;
  };
  //=============================================================================
  // Scene_Battle - Command Handling and Updates
  //=============================================================================

  const _Scene_Battle_changeInputWindow =
    Scene_Battle.prototype.changeInputWindow;
  Scene_Battle.prototype.changeInputWindow = function () {
    _Scene_Battle_changeInputWindow.call(this);
    if (this._spriteset) {
      this._spriteset.updateWeaponSprite();
    }
  };

  const _Scene_Battle_startActorCommandSelection =
    Scene_Battle.prototype.startActorCommandSelection;
  Scene_Battle.prototype.startActorCommandSelection = function () {
    _Scene_Battle_startActorCommandSelection.call(this);
    if (this._spriteset && this._spriteset._bulletGauge) {
      this._spriteset._bulletGauge.setActor(BattleManager.actor());
    }
    // BUGFIX: Force weapon sprite refresh to ensure it's visible
    if (this._spriteset) {
      this._spriteset.updateWeaponSprite();
    }
  };

  const _Scene_Battle_update = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function () {
    _Scene_Battle_update.call(this);
    if (
      this._spriteset &&
      this._spriteset._bulletGauge &&
      BattleManager.actor()
    ) {
      this._spriteset._bulletGauge.setActor(BattleManager.actor());
    }
  };

  //=============================================================================
  // Scene_Boot - Initialization
  //=============================================================================

  const _Scene_Boot_start = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    _Scene_Boot_start.call(this);

    if (debugMode) {
      console.log("[WeaponSystem] Plugin v4.0.0 loaded successfully");
      console.log("[WeaponSystem] Settings:", {
        pitchVariation: pitchVariation,
        volume: volume,
        useSubfolder: useSubfolder,
        weaponSpriteX: weaponSpriteX,
        weaponSpriteY: weaponSpriteY,
        debugMode: debugMode,
      });
    }
  };

  //=============================================================================
  // BattleManager - end of battle
  //=============================================================================

  // Victory, defeat and escape all pass through endBattle, which is raised
  // while the scene is still running: the held models fade out over the last
  // moments of the battle instead of vanishing with the scene.
  const _BattleManager_endBattle = BattleManager.endBattle;
  BattleManager.endBattle = function (result) {
    _BattleManager_endBattle.call(this, result);
    const scene = SceneManager._scene;
    if (scene && scene._spriteset && scene._spriteset.fadeOutWeaponModels) {
      scene._spriteset.fadeOutWeaponModels();
    }
  };

  const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
  Scene_Battle.prototype.terminate = function () {
    _Scene_Battle_terminate.call(this);

    // Drop every held model when the battle ends.
    if (this._spriteset && this._spriteset.clearWeaponModels) {
      this._spriteset.clearWeaponModels();
    }
  };
})();