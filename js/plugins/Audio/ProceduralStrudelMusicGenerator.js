/*:
 * @target MZ
 * @plugindesc [v1.1] Programmatic, Reactive Procedural Music Generator - Strudel Extension.
 * @author Omni-Lex
 * 
 * @help
 * ProceduralStrudelMusicGenerator.js
 * 
 * This plugin extends MusicManager from ProceduralMusicGenerator.js to include 
 * all Strudel engine generation logic.
 * 
 * It must be loaded AFTER ProceduralMusicGenerator.js.
 */

(() => {
    'use strict';

    if (typeof MusicManager === 'undefined') {
        console.error("ProceduralStrudelMusicGenerator: MusicManager class is not exposed! Please make sure ProceduralMusicGenerator.js exposes MusicManager globally.");
        return;
    }

    const pluginName = 'ProceduralMusicGenerator';

    MusicManager.prototype.buildCurrentGenre = function () {
        switch (this.currentGenre) {
            case 'Battle': this.buildBattleMusic(); break;
            case 'Dungeon': this.buildDungeonMusic(); break;
            case 'Exploration': this.buildExplorationMusic(); break;
            case 'Village': this.buildVillageMusic(); break;
            case 'City': this.buildCityMusic(); break;
            case 'Cave': this.buildCaveMusic(); break;
            case 'Desert': this.buildDesertMusic(); break;
            case 'Ice': this.buildIceMusic(); break;
            case 'Digital': this.buildDigitalMusic(); break;
            case 'Eldritch': this.buildEldritchMusic(); break;
            case 'Industrial': this.buildIndustrialMusic(); break;
            case 'Ethereal': this.buildEtherealMusic(); break;
            default: this.buildExplorationMusic(); break;
        }
    };

    MusicManager.prototype.setPattern = function (name, patternStr) {
        const p = this.engine.parser.parseStrudelChain(patternStr);
        this.engine.patterns[name] = p;
        this._patternStrings[name] = patternStr;
    };

    // Helper for single-event triggers per cycle
    MusicManager.prototype.triggerOnce = function (s, e, time, valueObj) {
        if (s > e) {
            if (time >= s || time < e) return [{ time, ...valueObj }];
        } else {
            if (time >= s && time < e) return [{ time, ...valueObj }];
        }
        return [];
    };

    /**
     * Generates a procedural melodic pattern string in Strudel syntax.
     * @param {Object} options - length, range, density, complexity
     * @returns {string} Strudel pattern string (e.g. "<0 2 1 ~ 3>")
     */
    MusicManager.prototype.generateProceduralMelody = function (options = {}) {
        const length = options.length || 16;
        const range = options.range || 7;
        const density = options.density || 0.7;
        const complexity = options.complexity || 0.4;

        // Use a local seeded PRNG if needed, or just the main one
        let notes = [];
        let current = 0;

        for (let i = 0; i < length; i++) {
            if (this._prng() > density) {
                notes.push("~");
                continue;
            }

            const r = this._prng();
            if (r < 0.6) {
                current += (this._prng() > 0.5 ? 1 : -1);
            } else if (r < 0.9) {
                current += (this._prng() > 0.5 ? 2 : -2);
            } else {
                current = Math.floor(this._prng() * (range * 2)) - range;
            }

            // Range constraint
            if (current > range) current = range - 1;
            if (current < -range) current = -range + 1;

            // Occasional subdivisions for complexity
            if (this._prng() < complexity * 0.3) {
                const sub1 = current;
                const sub2 = current + (this._prng() > 0.5 ? 1 : -1);
                notes.push(`[${sub1} ${sub2}]`);
            } else if (this._prng() < complexity * 0.1) {
                notes.push(`${current}!2`);
            } else {
                notes.push(current);
            }
        }

        return `<${notes.join(" ")}>`;
    };

    // --- Generative Logic ---

    MusicManager.prototype.buildBattleMusic = function () {
        const baseCps = 145 / 60 / 4;
        const tension = 1.0 + (1.0 - this.hpFactor) * 1.0;
        this.engine.cps = baseCps * Math.min(1.6, tension);

        // 1. Aggressive Hybrid Percussion
        this.setPattern("drums", `
            stack(
                s("<[bd@3 <~ bd>] ~>").bank("9000").gain(0.8).lpf(400),
                s("<~ sd>").bank("9000").gain(0.7).hpf(800),
                s("hc*16").degradeBy(0.3).bank("9000").gain(0.3).hpf(3000),
                s("gm_timpani(5,8)").n("<36 38 40 36>").gain(0.9).room(0.6)
            ).jux(x => x.rev().late(1/64))
        `);

        // 2. High-Tension Driving Bass
        this.setPattern("bass", `
            n("<0 0 3 5 0 0 -2 -1>*2").add("<0 7>/4").struct("x!8")
             .scale("c1:phrygian").s("gm_electric_bass_pick").gain(1.0).lpf(1200)
        `);

        // 3. Staccato Brass/Orchestral Stabs
        this.setPattern("stabs", `
            s("gm_brass_section").chord("<Cmin Dmin7b5 G7b9 Cmin>").voicing()
             .struct("x(3,8)").gain(0.7).room(0.4).clip(0.8)
        `);

        // 4. Reactive Elements (Thematic Motif)
        this.activeElements.forEach(elementId => {
            const name = `element_${elementId}`;
            const config = this.getElementConfig(elementId);
            const melody = this.generateProceduralMelody({ length: 8, range: 12, density: 0.6 });
            this.setPattern(name, `s("${config.sound}").n("${melody}").scale("c5:phrygian").gain(0.5).room(0.8)`);
        });

        // 5. Critical State (Choir Riser)
        if (this.hpFactor < 0.3) {
            this.setPattern("panic", `s("gm_choir_aahs*16").n("<c6 d6 eb6 g6>").gain(0.4).hpf(2000).room(1)`);
        }
    };

    MusicManager.prototype.getElementConfig = function (id) {
        const map = {
            1: { note: 36, sound: "gm_timpani" },      // Physical
            2: { note: 60, sound: "gm_church_organ" }, // Fire
            3: { note: 72, sound: "gm_glockenspiel" }, // Ice
            4: { note: 84, sound: "gm_lead_8_bass_lead" },  // Thunder
            5: { note: 48, sound: "gm_choir_oohs" },    // Water
            6: { note: 36, sound: "gm_cello" },   // Petro
            7: { note: 67, sound: "gm_flute" },    // Wind
            8: { note: 72, sound: "gm_string_ensemble_1" }, // Sacred
            9: { note: 24, sound: "gm_synth_choir" }        // Cursed
        };
        return map[id] || { note: 60, sound: "gm_string_ensemble_1" };
    };

    MusicManager.prototype.buildDungeonMusic = function () {
        this.engine.cps = 40 / 60 / 4;
        const intensity = Math.min(4, Math.floor(this.puzzlesSolved / 2) + 1);

        // 1. Atmospheric Root Pad
        this.setPattern("pad", `
            s("gm_choir_oohs").chord("<Cmin Fmin Gmin Abmaj>/4").voicing()
             .anchor("C3").jux(x => x.slow(2).rev()).gain(0.4).room(1).rsize(8)
        `);

        // 2. Deep Industrial Pulses
        this.setPattern("pulses", `
            s("gm_contrabass(3,8)").n("<0 1 0 5>/4").mode('root').scale("c1:aeolian")
             .gain(0.7).lpf(300).room(0.5)
        `);

        // 3. Echoing Relics
        this.setPattern("relics", `
            s("gm_glockenspiel?").n("<0 2 4 7 12>/8").euclid("<3 5>/2", 8)
             .echo(4, "1/4", 0.6).gain(0.2).room(1.2)
        `);

        if (intensity >= 2) {
            this.setPattern("strings", `s("gm_string_ensemble_1").chord("<Cmin Fmin Gmin Abmaj>/4").voicing().anchor("C4").gain(0.3).room(0.8)`);
        }

        if (intensity >= 3) {
            this.setPattern("perc", `s("gm_timpani(1,8)").n(36).gain(0.5).room(1).sometimes(x => x.fast(2))`);
        }

        if (intensity >= 4) {
            const melody = this.generateProceduralMelody({ length: 32, range: 14, density: 0.75, complexity: 0.6 });
            this.setPattern("melody", `
                n("${melody}*2").scale("c5:aeolian").s("gm_recorder").gain(0.4).room(0.8).clip(0.5)
            `);
        }
    };

    MusicManager.prototype.buildExplorationMusic = function () {
        this.engine.cps = 55 / 60 / 4;
        const hour = $gameVariables.value(23);
        const isNight = hour < 6 || hour >= 19;

        // 1. Shifting Horizon
        this.setPattern("horizon", `
            s("gm_string_ensemble_2").chord("<Cmaj7 Amin7 Fmaj7 G7>/4").voicing()
             .anchor("${isNight ? 'C3' : 'C4'}").jux(x => x.slow(2).rev()).gain(0.4).room(1.0)
        `);

        // 2. Ethereal Piano fragments
        this.setPattern("keys", `
            n("<0 2 4 7 9 12>/8").euclid(3, 8).scale("${isNight ? 'c4:minor' : 'c4:major'}")
             .piano().gain(0.5).room(0.8).echo(3, "1/4", 0.5)
        `);

        // 3. Subtle Melodic Motifs
        const motif = this.generateProceduralMelody({ length: 8, range: 7, density: 0.4 });
        this.setPattern("motifs", `
            s("${isNight ? 'gm_choir_oohs' : 'gm_flute'}").n("${motif}").scale("${isNight ? 'c5:minor' : 'c5:major'}")
             .jux(x => x.slow(4)).gain(0.3).room(1.2)
        `);

        // Weather Layers
        const weather = $gameWeather ? $gameWeather.currentWeatherType : "none";
        if (weather === "rain" || weather === "storm") {
            this.setPattern("rain", "s(\"sine*32\").gain(0.15).hpf(4000).degradeBy(0.5).room(2)");
        }
    };

    MusicManager.prototype.buildVillageMusic = function () {
        this.engine.cps = 80 / 60 / 4;
        // 1. Pastoral Strumming
        this.setPattern("harmony", `
            s("gm_pizzicato_strings").chord("<Gmaj Cmaj Dmaj Gmaj>/4").voicing()
             .anchor("G4").struct("x(3,8)").gain(0.5).room(0.4)
        `);

        // 2. Flute/Recorder Duet
        const lead1 = this.generateProceduralMelody({ length: 16, range: 7, density: 0.8, complexity: 0.2 });
        const lead2 = this.generateProceduralMelody({ length: 16, range: 7, density: 0.6, complexity: 0.3 });
        this.setPattern("lead", `
            stack(
                s("gm_recorder").n("${lead1}/2").scale("g5:major").gain(0.4),
                s("gm_flute").n("${lead2}/2").scale("g4:major").gain(0.3).late(1/32)
            ).room(0.8).jux(x => x.rev())
        `);

        // 3. Subtle Hearth Percussion
        this.setPattern("village_ambience", `s("gm_timpani(1,16)").n(24).gain(0.2).room(1)`);
    };

    MusicManager.prototype.buildCityMusic = function () {
        this.engine.cps = 110 / 60 / 4;
        // 1. Majestic Urban Foundation
        this.setPattern("foundation", `
            stack(
                s("gm_church_organ").chord("<Cmaj Fmaj Gmaj Cmaj>/4").voicing().gain(0.6).room(0.8),
                s("gm_tubular_bells").n("<0 7>/2").mode('root').scale("c5:major").echo(3, "1/4", 0.5).gain(0.4).room(1.0)
            )
        `);

        // 2. Busy Street Percussion (Linn Style)
        this.setPattern("beats", `
            stack(
                s("<[bd@3 <~ bd>] ~>").bank("9000").gain(0.6),
                s("<~ sd>").bank("9000").gain(0.5),
                s("hc*8").degradeBy(0.2).bank("9000").gain(0.2)
            ).jux(x => x.late(1/128))
        `);

        // 3. High Society Strings
        this.setPattern("high_strings", `
            s("gm_string_ensemble_1").chord("<Cmaj7 Dmin7 Em7 Fmaj7>/4").voicing()
             .anchor("C5").jux(x => x.slow(2)).gain(0.4).room(0.6)
        `);
    };

    MusicManager.prototype.buildCaveMusic = function () {
        this.engine.cps = 35 / 60 / 4;
        this.setPattern("depth", `s("gm_contrabass").n("<0 5 7 -5>/4").scale("c1:minor").gain(0.6).lpf(300).room(1.5).rsize(8)`);
        this.setPattern("drips", `s("gm_glockenspiel?").euclid(1, 16).transpose(24).echo(6, "1/4", 0.7).gain(0.3).room(2)`);
        this.setPattern("resonance", `s("gm_choir_oohs").n("<c4 eb4 g4 bb4>/4").jux(x => x.slow(3).rev()).gain(0.3).room(2)`);
    };

    MusicManager.prototype.buildDesertMusic = function () {
        this.engine.cps = 75 / 60 / 4;
        const melody = this.generateProceduralMelody({ length: 32, range: 12, density: 0.8 });
        this.setPattern("wind", `s("gm_string_ensemble_2").n("<0 7 12>/4").scale("d3:phrygian").jux(x => x.slow(4)).gain(0.4).hpf(1200).room(1.5)`);
        this.setPattern("perc", `s("gm_timpani(3,11)").n(36).late(1/16).gain(0.5).room(0.8)`);
        this.setPattern("melody", `s("gm_oboe").n("${melody}").scale("d5:phrygian").echo(4, "1/8", 0.6).gain(0.4).room(0.7)`);
    };

    MusicManager.prototype.buildIceMusic = function () {
        this.engine.cps = 40 / 60 / 4;
        const melody = this.generateProceduralMelody({ length: 16, range: 14, density: 0.5 });
        this.setPattern("glacier", `s("gm_choir_aahs").n("<c6 eb6 g6 b6>/4").jux(x => x.slow(2).rev()).gain(0.3).room(2).rsize(10)`);
        this.setPattern("crystals", `s("gm_glockenspiel").n("${melody}/2").scale("c6:major").echo(5, "1/8", 0.7).gain(0.25).room(1.5)`);
    };

    MusicManager.prototype.buildDigitalMusic = function () {
        this.engine.cps = 120 / 60 / 4;
        const melody = this.generateProceduralMelody({ length: 16, range: 12, density: 0.9, complexity: 0.8 });
        this.setPattern("cyber_beat", `
            stack(
                s("bd!2").bank("9000").gain(0.8),
                s("~ sd").bank("9000").gain(0.7),
                s("hc*16").degradeBy(0.4).bank("9000").gain(0.3)
            ).room(0.2)
        `);
        this.setPattern("glitch_melody", `
            n("${melody}").scale("c5:major").s("triangle").echo(2, "1/16", 0.5).sometimes(x => x.fast(4)).gain(0.4).room(0.4).clip(0.6)
        `);
    };

    MusicManager.prototype.buildEldritchMusic = function () {
        this.engine.cps = 20 / 60 / 4;
        const melody = this.generateProceduralMelody({ length: 8, range: 12, density: 0.4, complexity: 0.6 });
        this.setPattern("abyss", `s("gm_contrabass").n("<c1 f#1 b0 e1>/4").jux(x => x.slow(4).rev()).gain(0.7).lpf(200).room(2).rsize(12)`);
        this.setPattern("whispers", `s("gm_synth_choir").n("${melody}").scale("c4:minor").sometimes(x => x.rev()).echo(6, "1/2", 0.7).gain(0.3).room(2)`);
        this.setPattern("dissonance", `s("gm_tubular_bells?").n("<0 6 11 13>/8").gain(0.2).room(2)`);
    };

    MusicManager.prototype.buildIndustrialMusic = function () {
        this.engine.cps = 95 / 60 / 4;
        this.setPattern("machine", `
            stack(
                s("bd(3,8)").bank("9000").gain(0.8),
                s("sd(1,4,2)").bank("9000").gain(0.7),
                s("gm_church_organ").n("<c2 g2 c3>/4").gain(0.6).lpf(600).room(0.5)
            ).jux(x => x.late(1/64))
        `);
        this.setPattern("steam", `s("gm_timpani*8").degradeBy(0.5).gain(0.4).hpf(2000).room(0.8)`);
    };

    MusicManager.prototype.buildEtherealMusic = function () {
        this.engine.cps = 50 / 60 / 4;
        const melody = this.generateProceduralMelody({ length: 16, range: 12, density: 0.5, complexity: 0.5 });
        this.setPattern("dream", `
            stack(
                s("gm_choir_oohs").chord("<Cmaj9 Amaj9 Fmaj9 G13>/4").voicing().anchor("C5").jux(x => x.slow(4).rev()).gain(0.4).room(2).rsize(10),
                s("gm_glockenspiel").n("${melody}").scale("c6:major").echo(4, "1/4", 0.6).gain(0.3).room(2)
            )
        `);
    };

    MusicManager.prototype.playStrudelFile = async function (filename, subDir = 'Strudel') {
        // Stop MIDI if it was playing
        if (this.engine._midiIsPlaying) this.engine.stopMidi();

        try {
            const url = filename.includes('/') ? `audio/bgm/${filename}.js` : `audio/bgm/${subDir}/${filename}.js`;
            const response = await fetch(encodeURI(url));
            if (!response.ok) return false;
            const script = await response.text();
            this.engine.patterns = {};
            this.engine.parser.parse(script);
            return true;
        } catch (e) {
            console.error(`ProceduralMusicGenerator: Error loading ${filename}`, e);
            return false;
        }
    };

    MusicManager.prototype.pregenerateAll = async function () {
        if (!this.engine._initialized) return;
        console.log("ProceduralMusicGenerator: Starting batch pregeneration...");
        const originalGenre = this.currentGenre;
        const originalManual = this._isManualSelection;

        for (const genre of this._proceduralGenres) {
            this.currentGenre = genre;
            this._isManualSelection = true; // Temporary to avoid biome detection overwrite
            console.log(`ProceduralMusicGenerator: Generating ${genre}...`);
            this.buildCurrentGenre();
            this.exportToStrudel();
        }

        this.currentGenre = originalGenre;
        this._isManualSelection = originalManual;
        console.log("ProceduralMusicGenerator: Batch pregeneration complete.");
    };

    MusicManager.prototype.exportToStrudel = function () {
        if (typeof process === 'undefined' || !process.cwd) return;
        try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.join(process.cwd(), 'audio', 'bgm', 'Biomes');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            let script = `// Pregenerated for ${this.currentGenre}\n`;
            script += `setcps(${this.engine.cps.toFixed(4)})\n\n`;

            for (let name in this._patternStrings) {
                script += `${name}: ${this._patternStrings[name]}\n`;
            }

            const filename = path.join(dir, `${this.currentGenre}.js`);
            fs.writeFileSync(filename, script);
            console.log(`ProceduralMusicGenerator: Exported patterns to ${filename}`);
        } catch (e) {
            console.error("ProceduralMusicGenerator: Export failed", e);
        }
    };

    MusicManager.prototype.pregenerateAllBiomes = function (forceRandomSeed = false) {
        console.log("ProceduralMusicGenerator: Pregenerating all biome music...");
        const originalGenre = this.currentGenre;
        const originalHP = this.hpFactor;
        const originalPuzzles = this.puzzlesSolved;
        const originalSeed = this._seedStr;

        if (forceRandomSeed) {
            this.refreshSeed(Math.random().toString(36).substring(7));
        }

        // Set neutral state
        this.hpFactor = 1.0;
        this.puzzlesSolved = 0;

        const genres = [
            'Battle', 'Dungeon', 'Exploration', 'Village', 'City',
            'Cave', 'Desert', 'Ice', 'Digital', 'Eldritch',
            'Industrial', 'Ethereal'
        ];

        genres.forEach(genre => {
            this.currentGenre = genre;
            this.engine.patterns = {};
            this._patternStrings = {};
            this.buildCurrentGenre();
            this.exportToStrudel();
        });

        // Restore state
        if (forceRandomSeed) this.refreshSeed(originalSeed);
        this.currentGenre = originalGenre;
        this.hpFactor = originalHP;
        this.puzzlesSolved = originalPuzzles;
        console.log("ProceduralMusicGenerator: Pregeneration complete.");
    };

    // --- Register Strudel-specific Plugin Commands ---

    PluginManager.registerCommand(pluginName, 'PlayStrudelFile', args => {
        if (typeof ProceduralMusic !== 'undefined') {
            ProceduralMusic.playStrudelFile(args.filename, args.subDir || 'Strudel');
            ProceduralMusic.currentGenre = 'Manual';
            ProceduralMusic._isManualSelection = true;
        }
    });

    PluginManager.registerCommand(pluginName, 'ExportCurrentMusic', () => {
        if (typeof ProceduralMusic !== 'undefined') {
            ProceduralMusic.exportToStrudel();
        }
    });

    PluginManager.registerCommand(pluginName, 'PregenerateAllMusic', () => {
        if (typeof ProceduralMusic !== 'undefined') {
            ProceduralMusic.pregenerateAll();
        }
    });

})();
