/*:
 * @plugindesc Enhanced monster limb and organ damage system with targeted attacks
 * @author Inspired by Health_Core
 * @help
 * This plugin implements a detailed limb and organ damage system
 * for enemy monsters. Features include:
 * - Individual health for limbs and organs based on monster archetype
 * - Damage distribution to body parts
 * - Special effects for damaged body parts
 * - Permanent debuffs for destroyed parts during battle
 * - Dynamic enemy archetypes defined in enemy notes
 * - Part severing system for finishing blows
 * - "Check" command to view monster body parts and their HP
 * - NEW: Hit percentage calculation for each body part
 * - NEW: Target specific body parts with calculated hit chance
 * - NEW: Weapon type influences hit chance based on user stats
 * - NEW: Random +/-10% modifier to hit chance for each part
 * - NEW: Bypass vital part protection with targeted attacks
 * - NEW: Persistent targeting when reopening the window
 *
 * Enemy Note Tag Format:
 * <Archetype: Humanoid>
 * <Archetype: Slime>
 * <Archetype: Dragon>
 * etc.
 *
 * Add custom archetypes by extending the EnemyArchetypes object.
 *
 * @param Decapitation Sound
 * @desc Sound effect to play when decapitation occurs
 * @default Monster5
 * @type file
 * @dir audio/se/
 *
 * @param Part Severing Message
 * @desc Message to display when a part is severed
 * @default %1's %2 has been severed!
 *
 * @param Part Destruction Message
 * @desc Message to display when a part is destroyed
 * @default %1's %2 has been destroyed!
 *
 * @param Show Hit Location
 * @desc Show hit location in battle log
 * @type boolean
 * @default true
 *
 * @param Check Command Name
 * @desc Name of the command to check monster body parts
 * @default Check
 *
 * @param Target Command Name
 * @desc Name of the command to target specific body parts
 * @default Target
 * 
 * @command OpenEnemyDetails
 * @text Open Enemy Details
 * @desc Opens the enemy body parts detail window during battle
 *
 * @command OpenTargeting
 * @text Open Targeting Window
 * @desc Opens the targeting window to select a specific body part to attack
 */

(function () {
  // Plugin parameters
  var pluginName = "Health_Monsters";
  var parameters = PluginManager.parameters(pluginName);
  var it = ConfigManager.language === "it";
  var decapitationSound = parameters["Decapitation Sound"] || "Monster5";

  var showHitLocation = String(parameters["Show Hit Location"]) === "true";
  var checkCommandName = parameters["Check Command Name"] || "Check";
  var targetCommandName = parameters["Target Command Name"] || "Target";

  // Vital body parts are protected from destruction (clamped to 1 HP) while the
  // enemy still has more than this fraction of HP. Once the enemy drops to this
  // threshold or below, a destroyed vital part triggers a delayed instakill.
  // Non-vital parts have no such protection and can be severed at any HP.
  var VITAL_INSTAKILL_RATE = 0.25;

  let _statsI18n = null;

  const _loadStatsI18n = async () => {
    const lang = ConfigManager.language || 'en';
    const url = `js/i18n/${lang}/stats.json`;
    try {
      const response = await fetch(url);
      _statsI18n = await response.json();
    } catch (e) {
      console.error('Health_Monsters: Failed to load i18n data from ' + url, e);
    }
  };

  const _si18n = (key) => {
    if (_statsI18n && _statsI18n[key]) {
      return _statsI18n[key];
    }
    return key;
  };

  _loadStatsI18n();

  // Initialize $gameTemp if it doesn't exist
  if (!$gameTemp) {
    $gameTemp = {};
  }

  // Global variables to track targeting state: the aimed part, and the monster
  // it was aimed at (a battle can hold several).
  $gameTemp.targetedBodyPart = null;
  $gameTemp.targetedBodyPartEnemy = null;

  // ===========================================================================
  // Enemy Archetypes Definition
  // ===========================================================================
  // Each archetype defines a set of body parts with their properties
  // ===========================================================================
  // Enemy Archetypes Definition
  // ===========================================================================
  // Each archetype defines a set of body parts with their properties

  // Dynamic getter to avoid timing issues when window.Health is populated by DataService.js later
  const getEnemyArchetypes = () => window.Health ? window.Health.EnemyArchetypes : null;

  function getArchetype(archetypeName) {
    const archs = getEnemyArchetypes();
    return archs ? archs[archetypeName] : null;
  }


  // Weapon type definitions for hit chance calculations
  var WeaponTypes = {
    DAGGER: { id: 1, primaryStat: 6 }, // Agility
    SWORD: { id: 2, primaryStat: 2 }, // Attack
    AXE: { id: 3, primaryStat: 2 }, // Attack
    MACE: { id: 4, primaryStat: 2 }, // Attack
    SPEAR: { id: 5, primaryStat: 6 }, // Agility
    BOW: { id: 6, primaryStat: 6 }, // Agility
    CROSSBOW: { id: 7, primaryStat: 2 }, // Attack
    GUN: { id: 8, primaryStat: 6 }, // Agility
    STAFF: { id: 9, primaryStat: 3 }, // Magic
    HEAVY: { id: 10, primaryStat: 4 }, // Defense
    // Add more as needed
  };

  // Initialize enemy body parts based on enemy notes
  function initializeEnemyBodyParts(enemy) {
    if (enemy._bodyParts) return; // Already initialized

    // Find the enemy's archetype from its notes
    var archetypeRegex = /<Archetype:\s*(\w+)>/i;
    var archetypeMatch = enemy.enemy().note.match(archetypeRegex);

    // Default to Humanoid if no valid archetype is found
    var archetypeName = archetypeMatch ? archetypeMatch[1] : "Humanoid"; // i18n-ignore: archetype id
    var archetype = getArchetype(archetypeName);

    if (!archetype) {
      // i18n-ignore-start: developer diagnostics and archetype ids
      console.error(
        "Invalid archetype: " +
        archetypeName +
        " for enemy " +
        enemy.name() +
        ". Defaulting to Humanoid."
      );
      archetypeName = "Humanoid";
      archetype = getArchetype("Humanoid");
      // i18n-ignore-end

      // If Humanoid still doesn't exist, this is a critical error
      if (!archetype) {
        console.error(
          "CRITICAL ERROR: Humanoid archetype not defined. This plugin requires a Humanoid archetype to be defined."
        );
        // Create a basic fallback archetype to prevent crashes
        const archs = getEnemyArchetypes();
        if (archs) {
          archs.Humanoid = {
            parts: {
              BODY: {
                name: "Body", // i18n-ignore: body-part id, localised from bodyparts.json
                hpPercent: 100,
                vital: true,
                canCutoff: false,
                statEffect: { param: 0, amount: -20 },
                hitDifficulty: 1,
              },
            },
            hitLocations: {
              BODY: { weight: 100 },
            },
          };
          archetype = archs.Humanoid;
        }
      }
    }

    // Store the archetype name for reference
    enemy._archetypeName = archetypeName;
    enemy._bodyParts = {};
    enemy._statModifiers = {}; // Track stat modifiers from damaged parts
    enemy._disabledActions = []; // Track actions disabled by body part damage

    // Initialize body parts based on the archetype
    for (var partKey in archetype.parts) {
      var basePart = archetype.parts[partKey];
      var hpPercentage = basePart.hpPercent / 100;

      // Generate random hit chance modifier for this part (+/- 10%)
      var randomHitModifier = (Math.random() * 20 - 10) / 100; // -10% to +10%

      enemy._bodyParts[partKey] = {
        name: window.getArchetypeText(basePart.name),
        maxHp: Math.max(1, Math.round(enemy.mhp * hpPercentage)),
        currentHp: Math.max(1, Math.round(enemy.mhp * hpPercentage)),
        vital: basePart.vital || false,
        canCutoff: basePart.canCutoff || false,
        regenerates: basePart.regenerates || false,
        destroyed: false,
        specialEffect: basePart.specialEffect || null,
        appliedStatEffect: false,
        hitDifficulty: basePart.hitDifficulty || 1,
        randomHitModifier: randomHitModifier,
      };
    }
  }

  // Get a random hit location based on weights for an enemy's archetype
  function getRandomHitLocation(enemy) {
    try {
      // An aimed part belongs to the monster it was aimed at: with several
      // enemies on the field, a limb picked out on one of them must not steer
      // the blows that land on the others.
      if (
        $gameTemp &&
        $gameTemp.targetedBodyPart &&
        $gameTemp.targetedBodyPartEnemy === enemy &&
        enemy._bodyParts[$gameTemp.targetedBodyPart]
      ) {
        var hitChance = calculateHitChance(enemy, $gameTemp.targetedBodyPart);
        var roll = Math.random() * 100;

        if (roll < hitChance) {
          return { key: $gameTemp.targetedBodyPart, targeted: true };
        }

        // Important: Log that the targeted attack missed its specific target
        if ($gameTemp) {
          $gameTemp.targetMissMessage = T('HealthMonsters.targetedMiss');
        }
      }

      // Otherwise use normal random hit location
      var archetype = getArchetype(enemy._archetypeName);

      // If archetype doesn't exist, use Humanoid as fallback
      if (!archetype) {
        // i18n-ignore-start: developer diagnostics and archetype ids
        console.error(
          "Archetype not found: " +
          enemy._archetypeName +
          ". Using Humanoid as fallback."
        );
        archetype = getArchetype("Humanoid");
        enemy._archetypeName = "Humanoid";
        // i18n-ignore-end
      }

      var hitLocations = archetype.hitLocations;

      var totalWeight = 0;
      var locations = [];

      for (var loc in hitLocations) {
        // Skip already destroyed parts
        if (enemy._bodyParts[loc].destroyed) continue;

        totalWeight += hitLocations[loc].weight;
        locations.push({
          key: loc,
          weight: hitLocations[loc].weight,
          cumulative: totalWeight,
        });
      }

      // If all parts are destroyed or no valid locations, default to the first part
      if (locations.length === 0) {
        var fallbackKey = Object.keys(hitLocations)[0];
        return { key: fallbackKey };
      }

      var roll = Math.random() * totalWeight;

      for (var i = 0; i < locations.length; i++) {
        if (roll <= locations[i].cumulative) {
          return { key: locations[i].key };
        }
      }

      // Failsafe
      return { key: locations[0].key };
    } catch (e) {
      console.error("Error in getRandomHitLocation:", e);
      // Emergency fallback
      return { key: Object.keys(enemy._bodyParts)[0] };
    }
  }

  // Calculate hit chance for a specific body part
  // Calculate hit chance for a specific body part - simplified to always use actor1
  function calculateHitChance(enemy, partKey) {
    var part = enemy._bodyParts[partKey];

    // Guard against missing part or destroyed parts
    if (!part || part.destroyed) return 0;

    // Always use actor1 as the user
    var user = $gameActors.actor(1);

    // Base chance is 80%
    var baseChance = 80;

    // Adjust for part difficulty
    baseChance -= (part.hitDifficulty - 1) * 25;

    // Adjust for vital parts (harder to hit)
    if (part.vital) {
      baseChance -= 10;
    }

    // Get weapon type and adjust based on appropriate user stat
    var weaponType = getWeaponType(user);
    var userStat = 0;
    var enemyStat = 0;

    // Determine which stats to use based on weapon type
    if (weaponType) {
      switch (weaponType.primaryStat) {
        case 2: // Attack
          userStat = user.atk;
          enemyStat = enemy.def;
          break;
        case 3: // Magic
          userStat = user.mat;
          enemyStat = enemy.mdf;
          break;
        case 4: // Defense
          userStat = user.def;
          enemyStat = enemy.def;
          break;
        case 6: // Agility
          userStat = user.agi;
          enemyStat = enemy.agi;
          break;
        default:
          userStat = user.atk;
          enemyStat = enemy.def;
      }
    } else {
      // Default to ATK if no weapon type found
      userStat = user.atk;
      enemyStat = enemy.def;
    }

    // Adjust based on user vs enemy stats
    var statRatio = userStat / Math.max(1, enemyStat);
    baseChance += Math.min(15, Math.floor((statRatio - 1) * 20)); // Max +15% for high stat ratio

    // Apply random modifier for this part (set at battle start)
    baseChance += (part.randomHitModifier || 0) * 100;

    // Clamp the final chance between 5% and 95%
    return Math.max(5, Math.min(95, baseChance));
  }
  // Get the weapon type for an actor
  function getWeaponType(actor) {
    if (!actor || !actor.weapons()[0]) return null;

    var weapon = actor.weapons()[0];
    var wtypeId = weapon.wtypeId;

    // Map game's weapon type ID to our defined types
    for (var key in WeaponTypes) {
      if (WeaponTypes[key].id === wtypeId) {
        return WeaponTypes[key];
      }
    }

    return null;
  }

  // Get the appropriate message for destroyed body part
  function getElementalMessage(elementId) {
    const verbs = T.obj('HealthMonsters.elementVerb') || {};
    return verbs[elementId] || T('HealthMonsters.elementVerbDefault');
  }

  // Apply damage to an enemy body part
  function applyDamageToBodyPart(enemy, partKey, damage, isTargeted) {
    try {
      if (!enemy || !enemy._bodyParts) {
        console.error(
          "Enemy or body parts not initialized in applyDamageToBodyPart"
        );
        return 0;
      }

      var part = enemy._bodyParts[partKey];
      if (!part) {
        // i18n-ignore-start: developer diagnostic
        console.error(
          "Part not found: " + partKey + " for enemy: " +
          (enemy.name ? enemy.name() : "Unknown"));
        // i18n-ignore-end
        return 0;
      }

      if (part.destroyed) return 0;

      // Find the archetype data
      var archetype = getArchetype(enemy._archetypeName);
      if (!archetype) {
        console.error("Archetype not found: " + enemy._archetypeName);
        return 0;
      }

      var basePart = archetype.parts[partKey];
      if (!basePart) {
        console.error(   // i18n-ignore: developer diagnostic
          "Base part data not found: " + partKey + " in archetype: " + enemy._archetypeName);
        return 0;
      }

      // Parts can always take damage
      var appliedDamage = Math.min(part.currentHp, damage);
      part.currentHp -= appliedDamage;

      // Check if part can be destroyed/severed.
      // Non-vital parts can be severed/destroyed at ANY enemy HP (no protection).
      // Vital parts are protected: they cannot drop below 1 HP while the enemy
      // still has more than VITAL_INSTAKILL_RATE HP. Once the enemy reaches that
      // threshold or below, destroying a vital part triggers the delayed instakill
      // scheduled in handleDestroyedBodyPart.
      var canBeDestroyed = !basePart.vital || enemy.hpRate() <= VITAL_INSTAKILL_RATE;

      // Check if part is now destroyed
      if (part.currentHp <= 0) {
        part.currentHp = 0;

        if (canBeDestroyed) {
          part.destroyed = true;
          handleDestroyedBodyPart(enemy, partKey);
        } else {
          // Vital part clamped to 1 HP while the enemy is above the instakill threshold.
          part.currentHp = 1;

          // Show message that the vital part can't be fully destroyed yet
          if ($gameTemp && showHitLocation) {
            $gameTemp.hitLocationMessage = T('HealthMonsters.partSeverelyDamaged', { part: part.name });
          }
        }
      }

      return appliedDamage;
    } catch (e) {
      console.error("Error in applyDamageToBodyPart: " + e.message);
      console.error(e.stack);
      return 0;
    }
  }

  // Apply stat effect for a destroyed part
  function applyStatEffect(enemy, partKey) {
    var part = enemy._bodyParts[partKey];
    var archetype = getArchetype(enemy._archetypeName);
    var basePart = archetype ? archetype.parts[partKey] : null;
    if (!basePart) return;

    if (part.appliedStatEffect || !basePart.statEffect) return;

    // Apply the stat effect
    var paramId = basePart.statEffect.param;
    var amount = basePart.statEffect.amount;

    // Track the stat modifier
    if (!enemy._statModifiers[paramId]) {
      enemy._statModifiers[paramId] = 0;
    }
    enemy._statModifiers[paramId] += amount;

    // Mark as applied
    part.appliedStatEffect = true;

    // Apply special effects if any
    if (basePart.specialEffect) {
      applySpecialEffect(enemy, basePart.specialEffect);
    }

    // Refresh enemy to apply stat changes
    enemy.refresh();
  }

  // Translate a body-part i18n msg key (e.g. "enemyArchetypes.robot.right_arm.msg").
  // Returns null when the key is empty or can't be resolved in the current language,
  // so callers fall back to the localized part name instead of printing the raw key.
  function getPartDamageMsg(basePart) {
    if (!basePart || !basePart.msg) return null;
    var translated =
      typeof window.getArchetypeText === "function"
        ? window.getArchetypeText(basePart.msg)
        : basePart.msg;
    // getArchetypeText echoes the key back when the path isn't found.
    if (
      !translated ||
      translated === basePart.msg ||
      /^enemyArchetypes\./.test(translated)
    ) {
      return null;
    }
    return translated;
  }


  // Handle effects of a destroyed body part
  function handleDestroyedBodyPart(enemy, partKey) {
    try {
      if (!enemy || !enemy._bodyParts) {
        console.error(
          "Enemy or body parts not initialized in handleDestroyedBodyPart"
        );
        return;
      }

      var part = enemy._bodyParts[partKey];
      if (!part) {
        // i18n-ignore-start: developer diagnostic
        console.error(
          "Part not found: " + partKey + " for enemy: " +
          (enemy.name ? enemy.name() : "Unknown"));
        // i18n-ignore-end
        return;
      }

      // Find the archetype data
      var archetype = getArchetype(enemy._archetypeName);
      if (!archetype) {
        console.error("Archetype not found: " + enemy._archetypeName);
        return;
      }

      var basePart = archetype.parts[partKey];
      if (!basePart) {
        console.error(   // i18n-ignore: developer diagnostic
          "Base part data not found: " + partKey + " in archetype: " + enemy._archetypeName);
        return;
      }

      // Apply stat effect if not already applied
      if (!part.appliedStatEffect) {
        applyStatEffect(enemy, partKey);
      }

      // Prepare message based on element type
      var elementId = $gameTemp ? $gameTemp.lastElementalType : null;
      var message = "";

      // Check if it's an elemental attack (and not physical)
      if (elementId && elementId > 1) {
        // Use elemental message format
        var elementalEffect = getElementalMessage(elementId);
        message = T('HealthMonsters.partElementalHit', {
          enemy: enemy.name(), part: part.name, effect: elementalEffect,
        });
      } else {
        // For physical or non-elemental attacks
        var isIt = T.language() === "it";
        var translatedMsg = getPartDamageMsg(basePart);
        if (translatedMsg) {
          // Custom message if available and resolvable in the current language
          message = T('HealthMonsters.customPartMessage', { enemy: enemy.name(), message: translatedMsg });
        } else if (basePart.canCutoff) {
          // Severing message for parts that can be cut off
          if (isIt) {
            part.name = part.name_it || part.name;
          }
          message = T('HealthMonsters.partSevered', { enemy: enemy.name(), part: part.name });

          // Play severing sound
          AudioManager.playSe({
            name: decapitationSound,
            volume: 90,
            pitch: 100,
            pan: 0,
          });
        } else {
          // Default destruction message
          if (isIt) {
            part.name = part.name_it || part.name;
          }
          message = T('HealthMonsters.partDestroyed', { enemy: enemy.name(), part: part.name });
        }
      }

      // Store the message in battle log
      if ($gameTemp) {
        $gameTemp.limbDamageBattleLog = {
          type: "custom",
          text: message,
          isVital: basePart.vital,
        };

        // If vital part is destroyed, schedule delayed death
        if (basePart.vital) {
          $gameTemp.vitalPartDestroyedEnemy = enemy;
        }

        // Add stat effect info to the battle log
        if (basePart.statEffect) {
          $gameTemp.statEffectMessage = {
            enemyName: enemy.name(),
            paramName: getParamName(basePart.statEffect.param),
            amount: Math.abs(basePart.statEffect.amount),
          };
        }
      }

      // Losing a limb erupts a big blood spray and leaves a permanent puddle.
      // Point the FX at this exact part and let BloodSplatterFX (if present)
      // localise the gib onto it (3D mode) or onto the battler sprite (2D mode).
      enemy._fxLastHitPart = partKey;
      // Bump the hit sequence so battle-animation FX can detect a fresh impact
      // and (re)lock onto this exact part for the rest of the effect.
      enemy._fxHitSeq = (enemy._fxHitSeq || 0) + 1;
      // Flag the impact so the 3D battler plays its whole-body stagger/recoil
      // (reserved for critical hits and limb loss; cleared once consumed).
      enemy._partLostStagger = true;
      if (window.BloodSplatterFX && window.BloodSplatterFX.onBodyPartLost) {
        window.BloodSplatterFX.onBodyPartLost(enemy, partKey);
      }
    } catch (e) {
      console.error("Error in handleDestroyedBodyPart: " + e.message);
      console.error(e.stack);
    }
  }

  // Apply special effects based on destroyed parts
  function applySpecialEffect(enemy, effect) {
    switch (effect) {
      case "disableFireBreath":
        // Find skills that involve fire breath. Prefer language-independent
        // signals so this keeps working under localization or skill renames:
        // a <FireBreath> or <Breath> note tag, or the Fire element (id 2, see
        // the elemental id table). Fall back to the English name match only
        // when neither a tag nor a fire element is present.
        var fireBreathSkillIds = [];
        enemy.enemy().actions.forEach(function (action) {
          var skill = $dataSkills[action.skillId];
          if (!skill) return;
          var meta = skill.meta || {};
          var taggedBreath = meta.FireBreath || meta.Breath;
          var isFireElement = skill.damage && skill.damage.elementId === 2;
          var nameMatch =
            skill.name &&
            (skill.name.includes("Fire") || skill.name.includes("Breath")); // i18n-ignore: skill-name probe
          if (taggedBreath || isFireElement || nameMatch) {
            fireBreathSkillIds.push(action.skillId);
          }
        });

        // Add these skill IDs to disabled actions
        enemy._disabledActions =
          enemy._disabledActions.concat(fireBreathSkillIds);
        break;

      // Add more special effects as needed
    }
  }

  // Get parameter name for display
  function getParamName(paramId) {
    return T.list('HealthMonsters.paramNames')[paramId] || T('HealthMonsters.statFallback');
  }

  // Apply limb damage to enemy
  // Apply limb damage to enemy
  // Apply limb damage to enemy - FIXED VERSION
  function applyLimbDamage(enemy, damage, elementalType) {
    try {
      if (!enemy) return;

      // Make sure enemy has body parts initialized
      if (!enemy._bodyParts) initializeEnemyBodyParts(enemy);

      // Make sure $gameTemp exists
      if (!$gameTemp) {
        $gameTemp = {};
      }

      // Get a random hit location
      var hitLocation = getRandomHitLocation(enemy);
      if (!hitLocation || !hitLocation.key) {
        console.error("Failed to get hit location for enemy: " + enemy.name());
        return;
      }

      var partKey = hitLocation.key;
      enemy._lastHitPart = partKey;
      // Durable copy for blood/effect plugins: the 3D battler clears _lastHitPart
      // once it has flashed the limb, but the blood spray (fired a few frames
      // later) still needs to know which part was struck.
      enemy._fxLastHitPart = partKey;
      // Bump the hit sequence so battle-animation FX can detect a fresh impact
      // and (re)lock the Effekseer effect onto this exact part.
      enemy._fxHitSeq = (enemy._fxHitSeq || 0) + 1;
      if (!enemy._bodyParts[partKey]) {
        console.error(
          "Body part not found: " + partKey + " for enemy: " + enemy.name()
        );
        return;
      }

      var part = enemy._bodyParts[partKey];
      var isTargeted = hitLocation.targeted || false;

      // Show hit location in battle log if enabled
      if (showHitLocation && $gameParty.inBattle()) {
        if (isTargeted) {
          // Show precise strike message for targeted hits
          $gameTemp.hitLocationMessage = T('HealthMonsters.preciseStrike', { part: part.name });
        } else if ($gameTemp.targetMissMessage) {
          // Show the miss message if a targeted attack missed
          $gameTemp.hitLocationMessage = $gameTemp.targetMissMessage;
          $gameTemp.targetMissMessage = null; // Clear the message after use
        } else {
          // Default hit message
          $gameTemp.hitLocationMessage = T('HealthMonsters.partWasHit', {
            enemy: enemy.name(), part: part.name,
          });
        }
      }

      // Apply damage to the part
      applyDamageToBodyPart(enemy, partKey, damage, isTargeted);

      // Store the elemental type for displaying the correct message later
      $gameTemp.lastElementalType = elementalType;

      // Reset targeted body part after use
      if (isTargeted) {
        $gameTemp.targetedBodyPart = null;
        $gameTemp.targetedBodyPartEnemy = null;
      }
    } catch (e) {
      console.error(e.stack);
    }
  }
  // Override Game_Enemy.param to apply body part damage effects
  var _Game_Enemy_param = Game_Enemy.prototype.param;
  Game_Enemy.prototype.param = function (paramId) {
    var value = _Game_Enemy_param.call(this, paramId);

    // Apply limb damage modifiers
    if (this._statModifiers && this._statModifiers[paramId]) {
      value = Math.round(value * (1 + this._statModifiers[paramId] / 100));
    }

    return Math.max(1, value);
  };

  // Override action list to disable actions from destroyed parts
  var _Game_Enemy_actions = Game_Enemy.prototype.actions;
  Game_Enemy.prototype.actions = function () {
    var actions = _Game_Enemy_actions.call(this);

    // Filter out disabled actions
    if (this._disabledActions && this._disabledActions.length > 0) {
      return actions.filter(function (action) {
        return !this._disabledActions.includes(action.skillId);
      }, this);
    }

    return actions;
  };

  // Override damage application for enemies
  var _Game_Action_executeHpDamage = Game_Action.prototype.executeHpDamage;
  Game_Action.prototype.executeHpDamage = function (target, value) {
    _Game_Action_executeHpDamage.call(this, target, value);

    // Only apply limb damage system to enemies
    if (target.isEnemy() && value > 0) {
      // Get the elemental type if applicable
      var elementalType = null;
      if (
        this.item() &&
        this.item().damage &&
        this.item().damage.elementId > 0
      ) {
        elementalType = this.item().damage.elementId;
      }

      // Store elemental type for later use
      $gameTemp.lastElementalType = elementalType;

      applyLimbDamage(target, value);
    }
  };

  // Add hooks for BattleLog to display limb damage
  var _Window_BattleLog_displayHpDamage =
    Window_BattleLog.prototype.displayHpDamage;
  Window_BattleLog.prototype.displayHpDamage = function (target) {
    _Window_BattleLog_displayHpDamage.call(this, target);

    // Make sure $gameTemp exists
    if (!$gameTemp) {
      $gameTemp = {};
      return;
    }

    // Show hit location if enabled
    if (showHitLocation && $gameTemp.hitLocationMessage && target.isEnemy()) {
      this.push("addText", $gameTemp.hitLocationMessage);
      $gameTemp.hitLocationMessage = null;
    }

    // Check for limb damage logs
    if ($gameTemp.limbDamageBattleLog && target.isEnemy()) {
      var log = $gameTemp.limbDamageBattleLog;

      // Show the appropriate message
      this.push("addText", log.text);

      // Show stat effect if applicable
      /*
            if ($gameTemp.statEffectMessage) {
                var statMsg = $gameTemp.statEffectMessage;
                this.push('addText', statMsg.enemyName + "'s " + statMsg.paramName + " reduced by " + statMsg.amount + "!");
                $gameTemp.statEffectMessage = null;
            }*/

      // Handle delayed death for vital part destruction
      if (log.isVital && $gameTemp.vitalPartDestroyedEnemy) {
        // Push wait commands to delay the death
        this.push("wait");
        this.push("wait");
        this.push("wait");

        // Schedule enemy death on next update
        $gameTemp.scheduleEnemyDeath = true;
      }

      $gameTemp.limbDamageBattleLog = null;
      $gameTemp.lastElementalType = null;
    }
  };

  // Setup for when battle starts
  var _BattleManager_setup = BattleManager.setup;
  BattleManager.setup = function (troopId, canEscape, canLose) {
    _BattleManager_setup.call(this, troopId, canEscape, canLose);

    // Make sure $gameTemp exists
    if (!$gameTemp) {
      $gameTemp = {};
    }

    // Initialize body parts for all enemies
    $gameTroop.members().forEach(function (enemy) {
      initializeEnemyBodyParts(enemy);
    });

    // Initialize temp variables for vital part destruction
    $gameTemp.vitalPartDestroyedEnemy = null;
    $gameTemp.scheduleEnemyDeath = false;
    $gameTemp.checkTargetSelection = false;
    $gameTemp.checkWindowActive = false;
    $gameTemp.targetedBodyPart = null;
    $gameTemp.targetedBodyPartEnemy = null;
    $gameTemp.hitLocationMessage = null;
    $gameTemp.limbDamageBattleLog = null;
    $gameTemp.lastElementalType = null;
    $gameTemp.statEffectMessage = null;
  };
  // ============================================================================
  // NEW: Window_MonsterInfo - Left side information window
  // ============================================================================

  function Window_MonsterInfo() {
    this.initialize.apply(this, arguments);
  }

  Window_MonsterInfo.prototype = Object.create(Window_Base.prototype);
  Window_MonsterInfo.prototype.constructor = Window_MonsterInfo;

  Window_MonsterInfo.prototype.initialize = function (enemy) {
    var width = Graphics.boxWidth * 0.55; // Left half
    var height = 520; // Increased from 440 to 520
    var x = 0;
    var y = (Graphics.boxHeight - height) / 2 + 88;
    var rect = new Rectangle(x, y, width, height);
    Window_Base.prototype.initialize.call(this, rect);
    this._enemy = enemy;
    this._monsterDescription = this.extractMonsterDescription(enemy);
    this.refresh();
    this.show();
    this.z = 9999;
  };

  Window_MonsterInfo.prototype.extractMonsterDescription = function (enemy) {
    if (!enemy || !enemy.enemy() || !enemy.enemy().note) return "";
    const data = enemy.enemy();
    // Descriptions use combinatorial {a | b | c} inline text resolved (seeded
    // from the world seed) by the shared EnemyDescription service.
    let desc = "";
    if (window.EnemyDescription) {
      desc = window.EnemyDescription.describe(data.id);
    } else {
      const enMatch = data.note.match(/<En:\s*([^>]+)>/i);
      desc = enMatch && enMatch[1] ? enMatch[1].trim() : "";
    }
    return desc ? this.addLineBreaks(desc, 20) : "";
  };

  Window_MonsterInfo.prototype.addLineBreaks = function (text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    var result = "";
    var currentLine = "";
    var words = text.split(" ");
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (currentLine.length + word.length + 1 > maxLength) {
        result += currentLine.trim() + "\n";
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    if (currentLine.length > 0) {
      result += currentLine.trim();
    }
    return result;
  };
  Window_MonsterInfo.prototype.refresh = function () {
    this.contents.clear();
    if (!this._enemy || !this._enemy._bodyParts) return;
    var lineHeight = this.lineHeight();
    var y = 0;

    // Draw monster description FIRST
    if (this._monsterDescription && this._monsterDescription.length > 0) {
      this.resetTextColor();
      var descLines = this._monsterDescription.split("\n");
      for (var i = 0; i < descLines.length; i++) {
        this.drawText(descLines[i], 10, y, this.contentsWidth() - 20);
        y += lineHeight;
      }
      y += lineHeight / 2; // Add some space after description
    }

    // Then draw element info
    this.drawElementInfo(y);
    y += lineHeight * 2; // Two lines for element info

    y += lineHeight / 2;
    this.drawHorzLine(y - lineHeight / 2);
    this.drawEnemyStats(y);
    y += lineHeight * 2;

    this.drawHorzLine(y - lineHeight / 2);
    this.drawAppliedStates(y);
    this.changeTextColor(this.systemColor());
  };

  Window_MonsterInfo.prototype.drawHorzLine = function (y) {
    var lineY = y + this.lineHeight() / 2 - 1;
    this.contents.fillRect(0, lineY, this.contentsWidth(), 2, this.systemColor());
  };

  Window_MonsterInfo.prototype.drawElementInfo = function (y) {
    const useTranslation = ConfigManager.language === "it";
    const lineHeight = this.lineHeight();
    const enemy = this._enemy;

    let attackElement = "Normal";
    const traits = enemy.enemy().traits;
    for (let i = 0; i < traits.length; i++) {
      const trait = traits[i];
      if (trait.code === Game_BattlerBase.TRAIT_ATTACK_ELEMENT && trait.dataId > 0) {
        attackElement = $dataSystem.elements[trait.dataId];
        break;
      }
    }

    const weaknesses = [];
    for (let i = 1; i < $dataSystem.elements.length; i++) {
      const rate = enemy.elementRate(i) * 100;
      if (rate > 100) {
        weaknesses.push({ name: $dataSystem.elements[i], rate: rate });
      }
    }
    weaknesses.sort((a, b) => b.rate - a.rate);

    this.changeTextColor(this.systemColor());
    this.drawText(T('HealthMonsters.elementLabel'), 0, y, 140);
    this.resetTextColor();
    this.drawText(attackElement, 140, y, this.contentsWidth() - 140);
    y += lineHeight;

    this.changeTextColor(this.systemColor());
    this.drawText(T('HealthMonsters.weakToLabel'), 0, y, 120);
    this.resetTextColor();

    if (weaknesses.length > 0) {
      let weaknessText = "";
      for (let i = 0; i < weaknesses.length; i++) {
        const weakness = weaknesses[i];
        if (i > 0) weaknessText += ", ";
        weaknessText += weakness.name + " " + weakness.rate + "%";
      }
      this.drawText(weaknessText, 140, y, this.contentsWidth() - 140);
    } else {
      this.drawText(T('HealthMonsters.none'), 140, y, this.contentsWidth() - 140);
    }
  };

  Window_MonsterInfo.prototype.drawEnemyStats = function (y) {
    const useTranslation = ConfigManager.language === "it";
    const enemy = this._enemy;
    const paramNames = [
      _si18n("ATT"),
      _si18n("DEF"),
      _si18n("M.ATT"),
      _si18n("M.DEF"),
      _si18n("AGILITY")
    ];

    const baseValues = [];
    for (let i = 2; i < 7; i++) {
      baseValues.push(enemy.enemy().params[i]);
    }

    const currentValues = [];
    for (let i = 2; i < 7; i++) {
      currentValues.push(enemy.param(i));
    }

    const startX = 10;
    const availableWidth = this.contentsWidth() - startX - 10;
    const colWidth = Math.floor(availableWidth / 6);

    for (let i = 0; i < 5; i++) {
      const x = startX + i * colWidth;
      const current = currentValues[i];
      const base = baseValues[i];
      const diff = current - base;

      this.changeTextColor(this.systemColor());
      this.drawText(paramNames[i], x, y, colWidth - 5, 'center');

      if (diff < 0) {
        this.changeTextColor(this.powerDownColor());
      } else if (diff > 0) {
        this.changeTextColor(this.powerUpColor());
      } else {
        this.resetTextColor();
      }

      this.drawText(current, x, y + this.lineHeight(), colWidth - 5, 'center');
    }
    this.resetTextColor();
  };

  Window_MonsterInfo.prototype.drawAppliedStates = function (y) {
    const useTranslation = ConfigManager.language === "it";
    const enemy = this._enemy;
    const states = enemy.states();

    this.changeTextColor(this.systemColor());
    this.drawText(T('HealthMonsters.statesLabel'), 0, y, 120);
    this.resetTextColor();

    if (states.length === 0) {
      this.drawText(T('HealthMonsters.none'), 120, y, this.contentsWidth() - 120);
      return;
    }

    let x = 120;
    const iconWidth = 32;

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      if (x + iconWidth + this.textWidth(state.name) > this.contentsWidth()) {
        y += this.lineHeight();
        x = 120;
      }
      if (state.iconIndex > 0) {
        this.drawIcon(state.iconIndex, x, y);
        x += iconWidth;
      }
      const stateNameWidth = Math.min(150, this.textWidth(state.name) + 10);
      this.drawText(state.name, x, y, stateNameWidth);
      x += stateNameWidth + 10;
    }
  };
  // ============================================================================
  // NEW: Window_MonsterBodyPartsList - Right side parts list window
  // ============================================================================

  function Window_MonsterBodyPartsList() {
    this.initialize.apply(this, arguments);
  }

  Window_MonsterBodyPartsList.prototype = Object.create(Window_Selectable.prototype);
  Window_MonsterBodyPartsList.prototype.constructor = Window_MonsterBodyPartsList;

  Window_MonsterBodyPartsList.prototype.initialize = function (enemy, isTargeting) {
    var width = Graphics.boxWidth * 0.50;
    var height = 520;
    var x = Graphics.boxWidth * 0.45;
    var y = (Graphics.boxHeight - height) / 2 + 88;
    var rect = new Rectangle(x, y, width, height);
    Window_Selectable.prototype.initialize.call(this, rect);
    this._enemy = enemy;
    this._isTargeting = isTargeting || false;
    this._data = [];

    if (!$gameTemp) {
      $gameTemp = {};
    }
    if (!$gameTemp.lastTargetSelections) {
      $gameTemp.lastTargetSelections = {};
    }

    var enemyId = enemy.enemyId();

    if (enemy && enemy._bodyParts) {
      for (var partKey in enemy._bodyParts) {
        this._data.push({
          key: partKey,
          part: enemy._bodyParts[partKey],
          selectable: !(this._isTargeting && enemy._bodyParts[partKey].destroyed),
        });
      }
    }
    this.refresh();

    var indexToSelect = 0;

    // If in targeting mode, try to restore last selected index
    if (this._isTargeting && $gameTemp.lastTargetSelections[enemyId] !== undefined) {
      var lastIndex = $gameTemp.lastTargetSelections[enemyId];
      if (lastIndex >= 0 && lastIndex < this._data.length && this._data[lastIndex].selectable !== false) {
        indexToSelect = lastIndex;
      }
    }

    this.select(indexToSelect);
    this.activate();
    this.show();
    this.z = 9999;

    if (this.parent) {
      this.parent.removeChild(this);
      this.parent.addChild(this);
    }
  };

  Window_MonsterBodyPartsList.prototype.maxItems = function () {
    return this._data.length;
  };

  Window_MonsterBodyPartsList.prototype.itemHeight = function () {
    return this.lineHeight();
  };

  Window_MonsterBodyPartsList.prototype.refresh = function () {
    this.contents.clear();
    if (!this._enemy || !this._enemy._bodyParts) return;

    var lineHeight = this.lineHeight();
    var y = 0;
    var useTranslation = ConfigManager.language === "it";

    this.changeTextColor(this.systemColor());
    this.drawText(T('HealthMonsters.bodyParts'), 0, y, this.contentsWidth(), 'center');
    this.resetTextColor();
    this.itemY = lineHeight * 2;

    this.drawAllItems();
  };

  Window_MonsterBodyPartsList.prototype.drawItem = function (index) {
    if (index < 0 || index >= this._data.length) return;

    var item = this._data[index];
    var part = item.part;
    var rect = this.itemRect(index);
    var useTranslation = ConfigManager.language === "it";

    var hpPercent = Math.floor((part.currentHp / part.maxHp) * 100);

    // Highlight if this is the currently targeted part (in targeting mode)
    var enemyId = this._enemy.enemyId();
    var isCurrentTarget = this._isTargeting &&
      $gameTemp.lastTargetSelections &&
      $gameTemp.lastTargetSelections[enemyId] === index;

    if (isCurrentTarget && index === this.index()) {
      // Draw selection background with special color
      this.contents.fillRect(rect.x, rect.y, rect.width, rect.height, 'rgba(255, 255, 0, 0.2)');
    }

    if (part.destroyed) {
      this.changeTextColor(ColorManager.deathColor());
    } else if (hpPercent <= 25) {
      this.changeTextColor(ColorManager.crisisColor());
    } else if (hpPercent <= 50) {
      this.changeTextColor(ColorManager.textColor(17));
    } else {
      this.resetTextColor();
    }

    var partName = useTranslation && part.name_it ? part.name_it : part.name;
    this.drawText(partName, rect.x + 4, rect.y, rect.width - 60);

    var hpText = part.destroyed ? "X" : hpPercent + "%";
    this.drawText(hpText, rect.x + rect.width - 70, rect.y, 66, 'right');

    this.resetTextColor();

    if (this._isTargeting && index === this.index()) {
      this.changePaintOpacity(true);
    }
  };

  Window_MonsterBodyPartsList.prototype.itemRect = function (index) {
    var rect = new Rectangle();
    rect.width = this.contentsWidth();
    rect.height = this.lineHeight();
    rect.x = 0;
    rect.y = this.itemY + index * rect.height - this._scrollY;
    return rect;
  };

  Window_MonsterBodyPartsList.prototype.update = function () {
    Window_Selectable.prototype.update.call(this);
    if (this._isTargeting && this.active && this._data.length > 0) {
      if (!this.isCurrentItemEnabled() && this._index >= 0) {
        this.selectNextAvailable();
      }
    }
  };

  Window_MonsterBodyPartsList.prototype.selectNextAvailable = function () {
    var currentIndex = this.index();
    var maxItems = this._data.length;
    for (var i = 1; i < maxItems; i++) {
      var index = (currentIndex + i) % maxItems;
      if (this._data[index].selectable !== false) {
        this.select(index);
        return;
      }
    }
    this.select(-1);
  };

  Window_MonsterBodyPartsList.prototype.isCurrentItemEnabled = function () {
    if (this.index() < 0 || this.index() >= this._data.length) return false;
    var item = this._data[this.index()];
    return item.selectable !== false;
  };

  Window_MonsterBodyPartsList.prototype.processOk = function () {
    if (this._isTargeting && this.index() >= 0 && this.isCurrentItemEnabled()) {
      if (!$gameTemp) {
        $gameTemp = {};
      }
      if (!$gameTemp.lastTargetSelections) {
        $gameTemp.lastTargetSelections = {};
      }
      var enemyId = this._enemy.enemyId();
      $gameTemp.lastTargetSelections[enemyId] = this.index();
      $gameTemp.targetedBodyPart = this._data[this.index()].key;
      // Remember WHICH monster the limb was picked out on, so a field with
      // several of them aims the blow at the one the player was looking at.
      $gameTemp.targetedBodyPartEnemy = this._enemy;
      SoundManager.playOk();
    }
    this.close();
  };

  Window_MonsterBodyPartsList.prototype.close = function () {
    $gameTemp.checkWindowActive = false;
    if (!this._isTargeting) {
      SoundManager.playCancel();
    }
    Window_Selectable.prototype.close.call(this);
    setTimeout(
      function () {
        if (this.parent) this.parent.removeChild(this);
      }.bind(this),
      100
    );
  };
  Window_MonsterInfo.prototype.powerUpColor = function () {
    return ColorManager.powerUpColor ? ColorManager.powerUpColor() : ColorManager.textColor(24);
  };

  Window_MonsterInfo.prototype.powerDownColor = function () {
    return ColorManager.powerDownColor ? ColorManager.powerDownColor() : ColorManager.textColor(25);
  };
  // Scene_Battle modifications
  // REPLACE THIS HOOK:
  var _Scene_Battle_update = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function () {
    if ($gameTemp.checkWindowActive) {
      if (this._bodyPartsWindow) {
        this._bodyPartsWindow.update();
      }
      if (this._monsterInfoWindow) {
        this._monsterInfoWindow.update();
      }
    } else {
      _Scene_Battle_update.call(this);
    }
  };

  // ---------------------------------------------------------------------------
  // Check (read a monster's anatomy) and Aim (pick the limb to strike). Both
  // open on ONE monster, and a battle can hold several since nearby roamers
  // join a fight (BattleSystemEnhancedEncounters, section 5b). With a single
  // living enemy there is nothing to choose and the panel opens straight away;
  // with more, the player picks through the ordinary battle target window
  // first, whose handlers are put back the moment the choice is made.
  // ---------------------------------------------------------------------------

  Scene_Battle.prototype.openMonsterBodyParts = function (enemy, isTargeting) {
    this._actorCommandWindow.deactivate();

    // Info window (left side)
    this._monsterInfoWindow = new Window_MonsterInfo(enemy);
    this.addWindow(this._monsterInfoWindow);

    // Body parts list window (right side)
    this._bodyPartsWindow = new Window_MonsterBodyPartsList(enemy, isTargeting);
    this.addWindow(this._bodyPartsWindow);
    if (isTargeting) {
      this._bodyPartsWindow.setHandler("ok", this.onTargetingOk.bind(this));
      this._bodyPartsWindow.setHandler("cancel", this.onTargetingCancel.bind(this));
    } else {
      this._bodyPartsWindow.setHandler("ok", this.onBodyPartsOk.bind(this));
      this._bodyPartsWindow.setHandler("cancel", this.onBodyPartsCancel.bind(this));
    }

    $gameTemp.checkWindowActive = true;
  };

  Scene_Battle.prototype.restoreEnemyWindowHandlers = function () {
    if (!this._enemyWindow) return;
    this._enemyWindow.setHandler("ok", this.onEnemyOk.bind(this));
    this._enemyWindow.setHandler("cancel", this.onEnemyCancel.bind(this));
  };

  Scene_Battle.prototype.selectMonsterForBodyParts = function (isTargeting) {
    var candidates = $gameTroop.aliveMembers().filter(function (e) {
      return e && e._bodyParts;
    });
    if (candidates.length === 0) {
      this._actorCommandWindow.activate();
      return;
    }
    if (candidates.length === 1 || !this._enemyWindow) {
      this.openMonsterBodyParts(candidates[0], isTargeting);
      return;
    }
    this._bodyPartsTargeting = isTargeting;
    this._actorCommandWindow.deactivate();
    this._enemyWindow.refresh();
    this._enemyWindow.show();
    this._enemyWindow.setHandler("ok", this.onBodyPartsEnemyOk.bind(this));
    this._enemyWindow.setHandler("cancel", this.onBodyPartsEnemyCancel.bind(this));
    this._enemyWindow.select(0);
    this._enemyWindow.activate();
  };

  Scene_Battle.prototype.onBodyPartsEnemyOk = function () {
    var enemy = this._enemyWindow.enemy();
    this._enemyWindow.hide();
    this._enemyWindow.deactivate();
    this.restoreEnemyWindowHandlers();
    if (enemy && enemy._bodyParts) {
      this.openMonsterBodyParts(enemy, this._bodyPartsTargeting);
    } else {
      this._actorCommandWindow.activate();
    }
  };

  Scene_Battle.prototype.onBodyPartsEnemyCancel = function () {
    this._enemyWindow.hide();
    this._enemyWindow.deactivate();
    this.restoreEnemyWindowHandlers();
    this._actorCommandWindow.activate();
  };

  // Check command handler
  Scene_Battle.prototype.commandCheck = function () {
    this.selectMonsterForBodyParts(false);
  };

  // Target command handler
  Scene_Battle.prototype.commandTarget = function () {
    this.selectMonsterForBodyParts(true);
  };
  // Handler for closing check window
  Scene_Battle.prototype.onBodyPartsOk = function () {
    this.closeBodyPartsWindow();
  };

  Scene_Battle.prototype.onBodyPartsCancel = function () {
    this.closeBodyPartsWindow();
  };

  // Handler for targeting window
  // Replace the onTargetingOk handler
  Scene_Battle.prototype.onTargetingOk = function () {
    // Store the selected index for this enemy
    if (this._bodyPartsWindow && this._bodyPartsWindow._enemy) {
      var enemyId = this._bodyPartsWindow._enemy.enemyId();
      if (!$gameTemp.lastTargetSelections) {
        $gameTemp.lastTargetSelections = {};
      }
      $gameTemp.lastTargetSelections[enemyId] = this._bodyPartsWindow.index();
    }

    // Close BOTH windows (body parts list and monster info)
    if (this._bodyPartsWindow) {
      this._bodyPartsWindow.close();
      this._bodyPartsWindow = null;
    }

    if (this._monsterInfoWindow) {
      this._monsterInfoWindow.close();
      setTimeout(
        function () {
          if (this._monsterInfoWindow && this._monsterInfoWindow.parent) {
            this._monsterInfoWindow.parent.removeChild(this._monsterInfoWindow);
          }
          this._monsterInfoWindow = null;
        }.bind(this),
        100
      );
    }

    if ($gameTemp) {
      $gameTemp.checkWindowActive = false;
    }

    // After targeting, return to the actor command window and select Attack
    this._actorCommandWindow.activate();
    this._actorCommandWindow.selectSymbol("attack");
  };

  Scene_Battle.prototype.onTargetingCancel = function () {
    // Clear targeted part if $gameTemp exists
    if ($gameTemp) {
      $gameTemp.targetedBodyPart = null;
      $gameTemp.targetedBodyPartEnemy = null;
    }

    // Clear the last target selection for this enemy
    if (this._bodyPartsWindow && this._bodyPartsWindow._enemy) {
      var enemyId = this._bodyPartsWindow._enemy.enemyId();
      if ($gameTemp.lastTargetSelections) {
        delete $gameTemp.lastTargetSelections[enemyId];
      }
    }

    this.closeBodyPartsWindow();
  };

  // REPLACE THIS METHOD:
  Scene_Battle.prototype.closeBodyPartsWindow = function () {
    // Close both windows
    if (this._bodyPartsWindow) {
      this._bodyPartsWindow.close();
      this._bodyPartsWindow = null;
    }

    if (this._monsterInfoWindow) {
      this._monsterInfoWindow.close();
      setTimeout(
        function () {
          if (this._monsterInfoWindow && this._monsterInfoWindow.parent) {
            this._monsterInfoWindow.parent.removeChild(this._monsterInfoWindow);
          }
          this._monsterInfoWindow = null;
        }.bind(this),
        100
      );
    }

    if ($gameTemp) {
      $gameTemp.checkWindowActive = false;
    }

    this._actorCommandWindow.activate();
  };

  // Add a hook to BattleManager.update to handle delayed enemy death
  var _BattleManager_update = BattleManager.update;
  BattleManager.update = function () {
    _BattleManager_update.apply(this, arguments);

    // Make sure $gameTemp exists
    if (!$gameTemp) {
      $gameTemp = {};
      return;
    }

    // Handle scheduled enemy death after battle log has had time to display
    if ($gameTemp.scheduleEnemyDeath && $gameTemp.vitalPartDestroyedEnemy) {
      // Only apply death if battle log is done processing
      if (!this._logWindow || this._logWindow._methods.length === 0) {
        const target = $gameTemp.vitalPartDestroyedEnemy;
        target.setHp(0);
        target.addState(target.deathStateId());
        target.performCollapse();
        $gameTemp.vitalPartDestroyedEnemy = null;
        $gameTemp.scheduleEnemyDeath = false;
      }
    }
  };

  // 1) Init storage
  const _GS_initialize = Game_System.prototype.initialize;
  Game_System.prototype.initialize = function () {
    _GS_initialize.call(this);
    this._troopLimbData = {}; // { "mapId_eventId": [deep copies of each enemy._bodyParts] }
  };

  // 2) Tag the current troopId on Game_Troop
  const _GT_setup = Game_Troop.prototype.setup;
  Game_Troop.prototype.setup = function (troopId) {
    _GT_setup.call(this, troopId);
    this._troopId = troopId;
  };

  // Storage key for limb data. We key by the *map event instance* that started
  // the battle (BSE's persistentId, "mapId_eventId") so each monster on the map
  // remembers its own severed limbs. Two different events of the SAME troop id
  // get distinct keys, so cutting a limb off one no longer carries to the next.
  // Battles with no source event (random encounters, arena, etc.) return null and
  // are never persisted, so they always start with a fresh, intact body.
  function limbDataKey() {
    const bse = window.BattleSystemEnhanced;
    const pid = bse && bse.State && bse.State.currentBattleEventId;
    return pid ? String(pid) : null;
  }

  // 3) On BattleManager.setup, load any saved bodyParts
  const _BM_setup = BattleManager.setup;
  BattleManager.setup = function (troopId, canEscape, canLose) {
    _BM_setup.call(this, troopId, canEscape, canLose);
    const key = limbDataKey();
    if (!key) return;
    if (!$gameSystem._troopLimbData) $gameSystem._troopLimbData = {};
    const saved = $gameSystem._troopLimbData[key];
    if (saved) {
      $gameTroop.members().forEach((enemy, idx) => {
        if (saved[idx]) {
          // deep‐copy to avoid reference bleed
          enemy._bodyParts = JsonEx.makeDeepCopy(saved[idx]);
        }
      });
    }
  };

  // 4) Every time we apply limb damage, snapshot & save
  function saveLimbData() {
    const key = limbDataKey();
    if (!key) return; // non-instanced battle (random encounter, arena, ...) — don't persist
    if (!$gameSystem._troopLimbData) $gameSystem._troopLimbData = {};
    // deep‐clone each enemy._bodyParts; an enemy with no anatomy yet stores null
    // (JsonEx.makeDeepCopy(undefined) throws on the JSON.parse)
    $gameSystem._troopLimbData[key] = $gameTroop
      .members()
      .map((enemy) =>
        enemy && enemy._bodyParts ? JsonEx.makeDeepCopy(enemy._bodyParts) : null
      );
  }

  // Monkey-patch the existing applyDamageToBodyPart function
  const _orig_applyDamage = applyDamageToBodyPart;
  applyDamageToBodyPart = function (enemy, partKey, damage, isTargeted) {
    const result = _orig_applyDamage.call(
      this,
      enemy,
      partKey,
      damage,
      isTargeted
    );
    saveLimbData();
    return result;
  };

  // 5) On map change, wipe all saved data
  const _GM_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _GM_setup.call(this, mapId);
    $gameSystem._troopLimbData = {};
  };


  // Add this section after the plugin parameters definition, around line 70

  // Register plugin command for opening enemy detail window
  if (PluginManager.registerCommand) {
    PluginManager.registerCommand(pluginName, "OpenEnemyDetails", args => {
      if ($gameParty.inBattle()) {
        const scene = SceneManager._scene;
        if (scene instanceof Scene_Battle) {
          scene.commandCheck();
        }
      }
    });

    PluginManager.registerCommand(pluginName, "OpenTargeting", args => {
      if ($gameParty.inBattle()) {
        const scene = SceneManager._scene;
        if (scene instanceof Scene_Battle) {
          scene.commandTarget();
        }
      }
    });
  }
})();