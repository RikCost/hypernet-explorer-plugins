/*:
 * @target MZ
 * @plugindesc NPC Simulation Core v1.0.0, Autonomous Society Orchestrator
 * @author Omni-Lex
 * @help
 * ============================================================================
 * NPCSimulationCore, Autonomous Society Orchestrator
 * ============================================================================
 * Central scheduler that wires all game systems together so every NPC can:
 *   - Have hunger, sleep, and money needs that drive their behaviour
 *   - Hold jobs from WorkSystem and simulate off-screen shifts
 *   - Tend plants and animals if they have compatible traits
 *   - Approach and interact with vending machines, arcade cabinets, shops
 *   - Steal from shops when morality is low (and may get caught)
 *   - Generate contextual thoughts shown in dialogue
 *   - Accumulate a personal story log that feeds into HistorySimulator
 *
 * Load Order:
 *   DataService → NPCSystem → NPCSociety → NPCSystemParty
 *   → NPCSimulationCore  ← this file
 *   → HistorySimulator → HistorySimulatorUI
 *
 * Plugin Command:
 *   NPCHistory <EventName> , shows the story log for the named NPC
 *
 * @command NPCHistory
 * @desc Show the autonomous story log of a specific NPC.
 *
 * @arg eventName
 * @text NPC Event Name
 * @type string
 * @default
 * @desc The exact event name of the NPC whose history you want to view.
 *
 * @command NPCDebug
 * @desc Print the full simulation profile of a named NPC to the browser console.
 *
 * @arg eventName
 * @text NPC Event Name
 * @type string
 * @default
 *
 * @command NPCForceNeed
 * @desc Override a specific field on an NPC profile (for testing).
 *
 * @arg eventName
 * @text NPC Event Name
 * @type string
 * @default
 *
 * @arg field
 * @text Field name
 * @type string
 * @default hunger
 * @desc e.g. hunger, sleep, money, moralityScore, currentJobId
 *
 * @arg value
 * @text Value
 * @type string
 * @default 0
 * @desc Numeric value to assign.
 */

(() => {
  "use strict";

  const pluginName = "NPCSimulationCore";

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const DEFAULT_SEED = 19002001;
  const MONEY_CAP    = 200000;  // Gold cap per NPC, prevents unbounded accumulation
  const REST_REGION  = 102;     // Region ID: NPC rest zones (fill sleep, face Counter if adjacent)

  // The road to 2012: society stays calm up to ERA_CALM_YEAR, then frays month
  // by month until ERA_CHAOS_YEAR, the apex of crime and paranoia (see
  // eraTension below). Wired to TimeDateSystem so it tracks fast-travel jumps
  // and the cryo wake-up alike.
  const ERA_CALM_YEAR  = 2010;
  const ERA_CHAOS_YEAR = 2012;

  // Shared shift system, used by both job-working NPCs (JobShiftManager) and
  // <Shop>-tagged events (ShopShiftManager): three 8-hour shifts cover the
  // full 24h day (00-08, 08-16, 16-24).
  const SHIFT_HOURS = 8;
  const SHIFT_COUNT = 3; // 3 shifts x 8h = 24h

  // Fraction of a group's job-less NPCs reserved during job assignment as the
  // "can be a shopkeeper" pool, ShopShiftManager draws counter personas from
  // these free locals first, only borrowing from other groups when they run out.
  const SHOPKEEPER_POOL_RATIO = 0.4;

  // Farming-compatible trait keywords
  const FARMING_TRAITS = ["farmer", "botanist", "herbalist", "gardener", "rancher", "animal lover", "shepherd"]; // i18n-ignore: Traits.json keywords, matched against the trait name

  // All NPC dialogue text (need-based thought templates, familiar-player and
  // capability-reaction lines, situational + personality thoughts, NPC↔NPC
  // conversation scripts) lives in NPCConversation.js. ThoughtGenerator below
  // delegates to window.NPCConversation.ThoughtProvider at runtime.

  // ============================================================================
  // SHARED UTILITIES (see NPCShared.js)
  // ============================================================================

  // Guard the destructure: NPCShared may not have evaluated yet under some load
  // orders. Sibling call sites already null-check window.NPCShared at call time.
  const { nameHash, Rng: MiniRng } = window.NPCShared || {};

  // Terrain NPCs are never sent to (water tag 3, tag 7), same rule the spawner
  // and the pathfinder in NPCSystem.js apply.
  const isBlockedTerrain = (x, y) => window.NPCShared
    ? window.NPCShared.isBlockedTerrain(x, y)
    : [3, 7].includes($gameMap.terrainTag(x, y));

  // Amounts are stored in gold and shown to the player in euros (100g = 1.00€).
  const fmtMoney = (gold) => window.NPCShared
    ? window.NPCShared.formatMoney(gold)
    : `${gold}g`;

  // Seeded RNG for persistent wealth/inventory drift. Keyed by NPC name, a
  // per-call salt, and the in-game minute, XORed with the world seed, so money
  // earned/spent/gambled is reproducible from the world seed instead of the old
  // raw Math.random() (which made the same world diverge on every run) while
  // still varying minute to minute.
  function economyRng(name, salt, minute) {
    const ws = window.NPCShared ? window.NPCShared.worldSeed() : 19002001;
    const m  = minute === undefined ? ($gameVariables?.value(114) ?? 0) : minute;
    return new MiniRng(nameHash(`${name || "npc"}_${salt}_${m}`) ^ ws);
  }

  // ============================================================================
  // SECTION 1a, ERA TENSION (the road to 2012)
  // ============================================================================
  // As the in-game clock climbs from 2010 toward 2012, the world frays: crime
  // rises and ordinary people grow paranoid and distrustful of the player, with
  // 2012 the peak of the chaos. Returns 0 (calm, <=2010) .. 1 (max chaos,
  // >=2012). Read live from TimeDateSystem so a single number drives both the
  // off-screen society sim (here) and on-map NPC reactions (NPCSystem.js).
  function eraTension() {
    const T = window.TimeDateSystem;
    if (!T || !T.getGameTimeMinutes || !T.getDateTimeFromMinutes) return 0;
    let dt;
    try { dt = T.getDateTimeFromMinutes(T.getGameTimeMinutes()); } catch (_) { return 0; }
    if (!dt) return 0;
    // Fractional year so the slide is smooth month to month, not a yearly step.
    const year = dt.year + (Number(dt.monthNum) - 1) / 12;
    if (year <= ERA_CALM_YEAR)  return 0;
    if (year >= ERA_CHAOS_YEAR) return 1;
    return (year - ERA_CALM_YEAR) / (ERA_CHAOS_YEAR - ERA_CALM_YEAR);
  }

  // ============================================================================
  // SECTION 1, EVENT BUS
  // ============================================================================

  const listeners = {};

  const EventBus = {
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    emit(event, data) {
      (listeners[event] || []).forEach(fn => { try { fn(data); } catch (e) { console.error("[NPCSim] EventBus error:", e); } });
    },
  };

  // ============================================================================
  // SECTION 2, NEED MANAGER
  // ============================================================================
  // Drains hunger and sleep at the same per-minute rates as TimeDateSystem
  // (0.05/step ≈ 3/min at 60 steps/min; 0.03/step ≈ 1.8/min, converted below)

  const HUNGER_DRAIN_PER_MIN  = 0.10;  // slightly faster than player for drama
  const SLEEP_DRAIN_PER_MIN   = 0.06;
  const HYGIENE_DRAIN_PER_MIN = 0.05;
  const SOCIAL_DRAIN_PER_MIN  = 0.03;
  const LEISURE_DRAIN_PER_MIN = 0.03;

  const NeedManager = {
    update(profile, deltaMinutes) {
      if (!profile) return;
      // Settlement episodes bend the drains (world web): epidemics chew
      // through hygiene and isolate people, festivals feed social/leisure.
      const web = window.NPCWorldWeb?.needDrainModifiers?.(profile._homeGroupName);
      const hygieneMul = web?.hygiene ?? 1, socialMul = web?.social ?? 1, leisureMul = web?.leisure ?? 1;
      profile.hunger  = Math.max(0, (profile.hunger  ?? 100) - HUNGER_DRAIN_PER_MIN  * deltaMinutes);
      profile.sleep   = Math.max(0, (profile.sleep   ?? 100) - SLEEP_DRAIN_PER_MIN   * deltaMinutes);
      profile.hygiene = Math.max(0, (profile.hygiene ?? 100) - HYGIENE_DRAIN_PER_MIN * hygieneMul * deltaMinutes);
      profile.social  = Math.max(0, (profile.social  ?? 100) - SOCIAL_DRAIN_PER_MIN  * socialMul  * deltaMinutes);
      profile.leisure = Math.max(0, (profile.leisure ?? 100) - LEISURE_DRAIN_PER_MIN * leisureMul * deltaMinutes);
    },

    feed(profile, calories) {
      profile.hunger = Math.min(100, (profile.hunger ?? 0) + calories * 0.10);
    },
  };

  // ---- Gradual need satisfaction while interacting --------------------------
  // Per-second fill rates applied while an NPC is in the "interacting" state
  // (see NPCSystem.js updateInteracting + window.NPCSim.satisfyNeedTick below).
  // Only needs backed by a numeric profile meter can be filled this way,
  // money/crime/safety/work resolve through their own simulated effects (§5.1
  // of docs/npc_event_interaction_design_en.md) instead of a gradual meter.
  const NEED_FILL_PER_SEC = { hunger: 2.5, sleep: 3, hygiene: 4, social: 2, leisure: 1.5, comfort: 2 };
  const NEED_METER_FIELD  = { hunger: "hunger", sleep: "sleep", hygiene: "hygiene", social: "social", leisure: "leisure", comfort: "leisure" };

  function satisfyNeedTick(npcName, need, deltaSeconds) {
    if (!npcName || !need || deltaSeconds <= 0) return;
    const profile = $gameSystem?._npcSociety?.[npcName];
    if (!profile) return;

    const field = NEED_METER_FIELD[need];
    const rate  = NEED_FILL_PER_SEC[need];
    if (field && rate) {
      profile[field] = Math.min(100, (profile[field] ?? 100) + rate * deltaSeconds);
    }
  }

  // ---- Off-screen need fulfilment -------------------------------------------
  // The background sim decides what each NPC is *doing* every tick
  // (ScheduleManager.evaluate → profile.currentNeed). satisfyNeedTick above
  // only fills meters for NPCs the player is physically interacting with, so
  // without this an off-screen NPC's needs decayed monotonically to 0 and
  // stuck there (the Empathize panel then shows every vital at 0%). This models
  // them actually attending to their current need off-screen: eating when
  // hungry, sleeping when tired, washing, mingling… Rates run well above the
  // passive drain so the attended need climbs back up over a session while the
  // untended four keep drifting down, producing the oscillating meters a living
  // routine should have instead of a flat floor. Non-meter needs (work, money,
  // crime, safety) resolve through their own simulated effects, not a meter.
  const OFFSCREEN_FILL_PER_MIN = {
    hunger: 1.2, sleep: 1.0, hygiene: 1.5, social: 1.0, leisure: 0.8, comfort: 0.8,
  };
  function satisfyNeedOffscreen(profile, need, deltaMinutes) {
    if (!profile || !need || deltaMinutes <= 0) return;
    const field = NEED_METER_FIELD[need];
    const rate  = OFFSCREEN_FILL_PER_MIN[need];
    if (field && rate) {
      profile[field] = Math.min(100, (profile[field] ?? 100) + rate * deltaMinutes);
    }
  }

  // ============================================================================
  // SECTION 3, SCHEDULE MANAGER
  // ============================================================================
  // Priority: sleep > hunger > work > money > crime (rare) > comfort > social > leisure
  // (money/comfort/social are the extended needs from
  //  docs/npc_event_interaction_design_en.md §3.1, they interleave around
  //  the original five rather than replacing them)

  const ScheduleManager = {
    // Deterministic interrupt rolls: seeded per NPC, per in-game day, per hour
    // from the world seed. Previously these need-override checks used raw
    // Math.random(), so the deterministic routine (RoutineManager) was silently
    // overridden by unseeded rolls and the same world evolved differently every
    // run. A single stream per (name, day, hour) makes each hour's decision
    // stable and reproducible while still drifting hour to hour.
    _interruptRng(profile, hour) {
      const name = profile._eventName || "npc";
      const day  = RoutineManager._dayIndex();
      const ws   = window.NPCShared ? window.NPCShared.worldSeed() : 19002001;
      return new MiniRng(nameHash(`${name}_sched_${day}_${Math.floor(hour)}`) ^ ws); // i18n-ignore: rng seed key
    },

    evaluate(profile, hour) {
      if (!profile) return null;
      const rng      = this._interruptRng(profile, hour);
      const sleepy   = (profile.sleep ?? 100) < 20 || hour >= 22 || hour < 6;
      const hungry   = (profile.hunger ?? 100) < 30;
      const grimy    = (profile.hygiene ?? 100) < 30;
      const workHour = this._inWorkHours(profile, hour);
      // Approaching 2012, desperation spreads: the morality bar for turning to
      // crime rises and the urge fires far more often (peaks at 2012).
      const tension  = eraTension();
      const criminal = (profile.moralityScore ?? 0) < (-30 + tension * 40) &&
                       rng.next() < (0.02 + tension * 0.10);

      if (sleepy)   return "sleep";
      if (hungry)   return "hunger";
      if (grimy)    return "hygiene";
      if (workHour) return "work";
      if (this._needsMoney(profile, rng))   return "money";
      if (criminal) return "crime";
      if (this._wantsSafety(profile, rng))  return "safety";
      if (this._wantsComfort(profile, rng)) return "comfort";
      if (this._wantsSocial(profile, rng))  return "social";
      // Nothing urgent is pulling at them, fall back to whatever their
      // personal daily routine has scheduled for this hour (see RoutineManager).
      return RoutineManager.getActivity(profile, hour);
    },

    _inWorkHours(profile, hour) {
      if (!profile.currentJobId || profile.workShift == null) return false;
      return Math.floor(hour / SHIFT_HOURS) === profile.workShift;
    },

    // Below ~5% of their current wealth tier's ceiling, go earn or find money.
    // Reuses WEALTH_THRESHOLDS (section 11a) so the floor scales with tier.
    _needsMoney(profile, rng) {
      const idx  = Math.min(profile.wealthTierBase ?? 0, WEALTH_THRESHOLDS.length - 1);
      const tier = WEALTH_THRESHOLDS[idx];
      const floor = isFinite(tier.max) ? tier.max * 0.05 : 3000;
      return (profile.money ?? 0) < floor && rng.next() < 0.05;
    },

    // Recently caught stealing, or chronically low morality, occasionally
    // looks for somewhere to lay low / stash goods (e.g. a container).
    _wantsSafety(profile, rng) {
      const recentlyCaught = (profile.eventLog || []).slice(0, 5).some(e => e.tag === "theft_caught");
      const veryLowMorality = (profile.moralityScore ?? 0) < -50;
      return (recentlyCaught || veryLowMorality) && rng.next() < 0.05;
    },

    // Has the savings to move up a home tier but hasn't, occasionally seeks
    // out comfort (a rentable room, better furniture...) instead of wandering.
    _wantsComfort(profile, rng) {
      const curIdx = WEALTH_THRESHOLDS.findIndex(t => t.pool === profile.homePoolType);
      const next = WEALTH_THRESHOLDS[curIdx + 1];
      if (!next) return false; // already at the top tier
      return (profile.money ?? 0) >= next.max * 0.5 && rng.next() < 0.03;
    },

    // Their "social" meter has run low (drains passively, refills while
    // chatting/socializing, see NEED_FILL_PER_SEC). Extroverted/social NPCs
    // notice sooner than others.
    _wantsSocial(profile, rng) {
      ensureTraits();
      const traitNames = (profile.traitIds || []).map(id => {
        const d = DataLoader_traits ? DataLoader_traits.find(t => t.id === id) : null;
        return (d?.name || "").toLowerCase();
      });
      const sociable = traitNames.some(n => n.includes("social") || n.includes("extrovert"));
      const threshold = sociable ? 50 : 25;
      return (profile.social ?? 100) < threshold && rng.next() < 0.05;
    },
  };

  // ============================================================================
  // SECTION 3b, ROUTINE MANAGER (personal daily schedules)
  // ============================================================================
  // Builds a full 24-hour activity plan per NPC, regenerated once per in-game
  // day from a seed mixing the NPC's name, the day index, and the world's
  // history seed (window.HistoryManager.getSeed(), see CLAUDE.md §canonical
  // world-RNG root). Routines therefore feel personal, stay internally
  // consistent for a whole day, and drift slightly from one day to the next
  // (a different wake time, a different errand slot…) without ever becoming
  // pure noise. Each slot stores one of the need-ids BehaviorDispatcher
  // already knows how to act on, so the routine plugs straight into the
  // existing evaluate → dispatch → capability-registry pipeline, it only
  // decides what an NPC *intends* to do; acute biological needs (hunger,
  // exhaustion, hygiene, money trouble, crime opportunities…) still cut in
  // and override the plan moment to moment, exactly like a real routine.
  const RoutineManager = {
    _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },

    _dayIndex(offsetDays = 0) {
      const minute = $gameVariables?.value(114) ?? 0;
      return Math.floor(minute / 1440) + offsetDays;
    },

    _isSleepHour(h, wake, bed) {
      // bed < wake: sleep window sits entirely within the same calendar day
      // (e.g. bed=1, wake=6 → asleep 01:00–05:59). Otherwise it wraps past
      // midnight (e.g. bed=23, wake=6 → asleep 23:00–05:59).
      return bed < wake ? (h >= bed && h < wake) : (h >= bed || h < wake);
    },

    _inWorkHours(profile, hour) {
      if (!profile.currentJobId || profile.workShift == null) return false;
      return Math.floor(hour / SHIFT_HOURS) === profile.workShift;
    },

    // True when this NPC is the assigned shift cover/owner for a <Shop>
    // event during the given hour, see ShopShiftManager.assignPersonas,
    // which populates $gameSystem._npcShopAssignments.
    _inShopShift(profile, hour) {
      const assign = $gameSystem?._npcShopAssignments?.[profile?._eventName];
      if (!assign) return false;
      return Math.floor(hour / SHIFT_HOURS) === assign.shift;
    },

    _personalityBias(profile) {
      ensureTraits();
      const names = (profile.traitIds || []).map(id =>
        (DataLoader_traits ? DataLoader_traits.find(t => t.id === id)?.name : "")?.toLowerCase() || ""
      );
      return {
        social:  names.some(n => n.includes("social") || n.includes("extrovert"))  ? 1
               : names.some(n => n.includes("shy") || n.includes("introvert"))     ? -1 : 0,
        leisure: names.some(n => n.includes("lazy") || n.includes("hedonis")) ? 1 : 0,
      };
    },

    // Weighted pick across the "free time" pool, biased by personality and
    // by the NPC's situation, so the plan still reads as *them*, not dice.
    _pickFreeTimeActivity(rng, profile, bias) {
      const w = { leisure: 30, social: 20, comfort: 15, money: 12, crime: 0, shopping: 8 };
      w.social  += bias.social  * 15;
      w.leisure += bias.leisure * 15;
      if ((profile.wealthTierBase ?? 0) <= 1) w.money += 15;
      if ((profile.factionIndex ?? -1) >= 0)  w.social += 10;
      if ((profile.moralityScore ?? 0) < -30) w.crime  += 12;
      // Coin in pocket → more inclined to go shopping (and the richer they are,
      // the more browsing they do).
      if ((profile.money ?? 0) > 300)          w.shopping += 8;
      if ((profile.wealthTierBase ?? 0) >= 2)  w.shopping += 6;

      // The settlement's civic state leans on everyone's plans (world web):
      // crime waves and busts make crime tempting, festivals pull people out,
      // epidemics keep them home.
      const web = window.NPCWorldWeb?.intentBias?.(profile._homeGroupName);
      if (web) {
        w.crime   += web.crime   || 0;
        w.leisure += web.leisure || 0;
        w.social  += web.social  || 0;
        w.money   += web.money   || 0;
      }

      // The slide toward 2012 pushes more people into crime and keeps them from
      // relaxing or mingling out in the open (see eraTension).
      const tension = eraTension();
      if (tension > 0) {
        w.crime   += tension * 30;
        w.leisure -= tension * 8;
        w.social  -= tension * 6;
      }

      let total = 0;
      for (const k in w) total += Math.max(0, w[k]);
      let roll = rng.next() * total;
      for (const k in w) {
        roll -= Math.max(0, w[k]);
        if (roll <= 0) return k;
      }
      return "leisure";
    },

    // Pure function: deterministically builds the 24-slot plan for a given
    // in-game day index, callable for "today", "yesterday", or any day, so
    // the UI can render a rolling 24h retrospective across the date boundary.
    generateForDay(profile, day) {
      const name      = profile?._eventName || "npc";
      const worldSeed = window.HistoryManager ? window.HistoryManager.getSeed() : 19002001;
      const rng       = new MiniRng(nameHash(`${name}_routine_${day}`) ^ worldSeed);
      const bias      = this._personalityBias(profile);

      // Personal anchors wobble by up to ±1h, and the wobble itself is
      // re-rolled every day, so the same NPC's "Tuesday" never looks
      // identical to their "Wednesday".
      const wakeHour  = this._clamp(6 + rng.int(-1, 1), 4, 8);
      const bedHour   = this._clamp(22 + rng.int(-1, 2), 21, 26) % 24;
      const breakfast = this._clamp(wakeHour + rng.int(0, 1), 5, 9);
      const lunch     = this._clamp(12 + rng.int(-1, 1), 11, 14);
      const dinner    = this._clamp(19 + rng.int(-1, 1), 17, 21);

      const routine = new Array(24);
      for (let h = 0; h < 24; h++) {
        if (this._isSleepHour(h, wakeHour, bedHour))           { routine[h] = "sleep";   continue; }
        if (h === breakfast || h === lunch || h === dinner)    { routine[h] = "hunger";  continue; }
        if (h === wakeHour)                                    { routine[h] = "hygiene"; continue; }
        if (this._inShopShift(profile, h))                     { routine[h] = "shopwork"; continue; }
        if (this._inWorkHours(profile, h))                     { routine[h] = "work";    continue; }
        routine[h] = this._pickFreeTimeActivity(rng, profile, bias);
      }
      return routine;
    },

    // Builds (or returns the cached) routine for the NPC's *current* in-game
    // day, this is what ScheduleManager consults every tick.
    ensureRoutine(profile) {
      const day = this._dayIndex();
      if (profile._routineDay !== day || !Array.isArray(profile.routine) || profile.routine.length !== 24) {
        profile.routine     = this.generateForDay(profile, day);
        profile._routineDay = day;
      }
      return profile.routine;
    },

    getActivity(profile, hour) {
      const routine = this.ensureRoutine(profile);
      return routine[this._clamp(Math.floor(hour), 0, 23)] ?? "leisure";
    },

    // ── Display helpers (used by NPCEmpathize's "Routine" panel) ───────────

    // Last 24 hourly slots ending at, and including, the current hour,
    // spanning the day boundary into yesterday's (re-derived, not cached)
    // routine when needed. Oldest first, so the UI can read it top to bottom
    // as "what they've been up to today (and a little before)".
    getLast24Hours(profile) {
      const nowMin     = $gameVariables?.value(114) ?? 0;
      const hourNow    = Math.floor((nowMin % 1440) / 60);
      const today      = this.ensureRoutine(profile);
      const yesterday  = this.generateForDay(profile, this._dayIndex(-1));
      const out = [];
      for (let i = 23; i >= 0; i--) {
        let h = hourNow - i;
        const fromYesterday = h < 0;
        if (fromYesterday) h += 24;
        out.push({ hour: h, activity: (fromYesterday ? yesterday : today)[h], isPast: i > 0 });
      }
      return out; // oldest → newest; last entry is the current hour
    },

    // Remaining slots of today, hour+1 .. 23, "what's still on the books".
    getRestOfDay(profile) {
      const nowMin  = $gameVariables?.value(114) ?? 0;
      const hourNow = Math.floor((nowMin % 1440) / 60);
      const routine = this.ensureRoutine(profile);
      const out = [];
      for (let h = hourNow + 1; h < 24; h++) out.push({ hour: h, activity: routine[h] });
      return out;
    },
  };

  // ============================================================================
  // SECTION 4, JOB MANAGER
  // ============================================================================

  const JobManager = {
    // Looks up (and triggers, if needed) this NPC's slot in the group-wide
    // job-shift roster, see JobShiftManager. Each NPC either lands on one
    // of the group's job positions (job + work map + 8h shift) or becomes
    // jobless (currentJobId = 0, distinct from null/"not yet decided").
    assignJob(profile) {
      // Practising before Eris's bench is not a shift the group roster hands
      // out: ErisTrial pins the Defence Lawyer job onto the world's five
      // advocates, and the roster must never reassign them out of it.
      if (profile._erisLawyerJobLocked) return;

      const groupName = profile._homeGroupName;
      if (!groupName) {
        profile.currentJobId = 0;
        profile.workMapId = null;
        profile.workShift = null;
        return;
      }

      JobShiftManager.ensureGroupAssignments(groupName);
      const assign = $gameSystem._npcJobAssignments?.[profile._eventName];
      if (assign) {
        profile.currentJobId = assign.jobId;
        profile.workMapId    = assign.mapId;
        profile.workShift    = assign.shift;
      } else {
        profile.currentJobId = 0;
        profile.workMapId = null;
        profile.workShift = null;
      }
    },

    getJob(profile) {
      if (!profile.currentJobId || !window.WorkSystem) return null;
      return (window.WorkSystem.Jobs || []).find(j => j.id === profile.currentJobId) || null;
    },

    // Display name of the map where this NPC's job is performed, used by
    // the Empathize "Routine" tab to render "Work as <job> at <map>".
    getJobWorkMapName(profile) {
      const mapId = profile.workMapId;
      if (!mapId) return '';
      if ($gameMap?.mapId() === mapId) return $gameMap.displayName();
      const data = window.NPCSystem?.loadMapData?.(mapId);
      const name = data?.displayName
        || (($dataMapInfos && $dataMapInfos[mapId]) ? $dataMapInfos[mapId].name : T('NPCSim.mapFallback', { id: mapId }));
      return window.translateText ? window.translateText(name) : name;
    },

    simulateShiftPay(profile, npcName) {
      const job = this.getJob(profile);
      if (!job) return;
      // Build a plain stat proxy so WorkSystem.calculateSuccessChance gets standard prop names.
      // Custom stats (Arcane etc.) are not used in success-chance calc for background NPCs.
      const proxy = {
        atk: profile.atk || 0, def: profile.def || 0,
        mat: profile.mat || 0, mdf: profile.mdf || 0,
        agi: profile.agi || 0, luk: profile.luk || 0,
        mhp: profile.mhp || 0, mmp: profile.mmp || 0,
        level: profile.level || 1,
      };
      let chance = 0.7;
      try { chance = window.WorkSystem.calculateSuccessChance(proxy, job); } catch (_) {}
      const _payRng = economyRng(npcName || profile._eventName, "shiftpay");
      const pay = Math.floor((job.basePay || 500) * chance * (0.8 + _payRng.next() * 0.4));
      profile.money = Math.min(MONEY_CAP, (profile.money || 0) + pay);
      profile.hunger = Math.max(0, (profile.hunger || 100) - 10);
      StoryLogger.record(npcName || profile._eventName, "work", 'NPCSim.log.work', { job: job.name, pay: fmtMoney(pay) });

      // Faction job completion → slight reputation gain for NPC's faction
      if (job.factionId !== undefined && profile.factionIndex >= 0 && $gameFactions?.changeReputation) {
        try { $gameFactions.changeReputation(job.factionId, 1); } catch (_) {}
      }
    },
  };

  // Lazy reference to trait data (populated once NPCSociety is ready)
  let DataLoader_traits = null;
  function ensureTraits() {
    if (!DataLoader_traits && window._NPCSocietyDataLoader) {
      DataLoader_traits = window._NPCSocietyDataLoader.traits;
    }
  }

  // ============================================================================
  // SECTION 5, INTERACTION SCANNER
  // ============================================================================

  const InteractionScanner = {
    // One shared per-(sim-tick, map) snapshot of the live events, with each
    // event's name/note lowercased once. All the need-driven scanners below
    // iterate this instead of each re-filtering $gameMap.events() and
    // re-reading every event's name/note on every dispatch. Built lazily on
    // first use per sim tick (keyed by _lastTickMinute); a mid-tick spawn is
    // therefore only picked up on the next tick, matching the sim's per-tick
    // dispatch cadence.
    _tickIndex: null,

    _index() {
      const tick  = _lastTickMinute;
      const mapId = $gameMap ? $gameMap.mapId() : -1;
      const cur = this._tickIndex;
      if (cur && cur.tick === tick && cur.mapId === mapId) return cur.events;
      const events = [];
      if ($gameMap) {
        for (const ev of $gameMap.events()) {
          if (!ev || ev._erased) continue;
          const data = ev.event();
          const name = data?.name || "";
          const note = data?.note || "";
          events.push({ ev, name, nameLower: name.toLowerCase(), note, noteLower: note.toLowerCase() });
        }
      }
      this._tickIndex = { tick, mapId, events };
      return events;
    },

    // filterFn receives a precomputed index record { ev, name, nameLower, note, noteLower }
    _scanEvents(filterFn) {
      if (!$gameMap) return [];
      const out = [];
      for (const rec of this._index()) if (filterFn(rec)) out.push(rec.ev);
      return out;
    },

    findFood() {
      return this._scanEvents(rec => {
        const name = rec.nameLower;
        // Shops are identified by the <Shop> note tag, not the event name.
        return name.includes("vending") || name.includes("food") ||
               !!window.NPCSystem?.hasShopTag?.(rec.note);
      });
    },

    findLeisure() {
      return this._scanEvents(rec => {
        const name = rec.nameLower;
        const note = rec.noteLower;
        return name.includes("arcade") || name.includes("cabinet") || name.includes("vending") ||
               name.includes("plant") || name.includes("animal") || note.includes("<arcade>") ||
               note.includes("<vending>") || $gameMap.regionId(rec.ev.x, rec.ev.y) === 101;
      });
    },

    findAgriculture() {
      return this._scanEvents(rec => {
        const name = rec.nameLower;
        return name === "plant" || name === "animal";
      });
    },

    findWorkLocation(jobName) {
      if (!jobName) return null;
      const kw = jobName.toLowerCase().split(" ")[0];
      const candidates = this._scanEvents(rec => {
        const n = rec.nameLower;
        return n.includes(kw) || n.includes("work") || n.includes("job");
      });
      return candidates[0] || null;
    },

    hasFarmingTrait(profile) {
      if (!profile) return false;
      ensureTraits();
      const traitNames = (profile.traitIds || []).map(id => {
        const d = DataLoader_traits ? DataLoader_traits.find(t => t.id === id) : null;
        return (d?.name || "").toLowerCase();
      });
      return traitNames.some(n => FARMING_TRAITS.some(kw => n.includes(kw)));
    },

    // ---- Capability registry --------------------------------------------
    // Additive lookup table layered on top of the find* methods above.
    // The original four scanners stay the source of truth for the original
    // five needs (sleep/hunger/work/crime/leisure); this registry lets new
    // needs (money, comfort, social, safety) and new systems (cooking
    // stations, containers, rentable rooms...) plug into the same
    // scan → score → dispatch flow without a bespoke find*/handler pair
    // each. See docs/npc_event_interaction_design_en.md §4.1.
    _capabilities: [],

    registerCapability(cap) {
      if (cap && typeof cap.match === "function" && Array.isArray(cap.needs)) {
        this._capabilities.push(cap);
      }
    },

    findByNeed(need, profile) {
      if (!$gameMap) return [];
      const recs = this._index();
      const matches = [];
      for (const cap of this._capabilities) {
        if (!cap.needs.includes(need)) continue;
        for (const rec of recs) {
          if (!cap.match(rec.ev)) continue;
          matches.push({ event: rec.ev, capability: cap, score: cap.weight ? cap.weight(profile, need) : 50 });
        }
      }
      matches.sort((a, b) => b.score - a.score);
      return matches;
    },

    // Events literally named "Steal", pre-placed theft opportunities that
    // low-morality NPCs actively seek out (see BehaviorDispatcher._handleCrime
    // and the SECTION 9b steal handler that resolves the attempt on arrival).
    findStealEvents() {
      return this._scanEvents(rec => rec.nameLower.trim() === "steal");
    },

    // Everything a shopping NPC can walk up to on the current map: every
    // registered shop/vendor event (from the world NPC cache shop index) plus
    // any displayed-goods "Steal" stands. Customers buy/browse these; willing
    // thieves may pilfer the Steal stands (resolved on arrival in SECTION 9b).
    findShopTargets() {
      if (!$gameMap) return [];
      const idx = window.NPCSystem?.getShopIndex?.($gameMap.mapId()) || [];
      const evIds = new Set(idx.map(e => e.eventId));
      return this._scanEvents(rec =>
        evIds.has(rec.ev.eventId()) || rec.nameLower.trim() === "steal");
    },
  };

  // A room for the night. RentSystem reads the name the same loose way (a
  // "Room" is what it is called, whatever else the mapper wrote beside it).
  const ROOM_NAME = /^room\b/;
  function _isRoomEvent(ev) {
    return ROOM_NAME.test((ev?.event()?.name || "").toLowerCase());
  }

  // Register the generic capabilities from the design doc's catalogue (§2).
  // Each ties an event-name/note signature to the need(s) it can satisfy and
  // a 0-100 desirability score (§3.2), higher-scoring matches are preferred.
  InteractionScanner.registerCapability({
    id: "cooking_station",
    needs: ["hunger"],
    match(ev) {
      const n = (ev.event()?.name || "").toLowerCase();
      return n.includes("stove") || n.includes("kitchen") || n.includes("cooking");
    },
    weight(profile) {
      const foodItems = (profile?.itemIds || []).filter(id => {
        const it = $dataItems[id];
        return it && /<Category:\s*Food>/i.test(it.note || "");
      });
      // Only worth the trip if the NPC actually has two ingredients to combine
      return foodItems.length >= 2 ? 60 : 15;
    },
  });

  InteractionScanner.registerCapability({
    id: "container",
    needs: ["money", "safety"],
    match(ev) {
      const n = (ev.event()?.name || "").toLowerCase();
      return n.includes("container") || n.includes("chest") || n.includes("storage");
    },
    weight(profile, need) {
      if (need === "safety") return (profile?.moralityScore ?? 0) < -20 ? 55 : 10;
      return 30;
    },
  });

  InteractionScanner.registerCapability({
    id: "rentable_room",
    needs: ["sleep", "comfort"],
    match: (ev) => _isRoomEvent(ev),
    weight(profile, need) {
      const tier = profile?.wealthTierBase ?? 0;
      if (tier < 1) return 0; // can't afford rent yet, fall back to home/wandering
      return need === "comfort" ? 50 : 45;
    },
  });

  InteractionScanner.registerCapability({
    id: "fast_travel_terminal",
    needs: ["leisure", "social"],
    match(ev) {
      return (ev.event()?.name || "") === "Teleport";
    },
    weight(profile, need) {
      const tier = profile?.wealthTierBase ?? 0;
      if (tier < 1) return 5; // can barely afford fuel/fare, low draw
      return need === "social" ? 25 : 35; // sightseeing slightly favoured over visiting
    },
  });

  InteractionScanner.registerCapability({
    id: "furniture_builder",
    needs: ["comfort", "leisure"],
    match(ev) {
      const n = (ev.event()?.name || "").toLowerCase();
      return n.includes("builder") || n.includes("furniture");
    },
    weight(_profile, need) {
      return need === "comfort" ? 45 : 20;
    },
  });

  InteractionScanner.registerCapability({
    id: "apiary",
    needs: ["money", "leisure"],
    match(ev) {
      const n = (ev.event()?.name || "").toLowerCase();
      return n.includes("apiary") || n.includes("hive");
    },
    weight(profile, need) {
      if (!InteractionScanner.hasFarmingTrait(profile)) return 5;
      return need === "money" ? 40 : 30;
    },
  });

  InteractionScanner.registerCapability({
    id: "bank",
    needs: ["money"],
    match(ev) {
      return (ev.event()?.name || "").toLowerCase().includes("bank");
    },
    weight(profile) {
      const money = profile?.money ?? 0;
      // In the red → seek a loan. Flush → seek a deposit/interest. Either way, draws them in.
      if (money < 100) return 50;
      if (money > 5000) return 35;
      return 10;
    },
  });

  InteractionScanner.registerCapability({
    id: "real_estate_office",
    needs: ["money"],
    match(ev) {
      const n = (ev.event()?.name || "").toLowerCase();
      return n.includes("realestate") || n.includes("property");
    },
    weight(profile) {
      // Only the wealthy bother browsing property listings
      return (profile?.wealthTierBase ?? 0) >= 3 ? 45 : 0;
    },
  });

  InteractionScanner.registerCapability({
    id: "stock_exchange",
    needs: ["money"],
    match(ev) {
      const n = (ev.event()?.name || "").toLowerCase();
      return n.includes("stockmarket") || n.includes("exchange");
    },
    weight(profile) {
      const arcaneOrSubstance = (profile?.arcane ?? 0) + (profile?.substance ?? 0);
      if ((profile?.wealthTierBase ?? 0) < 2 && arcaneOrSubstance < 10) return 0;
      return 40;
    },
  });

  InteractionScanner.registerCapability({
    id: "shop_counter",
    needs: ["leisure", "comfort"],
    // Any event the per-map shop index knows about: <Shop>-tagged counters,
    // standard Shop Processing events, and RandomDailyShop events alike,
    // see NPCSystem.getShopIndex / SECTION 9b's BuyManager.
    match(ev) {
      const name = (ev.event()?.name || "").trim().toLowerCase();
      if (name === "steal") return false; // theft opportunities aren't storefronts
      const idx = window.NPCSystem?.getShopIndex?.($gameMap?.mapId()) || [];
      const evId = ev.eventId();
      return idx.some(e => e.eventId === evId);
    },
    weight(profile) {
      const money = profile?.money ?? 0;
      if (money < 200) return 0; // window shopping isn't worth the trip
      return 35;
    },
  });

  // ---- Event-name → need(s) keyword table -------------------------------
  // Quick-add structure for simple "this event name satisfies these needs"
  // bindings, without writing a bespoke detector/weight pair each time.
  //
  // Matched as KEYWORDS ANYWHERE IN THE NAME rather than as the whole name,
  // because a mapper names the thing, not the need: an exact table found "WC"
  // and missed "WC ornated", "Public Toilet" and "Shower (broken)", which are
  // the same washroom. Short words are held to word boundaries so a Barrel is
  // not a bar, and a stem is spelled with its tail (`bath\w*`) where the
  // longer words are the same object (bathtub, bathhouse).
  //
  // This table is the ONE place both the town's NPCs (BehaviorDispatcher) and
  // a loose party member (Core/AutoIdleExplorer.js) ask what a thing on the
  // map is good for, so teaching one teaches the other.
  const EVENT_NAME_NEEDS = {
    hygiene: /\b(wc|toilet|latrine|lavatory|bathroom|washroom|washbasin|basin|sink|shower|bath\w*|fountain)\b/,
    leisure: /\b(arcade|cabinet|pinball|jukebox|piano|tv|television|radio|billiard\w*|pool table|bowling|slot machine|casino|swing|playground)\b/,
    social:  /\b(pc|phone|bar|pub|tavern|inn|cafe|caffe|canteen|counter)\b/,
    comfort: /\b(bench|chair|stool|sofa|couch|armchair|seat|bed)\b/,
  };

  for (const [need, pattern] of Object.entries(EVENT_NAME_NEEDS)) {
    InteractionScanner.registerCapability({
      id: `named_${need}`,
      needs: [need],
      match(ev) { return pattern.test((ev.event()?.name || "").toLowerCase()); },
      weight() { return 40; },
    });
  }

  // What a name says it is good for, for anything that wants the answer
  // without the scan (the party AI reads it off a single event).
  InteractionScanner.needsOfName = function (name) {
    const n = String(name || "").toLowerCase();
    const out = [];
    for (const [need, pattern] of Object.entries(EVENT_NAME_NEEDS)) {
      if (pattern.test(n)) out.push(need);
    }
    return out;
  };

  // ============================================================================
  // SECTION 6, BEHAVIOUR DISPATCHER
  // ============================================================================

  const BehaviorDispatcher = {
    dispatch(controller, profile) {
      if (!controller || !profile) return;
      if (!controller.event || controller.event._erased) return;

      // Don't interrupt talking state
      if (controller.state === "talkingToPlayer") return;

      const need = profile.currentNeed;

      // Prevent spam, only switch state when need changed
      if (controller._lastDispatchedNeed === need) return;
      controller._lastDispatchedNeed = need;

      switch (need) {
        case "sleep":   this._handleSleep(controller, profile);   break;
        case "hunger":  this._handleHunger(controller, profile);  break;
        case "hygiene": this._handleHygiene(controller, profile); break;
        case "work":    this._handleWork(controller, profile);    break;
        case "money":   this._handleMoney(controller, profile);   break;
        case "crime":   this._handleCrime(controller, profile);   break;
        case "safety":  this._handleSafety(controller, profile);  break;
        case "comfort": this._handleComfort(controller, profile); break;
        case "social":  this._handleSocial(controller, profile);  break;
        case "shopping":this._handleShopping(controller, profile);break;
        case "leisure": this._handleLeisure(controller, profile); break;
      }
    },

    // Generic helper for the new, registry-backed needs (§4.2 of the design
    // doc): ask the capability registry for the best-scoring nearby match,
    // announce it on the bus, and walk over. Falls back to an existing
    // handler when nothing recognisable is in range, so behaviour degrades
    // to what NPCs already did before this need existed.
    _handleViaRegistry(controller, profile, need, fallback) {
      const best = InteractionScanner.findByNeed(need, profile)[0];
      if (best && best.score > 0) {
        EventBus.emit("npc:capability_start", {
          name: controller.eventName, capabilityId: best.capability.id, eventRef: best.event,
        });
        controller.goInteract(best.event, need);
        return true;
      }
      if (fallback) fallback.call(this, controller, profile);
      return false;
    },

    _handleSleep(controller) {
      // Prefer region 102 rest tiles over home/fallback. Uses the cached
      // map-wide rest-tile list, filtered to the same ±20 box the old
      // per-dispatch sweep covered.
      if (controller.event) {
        const cx = controller.event.x, cy = controller.event.y;
        const restTiles = _restTilesForMap().filter(t =>
          Math.abs(t.x - cx) <= 20 && Math.abs(t.y - cy) <= 20);
        if (restTiles.length) {
          const t = restTiles[Math.floor(Math.random() * Math.min(restTiles.length, 10))];
          controller.goToTile(t.x, t.y, "goingToZone", 120000);
          return;
        }
      }
      // Walk to the NPC's assigned building door if it's on the current map
      const profile = $gameSystem?._npcSociety?.[controller.eventName];
      const homeBuilding = profile?.homeBuilding;
      if (homeBuilding && homeBuilding.mapId === $gameMap?.mapId()) {
        controller.goToTile(homeBuilding.x, homeBuilding.y, "goingHome", 120000);
        return;
      }
      // Prefer a Door/House event as the "home" destination
      const homeEvent = this._findHomeEvent(controller);
      if (homeEvent) {
        controller.goToTile(homeEvent.x, homeEvent.y, "goingHome", 120000);
        return;
      }
      // Fallback: walk to a quiet corner of the map
      const tiles = $gameMap ? findPassable() : [];
      if (tiles.length) {
        const t = tiles[Math.floor(Math.random() * Math.min(tiles.length, 20))];
        controller.goToTile(t.x, t.y, "goingHome", 120000);
      } else {
        controller.state = "sleeping";
        controller.stateEndTime = performance.now() + 60000;
        if (controller.event) controller.event.setOpacity(120);
      }
    },

    _findHomeEvent(controller) {
      if (!$gameMap) return null;
      // Look for any Door / House transfer event on the current map
      const homeNames = ["door", "house", "home", "transfer", "exit"];
      const candidates = InteractionScanner._scanEvents(rec => {
        if (rec.ev === controller.event) return false;
        return homeNames.some(kw => rec.nameLower.includes(kw));
      });
      if (!candidates.length) return null;
      // Pick the one closest to the NPC
      if (!controller.event) return candidates[0];
      candidates.sort((a, b) => {
        const da = Math.abs(a.x - controller.event.x) + Math.abs(a.y - controller.event.y);
        const db = Math.abs(b.x - controller.event.x) + Math.abs(b.y - controller.event.y);
        return da - db;
      });
      return candidates[0];
    },

    _handleHunger(controller, profile) {
      const foodSources = InteractionScanner.findFood();
      if (!foodSources.length) return;
      const target = foodSources[Math.floor(Math.random() * foodSources.length)];
      controller.goInteract(target, "hunger");
    },

    // WC/Sink (registered via EVENT_NAME_NEEDS), no fallback: if there's
    // nothing to wash up with nearby, the NPC just keeps going about its day.
    _handleHygiene(controller, profile) {
      this._handleViaRegistry(controller, profile, "hygiene", null);
    },

    _handleWork(controller, profile) {
      const job = JobManager.getJob(profile);
      if (!job) return; // jobless NPCs have nothing to dispatch to

      // An NPC can only be found working on their assigned job map (see
      // JobShiftManager). If the current map isn't that one, leave them be,
      // their shift is simulated off-screen in the main tick instead.
      if (profile.workMapId && profile.workMapId !== $gameMap?.mapId()) return;

      const workSpot = InteractionScanner.findWorkLocation(job.name || "");
      if (workSpot) {
        // goToTile sets state=goingToWork, which on arrival transitions to working
        controller.goToTile(workSpot.x, workSpot.y, "goingToWork", 300000);
      }
      // If no physical work location found, shift is simulated off-screen in tick
    },

    _handleCrime(controller, profile) {
      if (Math.random() > 0.3) return; // throttle
      // Low-morality NPCs case the map for "Steal"-named events and walk
      // right up to the goods before making the attempt, the SECTION 9b
      // steal handler resolves the theft when they arrive. Maps without any
      // fall back to the abstract on-the-spot shoplifting roll.
      const stealTargets = InteractionScanner.findStealEvents();
      if (stealTargets.length && (profile.moralityScore ?? 0) < -30) {
        const ev = controller.event;
        stealTargets.sort((a, b) =>
          (Math.abs(a.x - ev.x) + Math.abs(a.y - ev.y)) - (Math.abs(b.x - ev.x) + Math.abs(b.y - ev.y)));
        const target = stealTargets[0];
        const wanted = CrimeManager.peekStealItem(target);
        _emitCrimeThought(profile, "intent", wanted?.data?.name);
        controller.goInteract(target, "crime");
        return;
      }
      CrimeManager.attemptTheft(controller, profile);
    },

    // ---- Extended needs (docs/npc_event_interaction_design_en.md §3.1) ----
    // All routed through the registry; each falls back to whatever the NPC
    // would have done before this need existed, so a map with no recognised
    // capability events behaves exactly as it did previously.

    _handleMoney(controller, profile) {
      this._handleViaRegistry(controller, profile, "money", this._handleWork);
    },

    _handleSafety(controller, profile) {
      this._handleViaRegistry(controller, profile, "safety", null);
    },

    _handleComfort(controller, profile) {
      this._handleViaRegistry(controller, profile, "comfort", this._handleLeisure);
    },

    _handleSocial(controller, profile) {
      // Social zones (region 101) are already covered by findLeisure(); the
      // registry only adds destinations like rentable rooms for "go visit".
      this._handleViaRegistry(controller, profile, "social", this._handleLeisure);
    },

    _handleLeisure(controller, profile) {
      // Check agriculture first if NPC has farming trait
      if (InteractionScanner.hasFarmingTrait(profile)) {
        const crops = InteractionScanner.findAgriculture();
        if (crops.length) {
          controller.goInteract(crops[0], "farm");
          return;
        }
      }
      const spots = InteractionScanner.findLeisure();
      if (spots.length) {
        const target = spots[Math.floor(Math.random() * spots.length)];
        controller.goInteract(target, "leisure");
      }
    },

    // Shopping: walk up to a registered shop/vendor event (or a displayed-goods
    // "Steal" stand) and interact. On arrival the npc:interact listeners resolve
    // it, a purchase (with a buy thought), window-shopping (a browse thought),
    // or, for willing thieves only, a theft attempt. Falls back to leisure when
    // the map has nothing to shop at.
    _handleShopping(controller, profile) {
      const targets = InteractionScanner.findShopTargets();
      if (!targets.length) return this._handleLeisure(controller, profile);
      const ev = controller.event;
      if (!ev) return;
      targets.sort((a, b) =>
        (Math.abs(a.x - ev.x) + Math.abs(a.y - ev.y)) - (Math.abs(b.x - ev.x) + Math.abs(b.y - ev.y)));
      const target = targets[Math.floor(Math.random() * Math.min(targets.length, 3))];
      controller.goInteract(target, "shopping");
    },
  };

  // ============================================================================
  // SECTION 3c, ACTIVITY PLACER (instant in-progress placement on map load)
  // ============================================================================
  // When a map loads, NPCs shouldn't appear to "spawn idle" and only start
  // wandering toward their routine afterward, they should already look like
  // they're mid-activity, the way a real town feels lived-in the moment you
  // walk into it. This scans freshly-spawned controllers, asks the existing
  // need/routine pipeline what each NPC *should* be doing right now, and (if a
  // suitable nearby event exists) teleports them adjacent to it in the
  // "interacting" state, reusing the very same capability registry and need
  // vocabulary as the live simulation, just skipping the travel time once.
  const ActivityPlacer = {
    placeOnMapLoad() {
      if (!$gameMap || !$gameSystem?._npcSociety) return;
      const hour = $gameVariables?.value(23) ?? 12;
      const controllers = $gameSystem.getActiveNPCControllers?.() || [];
      for (const ctrl of controllers) {
        if (!ctrl || ctrl.state !== "idle") continue;
        const profile = $gameSystem._npcSociety[ctrl.eventName];
        if (!profile) continue;
        ensureSimFields(profile, ctrl.eventName);
        const need = ScheduleManager.evaluate(profile, hour);
        profile.currentNeed = need;
        // NPCSystem.spawnAssignedNPCs already dropped this NPC back at their
        // remembered spot when one existed (see captureNPCGroupMemory/
        // recallNPCSpot), so _tryParkAt's nearest-candidate search naturally
        // re-resumes the same activity they were last seen doing, and
        // properly sets up state/target/animation via goInteractNow, instead
        // of leaving the controller stuck "idle" beside an event it's
        // supposedly interacting with.
        this._tryParkAt(ctrl, profile, need);
      }
    },

    _tryParkAt(controller, profile, need) {
      // Sleep/idle needs are already handled by each controller's normal
      // "go home and rest" logic the moment it starts updating, placing it
      // here would just fight that decision a tick later.
      if (!need || need === "sleep") return;
      const candidates = InteractionScanner.findByNeed?.(need, profile) || [];
      const best = candidates[0];
      if (!best || !best.event || (best.score ?? 0) <= 0) return;
      if (typeof controller.goInteractNow === "function") {
        controller.goInteractNow(best.event, need);
      }
    },
  };


  // All passable REST_REGION (102) tiles on the current map, scanned once and
  // cached per mapId (same pattern as MapManager.getMapZones' zone cache).
  // Region + tile passability are static per map, so a single full sweep
  // replaces _handleSleep's 41x41 per-dispatch findRegionTiles sweep.
  let _restTilesCache = null;
  function _restTilesForMap() {
    if (!$gameMap) return [];
    const mapId = $gameMap.mapId();
    if (_restTilesCache && _restTilesCache.mapId === mapId) return _restTilesCache.tiles;
    const tiles = [];
    const w = $gameMap.width(), h = $gameMap.height();
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if ($gameMap.regionId(x, y) === REST_REGION && $gameMap.isPassable(x, y, 2)
            && !isBlockedTerrain(x, y)) tiles.push({ x, y });
      }
    }
    _restTilesCache = { mapId, tiles };
    return tiles;
  }

  // findPassable: returns a small sample of passable tiles near the map centre.
  // Deliberately bounded to avoid scanning every tile on large maps.
  function findPassable() {
    if (!$gameMap) return [];
    const cx = Math.floor($gameMap.width()  / 2);
    const cy = Math.floor($gameMap.height() / 2);
    const RADIUS = 12;
    const result = [];
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const x = cx + dx, y = cy + dy;
        if ($gameMap.isValid(x, y) && $gameMap.isPassable(x, y, 2) && !isBlockedTerrain(x, y)) {
          result.push({ x, y });
        }
      }
    }
    return result;
  }

  // ============================================================================
  // SECTION 7, AGRICULTURE HANDLER (npc:interact events)
  // ============================================================================

  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    if (!targetEvent) return;
    const evName = (targetEvent.event()?.name || "").toLowerCase();
    const mapId  = $gameMap?.mapId();
    const evId   = targetEvent.eventId();

    if (evName === "plant" && window.PlantGrowthSystem) {
      try {
        window.PlantGrowthSystem.updateGrowth(mapId, evId);
        const rec = window.PlantGrowthSystem.getRecord(mapId, evId);
        if (rec && rec.stage === 3) {
          // Harvest
          const profile = $gameSystem?._npcSociety?.[name];
          if (profile) {
            StoryLogger.record(name, "farm", 'NPCSim.log.harvested');
          }
        }
      } catch (_) {}
    }

    if (evName === "animal" && window.AnimalGrowthSystem) {
      try {
        const rec = window.AnimalGrowthSystem.getRecord(mapId, evId);
        if (rec && window.AnimalGrowthSystem.hasReadyProduce) {
          const def = window.AnimalGrowthSystem.ANIMAL_DB?.[rec.animalId];
          if (def && window.AnimalGrowthSystem.hasReadyProduce(rec, def)) {
            StoryLogger.record(name, "farm", 'NPCSim.log.animalProduce');
          }
        }
      } catch (_) {}
    }
  });

  // ============================================================================
  // SECTION 8, CRIME MANAGER
  // ============================================================================

  const CrimeManager = {
    // Steal chance for an item, normalized to 0..1 (StealCalculator returns
    // a 5..95 percentage), scaled by the settlement's civic state.
    _stealChance(profile, itemData) {
      const agility = (profile.skillIds?.length || 0) * 5;
      let chance = 0.3;
      try { chance = window.StealCalculator.calculateStealChance(itemData, agility) / 100; } catch (_) {}
      // Crackdowns make theft harder, neglected towns easier (world web).
      chance *= window.NPCWorldWeb?.theftSuccessModifier?.(profile._homeGroupName) ?? 1;
      return chance;
    },

    // Items reachable through a specific event, shop goods when it carries
    // shop commands (passing the event's own coords so daily-shop proximity
    // gating always resolves), seeded pocket litter otherwise (the same
    // fallback the player pickpocket flow uses).
    stealableItems(targetEvent) {
      if (!window.ShopScanner || !targetEvent) return [];
      let items = [];
      try { items = window.ShopScanner.extractShopItems(targetEvent, targetEvent.x, targetEvent.y) || []; } catch (_) {}
      if (!items.length) {
        try { items = window.ShopScanner.generateNPCItems(targetEvent) || []; } catch (_) {}
      }
      return items.filter(i => i?.data);
    },

    // What an NPC would go for at this Steal spot, used for "I want to
    // steal X" intent thoughts before they've even walked over.
    peekStealItem(targetEvent) {
      return this.stealableItems(targetEvent)[0] ?? null;
    },

    // Shared outcome bookkeeping. Success pockets the item; getting caught
    // goes on the NPC's *own* criminal record and bounty (NPCLifeSim),
    // never the player's crime sheet (Variable 66), which an earlier
    // version wrongly raised here.
    _resolveTheft(name, profile, item, chance) {
      const itemName = item.data?.name || T('NPCSim.anItem');
      // Seeded roll: the outcome mutates persisted profile.itemIds, so it must
      // be reproducible from the world seed, not raw Math.random().
      const rng = economyRng(name, "theft_" + (item.id ?? 0));
      if (rng.next() < chance) {
        profile.itemIds = profile.itemIds || [];
        profile.itemIds.push(item.id);
        StoryLogger.record(name, "theft_success", 'NPCSim.log.stole', { item: itemName });
        profile.moralityScore = Math.max(-100, (profile.moralityScore || 0) - 2);
        _emitCrimeThought(profile, "success", itemName);
      } else {
        profile.moralityScore = Math.max(-100, (profile.moralityScore || 0) - 5);
        StoryLogger.record(name, "theft_caught", 'NPCSim.log.caughtStealing', { item: itemName });
        _emitCrimeThought(profile, "caught", itemName);
        const minute = $gameVariables ? $gameVariables.value(114) : 0;
        try { window.NPCLifeSim?.addLiveCrime?.(name, "shoplifting", minute); } catch (_) {}

        // Caught crime → faction loses reputation
        if (profile.factionIndex >= 0 && $gameFactions?.changeReputation) {
          try { $gameFactions.changeReputation(profile.factionIndex, -2); } catch (_) {}
        }
      }
    },

    // Abstract on-the-spot shoplifting against whatever the map's shops
    // carry, used when there's no walkable "Steal" event to case.
    attemptTheft(controller, profile) {
      if (!window.ShopScanner || !window.StealCalculator) return;
      let goods = [];
      try { goods = window.ShopScanner.scanMapForShops() || []; } catch (_) {}
      const items = goods.filter(i => i?.data && i.data.price > 0 && i.data.price < 500);
      if (!items.length) return;

      const item = items[Math.floor(Math.random() * items.length)];
      this._resolveTheft(controller.eventName, profile, item, this._stealChance(profile, item.data));
    },

    // Resolves an NPC's theft attempt against the "Steal" event they walked
    // up to (dispatched from the SECTION 9b interact handler).
    attemptTheftFromEvent(name, profile, targetEvent) {
      if (!window.StealCalculator) return;
      const items = this.stealableItems(targetEvent);
      if (!items.length) return;
      const item = items[Math.floor(Math.random() * items.length)];
      this._resolveTheft(name, profile, item, this._stealChance(profile, item.data));
    },
  };

  // Pushes a crime-flavored thought ("I want that X" / "stole X" / "caught")
  // through the same pipeline as every other NPC thought.
  function _emitCrimeThought(profile, kind, itemName) {
    if (!profile) return;
    const t = window.NPCConversation?.ThoughtProvider?.crimeThought?.(profile, kind, itemName);
    if (t) ThoughtGenerator._push(profile, t);
  }

  // Pushes a personality-flavored opinion about a shop item through the same
  // bubble pipeline. kind: 'buy' (just purchased) | 'browse' (eyeing it).
  function _emitItemThought(profile, itemData, kind) {
    if (!profile || !itemData) return;
    const t = window.NPCConversation?.ThoughtProvider?.itemThought?.(profile, itemData, kind);
    if (t) ThoughtGenerator._push(profile, t);
  }

  // ============================================================================
  // SECTION 9, SHOPPING (hunger fulfillment via shops)
  // ============================================================================

  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evData = targetEvent?.event();
    const evName = (evData?.name || "").toLowerCase();
    // Shops are matched by the <Shop> note tag, not the event name.
    if (!evName.includes("vending") && !window.NPCSystem?.hasShopTag?.(evData?.note || "")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) return;

    // Simulate buying the cheapest food item
    const foodItems = ($dataItems || []).filter(i => i && /<Category:\s*Food>/i.test(i.note || ""));
    if (!foodItems.length) return;
    foodItems.sort((a, b) => a.price - b.price);
    const cheap = foodItems[0];
    if (profile.money >= cheap.price) {
      profile.money -= cheap.price;
      const cal = parseInt((cheap.note || "").match(/<calories:\s*(\d+)>/i)?.[1] || "20");
      NeedManager.feed(profile, cal);
      StoryLogger.record(name, "shopping", 'NPCSim.log.bought', { item: cheap.name, price: fmtMoney(cheap.price) });
    }
  });

  // Award pay when NPC finishes a work shift
  EventBus.on("npc:shift_end", ({ name }) => {
    const profile = $gameSystem?._npcSociety?.[name];
    if (profile) JobManager.simulateShiftPay(profile, name);
  });

  // ============================================================================
  // SECTION 9b, BUYING & STEAL EVENTS (general shop purchases, theft spots)
  // ============================================================================
  // NPCs with money buy from *any* shop-like event the per-map shop index
  // knows about, <Shop>-tagged persona counters, standard Shop Processing
  // events, and RandomDailyShop events alike. Goods come from the same
  // extraction path the player stealing system uses (ShopScanner), priced
  // from the database; stock is never decreased (it's command data, not
  // inventory). Buying from a staffed <Shop> counter warms the relationship
  // between the buyer and whichever persona is on shift right now.

  // Symmetric opinion adjustment between two named NPCs, mirrors the
  // relationships shape used across NPCSociety/NPCConversation
  // ({ opinion, meetCount }), creating missing profiles on demand.
  function bumpMutualOpinion(nameA, nameB, delta) {
    if (!nameA || !nameB || nameA === nameB) return;
    for (const [self, other] of [[nameA, nameB], [nameB, nameA]]) {
      const profile = window.NPCSocietyRegistry?.ensureProfile?.(self)
        ?? $gameSystem?._npcSociety?.[self];
      if (!profile) continue;
      profile.relationships = profile.relationships || {};
      const rel = profile.relationships[other] || { meetCount: 0, opinion: 0 };
      rel.opinion   = Math.max(-100, Math.min(100, (rel.opinion ?? 0) + delta));
      rel.meetCount = Math.min((rel.meetCount ?? 0) + 1, 999);
      profile.relationships[other] = rel;
    }
  }

  const BuyManager = {
    BUY_COOLDOWN_MIN: 60, // game minutes between purchases per NPC

    isShopIndexed(targetEvent) {
      const idx = window.NPCSystem?.getShopIndex?.($gameMap?.mapId()) || [];
      const evId = targetEvent.eventId();
      return idx.some(e => e.eventId === evId);
    },

    tryBuy(name, profile, targetEvent) {
      if (!window.ShopScanner) return;

      // The event's own coordinates always satisfy the daily-shop proximity
      // gate, so goods resolve no matter where the player is standing.
      let goods = [];
      try { goods = window.ShopScanner.extractShopItems(targetEvent, targetEvent.x, targetEvent.y) || []; } catch (_) {}
      goods = goods.filter(i => i?.data && i.data.price > 0);
      if (!goods.length) return;

      const minute = $gameVariables?.value(114) ?? 0;
      const money  = profile.money ?? 0;
      const onCooldown = minute - (profile._lastBuyMinute ?? -Infinity) < this.BUY_COOLDOWN_MIN;
      const affordable = goods.filter(i => i.data.price <= money * 0.5);
      const _buyRng = economyRng(name, "buy", minute);

      if (!onCooldown && money > 0 && affordable.length) {
        const pick = affordable[Math.floor(_buyRng.next() * affordable.length)];
        profile._lastBuyMinute = minute;
        profile.money = Math.max(0, money - pick.data.price);
        profile.itemIds = profile.itemIds || [];
        profile.itemIds.push(pick.id);
        StoryLogger.record(name, "shopping", 'NPCSim.log.bought', { item: pick.data.name, price: fmtMoney(pick.data.price) });
        // Personality-flavored reaction to the new purchase (shown as a bubble).
        _emitItemThought(profile, pick.data, "buy");

        // A sale warms the buyer ↔ shopkeeper relationship. Whoever is behind
        // the counter: the covering persona on a rota till, otherwise the
        // event's own keeper (a Shop event with a face of its own is one
        // named person, always on duty), provided they are a real citizen.
        const persona = ShopShiftManager.getActivePersona($gameMap.mapId(), targetEvent.eventId());
        const keeper  = persona?.name || (targetEvent.event()?.name || "").trim();
        if (keeper && keeper !== name && $gameSystem?._npcSociety?.[keeper]) {
          bumpMutualOpinion(name, keeper, 2);
        }
        EventBus.emit("npc:capability_end", {
          name, capabilityId: "shop_counter",
          outcome: { itemGain: pick.id, cost: pick.data.price },
        });
        return;
      }

      // Didn't buy (broke, everything too dear, or bought recently), window
      // shop instead: form an opinion about a displayed item.
      const item = goods[Math.floor(_buyRng.next() * goods.length)];
      _emitItemThought(profile, item.data, "browse");
    },
  };

  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    if (!targetEvent) return;
    const evName = (targetEvent.event()?.name || "").trim().toLowerCase();
    if (evName === "steal") return; // theft spots resolve below, never as purchases
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) return;
    if (!BuyManager.isShopIndexed(targetEvent)) return;
    BuyManager.tryBuy(name, profile, targetEvent);
  });

  // "Steal"-named events (displayed goods): when an NPC walks up to one, what
  // happens depends on their morality. A willing thief (morality < -30) makes
  // a theft attempt, failure lands on their own criminal record / bounty via
  // CrimeManager. A law-abiding customer doesn't take anything; they just look
  // the item over and form a personality-flavored opinion about it (bubble).
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    if (!targetEvent) return;
    if ((targetEvent.event()?.name || "").trim().toLowerCase() !== "steal") return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) return;
    if ((profile.moralityScore ?? 0) < -30) {
      CrimeManager.attemptTheftFromEvent(name, profile, targetEvent);
    } else {
      const item = CrimeManager.peekStealItem(targetEvent);
      if (item?.data) _emitItemThought(profile, item.data, "browse");
    }
  });

  // ============================================================================
  // SECTION 9a, CAPABILITY SIMULATIONS (cooking, containers, rentals)
  // ============================================================================
  // "Safe execution" per docs/npc_event_interaction_design_en.md §5.1: rather
  // than calling the player-facing plugin commands (which open scenes and
  // mutate $gameParty), each listener replicates that command's documented
  // effect directly on the NPC's own profile, exactly like JobManager /
  // CrimeManager / the SECTION 9 shopping handler already do off-screen.

  function _foodNote(item, key, fallback) {
    return parseInt((item?.note || "").match(new RegExp(`<${key}:\\s*(\\d+)>`, "i"))?.[1] || fallback);
  }

  // Cooking station: combine two carried food items using CookingSystem's
  // documented formula (first item's calories ×2, plus the second's), see
  // CookingSystem.js:222-241, then feed the NPC and discard the ingredients.
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evName = (targetEvent?.event()?.name || "").toLowerCase();
    if (!evName.includes("stove") && !evName.includes("kitchen") && !evName.includes("cooking")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) return;

    const foodIds = (profile.itemIds || []).filter(id => {
      const it = $dataItems[id];
      return it && /<Category:\s*Food>/i.test(it.note || "");
    });
    if (foodIds.length < 2) return;

    const [id1, id2] = foodIds;
    const item1 = $dataItems[id1], item2 = $dataItems[id2];
    const totalCalories = _foodNote(item1, "calories", "20") * 2 + _foodNote(item2, "calories", "20");

    const removeOnce = id => { const i = profile.itemIds.indexOf(id); if (i >= 0) profile.itemIds.splice(i, 1); };
    removeOnce(id1);
    removeOnce(id2);

    NeedManager.feed(profile, totalCalories);
    StoryLogger.record(name, "cooking", 'NPCSim.log.cooked', { a: item1.name, b: item2.name });
    EventBus.emit("npc:capability_end", { name, capabilityId: "cooking_station", outcome: { hungerGain: totalCalories * 0.10 } });
  });

  // Container: NPC searches it for spare valuables. Outcome is bounded and
  // morality-gated so this can't become a free, repeatable money faucet,
  // it mirrors CrimeManager.attemptTheft's bookkeeping (item gain + morality
  // delta + story log) rather than ContainerSystem's player loot-roll UI.
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evName = (targetEvent?.event()?.name || "").toLowerCase();
    if (!evName.includes("container") && !evName.includes("chest") && !evName.includes("storage")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile || (profile.moralityScore ?? 0) >= -20) return; // only NPCs willing to rummage through others' property

    const _rummageRng = economyRng(name, "container");
    if (_rummageRng.next() < 0.4) {
      const found = 50 + Math.floor(_rummageRng.next() * 200);
      profile.money = Math.min(MONEY_CAP, (profile.money || 0) + found);
      StoryLogger.record(name, "shopping", 'NPCSim.log.foundInContainer', { amount: fmtMoney(found) });
      EventBus.emit("npc:capability_end", { name, capabilityId: "container", outcome: { moneyGain: found } });
    }
  });

  // Rentable room: a paid night, taken through RentSystem itself rather than
  // simulated beside it. The room has to actually be FREE (the party may be in
  // it, or another NPC may have taken it an hour ago) and the NPC pays the
  // price that room asks, out of their own purse. Taking it puts it off the
  // market for the night, so a town with three beds cannot put a hundred
  // people up in them.
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    if (!_isRoomEvent(targetEvent)) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile || !window.RentSystem) return;

    const mapId = $gameMap?.mapId();
    const eventId = targetEvent.eventId();
    const price = window.RentSystem.priceOf(mapId, eventId);
    if (!window.RentSystem.isFree(mapId, eventId)) return;
    if ((profile.money ?? 0) < price) return;
    if (!window.RentSystem.rentForNPC(name, mapId, eventId, profile.money)) return;

    profile.money -= price;
    profile.sleep = 100;
    StoryLogger.record(name, "renting", 'NPCSim.log.rentedRoom', { price: fmtMoney(price) });
    EventBus.emit("npc:capability_end", { name, capabilityId: "rentable_room", outcome: { sleepGain: 100, cost: price } });
  });

  // Apiary: farming-trait NPCs sell off a batch of honey/wax, mirrors
  // ApiarySystem's produce-collection loop, bounded to a small lump sum.
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evName = (targetEvent?.event()?.name || "").toLowerCase();
    if (!evName.includes("apiary") && !evName.includes("hive")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile || !InteractionScanner.hasFarmingTrait(profile)) return;

    const earned = 30 + Math.floor(economyRng(name, "apiary").next() * 90);
    profile.money = Math.min(MONEY_CAP, (profile.money || 0) + earned);
    StoryLogger.record(name, "beekeeping", 'NPCSim.log.soldHoney', { amount: fmtMoney(earned) });
    EventBus.emit("npc:capability_end", { name, capabilityId: "apiary", outcome: { moneyGain: earned } });
  });

  // Bank: broke NPCs take out a small loan, flush NPCs make a deposit and
  // collect interest later, mirrors BankLoanSystem's two-sided pockets
  // without opening the player-facing menu.
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evName = (targetEvent?.event()?.name || "").toLowerCase();
    if (!evName.includes("bank")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) return;

    const money = profile.money ?? 0;
    if (money < 100) {
      const loan = 150 + Math.floor((profile.wealthTierBase ?? 0) * 50);
      profile.money = Math.min(MONEY_CAP, money + loan);
      StoryLogger.record(name, "banking", 'NPCSim.log.tookLoan', { amount: fmtMoney(loan) });
      EventBus.emit("npc:capability_end", { name, capabilityId: "bank", outcome: { moneyGain: loan, loan: true } });
    } else if (money > 5000) {
      const deposit = Math.floor(money * 0.2);
      profile.money -= deposit;
      StoryLogger.record(name, "banking", 'NPCSim.log.deposited', { amount: fmtMoney(deposit) });
      EventBus.emit("npc:capability_end", { name, capabilityId: "bank", outcome: { moneyLoss: deposit, deposit: true } });
    }
  });

  // Real estate office: wealthy NPCs collect passive rental income,
  // mirrors RealEstateMarket.checkDailyIncome's payout without the menu UI.
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evName = (targetEvent?.event()?.name || "").toLowerCase();
    if (!evName.includes("realestate") && !evName.includes("property")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile || (profile.wealthTierBase ?? 0) < 3) return;

    const income = 100 + Math.floor((profile.wealthTierBase ?? 0) * 80 * economyRng(name, "realty").next());
    profile.money = Math.min(MONEY_CAP, (profile.money || 0) + income);
    StoryLogger.record(name, "realty", 'NPCSim.log.rentalIncome', { amount: fmtMoney(income) });
    EventBus.emit("npc:capability_end", { name, capabilityId: "real_estate_office", outcome: { moneyGain: income } });
  });

  // Stock exchange: a speculative trade, mirrors StockMarketSystem's
  // share-price swings as a single bounded win/loss roll, gated to NPCs
  // with the means or aptitude (wealth tier, or arcane/substance stats).
  EventBus.on("npc:interact", ({ name, targetEvent }) => {
    const evName = (targetEvent?.event()?.name || "").toLowerCase();
    if (!evName.includes("stockmarket") && !evName.includes("exchange")) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) return;
    const arcaneOrSubstance = (profile.arcane ?? 0) + (profile.substance ?? 0);
    if ((profile.wealthTierBase ?? 0) < 2 && arcaneOrSubstance < 10) return;

    const stake = 50 + Math.floor((profile.wealthTierBase ?? 0) * 100);
    if ((profile.money ?? 0) < stake) return;
    const _stockRng = economyRng(name, "stock");
    const gain = _stockRng.next() < 0.5;
    const amount = Math.floor(stake * (0.2 + _stockRng.next() * 0.6));
    profile.money = Math.min(MONEY_CAP, Math.max(0, (profile.money || 0) + (gain ? amount : -amount)));
    StoryLogger.record(name, "investing", gain ? 'NPCSim.log.stocksGain' : 'NPCSim.log.stocksLoss', { amount: fmtMoney(amount) });
    EventBus.emit("npc:capability_end", { name, capabilityId: "stock_exchange", outcome: gain ? { moneyGain: amount } : { moneyLoss: amount } });
  });

  // ============================================================================
  // SECTION 10, THOUGHT GENERATOR
  // ============================================================================

  // Dialogue pools (need templates, familiar-player musings, capability
  // reactions, situational weather/time and personality thoughts) all live in
  // NPCConversation.js, ThoughtProvider mixes them by personality and
  // situation. The generator here only owns the push/event mechanics.

  const ThoughtGenerator = {
    _push(profile, thought) {
      profile.thoughts = profile.thoughts || [];
      profile.thoughts.unshift(thought);
      if (profile.thoughts.length > 5) profile.thoughts.pop();
      // Lets UI layers (e.g. NPCConversation's thought bubbles) react the instant a fresh
      // thought lands, instead of polling profile.thoughts every frame.
      if (profile._eventName) EventBus.emit("npc:thought", { name: profile._eventName, thought });
    },

    generate(profile) {
      if (!profile) return;
      const thought = window.NPCConversation?.ThoughtProvider?.pickThought?.(profile) ?? "...";
      this._push(profile, thought);
    },

    narrateCapability(name, capabilityId) {
      const profile = $gameSystem?._npcSociety?.[name];
      if (!profile) return;
      const thought = window.NPCConversation?.ThoughtProvider?.pickCapabilityThought?.(profile, capabilityId);
      if (thought) this._push(profile, thought);
    },
  };

  EventBus.on("npc:capability_end", ({ name, capabilityId }) => ThoughtGenerator.narrateCapability(name, capabilityId));

  // ============================================================================
  // SECTION 11, STORY LOGGER
  // ============================================================================

  const StoryLogger = {
    // The log is saved with the world, so only the key and its values are
    // stored and the sentence is written out by textOf() when it is read.
    record(npcName, tag, key, params) {
      if (!$gameSystem?._npcSociety) return;
      const profile = $gameSystem._npcSociety[npcName];
      if (!profile) return;
      profile.eventLog = profile.eventLog || [];
      const minute = $gameVariables ? $gameVariables.value(114) : 0;
      profile.eventLog.unshift({ minute, tag, key, params });
      if (profile.eventLog.length > 30) profile.eventLog.pop();
    },

    // A log entry as a sentence. Entries written before the log was keyed hold
    // a finished English string, which is returned as it stands.
    textOf(entry) {
      if (!entry) return '';
      if (typeof entry === 'string') return entry;
      if (!entry.key || !T.has(entry.key)) return entry.desc || '';
      return T(entry.key, entry.params || {});
    },

    generateNarrative(npcName) {
      const profile = $gameSystem?._npcSociety?.[npcName];
      if (!profile || !profile.eventLog?.length) return T('NPCSim.narrative.noHistory', { name: npcName });

      // Group the raw entries, not their rendered text: the summary lines below
      // read values off the entry (who was met, how many shifts) rather than
      // matching English words in a sentence that may not be English.
      const grouped = {};
      for (const entry of profile.eventLog) {
        (grouped[entry.tag] = grouped[entry.tag] || []).push(entry);
      }
      const say = (entry) => this.textOf(entry);

      const sentences = [];

      // Work history
      if (grouped.work?.length) {
        const count = grouped.work.length;
        sentences.push(count === 1
          ? say(grouped.work[0])
          : T('NPCSim.narrative.workShifts', { count: count, last: say(grouped.work[0]) }));
      }

      // Farming
      if (grouped.farm?.length) {
        sentences.push(grouped.farm.length > 2 ? T('NPCSim.narrative.tendsCrops') : say(grouped.farm[0]));
      }

      // Social encounters
      if (grouped.social?.length) {
        const met = [...new Set(grouped.social.map(e => e.params?.name).filter(Boolean))];
        if (met.length === 1) sentences.push(T('NPCSim.narrative.hasMet', { name: met[0] }));
        else if (met.length > 1) {
          sentences.push(T('NPCSim.narrative.acquainted', {
            names: met.slice(0, 2).join(' ' + T('NPCSim.narrative.and') + ' '),
          }));
        }
      }

      // Shopping
      if (grouped.shopping?.length) sentences.push(say(grouped.shopping[0]));

      // Wealth change
      if (grouped.wealth?.length) sentences.push(say(grouped.wealth[0]));

      // Everyday capability use (§7 item 5, extends the tags vocabulary
      // beyond work/farm/social/shopping/theft to the new registry-backed
      // interactions)
      if (grouped.cooking?.length)    sentences.push(grouped.cooking.length > 2 ? T('NPCSim.narrative.cooksRegularly') : say(grouped.cooking[0]));
      if (grouped.renting?.length)    sentences.push(grouped.renting.length > 1 ? T('NPCSim.narrative.rentsSometimes') : say(grouped.renting[0]));
      if (grouped.beekeeping?.length) sentences.push(grouped.beekeeping.length > 1 ? T('NPCSim.narrative.keepsBees') : say(grouped.beekeeping[0]));
      if (grouped.banking?.length)    sentences.push(say(grouped.banking[0]));
      if (grouped.realty?.length)     sentences.push(grouped.realty.length > 1 ? T('NPCSim.narrative.livesOffRent') : say(grouped.realty[0]));
      if (grouped.investing?.length)  sentences.push(grouped.investing.length > 1 ? T('NPCSim.narrative.dabblesStocks') : say(grouped.investing[0]));

      // Crime
      if (grouped.theft_success?.length) sentences.push(say(grouped.theft_success[0]));
      if (grouped.theft_caught?.length)  sentences.push(T('NPCSim.narrative.wasCaught', { what: say(grouped.theft_caught[0]) }));

      // Player relationship
      const opinion = profile.playerOpinion ?? 0;
      if (opinion >= 60)      sentences.push(T('NPCSim.narrative.familiarFace'));
      else if (opinion >= 20) sentences.push(T('NPCSim.narrative.spokenBefore'));

      return sentences.length
        ? T('NPCSim.narrative.summary', { name: npcName, list: sentences.join('; ') })
        : T('NPCSim.narrative.quiet', { name: npcName });
    },

    feedHistorySimulator() {
      if (!window.HistoryManager?.addMinorEvent) return;
      const society = $gameSystem?._npcSociety;
      if (!society) return;
      for (const [name, profile] of Object.entries(society)) {
        if (!profile.eventLog?.length) continue;
        const latest = profile.eventLog[0];
        if (!latest) continue;
        // Dedup: only feed an NPC's latest event once. Without a last-fed
        // marker the unchanged eventLog[0] is re-pushed every interval,
        // churning older real events out of the bounded HistorySimulator log.
        const latestText = this.textOf(latest);
        const marker = `${latest.date ?? ""}|${latest.key ?? latest.desc ?? ""}|${JSON.stringify(latest.params ?? null)}`;
        if (profile._lastFedEvent === marker) continue;
        profile._lastFedEvent = marker;
        try {
          window.HistoryManager.addMinorEvent({
            date: $gameVariables ? $gameVariables.value(113) : T('NPCSim.unknownDate'),
            actor: name,
            desc: latestText,
          });
        } catch (_) {}
      }
    },
  };

  // ============================================================================
  // SECTION 10b, SOCIAL LOGGER
  // ============================================================================
  // Detects when two on-map NPCs are adjacent in a social zone and records the meeting.
  // This drives the HistorySimulator "allied" entries and mild opinion shifts.

  const SocialLogger = {
    // Track pairs already logged this session to avoid spam
    _recentPairs: new Set(),

    scanMeetings(controllers, society) {
      if (!$gameMap) return;
      const socialZone = 101;

      const socialNPCs = controllers.filter(c =>
        c.state === "socializing" || c.state === "inZone"
      );

      for (let i = 0; i < socialNPCs.length; i++) {
        for (let j = i + 1; j < socialNPCs.length; j++) {
          const a = socialNPCs[i];
          const b = socialNPCs[j];
          if (!a.event || !b.event) continue;
          const dist = Math.abs(a.event.x - b.event.x) + Math.abs(a.event.y - b.event.y);
          if (dist > 3) continue;

          const pairKey = a.eventName < b.eventName ? `${a.eventName}|${b.eventName}` : `${b.eventName}|${a.eventName}`;
          if (this._recentPairs.has(pairKey)) continue;
          this._recentPairs.add(pairKey);

          // Clean old pairs every 100 meetings
          if (this._recentPairs.size > 100) this._recentPairs.clear();

          // Record the encounter in both story logs
          StoryLogger.record(a.eventName, "social", `met ${b.eventName}`);
          StoryLogger.record(b.eventName, "social", `met ${a.eventName}`);

          // Mild faction bridge: if both have factions, record as diplomatic contact
          const pa = society[a.eventName];
          const pb = society[b.eventName];
          if (pa?.factionIndex >= 0 && pb?.factionIndex >= 0 &&
              pa.factionIndex !== pb.factionIndex && $gameFactions?.changeReputation) {
            try {
              $gameFactions.changeReputation(pa.factionIndex,  1);
              $gameFactions.changeReputation(pb.factionIndex,  1);
            } catch (_) {}
          }
        }
      }
    },
  };

  // ============================================================================
  // SECTION 11a, WEALTH MANAGER
  // ============================================================================
  // Upgrades (or downgrades) the NPC's home pool tier as their money changes.

  const WEALTH_THRESHOLDS = [
    { pool: "huts",        max: 3000   },
    { pool: "houses",      max: 15000  },
    { pool: "villas",      max: 60000  },
    { pool: "skyscrapers", max: Infinity },
  ];

  // ============================================================================
  // SECTION 11a-i, HOME BUILDING REGISTRY
  // ============================================================================
  // Assigns each NPC a specific procedural building entrance from their map
  // group's residentialBuildings cache (written to MapGroups.json at world gen).
  // The building's seed (mapId * 1e6 + x * 1e3 + y) matches the seed
  // ProceduralHouseSystem uses to deterministically generate that house's
  // contents, so the player will see the correct occupants when they enter.

  // Skyscrapers are PUBLIC buildings: nobody is assigned to live in one, the
  // whole town visits them instead (see NPCSystem's house-map branch). This
  // holds for procedurally placed towers and for the hardcoded map pools alike,
  // because ProceduralHouseSystem classifies by the interior's parent map as
  // well as by the entrance's pool name.
  function _isPublicBuilding(b) {
    return !!window.ProceduralHouseSystem?.isBuildingPublic?.(b);
  }

  // Only houses/huts/villas/abandoned shells and residential walk-ups are
  // addresses. Skyscrapers are public and inns/shops are commercial, so neither
  // is ever handed out as somebody's home.
  function _isResidentialBuilding(b) {
    const PHS = window.ProceduralHouseSystem;
    if (PHS?.isResidentialBuilding) return PHS.isResidentialBuilding(b);
    return !!b && !_isPublicBuilding(b);
  }

  // Buildings are keyed by town + entrance tile rather than by event id: doors
  // on the procedural map (636) are terrain tiles with no event behind them,
  // and map 636 is reused for every world tile.
  function _makeBuildingKey(b, groupName) {
    return window.ProceduralHouseSystem?.buildingKey?.(b, groupName)
      || `${groupName || ''}|${b.mapId}_${b.x}_${b.y}`;
  }

  function _getBuildingKey(b) {
    if (!b) return '';
    if (b.key) return b.key;
    return _makeBuildingKey(b, b.groupName || '');
  }

  function _getBuildingOccupants(b) {
    if (!$gameSystem) return [];
    $gameSystem._npcBuildingOccupants = $gameSystem._npcBuildingOccupants || {};
    return $gameSystem._npcBuildingOccupants[_getBuildingKey(b)] || [];
  }

  function _registerBuildingOccupant(b, npcName) {
    if (!$gameSystem) return;
    $gameSystem._npcBuildingOccupants = $gameSystem._npcBuildingOccupants || {};
    const key = _getBuildingKey(b);
    const arr = $gameSystem._npcBuildingOccupants[key] || [];
    if (!arr.includes(npcName)) arr.push(npcName);
    $gameSystem._npcBuildingOccupants[key] = arr;
  }

  function _unregisterBuildingOccupant(b, npcName) {
    if (!$gameSystem || !b) return;
    const table = $gameSystem._npcBuildingOccupants;
    const arr = table?.[_getBuildingKey(b)];
    if (!arr) return;
    const i = arr.indexOf(npcName);
    if (i >= 0) arr.splice(i, 1);
  }

  // How many separate households a building holds. A multi-floor residential
  // block is one household per floor; a single house holds one (with room for a
  // partner/family member, hence capacity 2 from the map scanner).
  function _buildingFloorCount(b) {
    if (b.type !== 'enterMultiBuilding') return 1;
    return Math.max(1, b.totalFloors || b.capacity || b.numFloors || 1);
  }

  // Which floor a new resident moves into: the lowest vacant one, so the floors
  // of a block fill from the ground up and each floor has someone to find.
  function _pickFloorIndex(b) {
    const floors = _buildingFloorCount(b);
    if (floors <= 1) return 0;
    const occupants = _getBuildingOccupants(b);
    const taken = new Set();
    for (const name of occupants) {
      const f = $gameSystem._npcSociety?.[name]?.homeBuilding?.floorIndex;
      if (typeof f === 'number') taken.add(f);
    }
    for (let f = 0; f < floors; f++) if (!taken.has(f)) return f;
    return occupants.length % floors;
  }

  // Resolves the homeBuilding's procedural house template map via
  // ProceduralHouseSystem and caches it in profile.homeMapId.
  function _resolveHomeBuildingMap(profile) {
    const b = profile.homeBuilding;
    const PHS = window.ProceduralHouseSystem;
    if (!b || !PHS?._selectHouse) return;
    // In a multi-floor block each floor is a different interior template, so
    // resolve the NPC's own floor rather than the ground floor.
    let mapId = PHS.floorInteriorMapId
      ? PHS.floorInteriorMapId(b, b.floorIndex || 0)
      : null;
    if (!mapId) {
      const pool = b.type === 'enterMultiBuilding'
        ? (b.baseFloorPool || 'skyscrapers')
        : (b.poolName || profile.homePoolType || 'houses');
      mapId = PHS._selectHouse(b.seed, pool);
    }
    if (mapId) profile.homeMapId = mapId;
  }

  // Deterministically assigns a building from the group's residentialBuildings
  // cache to the NPC. Assignment is permanent, it is set once (when the NPC
  // is first encountered on their home group's map) and never changes, so NPCs
  // always return to the same door regardless of wealth tier shifts.
  //
  // Local and Shop NPCs get their group locked on first assignment via
  // profile._homeGroupName, so later encounters on other groups' maps don't
  // accidentally reassign them to foreign buildings.
  function _assignHomeBuilding(profile, name) {
    if (!$gameSystem) return;

    // If the NPC already has a stored home group (Local/Shop NPCs keep theirs
    // after wandering to other groups), use that; otherwise resolve from the
    // current map.
    let groupName = profile._homeGroupName;
    if (!groupName) {
      const mapId = $gameMap?.mapId();
      groupName   = mapId ? window.NPCSystem?.findMapGroupByMap?.(mapId) : null;
    }
    if (!groupName) return;

    const groups = $gameSystem._npcMapGroups;
    const all    = groups?.[groupName]?.residentialBuildings;
    if (!all?.length) return;

    // Public (skyscraper) and commercial (inn/shop) entrances are never anybody's
    // address, even though they sit in the residentialBuildings scan.
    const buildings = all.filter(_isResidentialBuilding);
    if (!buildings.length) return;

    // Buildings are drawn from all pool types, wealth tier no longer gates
    // which door an NPC lives behind. Instead every building is eligible and
    // the deterministic seed distributes NPCs evenly across the area.
    const ws   = window.NPCShared ? window.NPCShared.worldSeed() : 19002001;
    const seed = nameHash(name + '_home') ^ ws;
    const rng  = new MiniRng(seed);
    for (let attempt = 0; attempt < buildings.length; attempt++) {
      const idx       = Math.floor(rng.next() * buildings.length);
      const candidate = buildings[idx];
      if (!candidate.key) candidate.key = _makeBuildingKey(candidate, groupName);
      if (_getBuildingOccupants(candidate).length < candidate.capacity) {
        _moveInResident(profile, name, candidate, groupName);
        return;
      }
    }
    // All buildings at capacity, assign to the least-crowded one.
    const fallback = buildings.reduce((best, b) =>
      _getBuildingOccupants(b).length < _getBuildingOccupants(best).length ? b : best
    , buildings[0]);
    if (!fallback.key) fallback.key = _makeBuildingKey(fallback, groupName);
    _moveInResident(profile, name, fallback, groupName);
  }

  // Moves an NPC into a specific building/floor, vacating whatever placeholder
  // residence they held before (procedural citizens start out notionally living
  // wherever they were first seen standing, until a real door is found).
  function _moveInResident(profile, name, building, groupName) {
    if (profile.homeBuilding?._placeholder) {
      _unregisterBuildingOccupant(profile.homeBuilding, name);
    }
    const home = { ...building, groupName, floorIndex: _pickFloorIndex(building) };
    delete home._placeholder;
    profile.homeBuilding   = home;
    profile.homeSeed       = home.seed;
    profile._homeGroupName = groupName;
    _registerBuildingOccupant(home, name);
    _resolveHomeBuildingMap(profile);
  }

  // Everyone who counts as living in this town: the authored roster plus every
  // simulated profile anchored to it (procedural settlements have no authored
  // NPC pool at all, their citizens exist only in the society table).
  function _townResidentCandidates(groupName) {
    const names = new Set(window.NPCSystem?.getNPCNamesByGroup?.(groupName) || []);
    for (const [name, p] of Object.entries($gameSystem?._npcSociety || {})) {
      if (p && p._homeGroupName === groupName) names.add(name);
    }
    // Sorted so the seeded draw below is reproducible regardless of insertion order.
    return [...names].sort();
  }

  // Makes sure the building the player just walked into is somebody's home.
  //
  // Doors on the procedural map are terrain tiles, not events, so they are never
  // picked up by the map scanner that fills residentialBuildings, and no NPC is
  // ever assigned to them up front. Registering the building on entry and
  // deterministically moving townspeople in closes that gap: the same residents
  // are then found behind that same door on every later visit, and at night they
  // are actually inside it (see replacePlayerEventsWithNPCs).
  //
  // Skyscrapers are skipped, they are public and have no residents by design.
  // Returns the resident names for the building.
  function ensureBuildingResidents(building, groupName) {
    if (!building || !groupName || !$gameSystem) return [];
    if (!_isResidentialBuilding(building)) return [];

    const registered = _registerGroupBuilding(building, groupName);
    const existing   = _getBuildingOccupants(registered).slice();
    const capacity   = Math.max(1, registered.capacity || 1);
    if (existing.length >= capacity) return existing;

    // Prefer NPCs who have no home yet, then those still in a placeholder
    // residence. Anyone already settled behind a real door keeps it.
    const society = $gameSystem._npcSociety || {};
    const pool = _townResidentCandidates(groupName).filter(n => {
      if (existing.includes(n)) return false;
      const p = society[n];
      if (!p) return false;
      return !p.homeBuilding || p.homeBuilding._placeholder === true;
    });
    if (!pool.length) return existing;

    const ws  = window.NPCShared ? window.NPCShared.worldSeed() : 19002001;
    const rng = new MiniRng(((registered.seed >>> 0) ^ ws ^ nameHash(groupName)) >>> 0);
    // At least one household, up to the building's capacity (one per floor for
    // a multi-floor block, so a walk-up can have a neighbour on every landing).
    const target = 1 + Math.floor(rng.next() * capacity);
    const want   = Math.min(target, capacity, pool.length + existing.length) - existing.length;

    for (let i = 0; i < want && pool.length; i++) {
      const name = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
      _moveInResident(society[name], name, registered, groupName);
    }
    return _getBuildingOccupants(registered).slice();
  }

  // Hands out the front doors of ONE map to a named set of NPCs, instead of
  // letting them draw from anywhere in their town's (often map-spanning) pool.
  //
  // Omega City (map 631) is the game's largest settlement and the one map that
  // populates itself wholesale, fifty citizens in a single pass, so its own
  // houses have to be the addresses those fifty live behind rather than a door
  // in some unrelated corner of the OmegaTower group. See
  // SpawnManager.randomizeOmegaCityMap (NPCSystem.js).
  //
  // Only NPCs who have no address yet, hold a placeholder one, or are already
  // citizens of this town are moved: someone who genuinely lives in another
  // town and is only passing through keeps their real home. Returns how many
  // were housed.
  function assignHomesOnMap(mapId, groupName, names) {
    if (!$gameSystem || !mapId || !groupName || !names?.length) return 0;
    const all = $gameSystem._npcMapGroups?.[groupName]?.residentialBuildings;
    if (!all?.length) return 0;

    // Public (skyscraper) and commercial (inn/shop) entrances are never anybody's
    // address, even though they sit in the residentialBuildings scan.
    const buildings = all.filter(b => b && b.mapId === mapId && _isResidentialBuilding(b));
    if (!buildings.length) return 0;
    for (const b of buildings) {
      if (!b.key) b.key = _makeBuildingKey(b, groupName);
      b.groupName = groupName;
    }

    const society = $gameSystem._npcSociety || {};
    const ws = window.NPCShared ? window.NPCShared.worldSeed() : 19002001;
    let housed = 0;

    for (const name of names) {
      const profile = society[name];
      if (!profile) continue;
      const home = profile.homeBuilding;
      const settled = home && !home._placeholder;
      // Already behind one of this map's own doors, nothing to do.
      if (settled && home.mapId === mapId) continue;
      // A settled resident of a different town is only visiting.
      if (settled && profile._homeGroupName && profile._homeGroupName !== groupName) continue;

      const rng = new MiniRng((nameHash(name + '_cityhome') ^ ws) >>> 0);
      let chosen = null;
      for (let attempt = 0; attempt < buildings.length; attempt++) {
        const candidate = buildings[Math.floor(rng.next() * buildings.length)];
        if (_getBuildingOccupants(candidate).length < Math.max(1, candidate.capacity || 1)) {
          chosen = candidate;
          break;
        }
      }
      // Every door on the map is full, take the least-crowded one.
      if (!chosen) chosen = buildings.reduce((best, b) =>
        _getBuildingOccupants(b).length < _getBuildingOccupants(best).length ? b : best
      , buildings[0]);

      // _moveInResident only vacates placeholder addresses, an NPC moving in
      // from a real door elsewhere in this same town has to be checked out of it
      // by hand or they stay on both occupancy lists.
      if (settled) _unregisterBuildingOccupant(home, name);
      _moveInResident(profile, name, chosen, groupName);
      housed++;
    }
    return housed;
  }

  // Adds the building to its town's residentialBuildings cache if it is not
  // already there, and returns the cached instance so callers always mutate the
  // one shared descriptor (keys, capacity) rather than a private copy.
  function _registerGroupBuilding(building, groupName) {
    const groups = $gameSystem._npcMapGroups || ($gameSystem._npcMapGroups = {});
    const group  = groups[groupName] || (groups[groupName] = { maps: [], mainMaps: [], residentialBuildings: [] });
    if (!Array.isArray(group.residentialBuildings)) group.residentialBuildings = [];

    const key = _makeBuildingKey(building, groupName);
    let entry = group.residentialBuildings.find(b => _makeBuildingKey(b, groupName) === key);
    if (!entry) {
      // floorIndex/interiorMapId describe the floor the player happens to be
      // standing on, not the building, so they never belong in the cache entry.
      entry = { ...building, groupName };
      delete entry.floorIndex;
      delete entry.interiorMapId;
      group.residentialBuildings.push(entry);
    }
    entry.key = key;
    entry.groupName = groupName;
    // Stamp the caller's own descriptor too: NPCSystem hands the live
    // ProceduralHouseSystem descriptor straight back to getBuildingResidents,
    // which would otherwise compute a group-less key and find nobody home.
    building.key = key;
    building.groupName = groupName;
    // A walk-up discovered through its door knows its real floor count; the
    // cached scan entry may predate that (or have been seeded as a placeholder).
    if (building.type === 'enterMultiBuilding') {
      entry.totalFloors = _buildingFloorCount(building);
      entry.capacity = Math.max(entry.capacity || 0, entry.totalFloors);
    }
    delete entry._placeholder;
    return entry;
  }

  // Residents of a building, optionally narrowed to one floor. Used by the
  // spawner to decide who should be inside when the player walks in at night.
  function getBuildingResidents(building, floorIndex = null, groupName = null) {
    if (!building) return [];
    if (!building.key && groupName) building.key = _makeBuildingKey(building, groupName);
    const names = _getBuildingOccupants(building);
    if (floorIndex === null || _buildingFloorCount(building) <= 1) return names.slice();
    const society = $gameSystem?._npcSociety || {};
    return names.filter(n => (society[n]?.homeBuilding?.floorIndex ?? 0) === floorIndex);
  }

  const WealthManager = {
    maybeUpgrade(profile) {
      const money = profile.money || 0;
      let targetPool = "huts";
      for (const tier of WEALTH_THRESHOLDS) {
        if (money <= tier.max) { targetPool = tier.pool; break; }
      }
      if (profile.homePoolType !== targetPool) {
        profile.homePoolType = targetPool;
        // Home building is permanent, wealth only changes the pool label,
        // not which physical door the NPC sleeps behind.
        StoryLogger.record(profile._eventName, "wealth", 'NPCSim.log.movedHome', { home: T('NPCSim.homePool.' + targetPool), saved: fmtMoney(money) });
      }
    },
  };

  // ============================================================================
  // SECTION 11b, SAVE MIGRATION
  // ============================================================================
  // Adds simulation fields to profiles generated before this plugin existed.

  const HOME_POOL_BY_WEALTH = ["huts", "huts", "houses", "villas", "skyscrapers"];

  // Starting purse, in gold (100 gold = 1 euro).
  //
  // Level is the progression yardstick: an NPC is worth roughly what the party
  // is worth when they meet, because recruiting one adds their whole purse to
  // party funds. Wealth tier then spreads that around by a factor of ~25 from
  // the destitute to the elite, and a per-name roll keeps two neighbours of the
  // same standing from carrying identical amounts. The result lands inside the
  // WEALTH_THRESHOLDS bands above, so an NPC's money still says something about
  // which home pool they belong to (huts under 30 euros, skyscrapers over 600).
  const MONEY_PER_LEVEL   = 120;
  const MONEY_LEVEL_BASE  = 150;
  const MONEY_TIER_MULT   = [0.35, 0.7, 1.4, 3.5, 9];

  function rollStartingMoney(profile, name) {
    const level = Math.max(1, profile?.level ?? 1);
    const tier  = Math.min(Math.max(profile?.wealthTierBase ?? 2, 0), MONEY_TIER_MULT.length - 1);
    const seed  = window.HistoryManager ? window.HistoryManager.getSeed() : DEFAULT_SEED;
    const rng   = new MiniRng(nameHash((name || profile?._eventName || 'npc') + '_money') ^ seed);
    const jitter = 0.7 + rng.next() * 0.6; // 0.7x to 1.3x
    const amount = (MONEY_LEVEL_BASE + level * MONEY_PER_LEVEL) * MONEY_TIER_MULT[tier] * jitter;
    return Math.min(MONEY_CAP, Math.max(0, Math.round(amount)));
  }

  function ensureSimFields(profile, name) {
    if (!profile) return;
    if (profile.hunger === undefined || profile.sleep === undefined || profile.hygiene === undefined ||
        profile.social === undefined || profile.leisure === undefined) {
      // Seed off the NPC's name and the world's history seed so starting needs
      // are deterministic per-save but vary between NPCs and between worlds.
      const _needsSeed = window.HistoryManager ? window.HistoryManager.getSeed() : 19002001;
      const _needsRng  = new MiniRng(nameHash((name || 'npc') + '_needs') ^ _needsSeed);
      if (profile.hunger === undefined)  profile.hunger  = _needsRng.int(40, 100);
      if (profile.sleep  === undefined)  profile.sleep   = _needsRng.int(40, 100);
      if (profile.hygiene === undefined) profile.hygiene = _needsRng.int(40, 100);
      if (profile.social === undefined)  profile.social  = _needsRng.int(40, 100);
      if (profile.leisure === undefined) profile.leisure = _needsRng.int(40, 100);
    }
    if (profile.currentJobId === undefined) profile.currentJobId = null;
    if (profile.workMapId === undefined)    profile.workMapId = null;
    if (profile.workShift === undefined)    profile.workShift = null;
    if (profile.lastWorkMinute === undefined) profile.lastWorkMinute = 0;
    if (profile.moralityScore === undefined) profile.moralityScore = 0;
    if (profile.currentNeed === undefined)  profile.currentNeed = null;
    if (!Array.isArray(profile.eventLog))   profile.eventLog = [];
    if (!Array.isArray(profile.thoughts))   profile.thoughts = [];
    if (profile.homePoolType === undefined)   profile.homePoolType   = HOME_POOL_BY_WEALTH[Math.min(profile.wealthTierBase || 2, 4)];
    if (profile.playerOpinion === undefined)  profile.playerOpinion  = 0;
    if (profile.assignedClassId === undefined) profile.assignedClassId = null;
    if (profile.level === undefined) {
      const _range = window.NPCSystem?.getLevelRangeForMap?.($gameMap?.mapId()) ?? [1, 20];
      const _worldSeed = window.HistoryManager ? window.HistoryManager.getSeed() : 19002001;
      const _rng2  = new MiniRng(nameHash((name || 'npc') + '_lvl') ^ _worldSeed);
      profile.level = _rng2.int(_range[0], _range[1]);
      const base = profile.level;
      profile.atk = base * 3; profile.def = base * 3;
      profile.mat = base * 3; profile.mdf = base * 3;
      profile.agi = base * 3; profile.luk = base * 3;
      profile.mhp = base * 30; profile.mmp = base * 15;
      profile.arcane = 0; profile.substance = 0;
      profile.stealth = 0; profile.intimidation = 0;
    }
    // Money is seeded AFTER the level block, it is derived from it. A recruited
    // NPC hands their whole purse to the party (NPCSystemParty.joinParty), so
    // what they carry has to track player progression instead of being a flat
    // per-tier fortune. Anything above the simulation's own ceiling was written
    // by the old flat table (up to 50 million gold, i.e. half a million euros
    // from one recruit) and is re-seeded here.
    if (profile.money === undefined || profile.money > MONEY_CAP)
      profile.money = rollStartingMoney(profile, name);
    if (profile.exp === undefined)
      profile.exp = ExpManager.expForLevel(profile.assignedClassId ?? 0, profile.level ?? 1);
    if (profile._lastExpDay === undefined)
      profile._lastExpDay = Math.floor(($gameVariables?.value(114) ?? 0) / 1440);
    if (!profile._classSkillsSeeded && profile.assignedClassId) {
      ExpManager.learnClassSkillsUpToLevel(profile, profile.assignedClassId, profile.level ?? 1);
      profile._classSkillsSeeded = true;
    }
    if (profile.markovDb === undefined)        profile.markovDb        = null;
    if (name) profile._eventName = name;
    // Assign a specific procedural building entrance if not yet set.
    // Skip on house maps, the NPC is inside a house, not in its city group.
    if (profile.homeBuilding === undefined && name &&
        !window.NPCSystem?.isHouseMap?.($gameMap?.mapId())) {
      _assignHomeBuilding(profile, name);
      window.NPCSocietyRegistry?.applyHometownOpinionIfMatch?.(profile, profile._homeGroupName);
    }
  }

  // ============================================================================
  // SECTION 12, MAIN TICK
  // ============================================================================

  // Face toward an adjacent Counter tile, if any, called while resting in REST_REGION.
  function _faceCounterTile(ctrl) {
    if (!ctrl.event || !$gameMap) return;
    const x = ctrl.event.x, y = ctrl.event.y;
    const adj = [
      { nx: x,     ny: y - 1, dir: 8 },
      { nx: x,     ny: y + 1, dir: 2 },
      { nx: x - 1, ny: y,     dir: 4 },
      { nx: x + 1, ny: y,     dir: 6 },
    ];
    for (const { nx, ny, dir } of adj) {
      if ($gameMap.isValid(nx, ny) && $gameMap.isCounter(nx, ny)) {
        ctrl.event.setDirection(dir);
        return;
      }
    }
  }

  // Fill sleep for NPCs resting in REST_REGION and orient them toward any adjacent Counter tile.
  function _tickRestingNPCs(controllers, society, deltaMinutes) {
    for (const ctrl of controllers) {
      if (!ctrl.event || ctrl.event._erased) continue;
      if (ctrl.state !== "inZone" && ctrl.state !== "socializing") continue;
      const { x, y } = ctrl.event;
      if ($gameMap.regionId(x, y) !== REST_REGION) continue;
      const profile = society[ctrl.eventName];
      if (!profile) continue;
      profile.sleep = Math.min(100, (profile.sleep ?? 0) + NEED_FILL_PER_SEC.sleep * deltaMinutes * 60);
      _faceCounterTile(ctrl);
    }
  }

  let _lastTickMinute = -1;
  let _lastHistoryFeedMinute = -1;
  const HISTORY_FEED_INTERVAL = 60 * 24 * 7; // once per in-game week

  // Chunked iteration: process at most this many background profiles per tick
  // so large saves don't stall the frame.
  const BACKGROUND_CHUNK = 60;
  let _chunkOffset = 0;

  // ============================================================================
  // SECTION 11b2, EXP MANAGER
  // ============================================================================
  // NPCs with an assignedClassId gain EXP once per game day and can level up,
  // learning new class skills along the way.  Uses the same formula as RMMZ's
  // Game_Actor.prototype.expForLevel so levels feel consistent with the player.

  const ExpManager = {
    expForLevel(classId, level) {
      if (level <= 1) return 0;
      const cls = $dataClasses?.[classId];
      if (!cls) return level * level * 50;
      const [basis, extra, acc_a, acc_b] = cls.expParams;
      return Math.round(
        (basis * Math.pow(level - 1, 0.9 + acc_a / 250) * level * (level + 1)) /
        (6 + Math.pow(level, 2) / 50 / acc_b) +
        (level - 1) * extra
      );
    },

    expToNextLevel(classId, level) {
      return this.expForLevel(classId, level + 1) - this.expForLevel(classId, level);
    },

    learnClassSkillsUpToLevel(profile, classId, maxLevel) {
      const cls = $dataClasses?.[classId];
      if (!cls) return;
      profile.skillIds = profile.skillIds || [];
      for (const learning of (cls.learnings || [])) {
        if (learning.level <= maxLevel && !profile.skillIds.includes(learning.skillId)) {
          profile.skillIds.push(learning.skillId);
        }
      }
    },

    gainDailyExp(profile, name) {
      const classId = profile.assignedClassId;
      if (!classId || !$dataClasses?.[classId]) return;
      if ((profile.level ?? 1) >= 99) return;
      // A "local" resident's level is pinned to the party median by NPCSociety,
      // so there is nothing for them to earn their way past.
      if (profile._localNpc) return;

      const toNext  = this.expToNextLevel(classId, profile.level);
      const daily   = Math.max(1, Math.floor(toNext / Math.max(1, profile.level)));
      profile.exp   = (profile.exp ?? this.expForLevel(classId, profile.level)) + daily;

      let leveled = false;
      while ((profile.level ?? 1) < 99 &&
             profile.exp >= this.expForLevel(classId, (profile.level ?? 1) + 1)) {
        profile.level++;
        this.learnClassSkillsUpToLevel(profile, classId, profile.level);
        leveled = true;
      }

      if (leveled) {
        const mid      = Math.max(1, profile.level * 5);
        profile.atk    = Math.max(profile.atk    ?? 1, mid);
        profile.def    = Math.max(profile.def    ?? 1, mid);
        profile.mat    = Math.max(profile.mat    ?? 1, mid);
        profile.mdf    = Math.max(profile.mdf    ?? 1, mid);
        profile.agi    = Math.max(profile.agi    ?? 1, mid);
        profile.luk    = Math.max(profile.luk    ?? 1, mid);
        profile.mhp    = (10 + profile.level) * 10;
        profile.mmp    = (5  + profile.level) * 5;
        StoryLogger.record(name, "levelup", 'NPCSim.log.reachedLevel', { level: profile.level });
      }
    },
  };

  // ============================================================================
  // SECTION 11c, SHOP SHIFT MANAGER
  // ============================================================================
  // "Shop" events with no graphic of their own are covered around the
  // clock by three 8-hour shifts (00-08, 08-16, 16-24), each staffed by a
  // persona drawn from the map group's own NPC pool (window.NPCSystem.getNPCPool).
  //
  // A "Shop" event the map author DID draw a face on is left out of all of
  // this (see isShopEvent): that face is a shopkeeper of their own, not a
  // fixture, and they stand their counter at every hour of every day.
  //
  // For now this is purely cosmetic: 3 random NPCs are picked per Shop event
  // (regardless of whether they already have a job/routine elsewhere) and
  // only the event's graphic, hover name (MousePan), and Empathize info
  // reflect them. Their actual schedule/position is untouched.
  //
  // Personas are decided once per map entry (assignPersonas, called from
  // NPCSystem's setupNPCControllers). The same [mapId,evId] always resolves
  // to the same trio, re-entering the shop, or coming back another day,
  // shows the same three faces.
  //
  // TODO: map every <Shop> event to its coordinates and pick personas more
  // deliberately (e.g. avoid double-booking the same NPC across shops/shifts).
  //
  // Sprite swap uses ev.setImage(). Cache is reset on map change so stale
  // event refs don't linger.

  const ShopShiftManager = {
    _personas: {},   // "mapId_evId" → { 0: <persona>, 1: <persona>, 2: <persona> }
    _applied:  {},   // "mapId_evId" → last-applied shift index (0-2)
    _lastAppliedShift: {}, // mapId → last shift fully applied to every shop on that map
    _shopEventsCache: null, // cached list of this map's <Shop> events
    _shopEventsMapId: -1,
    _fallbackApplied: {}, // "mapId_evId" → true once a stand-in sprite was drawn

    // The rotas that belong to the world rather than to the visit: a counter on
    // a real, uniquely-numbered map is manned by the same three people in every
    // savegame of the world, decided once when the world is made (see
    // assignWorldShopPersonas). Interior counters are NOT persisted here: a
    // building reached through a door borrows a shared house-template map, so
    // "mapId_evId" is the same key for every building using that template and
    // the rota has to stay scoped to the building currently entered.
    _persistedPersonas() {
      if (!$gameSystem) return {};
      if (!$gameSystem._npcShopPersonas) $gameSystem._npcShopPersonas = {};
      return $gameSystem._npcShopPersonas;
    },

    _getPersonas(key) {
      if (this._personas[key]) return this._personas[key];
      const stored = this._persistedPersonas()[key];
      if (stored) this._personas[key] = stored;
      return stored || null;
    },

    _setPersonas(key, shifts, persist) {
      this._personas[key] = shifts;
      if (persist) this._persistedPersonas()[key] = shifts;
    },

    // A <Shop> counter belongs to the rota only while it has no graphic of its
    // own. A face drawn on it by the map author names the one person who keeps
    // that till: they are never covered, never swapped at a shift boundary and
    // are always found standing there, so every pass here has to walk past them
    // and every reader (npcNameForEvent, the Empathize panel, MousePan) falls
    // back to the event's own identity.
    //
    // The verdict is cached on the Game_Event because _applyPersonaSprite
    // writes the covering persona onto the page data: asking the same question
    // a second time would then see a graphic that the author never drew. The
    // first ask always precedes any such write (every application path filters
    // through here first) and Game_Event objects are rebuilt from the map file
    // on setup, so the cached answer is always the one taken from clean data.
    // <Story> exempts a counter for the same reason: the tag names one written
    // person, so <Shop> + <Story> is a single shopkeeper who is found at their
    // till at every hour, never covered and never swapped at a shift boundary,
    // whether or not the author drew their face on the event.
    isShopEvent(ev) {
      if (!ev) return false;
      if (ev._npcShopRota === undefined) {
        const data = ev.event();
        const tagged = !!window.NPCSystem?.hasShopTag?.(data?.note);
        const owned = !!window.NPCSystem?.hasOwnGraphic?.(data)
          || !!window.NPCSystem?.hasStoryTag?.(data?.note);
        ev._npcShopRota = tagged && !owned;
        if (tagged && !ev._npcShopRota) this._releaseRota($gameMap?.mapId(), ev.eventId());
      }
      return ev._npcShopRota;
    },

    // Hands back a rota this counter should never have had. Worlds made before
    // author-drawn shopkeepers were recognised staffed them like any other
    // counter, which left three citizens believing they worked a till that has
    // its own keeper: they showed as "at work" all day and were held out of the
    // map's spawn roster. Runs once per event, the first time the counter is
    // recognised as static.
    _releaseRota(mapId, evId) {
      if (!$gameSystem || mapId == null) return;
      const key = `${mapId}_${evId}`;
      const stored = this._persistedPersonas()[key];
      if (!stored) return;
      delete this._persistedPersonas()[key];
      delete this._personas[key];
      const assigns  = $gameSystem._npcShopAssignments || {};
      const reserved = $gameSystem._npcShopReservedNames?.[mapId];
      for (const persona of Object.values(stored)) {
        const name = persona?.name;
        const a = name ? assigns[name] : null;
        // Only the shift held at THIS counter is released, a persona booked
        // elsewhere keeps the shift it really works.
        if (!a || a.mapId !== mapId || a.eventId !== evId) continue;
        delete assigns[name];
        const prof = $gameSystem._npcSociety?.[name];
        if (prof) prof._routineDay = -1; // today's routine still says "shopkeeper"
        const i = reserved ? reserved.indexOf(name) : -1;
        if (i >= 0) reserved.splice(i, 1);
      }
    },

    // The map's <Shop> events, cached so updateSprites doesn't re-scan and
    // note-test every event each sim tick. Invalidated by resetMapCache.
    _shopEvents(mapId) {
      if (this._shopEventsCache && this._shopEventsMapId === mapId) return this._shopEventsCache;
      this._shopEventsCache = $gameMap ? $gameMap.events().filter(ev => ev && this.isShopEvent(ev)) : [];
      this._shopEventsMapId = mapId;
      return this._shopEventsCache;
    },

    currentShift() {
      const hour = $gameVariables?.value(23) ?? 12;
      return Math.floor(hour / SHIFT_HOURS) % SHIFT_COUNT;
    },

    // True while any live <Shop> counter on the map is still without a rota.
    // Lets the staging pass (stageShopPersonas, NPCSystem.js) skip the whole
    // candidate-pool walk on the Scene_Map builds that decide nothing new,
    // every return from the menu among them.
    needsStaffing(mapId) {
      for (const ev of this._shopEvents(mapId)) {
        if (!ev || ev._erased) continue;
        if (!this._getPersonas(`${mapId}_${ev.eventId()}`)) return true;
      }
      return false;
    },

    // Builds the ordered candidate list a Shop event's personas are drawn from.
    // Local-group NPCs flagged as shopkeeper-eligible (job-less locals reserved
    // during job assignment, see JobShiftManager + _npcShopkeeperPool) come
    // FIRST and are marked { local: true }. World-wide NPCs (every other group's
    // templates, via the GLOBAL pool) follow as { local: false } fallback, used
    // by assignPersonas only once the local free pool is exhausted.
    _candidates(groupName) {
      if (!window.NPCSystem?.getNPCPool) return [];
      const spriteOf = (ev) => {
        const img = (ev?.pages || []).map(p => p?.image).find(im => im?.characterName);
        return img ? { spriteName: img.characterName, charIdx: img.characterIndex || 0 } : null;
      };

      const seen      = new Set();
      const out       = [];
      const localNames = new Set(); // every name belonging to the local group

      // 1) Local free shopkeeper pool first.
      if (groupName) {
        JobShiftManager.ensureGroupAssignments(groupName); // make sure the pool exists
        let localTemplates = [];
        try { localTemplates = window.NPCSystem.getNPCPool(groupName) || []; } catch (_) {}
        const byName = new Map();
        for (const tpl of localTemplates) {
          const ev = tpl?.eventData;
          if (ev?.name && !/local/i.test(ev.note || "") && !window.NPCSystem?.hasHiddenTag?.(ev.note)) {
            byName.set(ev.name, ev); localNames.add(ev.name);
          }
        }
        for (const name of ($gameSystem?._npcShopkeeperPool?.[groupName] || [])) {
          if (seen.has(name)) continue;
          const sprite = spriteOf(byName.get(name));
          if (!sprite) continue;
          seen.add(name);
          out.push({ name, ...sprite, local: true });
        }
      }

      // 2) Other map groups (out-of-towners), used only when the local free
      //    pool runs out. Local-group NPCs outside the reserved shopkeeper pool
      //    are deliberately NOT eligible, only the reserved percentage of free
      //    locals stand a counter; everyone else stays in their own routine.
      let globalTemplates = [];
      try { globalTemplates = window.NPCSystem.getNPCPool(window.NPCSystem.GLOBAL_GROUP_NAME) || []; } catch (_) {}
      for (const tpl of globalTemplates) {
        const ev = tpl?.eventData;
        if (!ev?.name || seen.has(ev.name) || localNames.has(ev.name) || /local/i.test(ev.note || "")
          || window.NPCSystem?.hasHiddenTag?.(ev.note)) continue;
        const sprite = spriteOf(ev);
        if (!sprite) continue;
        seen.add(ev.name);
        out.push({ name: ev.name, ...sprite, local: false });
      }
      return out;
    },

    // Decides (and caches) the trio of shift personas for every "Shop" event
    // on the given map, called once on map setup. Each persona covers one 8h
    // shift, and an NPC holds at most one shop shift across the whole world
    // (no double-booking): free locals are spent before any out-of-towner.
    assignPersonas(mapId, groupName) {
      if (!$gameMap) return;
      const candidates = this._candidates(groupName);
      if (!candidates.length) return;

      // Names already committed to a shop shift (persisted across maps) keep
      // their one slot, exclude them so nobody mans two counters at once.
      const used = new Set(Object.keys($gameSystem?._npcShopAssignments || {}));
      const localFree = [];
      const fallback  = [];
      for (const c of candidates) {
        if (used.has(c.name)) continue;
        (c.local ? localFree : fallback).push(c);
      }

      // Draw the next free persona, preferring the local pool; only dip into
      // the out-of-town fallback once every free local is spoken for.
      const takeNext = (rng) => {
        const src = localFree.length ? localFree : fallback;
        if (!src.length) return null;
        return src.splice(rng.int(0, src.length - 1), 1)[0];
      };

      for (const ev of $gameMap.events()) {
        if (!ev || ev._erased || !this.isShopEvent(ev)) continue;
        const evId = ev.eventId();
        const key  = `${mapId}_${evId}`;
        // World initialization already decided this counter's trio; reading it
        // back is what keeps the same faces behind it in every savegame.
        if (this._getPersonas(key)) continue;

        // Seeded on the physical event instance (map+id), not its name,
        // shop events sharing a generic name (e.g. "Shop") must still each
        // resolve to their own distinct, stable persona trio. XOR'd with the
        // history generator's world seed, like other seeded NPC rolls.
        const worldSeed = window.HistoryManager ? window.HistoryManager.getSeed() : 19002001;
        const rng = new MiniRng(nameHash(key + '_shopShift') ^ worldSeed);
        const shifts = {};
        for (let s = 0; s < SHIFT_COUNT; s++) {
          // Last resort (everyone in the world is already booked): reuse a
          // random candidate rather than leave the counter unstaffed.
          shifts[s] = takeNext(rng) || rng.pick(candidates);
        }
        this._setPersonas(key, shifts, true);
        this._recordAssignments(mapId, evId, window.NPCSystem?.extractShopName?.(ev.event()) ?? null, shifts);
      }

      this.updateSprites();
    },

    // Staffs every <Shop> counter on a freshly entered interior (a house/shop
    // template reached through a door) with a seeded three-shift rota. Unlike
    // assignPersonas, which draws from a settled on-map group roster, an interior
    // has no roster of its own: candidates are the town's own citizens first
    // (the people the player met outside), and any shift still uncovered is
    // manned by a persona fabricated deterministically from the building's
    // coordinate `seed`, so a shop counter is never left empty. `groupName` may
    // be null (no town context), in which case every shift is a seeded persona.
    assignInteriorPersonas(mapId, groupName, seed) {
      if (!$gameMap) return;
      const shopEvents = $gameMap.events().filter(ev => ev && !ev._erased && this.isShopEvent(ev));
      if (!shopEvents.length) return;

      // Town candidates only: society citizens of this settlement plus the
      // group's own free-shopkeeper pool (the { local:true } half of the
      // roster). Out-of-town wanderers are deliberately excluded here, an
      // uncovered shift is filled by a seeded persona instead. Names already
      // manning a counter elsewhere are excluded so nobody stands two at once.
      const society = window.NPCSystem?.getShopSocietyCandidates?.(groupName) || [];
      const roster  = this._candidates(groupName).filter(c => c && c.local);
      const used = new Set(Object.keys($gameSystem?._npcShopAssignments || {}));
      const seen = new Set();
      const townPool = [];
      for (const c of [...society, ...roster]) {
        if (!c?.name || seen.has(c.name) || used.has(c.name)) continue;
        seen.add(c.name);
        townPool.push(c);
      }

      const baseSeed = (seed >>> 0) || 1;
      for (const ev of shopEvents) {
        const evId = ev.eventId();
        const key  = `${mapId}_${evId}`;
        // Session cache only: this key belongs to a shared interior template,
        // so it must not be read back from (or written to) the world store.
        if (this._personas[key]) continue;

        // Seeded on the building coords + this counter's id so the rota is
        // stable across re-entries yet distinct per shop, like assignPersonas.
        const rng = new MiniRng(nameHash(key + '_interiorShop') ^ baseSeed);
        const shifts = {};
        for (let s = 0; s < SHIFT_COUNT; s++) {
          let persona = townPool.length
            ? townPool.splice(rng.int(0, townPool.length - 1), 1)[0]
            : null;
          if (!persona) {
            persona = window.NPCSystem?.generateSeededPersona?.(
              (baseSeed ^ (evId * 2654435761) ^ (s * 40503)) >>> 0
            );
          }
          if (persona) shifts[s] = persona;
        }
        if (Object.keys(shifts).length) {
          this._setPersonas(key, shifts, false);
          this._recordAssignments(mapId, evId, window.NPCSystem?.extractShopName?.(ev.event()) ?? null, shifts);
        }
      }

      this.updateSprites();
    },

    // Persists each persona's shop coverage to $gameSystem so routines
    // (_inShopShift), the Empathize schedule tab, and the spawn reservation
    // filter all see who's "behind the counter" and when. First shop wins
    // per NPC, a persona double-booked across maps keeps its first one
    // (deterministic, since persona rolls are seeded).
    // `shopName` is passed in rather than read off the event, so the world
    // initialization pass can record a counter it is not standing in front of.
    _recordAssignments(mapId, evId, shopName, shifts) {
      if (!$gameSystem) return;
      const mapName  = $dataMapInfos?.[mapId]?.name || T('NPCSim.mapFallback', { id: mapId });
      const assigns  = $gameSystem._npcShopAssignments  = $gameSystem._npcShopAssignments  || {};
      const reserved = $gameSystem._npcShopReservedNames = $gameSystem._npcShopReservedNames || {};
      const mapReserved = reserved[mapId] = reserved[mapId] || [];
      for (let s = 0; s < SHIFT_COUNT; s++) {
        const p = shifts[s];
        if (!p?.name) continue;
        if (!assigns[p.name]) {
          assigns[p.name] = { shift: s, mapId, eventId: evId, mapName, shopName };
          // Today's routine may have been cached before this NPC became a
          // shopkeeper, drop it so the shift shows up immediately.
          const prof = $gameSystem._npcSociety?.[p.name];
          if (prof) prof._routineDay = -1;
        }
        if (!mapReserved.includes(p.name)) mapReserved.push(p.name);
      }
    },

    updateSprites() {
      if (!$gameMap) return;
      const mapId = $gameMap.mapId();
      const slot  = this.currentShift();
      // Nothing changed since we last fully applied this slot to this map's shops
      if (this._lastAppliedShift[mapId] === slot) return;

      // Tracks whether every live shop got its persona this pass; only then is
      // the map-level shortcut above armed. Keeps the deferred-assignPersonas
      // case (personas not yet populated) re-attempting on later ticks.
      let allApplied = true;
      for (const ev of this._shopEvents(mapId)) {
        if (!ev || ev._erased) continue; // erased shop has nothing to draw
        const evId = ev.eventId();
        const key  = `${mapId}_${evId}`;
        if (this._applied[key] === slot) continue;

        // Resolve the persona BEFORE marking this slot applied. Marking first
        // would poison the cache if a sim tick runs updateSprites() before
        // assignPersonas() has populated _personas (e.g. an in-game minute
        // boundary lands between Game_Map.setup's resetMapCache and the
        // deferred assignPersonas on a regular group map): the early no-op
        // would set _applied[key]=slot, and assignPersonas's own
        // updateSprites() would then skip it, leaving the shop graphic empty.
        const persona = this._getPersonas(key)?.[slot];
        if (!persona) {
          // Rota not built yet (assignPersonas is deferred, or the map's pools
          // weren't ready). Rather than leave the counter standing empty, draw
          // a stand-in citizen once, seeded on the event so it doesn't flicker
          // between ticks. _applied stays unset, so the real persona overwrites
          // it as soon as the rota exists.
          this._applyFallbackSprite(mapId, ev, key);
          allApplied = false;
          continue;
        }
        this._applied[key] = slot;
        this._applyPersonaSprite(ev, persona);
      }

      if (allApplied) this._lastAppliedShift[mapId] = slot;
    },

    // Draws the counters whose rota is ALREADY known, and nothing else. Called
    // from Scene_Map.createDisplayObjects (see stageShopPersonas in
    // NPCSystem.js), i.e. before the spriteset exists: Scene_Map.createSpriteset
    // updates the sprites the moment it builds them, so a graphic written this
    // early has its bitmap requested while the scene is still loading and
    // Scene_Base.isReady waits for it. Written any later (setupNPCControllers
    // runs after createDisplayObjects, and a transfer wipes the image cache) the
    // counter stands empty on screen until the sprite catches up and the file
    // comes off disk, which reads as the shopkeeper turning up late.
    // A counter with no rota yet is deliberately left alone here, the stand-in
    // face updateSprites would draw is only worth it once the map is visible.
    applyKnownSprites(mapId) {
      if (!$gameMap || $gameMap.mapId() !== mapId) return;
      const slot = this.currentShift();
      for (const ev of this._shopEvents(mapId)) {
        if (!ev || ev._erased) continue;
        const key = `${mapId}_${ev.eventId()}`;
        if (this._applied[key] === slot) continue;
        const persona = this._getPersonas(key)?.[slot];
        if (!persona) continue;
        this._applied[key] = slot;
        this._applyPersonaSprite(ev, persona);
      }
    },

    // Writing the page data (not just calling setImage) keeps the persona's
    // graphic from being wiped out the next time the event's page refreshes
    // (e.g. on a switch/variable change), since Game_Event.setupPageSettings
    // re-derives _characterName/_characterIndex from page().image every refresh.
    _applyPersonaSprite(ev, persona) {
      const eventData = ev.event();
      for (const page of (eventData?.pages || [])) {
        if (page?.image) {
          page.image.characterName = persona.spriteName;
          page.image.characterIndex = persona.charIdx;
        }
      }
      ev.refresh();
      ev.setImage(persona.spriteName, persona.charIdx);
    },

    // Draws a placeholder shopkeeper on a <Shop> counter whose shift rota
    // hasn't been decided yet. A <Shop> event carries no graphic of its own,
    // so without this the counter reads as an empty tile until assignPersonas
    // runs. The sprite is rolled from the same pool the seeded interior
    // shopkeepers use, keyed on map+event id (XOR'd with the world seed) so a
    // given counter always falls back to the same face instead of shuffling
    // every sim tick. Applied at most once per event; leaves _applied alone so
    // the genuine persona replaces it on the next pass.
    _applyFallbackSprite(mapId, ev, key) {
      if (this._fallbackApplied[key]) return;
      if (ev.characterName()) { this._fallbackApplied[key] = true; return; } // already has a face

      const worldSeed = window.HistoryManager ? window.HistoryManager.getSeed() : 19002001;
      const persona = window.NPCSystem?.generateSeededPersona?.(
        (nameHash(key + '_shopFallback') ^ worldSeed) >>> 0
      );
      if (!persona?.spriteName) return; // no character pool, retry next tick

      this._fallbackApplied[key] = true;
      this._applyPersonaSprite(ev, persona);
    },

    // Resolves the active persona's display data for the given event, or
    // null when no persona has been assigned to it.
    getActivePersona(mapId, evId) {
      const slot = this.currentShift();
      const persona = this._getPersonas(`${mapId}_${evId}`)?.[slot];
      if (!persona) return null;

      const profile = $gameSystem._npcSociety?.[persona.name];
      return {
        spriteName: persona.spriteName,
        charIdx:    persona.charIdx,
        name:       persona.name,
        bust:       profile?._bustName ?? '7',
        markovDb:   profile?.markovDb ?? 'npc',
      };
    },

    resetMapCache() {
      this._personas = {};
      this._applied  = {};
      this._lastAppliedShift = {};
      this._shopEventsCache = null;
      this._shopEventsMapId = -1;
      this._fallbackApplied = {};
    },

    // Decides the three-shift rota for every <Shop> counter in the world at
    // once, when the world is made, instead of the first time the player walks
    // into each shop. Counters are drawn from the per-map shop index the
    // WorldGen manifests already carry (NPCPools.json "__shops"), so no map has
    // to be loaded and no counter has to be standing in front of us.
    //
    // Doing it up front is what makes the rota a property of the world: an NPC
    // holds at most one shop shift anywhere, so who is free to man a counter
    // depended on which town the player entered first. Maps are walked in id
    // order, and each counter's trio is rolled from its own seed, so every
    // savegame of a world finds the same person behind the same till.
    //
    // Only the town's OWN free shopkeepers are drawn on. Doing this world-wide
    // rather than shop-by-shop means there are far more shifts than there are
    // authored people (three per counter, over a hundred counters), so letting
    // it reach for out-of-towners the way a single visited shop does would
    // conscript the entire population of the world into retail. Once a town
    // has nobody left, the counter is manned by a persona fabricated from the
    // counter's own seed, exactly as an interior shop does (see
    // assignInteriorPersonas), so no till is ever left unattended either.
    assignWorldShopPersonas() {
      const NPCSys = window.NPCSystem;
      if (!NPCSys?.getShopIndex) return;

      const groups = NPCSys.getMapGroups?.() || {};
      const mapIds = new Set();
      for (const [groupName, group] of Object.entries(groups)) {
        if (NPCSys.isProceduralGroup?.(groupName)) continue;
        for (const mapId of (group?.maps || [])) mapIds.add(Number(mapId));
      }

      // A town's free shopkeepers, built once per group: the list walks the
      // whole template pool, and several of a town's maps hold counters.
      const localsByGroup = {};
      const localsFor = (groupName) => {
        const cacheKey = groupName || "";
        if (!localsByGroup[cacheKey]) {
          localsByGroup[cacheKey] = this._candidates(groupName).filter(c => c && c.local);
        }
        return localsByGroup[cacheKey];
      };

      const worldSeed = window.HistoryManager ? window.HistoryManager.getSeed() : 19002001;
      let staffed = 0;
      let invented = 0;
      for (const mapId of [...mapIds].sort((a, b) => a - b)) {
        let entries = [];
        try { entries = NPCSys.getShopIndex(mapId) || []; } catch (e) { entries = []; }
        // Only graphic-less <Shop> counters are staffed by a persona; a plain
        // Shop Processing event, a <Shop> counter whose shopkeeper the author
        // drew, and a <Shop> + <Story> till (one written keeper, always on
        // duty) keep whatever face their own page defines. An index written
        // before the tag was understood carries no `story` flag, so such a
        // till is staffed here and hands the rota back the first time the
        // player stands on that map (see isShopEvent / _releaseRota).
        const counters = entries.filter(e => e && e.shopTagged && !e.hasGraphic && !e.story);
        if (!counters.length) continue;

        const groupName = NPCSys.findMapGroupByMap?.(mapId) || null;
        const locals = localsFor(groupName);

        for (const counter of counters.sort((a, b) => a.eventId - b.eventId)) {
          const evId = counter.eventId;
          const key = `${mapId}_${evId}`;
          if (this._persistedPersonas()[key]) continue;

          // Whoever already holds a shift anywhere is out, so nobody stands
          // two counters. Rebuilt per counter, because the previous one on
          // this map has just spent people.
          const used = new Set(Object.keys($gameSystem?._npcShopAssignments || {}));
          const free = locals.filter(c => !used.has(c.name));

          const rng = new MiniRng(nameHash(key + '_shopShift') ^ worldSeed);
          const shifts = {};
          for (let s = 0; s < SHIFT_COUNT; s++) {
            let persona = free.length ? free.splice(rng.int(0, free.length - 1), 1)[0] : null;
            if (!persona) {
              persona = NPCSys.generateSeededPersona?.(
                (nameHash(key + '_shopHire') ^ worldSeed ^ (s * 40503)) >>> 0
              );
              if (persona) invented++;
            }
            if (persona) shifts[s] = persona;
          }
          if (!Object.keys(shifts).length) continue;

          this._setPersonas(key, shifts, true);
          this._recordAssignments(mapId, evId, counter.shopName ?? null, shifts);
          staffed++;
        }
      }
      console.log(`[NPCSim] World shop rotas: ${staffed} counters staffed around the clock (${invented} shifts covered by hired staff).`);
    },
  };

  if (window.WorldManager?.registerWorldInitializer) {
    // After the roster (order 20): the counter staff are drawn from the
    // job-less locals the roster's job assignment left over.
    window.WorldManager.registerWorldInitializer("shopShifts", 30, () => {
      ShopShiftManager.assignWorldShopPersonas();
      // Walking every group's pool leaves a copy of each in
      // $gameSystem._npcPoolCache, which is world data and would put a second
      // copy of the whole shared NPCPools.json manifest in this world's
      // npcs.json. It is only a memo of static, map-derived templates, so drop
      // it once the rotas are decided; it refills from the manifest on demand.
      if ($gameSystem) $gameSystem._npcPoolCache = {};
    });
  }

  // ============================================================================
  // SECTION 11d, JOB SHIFT MANAGER
  // ============================================================================
  // Each map group tries to fully staff every one of its job positions, a
  // (jobId, workMapId) pair drawn from MapGroups.json's "jobs" map ({ mapId:
  // [jobId, ...] }, one entry per map that hosts one or more jobs), using
  // NPCs drawn from the group's own local pool (see
  // SpawnManager.getNPCPool). Each position gets up to 3 distinct
  // NPCs, one per 8h shift (see SHIFT_HOURS/SHIFT_COUNT), so the job is staffed
  // around the clock with real NPC events rather than a graphic-swapped
  // persona: during their shift, that NPC can only be found on the job's map
  // (see BehaviorDispatcher._handleWork and NPCSystem's roster hook).
  //
  // Assignment is computed once per group (cached via
  // $gameSystem._npcJobAssignedGroups) from a deterministically shuffled pool,
  // filling positions in MapGroups.json order, 3 shifts at a time. As soon as
  // the pool runs out, every remaining shift/position is left uncovered, no
  // NPC is force-spawned there, and every NPC not assigned a slot becomes
  // jobless (JobManager.assignJob falls back to currentJobId = 0).
  //
  // NPCs tagged <Local> are excluded from the pool entirely, they're tied to
  // their home map and never travel for a job, just like for ShopShiftManager.
  const JobShiftManager = {
    ensureGroupAssignments(groupName) {
      if (!groupName) return;
      $gameSystem._npcJobAssignments = $gameSystem._npcJobAssignments || {};
      $gameSystem._npcJobAssignedGroups = $gameSystem._npcJobAssignedGroups || {};
      if ($gameSystem._npcJobAssignedGroups[groupName]) return;
      $gameSystem._npcJobAssignedGroups[groupName] = true;

      const group = $gameSystem?._npcMapGroups?.[groupName];
      if (!group || !group.jobs) return;

      const positions = [];
      for (const [mapId, jobIds] of Object.entries(group.jobs)) {
        for (const jobId of jobIds) {
          positions.push({ jobId, mapId: Number(mapId) });
        }
      }
      if (!positions.length) return;

      // Local pool, excluding <Local>-tagged NPCs (they never hold jobs).
      let templates = [];
      try { templates = window.NPCSystem?.getNPCPool?.(groupName) || []; } catch (_) {}
      const candidates = [];
      const seen = new Set();
      for (const tpl of templates) {
        const ev = tpl?.eventData;
        if (!ev?.name || seen.has(ev.name) || /local/i.test(ev.note || "")) continue;
        seen.add(ev.name);
        candidates.push(ev.name);
      }
      if (!candidates.length) return;

      // Deterministic Fisher-Yates shuffle, seeded per-group.
      const shuffled = [...candidates];
      const ws  = window.NPCShared ? window.NPCShared.worldSeed() : 19002001;
      const rng = new MiniRng(nameHash(groupName + "_jobShifts") ^ ws);
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Fill positions in order, 3 shifts each, until the pool runs dry,
      // any remaining shifts/positions are left uncovered.
      let idx = 0;
      outer:
      for (const pos of positions) {
        const mapName = ($dataMapInfos && $dataMapInfos[pos.mapId]) ? $dataMapInfos[pos.mapId].name : T('NPCSim.mapFallback', { id: pos.mapId });
        for (let shift = 0; shift < SHIFT_COUNT; shift++) {
          if (idx >= shuffled.length) break outer;
          const name = shuffled[idx++];
          $gameSystem._npcJobAssignments[name] = { jobId: pos.jobId, mapId: pos.mapId, mapName, shift };
        }
      }

      // Reserve a slice of the leftover (job-less) NPCs as this group's
      // shopkeeper-eligible pool. These are people with no fixed job filling
      // their day, so they're free to stand a counter shift, ShopShiftManager
      // staffs <Shop> events from here first (see _candidates). The pool is
      // deterministic (the leftover order comes from the seeded shuffle above).
      const leftover = shuffled.slice(idx);
      const keep = Math.ceil(leftover.length * SHOPKEEPER_POOL_RATIO);
      $gameSystem._npcShopkeeperPool = $gameSystem._npcShopkeeperPool || {};
      $gameSystem._npcShopkeeperPool[groupName] = leftover.slice(0, keep);
    },

    currentShift() {
      const hour = $gameVariables?.value(23) ?? 12;
      return Math.floor(hour / SHIFT_HOURS) % SHIFT_COUNT;
    },
  };

  // ============================================================================
  // SECTION 11e, SCHEDULE → MAP RESOLVER
  // ============================================================================
  // Decides *which map within a group* an NPC should currently be found on,
  // purely from their schedule, so NPCSystem can place each NPC on a map that
  // matches what they're doing this hour instead of scattering the pool at
  // random. The mapping mirrors the in-map BehaviorDispatcher destinations:
  //
  //   • work shift  → their assigned work map (already-implemented behaviour,
  //                   preserved here so working NPCs are only ever found there)
  //   • shop shift  → the map of the <Shop> counter they're covering
  //   • social hour → one of the group's main maps (the social hub)
  //   • everything else (sleep/rest, hygiene, meals, leisure, money, errands)
  //                 → their home map, the residential map their front door and
  //                   rest zone (region 102) live on, where _handleSleep then
  //                   walks them home / to the nearest rest tile.
  //
  // Deterministic given (name, hour): the result is computed once per in-game
  // hour by NPCSystem and cached, so walking between a group's maps within the
  // same hour never reshuffles who is where. NPCs with no profile yet (or whose
  // home lies outside this group) fall back to a stable hash-picked group map.
  // Group maps that host at least one registered shop/vendor event, read from
  // the world NPC cache (NPCPools.json "__shops", via NPCSystem.getShopIndex).
  // Memoized per group for the session.
  const _groupShopMapsCache = {};
  function _groupShopMaps(groupName, group) {
    if (_groupShopMapsCache[groupName]) return _groupShopMapsCache[groupName];
    const out = [];
    for (const mId of (group?.maps || [])) {
      const idx = window.NPCSystem?.getShopIndex?.(mId) || [];
      if (idx.length) out.push(mId);
    }
    _groupShopMapsCache[groupName] = out;
    return out;
  }

  function scheduledMapForNPC(name, groupName, hour) {
    if (!name) return null;
    const group = $gameSystem?._npcMapGroups?.[groupName];
    const maps  = group?.maps;
    if (!maps || !maps.length) return null;
    const fallback = () => maps[(nameHash(name) >>> 0) % maps.length];

    // Runs inside the map-setup path for every pool NPC, a throw here (bad
    // profile, missing data...) must never break map loading, so degrade to
    // the deterministic fallback map instead of propagating.
    try {
      let profile = $gameSystem?._npcSociety?.[name];
      if (!profile) profile = window.NPCSocietyRegistry?.ensureProfile?.(name) ?? null;
      if (!profile) return fallback();

      ensureSimFields(profile, name);
      // Make sure work map/shift are resolved so "work" can route correctly.
      if (profile.currentJobId === null) JobManager.assignJob(profile);

      if (hour == null) hour = $gameVariables?.value(23) ?? 12;
      const inGroup  = (mId) => mId && maps.includes(mId);
      const activity = ScheduleManager.evaluate(profile, hour);

      if (activity === "work" && inGroup(profile.workMapId)) return profile.workMapId;

      if (activity === "shopwork") {
        const a = $gameSystem?._npcShopAssignments?.[name];
        if (a && inGroup(a.mapId)) return a.mapId;
      }

      if (activity === "shopping") {
        const shopMaps = _groupShopMaps(groupName, group);
        if (shopMaps.length) {
          const s = (nameHash(name) ^ (Math.floor(hour) * 40503)) >>> 0;
          return shopMaps[s % shopMaps.length];
        }
      }

      if (activity === "social" && group.mainMaps?.length) {
        const s = (nameHash(name) ^ (Math.floor(hour) * 2654435761)) >>> 0;
        return group.mainMaps[s % group.mainMaps.length];
      }

      const homeMap = profile.homeBuilding?.mapId;
      if (inGroup(homeMap)) return homeMap;
      return fallback();
    } catch (e) {
      console.error(`[NPCSim] scheduledMapForNPC failed for "${name}":`, e);
      return fallback();
    }
  }

  const NPCSim = {
    // What an NPC of this level and wealth tier carries, in gold. Exposed so the
    // recruit path can price an NPC that has no simulated profile the same way.
    rollStartingMoney(profile, name) { return rollStartingMoney(profile, name); },

    tick(currentMinute) {
      if (currentMinute === _lastTickMinute) return;
      const delta = Math.max(1, Math.min(60, currentMinute - (_lastTickMinute < 0 ? currentMinute - 1 : _lastTickMinute)));
      _lastTickMinute = currentMinute;

      const society = $gameSystem?._npcSociety;
      if (!society) return;

      // Use variable 23 (sky-phase / current hour) exactly as NPCSociety's mood system does.
      // Computing hour from minute 0 (RMMZ default before TimeDateSystem runs) would force
      // hour=0 → every NPC scheduled to sleep on the very first tick.
      const hour = ($gameVariables?.value(23)) ?? 12; // default noon if not yet initialised

      // Build on-map name set once per tick for fast lookup
      const onMapSet = new Set(
        ($gameSystem.getActiveNPCControllers?.() || []).map(c => c.eventName)
      );

      // Chunked background simulation, rotate through all profiles over multiple ticks
      const allNames   = Object.keys(society);
      const chunkStart = _chunkOffset % Math.max(1, allNames.length);
      const chunkEnd   = Math.min(chunkStart + BACKGROUND_CHUNK, allNames.length);
      _chunkOffset     = chunkEnd >= allNames.length ? 0 : chunkEnd;

      const chunkNames = allNames.slice(chunkStart, chunkEnd);
      const chunkSet = new Set(chunkNames);

      for (const name of chunkNames) {
        const profile = society[name];
        if (!profile) continue;
        ensureSimFields(profile, name);

        NeedManager.update(profile, delta);
        profile.currentNeed = ScheduleManager.evaluate(profile, hour);
        // Attend to the current need off-screen so meters recover, not just drain.
        satisfyNeedOffscreen(profile, profile.currentNeed, delta);

        // Assign job once
        if (profile.currentJobId === null) JobManager.assignJob(profile);

        // Off-screen shift pay
        if (!onMapSet.has(name) && profile.currentNeed === "work") {
          if (currentMinute - (profile.lastWorkMinute || 0) >= 60) {
            profile.lastWorkMinute = currentMinute;
            JobManager.simulateShiftPay(profile, name);
          }
        }

        // Thoughts: on-map NPCs muse much more often (every ~3 game-minutes,
        // so the player actually sees the bustle), off-screen ones stay on
        // the slower 10-minute cadence since nobody's there to read it.
        // Each NPC gets a per-name offset so they don't all land on the same
        // tick and pop their bubbles in unison.
        const _interval = onMapSet.has(name) ? 3 : 10;
        if ((currentMinute + nameHash(name)) % _interval === 0) ThoughtGenerator.generate(profile);

        // Wealth → home pool upgrade when money crosses tier thresholds
        WealthManager.maybeUpgrade(profile);

        // Daily EXP gain (once per in-game day)
        const _today = Math.floor(currentMinute / 1440);
        if (profile._lastExpDay !== _today) {
          profile._lastExpDay = _today;
          ExpManager.gainDailyExp(profile, name);
        }
      }

      // Always process on-map NPCs (regardless of chunk)
      for (const name of onMapSet) {
        const profile = society[name];
        if (!profile || chunkSet.has(name)) continue; // already processed
        ensureSimFields(profile, name);
        NeedManager.update(profile, delta);
        profile.currentNeed = ScheduleManager.evaluate(profile, hour);
        satisfyNeedOffscreen(profile, profile.currentNeed, delta);
        if (profile.currentJobId === null) JobManager.assignJob(profile);
        if ((currentMinute + nameHash(name)) % 3 === 0) ThoughtGenerator.generate(profile);
      }

      // Dispatch on-map controller states + log NPC social meetings
      const controllers = $gameSystem.getActiveNPCControllers?.() || [];
      if (currentMinute % 5 === 0) SocialLogger.scanMeetings(controllers, society);
      for (const ctrl of controllers) {
        const profile = society[ctrl.eventName];
        if (profile) BehaviorDispatcher.dispatch(ctrl, profile);
      }

      // Fill sleep and orient toward Counter tiles for NPCs resting in region 102
      _tickRestingNPCs(controllers, society, delta);

      // Feed HistorySimulator once per week
      if (currentMinute - _lastHistoryFeedMinute >= HISTORY_FEED_INTERVAL) {
        _lastHistoryFeedMinute = currentMinute;
        StoryLogger.feedHistorySimulator();
      }

      // Swap sprites for <Shop> events based on time of day
      ShopShiftManager.updateSprites();
    },

    on: EventBus.on.bind(EventBus),
    emit: EventBus.emit.bind(EventBus),
    // 0 (calm, <=2010) .. 1 (max chaos, 2012). Shared with NPCSystem.js so the
    // road to 2012 frays both the off-screen sim and on-map NPC reactions.
    eraTension,
    satisfyNeedTick,
    NeedManager,
    ScheduleManager,
    BehaviorDispatcher,
    JobManager,
    WealthManager,
    SocialLogger,
    InteractionScanner,
    CrimeManager,
    ThoughtGenerator,
    StoryLogger,
    ensureSimFields,
    ShopShiftManager,
    JobShiftManager,
    ExpManager,
    // Schedule → map resolver (SECTION 11e): which group map an NPC belongs
    // on this hour, given their routine/job/shop schedule. Used by NPCSystem's
    // group-assignment pass so spawn maps follow each NPC's schedule.
    scheduledMapForNPC,
    // Symmetric NPC↔NPC opinion adjustment (used by purchases and by
    // NPCEmpathize's join-party bonding).
    bumpMutualOpinion,

    // Bust resolver: returns the bust image name for an NPC event, or null.
    // Priority: profile._bustName (seed-randomized) → derived from the
    // profile's spriteKey (so remote NPCs opened from the wiki/web graph
    // resolve too, _applySocietySprite only runs for on-map events) →
    // null (caller falls back to SpritesAssociation).
    getBustForNPC(eventName) {
      const profile = $gameSystem?._npcSociety?.[eventName];
      if (!profile) return null;
      if (profile._bustName) return profile._bustName;
      if (profile.spriteKey) {
        const entry = window._NPCSocietyDataLoader?.npcData?.[profile.spriteKey];
        const bust  = entry?.busts?.[profile.bustIndex ?? 0] ?? entry?.busts?.[0];
        if (bust) {
          profile._bustName = bust; // cache like _applySocietySprite does
          return bust;
        }
      }
      return null;
    },

    // Returns true when ev has <Shop> tag and is currently staffed by a
    // "covering" persona rather than its own defined identity, which of the
    // three 8-hour shifts that is gets decided per-event by ShopShiftManager.
    isShopShiftCovered(ev) {
      if (!ShopShiftManager.isShopEvent(ev) || !$gameMap) return false;
      return !!ShopShiftManager.getActivePersona($gameMap.mapId(), ev.eventId());
    },

    // Returns the active covering persona's data { spriteName, charIdx, name, bust, markovDb },
    // or null when the event is currently showing its own defined identity.
    getShopShiftData(evName, mapId, evId) { return ShopShiftManager.getActivePersona(mapId, evId); },

    // The name of the person actually standing at this event right now. A
    // <Shop> counter is manned in shifts, so its event name ("Shop", "Bar",
    // ...) is the name of the fixture and not of anybody; whoever is covering
    // the current shift outranks it. Everything the player reads or that keys
    // a society profile off an event should go through here.
    npcNameForEvent(ev) {
      if (!ev) return '';
      const persona = this.isShopShiftCovered(ev)
        ? ShopShiftManager.getActivePersona($gameMap.mapId(), ev.eventId())
        : null;
      return persona?.name || ev.event()?.name?.trim() || '';
    },

    // Personal daily routines (see SECTION 3b), exposed so UI plugins like
    // NPCEmpathize can render past/planned activity timelines on demand.
    RoutineManager,

    // Instantly relocates freshly-spawned, idle NPCs into whatever activity
    // their current need/routine says they should be doing right now (see
    // SECTION 3c), called once per map load, after spawning completes.
    placeNPCsInActivities() { ActivityPlacer.placeOnMapLoad(); },

    // Home-building registry (SECTION 11a-i), used by NPCSystem when the player
    // walks into a generated building: ensureBuildingResidents assigns the town's
    // NPCs to it (no-op for public skyscrapers), getBuildingResidents reads them
    // back per floor.
    ensureBuildingResidents,
    getBuildingResidents,
    // Gives a named set of NPCs the doors of one specific map as their address,
    // used by Omega City's fifty-citizen spawn pass (SECTION 11a-i).
    assignHomesOnMap,
  };

  window.NPCSim = NPCSim;

  // ============================================================================
  // SECTION 12b, SAVE / LOAD HOOKS
  // ============================================================================

  const _Game_System_onAfterLoad = Game_System.prototype.onAfterLoad;
  Game_System.prototype.onAfterLoad = function () {
    _Game_System_onAfterLoad?.call(this);

    // Reset tick counters so first tick after load uses delta=1 instead of
    // a huge jump that would instantly drain all NPC needs.
    _lastTickMinute      = -1;
    _lastHistoryFeedMinute = -1;
    _chunkOffset         = 0;

    // Migrate all existing profiles in the save file.
    // Rebuild building occupant registry from existing profiles so capacity
    // tracking stays accurate after loading a save.
    this._npcBuildingOccupants = {};
    const society = this._npcSociety;
    if (society) {
      for (const [name, profile] of Object.entries(society)) {
        ensureSimFields(profile, name);
        if (profile.homeBuilding) {
          // Homes saved before buildings were keyed by town carry no group, so
          // backfill it from the profile: without it the rebuilt occupancy would
          // land in a different bucket than a fresh assignment and the building
          // could be over-filled once.
          if (!profile.homeBuilding.groupName && profile._homeGroupName) {
            profile.homeBuilding.groupName = profile._homeGroupName;
            delete profile.homeBuilding.key;
          }
          _registerBuildingOccupant(profile.homeBuilding, name);
        }
      }
    }
  };

  // ============================================================================
  // SECTION 13, HOOK INTO GAME TIME (TimeDateSystem variable 114)
  // ============================================================================

  const _Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    _Game_Map_setup.call(this, mapId);
    ShopShiftManager.resetMapCache();
  };

  const _Game_Map_update = Game_Map.prototype.update;
  Game_Map.prototype.update = function (sceneActive) {
    _Game_Map_update.call(this, sceneActive);
    if (!sceneActive) return;
    const minute = $gameVariables ? $gameVariables.value(114) : 0;
    if (minute !== this._lastNPCSimMinute) {
      this._lastNPCSimMinute = minute;
      NPCSim.tick(minute);
    }
  };

  // ============================================================================
  // SECTION 14, PLUGIN COMMAND: NPCHistory
  // ============================================================================

  PluginManager.registerCommand(pluginName, "NPCHistory", args => {
    const name = String(args.eventName || "").trim();
    if (!name) return;
    const narrative = StoryLogger.generateNarrative(name);
    $gameMessage.add(narrative);
  });

  PluginManager.registerCommand(pluginName, "NPCDebug", args => {
    const name = String(args.eventName || "").trim();
    if (!name) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) {
      console.warn(`[NPCSim] NPCDebug: no profile found for "${name}"`);
      return;
    }
    console.groupCollapsed(`[NPCSim] Profile: ${name}`); // i18n-ignore: developer console
    console.log("Need:", profile.currentNeed);
    console.log("Hunger:", profile.hunger?.toFixed(1), "/ Sleep:", profile.sleep?.toFixed(1));
    console.log("Money:", profile.money, "/ Morality:", profile.moralityScore);
    console.log("Home pool:", profile.homePoolType, "/ Map:", profile.homeMapId);
    if (profile.homeBuilding) console.log("Home building:", profile.homeBuilding);
    console.log("Job ID:", profile.currentJobId, "/ Work map:", profile.workMapId, "/ Shift:", profile.workShift);
    console.log("Player opinion:", profile.playerOpinion);
    console.log("Thoughts:", profile.thoughts);
    console.log("Event log:", profile.eventLog?.slice(0, 5));
    console.log("Full profile:", JSON.parse(JSON.stringify(profile)));
    console.groupEnd();
  });

  PluginManager.registerCommand(pluginName, "NPCForceNeed", args => {
    const name  = String(args.eventName || "").trim();
    const field = String(args.field || "hunger").trim();
    const value = Number(args.value ?? 0);
    if (!name || !field) return;
    const profile = $gameSystem?._npcSociety?.[name];
    if (!profile) { console.warn(`[NPCSim] NPCForceNeed: no profile for "${name}"`); return; }
    profile[field] = value;
    console.log(`[NPCSim] Set ${name}.${field} = ${value}`);
  });

  // ============================================================================
  // SECTION 15, DIALOGUE HOOKS: thought balloon + player opinion
  // ============================================================================

  const _Window_Message_startMessage = Window_Message.prototype.startMessage;
  Window_Message.prototype.startMessage = function () {
    _Window_Message_startMessage.call(this);
    if ($gameMessage._npcSimHandled) return;
    $gameMessage._npcSimHandled = true;

    const interp = $gameMap?._interpreter;
    const evId   = interp?.eventId?.();
    if (!evId) return;
    const ev = $gameMap.event(evId);
    if (!ev) return;
    const npcName = ev.event()?.name;
    if (!npcName) return;
    const profile = $gameSystem?._npcSociety?.[npcName];
    if (!profile) return;

    // Track player familiarity: increment opinion per conversation
    profile.playerOpinion = Math.min(100, (profile.playerOpinion ?? 0) + 2);
  };

  const _Game_Message_clear = Game_Message.prototype.clear;
  Game_Message.prototype.clear = function () {
    _Game_Message_clear.call(this);
    this._npcSimHandled = false;
  };

  // SpritesAssociation → NPCs.json migration is handled by DataService.js
  // which rebuilds window.Sprites.SpritesAssociation from window.WorldGen.NPCs
  // before any plugin IIFE captures the reference. No proxy needed here.

  console.log("[NPCSimulationCore] Loaded, autonomous society simulation active.");

})();
