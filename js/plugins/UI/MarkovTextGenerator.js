/*:
 * @target MZ
 * @plugindesc Generates text using Markov chains from selected text sources with proper text wrapping.
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * 

 * @param defaultChainOrder
 * @text Default Chain Order
 * @type number
 * @min 1
 * @max 5
 * @desc The default order of the Markov chain (how many words to consider for context).
 * @default 2
 * 
 * @param defaultMinLength
 * @text Default Minimum Length
 * @type number
 * @min 1
 * @max 100
 * @desc The default minimum length (in words) of generated text.
 * @default 10
 * 
 * @param defaultMaxLength
 * @text Default Maximum Length
 * @type number
 * @min 5
 * @max 500
 * @desc The default maximum length (in words) of generated text.
 * @default 50
 * 
 * @param defaultMinChars
 * @text Default Minimum Characters
 * @type number
 * @min 1
 * @max 100
 * @desc The default minimum length (in characters) when generating names.
 * @default 4
 * 
 * @param defaultMaxChars
 * @text Default Maximum Characters
 * @type number
 * @min 2
 * @max 100
 * @desc The default maximum length (in characters) when generating names.
 * @default 12
 * 
 * @param maxLineLength
 * @text Max Line Length
 * @type number
 * @min 20
 * @max 120
 * @desc Maximum characters per line before automatic line breaks (affects text wrapping).
 * @default 60
 * 
 * @param insertPeriods
 * @text Insert Periods
 * @type boolean
 * @desc Automatically insert periods in long sentences to improve readability.
 * @default true
 * 
 * @command generateText
 * @text Generate Markov Text
 * @desc Generates text using a Markov chain and displays it in a message box.
 * 
 * @arg databaseId
 * @text Database ID
 * @type string
 * @desc The ID of the text database to use (as defined in plugin parameters).
 * 
 * @arg chainOrder
 * @text Chain Order
 * @type number
 * @min 1
 * @max 5
 * @desc How many words to consider for context (higher values = more coherent, less creative).
 * @default 2
 * 
 * @arg minLength
 * @text Minimum Length
 * @type number
 * @min 1
 * @max 100
 * @desc The minimum length (in words) of generated text.
 * @default 10
 * 
 * @arg maxLength
 * @text Maximum Length
 * @type number
 * @min 5
 * @max 500
 * @desc The maximum length (in words) of generated text.
 * @default 50
 * 
 * @arg background
 * @text Background
 * @type select
 * @option Window
 * @value 0
 * @option Dim
 * @value 1
 * @option Transparent
 * @value 2
 * @desc The background type for the message window.
 * @default 0
 *
 * @arg position
 * @text Position
 * @type select
 * @option Top
 * @value 0
 * @option Middle
 * @value 1
 * @option Bottom
 * @value 2
 * @desc The position of the message window.
 * @default 2
 *
 * @command generateName
 * @text Generate Markov Name
 * @desc Generates a short text using character-based Markov for names.
 * 
 * @arg databaseId
 * @text Database ID
 * @type string
 * @desc The ID of the text database to use (as defined in plugin parameters).
 * 
 * @arg chainOrder
 * @text Chain Order
 * @type number
 * @min 1
 * @max 5
 * @desc How many characters to consider for context (higher values = more coherent).
 * @default 2
 * 
 * @arg minChars
 * @text Minimum Characters
 * @type number
 * @min 1
 * @max 100
 * @desc The minimum length (in characters) of generated name.
 * @default 4
 * 
 * @arg maxChars
 * @text Maximum Characters
 * @type number
 * @min 2
 * @max 100
 * @desc The maximum length (in characters) of generated name.
 * @default 12
 * 
 * @arg useWordMode
 * @text Use Word-Based Mode
 * @type boolean
 * @desc If true, will generate based on whole words instead of individual characters.
 * @default false
 * 
 * @arg variableId
 * @text Variable ID
 * @type variable
 * @desc Store the generated name in this game variable (0 to not store it).
 * @default 0
 * 
 * @arg actorId
 * @text Actor ID
 * @type actor
 * @desc Set the generated name to this actor (0 to not set any actor name).
 * @default 0
 * 
 * @arg displayInMessage
 * @text Display In Message
 * @type boolean
 * @desc Show the generated name in a message window.
 * @default false
 *
 * @command generateSeededDialogue
 * @text Generate Seeded Dialogue
 * @desc Generates dialogue from seeded DB selection (map 636 only). Uses Variables 43, 44 and event ID as seed.
 *
 * @arg chainOrder
 * @text Chain Order
 * @type number
 * @min 1
 * @max 5
 * @desc How many words to consider for context (higher values = more coherent, less creative).
 * @default 2
 *
 * @arg minLength
 * @text Minimum Length
 * @type number
 * @min 1
 * @max 100
 * @desc The minimum length (in words) of generated text.
 * @default 10
 *
 * @arg maxLength
 * @text Maximum Length
 * @type number
 * @min 5
 * @max 500
 * @desc The maximum length (in words) of generated text.
 * @default 50
 *
 * @arg background
 * @text Background
 * @type select
 * @option Window
 * @value 0
 * @option Dim
 * @value 1
 * @option Transparent
 * @value 2
 * @desc The background type for the message window.
 * @default 0
 *
 * @arg position
 * @text Position
 * @type select
 * @option Top
 * @value 0
 * @option Middle
 * @value 1
 * @option Bottom
 * @value 2
 * @desc The position of the message window.
 * @default 2
 *
 * @command generateNPCDialogue
 * @text Generate NPC Dialogue
 * @desc Generates dialogue for the calling NPC event using their associated Markov DB. Chain order is always 1; max length is randomized each call.
 *
 * @arg background
 * @text Background
 * @type select
 * @option Window
 * @value 0
 * @option Dim
 * @value 1
 * @option Transparent
 * @value 2
 * @desc The background type for the message window.
 * @default 0
 *
 * @arg position
 * @text Position
 * @type select
 * @option Top
 * @value 0
 * @option Middle
 * @value 1
 * @option Bottom
 * @value 2
 * @desc The position of the message window.
 * @default 2
 *
 * @help
 * ============================================================================
 * Markov Text Generator with Text Wrapping
 * ============================================================================
 * 
 * This plugin allows you to generate text using Markov chains based on
 * predefined text databases. The generated text can be displayed in a
 * message box with customizable parameters and proper text wrapping.
 * 
 * == How to Use ==
 * 
 * 1. Define text databases in the plugin parameters.
 *    Each database needs a unique ID and the source text.
 * 
 * 2. Use the plugin command "Generate Markov Text" in an event
 *    to generate paragraphs of text.
 *    - OR -
 *    Use the plugin command "Generate Markov Name" to generate
 *    shorter character names or item names based on character length.
 * 
 * == IMPORTANT: Plugin File Name ==
 * 
 * This plugin file MUST be named "MarkovTextGenerator.js" in your project's 
 * plugins folder. The plugin name inside the code must match the file name
 * without the .js extension.
 * 
 * == Plugin Command Usage ==
 * 
 * In an event, add a "Plugin Command" action and select one of the commands:
 * 
 * 1. "Generate Markov Text" - For longer text passages
 *    Fill in at least the Database ID.
 * 
 * 2. "Generate Markov Name" - For character or item names
 *    - Set the database ID and character length limits
 *    - Choose whether to use word-based mode (for compound names)
 *    - Optionally store the result in a game variable
 *    - Decide whether to display the name in a message window
 * 
 * == Name Generation ==
 * 
 * The name generator has two modes:
 * 
 * 1. Character-based (useWordMode = false): Builds names character by character.
 *    Good for creating completely new names with the feel of the source text.
 * 
 * 2. Word-based (useWordMode = true): Uses whole words from the source.
 *    Good for creating compound names or picking words from the source text.
 * 
 * All generated names will have their first letter automatically capitalized.
 * 
 * You can also directly set an actor's name to the generated name by providing
 * an Actor ID in the plugin command parameters.
 * 
 * == Text Wrapping Parameters ==
 * 
 * - Max Line Length: Controls when text will be broken to a new line to ensure
 *   proper wrapping within the message window.
 * 
 * - Insert Periods: When enabled, automatically inserts periods in very long
 *   sentences to improve readability in the generated text.
 * 
 * == Parameters Explained ==
 * 
 * - Chain Order: How many words/characters to use for context. Higher values
 *   produce more coherent but less creative text.
 * 
 * - Min/Max Length: Controls how long the generated text will be.
 * 
 * == Example ==
 * 
 * Create a database with ID "fantasy_names" containing fantasy character names,
 * then use the "Generate Markov Name" command to create new character names
 * on the fly during gameplay.
 * 
 * ============================================================================
 * Terms of Use
 * ============================================================================
 * 
 * Free for use in both commercial and non-commercial projects.
 * Credit is appreciated but not required.
 * 
 */


(function () {
    'use strict';

    // The plugin name MUST match the filename (without .js)
    const pluginName = "MarkovTextGenerator";



    // Parse plugin parameters
    const parameters = PluginManager.parameters(pluginName);

    const defaultChainOrder = Number(parameters.defaultChainOrder || 2);
    const defaultMinLength = Number(parameters.defaultMinLength || 10);
    const defaultMaxLength = Number(parameters.defaultMaxLength || 50);
    const defaultMinChars = Number(parameters.defaultMinChars || 4);
    const defaultMaxChars = Number(parameters.defaultMaxChars || 12);
    const maxLineLength = Number(parameters.maxLineLength || 60);
    const insertPeriods = parameters.insertPeriods !== "false";

    // Parse additional text databases from plugin parameters
    const extraDatabases = [];
    try {
        const rawDatabases = parameters.textDatabases;
        if (rawDatabases && rawDatabases !== '[]') {
            const parsedArray = JSON.parse(rawDatabases);
            parsedArray.forEach(dbString => {
                try {
                    const db = JSON.parse(dbString);
                    extraDatabases.push({
                        id: db.id,
                        name: db.name,
                        en: db.en,
                        it: db.it
                    });
                } catch (innerErr) {
                    console.error(`[MarkovTextGenerator] Error parsing individual database entry: ${innerErr.message}`);
                }
            });
        }
    } catch (e) {
        console.error(`[MarkovTextGenerator] Error parsing extra databases: ${e.message}`);
    }

    /**
     * Get all currently available text databases, merging dynamic (JSON files) and parameter ones.
     * @returns {Array} Array of database objects
     */
    function getAllTextDatabases() {
        const dynamicDatabases = Object.values(window.TextGen || {});
        // Update global window.textDatabases for backward compatibility with other plugins
        window.textDatabases = dynamicDatabases.concat(extraDatabases);
        return window.textDatabases;
    }

    // Initial population for console log only
    // const initialDBs = getAllTextDatabases();
    // console.log(`[MarkovTextGenerator] Initialized with ${initialDBs.length} databases.`);
    console.log(`[MarkovTextGenerator] Ready. Databases will load on first use.`);

    // Store built Markov models to avoid rebuilding. Keys such as
    // `seeded_<worldX>_<worldY>_<eventId>` are effectively unbounded across a
    // session, so use an LRU-capped Map that evicts the least-recently-used entry.
    const MARKOV_MODEL_CACHE_LIMIT = 64;
    const markovModels = new Map();

    // Get an existing model or build one via factory(), refreshing LRU order and
    // evicting the oldest entry once the cache limit is exceeded.
    function getMarkovModel(modelKey, factory) {
        if (markovModels.has(modelKey)) {
            const model = markovModels.get(modelKey);
            markovModels.delete(modelKey);
            markovModels.set(modelKey, model); // move to most-recently-used
            return model;
        }
        const model = factory();
        markovModels.set(modelKey, model);
        if (markovModels.size > MARKOV_MODEL_CACHE_LIMIT) {
            const oldestKey = markovModels.keys().next().value;
            markovModels.delete(oldestKey);
        }
        return model;
    }

    const characterMarkovModels = {};

    // Helper function to capitalize first letter of a string
    function capitalizeFirstLetter(string) {
        if (!string) return string;
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    // Markov Chain Generator Class for word-based generation
    class MarkovChain {
        constructor(text, order = 2) {
            this.order = order;
            this.model = {};
            this.startSequences = [];

            this.buildModel(text);
        }

        buildModel(text) {
            // Clean and tokenize the text
            const words = (text || '')
                .split(/\s+/)
                .filter(word => word.length > 0);


            // Build model
            for (let i = 0; i <= words.length - this.order; i++) {
                // Get current sequence of words (state)
                const currentSequence = words.slice(i, i + this.order).join(' ');

                // Save sequences that can start sentences
                if (i === 0 || /[\.\?\!]$/.test(words[i - 1])) {
                    this.startSequences.push(currentSequence);
                }

                // Next word
                const nextWord = words[i + this.order];

                // If we reached the end of the text, continue
                if (!nextWord) continue;

                // Add to model
                if (!this.model[currentSequence]) {
                    this.model[currentSequence] = [];
                }
                this.model[currentSequence].push(nextWord);
            }

        }

        generateText(minLength = 10, maxLength = 50) {

            // No usable source text (e.g. missing translation for this database) — nothing to generate.
            if (this.startSequences.length === 0) {
                return '';
            }

            // Start with a random starting sequence
            let currentSequence = this.startSequences[Math.floor(Math.random() * this.startSequences.length)];
            let result = currentSequence.split(' ');


            // Generate text until we reach max length or can't continue
            while (result.length < maxLength) {
                // If we don't have this sequence in our model, break
                if (!this.model[currentSequence] || this.model[currentSequence].length === 0) {
                    break;
                }

                // Get a random next word based on current sequence
                const nextWords = this.model[currentSequence];
                const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];
                result.push(nextWord);

                // Update current sequence
                const sequenceWords = currentSequence.split(' ');
                sequenceWords.shift();
                sequenceWords.push(nextWord);
                currentSequence = sequenceWords.join(' ');

                // If we've reached minimum length and the last word ends with a terminal punctuation, we can stop
                if (result.length >= minLength && /[\.\?\!]$/.test(nextWord)) {
                    break;
                }
            }

            // Check if the text ends with proper punctuation, if not add a period
            if (result.length > 0 && !/[\.\?\!]$/.test(result[result.length - 1])) {
                result[result.length - 1] += '.';
            }

            // Ensure first letter is capitalized
            if (result.length > 0) {
                result[0] = capitalizeFirstLetter(result[0]);
            }

            return result.join(' ');
        }

        // Generate text that BEGINS with the caller's own words, then lets the
        // Markov chain continue from there, producing a semi-sensical reply that
        // echoes and riffs on what was typed. Used by the NPC chat box.
        generateFrom(startText, minLength = 10, maxLength = 50) {
            const seedWords = String(startText || '')
                .split(/\s+/)
                .filter(w => w.length > 0);
            if (seedWords.length === 0) return this.generateText(minLength, maxLength);

            // The reply opens with the player's own words.
            const result = seedWords.slice();

            // Pick the continuation state. Best case: the last `order` words of the
            // seed are a known state, so the chain flows straight on. Otherwise
            // bridge through a model state whose first word appears in the seed, and
            // failing that fall back to any sentence-start sequence.
            let currentSequence = null;
            const tail = seedWords.slice(-this.order).join(' ');
            if (this.model[tail]) {
                currentSequence = tail;
            } else {
                const norm    = w => w.toLowerCase().replace(/[^\w]/g, '');
                const seedSet = new Set(seedWords.map(norm).filter(Boolean));
                const bridges = Object.keys(this.model)
                    .filter(k => seedSet.has(norm(k.split(' ')[0])));
                if (bridges.length) {
                    currentSequence = bridges[Math.floor(Math.random() * bridges.length)];
                    result.push(...currentSequence.split(' '));
                } else if (this.startSequences.length) {
                    currentSequence = this.startSequences[Math.floor(Math.random() * this.startSequences.length)];
                    result.push(...currentSequence.split(' '));
                }
            }

            while (currentSequence && result.length < maxLength) {
                const nextWords = this.model[currentSequence];
                if (!nextWords || nextWords.length === 0) break;
                const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];
                result.push(nextWord);
                const sequenceWords = currentSequence.split(' ');
                sequenceWords.shift();
                sequenceWords.push(nextWord);
                currentSequence = sequenceWords.join(' ');
                if (result.length >= minLength && /[\.\?\!]$/.test(nextWord)) break;
            }

            if (result.length > 0 && !/[\.\?\!]$/.test(result[result.length - 1])) {
                result[result.length - 1] += '.';
            }
            if (result.length > 0) result[0] = capitalizeFirstLetter(result[0]);
            return result.join(' ');
        }

        // Generate a name using words (for compound names)
        generateWordBasedName(minChars = 4, maxChars = 12) {
            if (this.startSequences.length === 0) {
                return T('Markov.errorName');
            }

            // Get an appropriate starting point - prefer single words from the start sequences
            const potentialStarts = this.startSequences
                .map(seq => seq.split(' ')[0])
                .filter(word => word.length >= 2);

            let name = potentialStarts[Math.floor(Math.random() * potentialStarts.length)];

            // Sometimes add a second word to create compound names
            if (name.length < minChars || (Math.random() > 0.7 && name.length < maxChars - 3)) {
                // Find words that could follow our starting word
                const currentSequence = name;
                if (this.model[currentSequence] && this.model[currentSequence].length > 0) {
                    const nextWords = this.model[currentSequence];
                    const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];

                    // Create compound name - sometimes with hyphen, sometimes with space
                    if (Math.random() > 0.5) {
                        name += '-' + nextWord;
                    } else {
                        name += ' ' + nextWord;
                    }
                }
            }

            // Truncate if too long
            if (name.length > maxChars) {
                name = name.substring(0, maxChars);

                // Ensure we don't cut off in the middle of a hyphenated name
                if (name.endsWith('-')) {
                    name = name.substring(0, name.length - 1);
                }
            }

            // Remove any punctuation at the end
            name = name.replace(/[^\w\s-]$/, '');

            // Ensure first letter is capitalized and each part of a compound name is capitalized
            name = name.split(/[\s-]/).map(part => capitalizeFirstLetter(part)).join('-');


            return name;
        }
    }

    // Character-based Markov Chain for name generation
    class CharacterMarkov {
        constructor(text, order = 2) {
            this.order = order;
            this.model = {};
            this.startSequences = [];

            this.buildModel(text);
        }

        buildModel(text) {
            // Extract words from text, we'll use these as the basis for character-based generation
            const words = text
                .replace(/[^\w\s-]/g, '')
                .split(/\s+/)
                .filter(word => word.length >= this.order);


            // Process each word
            words.forEach(word => {
                // Save beginning sequences
                const startSeq = word.substring(0, this.order);
                this.startSequences.push(startSeq);

                // Build character transitions
                for (let i = 0; i <= word.length - this.order; i++) {
                    const sequence = word.substring(i, i + this.order);
                    const nextChar = word[i + this.order];

                    if (!nextChar) continue;

                    if (!this.model[sequence]) {
                        this.model[sequence] = [];
                    }

                    this.model[sequence].push(nextChar);
                }

                // Add end-of-word marker for more natural endings
                const endSeq = word.substring(word.length - this.order);
                if (!this.model[endSeq]) {
                    this.model[endSeq] = [];
                }
                this.model[endSeq].push('$END');
            });

        }

        generateName(minChars = 4, maxChars = 12) {
            if (this.startSequences.length === 0) {
                return T('Markov.errorName');
            }

            // Start with a random starting sequence
            const currentSequence = this.startSequences[Math.floor(Math.random() * this.startSequences.length)];
            let result = currentSequence;

            // Generate characters until we reach the max length or natural ending
            while (result.length < maxChars) {
                const currentState = result.substring(result.length - this.order);

                // If we don't have this sequence in our model or reached min length with ending, break
                if (!this.model[currentState] || this.model[currentState].length === 0 ||
                    (result.length >= minChars && Math.random() > 0.7)) {
                    break;
                }

                // Get a random next character based on current sequence
                const nextChars = this.model[currentState];
                const nextChar = nextChars[Math.floor(Math.random() * nextChars.length)];

                // Check if we reached a natural end
                if (nextChar === '$END') {
                    if (result.length >= minChars) {
                        break;
                    } else {
                        // Too short, continue with a different character
                        continue;
                    }
                }

                result += nextChar;
            }

            // Ensure the name has the specified minimum length
            if (result.length < minChars) {
                // Add random characters from the model to reach minimum length
                while (result.length < minChars) {
                    const randomChar = Object.keys(this.model)[Math.floor(Math.random() * Object.keys(this.model).length)];
                    result += randomChar.charAt(0);
                }
            }

            // Ensure first letter is capitalized
            result = capitalizeFirstLetter(result);


            return result;
        }
    }

    // Log when the plugin command is registered

    // Register plugin command for normal text generation
    // Register plugin command for normal text generation
    PluginManager.registerCommand(pluginName, "generateText", function (args) {
        const evId = this._eventId;
        if (evId) {
            const ev = $gameMap.event(evId);
            if (ev) ev.turnTowardPlayer();
        }
        // 2) pause this event until the dialog finishes
        this.setWaitMode('message');

        const databaseId = args.databaseId;
        const chainOrder = Number(args.chainOrder || defaultChainOrder);
        const minLength = Number(args.minLength || defaultMinLength);
        const maxLength = Number(args.maxLength || defaultMaxLength);
        const background = Number(args.background || 0);
        const position = Number(args.position || 2);


        // Find the database (now supports comma-separated IDs and "all")
        let database;
        try {
            database = getTextDB(databaseId);
        } catch (error) {

            // Show an error message in-game
            $gameMessage.add(T('Markov.error', { message: error.message.split('] ')[1] }));
            $gameMessage.add(T('Markov.checkParams'));
            return;
        }


        const selectedLanguage = ConfigManager.language === 'it' ? database.it : database.en;

        // Get or build the Markov model (use the full databaseId as key for proper caching)
        const modelKey = `${database.id}_${chainOrder}`;
        const model = getMarkovModel(modelKey, () => new MarkovChain(selectedLanguage, chainOrder));

        // Generate text
        const generatedText = model.generateText(minLength, maxLength);
        const cleanText = generatedText.replace(/\s+/g, ' ').trim();

        $gameMessage.setBackground(background);
        $gameMessage.setPositionType(position);

        window.skipLocalization = true;
        $gameMessage.add(cleanText);
        window.skipLocalization = false;
    });

    function getTextDB(id) {
        const dbs = getAllTextDatabases();
        const searchId = id.toLowerCase();

        if (searchId === "all") {
            // Combine all databases into one
            return {
                id: "all",
                name: T('Markov.allDatabases'),
                en: dbs.map(db => db.en).join(' '),
                it: dbs.map(db => db.it).join(' ')
            };
        }

        // Check if multiple database IDs are provided (comma-separated)
        if (id.includes(',')) {
            const databaseIds = id.split(',').map(dbId => dbId.trim().toLowerCase());
            const foundDatabases = [];
            const missingDatabases = [];

            databaseIds.forEach(dbId => {
                const db = dbs.find(d => d.id && d.id.toLowerCase() === dbId);
                if (db) {
                    foundDatabases.push(db);
                } else {
                    missingDatabases.push(dbId);
                }
            });

            if (missingDatabases.length > 0) {
                throw new Error(`[${pluginName}] Text DB(s) "${missingDatabases.join(', ')}" not found`);
            }

            return {
                id: id,
                name: T('Markov.combined', { list: foundDatabases.map(db => db.name).join(', ') }),
                en: foundDatabases.map(db => db.en).join(' '),
                it: foundDatabases.map(db => db.it).join(' ')
            };
        }

        // Single database lookup (case-insensitive)
        const db = dbs.find(d => d.id && d.id.toLowerCase() === searchId);
        if (!db) {
            throw new Error(`[${pluginName}] Text DB "${id}" not found`);
        }
        return db;
    }
    // Seeded RNG based on seed value
    function seededRandom(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    /**
     * Merge multiple text databases intelligently for better variety
     * Interleaves text from multiple sources to preserve patterns from each
     */
    function mergeTextDatabases(databases, language, seed) {
        if (!databases || databases.length === 0) return "";
        if (databases.length === 1) {
            return language === 'it' ? databases[0].it : databases[0].en;
        }

        const texts = databases.map(db =>
            (language === 'it' ? db.it : db.en)
                .split(/\s+/)
                .filter(word => word.length > 0)
        );

        // Calculate how many words to take from each database per cycle
        const maxLength = Math.max(...texts.map(t => t.length));
        const chunkSize = Math.ceil(maxLength / (databases.length * 3)); // Smaller chunks for more interleaving

        const mergedWords = [];
        let rng = seed;

        // Interleave words from each database
        for (let cycle = 0; cycle < maxLength; cycle += chunkSize) {
            for (let i = 0; i < databases.length; i++) {
                const textWords = texts[i];
                if (cycle < textWords.length) {
                    // Take a chunk from this database's text
                    const endIdx = Math.min(cycle + chunkSize, textWords.length);
                    mergedWords.push(...textWords.slice(cycle, endIdx));

                    // Add occasional natural separator (sentence pause)
                    if (cycle > 0 && cycle % (chunkSize * 2) === 0) {
                        // Seeded decision to keep original punctuation or add separator
                        rng = seededRandom(rng + i * 100);
                        if (rng < 0.3 && mergedWords.length > 0) {
                            // Add a transition word or keep separator
                            const lastWord = mergedWords[mergedWords.length - 1];
                            if (!/[\.\?\!]$/.test(lastWord)) {
                                mergedWords[mergedWords.length - 1] += '.';
                            }
                        }
                    }
                }
            }
        }

        return mergedWords.join(' ');
    }

    // Register plugin command for seeded dialogue generation
    PluginManager.registerCommand(pluginName, "generateSeededDialogue", function (args) {
        const currentMapId = $gameMap.mapId();

        const evId = this._eventId;
        if (evId) {
            const ev = $gameMap.event(evId);
            if (ev) ev.turnTowardPlayer();
        }
        this.setWaitMode('message');

        const chainOrder = 1;
        const minLength = Number(args.minLength || defaultMinLength);
        const maxLength = Number(args.maxLength || defaultMaxLength);
        const background = Number(args.background || 0);
        const position = Number(args.position || 2);

        // Get seed from Variables 43, 44 and event ID
        const worldX = $gameVariables.value(43) || 1;
        const worldY = $gameVariables.value(44) || 1;
        const eventId = this._eventId || 1;

        // Create a combined seed from world coordinates and event ID
        const seed = (worldX * 73856093) ^ (worldY * 19349663) ^ (eventId * 83492791);

        // Determine how many databases to select (1-6)
        const rng1 = seededRandom(seed);
        const dbCount = Math.floor(rng1 * 6) + 1; // 1-6 databases

        // Select databases based on seed
        const selectedDatabases = [];
        const dbs = getAllTextDatabases();
        if (dbs.length === 0) {
            $gameMessage.add(T('Markov.noDatabases'));
            return;
        }

        // Use seeded random to select unique databases
        const availableIndices = Array.from({ length: dbs.length }, (_, i) => i);
        for (let i = 0; i < Math.min(dbCount, dbs.length); i++) {
            const rng = seededRandom(seed + i * 1000);
            const randomIdx = Math.floor(rng * availableIndices.length);
            const dbIndex = availableIndices[randomIdx];
            selectedDatabases.push(dbs[dbIndex]);
            availableIndices.splice(randomIdx, 1);
        }

        // Merge selected databases intelligently for better variety
        const selectedLanguage = ConfigManager.language === 'it' ? 'it' : 'en';
        const mergedTextContent = mergeTextDatabases(selectedDatabases, selectedLanguage, seed);

        const combinedText = {
            id: `seeded_${worldX}_${worldY}_${eventId}`,  // i18n-ignore  cache key
            name: T('Markov.seeded', { list: selectedDatabases.map(db => db.name).join(', ') }),
            en: selectedLanguage === 'en' ? mergedTextContent : '',
            it: selectedLanguage === 'it' ? mergedTextContent : ''
        };

        const selectedLanguageText = selectedLanguage === 'it' ? combinedText.it : combinedText.en;

        // Get or build the Markov model
        const modelKey = `${combinedText.id}_${chainOrder}`;
        const model = getMarkovModel(modelKey, () => new MarkovChain(selectedLanguageText, chainOrder));

        // Generate text
        const generatedText = model.generateText(minLength, maxLength);
        const cleanText = generatedText.replace(/\s+/g, ' ').trim();

        $gameMessage.setBackground(background);
        $gameMessage.setPositionType(position);

        window.skipLocalization = true;
        $gameMessage.add(cleanText);
        window.skipLocalization = false;
    });

    // Register plugin command for NPC-specific dialogue generation
    PluginManager.registerCommand(pluginName, "generateNPCDialogue", function (args) {
        const evId = this._eventId;
        if (evId) {
            const ev = $gameMap.event(evId);
            if (ev) ev.turnTowardPlayer();
        }
        this.setWaitMode('message');

        const background = Number(args.background || 0);
        const position = Number(args.position || 2);

        // Resolve the NPC's associated Markov database from their society profile
        const npcEvent = evId ? $gameMap.event(evId) : null;
        const npcName = npcEvent?.event()?.name;
        let databaseId = $gameSystem._npcSociety?.[npcName]?.markovDb || "all";

        const chainOrder = 1;
        const minLength = 8;
        // Randomize max length on every interaction (15–50 words)
        const maxLength = Math.floor(Math.random() * 36) + 15;

        let database;
        try {
            database = getTextDB(databaseId);
        } catch (error) {
            $gameMessage.add(T('Markov.error', { message: error.message.split('] ')[1] || error.message }));
            return;
        }

        const selectedLanguage = ConfigManager.language === 'it' ? database.it : database.en;

        const modelKey = `${database.id}_${chainOrder}`;
        const model = getMarkovModel(modelKey, () => new MarkovChain(selectedLanguage, chainOrder));

        const generatedText = model.generateText(minLength, maxLength);
        const cleanText = generatedText.replace(/\s+/g, ' ').trim();

        // Keep the line on the NPC's society profile so it shows up in their
        // chat history in the Empathize panel, not just in this message box.
        if (npcName) window.NPCEmpathize?.recordNPCLine?.(npcName, cleanText);

        $gameMessage.setBackground(background);
        $gameMessage.setPositionType(position);

        window.skipLocalization = true;
        $gameMessage.add(cleanText);
        window.skipLocalization = false;
    });

    // Register plugin command for name generation
    PluginManager.registerCommand(pluginName, "generateName", args => {

        const databaseId = args.databaseId;
        const chainOrder = Number(args.chainOrder || 2);
        const minChars = Number(args.minChars || defaultMinChars);
        const maxChars = Number(args.maxChars || defaultMaxChars);
        const useWordMode = args.useWordMode === "true";
        const variableId = Number(args.variableId || 0);
        const displayInMessage = args.displayInMessage === "true";


        // Find the database
        const dbs = getAllTextDatabases();
        const database = dbs.find(db => db.id && db.id.toLowerCase() === databaseId.toLowerCase());

        if (!database) {

            // Show an error message in-game
            if (displayInMessage) {
                $gameMessage.add(T('Markov.databaseMissing', { id: databaseId }));
                $gameMessage.add(T('Markov.checkParams'));
            }
            return;
        }


        let generatedName = "";

        if (useWordMode) {
            // Use word-based mode (for compound names)
            const modelKey = `${databaseId}_${chainOrder}`;
            const model = getMarkovModel(modelKey, () => new MarkovChain(database.en, chainOrder));

            // Generate name using word-based mode
            generatedName = model.generateWordBasedName(minChars, maxChars);
        } else {
            // Use character-based mode (for more unusual names)
            const modelKey = `char_${databaseId}_${chainOrder}`;  // i18n-ignore  cache key
            if (!characterMarkovModels[modelKey]) {
                characterMarkovModels[modelKey] = new CharacterMarkov(database.en, chainOrder);
            }

            // Generate name using character-based mode
            generatedName = characterMarkovModels[modelKey].generateName(minChars, maxChars);
        }

        // Ensure first letter is capitalized
        generatedName = capitalizeFirstLetter(generatedName);


        // Store in game variable if a variable ID was provided
        if (variableId > 0) {
            $gameVariables.setValue(variableId, generatedName);
        }

        // Set actor name if an actor ID was provided
        const actorId = Number(args.actorId || 0);
        if (actorId > 0) {
            const actor = $gameActors.actor(actorId);
            if (actor) {
                actor.setName(generatedName);
            }
        }

        // Display in message window if requested
        if (displayInMessage) {
            $gameMessage.add(generatedName);
        }
    });

    // Log when the plugin is fully loaded

    if (typeof window.generateMarkovString === 'undefined') {
        window.generateMarkovString = function (databaseId, options = {}) {

            // Set default options
            const chainOrder = Number(options.chainOrder || defaultChainOrder);
            const minLength = Number(options.minLength || defaultMinLength);
            const maxLength = Number(options.maxLength || defaultMaxLength);


            // Find the database (supports single ID, comma-separated IDs, or "all")
            let database;
            try {
                database = getTextDB(databaseId);
            } catch (error) {
                return `ERROR: ${error.message.split('] ')[1]}`;
            }


            // Select language based on current configuration
            const selectedLanguage = ConfigManager.language === 'it' ? database.it : database.en;

            // Get or build the Markov model (use the full databaseId as key for proper caching)
            const modelKey = `${database.id}_${chainOrder}`;
            const model = getMarkovModel(modelKey, () => new MarkovChain(selectedLanguage, chainOrder));

            // Generate and return text. When a startText seed is supplied the
            // reply begins with it and the chain continues from there.
            const startText = options.startText;
            const generatedText = (startText && typeof model.generateFrom === 'function')
                ? model.generateFrom(String(startText), minLength, maxLength)
                : model.generateText(minLength, maxLength);

            return generatedText;
        };
    }

    // Seeded random generator for deterministic name generation
    function seededRandomMarkov(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    // Generate seeded names for procedural map NPCs
    if (typeof window.generateSeededMarkovName === 'undefined') {
        window.generateSeededMarkovName = function (worldX, worldY, eventId, databaseId, chainOrder = 2, minChars = 4, maxChars = 12) {
            // Create deterministic seed from world coordinates and event ID
            const seed = (worldX * 73856093) ^ (worldY * 19349663) ^ (eventId * 83492791);

            // Find the database
            let database;
            try {
                database = getTextDB(databaseId);
            } catch (error) {
                console.warn(`[MarkovTextGenerator] Database "${databaseId}" not found: ${error.message}`);
                return T('Markov.unknownName');
            }

            // Use character-based Markov for name generation
            const modelKey = `char_${databaseId}_${chainOrder}_seeded`;  // i18n-ignore  cache key
            if (!characterMarkovModels[modelKey]) {
                characterMarkovModels[modelKey] = new CharacterMarkov(database.en, chainOrder);
            }

            const markovModel = characterMarkovModels[modelKey];

            // Generate name using seeded random number
            if (markovModel.startSequences.length === 0) {
                return T('Markov.unknownName');
            }

            // Use seeded RNG to pick starting sequence
            let generationSeed = seed;
            const rng = seededRandomMarkov(generationSeed);
            const startSeq = markovModel.startSequences[Math.floor(rng * markovModel.startSequences.length)];
            let result = startSeq;

            // Generate characters until we reach the max length
            while (result.length < maxChars) {
                const currentState = result.substring(result.length - markovModel.order);

                // If we don't have this sequence in our model, break
                if (!markovModel.model[currentState] || markovModel.model[currentState].length === 0) {
                    break;
                }

                // Use seeded RNG to pick next character
                generationSeed = generationSeed * 1103515245 + 12345; // Linear congruential generator
                const nextCharRng = seededRandomMarkov(generationSeed);
                const nextChars = markovModel.model[currentState];
                const nextChar = nextChars[Math.floor(nextCharRng * nextChars.length)];

                // Check if we reached a natural end
                if (nextChar === '$END') {
                    if (result.length >= minChars) {
                        break;
                    } else {
                        // Skip this ending and try again
                        generationSeed = generationSeed * 1103515245 + 12345;
                        continue;
                    }
                }

                result += nextChar;
            }

            // Ensure minimum length
            if (result.length < minChars) {
                // Try to pad with characters from current state if possible
                let attempts = 0;
                while (result.length < minChars && attempts < 10) {
                    const currentState = result.substring(result.length - markovModel.order);
                    if (markovModel.model[currentState] && markovModel.model[currentState].length > 0) {
                        generationSeed = generationSeed * 1103515245 + 12345;
                        const paddingRng = seededRandomMarkov(generationSeed);
                        const char = markovModel.model[currentState][Math.floor(paddingRng * markovModel.model[currentState].length)];
                        if (char !== '$END') {
                            result += char;
                        }
                    }
                    attempts++;
                }
            }

            // Ensure truncate if too long
            if (result.length > maxChars) {
                result = result.substring(0, maxChars);
            }

            // Capitalize first letter
            return capitalizeFirstLetter(result);
        };
    }
})();