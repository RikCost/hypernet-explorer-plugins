/*:
 * @target MZ
 * @plugindesc [v1.0] Core Utilities for Strudel Procedural Music Generation.
 * @author Omni-Lex
 *
 * @help
 * ProceduralMusicUtils.js
 * 
 * This is a utility library and does not provide plugin commands.
 * It exposes the following classes and functions to window.StrudelUtils:
 * - Pattern
 * - StrudelParser
 * - StrudelEngine
 * - Hashing utilities (cyrb128, sfc32)
 */

window.StrudelUtils = (() => {
    'use strict';

    // --- Safe numeric expression evaluator (replaces eval on Strudel numeric args) ---
    // Supports + - * / and parentheses over plain numbers. Returns NaN on anything
    // it cannot parse (function bodies, identifiers, etc.) so callers can guard.
    function parseNumericExpr(expr) {
        if (typeof expr !== 'string') return Number(expr);
        const s = expr.trim();
        if (s === '' || !/^[0-9+\-*/().eE\s]+$/.test(s)) return NaN;
        let i = 0;
        const skip = () => { while (i < s.length && s[i] === ' ') i++; };
        function parseFactor() {
            skip();
            if (s[i] === '+') { i++; return parseFactor(); }
            if (s[i] === '-') { i++; return -parseFactor(); }
            if (s[i] === '(') {
                i++;
                const v = parseAddSub();
                skip();
                if (s[i] === ')') i++;
                return v;
            }
            const start = i;
            while (i < s.length && /[0-9.eE]/.test(s[i])) {
                if ((s[i] === 'e' || s[i] === 'E') && (s[i + 1] === '+' || s[i + 1] === '-')) i++;
                i++;
            }
            return parseFloat(s.slice(start, i));
        }
        function parseMulDiv() {
            let v = parseFactor();
            skip();
            while (i < s.length && (s[i] === '*' || s[i] === '/')) {
                const op = s[i++];
                const rhs = parseFactor();
                v = op === '*' ? v * rhs : v / rhs;
                skip();
            }
            return v;
        }
        function parseAddSub() {
            let v = parseMulDiv();
            skip();
            while (i < s.length && (s[i] === '+' || s[i] === '-')) {
                const op = s[i++];
                const rhs = parseMulDiv();
                v = op === '+' ? v + rhs : v - rhs;
                skip();
            }
            return v;
        }
        const result = parseAddSub();
        skip();
        return i < s.length ? NaN : result;
    }

    // --- Hashing and PRNG (cyrb128 + sfc32) ---

    function cyrb128(str) {
        let h1 = 1779033703, h2 = 3144134277,
            h3 = 1013904242, h4 = 2773480762;
        for (let i = 0, k; i < str.length; i++) {
            k = str.charCodeAt(i);
            h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
            h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
            h3 = h4 ^ Math.imul(h4 ^ k, 951274213);
            h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
        }
        h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
        h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
        h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
        h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
        return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
    }

    function sfc32(a, b, c, d) {
        return function () {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            let t = (a + b | 0) + d | 0;
            d = d + 1 | 0;
            a = b ^ b >>> 9;
            b = c + (c << 3) | 0;
            c = (c << 21 | c >>> 11);
            c = c + t | 0;
            return (t >>> 0) / 4294967296;
        }
    }

    // --- Global Parser Reference for Pattern internal use ---
    let globalParser = null;

    // --- Pattern Engine ---

    class Pattern {
        constructor(queryFn) {
            this.query = queryFn;
            this.prng = Math.random;
        }

        static pure(val) {
            return new Pattern((s, e) => (s <= 0 && e > 1) || (s <= 0 && 0 < e) ? [{ time: 0, value: val, duration: 1 }] : []);
        }

        static stack(...patterns) {
            return new Pattern((s, e, prng) => {
                return patterns.flatMap(p => {
                    const pat = (typeof p === 'string' ? Pattern.parseString(p) : p);
                    return pat.query(s, e, prng);
                });
            });
        }

        static arrange(...pairs) {
            const totalDuration = pairs.reduce((sum, p) => sum + p[0], 0);
            if (totalDuration === 0) return Pattern.pure('~');
            return new Pattern((s, e, prng) => {
                const results = [];
                let loopStart = Math.floor(s / totalDuration) * totalDuration;
                while (loopStart < e) {
                    let accumulated = 0;
                    pairs.forEach(([dur, pat]) => {
                        const start = loopStart + accumulated;
                        const end = start + dur;
                        const intersectS = Math.max(s, start);
                        const intersectE = Math.min(e, end);
                        if (intersectS < intersectE) {
                            const subEvents = pat.query(intersectS - start, intersectE - start, prng);
                            subEvents.forEach(ev => {
                                results.push({ ...ev, time: start + ev.time });
                            });
                        }
                        accumulated += dur;
                    });
                    loopStart += totalDuration;
                }
                return results;
            });
        }

        fast(n) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                // n can be a pattern
                const nPat = (typeof n === 'number' ? Pattern.pure(n) : n);
                const results = [];
                // Simplified: use average n for the range
                const nVal = nPat.query(s, e, prng)[0]?.value || 1;
                return originalQuery(s * nVal, e * nVal, prng).map(ev => ({
                    ...ev,
                    time: ev.time / nVal,
                    duration: ev.duration / nVal
                }));
            });
        }

        slow(n) {
            return this.fast(1 / n);
        }

        rev() {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const results = [];
                let current = s;
                while (current < e) {
                    const cycle = Math.floor(current);
                    const nextBoundary = cycle + 1;
                    const segmentEnd = Math.min(e, nextBoundary);

                    const subS = cycle + (1 - (segmentEnd - cycle));
                    const subE = cycle + (1 - (current - cycle));

                    const events = originalQuery(subS, subE, prng);
                    events.forEach(ev => {
                        const localTime = ev.time - cycle;
                        results.push({
                            ...ev,
                            time: cycle + (1 - (localTime + ev.duration))
                        });
                    });
                    current = segmentEnd;
                }
                return results;
            });
        }

        // --- Modifiers ---

        every(n, f) {
            const modified = f(this);
            return new Pattern((s, e, prng) => {
                const results = [];
                let current = s;
                while (current < e) {
                    const cycle = Math.floor(current);
                    const nextBoundary = cycle + 1;
                    const segmentEnd = Math.min(e, nextBoundary);
                    const p = (cycle % n === 0) ? modified : this;
                    results.push(...p.query(current, segmentEnd, prng));
                    current = segmentEnd;
                }
                return results;
            });
        }

        randomModifier(prob, f) {
            const originalQuery = this.query;
            const modified = f(this);
            return new Pattern((s, e, prng) => {
                const results = [];
                let current = s;
                while (current < e) {
                    const cycle = Math.floor(current);
                    const nextBoundary = cycle + 1;
                    const segmentEnd = Math.min(e, nextBoundary);

                    const seed = cyrb128(String(cycle) + String(prob));
                    const cyclePrng = sfc32(seed[0], seed[1], seed[2], seed[3]);

                    const p = (cyclePrng() < prob) ? modified : this;
                    results.push(...p.query(current, segmentEnd, prng));
                    current = segmentEnd;
                }
                return results;
            });
        }

        withValue(f) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => originalQuery(s, e, prng).map(ev => {
                const val = ev.params && ev.params.length ? [ev.value, ...ev.params] : ev.value;
                const result = f(val);
                if (typeof result === 'object' && result !== null && !(result instanceof Pattern)) return { ...ev, ...result };
                return { ...ev, value: result };
            }));
        }

        fmap(f) {
            return this.withValue(f);
        }

        innerJoin() {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const outerEvents = originalQuery(s, e, prng);
                return outerEvents.flatMap(ev => {
                    if (ev.value instanceof Pattern) {
                        const innerEvents = ev.value.query(0, 1, prng);
                        return innerEvents.map(iev => ({
                            ...ev,
                            ...iev,
                            time: ev.time + iev.time * ev.duration,
                            duration: iev.duration * ev.duration,
                        }));
                    }
                    return [ev];
                });
            });
        }

        pickRestart(patterns) {
            return new Pattern((s, e, prng) => {
                const idx = Math.floor(s) % patterns.length;
                return patterns[idx].query(s, e, prng);
            });
        }

        sometimes(f) { return this.randomModifier(0.5, f); }
        often(f) { return this.randomModifier(0.75, f); }
        rarely(f) { return this.randomModifier(0.25, f); }
        almostNever(f) { return this.randomModifier(0.1, f); }
        almostAlways(f) { return this.randomModifier(0.9, f); }

        jux(f) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const evs1 = originalQuery(s, e, prng).map(ev => ({ ...ev, pan: 0 }));
                const modified = f(this);
                const evs2 = modified.query(s, e, prng).map(ev => ({ ...ev, pan: 1 }));
                return [...evs1, ...evs2];
            });
        }

        layer(...fs) {
            return new Pattern((s, e, prng) => {
                return fs.flatMap(f => f(this).query(s, e, prng));
            });
        }

        superpose(...fs) { return this.layer(x => x, ...fs); }

        struct(p) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const structure = (typeof p === 'string' ? Pattern.parseString(p) : p).query(s, e, prng);
                const values = originalQuery(s, e, prng);
                return structure.map(se => {
                    const val = values.find(v => v.time <= se.time && v.time + v.duration > se.time);
                    return val ? { ...val, time: se.time, duration: se.duration } : null;
                }).filter(x => x);
            });
        }

        setParam(key, val) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                return originalQuery(s, e, prng).map(ev => ({ ...ev, [key]: val }));
            });
        }

        degradeBy(p) { return this.randomModifier(1 - p, x => x.setParam('value', '~')); }
        degrade() { return this.degradeBy(0.5); }

        scramble(n) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const _prng = prng || Math.random;
                const events = originalQuery(s, e, _prng);
                if (events.length === 0) return [];
                const values = events.map(ev => ev.value);
                for (let i = values.length - 1; i > 0; i--) {
                    const j = Math.floor(_prng() * (i + 1));
                    [values[i], values[j]] = [values[j], values[i]];
                }
                return events.map((ev, i) => ({ ...ev, value: values[i] }));
            });
        }

        shuffle(n) { return this.scramble(n); }

        off(n, f) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const evs1 = originalQuery(s, e, prng);
                const shifted = f(this);
                const evs2 = shifted.query(s - n, e - n, prng).map(ev => ({ ...ev, time: ev.time + n }));
                return [...evs1, ...evs2];
            });
        }

        late(n) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                return originalQuery(s - n, e - n, prng).map(ev => ({
                    ...ev,
                    time: ev.time + n
                }));
            });
        }

        stut(n, d, f) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                let allEvents = originalQuery(s, e, prng);
                let current = this;
                for (let i = 1; i < n; i++) {
                    current = f(current);
                    const shifted = current.query(s - i * d, e - i * d, prng);
                    allEvents = [...allEvents, ...shifted.map(ev => ({ ...ev, time: ev.time + i * d }))];
                }
                return allEvents;
            });
        }

        echo(n, d, f) {
            return this.stut(n, d, x => x.setParam('gain', (x.gain || 1.0) * f));
        }

        scale(s) { return this.setParam('scale', s); }
        chord(p) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const chPattern = (typeof p === 'string' ? Pattern.parseString(p) : p);
                const base = originalQuery(s, e, prng);
                return base.map(bev => {
                    const chs = chPattern.query(bev.time, bev.time + bev.duration, prng);
                    if (chs.length > 0) {
                        const chName = String(chs[0].value);
                        const match = chName.match(/^([a-g]#?)(.*)$/i);
                        if (match) {
                            const root = match[1];
                            const type = match[2] || 'maj';
                            const rootNote = parseNote(root + "4");
                            const intervals = ChordMap[type.toLowerCase()] || ChordMap['maj'];
                            const notes = intervals.map(i => rootNote + i);
                            return { ...bev, notes };
                        }
                        return { ...bev, chord: chName };
                    }
                    return bev;
                });
            });
        }

        voicing() { return this; } // Stub
        anchor(a) { return this.setParam('anchor', a); }
        rootNotes(n) { return this.setParam('rootNotes', n); }
        split() { return this; } // Stub
        patt() { return this; } // Stub

        filterValues(f) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                return originalQuery(s, e, prng).filter(ev => {
                    const val = ev.params && ev.params.length ? [ev.value, ...ev.params] : ev.value;
                    return f(val);
                });
            });
        }

        withValue(f) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                return originalQuery(s, e, prng).map(ev => {
                    const val = ev.params && ev.params.length ? [ev.value, ...ev.params] : ev.value;
                    const result = f(val);
                    if (typeof result === 'object' && result !== null) return { ...ev, ...result };
                    return { ...ev, value: result };
                });
            });
        }

        scaleTranspose(p) {
            const originalQuery = this.query;
            const otherPattern = (typeof p === 'string' ? Pattern.parseString(p) : p);
            return new Pattern((s, e, prng) => {
                const events = originalQuery(s, e, prng);
                const others = otherPattern.query(s, e, prng);
                return events.map(ev => {
                    const other = others.find(o => o.time <= ev.time);
                    if (other) {
                        const t = parseFloat(other.value) || 0;
                        return { ...ev, note: (ev.note || parseNote(ev.value, ev.scale)) + t };
                    }
                    return ev;
                });
            });
        }

        pickOut(dict) {
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const events = originalQuery(s, e, prng);
                return events.flatMap(ev => {
                    const key = String(ev.value);
                    if (dict[key]) {
                        const pat = (typeof dict[key] === 'string' ? Pattern.parseString(dict[key]) : dict[key]);
                        const subEvents = pat.query(s, e, prng);
                        return subEvents.filter(se => se.time >= ev.time && se.time < ev.time + ev.duration);
                    }
                    return [];
                });
            });
        }

        add(p) {
            const otherPattern = (typeof p === 'string' ? Pattern.parseString(p) : p);
            const originalQuery = this.query;
            return new Pattern((s, e, prng) => {
                const events = originalQuery(s, e, prng);
                const others = otherPattern.query(s, e, prng);
                return events.flatMap(ev => {
                    if (others.length === 0) return [ev];
                    return others.map(oev => ({
                        ...ev,
                        note: (ev.note || parseNote(ev.value, ev.scale)) + (parseFloat(oev.value) || 0)
                    }));
                });
            });
        }

        transpose(p) {
            const originalQuery = this.query;
            const trPat = (typeof p === 'string' || typeof p === 'number' ? Pattern.pure(p) : p);
            return new Pattern((s, e, prng) => {
                return originalQuery(s, e, prng).map(ev => {
                    const trs = trPat.query(ev.time, ev.time + ev.duration, prng);
                    if (trs.length > 0) {
                        const amount = parseFloat(trs[0].value) || 0;
                        return { ...ev, note: (ev.note || parseNote(ev.value, ev.scale)) + amount };
                    }
                    return ev;
                });
            });
        }

        penv(p) { return this.scaleTranspose(p); }
        distort(v) { return this.setParam('distort', v); }
        vib(v) { return this.setParam('vib', v); }
        vibmod(v) { return this.setParam('vibmod', v); }
        delay(v) { return this.setParam('delay', v); }
        lpf(v) { return this.setParam('lpf', v); }
        hpf(v) { return this.setParam('hpf', v); }
        gain(v) { return this.setParam('gain', v); }
        pan(v) { return this.setParam('pan', v); }
        room(v) { return this.setParam('room', v); }
        velocity(v) { return this.setParam('velocity', v); }
        att(v) { return this.setParam('att', v); }
        rel(v) { return this.setParam('rel', v); }
        clip(v) { return this.setParam('clip', v); }
        bank(v) { return this.setParam('bank', v); }
        color(v) { return this.setParam('color', v); }
        speed(v) { return this.setParam('speed', v); }
        hpa(v) { return this.setParam('hpa', v); }
        hpd(v) { return this.setParam('hpd', v); }
        hpe(v) { return this.setParam('hpe', v); }
        dt(v) { return this.setParam('dt', v); }
        dfb(v) { return this.setParam('dfb', v); }
        note(v) { return v !== undefined ? this.setParam('note', v) : this; }
        velocity(v) { return this.setParam('velocity', v); }
        sustain(v) { return this.setParam('release', v); }
        rsize(v) { return this.setParam('rsize', v); }
        voicing() { return this; }
        patt() { return this; }
        split() { return this; }
        mode(m) { return this.setParam('mode', m); }

        static parseString(str) {
            str = str.trim();
            if (!str) return Pattern.pure('~');

            // 1. Handle comma-separated layers (stack)
            const layers = this._splitByDepth(str, ',');
            if (layers.length > 1) {
                const patterns = layers.map(l => this.parseString(l));
                return new Pattern((s, e, prng) => {
                    return patterns.flatMap(p => p.query(s, e, prng));
                });
            }

            // 2. Handle random choice (|)
            const choices = this._splitByDepth(str, '|');
            if (choices.length > 1) {
                return new Pattern((s, e, prng) => {
                    const _prng = prng || Math.random;
                    const idx = Math.floor(_prng() * choices.length);
                    return this.parseString(choices[idx]).query(s, e, _prng);
                });
            }

            // 3. Tokenize by space
            const tokens = this._splitByDepth(str, ' ');
            const parsedTokens = tokens.map(t => this._parseToken(t));
            return new Pattern((s, e, prng) => this._queryInternal(parsedTokens, s, e, prng));
        }

        static _splitByDepth(s, separator) {
            let parts = [];
            let depth = 0;
            let angleDepth = 0;
            let current = "";
            for (let i = 0; i < s.length; i++) {
                if (s[i] === '[') depth++;
                if (s[i] === ']') depth--;
                if (s[i] === '<') angleDepth++;
                if (s[i] === '>') angleDepth--;

                if (s[i] === separator && depth === 0 && angleDepth === 0) {
                    if (current.trim()) parts.push(current.trim());
                    current = "";
                } else {
                    current += s[i];
                }
            }
            if (current.trim()) parts.push(current.trim());
            return parts;
        }

        static _parseToken(token) {
            // Handle random drop-out: sound?
            let probability = 1.0;
            if (token.endsWith('?')) {
                token = token.slice(0, -1);
                probability = 0.5;
            }

            // Handle parameters/indexing: sound:1:2
            const parts = token.split(':');
            token = parts[0];
            const params = parts.slice(1).map(p => p.trim());

            // Handle duration modifier: sound@n
            let durationMult = 1.0;
            const durMatch = token.match(/^(.+)@(\d+(\.\d+)?)$/);
            if (durMatch) {
                token = durMatch[1];
                durationMult = parseFloat(durMatch[2]);
            }

            // Handle cycle division: pattern/n
            const divMatch = token.match(/^(.+)\/(\d+(\.\d+)?)$/);
            if (divMatch) {
                const sub = this.parseString(divMatch[1]);
                return { type: 'subpattern', pattern: sub.slow(parseFloat(divMatch[2])), durationMult, probability, params };
            }
            // Handle angle brackets: <a b c>
            if (token.startsWith('<') && token.endsWith('>')) {
                const inner = token.substring(1, token.length - 1);
                const choices = this._splitByDepth(inner, ' ').filter(x => x);
                return { type: 'choice-per-cycle', choices: choices.map(c => this.parseString(c)), durationMult, probability, params };
            }
            // Euclidean Rhythm: name(k, n)
            const eucMatch = token.match(/^([a-z0-9_:]+)\((\d+),(\d+)\)$/i);
            if (eucMatch) {
                return { type: 'euclidean', name: eucMatch[1], k: parseInt(eucMatch[2]), n: parseInt(eucMatch[3]), durationMult, probability, params };
            }
            // Sub-pattern: [ ... ]
            if (token.startsWith('[') && token.endsWith(']')) {
                return { type: 'subpattern', pattern: this.parseString(token.substring(1, token.length - 1)), durationMult, probability, params };
            }
            // Choices: rchoose[a, b, c]
            if (token.startsWith('rchoose')) {
                const match = token.match(/rchoose\s*\[([^\]]+)\]/);
                if (match) {
                    return { type: 'rchoose', choices: match[1].split(',').map(c => c.trim()), durationMult, probability, params };
                }
            }
            // Multiplier: sound*n:index or sound!n
            const multMatch = token.match(/^([a-z0-9_:]+)[*!](\d+)(:(.+))?$/i);
            if (multMatch) {
                const indexPat = multMatch[4] ? this.parseString(multMatch[4]) : null;
                return { type: 'multiplier', name: multMatch[1], n: parseInt(multMatch[2]), index: indexPat, durationMult, probability, params };
            }
            // Normal token
            return { type: 'value', value: token, durationMult, probability, params };
        }

        static _queryInternal(tokens, s, e, prng) {
            const results = [];
            const _prng = prng || Math.random;

            const startCycle = Math.floor(s);
            const endCycle = Math.ceil(e);

            for (let cycle = startCycle; cycle < endCycle; cycle++) {
                const totalWeight = tokens.reduce((sum, t) => sum + (t.durationMult || 1), 0);
                let currentStepInCycle = 0;

                tokens.forEach((token, i) => {
                    const stepWeight = token.durationMult || 1;
                    const stepSize = stepWeight / totalWeight;

                    const stepStart = cycle + currentStepInCycle;
                    const stepEnd = stepStart + stepSize;

                    // Calculate intersection of [stepStart, stepEnd] and [s, e]
                    const intersectS = Math.max(s, stepStart);
                    const intersectE = Math.min(e, stepEnd);

                    if (intersectS < intersectE) {
                        // Handle random drop-out
                        if (token.probability < 1.0 && _prng() > token.probability) {
                            currentStepInCycle += stepSize;
                            return;
                        }

                        const evParams = token.params && token.params.length ? { params: token.params } : {};

                        switch (token.type) {
                            case 'choice-per-cycle': {
                                const idx = cycle % token.choices.length;
                                const subEvents = token.choices[idx].query(intersectS, intersectE, _prng);
                                subEvents.forEach(ev => results.push({ ...ev, ...evParams }));
                                break;
                            }
                            case 'euclidean': {
                                const subStepSize = stepSize / token.n;
                                for (let j = 0; j < token.n; j++) {
                                    const pulseStart = stepStart + j * subStepSize;
                                    const pulseEnd = pulseStart + subStepSize;
                                    if (pulseStart < intersectE && pulseEnd > intersectS) {
                                        if ((j * token.k) % token.n < token.k) {
                                            results.push({ time: pulseStart, value: token.name, duration: subStepSize, ...evParams });
                                        }
                                    }
                                }
                                break;
                            }
                            case 'multiplier': {
                                const subStepSize = stepSize / token.n;
                                for (let j = 0; j < token.n; j++) {
                                    const pulseStart = stepStart + j * subStepSize;
                                    const pulseEnd = pulseStart + subStepSize;
                                    if (pulseStart < intersectE && pulseEnd > intersectS) {
                                        let name = token.name;
                                        if (token.index) {
                                            const idxEvs = token.index.query(pulseStart, pulseEnd, _prng);
                                            if (idxEvs.length > 0) name += ":" + idxEvs[0].value;
                                        }
                                        results.push({ time: pulseStart, value: name, duration: subStepSize, ...evParams });
                                    }
                                }
                                break;
                            }
                            case 'subpattern': {
                                // Sub-patterns need to be queried in their relative [0, 1] range
                                const subEvents = token.pattern.query((intersectS - stepStart) / stepSize, (intersectE - stepStart) / stepSize, _prng);
                                subEvents.forEach(ev => {
                                    results.push({
                                        time: stepStart + ev.time * stepSize,
                                        value: ev.value,
                                        duration: ev.duration * stepSize,
                                        ...evParams
                                    });
                                });
                                break;
                            }
                            case 'rchoose': {
                                if (stepStart < intersectE && stepEnd > intersectS) {
                                    const val = token.choices[Math.floor(_prng() * token.choices.length)];
                                    if (val !== '~') results.push({ time: stepStart, value: val, duration: stepSize, ...evParams });
                                }
                                break;
                            }
                            case 'value': {
                                if (stepStart < intersectE && stepEnd > intersectS) {
                                    if (token.value === '_') {
                                        if (results.length > 0) results[results.length - 1].duration += stepSize;
                                    } else if (token.value !== '~') {
                                        results.push({ time: stepStart, value: token.value, duration: stepSize, ...evParams });
                                    }
                                }
                                break;
                            }
                        }
                    }
                    currentStepInCycle += stepSize;
                });
            }
            return results;
        }
    }

    // --- Synthesizer Utilities ---

    let InstrumentMap = {
        'amen': { bank: 0, program: 116, channel: 9 },
        'bd': { bank: 0, program: 116, channel: 9 },
        'sn': { bank: 0, program: 116, channel: 9 },
        'hc': { bank: 0, program: 116, channel: 9 },
        'hh': { bank: 0, program: 116, channel: 9 },
        'bass': { bank: 0, program: 39, channel: 1 },
        'pad': { bank: 0, program: 90, channel: 0 },
        'lead': { bank: 0, program: 81, channel: 2 },
        'perc': { bank: 0, program: 116, channel: 9 },
        // GM Instruments
        'gm_piano': { bank: 0, program: 0, channel: 0 },
        'gm_harpsichord': { bank: 0, program: 6, channel: 0 },
        'gm_glockenspiel': { bank: 0, program: 9, channel: 0 },
        'gm_tubular_bells': { bank: 0, program: 14, channel: 0 },
        'gm_drawbar_organ': { bank: 0, program: 16, channel: 4 },
        'gm_percussive_organ': { bank: 0, program: 18, channel: 4 },
        'gm_church_organ': { bank: 0, program: 19, channel: 4 },
        'gm_electric_guitar_clean': { bank: 0, program: 27, channel: 3 },
        'gm_overdriven_guitar': { bank: 0, program: 29, channel: 3 },
        'gm_distortion_guitar': { bank: 0, program: 30, channel: 3 },
        'gm_electric_bass_finger': { bank: 0, program: 33, channel: 1 },
        'gm_violin': { bank: 0, program: 40, channel: 5 },
        'gm_cello': { bank: 0, program: 42, channel: 5 },
        'gm_contrabass': { bank: 0, program: 43, channel: 5 },
        'gm_pizzicato_strings': { bank: 0, program: 45, channel: 0 },
        'gm_timpani': { bank: 0, program: 47, channel: 9 },
        'gm_string_ensemble_1': { bank: 0, program: 48, channel: 0 },
        'gm_string_ensemble_2': { bank: 0, program: 49, channel: 0 },
        'gm_choir_aahs': { bank: 0, program: 52, channel: 0 },
        'gm_choir_oohs': { bank: 0, program: 53, channel: 0 },
        'gm_synth_choir': { bank: 0, program: 54, channel: 0 },
        'gm_oboe': { bank: 0, program: 68, channel: 6 },
        'gm_flute': { bank: 0, program: 73, channel: 6 },
        'gm_recorder': { bank: 0, program: 74, channel: 6 },
        'gm_pan_flute': { bank: 0, program: 75, channel: 6 },
        'gm_lead_8_bass_lead': { bank: 0, program: 87, channel: 2 },
        'supersaw': { bank: 0, program: 81, channel: 2 },
        'piano': { bank: 0, program: 0, channel: 0 },
        'bass': { bank: 0, program: 33, channel: 1 },
        'triangle': { bank: 0, program: 81, channel: 2 },
        'sawtooth': { bank: 0, program: 81, channel: 2 },
        'square': { bank: 0, program: 80, channel: 2 },
        'sine': { bank: 0, program: 80, channel: 2 },
        'choir': { bank: 0, program: 52, channel: 0 },
        'vox': { bank: 0, program: 54, channel: 0 },
        'aahs': { bank: 0, program: 52, channel: 0 },
        'oohs': { bank: 0, program: 53, channel: 0 }
    };

    function getInstrument(sound) {
        if (!sound) return InstrumentMap['lead'];
        let name = sound.split(':')[0].toLowerCase();

        if (InstrumentMap[name]) return InstrumentMap[name];

        // Try with gm_ prefix if not present
        if (!name.startsWith('gm_')) {
            const gmName = 'gm_' + name;
            if (InstrumentMap[gmName]) return InstrumentMap[gmName];
        }

        const cleanName = name.replace(/^gm_/, '');
        if (InstrumentMap[cleanName]) return InstrumentMap[cleanName];

        // Drum bank mappings
        if (['bd', 'sn', 'hh', 'hc', 'oh', 'cr'].includes(cleanName)) return InstrumentMap['bd'];

        // Default mappings based on keywords
        if (name.includes('guitar')) return InstrumentMap['gm_overdriven_guitar'];
        if (name.includes('bass')) return InstrumentMap['gm_electric_bass_finger'];
        if (name.includes('pad') || name.includes('strings') || name.includes('ensemble') || name.includes('choir') || name.includes('vox') || name.includes('aahs')) return InstrumentMap['gm_string_ensemble_1'];
        if (name.includes('lead')) return InstrumentMap['lead'];
        if (name.includes('organ')) return InstrumentMap['gm_drawbar_organ'];
        if (name.includes('violin') || name.includes('cello')) return InstrumentMap['gm_violin'];
        if (name.includes('piano')) return InstrumentMap['gm_piano'];
        if (name.includes('perc') || name.includes('drum') || name.includes('kit')) return InstrumentMap['bd'];

        return InstrumentMap['lead'];
    }

    const NoteMap = {
        'c2': 36, 'c3': 48, 'c4': 60, 'c5': 72,
        'hc': 42, 'bd': 36, 'sn': 38
    };

    const ChordMap = {
        'maj': [0, 4, 7], 'min': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11],
        'min7': [0, 3, 7, 10], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
        'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
        '9': [0, 4, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14], 'min9': [0, 3, 7, 10, 14],
        '11': [0, 4, 7, 10, 14, 17], '13': [0, 4, 7, 10, 14, 21],
        'min7b5': [0, 3, 6, 10], 'm7b5': [0, 3, 6, 10], 'half_diminished': [0, 3, 6, 10],
        'dim7': [0, 3, 6, 9], 'diminished7': [0, 3, 6, 9],
        'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14], 'maj7#11': [0, 4, 7, 11, 18],
        '7b9': [0, 4, 7, 10, 13], '7#9': [0, 4, 7, 10, 15]
    };

    const ScaleMap = {
        'major': [0, 2, 4, 5, 7, 9, 11],
        'minor': [0, 2, 3, 5, 7, 8, 10],
        'ionian': [0, 2, 4, 5, 7, 9, 11],
        'dorian': [0, 2, 3, 5, 7, 9, 10],
        'phrygian': [0, 1, 3, 5, 7, 8, 10],
        'lydian': [0, 2, 4, 6, 7, 9, 11],
        'mixolydian': [0, 2, 4, 5, 7, 9, 10],
        'aeolian': [0, 2, 3, 5, 7, 8, 10],
        'locrian': [0, 1, 3, 5, 6, 8, 10],
        'pentatonic': [0, 2, 4, 7, 9],
        'major_pentatonic': [0, 2, 4, 7, 9],
        'minor_pentatonic': [0, 3, 5, 7, 10],
        'harmonic_minor': [0, 2, 3, 5, 7, 8, 11],
        'melodic_minor': [0, 2, 3, 5, 7, 9, 11],
        'phrygian_dominant': [0, 1, 4, 5, 7, 8, 10],
        'whole_tone': [0, 2, 4, 6, 8, 10],
        'diminished': [0, 1, 3, 4, 6, 7, 9, 10],
        'octatonic': [0, 1, 3, 4, 6, 7, 9, 10],
        'acoustic': [0, 2, 4, 6, 7, 9, 10],
        'lydian_dominant': [0, 2, 4, 6, 7, 9, 10],
        'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    };

    function parseNote(val, scaleStr = 'chromatic') {
        if (typeof val === 'number') return val;
        if (!val) return 60;
        const sVal = String(val).toLowerCase();

        // Handle scale degrees (integers)
        const intVal = parseInt(sVal);
        if (!isNaN(intVal) && !sVal.match(/[a-g]/)) {
            const scaleParts = String(scaleStr).toLowerCase().split(':');
            const root = scaleParts.length > 1 ? parseNote(scaleParts[0]) : 48;
            const scaleName = scaleParts.length > 1 ? scaleParts[1] : scaleParts[0];
            const scale = ScaleMap[scaleName] || ScaleMap['chromatic'];
            const octave = Math.floor(intVal / scale.length);
            const degree = ((intVal % scale.length) + scale.length) % scale.length;
            return root + (octave * 12) + scale[degree];
        }

        const match = sVal.match(/([a-g]#?\d+)/i);
        if (match) {
            const base = match[1].toLowerCase();
            const notes = { 'c': 0, 'c#': 1, 'd': 2, 'd#': 3, 'e': 4, 'f': 5, 'f#': 6, 'g': 7, 'g#': 8, 'a': 9, 'a#': 10, 'b': 11 };
            const nameMatch = base.match(/[a-g]#?/);
            const name = nameMatch ? nameMatch[0] : 'c';
            const octMatch = base.match(/\d+/);
            const oct = octMatch ? parseInt(octMatch[0]) : 4;
            return (oct + 1) * 12 + notes[name];
        }
        return NoteMap[sVal] || 60;
    }

    // --- Strudel Parser ---

    class StrudelParser {
        constructor(engine) {
            this.engine = engine;
            this.variables = {};
            this.customModifiers = {};
            globalParser = this;
        }

        parse(script) {
            this.engine.patterns = {};
            this.variables = {};
            let cps = 1.0;

            // 1. Variable and Object Extraction
            // Improved section splitting to catch labels even if not at the start of the file
            const sections = script.split(/(?:\n|^)(?=const|let|var|register|\$:|[a-z0-9_$]+:)/i);
            sections.forEach(section => {
                section = section.trim();
                const vMatch = section.match(/^(?:const|let|var)\s+([a-z0-9_]+)\s*=\s*([\s\S]+)/i);
                if (vMatch) {
                    const name = vMatch[1];
                    let val = vMatch[2].trim();
                    if (val.endsWith(';')) val = val.slice(0, -1);
                    this.variables[name] = val;
                }
                const rMatch = section.match(/^register\s*\(\s*['"]([a-z0-9_]+)['"]\s*,\s*\(([\s\S]+?)\)\s*=>\s*([\s\S]+)\)/i);
                if (rMatch) {
                    const name = rMatch[1];
                    const args = rMatch[2].split(',').map(a => a.trim());
                    const body = rMatch[3].trim();
                    this.register(name, { args, body });
                }
            });

            // 2. Pattern and Global Extraction
            const implicitCount = [0];
            sections.forEach(section => {
                section = section.trim();
                if (section.startsWith('$:') || section.match(/^[snk]\(/) || section.match(/^stack\(/) || section.match(/^cat\(/) || section.match(/^seq\(/)) {
                    const code = section.startsWith('$:') ? section.substring(2).trim() : section;
                    const name = `p_${implicitCount[0]++}`;
                    this.engine.patterns[name] = this.parseStrudelChain(code);
                } else if (section.match(/^([a-z0-9_$]+):/i)) {
                    const match = section.match(/^([a-z0-9_$]+):/i);
                    const name = match[1];
                    const code = section.substring(name.length + 1).trim();
                    this.engine.patterns[name] = this.parseStrudelChain(code);
                }
            });

            // 3. System commands
            sections.forEach(section => {
                const cpsMatch = section.match(/^setcps\((.+)\)/i);
                if (cpsMatch) { const v = parseNumericExpr(cpsMatch[1]); if (!isNaN(v)) cps = v; }
                const cpmMatch = section.match(/^setcpm\((.+)\)/i);
                if (cpmMatch) { const v = parseNumericExpr(cpmMatch[1]); if (!isNaN(v)) cps = v / 60; }
            });

            // 4. Global Modifiers (all)
            const allMatch = script.match(/all\s*\(\s*x\s*=>\s*([\s\S]+?)\)/);
            if (allMatch) {
                const body = allMatch[1].trim();
                const chain = body.replace(/^x\.?/, '');
                for (let name in this.engine.patterns) {
                    this.engine.patterns[name] = this.parseStrudelChain(chain, this.engine.patterns[name]);
                }
            }

            this.engine.cps = cps;
        }

        register(name, config) {
            // Config contains args and body
            this.customModifiers[name] = config;
        }

        setDefaultVoicings(v) {
            // Stub
        }

        slider(v, min, max, step) {
            return v;
        }

        resolveValue(val) {
            val = val.trim();
            if (this.variables[val]) {
                const resolved = this.resolveValue(this.variables[val]);
                // If it looks like a chain, don't return as string
                if (typeof resolved === 'string' && (resolved.includes('.') || resolved.includes('('))) {
                    return resolved;
                }
                return resolved;
            }
            // Handle expressions/chains directly in resolveValue
            if (val.includes('.') || val.includes('(')) {
                return val;
            }
            // Handle objects {i: "...", j: "..."}
            if (val.startsWith('{') && val.endsWith('}')) {
                const obj = {};
                const inner = val.substring(1, val.length - 1);
                // Simple pair parsing
                const pairs = inner.split(/,(?![^\[]*\])(?![^\{]*\})(?![^\(]*\))/);
                pairs.forEach(p => {
                    const [k, ...v] = p.split(':');
                    if (k && v.length) obj[k.trim()] = v.join(':').trim().replace(/^["'`]|["'`]$/g, '');
                });
                return obj;
            }
            // Handle strings
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")) || (val.startsWith("`") && val.endsWith("`"))) {
                return val.substring(1, val.length - 1);
            }
            return val;
        }

        parseStrudelChain(str, startPattern = null) {
            let currentPattern = startPattern;
            str = str.trim();

            // Handle Global Functions
            if (str.startsWith('stack(') || str.startsWith('layer(') || str.startsWith('cat(') || str.startsWith('seq(')) {
                const type = str.split('(')[0];
                const inner = str.substring(type.length + 1, str.lastIndexOf(')'));
                const parts = Pattern._splitByDepth(inner, ',');
                const patterns = parts.map(p => this.parseStrudelChain(p.trim()));

                if (type === 'stack' || type === 'layer') {
                    currentPattern = new Pattern((s, e, prng) => patterns.flatMap(p => p.query(s, e, prng)));
                } else if (type === 'cat' || type === 'seq') {
                    currentPattern = new Pattern((s, e, prng) => {
                        const results = [];
                        let current = s;
                        while (current < e) {
                            const cycle = Math.floor(current);
                            const nextBoundary = cycle + 1;
                            const segmentEnd = Math.min(e, nextBoundary);
                            const idx = cycle % patterns.length;
                            const subEvents = patterns[idx].query(current - cycle, segmentEnd - cycle, prng);
                            subEvents.forEach(ev => {
                                results.push({ ...ev, time: cycle + ev.time });
                            });
                            current = segmentEnd;
                        }
                        return results;
                    });
                } else if (type === 'arrange') {
                    // arrange expects [dur, pat] pairs. 
                    // In our simplified parser, we might need to eval the inner parts if they are complex.
                    const pairs = parts.map(p => {
                        try {
                            // Try to evaluate as [dur, pat]
                            // This is dangerous but we are in an eval-heavy environment already.
                            // We replace pattern names with their resolved patterns first.
                            let code = p.trim();
                            for (let name in this.variables) {
                                code = code.replace(new RegExp(`(?<![a-z0-9_])${name}(?![a-z0-9_])`, 'g'), `this.parseStrudelChain(this.variables['${name}'])`);
                            }
                            // This won't work easily with eval due to 'this' context.
                            // Let's use a simpler approach for arrange parsing.
                            const pairMatch = p.match(/^\s*\[\s*(.+?)\s*,\s*(.+?)\s*\]\s*$/);
                            if (pairMatch) {
                                const dur = parseNumericExpr(pairMatch[1]);
                                if (isNaN(dur)) return [1, Pattern.pure('~')];
                                const pat = this.parseStrudelChain(pairMatch[2]);
                                return [dur, pat];
                            }
                        } catch (e) { }
                        return [1, Pattern.pure('~')];
                    });
                    currentPattern = Pattern.arrange(...pairs);
                }
            }

            // Improved Core Extraction (Handles nested parentheses like n("...".add("...")))
            if (!currentPattern) {
                const firstParen = str.indexOf('(');
                const firstDot = str.indexOf('.');
                if (firstParen !== -1 && (firstDot === -1 || firstParen < firstDot)) {
                    const type = str.substring(0, firstParen).trim();
                    const validCores = ['s', 'n', 'nk', 'chord', 'melody', 'note', 'arrange', 'stack', 'cat', 'seq'];
                    if (validCores.includes(type)) {
                        let depth = 0;
                        let endIdx = -1;
                        for (let i = firstParen; i < str.length; i++) {
                            if (str[i] === '(') depth++;
                            if (str[i] === ')') depth--;
                            if (depth === 0) {
                                endIdx = i;
                                break;
                            }
                        }
                        if (endIdx !== -1) {
                            const contentStr = str.substring(firstParen + 1, endIdx);
                            const content = this.resolveValue(contentStr);
                            currentPattern = this.parseStrudelChain(content);

                            if (type === 's') currentPattern = currentPattern.setParam('sound', content);
                            if (type === 'n' || type === 'nk' || type === 'note') {
                                currentPattern = currentPattern.withValue(v => {
                                    const n = parseNote(v);
                                    return { value: v, note: n };
                                });
                            }
                            if (type === 'chord') currentPattern = currentPattern.chord(content);
                        }
                    }
                }

                // Fallback for string literals or variables at the start
                if (!currentPattern) {
                    const firstPart = str.split('.')[0].trim();
                    if (this.variables[firstPart]) {
                        currentPattern = this.parseStrudelChain(this.variables[firstPart]);
                    } else if (firstPart.startsWith('"') || firstPart.startsWith("'") || firstPart.startsWith("`")) {
                        currentPattern = Pattern.parseString(this.resolveValue(firstPart));
                    }
                }
            }

            if (!currentPattern) return Pattern.pure('~');

            // Parse Modifiers
            const modRegex = /\.([a-z0-9]+)\s*\(([\s\S]*?)\)/gi;
            let m;
            while ((m = modRegex.exec(str)) !== null) {
                const func = m[1].toLowerCase();
                const args = m[2].trim();

                // Handle Custom Modifiers (ati, fvi, etc.)
                if (this.customModifiers[func]) {
                    const config = this.customModifiers[func];
                    const providedArgs = args.split(',').map(a => a.trim());
                    // This is a simplified replacement for the body
                    let body = config.body;
                    config.args.forEach((arg, i) => {
                        if (i < providedArgs.length && arg !== 'pat' && arg !== 'p') {
                            const usageRegex = new RegExp(`(?<![a-z0-9_])${arg}(?![a-z0-9_])`, 'g');
                            body = body.replace(usageRegex, providedArgs[i]);
                        }
                    });
                    const chain = body.replace(/^(?:pat|p|x)\.?/, '');
                    currentPattern = this.parseStrudelChain(chain, currentPattern);
                    continue;
                }

                // Handle Arrow Functions x => x...
                if (args.includes('=>')) {
                    const parts = args.split('=>');
                    const argName = parts[0].trim();
                    const body = parts[1].trim();
                    const chain = body.replace(new RegExp(`^${argName}\\.?`), '');

                    if (func === 'filtervalues' || func === 'withvalue') {
                        // Handle common patterns in mouthbreathercomplex.js
                        if (body.match(/\[\s*(\d+)\s*\]\s*==\s*(['"`].+?['"`])/)) {
                            const match = body.match(/\[\s*(\d+)\s*\]\s*==\s*(['"`].+?['"`])/);
                            const idx = parseInt(match[1]);
                            const expected = match[2].replace(/['"`]/g, '');
                            const f = (v) => Array.isArray(v) ? v[idx] == expected : v == expected;
                            currentPattern = currentPattern[func](f);
                        } else {
                            const f = (p) => this.parseStrudelChain(chain, p);
                            if (typeof currentPattern[func] === 'function') {
                                currentPattern = currentPattern[func](f);
                            }
                        }
                    } else {
                        const f = (p) => this.parseStrudelChain(chain, p);
                        if (typeof currentPattern[func] === 'function') {
                            currentPattern = currentPattern[func](f);
                        } else {
                            currentPattern = currentPattern.randomModifier(0.5, f);
                        }
                    }
                    continue;
                }

                const val = parseFloat(args);
                const sVal = this.resolveValue(args);

                switch (func) {
                    case 'slow': currentPattern = currentPattern.slow(val || 1); break;
                    case 'fast': currentPattern = currentPattern.fast(val || 1); break;
                    case 'rev': currentPattern = currentPattern.rev(); break;
                    case 'every': {
                        const parts = args.split(',');
                        const n = parseInt(parts[0]);
                        const fBody = parts[1].trim().split('=>')[1].trim().replace(/^x\.?/, '');
                        currentPattern = currentPattern.every(n, (p) => this.parseStrudelChain(fBody, p));
                        break;
                    }
                    case 'transpose': {
                        const originalQuery = currentPattern.query;
                        const tValues = sVal.startsWith('[') ? sVal.substring(1, sVal.length - 1).split(',').map(v => parseFloat(v)) : [parseFloat(sVal)];
                        currentPattern = new Pattern((s, e, prng) => {
                            const events = originalQuery(s, e, prng);
                            return events.flatMap(ev => tValues.map(tv => ({
                                ...ev,
                                note: (ev.note || parseNote(ev.value, ev.scale)) + tv
                            })));
                        });
                        break;
                    }
                    case 'pickrestart':
                    case 'pick': {
                        const dict = this.resolveValue(args);
                        if (typeof dict === 'object') {
                            const originalQuery = currentPattern.query;
                            const parsedDict = {};
                            for (let k in dict) parsedDict[k] = this.parseStrudelChain(dict[k]);
                            currentPattern = new Pattern((s, e, prng) => {
                                const controls = originalQuery(s, e, prng);
                                return controls.flatMap(c => {
                                    const key = String(c.value);
                                    if (parsedDict[key]) {
                                        const subEvents = parsedDict[key].query(s, e, prng);
                                        return subEvents.filter(se => se.time >= c.time && se.time < c.time + c.duration);
                                    }
                                    return [];
                                });
                            });
                        }
                        break;
                    }
                    case 'euclid': {
                        const parts = args.split(',').map(p => parseInt(p.trim()));
                        const k = parts[0], n = parts[1];
                        const originalQuery = currentPattern.query;
                        currentPattern = new Pattern((s, e, prng) => {
                            const events = originalQuery(s, e, prng);
                            return events.flatMap(ev => {
                                const results = [];
                                const subStepSize = ev.duration / n;
                                for (let j = 0; j < n; j++) {
                                    const pulseStart = ev.time + j * subStepSize;
                                    if ((j * k) % n < k) {
                                        if (pulseStart >= s && pulseStart < e) {
                                            results.push({ ...ev, time: pulseStart, duration: subStepSize });
                                        }
                                    }
                                }
                                return results;
                            });
                        });
                        break;
                    }
                    case 'layer':
                    case 'superpose': {
                        const parts = Pattern._splitByDepth(args, ',');
                        const fs = parts.map(p => {
                            const body = p.trim().split('=>')[1].trim().replace(/^x\.?/, '');
                            return (x) => this.parseStrudelChain(body, x);
                        });
                        currentPattern = currentPattern.layer(...fs);
                        if (func === 'superpose') currentPattern = currentPattern.superpose();
                        break;
                    }
                    case 'gain':
                    case 'v':
                    case 'velocity': currentPattern = currentPattern.setParam('gain', val); break;
                    case 'pan': currentPattern = currentPattern.setParam('pan', val); break;
                    case 'room': currentPattern = currentPattern.setParam('room', val); break;
                    case 'lpf': currentPattern = currentPattern.setParam('lpf', val); break;
                    case 'hpf': currentPattern = currentPattern.setParam('hpf', val); break;
                    case 'rel':
                    case 'release': currentPattern = currentPattern.setParam('release', val); break;
                    case 'clip': currentPattern = currentPattern.setParam('clip', val); break;
                    case 'bank': currentPattern = currentPattern.setParam('bank', sVal); break;
                    case 's':
                    case 'sound': currentPattern = currentPattern.setParam('sound', sVal); break;
                    case 'scale': {
                        const originalQuery = currentPattern.query;
                        const scalePatStr = sVal;
                        currentPattern = new Pattern((s, e, prng) => {
                            const events = originalQuery(s, e, prng);
                            const scalePat = Pattern.parseString(scalePatStr);
                            return events.map(ev => {
                                const scEvs = scalePat.query(ev.time, ev.time + ev.duration, prng);
                                if (scEvs.length > 0) return { ...ev, scale: scEvs[0].value };
                                return ev;
                            });
                        });
                        break;
                    }
                    case 'piano': currentPattern = currentPattern.setParam('sound', 'piano'); break;
                    case 'bass': currentPattern = currentPattern.setParam('sound', 'bass'); break;
                    case 'triangle': currentPattern = currentPattern.setParam('sound', 'triangle'); break;
                    case 'sawtooth': currentPattern = currentPattern.setParam('sound', 'sawtooth'); break;
                    case 'square': currentPattern = currentPattern.setParam('sound', 'square'); break;
                    case 'sine': currentPattern = currentPattern.setParam('sound', 'sine'); break;
                    case 'degradeby': currentPattern = currentPattern.degradeBy(val); break;
                    case 'degrade': currentPattern = currentPattern.degrade(); break;
                    case 'scramble': currentPattern = currentPattern.scramble(val); break;
                    case 'shuffle': currentPattern = currentPattern.shuffle(val); break;
                    case 'off': {
                        const parts = args.split(',');
                        const n = parseFloat(parts[0]);
                        const fBody = parts[1].trim().split('=>')[1].trim().replace(/^x\.?/, '');
                        currentPattern = currentPattern.off(n, (p) => this.parseStrudelChain(fBody, p));
                        break;
                    }
                    case 'stut': {
                        const parts = args.split(',');
                        const n = parseInt(parts[0]);
                        const d = parseFloat(parts[1]);
                        const fBody = parts[2].trim().split('=>')[1].trim().replace(/^x\.?/, '');
                        currentPattern = currentPattern.stut(n, d, (p) => this.parseStrudelChain(fBody, p));
                        break;
                    }
                    case 'chord': currentPattern = currentPattern.chord(sVal); break;
                    case 'voicing': currentPattern = currentPattern.voicing(); break;
                    case 'anchor': currentPattern = currentPattern.anchor(sVal); break;
                    case 'rootnotes': currentPattern = currentPattern.rootNotes(val); break;
                    case 'split': currentPattern = currentPattern.split(); break;
                    case 'patt': currentPattern = currentPattern.patt(); break;
                    case 'filtervalues':
                    case 'fvi': {
                        // Generic handler for filterValues already covered in arrow function logic
                        break;
                    }
                    case 'withvalue':
                    case 'ati': {
                        // Generic handler for withValue already covered in arrow function logic
                        break;
                    }
                    case 'scaletranspose': currentPattern = currentPattern.scaleTranspose(sVal); break;
                    case 'penv': currentPattern = currentPattern.penv(sVal); break;
                    case 'add': currentPattern = currentPattern.add(sVal); break;
                    case 'distort': currentPattern = currentPattern.distort(sVal); break;
                    case 'vib': currentPattern = currentPattern.vib(val); break;
                    case 'vibmod': currentPattern = currentPattern.vibmod(val); break;
                    case 'delay': currentPattern = currentPattern.delay(val); break;
                    case 'pickout': {
                        const dict = this.resolveValue(args);
                        if (typeof dict === 'object') {
                            const parsedDict = {};
                            for (let k in dict) parsedDict[k] = this.parseStrudelChain(dict[k]);
                            currentPattern = currentPattern.pickOut(parsedDict);
                        }
                        break;
                    }
                    case 'mode': currentPattern = currentPattern.mode(sVal); break;
                    case 'jux': {
                        const arrowParts = args.split('=>');
                        if (arrowParts.length < 2) {
                            console.warn('ProceduralMusicUtils: jux expects an arrow function, got:', args);
                            break;
                        }
                        const fBody = arrowParts[1].trim().replace(/^x\.?/, '');
                        currentPattern = currentPattern.jux((p) => this.parseStrudelChain(fBody, p));
                        break;
                    }
                    case 'echo': {
                        const parts = args.split(',');
                        const n = parseInt(parts[0]);
                        const d = parseNumericExpr(parts[1]);
                        const f = parseFloat(parts[2]);
                        currentPattern = currentPattern.echo(n, d, f);
                        break;
                    }
                    case 'rsize': currentPattern = currentPattern.rsize(val); break;
                    case 'sustain': currentPattern = currentPattern.sustain(val); break;
                    case 'fmap': {
                        // Arrow-function forms are handled in the arrow logic above (which
                        // `continue`s), so this fallback only sees non-arrow args. Instead of
                        // eval()'ing arbitrary strings, interpret a numeric arg as an additive
                        // offset applied to numeric values; ignore anything else.
                        const offset = parseNumericExpr(args);
                        if (!isNaN(offset)) {
                            currentPattern = currentPattern.fmap((v) => (typeof v === 'number' ? v + offset : v));
                        } else {
                            console.warn('ProceduralMusicUtils: unsupported fmap argument, skipping:', args);
                        }
                        break;
                    }
                    case 'innerjoin': currentPattern = currentPattern.innerJoin(); break;
                    case 'late': {
                        let lateVal = val;
                        if (isNaN(lateVal)) {
                            lateVal = parseNumericExpr(args);
                            if (isNaN(lateVal)) lateVal = 0;
                        }
                        currentPattern = currentPattern.late(lateVal);
                        break;
                    }
                    default:
                        if (typeof currentPattern[func] === 'function') {
                            // If it's a known Pattern method, try to handle numeric/string params
                            const paramVal = isNaN(val) ? sVal : val;
                            currentPattern = currentPattern.setParam(func, paramVal);
                        } else {
                            const paramVal = isNaN(val) ? sVal : val;
                            currentPattern = currentPattern.setParam(func, paramVal);
                        }
                        break;
                }
            }

            return currentPattern;
        }

        parseChain(str) {
            const parts = str.split('#').map(p => p.trim());
            const main = parts[0];
            const params = parts.slice(1);
            let pattern = this.evalFunctionChain(main);
            const paramPatterns = {};
            params.forEach(p => {
                const pParts = p.split(/\s+/);
                const key = pParts[0];
                const val = pParts.slice(1).join(' ');
                if (val) paramPatterns[key] = Pattern.parseString(val.replace(/"/g, ''));
            });
            const originalQuery = pattern.query;
            pattern.query = (s, e, prng) => {
                const events = originalQuery(s, e, prng);
                return events.map(ev => {
                    const combined = { ...ev };
                    for (let k in paramPatterns) {
                        const pEvs = paramPatterns[k].query(s, e, prng);
                        const pEv = pEvs.find(p => p.time <= ev.time);
                        if (pEv) combined[k] = pEv.value;
                    }
                    return combined;
                });
            };
            return pattern;
        }

        evalFunctionChain(str) {
            const parts = str.split(/\$/).map(p => p.trim());
            let current = null;
            for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i];
                if (part.startsWith('sound')) {
                    const valMatch = part.match(/"([^"]+)"/);
                    if (valMatch) current = Pattern.parseString(valMatch[1]);
                } else if (part.startsWith('note')) {
                    const valMatch = part.match(/"([^"]+)"/);
                    if (valMatch) current = Pattern.parseString(valMatch[1]);
                } else if (part.startsWith('fast')) {
                    const m = part.match(/fast\s+"?([^"\s]+)"?/);
                    if (m && current) current = current.fast(parseFloat(m[1]));
                } else if (part.startsWith('slow')) {
                    const m = part.match(/slow\s+"?([^"\s]+)"?/);
                    if (m && current) current = current.slow(parseFloat(m[1]));
                } else if (part.startsWith('rev')) {
                    if (current) current = current.rev();
                } else if (part.startsWith('jux')) {
                    const sub = part.match(/jux\s*\(([^)]+)\)/);
                    if (sub && sub[1] === 'rev' && current) {
                        const original = current;
                        const reversed = current.rev();
                        current = new Pattern((s, e, prng) => {
                            const evs1 = original.query(s, e, prng).map(ev => ({ ...ev, pan: 0 }));
                            const evs2 = reversed.query(s, e, prng).map(ev => ({ ...ev, pan: 1 }));
                            return [...evs1, ...evs2];
                        });
                    }
                } else if (part.startsWith('slice')) {
                    const m = part.match(/slice\s+(\d+)\s*\(([^)]+)\)\s*/);
                    if (m) {
                        const n = parseInt(m[1]);
                        const patternStr = m[2].replace(/"/g, '');
                        const slicePattern = Pattern.parseString(patternStr);
                        current = new Pattern((s, e, prng) => {
                            const evs = slicePattern.query(s, e, prng);
                            return evs.map(ev => ({ ...ev, slice: parseInt(ev.value), sliceTotal: n }));
                        });
                    }
                }
            }
            return current;
        }
    }

    // --- Core Engine ---

    class StrudelEngine {
        constructor() {
            this._audioContext = null;
            this._soundfont = null;
            this._masterGain = null;
            this._initialized = false;
            this._isRunning = false;
            this.patterns = {};
            this.cps = 1.0;
            this._lookAhead = 0.25; // Reduced from 0.5 for better precision
            this._scheduleInterval = 50; // Faster update (50ms)
            this._nextScheduleTime = 0;
            this._cycleTime = 0;
            this.parser = new StrudelParser(this);
            this.prng = Math.random;
            this._mappingsLoaded = false;
            this._scheduledTimeouts = []; // Track active note timeouts

            // MIDI state
            this._midiSequence = null;
            this._midiIsPlaying = false;
            this._midiStartTime = 0;
            this._midiCurrentTick = 0;
            this._midiTempo = 500000; // Default 120 BPM (microseconds per beat)
            
            // Classic Sequencer
            this.classicSequencer = new ClassicSequencer(this);
        }

        async loadMappings(sf2Filename = "") {
            let mappingFile = 'js/db/WorldGen/sound_mappings.json';
            if (sf2Filename.toLowerCase().includes('gba')) {
                mappingFile = 'js/db/WorldGen/sound_mappings_gba.json';
            }

            try {
                const response = await fetch(mappingFile);
                if (response.ok) {
                    const json = await response.json();
                    // Merge with defaults
                    for (let key in json) {
                        InstrumentMap[key.toLowerCase()] = {
                            bank: json[key].bank,
                            program: json[key].program,
                            channel: json[key].bank === 128 || json[key].bank === 127 ? 9 : (InstrumentMap[key.toLowerCase()]?.channel || 0)
                        };
                    }
                    this._mappingsLoaded = true;
                    console.log(`StrudelEngine: Sound mappings loaded from ${mappingFile}`);
                }
            } catch (e) {
                console.error(`StrudelEngine: Failed to load ${mappingFile}`, e);
            }
        }

        async init(sf2Filename) {
            if (this._initialized || this._initializing) return;
            if (!WebAudio._context) return;
            this._initializing = true;
            this._audioContext = WebAudio._context;
            this._masterGain = this._audioContext.createGain();
            this._limiter = this._audioContext.createDynamicsCompressor();

            // Limiter settings to prevent clipping
            this._limiter.threshold.setValueAtTime(-1.0, this._audioContext.currentTime);
            this._limiter.knee.setValueAtTime(30, this._audioContext.currentTime);
            this._limiter.ratio.setValueAtTime(12, this._audioContext.currentTime);
            this._limiter.attack.setValueAtTime(0.003, this._audioContext.currentTime);
            this._limiter.release.setValueAtTime(0.25, this._audioContext.currentTime);

            this._masterGain.connect(this._limiter);
            this._limiter.connect(this._audioContext.destination);
            if (typeof SoundFont === 'undefined') {
                try {
                    const module = await import('../libs/sf2-player.js');
                    window.SoundFont = module.default || module;
                } catch (e) {
                    console.error("StrudelEngine: Failed to load sf2-player.js", e);
                }
            }
            try {
                const localPath = require('path').join(process.cwd(), 'audio', 'soundfonts', sf2Filename);
                const buffer = await require('fs').promises.readFile(localPath);
                const sf2Data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                this._soundfont = new SoundFont(this._audioContext);
                await this._soundfont.bootSynth(sf2Data);
                if (this._soundfont.gainMaster) {
                    this._soundfont.gainMaster.disconnect();
                    this._soundfont.gainMaster.connect(this._masterGain);
                }
                this._initialized = true;
                await this.loadMappings(sf2Filename);

                // We will handle scheduling ourselves in triggerEvent to ensure 
                // Bank/Program changes stay in sync with the notes.

                // Ensure MidiParser is available
                if (typeof MidiParser === 'undefined') {
                    const midiParserScript = document.createElement('script');
                    midiParserScript.src = 'js/libs/midi-parser.js';
                    document.head.appendChild(midiParserScript);
                }
            } catch (e) {
                console.error("StrudelEngine: Initialization failed", e);
            } finally {
                this._initializing = false;
            }
        }


        start() {
            if (this._isRunning) return;
            if (this._audioContext.state === 'suspended') {
                this._audioContext.resume();
            }
            this._isRunning = true;
            this._nextScheduleTime = this._audioContext.currentTime;
            this._cycleTime = 0; // Reset or sync
            
            if (window.ProceduralMusic && window.ProceduralMusic.useClassicSequencer && !this._midiIsPlaying) {
                const activeSong = window.ProceduralMusic._classicSong;
                if (activeSong) {
                    this.classicSequencer.setSong(activeSong);
                    this.classicSequencer.start(activeSong.bpm);
                }
            }
            
            this.scheduler();
        }

        async loadMidi(url) {
            try {
                console.log(`StrudelEngine: Fetching MIDI from ${url}...`);
                let response = await fetch(encodeURI(url));
                if (!response.ok && url.endsWith('.mid')) {
                    // Try .midi fallback
                    const altUrl = url.replace('.mid', '.midi');
                    console.log(`StrudelEngine: .mid not found, trying ${altUrl}...`);
                    response = await fetch(encodeURI(altUrl));
                }
                
                if (!response.ok) {
                    console.error(`StrudelEngine: MIDI file not found: ${url}`);
                    return false;
                }

                const arrayBuffer = await response.arrayBuffer();
                
                // Ensure parser is available (race condition fix)
                if (typeof MidiParser === 'undefined') {
                    console.log("StrudelEngine: Waiting for MidiParser to load...");
                    await new Promise(resolve => {
                        const check = setInterval(() => {
                            if (typeof MidiParser !== 'undefined') {
                                clearInterval(check);
                                resolve();
                            }
                        }, 50);
                        // Timeout after 2 seconds
                        setTimeout(() => { clearInterval(check); resolve(); }, 2000);
                    });
                }

                if (typeof MidiParser === 'undefined') {
                    console.error("StrudelEngine: MidiParser library not available!");
                    return false;
                }

                const parser = new MidiParser(arrayBuffer);
                this._midiSequence = parser.parse();
                console.log(`StrudelEngine: MIDI successfully parsed - ${url}`, this._midiSequence);
                return true;
            } catch (e) {
                console.error(`StrudelEngine: Failed to load/parse MIDI ${url}`, e);
                return false;
            }
        }

        startMidi() {
            if (!this._midiSequence) return;
            this._midiIsPlaying = true;
            this._midiCurrentTick = 0;
            this._midiStartTime = this._audioContext.currentTime;
            this._midiTempo = 500000;
            // Reset track pointers for the new sequence
            this._midiTrackPointers = new Array(this._midiSequence.tracks.length).fill(0);
            if (!this._isRunning) this.start();
            console.log("StrudelEngine: MIDI Playback started.");
        }

        stopMidi() {
            this._midiIsPlaying = false;
            this.stopAllNotes();
        }

        stop() {
            this._isRunning = false;
            this._midiIsPlaying = false;
            this.classicSequencer.stop();
            this.stopAllNotes();
        }

        stopAllNotes() {
            // Clear all pending timeouts
            this._scheduledTimeouts.forEach(tid => clearTimeout(tid));
            this._scheduledTimeouts = [];

            if (this._soundfont && this._soundfont.synth) {
                for (let i = 0; i < 16; i++) {
                    this._soundfont.synth.allSoundOff(i);
                    this._soundfont.synth.hold(i, 0); // Force release sustain pedal
                    if (this._soundfont.synth.controlChange) {
                        this._soundfont.synth.controlChange(i, 91, 0); // Reverb Off
                        this._soundfont.synth.controlChange(i, 93, 0); // Chorus Off
                    }
                }
            }
        }

        scheduler() {
            if (!this._isRunning) return;
 
            if (window.ProceduralMusic && window.ProceduralMusic.useClassicSequencer && !this._midiIsPlaying) {
                this.classicSequencer.update();
            } else if (!this._midiIsPlaying) {
                // Catch up logic: if we are too far behind, reset nextScheduleTime
                if (this._nextScheduleTime < this._audioContext.currentTime - 1.0) {
                    this._nextScheduleTime = this._audioContext.currentTime;
                }
 
                const windowSize = 0.1;
                while (this._nextScheduleTime < this._audioContext.currentTime + this._lookAhead) {
                    const s = this._cycleTime;
                    const e = this._cycleTime + windowSize;

                    let pIdx = 0;
                    for (let name in this.patterns) {
                        const pattern = this.patterns[name];
                        const events = pattern.query(s, e, this.prng);
                        const currentPIdx = pIdx++;
                        events.forEach(ev => {
                            const eventTime = this._nextScheduleTime + ((ev.time - s) / this.cps);
                            this.triggerEvent(ev, eventTime, currentPIdx);
                        });
                    }
                    this._nextScheduleTime += windowSize / this.cps;
                    this._cycleTime += windowSize;
                }
            }

            // --- MIDI Scheduler Integration ---
            if (this._midiIsPlaying && this._midiSequence) {
                this.scheduleMidiEvents();
            }

            if (this._isRunning) {
                setTimeout(() => this.scheduler(), this._scheduleInterval);
            }
        }

        scheduleMidiEvents() {
            const lookAheadTime = 0.5; // Match _lookAhead
            const now = this._audioContext.currentTime;
            const ticksPerBeat = this._midiSequence.ticksPerBeat;

            this._midiSequence.tracks.forEach((track, trackIdx) => {
                // We need to find events within the next lookahead window
                // This is a bit complex for a real-time scheduler without sorting or cursors
                // For now, we'll use a per-track event pointer in the engine state
                if (!this._midiTrackPointers) this._midiTrackPointers = new Array(this._midiSequence.tracks.length).fill(0);

                let ptr = this._midiTrackPointers[trackIdx];
                while (ptr < track.length) {
                    const ev = track[ptr];

                    // Convert tick to absolute time in seconds
                    // simplified: time = (ticks / ticksPerBeat) * (tempo / 1000000)
                    const eventTimeFromStart = (ev.ticks / ticksPerBeat) * (this._midiTempo / 1000000);
                    const absoluteEventTime = this._midiStartTime + eventTimeFromStart;

                    if (absoluteEventTime > now + lookAheadTime) break; // Future event

                    // Process all events up to now + lookAheadTime. Delayed/early/tick-0 setup events 
                    // will have absoluteEventTime < now, which calculates delayMs = 0 to execute instantly.
                    this.processMidiEvent(ev, absoluteEventTime);

                    ptr++;
                    this._midiTrackPointers[trackIdx] = ptr;
                }
            });

            // End of MIDI detection
            const allFinished = this._midiTrackPointers.every((ptr, idx) => ptr >= this._midiSequence.tracks[idx].length);
            if (allFinished) {
                console.log("StrudelEngine: MIDI Playback finished.");
                this._midiIsPlaying = false;
                this._midiTrackPointers = null;
            }
        }

        processMidiEvent(ev, time) {
            const now = this._audioContext.currentTime;
            const delayMs = Math.max(0, (time - now) * 1000);

            const tid = setTimeout(() => {
                if (!this._midiIsPlaying) return;
                if (!this._soundfont || !this._soundfont.synth) return;

                if (ev.type === 'meta' && ev.metaType === 0x51) {
                    const d = ev.data;
                    this._midiTempo = (d[0] << 16) | (d[1] << 8) | d[2];
                } else if (ev.type === 'noteOn') {
                    const channel = ev.channel;
                    const key = ev.param1;
                    const velocity = ev.param2;
                    
                    let voice = this._soundfont.synth.noteOn(channel, key, velocity);

                    // Fallback to piano if instrument/note not found
                    if (!voice && (channel !== 9)) {
                        this._soundfont.synth.bankChange(channel, 0);
                        this._soundfont.synth.programChange(channel, 0);
                        voice = this._soundfont.synth.noteOn(channel, key, velocity);
                    }
                } else if (ev.type === 'noteOff') {
                    this._soundfont.synth.noteOff(ev.channel, ev.param1);
                } else if (ev.type === 'programChange') {
                    this._soundfont.synth.programChange(ev.channel, ev.param1);
                } else if (ev.type === 'cc') {
                    if (ev.param1 === 0 || ev.param1 === 32) { // Bank Select MSB / LSB
                        this._soundfont.synth.bankChange(ev.channel, ev.param2);
                    } else if (this._soundfont.synth.controlChange) {
                        this._soundfont.synth.controlChange(ev.channel, ev.param1, ev.param2);
                    }
                } else if (ev.type === 'pitchBend') {
                    if (this._soundfont.synth.pitchBend) {
                        this._soundfont.synth.pitchBend(ev.channel, ev.param1, ev.param2);
                    }
                }
                this._scheduledTimeouts = this._scheduledTimeouts.filter(t => t !== tid);
            }, delayMs);

            this._scheduledTimeouts.push(tid);
        }

        triggerEvent(ev, time, patternIndex = 0) {
            if (!this._soundfont || !this._soundfont.synth) return;

            const soundName = ev.s || (typeof ev.value === 'string' ? ev.value : null);
            const inst = getInstrument(soundName);

            // Improved Channel Allocation: 
            // Try to use inst.channel if unique, otherwise use patternIndex
            let channel = inst.channel;
            if (channel !== 9) {
                const availableChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
                // We use patternIndex as base but allow sub-channels for stacked instruments if tagged (TODO)
                channel = availableChannels[patternIndex % availableChannels.length];
            }

            // Humanize micro-timing: natural humans have minor latency/rush jitter
            const isDrum = channel === 9;
            const timeJitterMs = isDrum ? (Math.random() * 5 - 2) : (Math.random() * 11 - 4);

            const startAt = Math.max(this._audioContext.currentTime, time);
            const delayMs = (startAt - this._audioContext.currentTime) * 1000 + timeJitterMs;

            // Consolidate all scheduling into one timeout to ensure Bank/Program changes 
            // don't execute before the previous note on the same channel has finished.
            const tid = setTimeout(() => {
                if (!this._isRunning || this._midiIsPlaying) return; 
                if (!this._soundfont || !this._soundfont.synth) return;

                // 1. Update Instrument Settings for this channel
                const bank = ev.bank !== undefined ? parseInt(ev.bank) : inst.bank;
                const program = ev.program !== undefined ? parseInt(ev.program) : inst.program;
                this._soundfont.synth.bankChange(channel, bank);
                this._soundfont.synth.programChange(channel, program);

                // 2. Control Changes (Pan, Filter, Reverb)
                if (this._soundfont.synth.controlChange) {
                    const pan = parseFloat(ev.pan || 0.5);
                    this._soundfont.synth.controlChange(channel, 10, Math.floor(pan * 127));

                    if (ev.lpf) {
                        const cutoff = Math.min(127, Math.floor((parseFloat(ev.lpf) / 10000) * 127));
                        this._soundfont.synth.controlChange(channel, 74, cutoff);
                    }
                    if (ev.room) {
                        const reverb = Math.min(127, Math.floor(parseFloat(ev.room) * 127));
                        this._soundfont.synth.controlChange(channel, 91, reverb);
                    }
                    if (ev.rsize) {
                        const reverbTime = Math.min(127, Math.floor(parseFloat(ev.rsize) / 8 * 127));
                        this._soundfont.synth.controlChange(channel, 93, reverbTime);
                    }
                    if (ev.clip) {
                        const clipVal = Math.min(127, Math.floor(parseFloat(ev.clip) * 127));
                        this._soundfont.synth.controlChange(channel, 71, clipVal);
                    }
                }

                // 3. Play Notes
                const fadeVolume = window.ProceduralMusic ? window.ProceduralMusic._fadeVolume : 1.0;
                const configVolume = (typeof AudioManager !== 'undefined' ? AudioManager.bgmVolume : 100) / 100;
                const gain = parseFloat(ev.gain || ev.velocity || 0.6);
                const velocity = Math.min(127, Math.max(0, Math.floor(gain * 127 * fadeVolume * configVolume)));

                // Expand chords or single note
                let notes = ev.notes;
                if (!notes) {
                    const noteVal = ev.note || (typeof ev.value === 'string' ? ev.value : null);
                    let note = parseNote(noteVal, ev.scale);
                    if (!ev.note && !ev.value && ev.slice !== undefined) note = 48 + ev.slice;

                    if (typeof ev.value === 'string' && ev.value.match(/^[a-g]#?[a-z0-9]*$/i)) {
                        const match = ev.value.match(/^([a-g]#?)(.*)$/i);
                        if (match) {
                            const root = match[1];
                            const type = (match[2] || 'maj').toLowerCase();
                            if (ChordMap[type]) {
                                const rootNote = parseNote(root + "4");
                                notes = ChordMap[type].map(i => rootNote + i);
                            }
                        }
                    }
                    if (!notes) notes = [note];
                }

                if (ev.mode === 'root' && notes && notes.length > 0) notes = [notes[0]];

                const sustain = parseFloat(ev.sustain || 1.0);
                // Cap duration at 30 seconds to prevent hanging drones on low CPS
                const duration = Math.min(30, (ev.duration || 0.25) * (1 / this.cps) * sustain);

                // Sort notes so lowest pitch plays first (extremely natural strum/roll arpeggiation)
                const sortedNotes = [...notes].sort((a, b) => a - b);

                sortedNotes.forEach((n, idx) => {
                    // Strumming delay: lowest notes first, stagger by a few milliseconds
                    const strumDelay = (sortedNotes.length > 1 && channel !== 9) ? idx * (4 + Math.random() * 8) : 0;
                    
                    const playNoteFn = () => {
                        if (!this._soundfont || !this._soundfont.synth) return;
                        
                        // Velocity humanization (dynamic human playing touches)
                        let humanizedVelocity = velocity;
                        if (channel === 9) {
                            // Subtle drum velocity jitter (±4%)
                            humanizedVelocity = Math.floor(velocity * (0.96 + Math.random() * 0.08));
                        } else {
                            // Dynamic synth/instrument velocity jitter (±7%)
                            humanizedVelocity = Math.floor(velocity * (0.93 + Math.random() * 0.14));
                        }
                        humanizedVelocity = Math.min(127, Math.max(1, humanizedVelocity));

                        let voice = this._soundfont.synth.noteOn(channel, n, humanizedVelocity);
                        
                        // Fallback to piano if instrument/note not found (usually bank 128 issues)
                        if (!voice && channel !== 9) {
                            this._soundfont.synth.bankChange(channel, 0);
                            this._soundfont.synth.programChange(channel, 0);
                            voice = this._soundfont.synth.noteOn(channel, n, humanizedVelocity);
                        }

                        // Schedule noteOff relative to this specific noteOn time
                        const offTid = setTimeout(() => {
                            if (this._soundfont && this._soundfont.synth) {
                                this._soundfont.synth.noteOff(channel, n);
                            }
                            this._scheduledTimeouts = this._scheduledTimeouts.filter(t => t !== offTid);
                        }, duration * 1000 * 0.98);
                        this._scheduledTimeouts.push(offTid);
                    };

                    if (strumDelay > 0) {
                        const noteTid = setTimeout(playNoteFn, strumDelay);
                        this._scheduledTimeouts.push(noteTid);
                    } else {
                        playNoteFn();
                    }
                });

                this._scheduledTimeouts = this._scheduledTimeouts.filter(t => t !== tid);
            }, Math.max(0, delayMs));

            this._scheduledTimeouts.push(tid);
        }
    }

    class ClassicSequencer {
        constructor(engine) {
            this.engine = engine;
            this.bpm = 120;
            this.currentStep = 0;
            this.nextStepTime = 0;
            this.isPlaying = false;
            this.tracks = []; // Array of { channel, bank, program, notes: [], pan, reverb }
            this.stepDuration = 60 / 120 / 4; // default step duration (16th notes)
            this._scheduledTimeouts = [];
        }

        start(bpm = 120) {
            this.bpm = bpm;
            this.stepDuration = 60 / this.bpm / 4;
            this.currentStep = 0;
            this.nextStepTime = this.engine._audioContext.currentTime;
            this.isPlaying = true;
        }

        stop() {
            this.isPlaying = false;
            this._scheduledTimeouts.forEach(tid => clearTimeout(tid));
            this._scheduledTimeouts = [];
        }

        setSong(songData) {
            this.bpm = songData.bpm || 120;
            this.stepDuration = 60 / this.bpm / 4;
            this.tracks = songData.tracks || [];
        }

        update() {
            if (!this.isPlaying) return;
            const lookAhead = 0.25;
            const now = this.engine._audioContext.currentTime;
            
            // Catch up logic
            if (this.nextStepTime < now - 1.0) {
                this.nextStepTime = now;
            }

            while (this.nextStepTime < now + lookAhead) {
                this.scheduleStep(this.currentStep, this.nextStepTime);
                this.currentStep++;
                this.nextStepTime += this.stepDuration;
            }
        }

        scheduleStep(step, time) {
            this.tracks.forEach((track) => {
                if (!track.notes || track.notes.length === 0) return;
                const notesAtStep = track.notes[step % track.notes.length];
                if (!notesAtStep || notesAtStep === '~') return;

                const noteDataList = Array.isArray(notesAtStep) ? notesAtStep : [notesAtStep];

                // Sort noteDataList so lowest notes are first (natural for chord roll/strum)
                const getMidiValue = (d) => {
                    if (typeof d === 'object' && d !== null) return d.note || 60;
                    if (typeof d === 'number') return d;
                    return 60;
                };
                const sortedNoteDataList = [...noteDataList].sort((a, b) => getMidiValue(a) - getMidiValue(b));

                sortedNoteDataList.forEach((noteData, idx) => {
                    if (noteData === '~' || !noteData) return;

                    let midiNote, velocity = 80, durationSteps = 1;
                    if (typeof noteData === 'object') {
                        midiNote = noteData.note;
                        velocity = noteData.velocity !== undefined ? noteData.velocity : 80;
                        durationSteps = noteData.duration !== undefined ? noteData.duration : 1;
                    } else if (typeof noteData === 'number') {
                        midiNote = noteData;
                    } else {
                        return;
                    }

                    const noteOnTime = time;
                    const durationSec = durationSteps * this.stepDuration * 0.95;

                    // Humanize micro-timing: natural humans have minor latency/rush jitter
                    const isDrum = track.channel === 9;
                    const timeJitterMs = isDrum ? (Math.random() * 5 - 2) : (Math.random() * 12 - 5);
                    const strumDelay = (sortedNoteDataList.length > 1 && !isDrum) ? idx * (4 + Math.random() * 7) : 0;

                    const delayMs = Math.max(0, (noteOnTime - this.engine._audioContext.currentTime) * 1000 + timeJitterMs + strumDelay);

                    const tid = setTimeout(() => {
                        if (!this.isPlaying || !this.engine._soundfont || !this.engine._soundfont.synth) return;

                        const synth = this.engine._soundfont.synth;
                        const channel = track.channel;

                        synth.bankChange(channel, track.bank || 0);
                        synth.programChange(channel, track.program || 0);

                        if (synth.controlChange) {
                            if (track.pan !== undefined) {
                                synth.controlChange(channel, 10, Math.floor(track.pan * 127));
                            }
                            if (track.reverb !== undefined) {
                                synth.controlChange(channel, 91, Math.floor(track.reverb * 127));
                            }
                        }

                        const fadeVolume = window.ProceduralMusic ? window.ProceduralMusic._fadeVolume : 1.0;
                        const configVolume = (typeof AudioManager !== 'undefined' ? AudioManager.bgmVolume : 100) / 100;
                        
                        // Velocity humanization (dynamic human playing touches)
                        let humanizedVelocity = velocity;
                        if (channel === 9) {
                            // Drum velocity jitter (±5%)
                            humanizedVelocity = Math.floor(velocity * (0.95 + Math.random() * 0.1));
                        } else {
                            // Synthesizer/instrument velocity jitter (±8%)
                            humanizedVelocity = Math.floor(velocity * (0.92 + Math.random() * 0.16));
                        }
                        const finalVelocity = Math.min(127, Math.max(1, Math.floor(humanizedVelocity * fadeVolume * configVolume)));

                        synth.noteOn(channel, midiNote, finalVelocity);

                        const offTid = setTimeout(() => {
                            if (this.engine._soundfont && this.engine._soundfont.synth) {
                                this.engine._soundfont.synth.noteOff(channel, midiNote);
                            }
                            this._scheduledTimeouts = this._scheduledTimeouts.filter(t => t !== offTid);
                        }, durationSec * 1000);

                        this._scheduledTimeouts.push(offTid);
                        this._scheduledTimeouts = this._scheduledTimeouts.filter(t => t !== tid);
                    }, delayMs);

                    this._scheduledTimeouts.push(tid);
                });
            });
        }
    }

    return { Pattern, StrudelParser, StrudelEngine, ClassicSequencer, cyrb128, sfc32, getInstrument, parseNote };
})();
