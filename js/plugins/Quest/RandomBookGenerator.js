/*:
 * @target MZ
 * @plugindesc Generates random book titles and statue descriptions (seeded by location). Supports English and Italian.
 * @author Omni-Lex & OmniLex
 * @help This plugin creates message boxes displaying random book titles or statue descriptions
 * whenever called. The selection is deterministic based on mapID, event position,
 * and the first letter of the player name.
 *
 * === LINKING SYSTEM ===
 * Multiple events can share the same description by naming them with a link prefix:
 * - Event names: "link-1", "link-test", "link-3", etc.
 * - All events with the same link identifier (e.g., "link-1") will show identical descriptions
 * - The first event with that link name determines the seed for all linked events
 * - Example: Three events named "link-paint1" will all show the same painting description
 *
 * === LANGUAGE SUPPORT ===
 * To set the language to Italian, use the 'Script' event command and enter:
 * ConfigManager.language = "it";
 *
 * Make sure to do this before calling the plugin commands.
 *
 * Plugin Commands:
 * ShowRandomBook - Shows a message box with random book information
 * ShowStatueDescription - Shows a message box with random statue description
 * ShowPaintingDescription - Shows a message box with random painting description
 *
 * @command ShowRandomBook
 * @desc Display a random book in a message box
 *
 * @command ShowStatueDescription
 * @desc Display a random statue description in a message box
 * @arg subject
 * @text Statue Subject
 * @desc The subject/theme of the statue (optional - will be random if empty)
 * @type string
 * @default
 * @arg subjectIt
 * @text Statue Subject IT
 * @desc The it subject/theme of the statue (optional - will be random if empty)
 * @type string
 * @default
 *
 * @command ShowPaintingDescription
 * @desc Display a random painting in a message box
 * @arg subject
 * @text Painting Subject
 * @desc The subject/theme of the painting (optional - will be random if empty)
 * @type string
 * @default
* @arg subjectIt
 * @text Painting Subject IT
 * @desc The it subject/theme of the painting (optional - will be random if empty)
 * @type string
 * @default
 *
 * @command ShowFossilDescription
 * @desc Display a random fossil specimen description in a message box
 * @arg type
 * @text Fossil Type
 * @desc amber, dinosaur, weird ,  leave empty for random
 * @type string
 * @default
 *
 * @command ShowMaskDescription
 * @desc Display a random ritual/tribal mask description in a message box
 * @arg subject
 * @text Mask Subject
 * @desc The subject/theme of the mask (optional - will be random if empty)
 * @type string
 * @default
 */

(() => {
    const pluginName = "RandomBookGenerator";

    // === Seeded RNG util (mulberry32) ===
    function createSeededRNG() {
        const mapId    = $gameMap.mapId();
        const x        = $gamePlayer.x;
        const y        = $gamePlayer.y;
        
        let historySeed = 19002001;
        if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
            historySeed = window.HistoryManager.getSeed();
        } else if ($gameSystem && $gameSystem._historySeed !== undefined) {
            historySeed = $gameSystem._historySeed;
        }
        
        // combine into a 32-bit seed using historySeed instead of player name initial
        let seed = (mapId * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ historySeed;
        seed = seed >>> 0;
        // mulberry32 PRNG
        return (function(a) {
            return function() {
                var t = a += 0x6D2B79F5;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        })(seed);
    }

    // === Text wrapping util ===
    function wrapText(text, maxChars) {
        const result = [];
        // Preserve any explicit line breaks already present in the text.
        for (const paragraph of String(text).split('\n')) {
            let line = '';
            for (const word of paragraph.split(' ')) {
                if (word === '') continue;
                if (line === '') {
                    line = word;
                } else if ((line + ' ' + word).length > maxChars) {
                    result.push(line);
                    line = word;
                } else {
                    line += ' ' + word;
                }
            }
            result.push(line);
        }
        return result.join('\n');
    }

    // === Historical-date helpers ===
    // Stored event dates come in two shapes: clean ISO ("1914-06-28",
    // "1901-08") from the world simulation, and messy real-time stamps
    // ("07 NaN 2001 21:47") from NPC life events (Variable 113, whose month can
    // legacy-corrupt to NaN). Pull a clean value out of either.
    function extractYear(rawDate) {
        const s = String(rawDate == null ? '' : rawDate);
        const tokens = s.match(/\d{3,4}/g);
        if (tokens && tokens.length) {
            return tokens.find(t => t.length === 4) || tokens[tokens.length - 1];
        }
        return s.replace(/\bNaN\b/gi, '').trim();
    }

    function displayDate(rawDate) {
        const s = String(rawDate == null ? '' : rawDate).trim();
        // Clean ISO date (year-month or year-month-day): show as-is.
        if (/^\d{3,4}-\d{1,2}(-\d{1,2})?$/.test(s)) return s;
        // Anything else (real-time stamp, possibly carrying NaN): use the year.
        return extractYear(s) || s.replace(/\bNaN\b/gi, '').trim();
    }

    // NPC life events embed the actor as "[Name] did something". Colorise the
    // name and drop the brackets. restoreColor is re-applied after the name so
    // the rest of the line keeps its surrounding colour.
    function highlightNames(text, restoreColor) {
        const restore = restoreColor || '\\C[0]';
        return String(text == null ? '' : text)
            .replace(/\[([^\]\n]+)\]/g, '\\C[14]$1' + restore);
    }

    // === Paged message display ===
    // The default MZ message window only shows 4 lines, so long descriptions get
    // clipped. We split the text into pages and queue them so each is shown in
    // sequence (advanced by the player) instead of being silently cut off.
    const MSG_MAX_LINES = 4;
    const _pageQueue = [];

    function paginate(text, maxLines) {
        const lines = String(text).split('\n');
        const pages = [];
        for (let i = 0; i < lines.length; i += maxLines) {
            pages.push(lines.slice(i, i + maxLines).join('\n'));
        }
        return pages.length ? pages : [''];
    }

    function addPagedMessage(page) {
        window.skipLocalization = true;
        $gameMessage.add(page);
        window.skipLocalization = false;
    }

    // ==========================================================================
    // Reading is a pleasure
    // ==========================================================================
    // A generated book, inscription, painting, mask or fossil card is a small
    // pleasure for whoever stopped to read it, and for the people standing
    // around while they do: the whole party takes a fifth of a Fun meter off it.
    //
    // It pays once per thing. The text is seeded off where the thing stands and
    // never changes, so a second look is a re-read, and a message box that could
    // be mashed would be the cheapest leisure in the game. What has been read is
    // remembered in the save, capped so a long game cannot grow the file without
    // bound — forgetting the oldest few hundred readings only means a statue
    // somebody read a very long time ago is worth reading again.
    const READING_FUN = 20;
    const READING_MEMORY = 500;

    // What identifies the thing being read: the event it hangs on where there is
    // one, and otherwise where the reader is standing — which is what the text
    // itself is seeded off, so the key changes exactly when the reading does.
    function readingKey(kind, id) {
        const mapId = $gameMap ? $gameMap.mapId() : 0;
        if (id !== null && id !== undefined && id !== "") return `${kind}:${mapId}:${id}`;
        const x = $gamePlayer ? $gamePlayer.x : 0;
        const y = $gamePlayer ? $gamePlayer.y : 0;
        return `${kind}:${mapId}:${x},${y}`;
    }

    function payReadingFun(kind, eventId) {
        if (!$gameSystem || !$gameParty) return;
        const key = readingKey(kind, eventId);
        const log = ($gameSystem._readFunLog = $gameSystem._readFunLog || []);
        if (log.includes(key)) return;
        log.push(key);
        while (log.length > READING_MEMORY) log.shift();

        const needs = window.PartyNeeds;
        if (!needs || typeof needs.addLeisureToAll !== "function") return;
        needs.addLeisureToAll(READING_FUN);
        try {
            if (window.ParchmentToast) window.ParchmentToast.need("leisure", READING_FUN);  // i18n-ignore  need id
        } catch (e) { /* the Fun is paid whether or not it is announced */ }
    }

    // Show text across as many message boxes as needed. colorPrefix (e.g. "\\C[6]")
    // is re-applied at the start of every page so coloring survives the page break.
    function showPaged(text, colorPrefix) {
        const prefix = colorPrefix || '';
        const pages = paginate(text, MSG_MAX_LINES).map(p => prefix + p);
        addPagedMessage(pages.shift());
        for (const p of pages) _pageQueue.push(p);
    }

    // When a message closes, feed the next queued page back into $gameMessage so
    // the window reopens for it. The queue is only ever populated by this plugin.
    const _Window_Message_terminateMessage = Window_Message.prototype.terminateMessage;
    Window_Message.prototype.terminateMessage = function() {
        _Window_Message_terminateMessage.call(this);
        if (_pageQueue.length > 0) {
            addPagedMessage(_pageQueue.shift());
        }
    };

    // ==================================
    // === ENGLISH LANGUAGE RESOURCES ===
    // ==================================

    // Every word a generated book, painting, mask or fossil is described with
    // lives in js/i18n/<lang>/conversations/ConvBooks.json. The banks below are
    // lazy views onto it, re-resolved when the language changes.
    let _bookBankLang = null;
    const _bookBankCache = new Map();
    function bookBank(key) {
        const lang = T.language();
        if (lang !== _bookBankLang) { _bookBankLang = lang; _bookBankCache.clear(); }
        // These banks are randomised pools, so a language that offers fewer
    // entries keeps its own list whole instead of showing English in the gaps.
    if (!_bookBankCache.has(key)) _bookBankCache.set(key, T.pool(key));
        return _bookBankCache.get(key);
    }
    const titlePrefixes = () => bookBank('ConvBooks.titlePrefixes');
    const titleNouns = () => bookBank('ConvBooks.titleNouns');
    const titleAdjectives = () => bookBank('ConvBooks.titleAdjectives');
    const titleSubjects = () => bookBank('ConvBooks.titleSubjects');
    const titleConnectors = () => bookBank('ConvBooks.titleConnectors');
    const firstNames = () => bookBank('ConvBooks.firstNames');
    const lastNames = () => bookBank('ConvBooks.lastNames');
    const titleParticles = () => bookBank('ConvBooks.titleParticles');
    const descriptionPatterns = () => bookBank('ConvBooks.descriptionPatterns');
    const characters = () => bookBank('ConvBooks.characters');
    const objects = () => bookBank('ConvBooks.objects');
    const locations = () => bookBank('ConvBooks.locations');
    const events = () => bookBank('ConvBooks.events');
    const secrets = () => bookBank('ConvBooks.secrets');
    const themes = () => bookBank('ConvBooks.themes');
    const concepts = () => bookBank('ConvBooks.concepts');
    const adversities = () => bookBank('ConvBooks.adversities');
    const consequences = () => bookBank('ConvBooks.consequences');
    const sacrifices = () => bookBank('ConvBooks.sacrifices');
    const genres = () => bookBank('ConvBooks.genres');
    const adjectives = () => bookBank('ConvBooks.adjectives');
    const middleInitials = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // ==================================
    // === STATUE RESOURCES (ENGLISH) ===
    // ==================================

    const statueSubjects = () => bookBank('ConvBooks.statueSubjects');
    const statueMaterials = () => bookBank('ConvBooks.statueMaterials');
    const statueAdjectives = () => bookBank('ConvBooks.statueAdjectives');
    const statuePoses = () => bookBank('ConvBooks.statuePoses');
    const statueFeatures = () => bookBank('ConvBooks.statueFeatures');
    const statueLocations = () => bookBank('ConvBooks.statueLocations');
    const statueConditions = () => bookBank('ConvBooks.statueConditions');
    const statueHistories = () => bookBank('ConvBooks.statueHistories');

    const statueDescriptionPatterns = () => bookBank('ConvBooks.statueDescriptionPatterns');

    // ==================================
    // === ITALIAN LANGUAGE RESOURCES ===
    // ==================================

    // ==================================
    // === STATUE RESOURCES (ITALIAN) ===
    // ==================================


// ==================================
// === PAINTING RESOURCES (ENGLISH) ===
// ==================================

const paintingSubjects = () => bookBank('ConvBooks.paintingSubjects');

const paintingStyles = () => bookBank('ConvBooks.paintingStyles');

const paintingColors = () => bookBank('ConvBooks.paintingColors');

const paintingTechniques = () => bookBank('ConvBooks.paintingTechniques');

const paintingMoods = () => bookBank('ConvBooks.paintingMoods');

const paintingCompositions = () => bookBank('ConvBooks.paintingCompositions');

const weirdPaintingElements = () => bookBank('ConvBooks.weirdPaintingElements');

const abstractConcepts = () => bookBank('ConvBooks.abstractConcepts');

const paintingDescriptionPatterns = () => bookBank('ConvBooks.paintingDescriptionPatterns');

// ==================================
// === PAINTING RESOURCES (ITALIAN) ===
// ==================================










// ==================================
// === MASK RESOURCES (ENGLISH) ===
// ==================================

const maskSubjects = () => bookBank('ConvBooks.maskSubjects');
const maskMaterials = () => bookBank('ConvBooks.maskMaterials');
const maskDecorations = () => bookBank('ConvBooks.maskDecorations');
const maskStyles = () => bookBank('ConvBooks.maskStyles');
const maskFunctions = () => bookBank('ConvBooks.maskFunctions');
const maskOrigins = () => bookBank('ConvBooks.maskOrigins');

const maskDescriptionPatterns = () => bookBank('ConvBooks.maskDescriptionPatterns');

// ==================================
// === MASK RESOURCES (ITALIAN) ===
// ==================================


// Extract link ID from event name (format: "link-X" where X is the identifier)
function extractLinkId(eventId) {
    const event = $dataMap.events[eventId];
    if (!event || !event.name) return null;

    // Match event names like "link-1", "link-test", "link-paint1", etc.
    const match = event.name.match(/^link-(.+)$/i);
    return match ? match[1].toLowerCase() : null;
}

// Find the first event in the current map with the given link ID
function findFirstEventWithLinkId(linkId) {
    if (!linkId) return null;

    // Search for the first event with a matching link name
    for (let i = 1; i < $dataMap.events.length; i++) {
        if ($dataMap.events[i] && extractLinkId(i) === linkId) {
            return i;
        }
    }
    return null;
}

// Find the first event on the current map that shares the same note text
function findFirstEventWithSameNote(currentEventId) {
    const event = $dataMap.events[currentEventId];
    if (!event || !event.note || event.note.trim() === '') return currentEventId;

    const targetNote = event.note.trim();
    for (let i = 1; i < $dataMap.events.length; i++) {
        const e = $dataMap.events[i];
        if (e && e.note && e.note.trim() === targetNote) {
            return i; // first event with the same note wins
        }
    }
    return currentEventId;
}

// Get the seed source event ID (either current event or first linked event)
function getSeedSourceEventId(currentEventId) {
    // Priority 1: explicit link-name system ("link-X" event name)
    const linkId = extractLinkId(currentEventId);
    if (linkId) {
        const firstEventId = findFirstEventWithLinkId(linkId);
        return firstEventId || currentEventId;
    }
    // Priority 2: matching event note ,  use the first event that has the same note
    return findFirstEventWithSameNote(currentEventId);
}

// === Modified Seeded RNG Function ===
// Replace the existing createSeededRNG function with this version
function createSeededRNG(eventId = null) {
    const mapId = $gameMap.mapId();
    
    let historySeed = 19002001;
    if (window.HistoryManager && typeof window.HistoryManager.getSeed === 'function') {
        historySeed = window.HistoryManager.getSeed();
    } else if ($gameSystem && $gameSystem._historySeed !== undefined) {
        historySeed = $gameSystem._historySeed;
    }

    // Use event-based seeding if eventId is provided
    if (eventId !== null) {
        const sourceEventId = getSeedSourceEventId(eventId);
        const sourceEvent = $dataMap.events[sourceEventId];
        
        if (sourceEvent) {
            const x = sourceEvent.x;
            const y = sourceEvent.y;
            
            // Use source event's position for consistent seeding across linked events
            let seed = (mapId * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ historySeed ^ sourceEventId;
            seed = seed >>> 0;
            
            return (function(a) {
                return function() {
                    var t = a += 0x6D2B79F5;
                    t = Math.imul(t ^ (t >>> 15), t | 1);
                    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
            })(seed);
        }
    }
    
    // Fallback to player-based seeding (original behavior)
    const x = $gamePlayer.x;
    const y = $gamePlayer.y;
    let seed = (mapId * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ historySeed;
    seed = seed >>> 0;
    
    return (function(a) {
        return function() {
            var t = a += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    })(seed);
}
    // === Game-data pools (monsters, items, world locations) ===
    // These augment the static word lists with live game content so book,
    // statue, painting and mask text can reference real monsters, items and
    // world locations. Built lazily and cached on first non-empty result
    // (game data is loaded by the time any description is requested; if a
    // pool is still empty we retry next call instead of caching nothing).
    function pushDbNames(out, db) {
        if (!db) return;
        for (const entry of db) {
            if (!entry || !entry.name) continue;
            const name = String(entry.name).trim();
            // Skip blanks and the "<-- 1-10 -->" divider rows used in the database.
            if (name === '' || name.startsWith('<--')) continue;
            out.push(name);
        }
    }

    let _monsterSubjectsCache = null;
    function getMonsterSubjects() {
        if (_monsterSubjectsCache && _monsterSubjectsCache.length) return _monsterSubjectsCache;
        const out = [];
        pushDbNames(out, typeof $dataEnemies !== 'undefined' ? $dataEnemies : null);
        _monsterSubjectsCache = out;
        return out;
    }

    let _dataObjectsCache = null;
    function getDataObjects() {
        if (_dataObjectsCache && _dataObjectsCache.length) return _dataObjectsCache;
        const out = [];
        pushDbNames(out, typeof $dataItems  !== 'undefined' ? $dataItems  : null);
        pushDbNames(out, typeof $dataArmors !== 'undefined' ? $dataArmors : null);
        pushDbNames(out, typeof $dataWeapons !== 'undefined' ? $dataWeapons : null);
        _dataObjectsCache = out;
        return out;
    }

    let _dataLocationsCache = null;
    function getDataLocations() {
        if (_dataLocationsCache && _dataLocationsCache.length) return _dataLocationsCache;
        const out = [];
        const dest = window.WorkSystem && window.WorkSystem.Destinations;
        if (dest && typeof dest === 'object') {
            // A book names a place the way the player knows it, so each entry
            // contributes its readable "name" rather than its file key.
            for (const key of Object.keys(dest)) {
                const n = String(window.WorkSystem.destinationName
                    ? window.WorkSystem.destinationName(key) : key).trim();
                if (n === '' || n.startsWith('<--')) continue;
                out.push(n);
            }
        }
        _dataLocationsCache = out;
        return out;
    }

    // === Historical (lore) event pool ===
    // Only the world simulation's own lore is book material: wars, coups,
    // conquests, anomalies, artifact discoveries. NPCSimulationCore feeds the
    // per-NPC life log into the very same events array ("[Someone] has reached
    // level 19"); that is village gossip, not history, so it is filtered out
    // here once for books, statues and paintings alike.
    const NON_LORE_TYPES = ['npc_life'];

    function isLoreEvent(e) {
        if (!e || typeof e.description !== 'string' || e.description.trim() === '') return false;
        if (NON_LORE_TYPES.indexOf(e.type) >= 0) return false;
        // NPC entries embed the actor as "[Name] did something"; older logs may
        // carry no type at all, so match on the shape too.
        if (/^\s*\[/.test(e.description)) return false;
        // Must be datable, otherwise it cannot be attributed to a year.
        return /\d{3,4}/.test(String(e.date == null ? '' : e.date));
    }

    function getLoreEvents() {
        // Named apart from the `events` phrase bank above: this is the history
        // log, not a book-title word list.
        let log = null;
        if (window.HistoryManager && typeof window.HistoryManager.getEvents === 'function') {
            log = window.HistoryManager.getEvents();
        } else if (typeof $gameSystem !== 'undefined' && $gameSystem) {
            log = $gameSystem._historicalEvents;
        }
        return Array.isArray(log) ? log.filter(isLoreEvent) : [];
    }

    function getRandomHistoryEvent(random) {
        const pool = getLoreEvents();
        if (pool.length === 0) return null;
        return pool[Math.floor(random() * pool.length)];
    }

    // Reduce a raw history description to one readable clause so it can be
    // embedded mid-sentence. Fixed events carry a headline plus follow-up
    // sentences ("WWI BEGINS: ... . The alliance systems ... ."); only the
    // headline is quoted, and the trailing full stop is dropped.
    function eventClause(rawDesc) {
        let s = String(rawDesc == null ? '' : rawDesc).trim();
        const firstStop = s.search(/\.\s+\S/);
        if (firstStop > 0) s = s.slice(0, firstStop);
        return s.replace(/[.\s]+$/, '');
    }

    // === Historical book resources ===
    // The editorial character of the volume. Combined with the shared adjective
    // pools these are the "generated description" half of a history book blurb;
    // the other half is always the lore event itself and its year.
    const historyBookForms = () => bookBank('ConvBooks.historyBookForms');
    const historyBookNotes = () => bookBank('ConvBooks.historyBookNotes');
    const historyBookTitleTemplates = () => bookBank('ConvBooks.historyBookTitleTemplates');


    // Build "A <generated description> about how <lore event>, of <year>." The
    // varying half is the adjective/form/editorial note; the event and its year
    // are quoted verbatim from the simulation.
    // "A" / "An" by the sound of the next word, and the Italian "un" / "uno"
    // rule (uno before s+consonant, z, gn, ps, x). Which rule applies, and
    // which word is inspected, is language business.
    function indefiniteArticle(word) {
        if (T.language() === 'it') {
            return /^(s[^aeiou]|z|gn|ps|x)/i.test(word) ? T('ConvBooks.articleUno') : T('ConvBooks.articleUn');
        }
        return /^[aeiou]/i.test(word) ? T('ConvBooks.articleAn') : T('ConvBooks.articleA');
    }

    function generateHistoricalBook(random, histEvent) {
        const year = extractYear(histEvent.date);
        // Book text is drawn uncoloured, so any highlight restores to \C[0].
        const clause = eventClause(highlightNames(histEvent.description, '\\C[0]'));

        const pick = arr => arr[Math.floor(random() * arr.length)];
        const titleTemplates = historyBookTitleTemplates();
        const forms = historyBookForms();
        const notes = historyBookNotes();
        const adjs  = adjectives();

        const title = pick(titleTemplates).replace(/\{year\}/g, year);
        const form  = pick(forms);
        const note  = pick(notes);
        const adj   = pick(adjs);
        let adj2    = pick(adjs);
        if (adj2 === adj) adj2 = pick(adjs);

        // The indefinite article agrees with the word that follows it, and each
        // language picks a different word to agree with: English reads the
        // adjective, Italian the noun. {article} is resolved per language from
        // ConvBooks.historyBookArticleOf.
        const article = indefiniteArticle(T.language() === 'it' ? form : adj);

        const patterns = T.list('ConvBooks.historyBookPatterns');
        const filled = patterns.map(p => p
            .replace(/\{article\}/g, article)
            .replace(/\{form\}/g, form)
            .replace(/\{adj\}/g, adj)
            .replace(/\{adj2\}/g, adj2)
            .replace(/\{note\}/g, note)
            .replace(/\{clause\}/g, clause)
            .replace(/\{year\}/g, year));

        return { title, description: pick(filled) };
    }

    // Core function to display a random book with seeded randomness and wrapped text
    function displayRandomBook(eventId = null) {
        const random = createSeededRNG(eventId);
        const histEvent = getRandomHistoryEvent(random);
        
        let title, description;
        if (histEvent && random() < 0.35) { // chance to write about a lore event
            const book = generateHistoricalBook(random, histEvent);
            title = book.title;
            description = book.description;
        } else {
            title = generateTitle(random);
            description = generateDescription(random);
        }
        
        const author = generateAuthor(random);

        // Wrap each part, then color whole lines so the coloring survives paging.
        const titleLines = wrapText('"' + title + '"', 40)
            .split('\n').map(l => "\\C[4]" + l + "\\C[0]").join('\n');
        const authorLines = wrapText('by ' + author, 40)
            .split('\n').map(l => "\\C[3]" + l + "\\C[0]").join('\n');
        const descLines = wrapText(description, 40);

        const messageText = titleLines + '\n' + authorLines + '\n' + descLines;
        showPaged(messageText, '');
        payReadingFun("book", eventId);  // i18n-ignore  reading-log id
    }

    // Core function to display a statue description with seeded randomness
    function displayStatueDescription(customSubject = "", eventId = null) {
        const random = createSeededRNG(eventId);
        let description = generateStatueDescription(random, customSubject);
        description = wrapText(description, 40);
        showPaged(description, "\\C[6]");
        payReadingFun("statue", eventId);  // i18n-ignore  reading-log id
    }
    
    // Core function to display a painting description with seeded randomness
    function displayPaintingDescription(customSubject = "", eventId = null) {
        const random = createSeededRNG(eventId);
        let description = generatePaintingDescription(random, customSubject);
        description = wrapText(description, 40);
        showPaged(description, "\\C[5]");
        payReadingFun("painting", eventId);  // i18n-ignore  reading-log id
    }

// Core function to display a mask description with seeded randomness
function displayMaskDescription(customSubject = "", eventId = null) {
    const random = createSeededRNG(eventId);
    let description = generateMaskDescription(random, customSubject);
    description = wrapText(description, 40);
    showPaged(description, "\\C[2]");
    payReadingFun("mask", eventId);  // i18n-ignore  reading-log id
}

// Generate a deterministic mask description
function generateMaskDescription(random = Math.random, customSubject = "") {
    const patterns = maskDescriptionPatterns();
    let pattern = patterns[Math.floor(random() * patterns.length)];

    const subjects = (maskSubjects()).concat(getMonsterSubjects());
    const materials = maskMaterials();
    const decorations = maskDecorations();
    const styles = maskStyles();
    const functions = maskFunctions();
    const origins = maskOrigins();
    const adjs = adjectives();

    const map = {
        subject: customSubject || subjects[Math.floor(random() * subjects.length)],
        material: materials[Math.floor(random() * materials.length)],
        decoration: decorations[Math.floor(random() * decorations.length)],
        style: styles[Math.floor(random() * styles.length)],
        function: functions[Math.floor(random() * functions.length)],
        origin: origins[Math.floor(random() * origins.length)],
        adjective: adjs[Math.floor(random() * adjs.length)]
    };

    return pattern.replace(/\{(\w+)\}/g, (_, key) => {
        return map[key] || "";
    });
}

// Generate a deterministic painting description
function generatePaintingDescription(random = Math.random, customSubject = "") {
    const patterns = paintingDescriptionPatterns();
    let pattern = patterns[Math.floor(random() * patterns.length)];

    const subjects = (paintingSubjects()).concat(getMonsterSubjects());
    const styles = paintingStyles();
    const colors = paintingColors();
    const techniques = paintingTechniques();
    const moods = paintingMoods();
    const compositions = paintingCompositions();
    const weirdElements = weirdPaintingElements();
    const abstractConceptsArray = abstractConcepts();

    let selectedSubject;
    const histEvent = getRandomHistoryEvent(random);
    if (!customSubject && histEvent && random() < 0.25) { // 25% chance
        const dateStr = displayDate(histEvent.date);
        // Painting descriptions are shown with a \C[5] base colour.
        const descStr = highlightNames(histEvent.description, '\\C[5]');
        const templates = T.list('ConvBooks.paintingHistoryTemplates');
        selectedSubject = templates[Math.floor(random() * templates.length)]
            .replace(/\{event\}/g, descStr)
            .replace(/\{date\}/g, dateStr);
    } else {
        selectedSubject = customSubject || subjects[Math.floor(random() * subjects.length)];
    }

    const map = {
        subject: selectedSubject,
        style: styles[Math.floor(random() * styles.length)],
        colors: colors[Math.floor(random() * colors.length)],
        technique: techniques[Math.floor(random() * techniques.length)],
        mood: moods[Math.floor(random() * moods.length)],
        composition: compositions[Math.floor(random() * compositions.length)],
        weirdElement: weirdElements[Math.floor(random() * weirdElements.length)],
        abstractConcept: abstractConceptsArray[Math.floor(random() * abstractConceptsArray.length)]
    };

    return pattern.replace(/\{(\w+)\}/g, (_, key) => {
        return map[key] || "";
    });
}
    // Generate a deterministic title
    function generateTitle(random = Math.random) {
        const prefixes = titlePrefixes();
        const adjs = titleAdjectives();
        const nouns = titleNouns();
        const connectors = titleConnectors();
        const subjects = (titleSubjects()).concat(getMonsterSubjects());

        const choice = Math.floor(random() * 6);
        switch (choice) {
            case 0:
                return prefixes[Math.floor(random() * prefixes.length)] + " " +
                       adjs[Math.floor(random() * adjs.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)];
            case 1:
                return prefixes[Math.floor(random() * prefixes.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)] + " " +
                       connectors[Math.floor(random() * connectors.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)];
            case 2:
                return subjects[Math.floor(random() * subjects.length)] + " " +
                       connectors[Math.floor(random() * connectors.length)] + " " +
                       prefixes[Math.floor(random() * prefixes.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)];
            case 3:
                return adjs[Math.floor(random() * adjs.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)];
            case 4:
                return adjs[Math.floor(random() * adjs.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)] + " " +
                       connectors[Math.floor(random() * connectors.length)] + " " +
                       prefixes[Math.floor(random() * prefixes.length)] + " " +
                       adjs[Math.floor(random() * adjs.length)] + " " +
                       nouns[Math.floor(random() * nouns.length)];
            case 5:
                return prefixes[Math.floor(random() * prefixes.length)] + " " +
                       subjects[Math.floor(random() * subjects.length)] + "'s " +
                       nouns[Math.floor(random() * nouns.length)];
            default:
                return T('ConvBooks.untitled');
        }
    }

    // Generate a deterministic author
    function generateAuthor(random = Math.random) {
        const fNames = firstNames();
        const lNames = lastNames();
        const particles = titleParticles();

        const firstName  = fNames[Math.floor(random() * fNames.length)];
        const lastName   = lNames[Math.floor(random() * lNames.length)];
        const midInit    = middleInitials[Math.floor(random() * middleInitials.length)];
        const particle   = particles[Math.floor(random() * particles.length)];
        
        const format = Math.floor(random() * 7);
        const pseudonyms = T.pool('ConvBooks.pseudonyms');
        const nicknames = T.pool('ConvBooks.nicknames');

        switch (format) {
            case 0: return `${firstName} ${lastName}`;
            case 1: return `${firstName} ${midInit}. ${lastName}`;
            case 2:
                const mid2 = middleInitials[Math.floor(random() * middleInitials.length)];
                return `${firstName} ${midInit}. ${mid2}. ${lastName}`;
            case 3:
                const nick = nicknames[Math.floor(random() * 3)];
                return `${firstName} '${nick}' ${lastName}`;
            case 4: return `${firstName} ${particle} ${lastName}`;
            case 5: return pseudonyms[Math.floor(random() * pseudonyms.length)];
            case 6:
                const p1 = pseudonyms[Math.floor(random() * pseudonyms.length)];
                const p2 = pseudonyms[Math.floor(random() * pseudonyms.length)];
                return `${p1} ${p2}`;
            default: return `${firstName} ${lastName}`;
        }
    }

    // Generate a deterministic description
    function generateDescription(random = Math.random) {
        const patterns = descriptionPatterns();
        let pattern = patterns[Math.floor(random() * patterns.length)];
        
        const map = {
            character: characters(),
            object: (objects()).concat(getDataObjects()),
            location: locations().concat(getDataLocations()),
            event: events(),
            secret: secrets(),
            theme: themes(),
            concept: concepts(),
            adversity: adversities(),
            consequence: consequences(),
            sacrifice: sacrifices(),
            genre: genres(),
            adjective: adjectives()
        };

        return pattern.replace(/\{(\w+)\}/g, (_, key) => {
            const arr = map[key];
            return arr[Math.floor(random() * arr.length)];
        });
    }

    // Generate a deterministic statue description
    function generateStatueDescription(random = Math.random, customSubject = "") {
        const patterns = statueDescriptionPatterns();
        let pattern = patterns[Math.floor(random() * patterns.length)];

        const subjects = (statueSubjects()).concat(getMonsterSubjects());
        const materials = statueMaterials();
        const adjs = statueAdjectives();
        const poses = statuePoses();
        const features = statueFeatures();
        const locs = (statueLocations()).concat(getDataLocations());
        const conditions = statueConditions();
        const histories = statueHistories();

        let selectedHistory;
        const histEvent = getRandomHistoryEvent(random);
        if (histEvent && random() < 0.25) { // 25% chance
            const dateStr = displayDate(histEvent.date);
            // Statue descriptions are shown with a \C[6] base colour.
            const descStr = highlightNames(histEvent.description, '\\C[6]');
            const templates = T.list('ConvBooks.statueHistoryTemplates');
            selectedHistory = templates[Math.floor(random() * templates.length)]
                .replace(/\{event\}/g, descStr)
                .replace(/\{date\}/g, dateStr);
        } else {
            selectedHistory = histories[Math.floor(random() * histories.length)];
        }

        const map = {
            subject: customSubject || subjects[Math.floor(random() * subjects.length)],
            material: materials[Math.floor(random() * materials.length)],
            adjective: adjs[Math.floor(random() * adjs.length)],
            pose: poses[Math.floor(random() * poses.length)],
            feature: features[Math.floor(random() * features.length)],
            location: locs[Math.floor(random() * locs.length)],
            condition: conditions[Math.floor(random() * conditions.length)],
            history: selectedHistory
        };

        return pattern.replace(/\{(\w+)\}/g, (_, key) => {
            return map[key] || "";
        });
    }
    // ============================================================
    // === FOSSIL RESOURCES (ENGLISH) ===
    // ============================================================

    // --- Amber ---
    const amberInsects = () => bookBank('ConvBooks.amberInsects');
    const amberPlant = () => bookBank('ConvBooks.amberPlant');
    const amberVertebrate = () => bookBank('ConvBooks.amberVertebrate');
    const amberRare = () => bookBank('ConvBooks.amberRare');
    const amberColors = () => bookBank('ConvBooks.amberColors');
    const amberOrigins = () => bookBank('ConvBooks.amberOrigins');
    const amberSizes = () => bookBank('ConvBooks.amberSizes');
    const amberPreservation = () => bookBank('ConvBooks.amberPreservation');
    const amberDetails = () => bookBank('ConvBooks.amberDetails');

    const amberDescriptionPatterns = () => bookBank('ConvBooks.amberDescriptionPatterns');

    // --- Dinosaur bones ---
    const dinoSpecies = () => bookBank('ConvBooks.dinoSpecies');
    const dinoBoneParts = () => bookBank('ConvBooks.dinoBoneParts');
    const dinoPeriods = () => bookBank('ConvBooks.dinoPeriods');
    const dinoMatrix = () => bookBank('ConvBooks.dinoMatrix');
    const dinoPreservation = () => bookBank('ConvBooks.dinoPreservation');
    const dinoSizes = () => bookBank('ConvBooks.dinoSizes');
    const dinoDetails = () => bookBank('ConvBooks.dinoDetails');

    const dinoDescriptionPatterns = () => bookBank('ConvBooks.dinoDescriptionPatterns');

    // --- Weird creatures ---
    const weirdCreatureTypes = () => bookBank('ConvBooks.weirdCreatureTypes');
    const weirdAges = () => bookBank('ConvBooks.weirdAges');
    const weirdMatrix = () => bookBank('ConvBooks.weirdMatrix');
    const weirdPreservation = () => bookBank('ConvBooks.weirdPreservation');
    const weirdDetails = () => bookBank('ConvBooks.weirdDetails');

    const weirdDescriptionPatterns = () => bookBank('ConvBooks.weirdDescriptionPatterns');

    // --- Italian translations ---

    function generateFossilDescription(random, fossilType) {
        const types = ['amber', 'dinosaur', 'weird'];
        const type = fossilType && types.includes(fossilType) ? fossilType : types[Math.floor(random() * types.length)];

        function pick(arr) { return arr[Math.floor(random() * arr.length)]; }

        if (type === 'amber') {
            const allInclusions = [
                ...amberInsects(),
                ...amberPlant(),
            ];
            if (random() < 0.15) allInclusions.push(...amberRare);
            if (random() < 0.10) allInclusions.push(...amberVertebrate);
            const pattern = pick(amberDescriptionPatterns());
            return pattern
                .replace(/\{color\}/g,        pick(amberColors()))
                .replace(/\{origin\}/g,       pick(amberOrigins()))
                .replace(/\{size\}/g,         pick(amberSizes()))
                .replace(/\{inclusion\}/g,    pick(allInclusions))
                .replace(/\{preservation\}/g, pick(amberPreservation()))
                .replace(/\{detail\}/g,       pick(amberDetails()));
        }

        if (type === 'dinosaur') {
            const pattern = pick(dinoDescriptionPatterns());
            return pattern
                .replace(/\{preservation\}/g, pick(dinoPreservation()))
                .replace(/\{bone\}/g,    pick(dinoBoneParts()))
                .replace(/\{species\}/g, pick(dinoSpecies()))
                .replace(/\{period\}/g,  pick(dinoPeriods()))
                .replace(/\{matrix\}/g,  pick(dinoMatrix()))
                .replace(/\{size\}/g,    pick(dinoSizes()))
                .replace(/\{detail\}/g,  pick(dinoDetails()));
        }

        // weird
        const pattern = pick(weirdDescriptionPatterns());
        return pattern
            .replace(/\{matrix\}/g,       pick(weirdMatrix()))
            .replace(/\{age\}/g,          pick(weirdAges()))
            .replace(/\{creature\}/g,     pick(weirdCreatureTypes()))
            .replace(/\{preservation\}/g, pick(weirdPreservation()))
            .replace(/\{detail\}/g,       pick(weirdDetails()));
    }

    function displayFossilDescription(fossilType, eventId) {
        const random = createSeededRNG(eventId);
        const text   = wrapText(generateFossilDescription(random, fossilType), 40);
        showPaged("\\C[6][ FOSSIL SPECIMEN ]\\C[0]\n" + text, '');
        payReadingFun("fossil", eventId);  // i18n-ignore  reading-log id
    }

    const RAMAN_PROBE_ID = 141;

    function handleRamanChoice(onCheck, onAnalyze) {
        if ($gameParty.hasItem($dataItems[RAMAN_PROBE_ID])) {
            const choices = T.list('ConvBooks.ramanChoices');
            
            $gameMessage.setChoices(choices, 0, 0);
            $gameMessage.setChoiceBackground(0);
            $gameMessage.setChoicePositionType(2);
            $gameMessage.setChoiceCallback(n => {
                if (n === 0) onCheck();
                if (n === 1) onAnalyze();
            });
        } else {
            onCheck();
        }
    }

    // Plugin command handlers
    PluginManager.registerCommand(pluginName, "ShowRandomBook", args => {
        const eventId = $gameMap._interpreter ? $gameMap._interpreter._eventId : null;
        displayRandomBook(eventId);
    });
    

    PluginManager.registerCommand(pluginName, "ShowStatueDescription", function(args) {
        const subject = args.subject || "";
        const eventId = this._eventId;
        handleRamanChoice.call(this, 
            () => displayStatueDescription(subject, eventId),
            () => PluginManager.callCommand(this, 'RamanSpectroscopy', 'ScanFront', {})
        );
    });
    
    PluginManager.registerCommand(pluginName, "ShowPaintingDescription", function(args) {
        const subject = args.subject || "";
        const eventId = this._eventId;
        handleRamanChoice.call(this, 
            () => displayPaintingDescription(subject, eventId),
            () => PluginManager.callCommand(this, 'RamanSpectroscopy', 'ScanFront', {})
        );
    });

    PluginManager.registerCommand(pluginName, "ShowMaskDescription", function(args) {
        const subject = args.subject || "";
        const eventId = this._eventId;
        handleRamanChoice.call(this, 
            () => displayMaskDescription(subject, eventId),
            () => PluginManager.callCommand(this, 'RamanSpectroscopy', 'ScanFront', {})
        );
    });

    PluginManager.registerCommand(pluginName, "ShowFossilDescription", function(args) {
        const type    = (args.type || "").toLowerCase().trim();
        const eventId = this._eventId;
        handleRamanChoice.call(this,
            () => displayFossilDescription(type, eventId),
            () => PluginManager.callCommand(this, 'RamanSpectroscopy', 'ScanFront', {})
        );
    });

    // Small reuse API so other systems (e.g. the NPC "tell a story / recite a
    // poem" social interactions, the inventory "Read" verb) can borrow the book
    // title/subject generators and the paged message display.
    window.RandomBookGenerator = window.RandomBookGenerator || {
        wrapText:  (text, maxChars) => wrapText(text, maxChars || 40),
        showPaged: (text, colorPrefix) => showPaged(text, colorPrefix),
        generateTitle:  (random) => generateTitle(random || Math.random),
        generateAuthor: (random) => generateAuthor(random || Math.random),
        generateDescription: (random) => generateDescription(random || Math.random),
        randomSubject:  (random) => {
            const subjects = (titleSubjects()).concat(getMonsterSubjects());
            const r = random || Math.random;
            return subjects[Math.floor(r() * subjects.length)];
        },
        // For anything that borrows the generators above to put a reading in
        // front of the player itself (the procedural map's shelves and statues):
        // the same one-off Fun the plugin's own message boxes pay. `id` is
        // whatever identifies that particular thing on that map — an event id, a
        // tile — so the same shelf read twice pays once.
        payReadingFun: (kind, id) => payReadingFun(kind, id),
    };

})();