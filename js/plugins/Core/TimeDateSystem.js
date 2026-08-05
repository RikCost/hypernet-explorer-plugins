/*:
 * @target MZ
 * @plugindesc v1.2.0 Adds hunger and sleep systems with overeating mechanic.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help TimeDateSystem
 * === Hunger and Sleep System v1.2.0 ===
 *
 * This plugin adds hunger and sleep mechanics to your game.
 * This version has been modified for a more realistic hunger system.
 *
 * --- What's New in v1.2.0 ---
 * - Added overeating system:
 * - Hunger indicator can exceed 100% (up to 150% by default).
 * - If it exceeds 110%, the player suffers a state (default: 41).
 * - The state is removed when hunger drops below 100%.
 * - Hunger consumption is much faster when above 100%.
 *
 * --- Features ---
 * - Characters become hungry and sleepy over time.
 * - Status is displayed in the main menu (HP, MP, Status, Hunger, Sleep).
 * - Shows current time and temperature.
 * - Notifications appear when hunger/sleep states change.
 * - Debuffs applied at low levels (< 20%) and severe at 0%.
 * - Hunger recovers by eating food with specific nutritional values.
 *
 * --- New Plugin Command: EatFood ---
 * This command replaces the old "RecoverHunger".
 * Simulates food consumption by an actor.
 *
 * 1.  **Before calling the command**, set the nutritional values
 * of the food item in three game variables:
 * - Calories Variable (default: 88)
 * - Fat Variable (default: 89)
 * - Protein Variable (default: 90)
 *
 * @param --- Hunger/Sleep Settings ---
 *
 * @param hungerDecreaseRate
 * @text Hunger Decrease Rate
 * @desc How much hunger decreases per step.
 * @type number
 * @decimals 2
 * @min 0.01
 * @default 0.05
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param sleepDecreaseRate
 * @text Sleep Decrease Rate
 * @desc How much sleep decreases per step.
 * @type number
 * @decimals 2
 * @min 0.01
 * @default 0.03
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param maxHunger
 * @text Max Hunger
 * @desc Maximum hunger value (100% threshold).
 * @type number
 * @min 1
 * @default 100
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param overeatMaxHunger
 * @text Max Hunger (Overeating)
 * @desc Maximum hunger value that can be reached during overeating.
 * @type number
 * @min 100
 * @default 150
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param overeatStateId
 * @text Overeating State ID
 * @desc The ID of the state applied when overeating (>110%).
 * @type state
 * @default 41
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param overeatDepletionMultiplier
 * @text Overeating Depletion Multiplier
 * @desc Multiplier for hunger decrease rate when hunger > 100%.
 * @type number
 * @decimals 2
 * @default 3.00
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param shiftMultiplier
 * @text Run Drain Multiplier
 * @desc Hunger/sleep drain multiplier while running (Shift held).
 * @type number
 * @decimals 2
 * @default 2.00
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param maxSleep
 * @text Max Sleep
 * @desc Maximum sleep value.
 * @type number
 * @min 1
 * @default 100
 * @parent --- Hunger/Sleep Settings ---
 *
 * @param --- Realistic Hunger Recovery ---
 *
 * @param calorieVariableId
 * @text Calorie Variable ID
 * @desc The ID of the game variable that stores food calories.
 * @type variable
 * @default 88
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param fatVariableId
 * @text Fat Variable ID
 * @desc The ID of the game variable that stores food fat.
 * @type variable
 * @default 89
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param proteinVariableId
 * @text Protein Variable ID
 * @desc The ID of the game variable that stores food protein.
 * @type variable
 * @default 90
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param caffeineVariableId
 * @text Caffeine Variable ID
 * @desc The ID of the game variable that stores food caffeine.
 * @type variable
 * @default 91
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param calorieFactor
 * @text Calorie Factor
 * @desc Multiplier for calories in hunger recovery calculation.
 * @type number
 * @decimals 2
 * @default 0.10
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param proteinFactor
 * @text Protein Factor
 * @desc Multiplier for protein in hunger recovery calculation.
 * @type number
 * @decimals 2
 * @default 2.00
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param fatFactor
 * @text Fat Factor
 * @desc Multiplier for fat in hunger recovery calculation.
 * @type number
 * @decimals 2
 * @default 1.50
 * @parent --- Realistic Hunger Recovery ---
 *
 *
 * @param caffeineFactor
 * @text Caffeine Factor
 * @desc Multiplier for caffeine in hunger recovery calculation.
 * @type number
 * @decimals 2
 * @default 1.50
 * @parent --- Realistic Hunger Recovery ---
 *
 * @param --- Time Management Settings ---
 *
 * @param gameTimeVariable
 * @text Game Time Variable
 * @desc Variable ID to store total game minutes elapsed (used on map 315 for manual advancement).
 * @type variable
 * @default 114
 * @parent --- Time Management Settings ---
 *
 * @param gameDateVariable
 * @text Game Date Variable
 * @desc Variable ID to store formatted date/time string (updates on hour/minute changes).
 * @type variable
 * @default 113
 * @parent --- Time Management Settings ---
 *
 * @param --- UI Settings ---
 *
 * @param hungerIcon
 * @text Hunger Icon
 * @desc Icon index for hunger display.
 * @type number
 * @min 0
 * @default 219
 * @parent --- UI Settings ---
 *
 * @param sleepIcon
 * @text Sleep Icon
 * @desc Icon index for sleep display.
 * @type number
 * @min 0
 * @default 11
 * @parent --- UI Settings ---
 *
 * @param temperatureVariable
 * @text Temperature Variable
 * @desc ID of the variable that stores the temperature value.
 * @type variable
 * @default 61
 * @parent --- UI Settings ---
 *
 * @param timeIcon
 * @text Time Icon
 * @desc Icon index for time display.
 * @type number
 * @min 0
 * @default 220
 * @parent --- UI Settings ---
 *
 * @param temperatureIcon
 * @text Temperature Icon
 * @desc Icon index for temperature display.
 * @type number
 * @min 0
 * @default 64
 * @parent --- UI Settings ---
 *
 * @command EatFood
 * @text Eat Food (Recover Hunger)
 * @desc Recovers hunger for an actor based on nutritional values in game variables. Variables are reset to zero after use.
 * @arg actorId
 * @text Actor ID
 * @desc The actor who will eat the food.
 * @type actor
 * @default 1
 *
 * @command RecoverSleep
 * @text Recover Sleep
 * @desc Recovers sleep for the specified actor.
 * @arg actorId
 * @text Actor ID
 * @desc ID of the actor to recover sleep for (1, 2, etc.).
 * @type actor
 * @default 1
 * @arg amount
 * @text Amount
 * @desc Amount of sleep to recover (percentage).
 * @type number
 * @min 1
 * @max 100
 * @default 50
 *
 * @command StartSeat
 * @text Start Seat
 * @desc Activates seat mode: the player recovers 0.5% sleep per second
 * but can only turn around, not move.
 *
 * @command StopSeat
 * @text Stop Seat
 * @desc Deactivates seat mode and restores normal movement.
 *
 * @command Vomit
 * @text Vomit
 * @desc Vomits to reduce hunger by 40% of the maximum (never below 0%).
 * @arg actorId
 * @text Actor ID
 * @desc The actor who will vomit.
 * @type actor
 * @default 1
 *
 * @command PassTime
 * @text Pass Time
 * @desc Advance the game clock by specified hours and minutes.
 * @arg hours
 * @text Hours
 * @desc Number of hours to advance.
 * @type number
 * @min 0
 * @default 0
 * @arg minutes
 * @text Minutes
 * @desc Number of minutes to advance (0-59).
 * @type number
 * @min 0
 * @max 59
 * @default 0
 *
 * @command FullRestore
 * @text Full Restore (Food & Sleep)
 * @desc Restores hunger and sleep to 100% for all party members.
 *
 * @command AdjustNeed
 * @text Adjust Need (All Party)
 * @desc Add or subtract from a need stat for every party member. Result clamps to 0-100.
 *
 * @arg need
 * @text Need
 * @type select
 * @option Hunger
 * @value hunger
 * @option Sleep
 * @value sleep
 * @option Hygiene
 * @value hygiene
 * @option Social
 * @value social
 * @option Fun
 * @value leisure
 * @default hunger
 *
 * @arg amount
 * @text Amount
 * @desc Amount to add (positive) or remove (negative). Result clamps to 0-100.
 * @type number
 * @min -100
 * @max 100
 * @default 10
 *
 * @command SleepMenu
 * @text Sleep Menu
 * @desc Opens the dedicated sleep and management menu.
 *
 * @command CryogenicSleep
 * @text Cryogenic Sleep
 * @desc Opens the cryogenic pod year selection. The party wakes unaged and fully restored in the chosen year (up to 2012).
 *
 * @command SimulateTime
 * @text Simulate Time
 * @desc Advance the game clock and run NPC simulation for the given duration.
 *
 * @arg years
 * @text Years
 * @type number
 * @min 0
 * @default 0
 *
 * @arg days
 * @text Days
 * @type number
 * @min 0
 * @default 0
 *
 * @arg hours
 * @text Hours
 * @type number
 * @min 0
 * @default 0
 *
 * @arg minutes
 * @text Minutes
 * @type number
 * @min 0
 * @default 0
 *
 * @arg seconds
 * @text Seconds
 * @desc Rounded to the nearest whole minute.
 * @type number
 * @min 0
 * @default 0
 *
 */

(function () {
  "use strict";

  const pluginName = "TimeDateSystem";

  // Need-state copy lives in js/i18n/<lang>/plugins/TimeDate.json.
  function getText(key) {
    return T("TimeDate.needs." + key);
  }

  // A few call sites still branch on the language to pick a number or date
  // format rather than wording, so the probe stays.
  function getCurrentLanguage() {
    return typeof ConfigManager !== "undefined" && ConfigManager.language === "it" ? "it" : "en";
  }

  // Parameters
  const parameters = PluginManager.parameters(pluginName);
  const hungerDecreaseRate = Number(parameters.hungerDecreaseRate || 0.05);
  const sleepDecreaseRate = Number(parameters.sleepDecreaseRate || 0.03);
  const maxHunger = Number(parameters.maxHunger || 100);

  // New Overeating Parameters
  const overeatMaxHunger = Number(parameters.overeatMaxHunger || 150);
  const overeatStateId = Number(parameters.overeatStateId || 41);
  const overeatDepletionMultiplier = Number(
    parameters.overeatDepletionMultiplier || 3.0
  );

  const maxSleep = Number(parameters.maxSleep || 100);

  // Extended player needs (mirrors the NPC society needs in NPCSimulationCore.js).
  // Stored 0-100 on the player actor and drained like the NPC meters.
  const maxNeed = 100;
  const hungerIcon = Number(parameters.hungerIcon || 219);
  const sleepIcon = Number(parameters.sleepIcon || 11);
  const temperatureVariable = Number(parameters.temperatureVariable || 61);
  const timeIcon = Number(parameters.timeIcon || 220);
  const temperatureIcon = Number(parameters.temperatureIcon || 64);
  const shiftMultiplier = Number(parameters.shiftMultiplier || 2);

  // Hunger-drain multiplier from ambient temperature. Comfortable band
  // (12-26 C) costs nothing; outside it the body spends extra energy to
  // regulate, so hunger drains faster the colder or hotter it gets.
  // Cold is slightly harsher than heat. Clamped to a sane ceiling.
  function temperatureHungerMultiplier(temp) {
    const t = (typeof temp === 'number' && !isNaN(temp)) ? temp : 20;
    let mult = 1.0;
    if (t < 12) {
      mult = 1 + (12 - t) * 0.045; // 0 C -> ~1.54x, -10 C -> ~1.99x
    } else if (t > 26) {
      mult = 1 + (t - 26) * 0.035; // 36 C -> ~1.35x, 46 C -> ~1.70x
    }
    return Math.min(mult, 2.5);
  }

  // Realistic Hunger Recovery Parameters
  const calorieVariableId = Number(parameters.calorieVariableId || 88);
  const fatVariableId = Number(parameters.fatVariableId || 89);
  const proteinVariableId = Number(parameters.proteinVariableId || 90);
  const calorieFactor = Number(parameters.calorieFactor || 0.1);
  const proteinFactor = Number(parameters.proteinFactor || 2.0);
  const caffeineVariableId = Number(parameters.caffeineVariableId || 91);
  const fatFactor = Number(parameters.fatFactor || 1.5);
  const caffeineFactor = Number(parameters.caffeineFactor || 1.5);

  // Time Management Parameters
  const gameTimeVariable = Number(parameters.gameTimeVariable || 114);
  const gameDateVariable = Number(parameters.gameDateVariable || 113);

  // Maps where hunger/sleep should not deplete (prison, transport maps, etc.).
  const NO_DEPLETION_MAPS = [718, 719, 720, 327, 1094, 317, 1102];


  // Debug logging helper. Gated on the test flag only: previously this also
  // logged on NW.js, firing ~1/sec while seated even in normal play builds.
  function debug(msg) {
    if (Utils.isOptionValid("test")) {
      console.log(`[${pluginName}] ${msg}`);
    }
  }

  //=============================================================================
  // Time Management Functions
  //=============================================================================

  // Track last real-time check (for normal maps using system clock)
  let lastRealTimeCheck = Date.now();

  // Get current game time in minutes (Variable 114 stores total minutes elapsed)
  function getGameTimeMinutes() {
    return $gameVariables.value(gameTimeVariable) || 0;
  }

  // Set game time in minutes (only used for map 315 manual advancement)
  function setGameTimeMinutes(minutes) {
    $gameVariables.setValue(gameTimeVariable, Math.max(0, minutes));
  }

  // Advances game time by `totalMinutes`, stepping through it in bounded
  // chunks so window.NPCSim.tick() runs for every chunk in between, this is
  // what lets NPCs keep living their schedules (needs, jobs, routines, thoughts,
  // shop swaps...) through any big jump in time, not just while the player is
  // walking around watching the clock tick minute by minute. Used by sleeping,
  // PassTime and SimulateTime alike so no time-skip path leaves NPCs frozen.
  function advanceGameTimeSimulated(totalMinutes) {
    if (totalMinutes <= 0) return getGameTimeMinutes();

    const STEP = 60;
    let remaining   = totalMinutes;
    let currentTime = getGameTimeMinutes();

    while (remaining > 0) {
      const chunk = Math.min(STEP, remaining);
      currentTime += chunk;
      remaining   -= chunk;
      setGameTimeMinutes(currentTime);
      if (window.NPCSim?.tick) {
        try { window.NPCSim.tick(currentTime); } catch (_) {}
      }
    }

    // Resolve background NPC life events (relationships, careers, crimes,
    // see NPCLifeSimulator.js) across the skipped interval in one delta pass,
    // and persist the world's npcs.json if the jump was a real time skip.
    if (window.NPCLifeSim?.catchUp) {
      try { window.NPCLifeSim.catchUp(currentTime); } catch (_) {}
    }

    updateGameDateVariable();
    return currentTime;
  }

  // Convert minutes since epoch to date/time components
  function getDateTimeFromMinutes(minutes) {
    // Base date: Jan 1, 2001 012:00 (10 AM start)
    const date = new Date(2001, 0, 1, 10, 0, 0);
    date.setMinutes(date.getMinutes() + minutes);

    const months = [
      "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
    ];

    const dayNum = String(date.getDate()).padStart(2, "0");
    const month = months[date.getMonth()];
    const monthNum = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const yearShort = String(year).slice(-2); // Get last 2 digits of year
    const hours = String(date.getHours()).padStart(2, "0");
    const mins = String(date.getMinutes()).padStart(2, "0");

    return {
      day: date.getDate(),
      dayNum: dayNum,
      month: month,
      monthNum: monthNum,
      year: year,
      yearShort: yearShort,
      hours: hours,
      minutes: mins,
      time24: `${hours}:${mins}`,
      dateShort: `${dayNum}/${monthNum}/${yearShort}`,
      fullDate: `${dayNum} ${month} ${year} ${hours}:${mins}`
    };
  }

  //=============================================================================
  // Cryogenic sleep helpers
  //=============================================================================

  // The cryo pod can only carry the player up to this year; selecting it always
  // opens the pod at 00:00 on the 1st of January (no same-day matching).
  const CRYO_END_YEAR = 2012;

  // Live Date object for the current in-game moment (base epoch + elapsed mins).
  function getCurrentDateObj() {
    const date = new Date(2001, 0, 1, 10, 0, 0);
    date.setMinutes(date.getMinutes() + getGameTimeMinutes());
    return date;
  }

  // Selectable cryo wake years: every year after the current one, up to and
  // including CRYO_END_YEAR. Empty once the clock is already in/after that year.
  function getCryoYears() {
    const currentYear = getCurrentDateObj().getFullYear();
    const years = [];
    for (let y = currentYear + 1; y <= CRYO_END_YEAR; y++) years.push(y);
    return years;
  }

  // Minutes the clock must advance to reach the cryo wake date for `year`.
  // Pre-2012 years wake on the same month/day/time as today; 2012 always opens
  // at midnight on 1 Jan. JS Date arithmetic counts the true number of days in
  // between, so leap years (and a 29 Feb start rolling to 1 Mar) are handled.
  function getCryoAdvanceMinutes(year) {
    const base = new Date(2001, 0, 1, 10, 0, 0);
    const now = getCurrentDateObj();
    let target;
    if (year >= CRYO_END_YEAR) {
      target = new Date(CRYO_END_YEAR, 0, 1, 0, 0, 0);
    } else {
      target = new Date(year, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0);
    }
    const targetMinutes = Math.round((target.getTime() - base.getTime()) / 60000);
    return Math.max(0, targetMinutes - getGameTimeMinutes());
  }

  // Update date variable when time changes (on hour/minute boundary)
  let lastDisplayedHour = -1;
  let lastDisplayedMinute = -1;

  function updateGameDateVariable() {
    const minutes = getGameTimeMinutes();
    const dateTime = getDateTimeFromMinutes(minutes);

    const currentHour = parseInt(dateTime.hours);
    const currentMinute = parseInt(dateTime.minutes);

    // Update Variable 113 when hour or minute changes
    if (currentHour !== lastDisplayedHour || currentMinute !== lastDisplayedMinute) {
      lastDisplayedHour = currentHour;
      lastDisplayedMinute = currentMinute;
      $gameVariables.setValue(gameDateVariable, dateTime.fullDate);
      debug(`Game time updated: ${dateTime.fullDate}`);
    }
  }

  //=============================================================================
  // Plugin Commands
  //=============================================================================

  PluginManager.registerCommand(pluginName, "EatFood", function (args) {
    const actorId = Number(args.actorId);
    const actor = $gameActors.actor(actorId);

    if (actor) {
      const calories = $gameVariables.value(calorieVariableId) || 0;
      const protein = $gameVariables.value(proteinVariableId) || 0;
      const fat = $gameVariables.value(fatVariableId) || 0;
      const caffeine = $gameVariables.value(caffeineVariableId) || 0;

      // Calculate hunger recovery based on nutritional values
      const recoveryAmount = (calories * calorieFactor) + (protein * proteinFactor) + (fat * fatFactor);

      debug(
        `Eating food for actor ${actorId}: C=${calories}, P=${protein}, F=${fat}, Caffeine=${caffeine}. Recovering ${recoveryAmount.toFixed(2)} hunger.`
      );

      actor.addHunger(recoveryAmount);

      // Handle caffeine effect on sleep
      if (caffeine > 0) {
        const sleepReduction = caffeine * caffeineFactor;
        actor.reduceSleep(sleepReduction);
        debug(`Caffeine reduced sleep by ${sleepReduction.toFixed(2)} points.`);
      }

      // Reset nutrient variables to 0 after consumption
      $gameVariables.setValue(calorieVariableId, 0);
      $gameVariables.setValue(proteinVariableId, 0);
      $gameVariables.setValue(fatVariableId, 0);
      $gameVariables.setValue(caffeineVariableId, 0);
      debug("Nutrient variables have been reset to 0.");

      // Refresh menu if open
      if (SceneManager._scene instanceof Scene_Menu) {
        SceneManager._scene._hungerSleepStatusWindow.refresh();
      }
    } else {
      debug(`Actor with ID ${actorId} not found.`);
    }
  });

  // Legacy command kept for old events: restores hunger directly by amount
  // (superseded by EatFood, which derives the amount from nutrient variables).
  PluginManager.registerCommand(pluginName, "RecoverHunger", function (args) {
    const actorId = Number(args.actorId || 1);
    const amount = Number(args.amount || 50);
    const actor = $gameActors.actor(actorId);
    if (actor) {
      actor.addHunger(amount);
      debug(`RecoverHunger (legacy): actor ${actorId} +${amount} hunger.`);
    }
  });

  PluginManager.registerCommand(pluginName, "RecoverSleep", function (args) {
    const actorId = Number(args.actorId || 1);
    const amount = Number(args.amount || 50);
    const actor = $gameActors.actor(actorId);

    if (actor) {
      // Calculate percentage of max sleep
      const sleepAmount = (amount / 100) * maxSleep;
      debug(
        `Recovering ${amount}% (${sleepAmount} points) sleep for actor ${actorId}`
      );
      actor.addSleep(sleepAmount);

      // Refresh menu if open
      if (SceneManager._scene instanceof Scene_Menu) {
        SceneManager._scene._hungerSleepStatusWindow.refresh();
      }
    } else {
      debug(`Actor ${actorId} not found.`);
    }
  });

  PluginManager.registerCommand(pluginName, "StartSeat", function (args) {
    if ($gamePlayer) {
      $gamePlayer.setSeat(true);
      debug("Seat mode activated - player can only turn, sleep recovery active");
    }
  });

  PluginManager.registerCommand(pluginName, "StopSeat", function (args) {
    if ($gamePlayer) {
      $gamePlayer.setSeat(false);
      debug("Seat mode deactivated - normal movement restored");
    }
  });

  PluginManager.registerCommand(pluginName, "Vomit", function (args) {
    const actorId = Number(args.actorId || 1);
    const actor = $gameActors.actor(actorId);

    if (actor) {
      const currentHunger = actor.hunger();

      // Lose 40% of the maximum hunger, never dropping below empty
      actor._hunger = Math.max(0, currentHunger - maxHunger * 0.4);
      debug(`Actor ${actorId} vomited. Hunger ${currentHunger} -> ${actor._hunger}/${maxHunger} (-40%)`);

      // Check for state changes and update overeating state
      actor.updateOvereatState();

      // Refresh menu if open
      if (SceneManager._scene instanceof Scene_Menu) {
        SceneManager._scene._hungerSleepStatusWindow.refresh();
      }

      // Add notification
      const lang = getCurrentLanguage();
      const message = lang === 'it'
        ? T("TimeDate.needs.vomited", { name: actor.name() })
        : T("TimeDate.needs.vomited", { name: actor.name() });
      $gameTemp.addHungerSleepNotification(message);
    } else {
      debug(`Actor ${actorId} not found.`);
    }
  });

  PluginManager.registerCommand(pluginName, "PassTime", function (args) {
    const hours = Number(args.hours || 0);
    const minutes = Number(args.minutes || 0);
    const totalMinutes = (hours * 60) + minutes;

    if (totalMinutes > 0) {
      const newTime = advanceGameTimeSimulated(totalMinutes);
      debug(`Passed ${hours}h ${minutes}m. New time: ${getDateTimeFromMinutes(newTime).fullDate}`);
    }
  });

  PluginManager.registerCommand(pluginName, "SimulateTime", function (args) {
    const years   = Number(args.years   || 0);
    const days    = Number(args.days    || 0);
    const hours   = Number(args.hours   || 0);
    const minutes = Number(args.minutes || 0);
    const seconds = Number(args.seconds || 0);

    const totalMinutes = Math.max(0, Math.round(
      (years * 365 * 24 * 60) + (days * 24 * 60) + (hours * 60) + minutes + (seconds / 60)
    ));
    if (totalMinutes <= 0) return;

    // Drain player hunger and sleep as if this many minutes of regular-map
    // walking passed (1 min = 10 steps at the configured decrease rate).
    // Mirror the walk-drain multipliers (temperature stress + overeating) so
    // time-skips and walking stay consistent.
    const leader = $gameParty?.leader();
    if (leader) {
      let hungerMultiplier = 1;
      if (leader.hunger() > maxHunger) {
        hungerMultiplier *= overeatDepletionMultiplier;
      }
      hungerMultiplier *= temperatureHungerMultiplier($gameVariables.value(temperatureVariable));
      leader.reduceHunger(hungerDecreaseRate * 10 * totalMinutes * hungerMultiplier);
      leader.reduceSleep(sleepDecreaseRate   * 10 * totalMinutes);
    }

    const newTime = advanceGameTimeSimulated(totalMinutes);
    debug(`SimulateTime: advanced ${totalMinutes} min. New time: ${getDateTimeFromMinutes(newTime).fullDate}`);
  });

  PluginManager.registerCommand(pluginName, "FullRestore", function (args) {
    for (const actor of $gameParty.members()) {
      actor._hunger = maxHunger;
      actor._sleep = maxSleep;
      actor.updateOvereatState();
      debug(`FullRestore: ${actor.name()} hunger=${maxHunger}, sleep=${maxSleep}`);
    }

    if (SceneManager._scene instanceof Scene_Menu) {
      SceneManager._scene._hungerSleepStatusWindow.refresh();
    }
  });

  // Add or subtract from a single need for every party member. Amount may be
  // negative; the resulting value is clamped to [0, need max] (100 by default).
  PluginManager.registerCommand(pluginName, "AdjustNeed", function (args) {
    const need = String(args.need || "").toLowerCase();
    const amount = Number(args.amount || 0);
    const specs = {
      hunger:  { get: (a) => a._hunger,   set: (a, v) => { a._hunger  = v; }, max: maxHunger },
      sleep:   { get: (a) => a._sleep,    set: (a, v) => { a._sleep   = v; }, max: maxSleep  },
      // Hygiene / Social / Fun go through setExtendedNeed so a companion's
      // meter is written where it actually lives (their society profile).
      hygiene: { get: (a) => a.hygiene(), set: (a, v) => a.setExtendedNeed("hygiene", v), max: maxNeed },
      social:  { get: (a) => a.social(),  set: (a, v) => a.setExtendedNeed("social",  v), max: maxNeed },
      leisure: { get: (a) => a.leisure(), set: (a, v) => a.setExtendedNeed("leisure", v), max: maxNeed },
    };
    const spec = specs[need];
    if (!spec) {
      debug(`AdjustNeed: unknown need "${args.need}"`);
      return;
    }

    for (const actor of $gameParty.members()) {
      const oldHungerState = actor.hungerState();
      const oldSleepState = actor.sleepState();
      const newValue = Math.max(0, Math.min(spec.max, spec.get(actor) + amount));
      spec.set(actor, newValue);

      if (need === "hunger") {
        actor.checkStateChange("hunger", oldHungerState);
        actor.updateOvereatState();
      } else if (need === "sleep") {
        actor.checkStateChange("sleep", oldSleepState);
      }
      debug(`AdjustNeed: ${actor.name()} ${need} -> ${newValue.toFixed(1)}/${spec.max}`);
    }

    if (SceneManager._scene instanceof Scene_Menu && SceneManager._scene._hungerSleepStatusWindow) {
      SceneManager._scene._hungerSleepStatusWindow.refresh();
    }
  });

  PluginManager.registerCommand(pluginName, "SleepMenu", function (args) {
    if (SceneManager._scene instanceof Scene_Map) {
      SceneManager._scene.openSleepMenu();
    }
  });

  PluginManager.registerCommand(pluginName, "CryogenicSleep", function (args) {
    if (SceneManager._scene instanceof Scene_Map) {
      SceneManager._scene.openCryogenicSleepMenu();
    }
  });

  //=============================================================================
  // Game_Actor Extensions
  //=============================================================================

  // Shared global hunger and sleep getters/setters on prototype
  Object.defineProperty(Game_Actor.prototype, "_hunger", {
    get: function () {
      if ($gameSystem) {
        if ($gameSystem._globalHunger === undefined) {
          $gameSystem._globalHunger = typeof maxHunger !== "undefined" ? maxHunger : 100;
        }
        return $gameSystem._globalHunger;
      }
      return this.__localHunger !== undefined ? this.__localHunger : (typeof maxHunger !== "undefined" ? maxHunger : 100);
    },
    set: function (value) {
      if ($gameSystem) {
        $gameSystem._globalHunger = value;
      } else {
        this.__localHunger = value;
      }
    },
    configurable: true
  });

  Object.defineProperty(Game_Actor.prototype, "_sleep", {
    get: function () {
      if ($gameSystem) {
        if ($gameSystem._globalSleep === undefined) {
          $gameSystem._globalSleep = typeof maxSleep !== "undefined" ? maxSleep : 100;
        }
        return $gameSystem._globalSleep;
      }
      return this.__localSleep !== undefined ? this.__localSleep : (typeof maxSleep !== "undefined" ? maxSleep : 100);
    },
    set: function (value) {
      if ($gameSystem) {
        $gameSystem._globalSleep = value;
      } else {
        this.__localSleep = value;
      }
    },
    configurable: true
  });

  const _Game_Actor_initialize = Game_Actor.prototype.initialize;
  Game_Actor.prototype.initialize = function (actorId) {
    _Game_Actor_initialize.call(this, actorId);
    if ($gameSystem) {
      if ($gameSystem._globalHunger === undefined) {
        this._hunger = maxHunger;
      }
      if ($gameSystem._globalSleep === undefined) {
        this._sleep = maxSleep;
      }
    } else {
      this._hunger = maxHunger;
      this._sleep = maxSleep;
    }
    if (this._hygiene === undefined) this._hygiene = maxNeed;
    if (this._social  === undefined) this._social  = maxNeed;
    if (this._leisure === undefined) this._leisure = maxNeed;
    this._prevHungerState = "normal";
    this._prevSleepState = "normal";
  };

  // Hunger Methods
  Game_Actor.prototype.hunger = function () {
    return this._hunger;
  };

  Game_Actor.prototype.hungerRate = function () {
    return this._hunger / maxHunger;
  };

  Game_Actor.prototype.hungerPercent = function () {
    return Math.floor(this.hungerRate() * 100);
  };

  Game_Actor.prototype.hungerState = function () {
    if (this.hungerRate() <= 0) return "starving";
    if (this.hungerRate() < 0.2) return "hungry";
    return "normal";
  };

  Game_Actor.prototype.addHunger = function (amount) {
    const wasAtZero = this._hunger <= 0;
    const oldState = this.hungerState();

    // Add the food and let a single meal carry its surplus into the overeating
    // range (clamped to the overeat ceiling) instead of hard-capping at 100% and
    // wasting it. This removes the awkward two-meals-at-exactly-100% requirement.
    const newHunger = this._hunger + amount;
    this._hunger = Math.min(overeatMaxHunger, newHunger);
    if (newHunger > maxHunger) {
      debug(`Actor ${this._actorId} overeating: hunger ${this._hunger.toFixed(2)}/${maxHunger} (raw ${newHunger.toFixed(2)})`);
    }

    debug(
      `Actor ${this._actorId} hunger updated to ${this._hunger
      }/${maxHunger} (${this.hungerPercent()}%)`
    );

    // If hunger was at 0 and is now above 0, restore HP to max
    if (wasAtZero && this._hunger > 0) {
      const hpDifference = this.mhp - this.hp;
      if (hpDifference > 0) {
        this.setHp(this.mhp);
        debug(`Actor ${this._actorId} HP fully restored to ${this.mhp}`);
        // HP-restored popup intentionally not shown on the map (#173)
      }
    }

    // Check for state changes
    this.checkStateChange("hunger", oldState);
    this.updateOvereatState(); // Check for overeating state
  };

  Game_Actor.prototype.reduceHunger = function (amount) {
    const oldState = this.hungerState();

    // Update hunger value
    this._hunger = Math.max(0, this._hunger - amount);

    // Check for state changes and apply effects
    this.checkStateChange("hunger", oldState);
    this.updateOvereatState(); // Check for overeating state
  };

  // Sleep Methods
  Game_Actor.prototype.sleep = function () {
    return this._sleep;
  };

  Game_Actor.prototype.sleepRate = function () {
    return this._sleep / maxSleep;
  };

  Game_Actor.prototype.sleepPercent = function () {
    return Math.floor(this.sleepRate() * 100);
  };

  Game_Actor.prototype.sleepState = function () {
    if (this.sleepRate() <= 0) return "exhausted";
    if (this.sleepRate() < 0.2) return "sleepy";
    return "normal";
  };

  Game_Actor.prototype.addSleep = function (amount) {
    const wasAtZero = this._sleep <= 0;
    const oldState = this.sleepState();

    // Update sleep value
    this._sleep = Math.min(maxSleep, this._sleep + amount);
    debug(
      `Actor ${this._actorId} sleep updated to ${this._sleep
      }/${maxSleep} (${this.sleepPercent()}%)`
    );

    // If sleep was at 0 and is now above 0, restore MP to max
    if (wasAtZero && this._sleep > 0) {
      const mpDifference = this.mmp - this.mp;
      if (mpDifference > 0) {
        this.setMp(this.mmp);
        debug(`Actor ${this._actorId} MP fully restored to ${this.mmp}`);
        $gameTemp.addHungerSleepNotification(
          `${this.name()} ${getText("mpRestored")}`
        );
      }
    }

    // Check for state changes
    this.checkStateChange("sleep", oldState);
  };

  Game_Actor.prototype.reduceSleep = function (amount) {
    const oldState = this.sleepState();

    // Update sleep value
    this._sleep = Math.max(0, this._sleep - amount);

    // Check for state changes and apply effects
    this.checkStateChange("sleep", oldState);
  };

  // Extended needs (Hygiene / Social / Leisure) - mirror the NPC society meters
  // so the whole party shares one needs vocabulary. Stored 0-100.
  //
  // Where the value lives depends on who the member is. The player (Actor 1)
  // keeps the three meters on the actor; a recruited companion keeps them on
  // their NPC society profile, which is the copy the society simulation drains
  // and every panel reads for party slots 2/3. The accessors below resolve that
  // for the caller, so anything writing through them (plugin commands, item
  // NeedRestore tags, bathing, minigames) moves the meter the UI is showing
  // instead of an actor field nobody reads.
  function extendedNeedProfile(actor) {
    if (!actor || !actor.actorId || actor.actorId() === 1) return null;
    return window.NPCSocietyRegistry?.getProfile?.(actor.name()) || null;
  }

  Game_Actor.prototype.extendedNeed = function (key) {
    const profile = extendedNeedProfile(this);
    if (profile && typeof profile[key] === "number") return profile[key];
    const field = "_" + key;
    if (this[field] === undefined) this[field] = maxNeed;
    return this[field];
  };

  Game_Actor.prototype.setExtendedNeed = function (key, value) {
    const clamped = Math.max(0, Math.min(maxNeed, value));
    const profile = extendedNeedProfile(this);
    if (profile && typeof profile[key] === "number") {
      profile[key] = clamped;
      return;
    }
    this["_" + key] = clamped;
  };

  Game_Actor.prototype.hygiene = function () {
    return this.extendedNeed("hygiene");
  };
  Game_Actor.prototype.hygienePercent = function () {
    return Math.floor((this.hygiene() / maxNeed) * 100);
  };
  Game_Actor.prototype.addHygiene = function (amount) {
    this.setExtendedNeed("hygiene", this.hygiene() + amount);
  };
  Game_Actor.prototype.reduceHygiene = function (amount) {
    this.setExtendedNeed("hygiene", this.hygiene() - amount);
  };

  Game_Actor.prototype.social = function () {
    return this.extendedNeed("social");
  };
  Game_Actor.prototype.socialPercent = function () {
    return Math.floor((this.social() / maxNeed) * 100);
  };
  Game_Actor.prototype.addSocial = function (amount) {
    this.setExtendedNeed("social", this.social() + amount);
  };
  Game_Actor.prototype.reduceSocial = function (amount) {
    this.setExtendedNeed("social", this.social() - amount);
  };

  Game_Actor.prototype.leisure = function () {
    return this.extendedNeed("leisure");
  };
  Game_Actor.prototype.leisurePercent = function () {
    return Math.floor((this.leisure() / maxNeed) * 100);
  };
  Game_Actor.prototype.addLeisure = function (amount) {
    this.setExtendedNeed("leisure", this.leisure() + amount);
  };
  Game_Actor.prototype.reduceLeisure = function (amount) {
    this.setExtendedNeed("leisure", this.leisure() - amount);
  };

  // New method for handling overeating state
  Game_Actor.prototype.updateOvereatState = function () {
    const overeatThreshold = maxHunger * 1.1; // 110%
    const normalThreshold = maxHunger; // 100%

    const isOvereating = this.isStateAffected(overeatStateId);

    if (this._hunger > overeatThreshold) {
      if (!isOvereating) {
        this.addState(overeatStateId);
        debug(`Actor ${this._actorId} is overeating. Applied state ${overeatStateId}.`);
      }
    } else if (this._hunger < normalThreshold) {
      if (isOvereating) {
        this.removeState(overeatStateId);
        debug(`Actor ${this._actorId} is no longer overeating. Removed state ${overeatStateId}.`);
      }
    }
  };

  // State Changes and Effects
  Game_Actor.prototype.checkStateChange = function (type, oldState) {
    let currentState;
    let prevState;

    if (type === "hunger") {
      currentState = this.hungerState();
      prevState = this._prevHungerState;
      this._prevHungerState = currentState;
    } else {
      currentState = this.sleepState();
      prevState = this._prevSleepState;
      this._prevSleepState = currentState;
    }

    // Only show message if state has changed
    if (currentState !== oldState) {
      let message = "";

      if (type === "hunger") {
        if (currentState === "hungry") {
          message = `${this.name()} ${getText("hungry")}`;
        } else if (currentState === "starving") {
          message = `${this.name()} ${getText("starving")}`;
        }
        // "no longer hungry" feedback is intentionally not shown on the map (#173)
      } else {
        if (currentState === "sleepy") {
          message = `${this.name()} ${getText("sleepy")}`;
        } else if (currentState === "exhausted") {
          message = `${this.name()} ${getText("exhausted")}`;
        }
        // "no longer sleepy" feedback is intentionally not shown on the map (#173)
      }

      if (message) {
        // Send notification
        $gameTemp.addHungerSleepNotification(message);
      }

      // Apply debuffs based on new state (placeholder implementation)
      if (type === "hunger") {
        this.applyHungerDebuffs(currentState);
      } else {
        this.applySleepDebuffs(currentState);
      }
    }
  };

  // Placeholder debuff methods - in a real plugin these would apply actual states/effects
  Game_Actor.prototype.applyHungerDebuffs = function (state) {
    debug(`Applied hunger debuffs for state: ${state}`);

    if (state === "hungry") {
      // Apply mild hunger debuffs
    } else if (state === "starving") {
      // Apply severe hunger debuffs
    } else {
      // Remove hunger debuffs
    }
  };

  Game_Actor.prototype.applySleepDebuffs = function (state) {
    debug(`Applied sleep debuffs for state: ${state}`);

    if (state === "sleepy") {
      // Apply mild sleep debuffs
    } else if (state === "exhausted") {
      // Apply severe sleep debuffs
    } else {
      // Remove sleep debuffs
    }
  };

  //=============================================================================
  // Game_Party Extensions
  //=============================================================================

  // Low-need warnings for the extended needs (Hygiene / Social / Fun) for
  // every party member. The leader reads its actor meters, recruited NPC
  // members read their society profile (via PartyNeeds.getMemberNeeds).
  // Notifies only on the transition into a low/critical band, mirroring the
  // hungry/starving pattern used by checkStateChange.
  const EXT_NEED_TEXT = {
    hygiene: { low: "hygieneLow", critical: "hygieneCritical" },
    social:  { low: "socialLow",  critical: "socialCritical"  },
    leisure: { low: "leisureLow", critical: "leisureCritical" },
  };

  function checkExtendedNeeds(actor) {
    if (!window.PartyNeeds) return;
    const needs = window.PartyNeeds.getMemberNeeds(actor);
    if (!actor._prevExtNeedStates) actor._prevExtNeedStates = {};

    for (const key of Object.keys(EXT_NEED_TEXT)) {
      const pct = needs[key];
      if (pct === null || pct === undefined) continue;
      const state = pct <= 0 ? "critical" : pct < 20 ? "low" : "normal";
      const prev = actor._prevExtNeedStates[key] || "normal";
      if (state !== prev) {
        actor._prevExtNeedStates[key] = state;
        if (state !== "normal") {
          const message = `${actor.name()} ${getText(EXT_NEED_TEXT[key][state])}`;
          $gameTemp.addHungerSleepNotification(
            message,
            state === "critical" ? "danger" : "warning"
          );
        }
      }
    }
  }

  // Update hunger and sleep values when the player moves
  const _Game_Party_onPlayerWalk = Game_Party.prototype.onPlayerWalk;
  Game_Party.prototype.onPlayerWalk = function () {
    _Game_Party_onPlayerWalk.call(this);
    this.updateHungerAndSleep();
  };

  Game_Party.prototype.updateHungerAndSleep = function () {
    const mapId = $gameMap ? $gameMap.mapId() : 0;
    const isInRestZone = NO_DEPLETION_MAPS.includes(mapId);
    if (isInRestZone) {
      return; // Skip hunger and sleep updates in these maps
    }

    // Check if Shift key is pressed for speed boost
    const isShiftPressed = Input.isPressed("shift");
    const baseMultiplier = isShiftPressed ? shiftMultiplier : 1.0;

    // Check if on map 315 (world map) for special time/depletion rules
    const isOnWorldMap = $gameMap && $gameMap.mapId() === 315;

    const hungerRate = isOnWorldMap ? (maxHunger * 0.003) : hungerDecreaseRate;
    const sleepRate = isOnWorldMap ? (maxSleep * 0.006) : sleepDecreaseRate;

    // Update game time based on map
    const currentTime = getGameTimeMinutes();
    if (isOnWorldMap) {
      // On world map, time passes quickly with each step. Vehicles cross a tile
      // in less game-time than walking, and the Aero Streamlining workshop
      // upgrade (VehicleSystemRepair.js) reduces that per-tile cost further.
      const isInVehicle = $gamePlayer && ($gamePlayer.isInBoat() || $gamePlayer.isInShip() || $gamePlayer.isInAirship());
      let minutesToAdd = 10; // walking
      if (isInVehicle) {
        minutesToAdd = 2; // base vehicle cost per tile
        if (window.VehicleUpgrades) {
          const vType = window.VehicleUpgrades.currentRiddenType();
          if (vType) minutesToAdd = window.VehicleUpgrades.worldTileMinutes(vType);
        }
        // Ground vehicles cross a road tile in less game-time (Airship/Boat excluded).
        if (window.MergedVehicleSystem && window.MergedVehicleSystem.getWorldRoadTimeFactor) {
          minutesToAdd *= window.MergedVehicleSystem.getWorldRoadTimeFactor();
        }
      }
      setGameTimeMinutes(currentTime + minutesToAdd);
    } else {
      // On all other maps, time advances by 1 minute every 10 steps.
      if ($gameParty.steps() % 10 === 0) {
        setGameTimeMinutes(currentTime + 1);
      }
    }
    updateGameDateVariable();

    // Reduce global hunger and sleep values once (using the leader actor)
    const leader = $gameParty.leader();
    if (leader) {
      let hungerMultiplier = baseMultiplier;
      if (leader.hunger() > maxHunger) {
        hungerMultiplier *= overeatDepletionMultiplier;
      }
      // Temperature stresses the body: cold burns extra calories to stay warm,
      // heat raises metabolism too. Both ends speed up hunger drain.
      hungerMultiplier *= temperatureHungerMultiplier($gameVariables.value(temperatureVariable));

      leader.reduceHunger(hungerRate * hungerMultiplier);
      leader.reduceSleep(sleepRate * baseMultiplier);

      // Extended needs drain alongside sleep, at the NPC-meter ratios
      // (hygiene 0.05, social 0.03, leisure 0.03 per minute vs sleep 0.06).
      leader.reduceHygiene(sleepRate * 0.83 * baseMultiplier);
      leader.reduceSocial(sleepRate * 0.5 * baseMultiplier);
      leader.reduceLeisure(sleepRate * 0.5 * baseMultiplier);
    }

    // Apply legacy mechanics (debuffs, HP/MP drain, etc.) to all party members
    for (const actor of $gameParty.members()) {
      if (!actor) continue;

      // Update states and check for notifications/changes (excluding leader which is updated in reduceHunger/reduceSleep)
      if (actor !== leader) {
        actor.updateOvereatState();
        actor.checkStateChange("hunger", actor._prevHungerState);
        actor.checkStateChange("sleep", actor._prevSleepState);
      }

      // Low warnings for Hygiene / Social / Fun, every member incl. leader
      checkExtendedNeeds(actor);

      // Drain HP if hunger is at 0
      if (actor.hunger() <= 0 && actor.hp > 0) {
        const hpDrain = Math.ceil(actor.mhp * 0.01); // 1% of max HP per step
        const newHp = Math.max(0, actor.hp - hpDrain);
        actor.setHp(newHp);

        debug(`Actor ${actor._actorId} HP drained: ${hpDrain} (${actor.hp}/${actor.mhp})`);

        // Show notification when HP reaches 0
        if (actor.hp === 0) {
          const message = T("TimeDate.needs.collapsed", { name: actor.name() });
          $gameTemp.addHungerSleepNotification(message);
        }
      }

      // Drain MP if sleep is at 0
      if (actor.sleep() <= 0 && actor.mp > 0) {
        const mpDrain = Math.ceil(actor.mmp * 0.01); // 1% of max MP per step
        const newMp = Math.max(0, actor.mp - mpDrain);
        actor.setMp(newMp);

        debug(`Actor ${actor._actorId} MP drained: ${mpDrain} (${actor.mp}/${actor.mmp})`);

        // Show notification when MP reaches 0
        if (actor.mp === 0) {
          const lang = getCurrentLanguage();
          const message = T("TimeDate.needs.outOfMp", { name: actor.name() });
          $gameTemp.addHungerSleepNotification(message);
        }
      }
    }
  };

  //=============================================================================
  // Game_Player Extensions - Seat System
  //=============================================================================

  const _Game_Player_initialize = Game_Player.prototype.initialize;
  Game_Player.prototype.initialize = function () {
    _Game_Player_initialize.call(this);
    this._isSeat = false;
    this._seatFrameCounter = 0;
  };

  Game_Player.prototype.setSeat = function (seated) {
    this._isSeat = seated;
    this._seatFrameCounter = 0;
    debug(`Seat state changed to: ${seated}`);
  };

  Game_Player.prototype.isSeat = function () {
    return this._isSeat;
  };

  // Override movement methods to prevent tile movement while allowing direction changes
  const _Game_Player_moveStraight = Game_Player.prototype.moveStraight;
  Game_Player.prototype.moveStraight = function (d) {
    if (this._isSeat) {
      // Allow direction change but prevent actual movement
      this.setDirection(d);
      return;
    }
    return _Game_Player_moveStraight.call(this, d);
  };

  const _Game_Player_moveDiagonally = Game_Player.prototype.moveDiagonally;
  Game_Player.prototype.moveDiagonally = function (horz, vert) {
    if (this._isSeat) {
      // Allow direction change but prevent actual movement
      // Determine direction from horizontal and vertical inputs
      if (horz !== 0 || vert !== 0) {
        const d = this.getDiagonalDirection(horz, vert);
        if (d > 0) {
          this.setDirection(d);
        }
      }
      return;
    }
    return _Game_Player_moveDiagonally.call(this, horz, vert);
  };

  // Override update to handle seat sleep recovery
  const _Game_Player_update = Game_Player.prototype.update;
  Game_Player.prototype.update = function (sceneActive) {
    _Game_Player_update.call(this, sceneActive);

    // Handle seat sleep recovery (0.5% per second = 0.5% per 60 frames)
    if (this._isSeat) {
      this._seatFrameCounter++;
      if (this._seatFrameCounter >= 60) {
        this._seatFrameCounter = 0;
        // Recover 0.5% of sleep for actor 1 only
        const sleepRecovery = maxSleep * 0.005; // 0.5% of max sleep
        const actor = $gameActors.actor(1);
        if (actor) {
          actor.addSleep(sleepRecovery);
          debug(`Sleep recovery applied: ${sleepRecovery.toFixed(2)} for actor 1`);
        }
      }
    }
  };
  //=============================================================================
  // Time and Temperature Window
  //=============================================================================

  function Window_TimeTemperature() {
    this.initialize(...arguments);
  }

  Window_TimeTemperature.prototype = Object.create(Window_Base.prototype);
  Window_TimeTemperature.prototype.constructor = Window_TimeTemperature;

  Window_TimeTemperature.prototype.initialize = function (rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this.refresh();
    this._refreshTimer = 0;
  };

  Window_TimeTemperature.prototype.update = function () {
    Window_Base.prototype.update.call(this);

    // Refresh every second (60 frames)
    this._refreshTimer++;
    if (this._refreshTimer >= 60) {
      this._refreshTimer = 0;
      this.refresh();
    }
  };

  Window_TimeTemperature.prototype.refresh = function () {
    if (!this.contents) return;

    // Skip the clear + redraw when the displayed values are identical to the
    // last draw (the full cycle only ticks once a minute at most).
    const gameMinutes = getGameTimeMinutes();
    const dateTime = getDateTimeFromMinutes(gameMinutes);
    const weatherName = (window.WeatherNames && window.weatherName)
      ? window.WeatherNames.label(window.weatherName)
      : T("TimeDate.hud.weatherClear");
    const temperature = $gameVariables.value(temperatureVariable) || 20;
    const sig = dateTime.time24 + '|' + weatherName + '|' + temperature;
    if (sig === this._lastDrawSig) return;
    this._lastDrawSig = sig;

    this.contents.clear();
    this.drawTimeAndTemperature();
  };

  Window_TimeTemperature.prototype.drawTimeAndTemperature = function () {
    const y = 0;

    // Get time and date - check if a daylight mode is forced
    let timeString;
    let dateString = "01/01/01";

    // Full cycle mode - show game time (from system clock)
    const gameMinutes = getGameTimeMinutes();
    const dateTime = getDateTimeFromMinutes(gameMinutes);
    timeString = dateTime.time24;
    dateString = dateTime.dateShort;

    // Get temperature from variable
    const weatherName = (window.WeatherNames && window.weatherName)
      ? window.WeatherNames.label(window.weatherName)
      : T("TimeDate.hud.weatherClear");
    const temperature = $gameVariables.value(temperatureVariable) || 20;
    const tempString = `${weatherName} ${temperature}°C`;

    // Draw date and time with icon (left side)
    this.resetTextColor();
    this.drawText(`${timeString}`, 36, y, 120);

    // Draw temperature with icon (right side) - increased spacing
    const tempX = 120;

    // Color code temperature
    let tempColor = 0; // White by default
    if (temperature <= 0) {
      tempColor = 4; // Blue for freezing
    } else if (temperature < 10) {
      tempColor = 4; // Blue for cold
    } else if (temperature >= 35) {
      tempColor = 2; // Red for very hot
    } else if (temperature >= 25) {
      tempColor = 14; // Yellow for warm
    }

    this.changeTextColor(ColorManager.textColor(tempColor));
    this.drawText(tempString, tempX + 36, y, 100);
  };

  //=============================================================================
  // Main Menu Display - Add hunger and sleep status
  //=============================================================================

  // Create a new window for hunger and sleep status
  function Window_HungerSleepStatus() {
    this.initialize(...arguments);
  }

  Window_HungerSleepStatus.prototype = Object.create(Window_Base.prototype);
  Window_HungerSleepStatus.prototype.constructor = Window_HungerSleepStatus;

  Window_HungerSleepStatus.prototype.initialize = function (rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this.refresh();
  };

  Window_HungerSleepStatus.prototype.refresh = function () {
    if (!this.contents) return;

    this.contents.clear();
    this.drawHungerSleepStatus();
  };

  Window_HungerSleepStatus.prototype.drawHungerSleepStatus = function () {
    const lineHeight = this.lineHeight();
    let y = 0;

    // ONLY show actor 1
    const actor = $gameActors.actor(1);
    if (!actor) return;

    // Column positions - spread across full window width
    const totalWidth = this.contents.width;
    const nameWidth = 100;
    const hpWidth = 80;
    const mpWidth = 80;
    const statusWidth = 120;
    const hungerWidth = 80; // Increased to accommodate icon + text
    const sleepWidth = 80; // Increased to accommodate icon + text

    // Calculate remaining space and distribute it
    const usedWidth =
      nameWidth + hpWidth + mpWidth + statusWidth + hungerWidth + sleepWidth;
    const remainingWidth = totalWidth - usedWidth;
    const padding = Math.max(10, remainingWidth / 6); // Distribute remaining space as padding

    const hpX = nameWidth + padding;
    const mpX = hpX + hpWidth + padding;
    const statusX = mpX + mpWidth + padding;
    const hungerX = statusX + statusWidth + padding;
    const sleepX = hungerX + hungerWidth + padding;

    const x = 0;

    // Draw actor name
    this.resetTextColor();
    this.drawText(actor.name(), x, y, nameWidth);

    // Draw HP with color coding (current number only) - translated label
    const hpPercent = Math.floor((actor.hp / actor.mhp) * 100);
    let hpColor = hpPercent <= 25 ? 2 : hpPercent < 50 ? 14 : 3;
    this.changeTextColor(ColorManager.textColor(hpColor));
    this.drawText(`${getText("hp")}:${actor.hp}`, hpX, y, hpWidth);

    // Draw MP with color coding (current number only) - translated label
    const mpPercent = Math.floor((actor.mp / actor.mmp) * 100);
    let mpColor = mpPercent <= 25 ? 2 : mpPercent < 50 ? 14 : 4;
    this.changeTextColor(ColorManager.textColor(mpColor));
    this.drawText(`${getText("mp")}:${actor.mp}`, mpX, y, mpWidth);

    // Get first status effect
    const firstState = actor.states().length > 0 ? actor.states()[0] : null;
    const statusText = firstState ? firstState.name : "";
    this.resetTextColor();
    if (firstState && firstState.iconIndex > 0) {
      // Draw status icon if available
      this.drawIcon(firstState.iconIndex, statusX, y);
      this.drawText(
        statusText.substring(0, 10),
        statusX + 32,
        y,
        statusWidth - 32
      );
    } else {
      this.drawText(statusText.substring(0, 12), statusX, y, statusWidth);
    }

    // Draw hunger with icon and color coding
    const hungerPercent = actor.hungerPercent();
    let hungerColor = hungerPercent > 100 ? 21 : (hungerPercent <= 0 ? 2 : hungerPercent < 20 ? 14 : 3); // Magenta for > 100
    this.changeTextColor(ColorManager.textColor(hungerColor));
    this.drawIcon(hungerIcon, hungerX, y);
    this.drawText(`${hungerPercent}%`, hungerX + 32, y, hungerWidth - 32);

    // Draw sleep with icon and color coding
    const sleepPercent = actor.sleepPercent();
    let sleepColor = sleepPercent <= 0 ? 2 : sleepPercent < 20 ? 14 : 4;
    this.changeTextColor(ColorManager.textColor(sleepColor));
    this.drawIcon(sleepIcon, sleepX, y);
    this.drawText(`${sleepPercent}%`, sleepX + 32, y, sleepWidth - 32);
  };

  // Add the hunger/sleep window to the menu scene
  const _Scene_Menu_create = Scene_Menu.prototype.create;
  Scene_Menu.prototype.create = function () {
    _Scene_Menu_create.call(this);
    this.createHungerSleepStatusWindow();
    this.createTimeTemperatureWindow();
    this.createBountyWindow(); // NEW LINE
  };
  // Add new method to Scene_Menu
  Scene_Menu.prototype.createBountyWindow = function () {
    const rect = this.bountyWindowRect();
    this._bountyWindow = new Window_Bounty(rect);
    this.addWindow(this._bountyWindow);
  };

  // Add new method to Scene_Menu
  Scene_Menu.prototype.bountyWindowRect = function () {
    const goldRect = this.goldWindowRect();
    const timeRect = this.timeTemperatureWindowRect();
    const ww = timeRect.x; // Extend to just before time window with small gap
    const wh = goldRect.height; // Match gold window height exactly
    const wx = 0; // Bottom left corner
    const wy = goldRect.y; // Same Y position as gold window
    return new Rectangle(wx, wy, ww, wh);
  };
  Scene_Menu.prototype.createHungerSleepStatusWindow = function () {
    const rect = this.hungerSleepStatusWindowRect();
    this._hungerSleepStatusWindow = new Window_HungerSleepStatus(rect);
    this.addWindow(this._hungerSleepStatusWindow);
  };

  Scene_Menu.prototype.createTimeTemperatureWindow = function () {
    const rect = this.timeTemperatureWindowRect();
    this._timeTemperatureWindow = new Window_TimeTemperature(rect);
    this.addWindow(this._timeTemperatureWindow);
  };

  Scene_Menu.prototype.hungerSleepStatusWindowRect = function () {
    // Full screen width window - only showing actor 1
    const goldRect = this.goldWindowRect();
    const ww = Graphics.boxWidth; // Full screen width
    const wh = this.calcWindowHeight(1, false); // Always 1 line for actor 1 only
    const wx = 0; // Start from left edge
    const wy = goldRect.y - wh; // Position above the gold window
    return new Rectangle(wx, wy, ww, wh);
  };

  Scene_Menu.prototype.timeTemperatureWindowRect = function () {
    // Much larger window to accommodate horizontal layout with more spacing
    const goldRect = this.goldWindowRect();
    const ww = 350; // Increased width from 200 to 350 for larger container
    const wh = this.calcWindowHeight(1, false) + 8; // Height for 1 line only
    const wx = goldRect.x - ww; // Position to the left of gold window
    const wy = goldRect.y; // Same Y position as gold window
    return new Rectangle(wx, wy, ww, wh);
  };
  //=============================================================================
  // Game_Temp Extensions for Notifications
  //=============================================================================

  // Notifications render through the shared top-left HTML toast
  // (ParchmentToast.js, same visual language as the location popup).
  // The Game_Temp API is kept because other plugins push through it
  // (ItemSystemInventory, CookingSystem).
  Game_Temp.prototype.addHungerSleepNotification = function (text, severity) {
    if (!window.ParchmentToast) return;
    if (!severity) {
      // Derive severity from the text - works with Italian text too
      if (
        text.includes(getText("starving").replace("!", "")) ||
        text.includes(getText("exhausted").replace("!", ""))
      ) {
        severity = "danger";
      } else if (
        text.includes(getText("hungry")) ||
        text.includes(getText("sleepy"))
      ) {
        severity = "warning";
      } else {
        severity = "info";
      }
    }
    window.ParchmentToast.show(text, { severity: severity, duration: 120 });
  };

  function Window_Bounty() {
    this.initialize(...arguments);
  }

  Window_Bounty.prototype = Object.create(Window_Base.prototype);
  Window_Bounty.prototype.constructor = Window_Bounty;

  Window_Bounty.prototype.initialize = function (rect) {
    Window_Base.prototype.initialize.call(this, rect);
    this.refresh();
    this._refreshTimer = 0;
    this._cycleTimer = 0;
    this._showBounty = true; // Toggle between bounty and date
  };

  Window_Bounty.prototype.update = function () {
    Window_Base.prototype.update.call(this);

    // Refresh every 30 frames
    this._refreshTimer++;
    if (this._refreshTimer >= 30) {
      this._refreshTimer = 0;
      this.refresh();
    }

    // Handle cycling between bounty and date every 2 seconds (120 frames)
    const bountyValue = $gameVariables.value(66) || 0;
    if (bountyValue > 0) {
      this._cycleTimer++;
      if (this._cycleTimer >= 120) {
        this._cycleTimer = 0;
        this._showBounty = !this._showBounty;
      }
    }
  };

  Window_Bounty.prototype.refresh = function () {
    if (!this.contents) return;

    // Skip clear + redraw when the displayed content is unchanged.
    const bountyValue = $gameVariables.value(66) || 0;
    let sig;
    if (bountyValue === 0) {
      sig = 'hidden';
    } else if (this._showBounty) {
      sig = 'b|' + bountyValue;
    } else {
      const dateTime = getDateTimeFromMinutes(getGameTimeMinutes());
      sig = 'd|' + dateTime.dateShort;
    }
    if (sig === this._lastDrawSig) return;
    this._lastDrawSig = sig;

    this.contents.clear();
    this.drawBounty();
  };

  Window_Bounty.prototype.drawBounty = function () {
    const bountyValue = $gameVariables.value(66) || 0;

    if (bountyValue === 0) {
      this.hide();
      return;
    }

    this.show();
    const minutes = getGameTimeMinutes();
    const dateTime = getDateTimeFromMinutes(minutes);

    if (this._showBounty) {
      const euroValue = (bountyValue / 100).toFixed(2);
      const bountyText = `${euroValue}€`;
      this.changeTextColor(ColorManager.textColor(2));
      this.drawText(bountyText, 0, 0, this.contents.width, "left");
    } else {
      this.resetTextColor();
      this.drawText(dateTime.dateShort, 0, 0, this.contents.width, "left");
    }
  };
  //=============================================================================
  // Data Loading/Saving
  //=============================================================================

  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function (contents) {
    _DataManager_extractSaveContents.call(this, contents);

    // Migration of old individual own properties to the shared global variables
    let migratedHunger = null;
    let migratedSleep = null;

    $gameParty.members().forEach((actor) => {
      if (actor.hasOwnProperty("_hunger")) {
        if (migratedHunger === null) migratedHunger = actor._hunger;
        delete actor._hunger;
      }
      if (actor.hasOwnProperty("_sleep")) {
        if (migratedSleep === null) migratedSleep = actor._sleep;
        delete actor._sleep;
      }
    });

    if (migratedHunger !== null && $gameSystem) {
      $gameSystem._globalHunger = migratedHunger;
    }
    if (migratedSleep !== null && $gameSystem) {
      $gameSystem._globalSleep = migratedSleep;
    }

    // Initialize hunger/sleep system after loading if needed
    $gameParty.members().forEach((actor) => {
      if (actor._hunger === undefined) {
        actor._hunger = maxHunger;
      }
      if (actor._sleep === undefined) {
        actor._sleep = maxSleep;
      }
      if (actor._hygiene === undefined) {
        actor._hygiene = maxNeed;
      }
      if (actor._social === undefined) {
        actor._social = maxNeed;
      }
      if (actor._leisure === undefined) {
        actor._leisure = maxNeed;
      }
      if (actor._prevHungerState === undefined) {
        actor._prevHungerState = "normal";
      }
      if (actor._prevSleepState === undefined) {
        actor._prevSleepState = "normal";
      }
    });

    // Initialize game time if not set (game load). Unset variables read as 0,
    // so only seed 0 when there is no saved time; always refresh the displayed
    // date variable (113) from the loaded game time so it is never stale.
    if (!$gameVariables.value(gameTimeVariable)) {
      $gameVariables.setValue(gameTimeVariable, 0); // Start at 0 minutes elapsed (8 AM on Jan 1, 2001)
      debug("Game time initialized to 01 JAN 2001 12:00 after load");
    }
    updateGameDateVariable();
  };

  //=============================================================================
  // PartyNeeds - shared needs vocabulary for the whole party
  //=============================================================================
  // Single source of truth for "what needs exist" and "what is the party's
  // median for each". The player (Actor 1) reads its own actor meters; every
  // other member reads its NPC society profile. Consumed by both the travel
  // HUD below and the parchment menu (CustomMainMenuLayout.js).
  window.PartyNeeds = {
    KEYS:   ['hunger', 'sleep', 'hygiene', 'social', 'leisure'],
    get LABELS() { return T.obj("TimeDate.needLabel"); },

    getMemberNeeds(mem) {
      if (!mem) return {};
      // The actor accessors already resolve where each meter lives (actor
      // fields for the player, society profile for a recruited companion), so
      // every member is read the same way.
      const profile = window.NPCSocietyRegistry?.getProfile?.(mem.name());
      return {
        hunger:  mem.hungerPercent   ? mem.hungerPercent()   : Math.round(profile?.hunger ?? 100),
        sleep:   mem.sleepPercent    ? mem.sleepPercent()    : Math.round(profile?.sleep  ?? 100),
        hygiene: mem.hygienePercent  ? mem.hygienePercent()  : Math.round(profile?.hygiene ?? 100),
        social:  mem.socialPercent   ? mem.socialPercent()   : Math.round(profile?.social  ?? 100),
        leisure: mem.leisurePercent  ? mem.leisurePercent()  : Math.round(profile?.leisure ?? 100),
      };
    },

    median(values) {
      const vals = values.filter(v => v !== null && v !== undefined);
      if (!vals.length) return null;
      const sorted = vals.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    },

    partyMedian() {
      const members = $gameParty ? $gameParty.members() : [];
      const all = members.map(m => this.getMemberNeeds(m));
      const out = {};
      for (const k of this.KEYS) out[k] = this.median(all.map(n => n[k]));
      return out;
    },

    // Apply a signed delta to one of the extended meters (Hygiene / Social /
    // Fun) of every party member, through the actor need methods, which write
    // to the actor for the player and to the society profile for a recruited
    // companion.
    //
    // opts.focus is the member the moment belongs to, the one doing the talking
    // or the playing: they get opts.focusBonus times the delta, so a shared
    // experience still counts for more to whoever lived it.
    addNeedToAll(key, delta, opts = {}) {
      if (!delta || !$gameParty) return;
      const spec = {
        hygiene: { add: 'addHygiene', reduce: 'reduceHygiene' },
        social:  { add: 'addSocial',  reduce: 'reduceSocial'  },
        leisure: { add: 'addLeisure', reduce: 'reduceLeisure' },
      }[key];
      if (!spec) return;
      const focus = opts.focus || null;
      const bonus = opts.focusBonus != null ? Number(opts.focusBonus) : 1;
      $gameParty.members().forEach(mem => {
        if (!mem) return;
        const d = (focus && mem === focus) ? delta * bonus : delta;
        if (!d) return;
        if (d >= 0) {
          if (mem[spec.add]) mem[spec.add](d);
        } else if (mem[spec.reduce]) {
          mem[spec.reduce](-d);
        }
      });
    },

    addLeisureToAll(delta, opts) { this.addNeedToAll('leisure', delta, opts); },
    addSocialToAll(delta, opts)  { this.addNeedToAll('social',  delta, opts); }
  };

  //=============================================================================
  // MinigameFun - shared hook for minigames to nudge the party Fun stat.
  // Playing any minigame is leisure; winning is a bigger boost, losing costs
  // Fun. Defensive so games can call it without worrying about load order.
  //=============================================================================
  window.MinigameFun = {
    DELTA: { played: 3, won: 12, lost: -6, draw: 3 },

    // Points towards the game's own specialization. Winning teaches more than
    // losing, but losing still teaches: the party is practising either way.
    SPEC_POINTS: { played: 1, won: 3, lost: 1, draw: 2 },

    // Legacy skins, still passed by older call sites as a bare string. Each one
    // names the specialization that kind of pastime trains, so a call that has
    // not been given an explicit spec still trains something sensible.
    // i18n-ignore-start: Specialization.json ids, matched by name
    THEME_SPEC: {
      arcade: 'Video Gaming',
      casino: 'Card Counting',
      felt: 'Board Game Strategy',
      aqua: 'Swimming',
      mystic: 'Tarot Reading',
      sci: 'Chemistry',
      hardwood: 'Basketball'
    },
    // i18n-ignore-end

    // Legacy skin API kept as a no-op so minigames calling use('arcade') keep
    // working; feedback renders through the shared ParchmentToast popup
    // regardless of skin.
    use() { return this; },

    // A call carries either a legacy theme string or { spec, points, actor }.
    _opts(arg) {
      if (!arg) return {};
      if (typeof arg === 'string') return { theme: arg, spec: this.THEME_SPEC[arg] };
      return Object.assign({}, arg, {
        spec: arg.spec || (arg.theme ? this.THEME_SPEC[arg.theme] : null)
      });
    },

    _apply(kind, arg) {
      const opts = this._opts(arg);
      const delta = this.DELTA[kind] || 0;
      if (delta && window.PartyNeeds && window.PartyNeeds.addLeisureToAll) {
        window.PartyNeeds.addLeisureToAll(delta);
      }

      // Points are banked immediately; the level-up toast is queued behind the
      // Fun toast so one session can report both without either being lost.
      let gained = [];
      const points = opts.points != null ? opts.points : (this.SPEC_POINTS[kind] || 0);
      if (opts.spec && points > 0 && window.SpecializationXP) {
        try {
          gained = window.SpecializationXP.award(opts.spec, points, {
            actor: opts.actor,
            silent: true
          }) || [];
        } catch (e) { gained = []; }
      }

      try {
        if (!window.ParchmentToast) return;
        window.ParchmentToast.group([
          () => window.ParchmentToast.need('leisure', delta),
          ...gained.map(g => () => window.SpecializationXP.announce(g))
        ]);
      } catch (e) { /* never let a cosmetic popup break a minigame */ }
    },

    // Call once when a minigame session begins.
    played(opts) { this._apply('played', opts); },
    // Call when the player wins / gets a strong positive result.
    won(opts) { this._apply('won', opts); },
    // Call when the player loses / fails.
    lost(opts) { this._apply('lost', opts); },
    // Call for a neutral or drawn result.
    draw(opts) { this._apply('draw', opts); }
  };

  //=============================================================================
  // MapInfoHUD - DOM-based info card, bottom-right corner of the screen
  //=============================================================================
  function MapInfoHUD() {
    this._el = null;
    this._shown = false;
    this._refreshTimer = 0;
    this._cachedNeeds = { hunger: 100, sleep: 100, hygiene: 100, social: 100, leisure: 100 };
    this._lastPlayerX = $gamePlayer ? $gamePlayer.x : 0;
    this._lastPlayerY = $gamePlayer ? $gamePlayer.y : 0;
    this._create();
    this._refresh();
  }

  MapInfoHUD.prototype._create = function () {
    const el = document.createElement('div');
    el.id = 'map-info-hud';
    document.body.appendChild(el);
    this._el = el;
  };

  MapInfoHUD.prototype.destroy = function () {
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    this._el = null;
  };

  // The card is built during createAllWindows, while the scene is still black
  // and fading in, so it would otherwise pop in fully-formed over the loading
  // map. Hold it at opacity 0 until the map scene has finished its own fade,
  // then let the CSS transition ease it in.
  MapInfoHUD.prototype._updateReveal = function () {
    if (this._shown) return;
    const scene = SceneManager._scene;
    if (scene instanceof Scene_Map && !scene.isBusy()) {
      this._shown = true;
      this._el.classList.add('mih-visible');
    }
  };

  MapInfoHUD.prototype.update = function () {
    if (!this._el) return;
    this._updateReveal();
    const mapId = $gameMap ? $gameMap.mapId() : 0;
    if (mapId === 315 && $gamePlayer) {
      const px = $gamePlayer.x;
      const py = $gamePlayer.y;
      if (px !== this._lastPlayerX || py !== this._lastPlayerY) {
        this._lastPlayerX = px;
        this._lastPlayerY = py;
        this._refresh();
        return;
      }
    }
    this._refreshTimer++;
    if (this._refreshTimer >= 30) {
      this._refreshTimer = 0;
      this._refresh();
    }
  };

  MapInfoHUD.prototype._getBiomeName = function () {
    if ($gamePlayer && window.WorldGen && window.WorldGen.HardcodedBiomeNames) {
      const loc = window.WorldGen.HardcodedBiomeNames[`${$gamePlayer.x},${$gamePlayer.y}`];
      if (loc) return loc;
    }
    let name = 'Unknown'; // i18n-ignore: sentinel compared against cached biome ids
    if ($gameSystem && $gameSystem.getBiomeFromCache && $gamePlayer) {
      const b = $gameSystem.getBiomeFromCache($gamePlayer.x, $gamePlayer.y);
      if (b && b !== 'Unknown') name = b; // i18n-ignore: sentinel
    }
    if (name === 'Unknown' && $gameSystem && $gameSystem._procGenData && $gameSystem._procGenData.currentBiome) { // i18n-ignore: sentinel
      name = $gameSystem._procGenData.currentBiome;
    }
    if (name.startsWith('Road ')) name = 'Road';
    // The cached value is a biome id ("ForestTropical"); the card shows the
    // readable name Biomes.json declares for it ("Tropical Forest").
    return window.BiomeNames.display(name);
  };

  // Country the player is standing in, plus the hyperpower controlling it.
  // The world map sets the country by region id (see WeatherSystem.js); the
  // active entry lives on $gameWeather.currentCountry, with Variable 86 as a
  // fallback index into window.WorldGen.Countries.
  MapInfoHUD.prototype._getCountryInfo = function () {
    let cc = (typeof $gameWeather !== 'undefined' && $gameWeather) ? $gameWeather.currentCountry : null;
    if (!cc && window.WorldGen && window.WorldGen.Countries) {
      const id = $gameVariables ? $gameVariables.value(86) : 0;
      cc = window.WorldGen.Countries.find(c => c.id === id);
    }
    if (!cc) return null;
    const controller = (cc.controller && cc.controller !== 'Neutral') // i18n-ignore: faction id ? cc.controller : '';
    return { country: cc.country || '', controller };
  };

  // Total hunger the party's food stock can restore, using the same nutrition
  // tags and recovery formula as EatFood: calories*0.10 + protein*2 + fat*1.5,
  // summed over every food item times its stack count.
  MapInfoHUD.prototype._foodReserve = function () {
    if (!$gameParty) return 0;
    // Cached: this regex-scans every party item, so it only recomputes when the
    // inventory changes (invalidated by the Game_Party.gainItem alias below).
    if (_foodReserveCache !== null) return _foodReserveCache;
    const utils = window.ItemSystemUtils;
    let total = 0;
    for (const item of $gameParty.items()) {
      if (!item || !item.note) continue;
      const cal = item.note.match(/<calories:(\d+)>/i);
      const fat = item.note.match(/<fat:(\d+)>/i);
      const pro = item.note.match(/<protein:(\d+)>/i);
      const isFood = (utils && utils.hasItemCategory && utils.hasItemCategory(item, 'Food')) // i18n-ignore: item category tag || cal || pro || fat;
      if (!isFood) continue;
      const recovery =
        (cal ? Number(cal[1]) : 0) * calorieFactor +
        (pro ? Number(pro[1]) : 0) * proteinFactor +
        (fat ? Number(fat[1]) : 0) * fatFactor;
      if (recovery > 0) total += recovery * $gameParty.numItems(item);
    }
    _foodReserveCache = total;
    return total;
  };

  // Hunger lost per in-game minute while travelling on the world map.
  // Mirrors the depletion loop: maxHunger*0.003 per step, 10 minutes per step.
  MapInfoHUD.prototype._worldHungerDrainPerMinute = function () {
    return (maxHunger * 0.003) / 10;
  };

  // "2mo 4d", "5d 3h", "6h 20m", ... - the two largest non-zero units.
  MapInfoHUD.prototype._formatFoodTime = function (minutes) {
    if (!minutes || minutes <= 0) return 'none';
    let rem = Math.floor(minutes);
    const units = [
      ['mo', 30 * 24 * 60],
      ['d', 24 * 60],
      ['h', 60],
      ['m', 1],
    ];
    const parts = [];
    for (const [label, size] of units) {
      const v = Math.floor(rem / size);
      if (v > 0) { parts.push(`${v}${label}`); rem -= v * size; }
      if (parts.length === 2) break;
    }
    return parts.length ? parts.join(' ') : '<1m';
  };

  // Food-remaining row: how long the current food stock would last on the road.
  MapInfoHUD.prototype._food = function () {
    const reserve = this._foodReserve();
    const perMin = this._worldHungerDrainPerMinute();
    const text = (reserve > 0 && perMin > 0) ? this._formatFoodTime(reserve / perMin) : T("TimeDate.hud.noFood");
    return `<div class="mih-region mih-food">` +
      `<span class="mih-region-lbl">${T("TimeDate.hud.food")}</span>` +
      `<span class="mih-region-val">${text}</span>` +
    `</div>`;
  };

  // Temperature row: current ambient temp plus how much it is speeding up
  // hunger drain, so the cost of the climate is visible on the road.
  MapInfoHUD.prototype._temperature = function () {
    const temp = $gameVariables ? ($gameVariables.value(temperatureVariable) || 0) : 0;
    let cls = 'mih-temp-mild';
    if (temp <= 0) cls = 'mih-temp-cold';
    else if (temp < 12) cls = 'mih-temp-cool';
    else if (temp >= 35) cls = 'mih-temp-hot';
    else if (temp >= 27) cls = 'mih-temp-warm';
    return `<div class="mih-region mih-temp">` +
      `<span class="mih-region-lbl">${T("TimeDate.hud.temp")}</span>` +
      `<span class="mih-region-val ${cls}">${Math.round(temp)}&deg;C</span>` +
    `</div>`;
  };

  // Base fill colour per need; low values override to amber/red below.
  MapInfoHUD.NEED_COLORS = {
    hunger: 'mih-green', sleep: 'mih-blue', hygiene: 'mih-purple',
    social: 'mih-orange', leisure: 'mih-teal'
  };

  MapInfoHUD.prototype._fillClass = function (need, pct) {
    if (pct <= 20) return 'mih-red';
    if (pct < 40)  return 'mih-amber';
    return MapInfoHUD.NEED_COLORS[need] || 'mih-green';
  };

  // Render the median-of-party value for every tracked need as a labelled bar.
  MapInfoHUD.prototype._vitals = function (needs) {
    const PN = window.PartyNeeds;
    let rows = '';
    for (const key of PN.KEYS) {
      const pct = needs[key];
      if (pct === null || pct === undefined) continue;
      const fill = this._fillClass(key, pct);
      rows +=
        `<div class="mih-need">` +
          `<span class="mih-need-lbl">${PN.LABELS[key]}</span>` +
          `<div class="mih-need-bar"><div class="mih-need-fill ${fill}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>` +
          `<span class="mih-need-pct">${pct}%</span>` +
        `</div>`;
    }
    return `<div class="mih-needs">${rows}</div>`;
  };

  // Fuel of the vehicle the player is currently riding, as an HTML bar matching
  // the needs bars. Returns '' when on foot or in a fuel-free vehicle.
  MapInfoHUD.prototype._fuel = function () {
    const st = window.MergedVehicleSystem?.getActiveFuelStatus?.();
    if (!st) return '';
    const fill = st.pct <= 25 ? 'mih-red' : 'mih-fuel';
    return `<div class="mih-needs mih-fuel-row">` +
      `<div class="mih-need">` +
        `<span class="mih-need-lbl">${st.name}</span>` +
        `<div class="mih-need-bar"><div class="mih-need-fill ${fill}" style="width:${st.pct}%"></div></div>` +
        `<span class="mih-need-pct">${st.fuel.toFixed(1)}L</span>` +
      `</div>` +
    `</div>`;
  };

  MapInfoHUD.prototype._refresh = function () {
    if (!this._el) return;
    const mapId = $gameMap ? $gameMap.mapId() : 0;
    const isWorldMap   = mapId === 315;
    const isRestZone   = NO_DEPLETION_MAPS.includes(mapId);
    const actor        = $gameActors.actor(1);

    // Median of every tracked need across the whole party.
    let needs;
    if (actor) {
      needs = window.PartyNeeds.partyMedian();
      this._cachedNeeds = needs;
    } else {
      needs = this._cachedNeeds || { hunger: 100, sleep: 100, hygiene: 100, social: 100, leisure: 100 };
    }

    const dt = getDateTimeFromMinutes(getGameTimeMinutes());
    let html = '';

    if (isRestZone) {
      html =
        `<div class="mih-datetime"><span class="mih-star">&#9733;</span>${dt.dateShort}</div>` +
        `<div class="mih-datetime"><span class="mih-star">&#9733;</span>${dt.time24}</div>`;
    } else if (isWorldMap) {
      const loc = this._getBiomeName();
      const ci = this._getCountryInfo();
      let countryHtml = '';
      if (ci && ci.country) {
        countryHtml =
          `<div class="mih-region">` +
            `<span class="mih-region-lbl">${ci.country}</span>` +
            (ci.controller ? `<span class="mih-region-val">${ci.controller}</span>` : '') +
          `</div>`;
      }
      html =
        `<div class="mih-datetime"><span class="mih-star">&#9733;</span>${dt.dateShort} ${dt.time24}</div>` +
        `<div class="mih-location">${loc}</div>` +
        countryHtml +
        this._temperature() +
        this._food() +
        this._vitals(needs) +
        this._fuel();
    } else {
      html = this._vitals(needs) + this._fuel();
    }

    // Only touch the DOM when the built HTML actually differs from what's shown.
    if (html !== this._lastHtml) {
      this._lastHtml = html;
      this._el.innerHTML = html;
    }
  };

  // Cached food reserve (see MapInfoHUD._foodReserve); invalidated whenever the
  // party's item stock changes.
  let _foodReserveCache = null;
  const _Game_Party_gainItem_TDS = Game_Party.prototype.gainItem;
  Game_Party.prototype.gainItem = function (item, amount, includeEquip) {
    _Game_Party_gainItem_TDS.call(this, item, amount, includeEquip);
    _foodReserveCache = null;
  };

  // Hook: create HUD on supported maps
  const _Scene_Map_createAllWindows_TDS = Scene_Map.prototype.createAllWindows;
  Scene_Map.prototype.createAllWindows = function () {
    _Scene_Map_createAllWindows_TDS.call(this);
    this.createHungerSleepOverlay();
  };

  Scene_Map.prototype.createHungerSleepOverlay = function () {
    const mapId = $gameMap.mapId();
    if (mapId === 315 || NO_DEPLETION_MAPS.includes(mapId)) {
      this._mapInfoHUD = new MapInfoHUD();
    }
  };

  // Hook: update HUD each frame (also drives the sleep/cryo sequences below)
  const _Scene_Map_update_TDS_HUD = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update_TDS_HUD.call(this);
    if (this._mapInfoHUD) this._mapInfoHUD.update();
    this.updateSleepSequence();
    this.updateCryoSequence();
  };

  // Hook: destroy HUD when leaving the scene
  const _Scene_Map_terminate_TDS = Scene_Map.prototype.terminate;
  Scene_Map.prototype.terminate = function () {
    if (this._mapInfoHUD) {
      this._mapInfoHUD.destroy();
      this._mapInfoHUD = null;
    }
    _Scene_Map_terminate_TDS.call(this);
  };

  //=============================================================================
  // Sleep Menu, business logic only.
  // The parchment DOM popup lives in TimeDateSystemUI.js, which defines
  // Scene_Map.prototype.openSleepMenu / closeSleepMenu / execSleepMenuCommand.
  //=============================================================================

  // A rest longer than DREAM_MIN_HOURS has a DREAM_CHANCE of ending in the
  // Dream / Cancel prompt instead of waking up straight away.
  const DREAM_MIN_HOURS = 5;
  const DREAM_CHANCE = 0.5;

  Scene_Map.prototype.setSleepRespawnPoint = function () {
    $gameVariables.setValue(112, $gameVariables.value(86)); // RespawnCountryID = CurrentCountryID
    $gameVariables.setValue(25, $gameMap.mapId());          // RespawnMapID
    $gameVariables.setValue(26, $gamePlayer.x);             // RespawnX
    $gameVariables.setValue(27, $gamePlayer.y);             // RespawnY
    // Mark that a respawn point has been explicitly set, so the death system
    // does not treat the new-game default respawn vars as a real respawn.
    $gameSystem._respawnPointSet = true;
  };

  // isWait: Bethesda-style waiting. Same frame-by-frame clock advance, but the
  // party only passes the time, it does not rest: no sleep meter refill, no
  // healing, and no awakening menu at the end.
  Scene_Map.prototype.startSleepSequence = function (hours, isWait) {
    $gameScreen.startFadeOut(60);
    this._sleepSequenceState = 1;
    this._sleepSequenceTimer = 60;
    this._sleepHours = hours;
    this._sleepIsWait = !!isWait;
  };

  Scene_Map.prototype.startWaitSequence = function (hours) {
    this.startSleepSequence(hours, true);
  };

  Scene_Map.prototype.updateSleepSequence = function () {
    if (this._sleepSequenceState) {
      if (this._sleepSequenceTimer > 0) {
        this._sleepSequenceTimer--;
        return;
      }

      switch (this._sleepSequenceState) {
        case 1:
          if (!this._sleepIsWait) {
            AudioManager.playMe({ name: "Inn1", volume: 90, pitch: 100, pan: 0 });
          }
          this._beginSleepAdvance(this._sleepHours, this._sleepIsWait);
          this._sleepSequenceState = 2;
          break;

        case 2:
          // Advance one slice of the night per frame so the map-info HUD ticks
          // the clock and need bars in real time instead of jumping all at once.
          this._stepSleepAdvance();
          break;
      }
    }
  };

  // Set up the frame-by-frame sleep advance. The night is spread over a fixed
  // number of frames so the HUD animates regardless of how many hours are slept.
  Scene_Map.prototype._beginSleepAdvance = function (hours, isWait) {
    const FRAMES = 150;
    const totalMinutes = hours * 60;
    const startTime = getGameTimeMinutes();
    const leader = $gameParty.leader();
    const sleepStart = leader ? leader._sleep : 0;
    this._sleepAdvance = {
      isWait: !!isWait,
      hours: hours,
      totalMinutes: totalMinutes,
      doneMinutes: 0,
      minutesPerFrame: FRAMES > 0 ? totalMinutes / FRAMES : totalMinutes,
      startTime: startTime,
      // NPC schedules still tick once per simulated hour as the night passes.
      nextNpcTick: startTime + 60,
      sleepStart: sleepStart,
      // Sleeping always wakes the party fully rested, whatever wake-up hour was
      // picked. Waiting is time spent awake: the sleep meter drains with the
      // hours instead of filling, at the same rate the other needs wear down.
      sleepTarget: leader
        ? (isWait
            ? Math.max(0, sleepStart - (maxSleep * 0.0004) * totalMinutes)
            : maxSleep)
        : 0,
    };
  };

  Scene_Map.prototype._stepSleepAdvance = function () {
    const a = this._sleepAdvance;
    if (!a) { this._finishSleepAdvance(); return; }

    const prevDone = a.doneMinutes;
    a.doneMinutes = Math.min(a.totalMinutes, a.doneMinutes + a.minutesPerFrame);
    const deltaMin = a.doneMinutes - prevDone;
    const currentTime = a.startTime + a.doneMinutes;

    // Advance the displayed clock/date.
    setGameTimeMinutes(Math.floor(currentTime));
    updateGameDateVariable();

    // Run NPC schedules for every simulated hour we cross during the night.
    while (a.nextNpcTick <= currentTime) {
      if (window.NPCSim?.tick) {
        try { window.NPCSim.tick(a.nextNpcTick); } catch (_) {}
      }
      a.nextNpcTick += 60;
    }

    // The body keeps working while asleep: hunger and the social/hygiene/fun
    // meters wear down over the slept minutes while the sleep meter fills.
    const leader = $gameParty.leader();
    if (leader) {
      leader.reduceHunger((maxHunger * 0.0003) * deltaMin);
      if (leader.reduceHygiene) leader.reduceHygiene((maxSleep * 0.0005) * deltaMin);
      if (leader.reduceSocial)  leader.reduceSocial((maxSleep * 0.0003) * deltaMin);
      if (leader.reduceLeisure) leader.reduceLeisure((maxSleep * 0.0003) * deltaMin);
      const frac = a.totalMinutes > 0 ? a.doneMinutes / a.totalMinutes : 1;
      leader._sleep = a.sleepStart + (a.sleepTarget - a.sleepStart) * frac;
    }

    // Push the new state to the bottom-right card immediately this frame.
    if (this._mapInfoHUD && this._mapInfoHUD._refresh) {
      this._mapInfoHUD._refresh();
    }

    if (a.doneMinutes >= a.totalMinutes) {
      this._finishSleepAdvance();
    }
  };

  Scene_Map.prototype._finishSleepAdvance = function () {
    const a = this._sleepAdvance;
    this._sleepAdvance = null;

    if (a) {
      // Snap the clock to the exact wake time and finish any remaining hourly
      // NPC ticks, then resolve background life events across the whole night.
      const endTime = a.startTime + a.totalMinutes;
      setGameTimeMinutes(endTime);
      updateGameDateVariable();
      while (a.nextNpcTick <= endTime) {
        if (window.NPCSim?.tick) {
          try { window.NPCSim.tick(a.nextNpcTick); } catch (_) {}
        }
        a.nextNpcTick += 60;
      }
      if (window.NPCLifeSim?.catchUp) {
        try { window.NPCLifeSim.catchUp(endTime); } catch (_) {}
      }
    }

    // Waiting only burns the clock: no healing, no awakening menu, just fade
    // back in where the party was standing.
    if (a && a.isWait) {
      if (this._mapInfoHUD && this._mapInfoHUD._refresh) {
        this._mapInfoHUD._refresh();
      }
      if (this.closeSleepMenu) this.closeSleepMenu();
      $gameScreen.startFadeIn(60);
      this._sleepSequenceState = 0;
      this._sleepIsWait = false;
      return;
    }

    // Restorative effects. The sleep meter was already filled gradually above;
    // recoverAll() only touches HP/MP/states, so it leaves it intact.
    $gameParty.members().forEach(actor => actor.recoverAll());

    for (let j = 0; j < 2; j++) {
      PluginManager.callCommand(this, "Health_Core", "HealBodyParts", { amount: "100" });
    }

    $gameParty.members().forEach(actor => {
      actor.gainMp(9999);
      actor.gainTp(100);
    });

    if (this._mapInfoHUD && this._mapInfoHUD._refresh) {
      this._mapInfoHUD._refresh();
    }

    // Long rests sometimes drop the party into a dream: the awakening menu is
    // the Dream / Cancel prompt, and it only shows up on that roll. Every other
    // sleep just fades back in on the spot.
    const sleptHours = a ? a.hours : 0;
    if (sleptHours > DREAM_MIN_HOURS && Math.random() < DREAM_CHANCE && this.openSleepMenu) {
      this.openSleepMenu("post_sleep");
    } else {
      if (this.closeSleepMenu) this.closeSleepMenu();
      $gameScreen.startFadeIn(60);
    }
    this._sleepSequenceState = 0;
  };

  //=============================================================================
  // Cryogenic sleep sequence. Fades out, jumps the clock to the chosen wake
  // year (running the NPC sim across the whole gap), then wakes the party fully
  // preserved. Driven by the SleepMenu UI (cryo_<year> command).
  //=============================================================================

  Scene_Map.prototype.startCryoSequence = function (minutes) {
    $gameScreen.startFadeOut(60);
    this._cryoSequenceState = 1;
    this._cryoSequenceTimer = 60;
    this._cryoMinutes = minutes;
  };

  Scene_Map.prototype.updateCryoSequence = function () {
    if (!this._cryoSequenceState) return;
    if (this._cryoSequenceTimer > 0) {
      this._cryoSequenceTimer--;
      return;
    }

    switch (this._cryoSequenceState) {
      case 1:
        AudioManager.playMe({ name: "Inn1", volume: 90, pitch: 100, pan: 0 });
        // Advance the clock to the wake date, ticking the world the whole way.
        advanceGameTimeSimulated(this._cryoMinutes);
        // Cryogenic preservation: the party emerges unaged and fully restored.
        $gameParty.members().forEach(actor => {
          actor._hunger = maxHunger;
          actor._sleep = maxSleep;
          if (actor.updateOvereatState) actor.updateOvereatState();
          actor.recoverAll();
          actor.gainMp(9999);
          actor.gainTp(100);
        });
        for (let j = 0; j < 2; j++) {
          PluginManager.callCommand(this, "Health_Core", "HealBodyParts", { amount: "100" });
        }
        if (this._mapInfoHUD && this._mapInfoHUD._refresh) {
          this._mapInfoHUD._refresh();
        }
        this._cryoSequenceState = 2;
        this._cryoSequenceTimer = 30;
        break;

      case 2:
        $gameScreen.startFadeIn(60);
        $gameTemp._sleepMenuOpen = false;
        this._cryoSequenceState = 0;
        this._cryoMinutes = 0;
        break;
    }
  };

  const _Game_Temp_initialize_sleep = Game_Temp.prototype.initialize;
  Game_Temp.prototype.initialize = function () {
    _Game_Temp_initialize_sleep.call(this);
    this._sleepMenuOpen = false;
  };

  const _Game_Player_canMove = Game_Player.prototype.canMove;
  Game_Player.prototype.canMove = function () {
    if ($gameTemp._sleepMenuOpen) return false;
    return _Game_Player_canMove.call(this);
  };

  // Expose globals for use by other plugins
  window.TimeDateSystem = window.TimeDateSystem || {};
  window.TimeDateSystem.maxHunger = maxHunger;
  window.TimeDateSystem.maxSleep = maxSleep;
  window.TimeDateSystem.getDateTimeFromMinutes = getDateTimeFromMinutes;
  window.TimeDateSystem.getGameTimeMinutes = getGameTimeMinutes;
  window.TimeDateSystem.getCryoYears = getCryoYears;
  window.TimeDateSystem.getCryoAdvanceMinutes = getCryoAdvanceMinutes;
  // Resolved on every read, so a language switch reaches the rest menu without
  // either plugin holding on to a stale table.
  Object.defineProperty(window.TimeDateSystem, "sleepMenuI18n", {
    get() { return T.obj("TimeDate.sleepMenu"); },
    configurable: true,
  });

  //=============================================================================
  // Game Initialization - Ensure time system is ready
  //=============================================================================

  const _DataManager_createGameObjects = DataManager.createGameObjects;
  DataManager.createGameObjects = function () {
    _DataManager_createGameObjects.call(this);

    // Initialize game time on new game (Variable 114 stores total minutes elapsed).
    // Unset variables read as 0, so seed 0 and always populate the date variable (113).
    if (!$gameVariables.value(gameTimeVariable)) {
      $gameVariables.setValue(gameTimeVariable, 0); // Start at 0 minutes elapsed (8 AM on Jan 1, 2001)
      debug("Game time initialized to 01 JAN 2001 12:00 - normal maps increment by real minutes, map 315 increments by 15 per step");
    }
    updateGameDateVariable();
  };
})();
