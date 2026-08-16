//=============================================================================
// PartyBanter.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc v1.0.0 The party's own talk: multi-beat discussions between companions, keyed to personality, biome, what just happened and how everyone is holding up.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help PartyBanter.js
 *
 * ==========================================================================
 * WHAT THIS IS
 * ==========================================================================
 * The bank of things PARTY MEMBERS say to each other, and the machine that
 * decides which of them is said now. It is deliberately not the same bank the
 * town uses (NPC/NPCConversation.js): people who have shared a road for weeks
 * do not greet each other the way they greet a stranger behind a counter, and
 * every line in here is written for somebody who already knows who they are
 * talking to.
 *
 * The lines themselves are not in this file. They live in
 *
 *     js/i18n/en/plugins/PartyBanter.json
 *
 * so the bank can be added to (and translated) without touching the code.
 *
 * ==========================================================================
 * IT ONLY RUNS FOR A PARTY OF TWO OR MORE
 * ==========================================================================
 * Everything here answers null while the party is one person. A lone traveller
 * falls back to the plain chatter in AutoIdle.json, which is what they had
 * before this file existed: there is nobody to hold a discussion with, and a
 * personality-flavoured aside to nobody is just noise.
 *
 * ==========================================================================
 * HOW A DISCUSSION IS PUT TOGETHER
 * ==========================================================================
 * A discussion is a short scripted exchange: two to four BEATS, each beat one
 * line said by one participant, handed back in order. The topic is chosen from
 * what is actually going on, weighted, so the same two people standing in the
 * same field do not have the same conversation twice in an evening:
 *
 *   pending    something that just happened to the party and has not been
 *              talked about yet, chiefly a purchase (see "SHOPPING" below).
 *              Always taken first, and only once.
 *   battered   everybody is under 40% health. The party is in trouble and
 *              says so.
 *   needAll    everybody has a meter on the floor: hungry, filthy, sleepless.
 *   need       one of the two has a meter under 35%, and it is their subject.
 *   recent     a line out of the party DIARY (Core/Diary.js) from the last few
 *              hours: the fight they won, the artifact they found, the person
 *              who joined, the floor they went down. The diary's own parameters
 *              are filled into the script, so the exchange names the creature
 *              or the item.
 *   biome      where they are standing, by FAMILY rather than by biome id, so
 *              one bank covers Forest, Jungle and Bamboo and a biome nobody
 *              has written for still lands somewhere sensible.
 *   general    the road, the money, the leader, the plan. Always available.
 *   personality one member's own PERSONALITY opens (their archetype from
 *              js/db/Health/PersonalityData.json), the other's personality
 *              answers.
 *
 * Whatever the topic, the last word is often a CLOSER out of a third member's
 * personality bank (or the opener's, in a party of two), which is what makes
 * the same script read differently depending on who is standing in it: a
 * Cynical closer and a Nurturing closer end the same exchange very differently.
 *
 * A script whose tokens cannot all be filled from the context is rejected and
 * another is drawn, so a diary line missing a parameter never shows up as
 * "{enemies}" in a bubble.
 *
 * ==========================================================================
 * SHOPPING: THE SAME PURCHASE, THREE OPINIONS
 * ==========================================================================
 * Buying something over a counter queues a pending topic. Back on the map the
 * next discussion is about the purchase, and each member judges it out of their
 * own personality bank: the Disciplined one resents the expense, the Hedonistic
 * one wants to know why only one was bought, the Cautious one asks what the
 * party is now short of. Party of one: nothing is queued at all.
 *
 * ==========================================================================
 * API
 * ==========================================================================
 *   PartyBanter.active()                    is there a party to talk?
 *   PartyBanter.personalityKey(actor)       'cynical', 'nurturing', ...
 *   PartyBanter.discussion([actorA, actorB, actorC?])
 *                                           -> [{ who, text }, ...] | null
 *                                           `who` indexes the array passed in
 *   PartyBanter.solo(actor, key)            one line, personality first, for
 *                                           the single bubbles a member pops
 *                                           on their own (a thought, a look, a
 *                                           sit-down, a cry after the leader)
 *   PartyBanter.strangerGreet(actor)        how THIS member opens with somebody
 *                                           who is not one of their own
 *   PartyBanter.noteEvent(topic, ctx)       queue a pending topic by hand
 *   PartyBanter.noteShopBuy(item, price, place)
 *
 * Consumed by Core/AutoIdleExplorer.js, which owns the walking, the bubbles and
 * the opinion ledger; this file owns only what is said.
 */

(() => {
    'use strict';

    const BANK = 'PartyBanter';

    // A pending topic is worth talking about for a while and then stops being
    // news. Roughly two minutes of real time, which is a long walk out of a
    // shop and back onto the road.
    const PENDING_LIFE = 60 * 120;
    const PENDING_MAX = 3;

    // How far back the diary is read for something to talk about, in world
    // minutes, and how many lines deep. Both matter: a quiet hour should not
    // dredge up a fight from yesterday, and a busy one should not have the
    // party still discussing the first thing on the page.
    const RECENT_MINUTES = 300;
    const RECENT_DEPTH = 10;

    const NEED_LINE = 35;      // a meter under this is on that member's mind
    const NEED_FLOOR = 30;     // ...and under this for everybody is the party's
    const HP_FLOOR = 0.4;      // everybody under this is a party in trouble

    // ------------------------------------------------------------------ bank
    // T.pool warns about a missing key, and this file asks for keys that are
    // deliberately optional (a personality with no closers written yet), so
    // every read is guarded.
    function pool(path) {
        const key = BANK + '.' + path;
        if (typeof T === 'undefined' || !T.has || !T.has(key)) return [];
        const list = T.pool(key);
        return Array.isArray(list) ? list : [];
    }

    function has(path) {
        return pool(path).length > 0;
    }

    function pick(list) {
        return list.length ? list[Math.floor(Math.random() * list.length)] : null;
    }

    function pickFrom(path) {
        return pick(pool(path));
    }

    // {name} and friends. A token with nothing behind it is left standing so
    // the caller can see the line is unusable and draw another one.
    const TOKEN = /\{(\w+)\}/g;
    function fill(text, ctx) {
        return String(text).replace(TOKEN, (whole, key) => {
            const value = ctx[key];
            return (value === undefined || value === null || value === '') ? whole : String(value);
        });
    }

    function unresolved(text) {
        return /\{\w+\}/.test(text);
    }

    // ----------------------------------------------------------- personality
    // The archetype list PersonalityData.json ships, whichever of the two
    // shapes it is in and whichever loader got there first.
    function personalityList() {
        const loader = window._NPCSocietyDataLoader;
        if (loader && Array.isArray(loader.personalities)) return loader.personalities;
        const data = window.Health && window.Health.PersonalityData;
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.list)) return data.list;
        return null;
    }

    function profileOf(actor) {
        if (!actor || !window.NPCSocietyRegistry) return null;
        try {
            return window.NPCSocietyRegistry.getProfile(actor.name()) || null;
        } catch (e) {
            return null;
        }
    }

    // 'cynical', 'nurturing', ... A member whose society profile carries no
    // archetype (the player, in a save made before creation wrote one) is still
    // given one, derived from their actor id so it never changes under them.
    function personalityKey(actor) {
        if (!actor) return null;
        const list = personalityList();
        if (!list || !list.length) return null;
        const profile = profileOf(actor);
        let index = profile && profile.personalityIndex;
        if (index === undefined || index === null || !list[index]) {
            const id = (actor.actorId && actor.actorId()) || 1;
            index = (id * 7 + String(actor.name() || '').length * 3) % list.length;
        }
        const name = list[index] && list[index].name;
        return name ? String(name).toLowerCase() : null;
    }

    // The bank for this member's archetype, or the shared one when nobody has
    // written that archetype's lines yet.
    function personalPool(actor, section) {
        const key = personalityKey(actor);
        if (key && has(section + '.' + key)) return pool(section + '.' + key);
        return pool(section + '.any');
    }

    // ------------------------------------------------------------- the world
    function biomeId() {
        try {
            if ($gameMap && typeof $gameMap.getBiome === 'function') {
                const tagged = $gameMap.getBiome();
                if (tagged) return String(tagged);
            }
            if ($gameSystem && $gameSystem.getBiomeFromCache && $gamePlayer) {
                const cached = $gameSystem.getBiomeFromCache($gamePlayer.x, $gamePlayer.y);
                if (cached && cached !== 'Unknown') return String(cached); // i18n-ignore: sentinel
            }
            const proc = $gameSystem && $gameSystem._procGenData;
            if (proc && proc.currentBiome) return String(proc.currentBiome);
        } catch (e) { /* a conversation never breaks on a missing reading */ }
        return null;
    }

    // Biomes are grouped by FAMILY rather than written one by one: there are
    // 129 of them and they fall into a dozen kinds of place to be standing in.
    // Matched most specific first, since "CaveIce" is a cave before it is ice
    // and "VillageDesert" is a settlement before it is sand.
    const FAMILY_RULES = [
        [/cave|mine|shaft|underdark|catacomb|crypt|barrow|oubliette|tunnel|cistern|grotto|lavatube|warren|dungeon|sewer|metro|underforge|sunkenlibrary|cellar|vault|lair|den|burrow/i, 'underground'],
        [/heaven|hell|limbo|eldritch|dream|fairy|abstract|digital|spirit|profane|omega|alien|space|mushroom|fungal|crystal/i, 'otherworldly'],
        [/factory|laborator|buriedlab|bunker|spacecenter|saltworks|landfill|train|office/i, 'industrial'],
        [/ruin|abandon|graveyard|crypt|castle|temple|church|shrine|villa/i, 'ruins'],
        [/city|burg|village|houses|park|dock|station|market|arena/i, 'urban'],
        [/road|highway|bridge/i, 'road'],
        [/ice|snow|frozen|permafrost|tundra|taiga|glacier/i, 'ice'],
        [/desert|badland|saltflat|canyon|steppe|savannah|volcano/i, 'desert'],
        [/swamp|marsh|mangrove|bog|fen/i, 'wetland'],
        [/ocean|sea|beach|lake|river|shore|water|flooded/i, 'water'],
        [/mountain|highland|cliff|peak/i, 'mountain'],
        [/forest|jungle|wood|bamboo|grove/i, 'forest'],
        [/field|meadow|farm|plain|grass|orchard/i, 'plains'],
        [/inside|interior|room|hall/i, 'interior'],
    ];

    function biomeFamily(id) {
        if (!id) return null;
        for (const [rule, family] of FAMILY_RULES) {
            if (rule.test(id)) return family;
        }
        return null;
    }

    function biomeLabel(id) {
        if (!id) return '';
        try {
            if (window.BiomeNames && window.BiomeNames.display) return window.BiomeNames.display(id);
        } catch (e) { /* the id reads well enough on its own */ }
        return String(id).replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    function placeLabel() {
        try {
            if (window.WorldMapReturn && window.WorldMapReturn.placeName && $gameMap) {
                const named = window.WorldMapReturn.placeName($gameMap.mapId());
                if (named) return named;
            }
            if ($gameMap && $dataMapInfos && $dataMapInfos[$gameMap.mapId()]) {
                return $dataMapInfos[$gameMap.mapId()].name || '';
            }
        } catch (e) { /* nowhere in particular, then */ }
        return '';
    }

    // ------------------------------------------------------------ the people
    function members() {
        return ($gameParty && $gameParty.members && $gameParty.members()) || [];
    }

    function active() {
        return members().length >= 2;
    }

    function needsOf(actor) {
        if (!actor || !window.PartyNeeds || !window.PartyNeeds.getMemberNeeds) return null;
        try {
            return window.PartyNeeds.getMemberNeeds(actor);
        } catch (e) {
            return null;
        }
    }

    const NEED_KEYS = ['hunger', 'sleep', 'hygiene', 'social', 'leisure'];

    function pressingNeed(actor) {
        const needs = needsOf(actor);
        if (!needs) return null;
        let worst = null;
        let low = NEED_LINE;
        for (const key of NEED_KEYS) {
            const value = Number(needs[key]);
            if (!isFinite(value) || value > low) continue;
            worst = key;
            low = value;
        }
        return worst;
    }

    // Everybody has SOMETHING on the floor. Not the same meter necessarily:
    // a party where one is starving, one has not slept and one has not washed
    // in a week is a party in a bad way, and it talks like one.
    function everyoneRunDown() {
        const list = members();
        if (list.length < 2) return false;
        return list.every((actor) => {
            const needs = needsOf(actor);
            if (!needs) return false;
            return NEED_KEYS.some((key) => Number(needs[key]) <= NEED_FLOOR);
        });
    }

    function everyoneBattered() {
        const list = members();
        if (list.length < 2) return false;
        return list.every((actor) => actor && actor.mhp > 0 && actor.hp / actor.mhp < HP_FLOOR);
    }

    // ------------------------------------------------------------ what is new
    // The last thing worth mentioning out of the party diary. Only kinds the
    // bank has a script for, only recent ones, and never the same line twice
    // in a row.
    function worldMinutes() {
        return ($gameVariables && $gameVariables.value(114)) || 0;
    }

    let _lastRecent = '';

    // A diary kind is "battle.boss", and the i18n resolver splits a key on its
    // dots, so a bank key may not contain one: the banks are filed under
    // "battle_boss".
    function recentSection(kind) {
        return String(kind).replace(/\./g, '_');
    }

    function recentTopic() {
        if (!window.Diary || !window.Diary.entries) return null;
        let entries;
        try {
            entries = window.Diary.entries();
        } catch (e) {
            return null;
        }
        if (!entries || !entries.length) return null;
        const now = worldMinutes();
        const options = [];
        for (let i = entries.length - 1, seen = 0; i >= 0 && seen < RECENT_DEPTH; i--, seen++) {
            const entry = entries[i];
            if (!entry || !entry.k) continue;
            if (now - Number(entry.t || 0) > RECENT_MINUTES) break;
            const section = recentSection(entry.k);
            if (!has('script.recent.' + section)) continue;
            const signature = entry.k + '|' + entry.t;
            if (signature === _lastRecent) continue;
            options.push({ kind: section, params: entry.p || {}, signature });
        }
        return pick(options);
    }

    // ------------------------------------------------------------ pending news
    // Something that happened off the map (a counter, a courier) and has not
    // been talked about yet. Kept on $gameTemp: it is worth a conversation for
    // the next few minutes and nothing beyond that, so it has no business in
    // the savegame.
    function pendingList() {
        if (typeof $gameTemp === 'undefined' || !$gameTemp) return null;
        if (!Array.isArray($gameTemp._partyBanterPending)) $gameTemp._partyBanterPending = [];
        return $gameTemp._partyBanterPending;
    }

    // Topics the engine builds itself rather than reading a script for, so
    // they are worth queueing even though script.<topic> holds nothing.
    const BUILT_TOPICS = ['shop'];

    function noteEvent(topic, ctx) {
        if (!active()) return;              // one person has nobody to tell
        if (!topic) return;
        if (!BUILT_TOPICS.includes(topic) && !has('script.' + topic)) return;
        const list = pendingList();
        if (!list) return;
        list.push({ topic, ctx: ctx || {}, until: Graphics.frameCount + PENDING_LIFE });
        if (list.length > PENDING_MAX) list.splice(0, list.length - PENDING_MAX);
    }

    function takePending() {
        const list = pendingList();
        if (!list || !list.length) return null;
        const now = Graphics.frameCount;
        while (list.length) {
            const next = list.shift();
            if (next && next.until > now) return next;
        }
        return null;
    }

    // --------------------------------------------------------------- context
    function baseContext(cast) {
        const id = biomeId();
        const leader = ($gameParty && $gameParty.leader && $gameParty.leader()) || null;
        return {
            name: cast[0] ? cast[0].name() : '',
            other: cast[1] ? cast[1].name() : '',
            third: cast[2] ? cast[2].name() : '',
            leader: leader ? leader.name() : '',
            biome: biomeLabel(id),
            place: placeLabel(),
            gold: $gameParty ? String($gameParty.gold()) : '',
        };
    }

    // A diary line carries parameters of its own, and some of them are called
    // the same thing as the people standing there: `battle.boss` writes the
    // creature's name into {name}. Rather than let one shadow the other, the
    // cast always owns the bare tokens and everything an event brought with it
    // is offered under an ev_ prefix, so a script asks for {ev_name} when it
    // means the boss and {name} when it means whoever is speaking.
    const RESERVED = ['name', 'other', 'third', 'leader', 'biome', 'place', 'gold'];

    function mergeContext(ctx, extra) {
        if (!extra) return ctx;
        const merged = Object.assign({}, ctx);
        for (const key of Object.keys(extra)) {
            if (key === '_sig') continue;
            merged['ev_' + key] = extra[key];
            if (!RESERVED.includes(key)) merged[key] = extra[key];
        }
        return merged;
    }

    // ---------------------------------------------------------------- topics
    function chooseTopic(cast) {
        const options = [];
        const add = (weight, path, extra) => {
            if (weight > 0 && has(path)) options.push({ weight, path, extra: extra || null });
        };

        // News first, and only once: it stops being news the moment it is out.
        const pending = takePending();
        if (pending) return { path: 'script.' + pending.topic, extra: pending.ctx };

        if (everyoneBattered()) add(30, 'script.battered');
        if (everyoneRunDown()) add(28, 'script.needAll');

        // Whichever of the two has something on their mind; the speaker's own
        // want first, since they are the one who opened their mouth.
        const need = pressingNeed(cast[0]) || pressingNeed(cast[1]);
        if (need) add(20, 'script.need.' + need);

        const recent = recentTopic();
        if (recent) add(32, 'script.recent.' + recent.kind, Object.assign({ _sig: recent.signature }, recent.params));

        const family = biomeFamily(biomeId());
        if (family) add(24, 'script.biome.' + family);

        add(26, 'script.general');

        // The personality route is not a script at all: one archetype opens and
        // the other answers, which is where most of the variance comes from.
        options.push({ weight: 34, path: null, extra: null });

        const total = options.reduce((sum, option) => sum + option.weight, 0);
        if (total <= 0) return null;
        let roll = Math.random() * total;
        for (const option of options) {
            roll -= option.weight;
            if (roll <= 0) return option;
        }
        return options[options.length - 1];
    }

    // ----------------------------------------------------------------- beats
    // A closer out of somebody's personality: the third member if there is one,
    // otherwise whoever is not holding the floor. This is what stops two
    // scripted lines from reading the same way every time they come up.
    // `onlySilent` is for a topic where everybody has already had their say (the
    // purchase, where each member gives their own opinion): there, the last word
    // only goes to somebody who has not spoken yet, and otherwise nobody takes
    // it rather than one member answering themselves.
    function appendCloser(beats, cast, onlySilent) {
        const last = beats.length ? beats[beats.length - 1].who : -1;
        const spoken = new Set(beats.map((beat) => beat.who));
        const candidates = [];
        for (let i = 0; i < cast.length; i++) {
            if (i === last) continue;
            if (onlySilent && spoken.has(i)) continue;
            candidates.push(i);
        }
        if (!candidates.length) return;
        // A third member standing there gets the last word more often than not:
        // somebody listening in is exactly who would.
        const who = (cast.length > 2 && candidates.includes(2) && Math.random() < 0.6)
            ? 2 : candidates[Math.floor(Math.random() * candidates.length)];
        const line = pick(personalPool(cast[who], 'closer'));
        if (line) beats.push({ who, text: line });
    }

    function scriptBeats(entry, cast, ctx) {
        const lines = Array.isArray(entry) ? entry : [entry];
        const beats = [];
        for (let i = 0; i < lines.length; i++) {
            const text = fill(String(lines[i]), ctx);
            if (unresolved(text)) return null;   // a token nothing answered
            beats.push({ who: i % cast.length, text });
        }
        return beats;
    }

    // The purchase. One member states what was bought, and then every other
    // member judges it out of their own archetype, which is the whole point of
    // the topic: the Disciplined one and the Hedonistic one are looking at the
    // same receipt and seeing two different mistakes.
    function shopBeats(cast, ctx) {
        const opening = pick(pool('shop.opener'));
        if (!opening) return null;
        const first = fill(opening, ctx);
        if (unresolved(first)) return null;
        const beats = [{ who: 0, text: first }];
        const judges = [1];
        if (cast.length > 2) judges.push(2);
        else if (Math.random() < 0.45) judges.push(0);
        for (const who of judges) {
            const line = pick(personalPool(cast[who], 'shop.opinion'));
            if (!line) continue;
            const text = fill(line, ctx);
            if (!unresolved(text)) beats.push({ who, text });
        }
        return beats.length >= 2 ? beats : null;
    }

    function personalityBeats(cast, ctx) {
        const opener = pick(personalPool(cast[0], 'opener'));
        if (!opener) return null;
        const reply = pick(personalPool(cast[1], 'reply'));
        if (!reply) return null;
        const first = fill(opener, ctx);
        const second = fill(reply, ctx);
        if (unresolved(first) || unresolved(second)) return null;
        return [{ who: 0, text: first }, { who: 1, text: second }];
    }

    // ------------------------------------------------------------------- API
    const PartyBanter = {
        active,
        personalityKey,
        noteEvent,

        // The whole exchange, in order. `cast` is the party members standing in
        // it, speaker first; `who` on each beat indexes back into it, so the
        // caller decides which character on the map says what.
        discussion(cast) {
            if (!active()) return null;
            const people = (cast || []).filter((actor) => !!actor);
            if (people.length < 2) return null;

            const ctx = baseContext(people);
            for (let attempt = 0; attempt < 4; attempt++) {
                const topic = chooseTopic(people);
                if (!topic) return null;

                let beats;
                const merged = mergeContext(ctx, topic.extra);
                if (!topic.path) {
                    beats = personalityBeats(people, ctx);
                } else if (topic.path === 'script.shop') {
                    beats = shopBeats(people, merged);
                } else {
                    const entry = pick(pool(topic.path));
                    if (!entry) continue;
                    beats = scriptBeats(entry, people, merged);
                    if (beats && topic.extra && topic.extra._sig) _lastRecent = topic.extra._sig;
                }
                if (!beats || beats.length < 2) continue;

                // Most exchanges get a personality-flavoured last word; a party
                // that always ran to four beats would read as a stage play.
                if (beats.length < 4 && Math.random() < 0.55) {
                    appendCloser(beats, people, topic.path === 'script.shop');
                }
                return beats;
            }
            return null;
        },

        // One bubble, on their own. `key` is either a bare kind ("thought") or
        // the full AutoIdle key the caller already had ("AutoIdle.loose.thought",
        // "AutoIdle.loose.need.hunger"), so the caller does not have to
        // translate. Answers null when the party is one person, which leaves
        // the caller on its own generic bank.
        solo(actor, key) {
            if (!active() || !actor || !key) return null;
            const kind = String(key).replace(/^AutoIdle\.loose\./, '');
            if (kind === 'reply') return null;            // that is the town's line
            if (kind === 'greet') return this.strangerGreet(actor);
            if (!/^[\w.]+$/.test(kind)) return null;
            const section = 'solo.' + kind;
            const archetype = personalityKey(actor);
            const own = archetype ? pool(section + '.' + archetype) : [];
            const line = pick(own.length ? own : pool(section + '.any'));
            if (!line) return null;
            const text = fill(line, baseContext([actor]));
            return unresolved(text) ? null : text;
        },

        // How this member opens with somebody who is not one of their own. The
        // stranger's answer stays where it was: it is the town's line, not the
        // party's.
        strangerGreet(actor) {
            if (!active() || !actor) return null;
            const line = pick(personalPool(actor, 'stranger'));
            if (!line) return null;
            const text = fill(line, baseContext([actor]));
            return unresolved(text) ? null : text;
        },

        // Something was bought. Queued rather than said: the counter is a
        // separate scene, and the party has its opinions on the way out.
        noteShopBuy(item, price, place) {
            noteEvent('shop', {
                item: item || '',
                price: price || '',
                shop: place || placeLabel(),
            });
        },
    };

    window.PartyBanter = PartyBanter;

    // ------------------------------------------------------- counter hooks
    // A visit to a counter is one purchase as far as the party is concerned:
    // the thing they will argue about is the most expensive item on the bill,
    // not the six potions underneath it.
    const _Scene_Shop_create = Scene_Shop.prototype.create;
    Scene_Shop.prototype.create = function () {
        _Scene_Shop_create.call(this);
        this._banterBest = null;
    };

    const _Scene_Shop_doBuy = Scene_Shop.prototype.doBuy;
    Scene_Shop.prototype.doBuy = function (number) {
        _Scene_Shop_doBuy.call(this, number);
        const count = Number(number) || 0;
        if (!this._item || count <= 0) return;
        const spent = count * (this.buyingPrice ? this.buyingPrice() : 0);
        if (!this._banterBest || spent > this._banterBest.spent) {
            this._banterBest = { name: this._item.name, spent, count };
        }
    };

    const _Scene_Shop_terminate = Scene_Shop.prototype.terminate;
    Scene_Shop.prototype.terminate = function () {
        const best = this._banterBest;
        this._banterBest = null;
        _Scene_Shop_terminate.call(this);
        if (best) PartyBanter.noteShopBuy(best.name, String(best.spent), placeLabel());
    };

    // Stockbusters and anything else that sells without a counter announces
    // itself through the diary; the party hears about the parcel the same way.
    const _hookOrder = () => {
        if (!window.Diary || !window.Diary.onOrderPlaced || window.Diary._banterHooked) return;
        window.Diary._banterHooked = true;
        const original = window.Diary.onOrderPlaced;
        window.Diary.onOrderPlaced = function (item, price, delivered) {
            original.call(this, item, price, delivered);
            PartyBanter.noteShopBuy(item, String(price || ''), '');
        };
    };
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start.call(this);
        _hookOrder();
    };
})();
