//=============================================================================
// 3D Battler System - Beasts Family
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Distinct procedural 3D models for the many "beast" enemies:
 * bear, wolf/canine, big cat, boar, rodent, horned ungulate, ape. Splits the
 * generic four-legged beast rig into recognisable body plans. Requires
 * 3DBattlerSystem + loads AFTER 3DBattler_Quadruped to override its shared
 * `beast` aliases (bear/wolf/cat/boar/rat/bull/ape/... keywords).
 * @author Omni-Lex
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help
 * ============================================================================
 * 3D Battler - Beasts Family
 * ============================================================================
 *
 * Seven hand-shaped animal body plans that take over the keyword tokens that
 * previously all mapped to the single generic `beast` quadruped, so a wolf, a
 * bear, a tiger, a boar, a rat, a stag and an ape no longer share one silhouette.
 *
 *   bear     - bulky ursine, short thick legs, rounded ears (bears, ursids, yeti)
 *   wolf     - lean canine, long snout, hackles, bushy tail (wolves, coyote, fox,
 *              hyena, jackal)
 *   bigcat   - sleek crouched feline, long curling tail (cat, panther, tiger,
 *              lion, lynx, sabertooth, ...)
 *   boar     - low front-heavy suid, shoulder hump, tusks, bristles (boar, pig,
 *              hog, razorback)
 *   rodent   - small upright critter, big incisors, round ears, long tail (rat,
 *              mouse, squirrel, raccoon, mole, beaver, lemming)
 *   ungulate - tall slim-legged grazer with horns or antlers, hooves (stag, deer,
 *              bull, cow, goat, sheep, rhino, camel, bison)
 *   ape      - upright primate, long knuckling arms (ape, monkey, gorilla)
 *
 * Anything not matched by these keywords (badger, skunk, opossum, kangaroo, ...)
 * still falls back to the generic Quadruped `beast` rig.
 *
 * Each reuses the shared base: per-event id colour/shape/texture variation,
 * part-losing dismemberment, hit-flash, and the base action gestures.
 *
 * MUST load AFTER BattleSystem/3DBattlerSystem AND 3DBattler_Quadruped.
 */

(() => {
    'use strict';

    if (typeof THREE === 'undefined') return;
    if (!window.Battler3D || !window.Battler3D.Base) {
        console.error('[3D Battler Beasts] Core (3DBattlerSystem) not loaded first.');
        return;
    }

    const Base = window.Battler3D.Base;
    const debugLog = window.Battler3D.debugLog || function () {};

    // variant + which models face the camera (front) vs the angled 3/4 view,
    // plus per-id HSL colour ranges and a themed texture pool.
    const B_PROFILES = {
        bear:     { variant: 'bear',     front: false, scale: 2.9, texturePool: 'fur',   bodyColor: 0x6b4a2e, accent: 0x2a1810, hue: [0.07, 0.04], sat: [0.45, 0.15], lit: [0.30, 0.10] },
        wolf:     { variant: 'wolf',     front: false, scale: 2.5, texturePool: 'fur',   bodyColor: 0x7c7d82, accent: 0xffcc44, hue: [0.62, 0.10], sat: [0.10, 0.10], lit: [0.42, 0.14] },
        bigcat:   { variant: 'bigcat',   front: false, scale: 2.5, texturePool: 'fur',   bodyColor: 0xc8a24a, accent: 0x9be000, hue: [0.10, 0.05], sat: [0.50, 0.15], lit: [0.48, 0.10] },
        boar:     { variant: 'boar',     front: false, scale: 2.5, texturePool: 'fur',   bodyColor: 0x4a3b30, accent: 0x140d0a, hue: [0.07, 0.04], sat: [0.35, 0.12], lit: [0.26, 0.08] },
        rodent:   { variant: 'rodent',   front: false, scale: 1.9, texturePool: 'fur',   bodyColor: 0x8a7256, accent: 0x1a1410, hue: [0.08, 0.06], sat: [0.28, 0.14], lit: [0.40, 0.14] },
        // ── Rodent one-offs: each former generic `rodent` name gets a bespoke body ──
        armoredbeaver:       { variant: 'armoredbeaver',       front: false, scale: 2.2,  texturePool: 'fur', bodyColor: 0x6b5640, accent: 0xc4c9d2, hue: [0.08, 0.04], sat: [0.30, 0.10], lit: [0.36, 0.10] },
        wastelandbeaver:     { variant: 'wastelandbeaver',     front: false, scale: 2.1,  texturePool: 'fur', bodyColor: 0x5a4d3a, accent: 0x8a8270, hue: [0.09, 0.05], sat: [0.22, 0.10], lit: [0.34, 0.10] },
        armoredporcupine:    { variant: 'armoredporcupine',    front: false, scale: 2.2,  texturePool: 'fur', bodyColor: 0x3a3530, accent: 0xbfc6cc, hue: [0.08, 0.04], sat: [0.10, 0.08], lit: [0.26, 0.08] },
        spikeyporcupine:     { variant: 'spikeyporcupine',     front: false, scale: 2.0,  texturePool: 'fur', bodyColor: 0x5a4632, accent: 0x241a12, hue: [0.08, 0.05], sat: [0.32, 0.12], lit: [0.32, 0.10] },
        caffeinatedsquirrel: { variant: 'caffeinatedsquirrel', front: false, scale: 1.9,  texturePool: 'fur', bodyColor: 0x8a5a32, accent: 0x3a2410, hue: [0.07, 0.04], sat: [0.45, 0.12], lit: [0.40, 0.10] },
        woodsquirrel:        { variant: 'woodsquirrel',        front: false, scale: 1.85, texturePool: 'fur', bodyColor: 0x9a6336, accent: 0x3a2410, hue: [0.07, 0.04], sat: [0.45, 0.12], lit: [0.42, 0.10] },
        fieldmouse:          { variant: 'fieldmouse',          front: false, scale: 1.6,  texturePool: 'fur', bodyColor: 0x9a8868, accent: 0xffb0a0, hue: [0.09, 0.05], sat: [0.24, 0.10], lit: [0.50, 0.12] },
        forestrat:           { variant: 'forestrat',           front: false, scale: 1.85, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.09, 0.05], sat: [0.32, 0.12], lit: [0.36, 0.10] },
        giantrat:            { variant: 'giantrat',            front: false, scale: 2.2,  texturePool: 'fur', bodyColor: 0x7a6a52, accent: 0x1a1410, hue: [0.08, 0.05], sat: [0.28, 0.12], lit: [0.40, 0.12] },
        sewerrat:            { variant: 'sewerrat',            front: false, scale: 1.9,  texturePool: 'fur', bodyColor: 0x55503e, accent: 0x2a2a1a, hue: [0.12, 0.06], sat: [0.20, 0.10], lit: [0.32, 0.10] },
        swamprat:            { variant: 'swamprat',            front: false, scale: 2.05, texturePool: 'fur', bodyColor: 0x4e5538, accent: 0x88aa44, hue: [0.22, 0.08], sat: [0.30, 0.12], lit: [0.32, 0.10] },
        plaguerattus:        { variant: 'plaguerattus',        front: false, scale: 2.6,  texturePool: 'fur', bodyColor: 0x6a6248, accent: 0x9bd34a, hue: [0.18, 0.08], sat: [0.30, 0.12], lit: [0.38, 0.10] },
        ratking:             { variant: 'ratking',             front: false, scale: 2.7,  texturePool: 'fur', bodyColor: 0x5a4e3a, accent: 0xb8932e, hue: [0.09, 0.05], sat: [0.30, 0.12], lit: [0.34, 0.10] },
        frostraccoon:        { variant: 'frostraccoon',        front: false, scale: 2.0,  texturePool: 'fur', bodyColor: 0x9aa6b4, accent: 0xaaf0ff, hue: [0.56, 0.08], sat: [0.16, 0.10], lit: [0.56, 0.10] },
        nightraccoon:        { variant: 'nightraccoon',        front: false, scale: 2.0,  texturePool: 'fur', bodyColor: 0x4a4a52, accent: 0xf0f0f0, hue: [0.62, 0.06], sat: [0.10, 0.08], lit: [0.34, 0.10] },
        molerodent:          { variant: 'molerodent',          front: false, scale: 1.8,  texturePool: 'fur', bodyColor: 0x3a3330, accent: 0xff9a9a, hue: [0.06, 0.04], sat: [0.12, 0.08], lit: [0.24, 0.08] },
        tunnelingmole:       { variant: 'tunnelingmole',       front: false, scale: 2.3,  texturePool: 'fur', bodyColor: 0x423a32, accent: 0xffaa99, hue: [0.07, 0.04], sat: [0.16, 0.08], lit: [0.26, 0.08] },
        icelemming:          { variant: 'icelemming',          front: false, scale: 1.7,  texturePool: 'fur', bodyColor: 0xcfe0ec, accent: 0x66ccff, hue: [0.56, 0.06], sat: [0.20, 0.10], lit: [0.72, 0.10] },
        ungulate: { variant: 'ungulate', front: false, scale: 2.9, texturePool: 'fur',   bodyColor: 0x8a6b45, accent: 0x141414, hue: [0.08, 0.05], sat: [0.40, 0.15], lit: [0.36, 0.12] },
        ape:      { variant: 'ape',      front: true,  scale: 2.7, texturePool: 'fur',   bodyColor: 0x36302c, accent: 0xb89878, hue: [0.07, 0.05], sat: [0.18, 0.10], lit: [0.24, 0.10] },
        chromaticmanticore: { variant: 'chromaticmanticore', front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0x9a3b2e, accent: 0xff4488, hue: [0.95, 0.30], sat: [0.70, 0.20], lit: [0.50, 0.10] },
        chupacabra:  { variant: 'chupacabra',  front: false, scale: 2.3, texturePool: 'fur', bodyColor: 0x4a4640, accent: 0x88ff44, hue: [0.30, 0.10], sat: [0.20, 0.12], lit: [0.28, 0.08] },
        giantsnail:  { variant: 'giantsnail',  front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0x7a8a5a, accent: 0xaad36a, hue: [0.25, 0.08], sat: [0.35, 0.12], lit: [0.42, 0.10] },
        infernalcerberus: { variant: 'infernalcerberus', front: false, scale: 2.7, texturePool: 'fur', bodyColor: 0x201a18, accent: 0xff5510, hue: [0.04, 0.03], sat: [0.55, 0.15], lit: [0.18, 0.06] },
        junglepredator: { variant: 'junglepredator', front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x2f5a2a, accent: 0xff44aa, hue: [0.32, 0.08], sat: [0.55, 0.15], lit: [0.34, 0.10] },
        mianni:      { variant: 'mianni',      front: true,  scale: 2.4, texturePool: 'fur', bodyColor: 0xff5599, accent: 0x44ddff, hue: [0.0, 1.0], sat: [0.85, 0.10], lit: [0.55, 0.10] },
        palettephantom:  { variant: 'palettephantom',  front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0x8855cc, accent: 0xff66dd, hue: [0.0, 1.0], sat: [0.70, 0.15], lit: [0.55, 0.10] },
        radiantunicorn:  { variant: 'radiantunicorn',  front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0xf2eee0, accent: 0xffe680, hue: [0.13, 0.05], sat: [0.30, 0.10], lit: [0.78, 0.08] },
        rhinobeetle:     { variant: 'rhinobeetle',     front: false, scale: 2.3, texturePool: 'fur', bodyColor: 0x2a2018, accent: 0x6a4a28, hue: [0.08, 0.03], sat: [0.40, 0.12], lit: [0.16, 0.06] },
        rummagingopossum:{ variant: 'rummagingopossum',front: false, scale: 2.0, texturePool: 'fur', bodyColor: 0x9a958c, accent: 0xffc0b0, hue: [0.08, 0.04], sat: [0.12, 0.08], lit: [0.55, 0.12] },
        beast666:        { variant: 'beast666',        front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0x6a0e0e, accent: 0xff6600, hue: [0.0, 0.04], sat: [0.65, 0.15], lit: [0.28, 0.08] },
        tempestpegasus:  { variant: 'tempestpegasus',  front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0xb8c4d0, accent: 0x66ccff, hue: [0.58, 0.08], sat: [0.18, 0.10], lit: [0.70, 0.10] },
        velocicorn:      { variant: 'velocicorn',      front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x3a4a6a, accent: 0xffee44, hue: [0.62, 0.06], sat: [0.40, 0.12], lit: [0.34, 0.10] },
        swampleviathan:  { variant: 'swampleviathan',  front: false, scale: 3.4, texturePool: 'fur', bodyColor: 0x3a4a30, accent: 0x6a8a3a, hue: [0.28, 0.06], sat: [0.40, 0.12], lit: [0.24, 0.08] },
        invertedhunger:  { variant: 'invertedhunger',  front: true,  scale: 2.6, texturePool: 'fur', bodyColor: 0x8a2a3a, accent: 0xff5566, hue: [0.97, 0.04], sat: [0.55, 0.15], lit: [0.34, 0.10] },
        voidhowler:      { variant: 'voidhowler',      front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0x16121f, accent: 0x9944ff, hue: [0.74, 0.08], sat: [0.55, 0.15], lit: [0.12, 0.06] },
        feastoffamine:   { variant: 'feastoffamine',   front: true,  scale: 3.0, texturePool: 'fur', bodyColor: 0x6a3a28, accent: 0xff8866, hue: [0.06, 0.04], sat: [0.35, 0.12], lit: [0.30, 0.10] },
        maternityward:   { variant: 'maternityward',   front: true,  scale: 2.8, texturePool: 'fur', bodyColor: 0xc89a8a, accent: 0xff99aa, hue: [0.02, 0.04], sat: [0.30, 0.10], lit: [0.55, 0.10] },
        starvingsabercat:{ variant: 'starvingsabercat',front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x9a8a5a, accent: 0xffd24a, hue: [0.11, 0.05], sat: [0.35, 0.12], lit: [0.40, 0.10] },
        ashenprowler:    { variant: 'ashenprowler',    front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x6a6a66, accent: 0xff5544, hue: [0.0, 0.05], sat: [0.06, 0.06], lit: [0.40, 0.12] },
        gauntsnapper:    { variant: 'gauntsnapper',    front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x4a463e, accent: 0x88ff66, hue: [0.10, 0.06], sat: [0.18, 0.10], lit: [0.26, 0.08] },
        holloweyedboar:  { variant: 'holloweyedboar',  front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x3a2e26, accent: 0x66ff88, hue: [0.07, 0.04], sat: [0.30, 0.12], lit: [0.22, 0.08] },
        ferallynx:       { variant: 'ferallynx',       front: false, scale: 2.3, texturePool: 'fur', bodyColor: 0xb09060, accent: 0xff4444, hue: [0.09, 0.05], sat: [0.32, 0.12], lit: [0.46, 0.10] },
        diregnasher:     { variant: 'diregnasher',     front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x5a4a3e, accent: 0xffcc44, hue: [0.08, 0.05], sat: [0.20, 0.10], lit: [0.32, 0.10] },
        gauntclawrunner: { variant: 'gauntclawrunner', front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x46566e, accent: 0x88ccff, hue: [0.60, 0.06], sat: [0.30, 0.12], lit: [0.34, 0.10] },
        bloodmawdirewolf:{ variant: 'bloodmawdirewolf',front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0x6a6258, accent: 0xcc1818, hue: [0.07, 0.05], sat: [0.14, 0.10], lit: [0.36, 0.12] },
        gauntlynx:       { variant: 'gauntlynx',       front: false, scale: 2.3, texturePool: 'fur', bodyColor: 0xa89058, accent: 0xffd24a, hue: [0.10, 0.05], sat: [0.30, 0.12], lit: [0.42, 0.10] },
        feralbadger:     { variant: 'feralbadger',     front: false, scale: 2.2, texturePool: 'fur', bodyColor: 0x4a463e, accent: 0xf0ece0, hue: [0.10, 0.04], sat: [0.14, 0.08], lit: [0.28, 0.08] },
        starvinggnasher: { variant: 'starvinggnasher', front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x5a4e40, accent: 0xffaa44, hue: [0.08, 0.05], sat: [0.22, 0.10], lit: [0.30, 0.10] },
        feralridgeback:  { variant: 'feralridgeback',  front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x4e423a, accent: 0xff6644, hue: [0.07, 0.04], sat: [0.24, 0.10], lit: [0.30, 0.10] },
        bf_packboar: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_packripper: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_stormgnasher: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x46566e, accent: 0x88ccff, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_lonejackal: { variant: 'wolf', scale: 2.4, texturePool: 'fur', bodyColor: 0x6a6660, accent: 0xffcc44, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_rabidlynx: { variant: 'bigcat', scale: 2.3, texturePool: 'fur', bodyColor: 0x7a6a52, accent: 0xff4444, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_threetailedlynx: { variant: 'bigcat', scale: 2.3, texturePool: 'fur', bodyColor: 0x6a5a4a, accent: 0xff8844, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_rabidbadger: { variant: 'boar', scale: 2.2, texturePool: 'fur', bodyColor: 0x7a6a52, accent: 0xff4444, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mangyridgeback: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a44, accent: 0x8a6a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mudcakedgnasher: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x4a4636, accent: 0x6a7a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mudcakedprowler: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x4a4636, accent: 0x6a7a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_threetailedhornbeast: { variant: 'boar', scale: 2.6, texturePool: 'fur', bodyColor: 0x6a5a4a, accent: 0xff8844, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_feralprowler: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a44, accent: 0xffcc44, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_frosthornbeast: { variant: 'boar', scale: 2.6, texturePool: 'fur', bodyColor: 0x9ac0d8, accent: 0xaaf0ff, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_ironfangeddirewolf: { variant: 'wolf', scale: 2.7, texturePool: 'fur', bodyColor: 0x4a423a, accent: 0xffcc44, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mangyhowler: { variant: 'wolf', scale: 2.6, texturePool: 'fur', bodyColor: 0x6a5a44, accent: 0x8a6a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_ashendirewolf: { variant: 'wolf', scale: 2.7, texturePool: 'fur', bodyColor: 0x4a423a, accent: 0xffcc44, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_ironfangedmawhound: { variant: 'wolf', scale: 2.6, texturePool: 'fur', bodyColor: 0x6a6e74, accent: 0xff4422, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_packridgeback: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_cinderthornhide: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x3a3330, accent: 0xff6633, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_packclawrunner: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_packhornbeast: { variant: 'boar', scale: 2.6, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_gauntripper: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x8a8270, accent: 0xffcc44, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_bloodmawmawhound: { variant: 'wolf', scale: 2.6, texturePool: 'fur', bodyColor: 0x5a4a42, accent: 0xcc1818, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_threetailedboar: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a4a, accent: 0xff8844, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mudcakedripper: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x4a4636, accent: 0x6a7a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_cinderdirewolf: { variant: 'wolf', scale: 2.7, texturePool: 'fur', bodyColor: 0x3a3330, accent: 0xff6633, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_direclawrunner: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x4a423a, accent: 0xffcc44, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_packjackal: { variant: 'wolf', scale: 2.4, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_stormhowler: { variant: 'wolf', scale: 2.6, texturePool: 'fur', bodyColor: 0x46566e, accent: 0x88ccff, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_starvingclawrunner: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x9a8a5a, accent: 0xffd24a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_scarredclawrunner: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a6258, accent: 0xff6644, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mangystalkhound: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a5a44, accent: 0x8a6a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_mudcakedclawrunner: { variant: 'wolf', scale: 2.5, texturePool: 'fur', bodyColor: 0x4a4636, accent: 0x6a7a3a, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_scarredbristleback: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x6a6258, accent: 0xff6644, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_packlynx: { variant: 'bigcat', scale: 2.3, texturePool: 'fur', bodyColor: 0x6a5a3e, accent: 0x2a1f14, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_holloweyedsnapper: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x5a5248, accent: 0x66ff88, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_ironfangedhornbeast: { variant: 'boar', scale: 2.6, texturePool: 'fur', bodyColor: 0x6a6e74, accent: 0xff4422, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        bf_holloweyedbristleback: { variant: 'boar', scale: 2.5, texturePool: 'fur', bodyColor: 0x5a5248, accent: 0x66ff88, hue: [0.08,0.05], sat: [0.3,0.12], lit: [0.4,0.12] },
        // ── Bespoke split: wolf group (canids) ──────────────────────────────
        bst_arcticfox:          { variant: 'bst_arcticfox',          front: false, scale: 2.0, texturePool: 'fur', bodyColor: 0xeef2f6, accent: 0x9fe8ff, hue: [0.55, 0.06], sat: [0.10, 0.08], lit: [0.82, 0.08] },
        bst_cottonfox:          { variant: 'bst_cottonfox',          front: false, scale: 2.0, texturePool: 'fur', bodyColor: 0xf4ecdc, accent: 0xffb0d0, hue: [0.02, 0.06], sat: [0.14, 0.08], lit: [0.80, 0.08] },
        bst_icewolfpup:         { variant: 'bst_icewolfpup',         front: false, scale: 1.9, texturePool: 'fur', bodyColor: 0xbcd0e0, accent: 0x88ddff, hue: [0.55, 0.06], sat: [0.18, 0.10], lit: [0.66, 0.10] },
        bst_rabidhyena:         { variant: 'bst_rabidhyena',         front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0x8a7a58, accent: 0xffe14a, hue: [0.11, 0.05], sat: [0.30, 0.12], lit: [0.42, 0.10] },
        bst_feralhyenapack:     { variant: 'bst_feralhyenapack',     front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0x7a6a4a, accent: 0xffcc44, hue: [0.10, 0.05], sat: [0.30, 0.12], lit: [0.38, 0.10] },
        bst_graywolf:           { variant: 'bst_graywolf',           front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x7c7d82, accent: 0xffcc44, hue: [0.62, 0.10], sat: [0.10, 0.10], lit: [0.42, 0.14] },
        bst_manedterrorwolf:    { variant: 'bst_manedterrorwolf',    front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x5a544e, accent: 0xff5544, hue: [0.06, 0.05], sat: [0.14, 0.10], lit: [0.34, 0.10] },
        bst_redfox:             { variant: 'bst_redfox',             front: false, scale: 2.0, texturePool: 'fur', bodyColor: 0xc85a24, accent: 0x2a1408, hue: [0.05, 0.03], sat: [0.60, 0.12], lit: [0.46, 0.10] },
        bst_alphadirewolf:      { variant: 'bst_alphadirewolf',      front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0xcfd8e0, accent: 0x88ddff, hue: [0.56, 0.06], sat: [0.12, 0.08], lit: [0.72, 0.08] },
        bst_alphawarg:          { variant: 'bst_alphawarg',          front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0x4e453c, accent: 0xffaa44, hue: [0.07, 0.05], sat: [0.24, 0.10], lit: [0.30, 0.10] },
        bst_arcticwolf:         { variant: 'bst_arcticwolf',         front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0xe4eaf0, accent: 0xbfe8ff, hue: [0.56, 0.06], sat: [0.10, 0.08], lit: [0.78, 0.08] },
        bst_rabidcoyote:        { variant: 'bst_rabidcoyote',        front: false, scale: 2.3, texturePool: 'fur', bodyColor: 0x9a8460, accent: 0xff5544, hue: [0.10, 0.05], sat: [0.34, 0.12], lit: [0.46, 0.10] },
        bst_scavengingcoyote:   { variant: 'bst_scavengingcoyote',   front: false, scale: 2.3, texturePool: 'fur', bodyColor: 0x8a7654, accent: 0xffcc44, hue: [0.10, 0.05], sat: [0.30, 0.12], lit: [0.42, 0.10] },
        // ── Bespoke split: bigcat group (felines) ───────────────────────────
        bst_lazycat:            { variant: 'bst_lazycat',            front: false, scale: 1.9, texturePool: 'fur', bodyColor: 0x2a2a30, accent: 0x66ff88, hue: [0.62, 0.06], sat: [0.10, 0.08], lit: [0.20, 0.08] },
        bst_blackpanther:       { variant: 'bst_blackpanther',       front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x161418, accent: 0x66ddff, hue: [0.68, 0.06], sat: [0.20, 0.10], lit: [0.12, 0.06] },
        bst_reflectivetiger:    { variant: 'bst_reflectivetiger',    front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0xd4e0ec, accent: 0x2a3038, hue: [0.55, 0.06], sat: [0.12, 0.08], lit: [0.78, 0.08] },
        bst_sabercat:           { variant: 'bst_sabercat',           front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0xc8a24a, accent: 0xfff0d0, hue: [0.10, 0.05], sat: [0.48, 0.14], lit: [0.48, 0.10] },
        bst_wildcat:            { variant: 'bst_wildcat',            front: false, scale: 2.1, texturePool: 'fur', bodyColor: 0x9a7a44, accent: 0xffe14a, hue: [0.10, 0.05], sat: [0.44, 0.14], lit: [0.44, 0.10] },
        bst_feralalleycat:      { variant: 'bst_feralalleycat',      front: false, scale: 1.9, texturePool: 'fur', bodyColor: 0x6a6058, accent: 0xffdd33, hue: [0.09, 0.06], sat: [0.14, 0.10], lit: [0.34, 0.12] },
        bst_goldenlion:         { variant: 'bst_goldenlion',         front: false, scale: 2.7, texturePool: 'fur', bodyColor: 0xd0a850, accent: 0x6a3a10, hue: [0.11, 0.04], sat: [0.50, 0.12], lit: [0.52, 0.08] },
        bst_stripedtiger:       { variant: 'bst_stripedtiger',       front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0xd88a30, accent: 0x1a1008, hue: [0.07, 0.03], sat: [0.60, 0.12], lit: [0.48, 0.08] },
        bst_umbrapanthera:      { variant: 'bst_umbrapanthera',      front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x14121c, accent: 0x9944ff, hue: [0.74, 0.06], sat: [0.35, 0.12], lit: [0.12, 0.06] },
        bst_mysticpanther:      { variant: 'bst_mysticpanther',      front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x201c28, accent: 0x44ddcc, hue: [0.48, 0.08], sat: [0.28, 0.12], lit: [0.16, 0.06] },
        bst_sabertoothalpha:    { variant: 'bst_sabertoothalpha',    front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0xb89a58, accent: 0xfff4dc, hue: [0.10, 0.05], sat: [0.40, 0.12], lit: [0.46, 0.10] },
        bst_diresabertoothalpha:{ variant: 'bst_diresabertoothalpha',front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0xa8b0bc, accent: 0xbfe8ff, hue: [0.56, 0.06], sat: [0.16, 0.10], lit: [0.60, 0.08] },
        // ── Bespoke split: ungulate group ───────────────────────────────────
        bst_thirstycamel:       { variant: 'bst_thirstycamel',       front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0xc8a468, accent: 0x4a3418, hue: [0.10, 0.04], sat: [0.40, 0.12], lit: [0.54, 0.08] },
        bst_foreststag:         { variant: 'bst_foreststag',         front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0x8a5f38, accent: 0xe8dcc0, hue: [0.07, 0.04], sat: [0.42, 0.12], lit: [0.38, 0.10] },
        bst_pastoralsheep:      { variant: 'bst_pastoralsheep',      front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0xf0ece0, accent: 0x2a2420, hue: [0.10, 0.04], sat: [0.10, 0.06], lit: [0.82, 0.06] },
        bst_armoredrhinoceros:  { variant: 'bst_armoredrhinoceros',  front: false, scale: 3.1, texturePool: 'fur', bodyColor: 0x6a6a64, accent: 0xe8dcc0, hue: [0.10, 0.04], sat: [0.08, 0.06], lit: [0.40, 0.08] },
        bst_bloodbellcow:       { variant: 'bst_bloodbellcow',       front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0x8a2a2a, accent: 0xd8b23a, hue: [0.98, 0.04], sat: [0.45, 0.14], lit: [0.34, 0.10] },
        bst_deersprite:         { variant: 'bst_deersprite',         front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0xc84a1a, accent: 0xffaa22, hue: [0.05, 0.04], sat: [0.60, 0.14], lit: [0.44, 0.10] },
        bst_hollowgoat:         { variant: 'bst_hollowgoat',         front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x7a7268, accent: 0x3a5a3a, hue: [0.28, 0.06], sat: [0.16, 0.10], lit: [0.42, 0.10] },
        bst_ironhoofcharger:    { variant: 'bst_ironhoofcharger',    front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0x4a4640, accent: 0xc4c9d2, hue: [0.08, 0.04], sat: [0.10, 0.08], lit: [0.28, 0.08] },
        bst_rancorousbull:      { variant: 'bst_rancorousbull',      front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0x3a2e26, accent: 0xe8dcc0, hue: [0.07, 0.04], sat: [0.35, 0.12], lit: [0.24, 0.08] },
        bst_titanotherealpha:   { variant: 'bst_titanotherealpha',   front: false, scale: 3.4, texturePool: 'fur', bodyColor: 0x6a5a4a, accent: 0xaaccdd, hue: [0.55, 0.06], sat: [0.22, 0.10], lit: [0.34, 0.10] },
        // ── Bespoke split: bear group (ursids) ──────────────────────────────
        bst_brownbear:          { variant: 'bst_brownbear',          front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0x6b4a2e, accent: 0x2a1810, hue: [0.07, 0.04], sat: [0.45, 0.15], lit: [0.30, 0.10] },
        bst_hornedbear:         { variant: 'bst_hornedbear',         front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0x4a3a30, accent: 0xe8dcc0, hue: [0.07, 0.04], sat: [0.38, 0.12], lit: [0.26, 0.08] },
        bst_youngyeti:          { variant: 'bst_youngyeti',          front: false, scale: 2.8, texturePool: 'fur', bodyColor: 0xe4eaf0, accent: 0x88ddff, hue: [0.56, 0.06], sat: [0.12, 0.08], lit: [0.80, 0.06] },
        bst_frostbackursid:     { variant: 'bst_frostbackursid',     front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0x9ab4c8, accent: 0xbfe8ff, hue: [0.55, 0.06], sat: [0.20, 0.10], lit: [0.58, 0.10] },
        bst_panda:              { variant: 'bst_panda',              front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0xf0f0f0, accent: 0x141414, hue: [0.10, 0.04], sat: [0.06, 0.04], lit: [0.86, 0.06] },
        bst_polarbear:          { variant: 'bst_polarbear',          front: false, scale: 3.1, texturePool: 'fur', bodyColor: 0xf4f6fa, accent: 0x9fe8ff, hue: [0.56, 0.06], sat: [0.06, 0.06], lit: [0.86, 0.06] },
        bst_timewornowlbear:    { variant: 'bst_timewornowlbear',    front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0x7a6a4e, accent: 0xffcc44, hue: [0.09, 0.05], sat: [0.30, 0.12], lit: [0.40, 0.10] },
        bst_demonbear:          { variant: 'bst_demonbear',          front: false, scale: 3.1, texturePool: 'fur', bodyColor: 0x7a1414, accent: 0xff4422, hue: [0.0, 0.04], sat: [0.60, 0.15], lit: [0.28, 0.08] },
        bst_kodiakbear:         { variant: 'bst_kodiakbear',         front: false, scale: 3.1, texturePool: 'fur', bodyColor: 0x5a3f28, accent: 0x2a1810, hue: [0.07, 0.04], sat: [0.44, 0.14], lit: [0.28, 0.08] },
        bst_emberclawbear:      { variant: 'bst_emberclawbear',      front: false, scale: 2.9, texturePool: 'fur', bodyColor: 0x3a2018, accent: 0xff6610, hue: [0.04, 0.03], sat: [0.55, 0.15], lit: [0.24, 0.08] },
        bst_frostfangbear:      { variant: 'bst_frostfangbear',      front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0xb8d0e0, accent: 0xbfe8ff, hue: [0.55, 0.06], sat: [0.20, 0.10], lit: [0.66, 0.08] },
        bst_thundermawursine:   { variant: 'bst_thundermawursine',   front: false, scale: 3.0, texturePool: 'fur', bodyColor: 0x4a4658, accent: 0xffee44, hue: [0.62, 0.06], sat: [0.24, 0.10], lit: [0.30, 0.10] },
        bst_titaniccavebear:    { variant: 'bst_titaniccavebear',    front: false, scale: 3.4, texturePool: 'fur', bodyColor: 0x5a4636, accent: 0x2a1810, hue: [0.08, 0.04], sat: [0.40, 0.12], lit: [0.26, 0.08] },
        // ── Bespoke split: boar group (suids) ───────────────────────────────
        bst_direpig:            { variant: 'bst_direpig',            front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x5a4636, accent: 0xfff4d0, hue: [0.07, 0.04], sat: [0.36, 0.12], lit: [0.30, 0.10] },
        bst_flyingpig:          { variant: 'bst_flyingpig',          front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0xe8a0a8, accent: 0xffffff, hue: [0.97, 0.04], sat: [0.32, 0.10], lit: [0.66, 0.08] },
        bst_razorbackboar:      { variant: 'bst_razorbackboar',      front: false, scale: 2.7, texturePool: 'fur', bodyColor: 0x3a2e24, accent: 0xc4c9d2, hue: [0.07, 0.04], sat: [0.35, 0.12], lit: [0.24, 0.08] },
        bst_wildboar:           { variant: 'bst_wildboar',           front: false, scale: 2.5, texturePool: 'fur', bodyColor: 0x4a3b30, accent: 0x140d0a, hue: [0.07, 0.04], sat: [0.35, 0.12], lit: [0.26, 0.08] },
        bst_flyingpig2:         { variant: 'bst_flyingpig2',         front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0xf0b0b8, accent: 0xffffff, hue: [0.97, 0.04], sat: [0.30, 0.10], lit: [0.70, 0.08] },
        bst_normalpig:          { variant: 'bst_normalpig',          front: false, scale: 2.4, texturePool: 'fur', bodyColor: 0xf0aeb4, accent: 0xd88a90, hue: [0.97, 0.04], sat: [0.34, 0.10], lit: [0.72, 0.08] },
        bst_madboar:            { variant: 'bst_madboar',            front: false, scale: 2.6, texturePool: 'fur', bodyColor: 0x4a3b30, accent: 0xff5544, hue: [0.07, 0.04], sat: [0.38, 0.12], lit: [0.26, 0.08] },
        // ── Bespoke split: ape group (primates) ─────────────────────────────
        bst_maleficentape:      { variant: 'bst_maleficentape',      front: true,  scale: 2.9, texturePool: 'fur', bodyColor: 0x2a2622, accent: 0xb89878, hue: [0.07, 0.05], sat: [0.16, 0.10], lit: [0.18, 0.08] },
        bst_organgrindermonkey: { variant: 'bst_organgrindermonkey', front: true,  scale: 2.2, texturePool: 'fur', bodyColor: 0x6a4a30, accent: 0xd8b23a, hue: [0.08, 0.05], sat: [0.40, 0.12], lit: [0.34, 0.10] },
        bst_treemonkey:         { variant: 'bst_treemonkey',         front: true,  scale: 2.2, texturePool: 'fur', bodyColor: 0x7a5638, accent: 0xd8c090, hue: [0.08, 0.05], sat: [0.38, 0.12], lit: [0.36, 0.10] },
    };

    class BeastBattler3D extends Base {
        constructor(scale, offsetY, battler, weaponType, creatureType) {
            const profile = B_PROFILES[creatureType] || B_PROFILES.bear;
            super(scale, offsetY, battler, profile, 0, creatureType || 'bear');
            this.variant = profile.variant;
            this._materials = [];
            this._baseY = null;
            if (profile.front) this.facingYaw = 0;
        }

        // ── shared material / part helpers ───────────────────────────────────
        _mat(color, opacity, rough, emissive) {
            const m = new THREE.MeshStandardMaterial({
                color, roughness: (rough === undefined ? 0.8 : rough),
                emissive: new THREE.Color(emissive || 0x000000), emissiveIntensity: emissive ? 0.6 : 0,
                transparent: true, opacity: (opacity === undefined ? 1.0 : opacity)
            });
            this._materials.push(m);
            return m;
        }
        // Main id-varied body fur (fixed base colour tinted by the per-id skin map).
        _furMat() {
            const p = this.profile;
            const m = new THREE.MeshStandardMaterial({
                color: p.bodyColor, map: this.skinTex(), roughness: 0.9, transparent: true,
                emissive: new THREE.Color(p.emissive || 0x000000), emissiveIntensity: p.emissive ? 0.35 : 0
            });
            this._materials.push(m);
            return m;
        }
        _eye(parent, x, y, z, r, accent, glow) {
            const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), this._mat(accent || 0x111111, 1.0, 0.2, glow ? accent : 0));
            e.position.set(x, y, z); parent.add(e); return e;
        }
        // A hip-pivoted leg that swings in the gait. foot: 'paw' | 'hoof' | 'pad'.
        _leg(mat, x, z, hipY, len, foot) {
            const g = new THREE.Group();
            const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, len * 0.55, 8), mat);
            thigh.position.y = -len * 0.27; g.add(thigh);
            const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, len * 0.45, 8), mat);
            shin.position.y = -len * 0.72; g.add(shin);
            let f;
            if (foot === 'hoof') f = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 8), this._mat(0x241b14, 1.0, 0.5));
            else if (foot === 'paw') f = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.26), mat);
            else f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat);
            f.position.y = -len * 0.95; g.add(f);
            g.position.set(x, hipY, z); this.bodyGroup.add(g); return g;
        }
        // A drooping segmented tail (curls forward if droopZ > 0).
        _tail(mat, baseY, baseZ, segs, taper, droopZ) {
            const g = new THREE.Group();
            let py = 0, pz = 0, r = 0.12;
            for (let i = 0; i < segs; i++) {
                const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mat);
                s.position.set(0, py, pz); g.add(s);
                py -= 0.11; pz += droopZ * 0.09; r *= taper;
            }
            g.position.set(0, baseY, baseZ); this.bodyGroup.add(g); return g;
        }
        // A feline tail: cats carry it UP, not hanging. Leaves the rump angled
        // back, sweeps vertical, then hooks forward at the tip, so the arc
        // clears the haunches and the hind legs instead of dangling between
        // them. Base goes just inside the rump so the root reads as attached.
        _felineTail(mat, baseY, baseZ, segs, taper) {
            const g = new THREE.Group();
            let py = 0, pz = 0, r = 0.12;
            for (let i = 0; i < segs; i++) {
                const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mat);
                s.position.set(0, py, pz); g.add(s);
                const a = -0.55 + (i / (segs - 1)) * 1.25;   // lean: back -> forward
                py += Math.cos(a) * 0.13; pz += Math.sin(a) * 0.13; r *= taper;
            }
            g.position.set(0, baseY, baseZ); this.bodyGroup.add(g); return g;
        }
        _nub(mat, x, y, z, r) {
            const g = new THREE.Group();
            g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mat));
            g.position.set(x, y, z); this.bodyGroup.add(g); return g;
        }

        // Common four-leg part map + dismemberment cascade.
        _wireQuad(p) {
            const m = {}, set = (ks, mesh) => { if (mesh) ks.forEach(k => m[k] = mesh); };
            set(['BODY', 'TORSO', 'CORE', 'SPINE', 'RIBCAGE', 'MASS'], p.body);
            set(['HEAD', 'SKULL', 'BRAIN', 'FACE', 'EYE', 'EYES'], p.head);
            set(['LEFT_LEG', 'FRONT_LEFT_PAW', 'LEFT_ARM'], p.fl);
            set(['RIGHT_LEG', 'FRONT_RIGHT_PAW', 'RIGHT_ARM'], p.fr);
            set(['REAR_LEFT_LEG', 'HIND_LEFT_LEG', 'LEFT_THIGH'], p.rl);
            set(['REAR_RIGHT_LEG', 'HIND_RIGHT_LEG', 'RIGHT_THIGH'], p.rr);
            set(['TAIL'], p.tail);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['BODY', 'TORSO', 'CORE', 'SPINE', 'RIBCAGE', 'MASS'], hide: [p.body, p.head, p.fl, p.fr, p.rl, p.rr, p.tail].filter(Boolean) },
                { gone: ['HEAD', 'SKULL', 'BRAIN', 'FACE'], hide: [p.head].filter(Boolean) },
                { gone: ['LEFT_LEG', 'FRONT_LEFT_PAW'], hide: [p.fl].filter(Boolean) },
                { gone: ['RIGHT_LEG', 'FRONT_RIGHT_PAW'], hide: [p.fr].filter(Boolean) },
                { gone: ['REAR_LEFT_LEG', 'HIND_LEFT_LEG'], hide: [p.rl].filter(Boolean) },
                { gone: ['REAR_RIGHT_LEG', 'HIND_RIGHT_LEG'], hide: [p.rr].filter(Boolean) },
                { gone: ['TAIL'], hide: [p.tail].filter(Boolean) },
            ];
        }
        _wireBiped(p) {
            const m = {}, set = (ks, mesh) => { if (mesh) ks.forEach(k => m[k] = mesh); };
            set(['BODY', 'TORSO', 'CORE', 'SPINE', 'RIBCAGE', 'CHEST', 'MASS'], p.body);
            set(['HEAD', 'SKULL', 'BRAIN', 'FACE'], p.head);
            set(['LEFT_ARM', 'LEFT_UPPER_ARM', 'LEFT_HAND'], p.la);
            set(['RIGHT_ARM', 'RIGHT_UPPER_ARM', 'RIGHT_HAND'], p.ra);
            set(['LEFT_LEG', 'LEFT_THIGH', 'REAR_LEFT_LEG', 'HIND_LEFT_LEG'], p.ll);
            set(['RIGHT_LEG', 'RIGHT_THIGH', 'REAR_RIGHT_LEG', 'HIND_RIGHT_LEG'], p.rl);
            this._partMeshMap = m;
            this._cascadeRules = [
                { gone: ['BODY', 'TORSO', 'CORE', 'SPINE', 'RIBCAGE', 'CHEST', 'MASS'], hide: [p.body, p.head, p.la, p.ra, p.ll, p.rl].filter(Boolean) },
                { gone: ['HEAD', 'SKULL', 'BRAIN', 'FACE'], hide: [p.head].filter(Boolean) },
                { gone: ['LEFT_ARM', 'LEFT_UPPER_ARM'], hide: [p.la].filter(Boolean) },
                { gone: ['RIGHT_ARM', 'RIGHT_UPPER_ARM'], hide: [p.ra].filter(Boolean) },
                { gone: ['LEFT_LEG', 'LEFT_THIGH'], hide: [p.ll].filter(Boolean) },
                { gone: ['RIGHT_LEG', 'RIGHT_THIGH'], hide: [p.rl].filter(Boolean) },
            ];
        }

        async load(physicsWorld) {
            this.physicsWorld = physicsWorld; // unused (no ragdoll)
            const fur = this._furMat();
            switch (this.variant) {
                case 'wolf':     this._buildWolf(fur); break;
                case 'bigcat':   this._buildBigcat(fur); break;
                case 'boar':     this._buildBoar(fur); break;
                case 'rodent':   this._buildRodent(fur); break;
                case 'armoredbeaver':       this._buildArmoredbeaver(fur); break;
                case 'wastelandbeaver':     this._buildWastelandbeaver(fur); break;
                case 'armoredporcupine':    this._buildArmoredporcupine(fur); break;
                case 'spikeyporcupine':     this._buildSpikeyporcupine(fur); break;
                case 'caffeinatedsquirrel': this._buildCaffeinatedsquirrel(fur); break;
                case 'woodsquirrel':        this._buildWoodsquirrel(fur); break;
                case 'fieldmouse':          this._buildFieldmouse(fur); break;
                case 'forestrat':           this._buildForestrat(fur); break;
                case 'giantrat':            this._buildGiantrat(fur); break;
                case 'sewerrat':            this._buildSewerrat(fur); break;
                case 'swamprat':            this._buildSwamprat(fur); break;
                case 'plaguerattus':        this._buildPlaguerattus(fur); break;
                case 'ratking':             this._buildRatking(fur); break;
                case 'frostraccoon':        this._buildFrostraccoon(fur); break;
                case 'nightraccoon':        this._buildNightraccoon(fur); break;
                case 'molerodent':          this._buildMolerodent(fur); break;
                case 'tunnelingmole':       this._buildTunnelingmole(fur); break;
                case 'icelemming':          this._buildIcelemming(fur); break;
                case 'ungulate': this._buildUngulate(fur); break;
                case 'ape':      this._buildApe(fur); break;
                case 'chromaticmanticore': this._buildChromaticmanticore(fur); break;
                case 'chupacabra':         this._buildChupacabra(fur); break;
                case 'giantsnail':         this._buildGiantsnail(fur); break;
                case 'infernalcerberus':   this._buildInfernalcerberus(fur); break;
                case 'junglepredator':     this._buildJunglepredator(fur); break;
                case 'mianni':             this._buildMianni(fur); break;
                case 'palettephantom':     this._buildPalettephantom(fur); break;
                case 'radiantunicorn':     this._buildRadiantunicorn(fur); break;
                case 'rhinobeetle':        this._buildRhinobeetle(fur); break;
                case 'rummagingopossum':   this._buildRummagingopossum(fur); break;
                case 'beast666':           this._buildBeast666(fur); break;
                case 'tempestpegasus':     this._buildTempestpegasus(fur); break;
                case 'velocicorn':         this._buildVelocicorn(fur); break;
                case 'swampleviathan':     this._buildSwampleviathan(fur); break;
                case 'invertedhunger':     this._buildInvertedhunger(fur); break;
                case 'voidhowler':         this._buildVoidhowler(fur); break;
                case 'feastoffamine':      this._buildFeastoffamine(fur); break;
                case 'maternityward':      this._buildMaternityward(fur); break;
                case 'starvingsabercat':   this._buildStarvingsabercat(fur); break;
                case 'ashenprowler':       this._buildAshenprowler(fur); break;
                case 'gauntsnapper':       this._buildGauntsnapper(fur); break;
                case 'holloweyedboar':     this._buildHolloweyedboar(fur); break;
                case 'ferallynx':          this._buildFerallynx(fur); break;
                case 'diregnasher':        this._buildDiregnasher(fur); break;
                case 'gauntclawrunner':    this._buildGauntclawrunner(fur); break;
                case 'bloodmawdirewolf':   this._buildBloodmawdirewolf(fur); break;
                case 'gauntlynx':          this._buildGauntlynx(fur); break;
                case 'feralbadger':        this._buildFeralbadger(fur); break;
                case 'starvinggnasher':    this._buildStarvinggnasher(fur); break;
                case 'feralridgeback':     this._buildFeralridgeback(fur); break;
                // ── Bespoke splits (canids) ─────────────────────────────────
                case 'bst_arcticfox':          this._buildBstArcticfox(fur); break;
                case 'bst_cottonfox':          this._buildBstCottonfox(fur); break;
                case 'bst_icewolfpup':         this._buildBstIcewolfpup(fur); break;
                case 'bst_rabidhyena':         this._buildBstRabidhyena(fur); break;
                case 'bst_feralhyenapack':     this._buildBstFeralhyenapack(fur); break;
                case 'bst_graywolf':           this._buildBstGraywolf(fur); break;
                case 'bst_manedterrorwolf':    this._buildBstManedterrorwolf(fur); break;
                case 'bst_redfox':             this._buildBstRedfox(fur); break;
                case 'bst_alphadirewolf':      this._buildBstAlphadirewolf(fur); break;
                case 'bst_alphawarg':          this._buildBstAlphawarg(fur); break;
                case 'bst_arcticwolf':         this._buildBstArcticwolf(fur); break;
                case 'bst_rabidcoyote':        this._buildBstRabidcoyote(fur); break;
                case 'bst_scavengingcoyote':   this._buildBstScavengingcoyote(fur); break;
                // ── Bespoke splits (felines) ────────────────────────────────
                case 'bst_lazycat':            this._buildBstLazycat(fur); break;
                case 'bst_blackpanther':       this._buildBstBlackpanther(fur); break;
                case 'bst_reflectivetiger':    this._buildBstReflectivetiger(fur); break;
                case 'bst_sabercat':           this._buildBstSabercat(fur); break;
                case 'bst_wildcat':            this._buildBstWildcat(fur); break;
                case 'bst_feralalleycat':      this._buildBstFeralalleycat(fur); break;
                case 'bst_goldenlion':         this._buildBstGoldenlion(fur); break;
                case 'bst_stripedtiger':       this._buildBstStripedtiger(fur); break;
                case 'bst_umbrapanthera':      this._buildBstUmbrapanthera(fur); break;
                case 'bst_mysticpanther':      this._buildBstMysticpanther(fur); break;
                case 'bst_sabertoothalpha':    this._buildBstSabertoothalpha(fur); break;
                case 'bst_diresabertoothalpha':this._buildBstDiresabertoothalpha(fur); break;
                // ── Bespoke splits (ungulates) ──────────────────────────────
                case 'bst_thirstycamel':       this._buildBstThirstycamel(fur); break;
                case 'bst_foreststag':         this._buildBstForeststag(fur); break;
                case 'bst_pastoralsheep':      this._buildBstPastoralsheep(fur); break;
                case 'bst_armoredrhinoceros':  this._buildBstArmoredrhinoceros(fur); break;
                case 'bst_bloodbellcow':       this._buildBstBloodbellcow(fur); break;
                case 'bst_deersprite':         this._buildBstDeersprite(fur); break;
                case 'bst_hollowgoat':         this._buildBstHollowgoat(fur); break;
                case 'bst_ironhoofcharger':    this._buildBstIronhoofcharger(fur); break;
                case 'bst_rancorousbull':      this._buildBstRancorousbull(fur); break;
                case 'bst_titanotherealpha':   this._buildBstTitanotherealpha(fur); break;
                // ── Bespoke splits (ursids) ─────────────────────────────────
                case 'bst_brownbear':          this._buildBstBrownbear(fur); break;
                case 'bst_hornedbear':         this._buildBstHornedbear(fur); break;
                case 'bst_youngyeti':          this._buildBstYoungyeti(fur); break;
                case 'bst_frostbackursid':     this._buildBstFrostbackursid(fur); break;
                case 'bst_panda':              this._buildBstPanda(fur); break;
                case 'bst_polarbear':          this._buildBstPolarbear(fur); break;
                case 'bst_timewornowlbear':    this._buildBstTimewornowlbear(fur); break;
                case 'bst_demonbear':          this._buildBstDemonbear(fur); break;
                case 'bst_kodiakbear':         this._buildBstKodiakbear(fur); break;
                case 'bst_emberclawbear':      this._buildBstEmberclawbear(fur); break;
                case 'bst_frostfangbear':      this._buildBstFrostfangbear(fur); break;
                case 'bst_thundermawursine':   this._buildBstThundermawursine(fur); break;
                case 'bst_titaniccavebear':    this._buildBstTitaniccavebear(fur); break;
                // ── Bespoke splits (suids) ──────────────────────────────────
                case 'bst_direpig':            this._buildBstDirepig(fur); break;
                case 'bst_flyingpig':          this._buildBstFlyingpig(fur); break;
                case 'bst_razorbackboar':      this._buildBstRazorbackboar(fur); break;
                case 'bst_wildboar':           this._buildBstWildboar(fur); break;
                case 'bst_flyingpig2':         this._buildBstFlyingpig(fur); break;
                case 'bst_normalpig':          this._buildBstNormalpig(fur); break;
                case 'bst_madboar':            this._buildBstMadboar(fur); break;
                // ── Bespoke splits (primates) ───────────────────────────────
                case 'bst_maleficentape':      this._buildBstMaleficentape(fur); break;
                case 'bst_organgrindermonkey': this._buildBstOrgangrindermonkey(fur); break;
                case 'bst_treemonkey':         this._buildBstTreemonkey(fur); break;
                default:         this._buildBear(fur); break;
            }
            this.model = this.bodyGroup;
            this.applyModelScale();
            this.loaded = true;
            return this;
        }

        // ── Bear: bulky ursine on short thick legs ───────────────────────────
        _buildBear(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), fur); torso.scale.set(1.0, 0.95, 1.55); this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 12), fur); shoulders.position.set(0, 0.14, 0.45); this.body.add(shoulders);
            this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), fur));
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.28, 10), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.05, 0.3); this.head.add(snout);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(0x140d0a, 1.0, 0.4)); nose.position.set(0, -0.03, 0.46); this.head.add(nose);
            for (const ex of [-0.2, 0.2]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), fur); ear.position.set(ex, 0.28, -0.02); ear.scale.z = 0.5; this.head.add(ear); }
            this._eye(this.head, -0.13, 0.07, 0.24, 0.05, p.accent, false);
            this._eye(this.head, 0.13, 0.07, 0.24, 0.05, p.accent, false);
            this.head.position.set(0, 1.46, 0.6); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.32, 0.42, 0.92, 0.95, 'paw');
            this.frontRight = this._leg(fur, 0.32, 0.42, 0.92, 0.95, 'paw');
            this.rearLeft   = this._leg(fur, -0.32, -0.42, 0.92, 0.95, 'paw');
            this.rearRight  = this._leg(fur, 0.32, -0.42, 0.92, 0.95, 'paw');
            this.tail = this._nub(fur, 0, 1.0, -0.74, 0.09);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Wolf: lean canine with long snout, hackles, bushy tail ───────────
        _buildWolf(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.05, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), fur); chest.position.z = 0.48; this.body.add(chest);
            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); rump.position.z = -0.52; this.body.add(rump);
            for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5), fur); sp.position.set(0, 0.26, 0.4 - i * 0.2); this.body.add(sp); }
            this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 10), fur); neck.rotation.x = 0.7; neck.position.set(0, 0.02, -0.06); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur); skull.scale.set(0.9, 0.85, 1.1); skull.position.set(0, 0.24, 0.18); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.2, 0.44); this.head.add(snout);
            for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), fur); ear.position.set(ex, 0.46, 0.08); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.27, 0.3, 0.045, p.accent, true);
            this._eye(this.head, 0.1, 0.27, 0.3, 0.045, p.accent, true);
            this.head.position.set(0, 1.2, 0.55); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.2, 0.4, 0.96, 1.0, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.4, 0.96, 1.0, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.42, 0.96, 1.0, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.42, 0.96, 1.0, 'pad');
            this.tail = this._tail(fur, 1.06, -0.68, 4, 0.85, -0.4);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Big cat: sleek crouched feline with a long curling tail ──────────
        _buildBigcat(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.15, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); haunch.position.set(0, 0.06, -0.5); this.body.add(haunch);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); chest.position.z = 0.5; this.body.add(chest);
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur));
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.05, 0.2); this.head.add(muzzle);
            for (const ex of [-0.13, 0.13]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 6), fur); ear.position.set(ex, 0.2, 0); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.04, 0.17, 0.045, p.accent, true);
            this._eye(this.head, 0.1, 0.04, 0.17, 0.045, p.accent, true);
            this.head.position.set(0, 1.02, 0.6); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.2, 0.42, 0.82, 0.85, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.42, 0.82, 0.85, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.44, 0.82, 0.85, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.44, 0.82, 0.85, 'pad');
            this.tail = this._felineTail(fur, 0.98, -0.68, 7, 0.9);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Boar: low front-heavy suid with hump, tusks and bristles ─────────
        _buildBoar(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), fur); torso.scale.set(1.0, 0.85, 1.55); this.body.add(torso);
            const hump = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), fur); hump.position.set(0, 0.2, 0.4); this.body.add(hump);
            for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 4), this._mat(0x140d0a, 1.0, 0.9)); b.position.set(0, 0.28, 0.45 - i * 0.17); this.body.add(b); }
            this.body.position.set(0, 0.9, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); skull.scale.set(0.9, 0.9, 1.2); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.3, 10), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.06, 0.28); this.head.add(snout);
            const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10), this._mat(0x3a2a22, 1.0, 0.5)); disc.rotation.x = Math.PI / 2; disc.position.set(0, -0.06, 0.44); this.head.add(disc);
            const tuskMat = this._mat(0xe8dcc0, 1.0, 0.4);
            for (const tx of [-0.1, 0.1]) { const tk = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 6), tuskMat); tk.position.set(tx, -0.1, 0.36); tk.rotation.set(-0.7, 0, tx > 0 ? 0.3 : -0.3); this.head.add(tk); }
            for (const ex of [-0.16, 0.16]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), fur); ear.position.set(ex, 0.22, 0); this.head.add(ear); }
            this._eye(this.head, -0.13, 0.06, 0.18, 0.04, p.accent, false);
            this._eye(this.head, 0.13, 0.06, 0.18, 0.04, p.accent, false);
            this.head.position.set(0, 0.92, 0.62); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.26, 0.38, 0.78, 0.78, 'hoof');
            this.frontRight = this._leg(fur, 0.26, 0.38, 0.78, 0.78, 'hoof');
            this.rearLeft   = this._leg(fur, -0.26, -0.4, 0.78, 0.78, 'hoof');
            this.rearRight  = this._leg(fur, 0.26, -0.4, 0.78, 0.78, 'hoof');
            this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), fur); this.tail.position.set(0, 0.9, -0.62); this.bodyGroup.add(this.tail);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Rodent: small upright critter, big incisors, round ears, long tail ─
        _buildRodent(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), fur); belly.scale.set(1.0, 1.2, 1.0); this.body.add(belly);
            this.body.position.set(0, 0.66, 0.02); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur));
            const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), fur); muzzle.position.set(0, -0.06, 0.2); this.head.add(muzzle);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), this._mat(p.accent, 1.0, 0.4)); nose.position.set(0, -0.08, 0.32); this.head.add(nose);
            for (const ix of [-0.045, 0.045]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.03), this._mat(0xfff4d0, 1.0, 0.4)); t.position.set(ix, -0.14, 0.27); this.head.add(t); }
            for (const ex of [-0.18, 0.18]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), fur); ear.position.set(ex, 0.22, 0); ear.scale.set(1, 1, 0.3); this.head.add(ear); }
            this._eye(this.head, -0.12, 0.06, 0.2, 0.05, 0x120c08, false);
            this._eye(this.head, 0.12, 0.06, 0.2, 0.05, 0x120c08, false);
            this.head.position.set(0, 1.08, 0.06); this.bodyGroup.add(this.head);

            // Tiny held-up front paws + folded haunch feet.
            this.frontLeft  = this._nub(fur, -0.15, 0.66, 0.24, 0.08);
            this.frontRight = this._nub(fur, 0.15, 0.66, 0.24, 0.08);
            this.rearLeft   = this._nub(fur, -0.22, 0.34, 0.06, 0.12);
            this.rearRight  = this._nub(fur, 0.22, 0.34, 0.06, 0.12);
            this.tail = this._tail(fur, 0.58, -0.3, 6, 0.86, 0.6);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Parameterised rodent core, reused by the bespoke rodent one-offs ──
        // Builds body+head+paws+tail and wires the quad cascade. Options:
        //   sx/sy/sz body scale · bodyR · bodyY · headR · headY
        //   ears ('round'|'big'|'tuft'|'tiny'|'none') · teeth(false hides) ·
        //   teethLen · teethColor · nose · eye · eyeGlow ·
        //   tail ('long'|'bushy'|'paddle'|'stub') · tailColor
        _rodentBase(fur, o) {
            o = o || {};
            const p = this.profile;
            const quad = !!o.quad; this._quad = quad;
            const br = o.bodyR || 0.34;
            const hr = o.headR || 0.26;
            const sz = o.sz || 1.0, sx = o.sx || 1.0;
            const by = quad ? 0.52 : (o.bodyY != null ? o.bodyY : 0.66);
            const hy = o.headY != null ? o.headY : 1.08;
            this.body = new THREE.Group();
            const belly = new THREE.Mesh(new THREE.SphereGeometry(br, 12, 12), fur);
            if (quad) belly.scale.set(sx, 0.82, sz * 1.7); else belly.scale.set(sx, o.sy || 1.2, sz);
            this.body.add(belly);
            this.body.position.set(0, by, 0.02); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(hr, 12, 12), fur));
            const muzzle = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.5, 10, 10), fur); muzzle.position.set(0, -0.06, hr * 0.77); this.head.add(muzzle);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), this._mat(o.nose || p.accent, 1.0, 0.4)); nose.position.set(0, -0.08, hr * 1.23); this.head.add(nose);
            if (o.teeth !== false) for (const ix of [-0.045, 0.045]) { const to = new THREE.Mesh(new THREE.BoxGeometry(0.05, o.teethLen || 0.1, 0.03), this._mat(o.teethColor || 0xfff4d0, 1.0, 0.4)); to.position.set(ix, -0.14, hr * 1.04); this.head.add(to); }
            const ear = o.ears || 'round';
            if (ear === 'tuft') {
                for (const ex of [-0.14, 0.14]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), fur); e.position.set(ex, 0.27, 0); this.head.add(e); }
            } else if (ear !== 'none') {
                const er = ear === 'big' ? 0.17 : (ear === 'tiny' ? 0.06 : 0.12);
                for (const ex of [-0.18, 0.18]) { const e = new THREE.Mesh(new THREE.SphereGeometry(er, 10, 10), fur); e.position.set(ex, ear === 'big' ? 0.26 : 0.22, 0); e.scale.set(1, 1, 0.3); this.head.add(e); }
            }
            this._eye(this.head, -0.12, 0.06, 0.2, 0.05, o.eye || 0x120c08, !!o.eyeGlow);
            this._eye(this.head, 0.12, 0.06, 0.2, 0.05, o.eye || 0x120c08, !!o.eyeGlow);
            if (quad) { this.head.position.set(0, by + 0.04, br * sz * 1.55 + hr * 0.35); this.head.rotation.x = 0.16; }
            else this.head.position.set(0, hy, 0.06);
            this.bodyGroup.add(this.head);

            if (quad) {
                const lz = br * sz * 0.95, lx = br * sx * 0.78 + 0.03, len = by + 0.04;
                this.frontLeft  = this._leg(fur, -lx, lz, by, len, 'paw');
                this.frontRight = this._leg(fur, lx, lz, by, len, 'paw');
                this.rearLeft   = this._leg(fur, -lx, -lz, by, len, 'paw');
                this.rearRight  = this._leg(fur, lx, -lz, by, len, 'paw');
            } else {
                this.frontLeft  = this._nub(fur, -0.15, by, 0.24, 0.08);
                this.frontRight = this._nub(fur, 0.15, by, 0.24, 0.08);
                this.rearLeft   = this._nub(fur, -0.22, 0.34, 0.06, 0.12);
                this.rearRight  = this._nub(fur, 0.22, 0.34, 0.06, 0.12);
            }

            const tt = o.tail || 'long';
            const tBaseY = quad ? by : 0.5, tBaseZ = quad ? -(br * sz * 1.5) : -0.34;
            if (tt === 'paddle') {
                this.tail = new THREE.Group();
                const pad = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.07), this._mat(o.tailColor || 0x3a2a20, 1.0, 0.6));
                pad.position.set(0, -0.18, 0); this.tail.add(pad);
                this.tail.position.set(0, tBaseY, tBaseZ); this.tail.rotation.x = quad ? 0.9 : 0.55; this.bodyGroup.add(this.tail);
            } else if (tt === 'bushy') {
                this.tail = new THREE.Group();
                let ty = 0, tz = 0, r = 0.17;
                for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), fur); s.position.set(0, ty, tz); this.tail.add(s); ty += 0.17; tz -= 0.04; r *= 0.95; }
                this.tail.position.set(0, quad ? by + 0.06 : 0.52, tBaseZ); this.tail.rotation.x = -0.35; this.bodyGroup.add(this.tail);
            } else if (tt === 'stub') {
                this.tail = this._nub(fur, 0, quad ? by : 0.52, quad ? tBaseZ : -0.3, 0.09);
            } else { // 'long'
                this.tail = this._tail(fur, quad ? by + 0.02 : 0.58, quad ? tBaseZ : -0.3, 6, 0.86, quad ? -0.15 : 0.6);
            }
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }
        // Spine-following Y for back decoration: upright vs quad layouts.
        _backY() { return this._quad ? 0.80 : 0.86; }
        // Attach a decoration mesh so it fades on death and vanishes if the core is lost.
        _deco(mesh) { this.bodyGroup.add(mesh); if (this._cascadeRules && this._cascadeRules[0]) this._cascadeRules[0].hide.push(mesh); return mesh; }

        // ── Armored Beaver: iron-pelt river rodent, paddle tail, back plates ──
        _buildArmoredbeaver(fur) {
            const p = this.profile;
            this._rodentBase(fur, { sx: 1.15, sy: 1.1, sz: 1.2, bodyR: 0.38, headR: 0.27, teethColor: 0xffae3a, teethLen: 0.14, tail: 'paddle', tailColor: 0x4a3a2a });
            const plate = this._mat(p.accent, 1.0, 0.35);
            for (let i = 0; i < 3; i++) { const pl = new THREE.Mesh(new THREE.SphereGeometry(0.22 - i * 0.02, 10, 8), plate); pl.scale.set(1.1, 0.4, 0.9); pl.position.set(0, 0.92, 0.2 - i * 0.22); this._deco(pl); }
        }
        // ── Wasteland Beaver: apocalypse survivor with scrap plating, paddle ──
        _buildWastelandbeaver(fur) {
            this._rodentBase(fur, { sx: 1.1, sy: 1.05, sz: 1.15, bodyR: 0.37, teethColor: 0xd8c890, teethLen: 0.13, tail: 'paddle', tailColor: 0x3a342a });
            const scrap = this._mat(0x6a6258, 1.0, 0.5);
            const slab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.5), scrap); slab.position.set(0, 0.95, 0.0); slab.rotation.x = 0.12; this._deco(slab);
            const rust = this._mat(0x8a5a32, 1.0, 0.85);
            const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), rust); pipe.position.set(0.18, 1.1, -0.05); pipe.rotation.z = 0.4; this._deco(pipe);
        }
        // ── Armored Porcupine: curls into a spinning ball of blade-scales ────
        _buildArmoredporcupine(fur) {
            const p = this.profile;
            this._rodentBase(fur, { sx: 1.2, sy: 1.05, sz: 1.2, bodyR: 0.42, headR: 0.22, headY: 0.92, ears: 'tiny', tail: 'stub' });
            const blade = this._mat(p.accent, 1.0, 0.3);
            for (let i = 0; i < 26; i++) {
                const a = (i / 26) * Math.PI * 2, ring = 0.2 + (i % 3) * 0.18;
                const q = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.3, 4), blade);
                const dx = Math.cos(a) * 0.42, dz = Math.sin(a) * 0.42 - 0.06, dy = 0.66 + Math.sin(ring) * 0.18;
                q.position.set(dx, dy, dz); q.lookAt(dx * 3, dy + (dy - 0.66) * 2, dz * 3); q.rotateX(Math.PI / 2); this._deco(q);
            }
        }
        // ── Spikey Porcupine: stout rodent with a back full of quills ────────
        _buildSpikeyporcupine(fur) {
            const p = this.profile;
            this._rodentBase(fur, { sx: 1.1, sy: 1.0, sz: 1.25, bodyR: 0.36, teethColor: 0xffd27a, tail: 'stub' });
            const quill = this._mat(p.accent, 1.0, 0.45);
            for (let i = 0; i < 16; i++) {
                const row = Math.floor(i / 4), col = i % 4;
                const q = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.42, 5), quill);
                q.position.set(-0.18 + col * 0.12, 0.92, 0.24 - row * 0.2); q.rotation.x = -0.6; this._deco(q);
            }
        }
        // ── Caffeinated Squirrel: jittery, wide glowing eyes, espresso cup ───
        _buildCaffeinatedsquirrel(fur) {
            this._rodentBase(fur, { sx: 0.95, sy: 1.25, sz: 0.95, bodyR: 0.3, ears: 'tuft', tail: 'bushy', eye: 0xffe14a, eyeGlow: true, teethColor: 0xffffff });
            const cup = this._mat(0xf0ece0, 1.0, 0.4);
            const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.12, 10), cup); mug.position.set(0, 0.7, 0.34); this._deco(mug);
            const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), this._mat(0x2a1608, 1.0, 0.3)); coffee.position.set(0, 0.77, 0.34); this._deco(coffee);
        }
        // ── Squirrel: nimble tree-rodent clutching a nut, big bushy tail ─────
        _buildWoodsquirrel(fur) {
            this._rodentBase(fur, { sx: 0.95, sy: 1.25, sz: 0.95, bodyR: 0.3, ears: 'tuft', tail: 'bushy', teethColor: 0xffd27a });
            const nut = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this._mat(0x6a4422, 1.0, 0.7)); nut.scale.y = 1.2; nut.position.set(0, 0.66, 0.34); this._deco(nut);
        }
        // ── Field Mouse: tiny, oversized round ears, long thin tail ──────────
        _buildFieldmouse(fur) {
            this._rodentBase(fur, { sx: 0.95, sy: 1.1, sz: 1.05, bodyR: 0.28, headR: 0.22, headY: 1.0, ears: 'big', teethLen: 0.07, tail: 'long' });
        }
        // ── Forest Rat: standard woodland rat, long tail (quadrupedal) ───────
        _buildForestrat(fur) {
            this._rodentBase(fur, { quad: true, sx: 1.0, sy: 1.05, sz: 1.2, bodyR: 0.32, tail: 'long' });
        }
        // ── Giant Rat: oversized vermin, prominent incisors (quadrupedal) ────
        _buildGiantrat(fur) {
            this._rodentBase(fur, { quad: true, sx: 1.15, sy: 1.05, sz: 1.3, bodyR: 0.4, headR: 0.3, teethLen: 0.14, teethColor: 0xf0e6b0, tail: 'long' });
        }
        // ── Sewer Rat: grimy scavenger with filth clumps on its back ─────────
        _buildSewerrat(fur) {
            this._rodentBase(fur, { quad: true, sx: 1.0, sy: 1.0, sz: 1.25, bodyR: 0.32, tail: 'long' });
            const muck = this._mat(0x2e2a1c, 1.0, 0.95);
            for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.06 + this.idRand() * 0.03, 7, 6), muck); c.position.set(-0.12 + (i % 2) * 0.24, this._backY(), 0.42 - i * 0.2); this._deco(c); }
        }
        // ── Swamp Rat: buff, bristled marsh rodent ───────────────────────────
        _buildSwamprat(fur) {
            const p = this.profile;
            this._rodentBase(fur, { quad: true, sx: 1.25, sy: 1.1, sz: 1.25, bodyR: 0.37, headR: 0.28, teethColor: 0xc8d27a, tail: 'long' });
            const bristle = this._mat(p.accent, 1.0, 0.5);
            for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.2, 4), bristle); b.position.set(-0.15 + (i % 4) * 0.1, this._backY(), 0.42 - Math.floor(i / 4) * 0.3); b.rotation.x = -0.5; this._deco(b); }
        }
        // ── Plaguebro Rattus: bloated sewer king, crown, sickly pustules ─────
        _buildPlaguerattus(fur) {
            const p = this.profile;
            this._rodentBase(fur, { quad: true, sx: 1.4, sy: 1.3, sz: 1.4, bodyR: 0.44, headR: 0.32, teethLen: 0.15, teethColor: 0xc8d27a, tail: 'long' });
            const pus = this._mat(p.accent, 0.92, 0.4, p.accent);
            for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.06 + this.idRand() * 0.04, 8, 8), pus); b.position.set(-0.22 + (i % 3) * 0.22, this._backY() - 0.04, 0.34 - Math.floor(i / 3) * 0.42); this._deco(b); }
            const gold = this._mat(0xd8b23a, 1.0, 0.3, 0x4a3a08);
            const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), gold); band.rotation.x = Math.PI / 2; band.position.set(0, 0.34, 0);
            this.head.add(band);
            for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 5), gold); const a = (i / 5) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2); band.add(sp); }
        }
        // ── Rat King: tangle of rats fused at the tails into one mass ────────
        _buildRatking(fur) {
            const p = this.profile;
            this._rodentBase(fur, { quad: true, sx: 1.5, sy: 1.2, sz: 1.5, bodyR: 0.44, headR: 0.28, teethLen: 0.13, tail: 'long' });
            // Extra rat heads sprouting from the tangled mass.
            this._extraHeads = [];
            const offs = this._quad
                ? [[-0.38, 0.66, 0.2, -0.6], [0.4, 0.7, -0.05, 0.6], [-0.05, 0.92, -0.35, Math.PI]]
                : [[-0.34, 1.0, 0.18, -0.5], [0.36, 1.04, 0.1, 0.6], [-0.12, 1.32, -0.16, 0.0]];
            for (const [x, y, z, ry] of offs) {
                const h = new THREE.Group();
                h.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur));
                const mz = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), fur); mz.position.set(0, -0.05, 0.15); h.add(mz);
                for (const ex of [-0.14, 0.14]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), fur); e.position.set(ex, 0.17, 0); e.scale.set(1, 1, 0.3); h.add(e); }
                this._eye(h, -0.09, 0.04, 0.16, 0.04, p.accent, true); this._eye(h, 0.09, 0.04, 0.16, 0.04, p.accent, true);
                h.position.set(x, y, z); h.rotation.y = ry; this._deco(h); this._extraHeads.push(h);
            }
            // Knotted extra tails trailing behind.
            for (const tx of [-0.18, 0.18]) { const tl = this._tail(fur, this._quad ? 0.5 : 0.56, this._quad ? -0.7 : -0.32, 5, 0.85, this._quad ? -0.1 : 0.7); tl.position.x = tx; tl.rotation.z = tx > 0 ? -0.4 : 0.4; if (this._cascadeRules && this._cascadeRules[0]) this._cascadeRules[0].hide.push(tl); }
        }
        // ── Frost Raccoon: ringed tail, mask, icicle teeth (quadrupedal) ─────
        _buildFrostraccoon(fur) {
            const p = this.profile;
            this._rodentBase(fur, { quad: true, sx: 1.1, sy: 1.05, sz: 1.2, bodyR: 0.34, headR: 0.28, teeth: false, tail: 'long' });
            // Bandit mask band across the eyes.
            const mask = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.18), this._mat(0x222831, 1.0, 0.5)); mask.position.set(0, 0.06, 0.18); this.head.add(mask);
            // Icicle teeth.
            const ice = this._mat(p.accent, 0.85, 0.2, p.accent);
            for (const ix of [-0.06, 0.06]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 5), ice); t.position.set(ix, -0.18, 0.27); t.rotation.x = Math.PI; this.head.add(t); }
            // Ringed tail banding.
            if (this.tail) this.tail.children.forEach((s, i) => { if (i % 2 === 1) s.material = this._mat(0x2a3038, 1.0, 0.7); });
        }
        // ── Night Raccoon: dark bandit-masked moonlight scavenger (quad) ─────
        _buildNightraccoon(fur) {
            this._rodentBase(fur, { quad: true, sx: 1.1, sy: 1.05, sz: 1.2, bodyR: 0.34, headR: 0.28, eye: 0xffe14a, eyeGlow: true, teethColor: 0xf0e6c0, tail: 'long' });
            const mask = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.18), this._mat(0x14161c, 1.0, 0.5)); mask.position.set(0, 0.06, 0.18); this.head.add(mask);
            if (this.tail) this.tail.children.forEach((s, i) => { if (i % 2 === 1) s.material = this._mat(0xe8e8ee, 1.0, 0.7); });
        }
        // ── Mole: near-blind burrower, pink snout, broad digging claws ───────
        _buildMolerodent(fur) {
            const p = this.profile;
            this._rodentBase(fur, { sx: 1.0, sy: 0.95, sz: 1.3, bodyR: 0.32, headR: 0.24, headY: 0.96, ears: 'none', teeth: false, nose: p.accent, eye: 0x2a1410, tail: 'stub' });
            // Pink star snout.
            const snout = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this._mat(p.accent, 1.0, 0.4)); snout.scale.z = 0.6; snout.position.set(0, -0.04, 0.28); this.head.add(snout);
            this._digClaws(0.78);
        }
        // ── Tunneling Mole: bigger feral digger that bursts from below ───────
        _buildTunnelingmole(fur) {
            const p = this.profile;
            this._rodentBase(fur, { sx: 1.15, sy: 1.0, sz: 1.4, bodyR: 0.4, headR: 0.3, headY: 1.0, ears: 'none', teethLen: 0.13, nose: p.accent, eye: 0x2a1410, tail: 'stub' });
            const snout = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), this._mat(p.accent, 1.0, 0.4)); snout.scale.z = 0.6; snout.position.set(0, -0.05, 0.32); this.head.add(snout);
            this._digClaws(0.92);
            // Dirt mound kicked up around the base.
            const dirt = this._mat(0x4a3c2c, 1.0, 1.0);
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), dirt); c.scale.y = 0.4; c.position.set(Math.cos(a) * 0.4, 0.06, Math.sin(a) * 0.4); this._deco(c); }
        }
        // Big flat fan claws replacing the front paws (mole diggers).
        _digClaws(yPos) {
            const claw = this._mat(0xe8dcc0, 1.0, 0.4);
            for (const x of [-0.18, 0.18]) {
                const hand = new THREE.Group();
                for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 5), claw); c.position.set((i - 1) * 0.06, 0, 0.06); c.rotation.x = Math.PI / 2 + 0.3; hand.add(c); }
                hand.position.set(x, yPos - 0.2, 0.28); this._deco(hand);
            }
        }
        // ── Ice Lemming: round suicidal critter, ice shards, glowing core ────
        _buildIcelemming(fur) {
            const p = this.profile;
            this._rodentBase(fur, { sx: 1.05, sy: 1.0, sz: 1.0, bodyR: 0.34, headR: 0.24, ears: 'round', teethLen: 0.07, eye: 0x66ccff, eyeGlow: true, tail: 'stub' });
            const ice = this._mat(p.accent, 0.8, 0.15, p.accent);
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2, r = 0.34;
                const sh = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 4), ice);
                const dx = Math.cos(a) * r, dz = Math.sin(a) * r - 0.04, dy = 0.66 + (i % 2) * 0.16;
                sh.position.set(dx, dy, dz); sh.lookAt(dx * 3, dy, dz * 3); sh.rotateX(Math.PI / 2); this._deco(sh);
            }
        }

        // ── Ungulate: tall grazer with hooves and horns OR antlers ───────────
        _buildUngulate(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.0, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); chest.position.z = 0.45; this.body.add(chest);
            this.body.position.set(0, 1.15, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 10), fur); neck.rotation.x = 0.4; neck.position.set(0, 0.2, 0.0); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), fur); skull.scale.set(0.85, 0.9, 1.25); skull.position.set(0, 0.5, 0.18); this.head.add(skull);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.46, 0.38); this.head.add(muzzle);
            for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), fur); ear.position.set(ex, 0.62, 0.05); ear.rotation.z = ex > 0 ? -0.5 : 0.5; this.head.add(ear); }
            const boneMat = this._mat(0xe8dcc0, 1.0, 0.5);
            if (this.idRand() < 0.5) { // curved horns
                for (const hx of [-0.1, 0.1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI * 1.1), boneMat); h.position.set(hx, 0.66, 0.08); h.rotation.set(0.4, hx > 0 ? -0.4 : 0.4, hx > 0 ? 0.6 : -0.6); this.head.add(h); }
            } else { // branching antlers
                for (const ax of [-0.1, 0.1]) {
                    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.42, 6), boneMat); beam.position.set(ax, 0.78, 0.04); beam.rotation.z = ax > 0 ? -0.4 : 0.4; this.head.add(beam);
                    for (let t = 0; t < 2; t++) { const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.2, 5), boneMat); tine.position.set(ax + (ax > 0 ? 0.1 : -0.1) * (t + 1), 0.84 + t * 0.1, 0.04); tine.rotation.z = ax > 0 ? -1.0 : 1.0; this.head.add(tine); }
                }
            }
            this._eye(this.head, -0.1, 0.5, 0.28, 0.04, 0x120c08, false);
            this._eye(this.head, 0.1, 0.5, 0.28, 0.04, 0x120c08, false);
            this.head.position.set(0, 1.25, 0.5); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.22, 0.42, 1.05, 1.1, 'hoof');
            this.frontRight = this._leg(fur, 0.22, 0.42, 1.05, 1.1, 'hoof');
            this.rearLeft   = this._leg(fur, -0.22, -0.44, 1.05, 1.1, 'hoof');
            this.rearRight  = this._leg(fur, 0.22, -0.44, 1.05, 1.1, 'hoof');
            this.tail = this._tail(fur, 1.18, -0.6, 3, 0.7, -0.5);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Ape: upright primate with long knuckling arms ────────────────────
        _buildApe(fur) {
            const p = this.profile;
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 12), fur); this.body.scale.set(1.0, 1.2, 0.85); this.body.position.set(0, 1.15, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), fur));
            const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), this._mat(p.accent, 1.0, 0.6)); face.scale.set(1, 1.1, 0.6); face.position.set(0, -0.04, 0.18); this.head.add(face);
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), fur); brow.position.set(0, 0.08, 0.22); this.head.add(brow);
            this._eye(this.head, -0.08, 0.0, 0.23, 0.04, 0x120c08, false);
            this._eye(this.head, 0.08, 0.0, 0.23, 0.04, 0x120c08, false);
            this.head.position.set(0, 1.85, 0.05); this.bodyGroup.add(this.head);

            this.leftArm = this._apeArm(fur, -1);
            this.rightArm = this._apeArm(fur, 1);
            this.leftLeg = this._apeLeg(fur, -0.22);
            this.rightLeg = this._apeLeg(fur, 0.22);
            this._wireBiped({ body: this.body, head: this.head, la: this.leftArm, ra: this.rightArm, ll: this.leftLeg, rl: this.rightLeg });
        }
        _apeArm(mat, side) {
            const g = new THREE.Group();
            const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.6, 8), mat); upper.position.y = -0.3; g.add(upper);
            const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.55, 8), mat); fore.position.y = -0.82; g.add(fore);
            const fist = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), mat); fist.position.y = -1.1; g.add(fist);
            g.position.set(side * 0.5, 1.5, 0.05); g.rotation.z = side * 0.12; g._side = side; this.bodyGroup.add(g); return g;
        }
        _apeLeg(mat, x) {
            const g = new THREE.Group();
            const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.5, 8), mat); thigh.position.y = -0.25; g.add(thigh);
            const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.4, 8), mat); shin.position.y = -0.65; g.add(shin);
            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), mat); foot.position.set(0, -0.88, 0.06); g.add(foot);
            g.position.set(x, 0.78, 0); this.bodyGroup.add(g); return g;
        }

        //=====================================================================
        // BESPOKE SPLITS: parametrised cores reused across similar members.
        //=====================================================================

        // ── Canid core: lean dog body. Options control the silhouette ────────
        //   sizeBody · slope (rump lower than shoulders) · ear ('prick'|'round'|'bat')
        //   tail ('bush'|'plume'|'thin') · hackles (spine cones) · eyeGlow · legLen
        _canidBase(fur, o) {
            o = o || {};
            const p = this.profile;
            const b = o.sizeBody || 1.0;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * b, 0.24 * b, 1.05 * b, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.28 * b, 12, 12), fur); chest.position.set(0, (o.slope || 0) * 0.12, 0.48 * b); this.body.add(chest);
            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.25 * b, 12, 12), fur); rump.position.set(0, -(o.slope || 0) * 0.1, -0.52 * b); this.body.add(rump);
            if (o.hackles) for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 5), o.hackleMat || fur); sp.position.set(0, 0.26 * b, 0.4 - i * 0.2); this.body.add(sp); }
            this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * b, 0.2 * b, 0.4, 10), fur); neck.rotation.x = 0.7; neck.position.set(0, 0.02, -0.06); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2 * b, 12, 12), fur); skull.scale.set(0.9, 0.85, 1.1); skull.position.set(0, 0.24, 0.18); this.head.add(skull);
            const snoutLen = o.snout || 0.42;
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1 * b, snoutLen, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.2, 0.44); this.head.add(snout);
            const ear = o.ear || 'prick';
            for (const ex of [-0.1, 0.1]) {
                let e;
                if (ear === 'round') { e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), fur); e.scale.z = 0.4; }
                else if (ear === 'bat') { e = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 5), fur); }
                else { e = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), fur); }
                e.position.set(ex, 0.46, 0.08); this.head.add(e);
            }
            this._eye(this.head, -0.1, 0.27, 0.3, 0.045, p.accent, o.eyeGlow !== false);
            this._eye(this.head, 0.1, 0.27, 0.3, 0.045, p.accent, o.eyeGlow !== false);
            this.head.position.set(0, 1.2, 0.55); this.bodyGroup.add(this.head);

            const len = o.legLen || 1.0;
            this.frontLeft  = this._leg(fur, -0.2, 0.4, 0.96, len, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.4, 0.96, len, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.42, 0.96, len, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.42, 0.96, len, 'pad');
            const tt = o.tail || 'bush';
            if (tt === 'bush') this.tail = this._tail(fur, 1.06, -0.68, 5, 0.9, -0.5);
            else if (tt === 'plume') this.tail = this._tail(fur, 1.1, -0.68, 6, 0.92, -0.9);
            else this.tail = this._tail(fur, 1.02, -0.66, 4, 0.8, -0.3);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Feline core: sleek cat body with long curling tail ───────────────
        //   sizeBody · mane · fangs (saber) · ear ('tuft'|'round') · eyeGlow
        _felineBase(fur, o) {
            o = o || {};
            const p = this.profile;
            const b = o.sizeBody || 1.0;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * b, 0.24 * b, 1.15 * b, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.3 * b, 12, 12), fur); haunch.position.set(0, 0.06, -0.5 * b); this.body.add(haunch);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24 * b, 12, 12), fur); chest.position.z = 0.5 * b; this.body.add(chest);
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2 * b, 12, 12), fur));
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.05, 0.2); this.head.add(muzzle);
            const er = o.ear === 'round' ? 0.07 : 0.08, eh = o.ear === 'round' ? 0.1 : 0.14;
            for (const ex of [-0.13, 0.13]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(er, eh, 6), fur); ear.position.set(ex, 0.2, 0); this.head.add(ear); if (o.ear === 'tuft') { const t = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 4), fur); t.position.set(ex, 0.3, 0); this.head.add(t); } }
            if (o.fangs) { const fm = this._mat(o.fangColor || 0xfff4dc, 1.0, 0.3); for (const fx of [-0.07, 0.07]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.03, o.fangs, 6), fm); f.position.set(fx, -0.16, 0.24); f.rotation.x = Math.PI; this.head.add(f); } }
            if (o.mane) for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), o.maneMat || this._mat(p.accent, 1.0, 0.7)); sp.position.set(Math.cos(a) * 0.28, 0.02 + Math.sin(a) * 0.28, -0.12); sp.rotation.set(0, 0, -a + Math.PI / 2); this.head.add(sp); }
            this._eye(this.head, -0.1, 0.04, 0.17, 0.045, p.accent, o.eyeGlow !== false);
            this._eye(this.head, 0.1, 0.04, 0.17, 0.045, p.accent, o.eyeGlow !== false);
            this.head.position.set(0, 1.02, 0.6); this.bodyGroup.add(this.head);

            const len = o.legLen || 0.85;
            this.frontLeft  = this._leg(fur, -0.2, 0.42, 0.82, len, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.42, 0.82, len, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.44, 0.82, len, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.44, 0.82, len, 'pad');
            this.tail = this._felineTail(fur, 0.98, -0.62 * b - 0.06, 7, 0.9);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Ungulate core: tall hooved grazer. horns ('curved'|'antler'|'straight'|'ram'|'none') ─
        _ungulateBase(fur, o) {
            o = o || {};
            const p = this.profile;
            const b = o.sizeBody || 1.0;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * b, 0.28 * b, 1.0 * b, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3 * b, 12, 12), fur); chest.position.z = 0.45 * b; this.body.add(chest);
            if (o.hump) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.32 * b, 12, 12), fur); h.position.set(0, 0.24 * b, -0.05); this.body.add(h); }
            this.body.position.set(0, 1.15, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 10), fur); neck.rotation.x = 0.4; neck.position.set(0, 0.2, 0.0); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18 * b, 12, 12), fur); skull.scale.set(0.85, 0.9, 1.25); skull.position.set(0, 0.5, 0.18); this.head.add(skull);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.46, 0.38); this.head.add(muzzle);
            for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), fur); ear.position.set(ex, 0.62, 0.05); ear.rotation.z = ex > 0 ? -0.5 : 0.5; this.head.add(ear); }
            const boneMat = o.hornMat || this._mat(0xe8dcc0, 1.0, 0.5);
            const horn = o.horns || 'curved';
            if (horn === 'antler') {
                for (const ax of [-0.1, 0.1]) {
                    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.42, 6), boneMat); beam.position.set(ax, 0.78, 0.04); beam.rotation.z = ax > 0 ? -0.4 : 0.4; this.head.add(beam);
                    for (let t = 0; t < 2; t++) { const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.2, 5), boneMat); tine.position.set(ax + (ax > 0 ? 0.1 : -0.1) * (t + 1), 0.84 + t * 0.1, 0.04); tine.rotation.z = ax > 0 ? -1.0 : 1.0; this.head.add(tine); }
                }
            } else if (horn === 'straight') { // rhino / titanothere nose horn
                const h = new THREE.Mesh(new THREE.ConeGeometry(0.08 * b, 0.4 * b, 8), boneMat); h.position.set(0, 0.5, 0.5); h.rotation.x = -0.6; this.head.add(h);
                const h2 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 8), boneMat); h2.position.set(0, 0.58, 0.34); h2.rotation.x = -0.7; this.head.add(h2);
            } else if (horn === 'ram') { // heavy spiral goat horns curling back
                for (const hx of [-0.11, 0.11]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 14, Math.PI * 1.5), boneMat); h.position.set(hx, 0.62, 0.0); h.rotation.set(1.4, hx > 0 ? -0.3 : 0.3, hx > 0 ? -0.4 : 0.4); this.head.add(h); }
            } else if (horn === 'bull') { // sideways bull horns sweeping up
                for (const hx of [-0.14, 0.14]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 7), boneMat); h.position.set(hx, 0.58, 0.02); h.rotation.z = hx > 0 ? -1.1 : 1.1; h.rotation.x = -0.2; this.head.add(h); }
            } else if (horn !== 'none') { // curved
                for (const hx of [-0.1, 0.1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI * 1.1), boneMat); h.position.set(hx, 0.66, 0.08); h.rotation.set(0.4, hx > 0 ? -0.4 : 0.4, hx > 0 ? 0.6 : -0.6); this.head.add(h); }
            }
            this._eye(this.head, -0.1, 0.5, 0.28, 0.04, o.eye || 0x120c08, !!o.eyeGlow);
            this._eye(this.head, 0.1, 0.5, 0.28, 0.04, o.eye || 0x120c08, !!o.eyeGlow);
            this.head.position.set(0, 1.25, 0.5); this.bodyGroup.add(this.head);

            const len = o.legLen || 1.1;
            this.frontLeft  = this._leg(fur, -0.22, 0.42, 1.05, len, 'hoof');
            this.frontRight = this._leg(fur, 0.22, 0.42, 1.05, len, 'hoof');
            this.rearLeft   = this._leg(fur, -0.22, -0.44, 1.05, len, 'hoof');
            this.rearRight  = this._leg(fur, 0.22, -0.44, 1.05, len, 'hoof');
            this.tail = this._tail(fur, 1.18, -0.6, 3, 0.7, -0.5);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Ursine core: bulky bear on short legs. ears ('round'|'horn'|'owl') ─
        _ursineBase(fur, o) {
            o = o || {};
            const p = this.profile;
            const b = o.sizeBody || 1.0;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5 * b, 14, 12), fur); torso.scale.set(1.0, 0.95, 1.55); this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.46 * b, 12, 12), fur); shoulders.position.set(0, 0.14 * b, 0.45); this.body.add(shoulders);
            this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.3 * b, 14, 12), fur));
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.28, 10), o.snoutMat || fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.05, 0.3); this.head.add(snout);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(o.noseColor || 0x140d0a, 1.0, 0.4)); nose.position.set(0, -0.03, 0.46); this.head.add(nose);
            const eartype = o.ear || 'round';
            if (eartype === 'owl') { for (const ex of [-0.18, 0.18]) { const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 5), fur); tuft.position.set(ex, 0.34, -0.02); tuft.rotation.z = ex > 0 ? -0.3 : 0.3; this.head.add(tuft); } }
            else for (const ex of [-0.2, 0.2]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), o.earMat || fur); ear.position.set(ex, 0.28, -0.02); ear.scale.z = 0.5; this.head.add(ear); }
            if (eartype === 'horn') { const hm = o.hornMat || this._mat(o.accent2 || 0xe8dcc0, 1.0, 0.5); for (const hx of [-0.16, 0.16]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), hm); h.position.set(hx, 0.4, 0.02); h.rotation.z = hx > 0 ? -0.5 : 0.5; this.head.add(h); } }
            this._eye(this.head, -0.13, 0.07, 0.24, 0.05, p.accent, !!o.eyeGlow);
            this._eye(this.head, 0.13, 0.07, 0.24, 0.05, p.accent, !!o.eyeGlow);
            this.head.position.set(0, 1.46, 0.6); this.bodyGroup.add(this.head);

            const paw = o.clawMat ? 'paw' : 'paw';
            this.frontLeft  = this._leg(fur, -0.32, 0.42, 0.92, 0.95, paw);
            this.frontRight = this._leg(fur, 0.32, 0.42, 0.92, 0.95, paw);
            this.rearLeft   = this._leg(fur, -0.32, -0.42, 0.92, 0.95, paw);
            this.rearRight  = this._leg(fur, 0.32, -0.42, 0.92, 0.95, paw);
            this.tail = this._nub(fur, 0, 1.0, -0.74, 0.09);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Suid core: low hunched boar/pig. tusks · bristles · wings · disc snout ─
        _suidBase(fur, o) {
            o = o || {};
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), fur); torso.scale.set(1.0, 0.85, 1.55); this.body.add(torso);
            if (o.hump !== false) { const hump = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), fur); hump.position.set(0, 0.2, 0.4); this.body.add(hump); }
            if (o.bristles) for (let i = 0; i < 6; i++) { const bl = new THREE.Mesh(new THREE.ConeGeometry(0.04, o.bristleLen || 0.22, 4), o.bristleMat || this._mat(0x140d0a, 1.0, 0.9)); bl.position.set(0, 0.28, 0.45 - i * 0.17); this.body.add(bl); }
            this.body.position.set(0, 0.9, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); skull.scale.set(0.9, 0.9, 1.2); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.3, 10), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.06, 0.28); this.head.add(snout);
            const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10), this._mat(o.discColor || 0x3a2a22, 1.0, 0.5)); disc.rotation.x = Math.PI / 2; disc.position.set(0, -0.06, 0.44); this.head.add(disc);
            if (o.tusks !== false) { const tuskMat = this._mat(0xe8dcc0, 1.0, 0.4); for (const tx of [-0.1, 0.1]) { const tk = new THREE.Mesh(new THREE.ConeGeometry(0.035, o.tuskLen || 0.26, 6), tuskMat); tk.position.set(tx, -0.1, 0.36); tk.rotation.set(-0.7, 0, tx > 0 ? 0.3 : -0.3); this.head.add(tk); } }
            for (const ex of [-0.16, 0.16]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), fur); ear.position.set(ex, 0.22, 0); this.head.add(ear); }
            this._eye(this.head, -0.13, 0.06, 0.18, 0.04, p.accent, !!o.eyeGlow);
            this._eye(this.head, 0.13, 0.06, 0.18, 0.04, p.accent, !!o.eyeGlow);
            this.head.position.set(0, 0.92, 0.62); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.26, 0.38, 0.78, 0.78, 'hoof');
            this.frontRight = this._leg(fur, 0.26, 0.38, 0.78, 0.78, 'hoof');
            this.rearLeft   = this._leg(fur, -0.26, -0.4, 0.78, 0.78, 'hoof');
            this.rearRight  = this._leg(fur, 0.26, -0.4, 0.78, 0.78, 'hoof');
            this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), fur); this.tail.position.set(0, 0.9, -0.62); this.bodyGroup.add(this.tail);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
            if (o.wings) { this._wings = []; const wm = this._mat(o.wingColor || 0xffffff, 0.9, 0.6); for (const sgn of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.34), wm); w.position.set(sgn * 0.42, 1.15, 0.05); w.rotation.z = sgn * 0.3; this._deco(w); this._wings.push(w); } }
        }

        // ── Primate core: upright ape. arms/legs from ape helpers, sizeBody ──
        _primateBase(fur, o) {
            o = o || {};
            const p = this.profile;
            const b = o.sizeBody || 1.0;
            this.body = new THREE.Mesh(new THREE.SphereGeometry(0.45 * b, 14, 12), fur); this.body.scale.set(1.0, 1.2, 0.85); this.body.position.set(0, 1.15, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.26 * b, 14, 12), fur));
            const face = new THREE.Mesh(new THREE.SphereGeometry(0.18 * b, 12, 12), this._mat(p.accent, 1.0, 0.6)); face.scale.set(1, 1.1, 0.6); face.position.set(0, -0.04, 0.18); this.head.add(face);
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), fur); brow.position.set(0, 0.08, 0.22); this.head.add(brow);
            if (o.ears) for (const ex of [-0.28 * b, 0.28 * b]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), this._mat(p.accent, 1.0, 0.6)); ear.position.set(ex, 0.0, 0.02); ear.scale.z = 0.4; this.head.add(ear); }
            this._eye(this.head, -0.08, 0.0, 0.23, 0.04, o.eye || 0x120c08, !!o.eyeGlow);
            this._eye(this.head, 0.08, 0.0, 0.23, 0.04, o.eye || 0x120c08, !!o.eyeGlow);
            this.head.position.set(0, 1.85, 0.05); this.bodyGroup.add(this.head);

            this.leftArm = this._apeArm(fur, -1);
            this.rightArm = this._apeArm(fur, 1);
            this.leftLeg = this._apeLeg(fur, -0.22);
            this.rightLeg = this._apeLeg(fur, 0.22);
            this._wireBiped({ body: this.body, head: this.head, la: this.leftArm, ra: this.rightArm, ll: this.leftLeg, rl: this.rightLeg });
        }

        //=====================================================================
        // BESPOKE CANIDS
        //=====================================================================
        _buildBstArcticfox(fur)        { this._canidBase(fur, { sizeBody: 0.82, ear: 'prick', tail: 'bush', eyeGlow: false, legLen: 0.9, snout: 0.34 }); }
        _buildBstCottonfox(fur)        { this._canidBase(fur, { sizeBody: 0.86, ear: 'round', tail: 'bush', eyeGlow: false, legLen: 0.9, snout: 0.34 });
            // sticky sugar-web wisps on the tail.
            const web = this._mat(this.profile.accent, 0.5, 0.3); for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), web); s.position.set(-0.1 + i * 0.07, 0.9, -0.9); this._deco(s); } }
        _buildBstIcewolfpup(fur)       { this._canidBase(fur, { sizeBody: 0.78, ear: 'prick', tail: 'bush', legLen: 0.82, snout: 0.3 });
            const ice = this._mat(this.profile.accent, 0.7, 0.15, this.profile.accent); const brk = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), ice); brk.position.set(0, 1.4, 1.02); this._deco(brk); }
        _buildBstRabidhyena(fur)       { this._canidBase(fur, { sizeBody: 1.05, slope: 1.0, ear: 'round', tail: 'thin', eyeGlow: true, legLen: 1.0, snout: 0.36, hackles: true, hackleMat: this._mat(0x3a3226, 1.0, 0.9) }); }
        _buildBstFeralhyenapack(fur)   { this._canidBase(fur, { sizeBody: 1.0, slope: 1.0, ear: 'round', tail: 'thin', eyeGlow: true, legLen: 1.0, snout: 0.36, hackles: true, hackleMat: this._mat(0x2e2820, 1.0, 0.9) }); }
        _buildBstGraywolf(fur)         { this._canidBase(fur, { sizeBody: 1.0, ear: 'prick', tail: 'bush', hackles: true }); }
        _buildBstManedterrorwolf(fur)  { this._canidBase(fur, { sizeBody: 1.1, ear: 'prick', tail: 'bush', eyeGlow: true, legLen: 1.05 });
            // Mane of razor quills around the neck.
            const quill = this._mat(this.profile.accent, 1.0, 0.4); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const q = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.34, 4), quill); q.position.set(Math.cos(a) * 0.26, 1.2 + Math.sin(a) * 0.26, 0.42); q.rotation.set(0, 0, -a + Math.PI / 2); this._deco(q); } }
        _buildBstRedfox(fur)           { this._canidBase(fur, { sizeBody: 0.84, ear: 'prick', tail: 'plume', eyeGlow: false, legLen: 0.9, snout: 0.36 });
            // White tail tip.
            if (this.tail && this.tail.children.length) { const tip = this.tail.children[this.tail.children.length - 1]; tip.material = this._mat(0xf0ece0, 1.0, 0.8); } }
        _buildBstAlphadirewolf(fur)    { this._canidBase(fur, { sizeBody: 1.25, ear: 'prick', tail: 'plume', eyeGlow: true, legLen: 1.15, snout: 0.46, hackles: true, hackleMat: this._mat(0xaac4d8, 1.0, 0.5) }); }
        _buildBstAlphawarg(fur)        { this._canidBase(fur, { sizeBody: 1.2, ear: 'prick', tail: 'bush', eyeGlow: true, legLen: 1.12, snout: 0.46, hackles: true }); }
        _buildBstArcticwolf(fur)       { this._canidBase(fur, { sizeBody: 1.05, ear: 'prick', tail: 'plume', eyeGlow: true, legLen: 1.05, hackles: true, hackleMat: this._mat(0xd8e4ee, 1.0, 0.6) }); }
        _buildBstRabidcoyote(fur)      { this._canidBase(fur, { sizeBody: 0.92, ear: 'bat', tail: 'thin', eyeGlow: true, legLen: 1.02, snout: 0.44 }); }
        _buildBstScavengingcoyote(fur) { this._canidBase(fur, { sizeBody: 0.9, ear: 'bat', tail: 'thin', eyeGlow: true, legLen: 1.02, snout: 0.44 }); }

        //=====================================================================
        // BESPOKE FELINES
        //=====================================================================
        _buildBstLazycat(fur)          { this._felineBase(fur, { sizeBody: 0.7, ear: 'round', eyeGlow: false, legLen: 0.7 }); }
        _buildBstBlackpanther(fur)     { this._felineBase(fur, { sizeBody: 1.0, eyeGlow: true, legLen: 0.9 }); }
        _buildBstReflectivetiger(fur)  { this._felineBase(fur, { sizeBody: 1.0, eyeGlow: false, legLen: 0.88 });
            // Snow-glint stripes.
            const st = this._mat(this.profile.accent, 1.0, 0.4); for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.05), st); s.position.set(0, 1.06, 0.3 - i * 0.18); this._deco(s); } }
        _buildBstSabercat(fur)         { this._felineBase(fur, { sizeBody: 1.05, fangs: 0.28, ear: 'round', eyeGlow: true, legLen: 0.9 }); }
        _buildBstWildcat(fur)          { this._felineBase(fur, { sizeBody: 0.8, ear: 'tuft', eyeGlow: false, legLen: 0.78 }); }
        // Street tomcat: small, half-starved, one ear torn off in a fight and
        // a patchy coat of raised hackles down the spine.
        _buildBstFeralalleycat(fur)    { this._felineBase(fur, { sizeBody: 0.68, ear: 'tuft', eyeGlow: true, legLen: 0.72 });
            // Notch the left ear (first ear cone added to the head group).
            if (this.head) { const ear = this.head.children.find(c => c.geometry && c.geometry.type === 'ConeGeometry'); if (ear) { ear.scale.set(0.9, 0.55, 0.9); ear.rotation.z = -0.4; } }
            // Ribs showing through a scruffy coat, and bristling hackles.
            const scruff = this._mat(this.profile.bodyColor, 1.0, 0.95);
            for (let i = 0; i < 5; i++) { const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 4), scruff); tuft.position.set((i % 2 ? 0.03 : -0.03), 1.12, 0.26 - i * 0.14); tuft.rotation.x = -0.4; this._deco(tuft); }
            const rib = this._mat(this.profile.accent, 0.35, 0.8);
            for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.03), rib); r.position.set(0, 0.86, 0.28 - i * 0.12); this._deco(r); } }
        _buildBstGoldenlion(fur)       { this._felineBase(fur, { sizeBody: 1.1, mane: true, maneMat: this._mat(0x6a3a10, 1.0, 0.8), eyeGlow: false, legLen: 0.92 }); }
        _buildBstStripedtiger(fur)     { this._felineBase(fur, { sizeBody: 1.05, eyeGlow: false, legLen: 0.9 });
            const st = this._mat(this.profile.accent, 1.0, 0.6); for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.06), st); s.position.set(0, 1.06, 0.36 - i * 0.16); this._deco(s); } }
        _buildBstUmbrapanthera(fur)    { this._felineBase(fur, { sizeBody: 1.0, eyeGlow: true, legLen: 0.9 });
            // Wispy shadow trails off the raised tail tip.
            const sh = this._mat(this.profile.accent, 0.4, 0.2, this.profile.accent); for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.1 - i * 0.02, 8, 8), sh); s.position.set(0, 1.66 + i * 0.16, -0.72 - i * 0.04); this._deco(s); } }
        _buildBstMysticpanther(fur)    { this._felineBase(fur, { sizeBody: 1.0, eyeGlow: true, legLen: 0.9 });
            const glow = this._mat(this.profile.accent, 0.6, 0.3, this.profile.accent); for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 10), glow); r.position.set(-0.12 + i * 0.08, 1.05, 0.2 - i * 0.12); r.rotation.x = Math.PI / 2; this._deco(r); } }
        _buildBstSabertoothalpha(fur)  { this._felineBase(fur, { sizeBody: 1.15, fangs: 0.38, ear: 'tuft', eyeGlow: true, legLen: 0.95 }); }
        _buildBstDiresabertoothalpha(fur){ this._felineBase(fur, { sizeBody: 1.25, fangs: 0.44, ear: 'tuft', eyeGlow: true, legLen: 1.0, fangColor: 0xeaf4ff }); }

        //=====================================================================
        // BESPOKE UNGULATES
        //=====================================================================
        _buildBstThirstycamel(fur)     { this._ungulateBase(fur, { sizeBody: 1.05, horns: 'none', hump: true, legLen: 1.25 }); }
        _buildBstForeststag(fur)       { this._ungulateBase(fur, { sizeBody: 1.0, horns: 'antler', legLen: 1.15 }); }
        _buildBstPastoralsheep(fur)    { this._ungulateBase(fur, { sizeBody: 0.95, horns: 'ram', legLen: 0.9 });
            // Woolly fleece clumps over the body.
            const wool = this._mat(0xf4f0e6, 1.0, 0.95); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const c = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), wool); c.position.set(Math.cos(a) * 0.24, 1.15 + Math.sin(a) * 0.14, (i % 2 - 0.5) * 0.4); this._deco(c); } }
        _buildBstArmoredrhinoceros(fur){ this._ungulateBase(fur, { sizeBody: 1.2, horns: 'straight', legLen: 1.05, hornMat: this._mat(0xd8dce0, 1.0, 0.4) });
            // Armor plates on the back.
            const plate = this._mat(this.profile.accent, 1.0, 0.4); for (let i = 0; i < 3; i++) { const pl = new THREE.Mesh(new THREE.SphereGeometry(0.28 - i * 0.03, 10, 8), plate); pl.scale.set(1.2, 0.4, 0.9); pl.position.set(0, 1.4, 0.24 - i * 0.28); this._deco(pl); } }
        _buildBstBloodbellcow(fur)     { this._ungulateBase(fur, { sizeBody: 1.05, horns: 'bull', legLen: 1.1 });
            // Ominous brass bell under the neck.
            const bell = this._mat(this.profile.accent, 1.0, 0.3, 0x3a2c08); const bm = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.18, 10), bell); bm.position.set(0, 1.02, 0.55); this._deco(bm);
            const clap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), bell); clap.position.set(0, 0.9, 0.55); this._deco(clap); }
        _buildBstDeersprite(fur)       { this._ungulateBase(fur, { sizeBody: 0.85, horns: 'antler', legLen: 1.1, eye: 0xffaa22, eyeGlow: true, hornMat: this._mat(this.profile.accent, 1.0, 0.4, this.profile.accent) });
            // Flame flickers along the back.
            const fl = this._mat(this.profile.accent, 0.85, 0.4, this.profile.accent); for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 6), fl); f.position.set(0, 1.4, 0.24 - i * 0.2); this._deco(f); } }
        _buildBstHollowgoat(fur)       { this._ungulateBase(fur, { sizeBody: 0.95, horns: 'ram', legLen: 1.0, eye: 0x66ff88, eyeGlow: true });
            // Turtle-like shell over the torso.
            const shell = this._mat(this.profile.accent, 1.0, 0.6); const sh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell); sh.scale.set(1.1, 1.0, 1.3); sh.position.set(0, 1.2, -0.05); this._deco(sh); }
        _buildBstIronhoofcharger(fur)  { this._ungulateBase(fur, { sizeBody: 1.1, horns: 'bull', legLen: 1.1, hornMat: this._mat(this.profile.accent, 1.0, 0.35) });
            // Iron hoof glints (already hooves) plus a metal brow band.
            const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14), this._mat(this.profile.accent, 1.0, 0.3)); band.rotation.x = Math.PI / 2; band.position.set(0, 1.72, 0.6); this._deco(band); }
        _buildBstRancorousbull(fur)    { this._ungulateBase(fur, { sizeBody: 1.15, horns: 'bull', legLen: 1.1, hump: true }); }
        _buildBstTitanotherealpha(fur) { this._ungulateBase(fur, { sizeBody: 1.35, horns: 'straight', legLen: 1.2, hump: true, hornMat: this._mat(this.profile.accent, 1.0, 0.4) }); }

        //=====================================================================
        // BESPOKE URSIDS
        //=====================================================================
        _buildBstBrownbear(fur)        { this._ursineBase(fur, { sizeBody: 1.0, ear: 'round' }); }
        _buildBstHornedbear(fur)       { this._ursineBase(fur, { sizeBody: 1.05, ear: 'horn', eyeGlow: true, accent2: 0x2a1810, hornMat: this._mat(0x1a1210, 1.0, 0.5) }); }
        _buildBstYoungyeti(fur)        { this._ursineBase(fur, { sizeBody: 0.95, ear: 'round', noseColor: 0x445566, earMat: this._mat(0xd0dce8, 1.0, 0.9) });
            const ice = this._mat(this.profile.accent, 0.7, 0.15, this.profile.accent); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const sh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), ice); sh.position.set(Math.cos(a) * 0.4, 1.2, Math.sin(a) * 0.4); this._deco(sh); } }
        _buildBstFrostbackursid(fur)   { this._ursineBase(fur, { sizeBody: 1.05, ear: 'round', eyeGlow: true, noseColor: 0x335566 });
            const ice = this._mat(this.profile.accent, 0.75, 0.15, this.profile.accent); for (let i = 0; i < 6; i++) { const sh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 4), ice); sh.position.set(-0.16 + (i % 3) * 0.16, 1.34, 0.2 - Math.floor(i / 3) * 0.3); sh.rotation.x = -0.3; this._deco(sh); } }
        _buildBstPanda(fur)            { this._ursineBase(fur, { sizeBody: 1.0, ear: 'round', earMat: this._mat(0x141414, 1.0, 0.9) });
            // Black eye patches and limbs suggestion.
            const blk = this._mat(this.profile.accent, 1.0, 0.9); for (const ex of [-0.13, 0.13]) { const patch = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), blk); patch.scale.set(1, 1.3, 0.4); patch.position.set(ex, 1.5, 0.82); this._deco(patch); }
            const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 8, 16), blk); collar.rotation.x = Math.PI / 2; collar.position.set(0, 1.18, 0.1); this._deco(collar); }
        _buildBstPolarbear(fur)        { this._ursineBase(fur, { sizeBody: 1.1, ear: 'round', noseColor: 0x1a1a1a }); }
        _buildBstTimewornowlbear(fur)  { this._ursineBase(fur, { sizeBody: 1.05, ear: 'owl', eyeGlow: true, snoutMat: this._mat(0xd8c88a, 1.0, 0.4), noseColor: 0xc8a848 });
            // Barbed feathers across the shoulders.
            const feat = this._mat(0x8a7452, 1.0, 0.8); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI; const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 4), feat); f.position.set(Math.cos(a) * 0.4, 1.3, 0.3); f.rotation.set(-0.6, 0, Math.cos(a)); this._deco(f); } }
        _buildBstDemonbear(fur)        { this._ursineBase(fur, { sizeBody: 1.1, ear: 'horn', eyeGlow: true, hornMat: this._mat(this.profile.accent, 1.0, 0.4, this.profile.accent), noseColor: 0x1a0808 }); }
        _buildBstKodiakbear(fur)       { this._ursineBase(fur, { sizeBody: 1.1, ear: 'round' }); }
        _buildBstEmberclawbear(fur)    { this._ursineBase(fur, { sizeBody: 1.0, ear: 'round', eyeGlow: true, noseColor: 0x1a0804 });
            // Burning claws / fiery vents.
            const flame = this._mat(this.profile.accent, 0.9, 0.4, this.profile.accent); for (const x of [-0.32, 0.32]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), flame); f.position.set(x, 0.16, 0.5); this._deco(f); } }
        _buildBstFrostfangbear(fur)    { this._ursineBase(fur, { sizeBody: 1.05, ear: 'round', eyeGlow: true, noseColor: 0x335566 });
            const ice = this._mat(this.profile.accent, 0.8, 0.15, this.profile.accent); for (const fx of [-0.06, 0.06]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 5), ice); f.position.set(fx, 1.36, 0.86); f.rotation.x = Math.PI; this._deco(f); } }
        _buildBstThundermawursine(fur) { this._ursineBase(fur, { sizeBody: 1.05, ear: 'round', eyeGlow: true, noseColor: 0x33334a });
            const bolt = this._mat(this.profile.accent, 0.95, 0.4, this.profile.accent); for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.24, 4), bolt); b.position.set(-0.12 + i * 0.08, 1.36, 0.2 - (i % 2) * 0.2); b.rotation.z = (i % 2 ? 0.3 : -0.3); this._deco(b); } }
        _buildBstTitaniccavebear(fur)  { this._ursineBase(fur, { sizeBody: 1.25, ear: 'round' });
            const claw = this._mat(0xe8dcc0, 1.0, 0.4); for (const x of [-0.32, 0.32]) for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 5), claw); c.position.set(x + (i - 1) * 0.05, 0.02, 0.52); c.rotation.x = Math.PI / 2 + 0.2; this._deco(c); } }

        //=====================================================================
        // BESPOKE SUIDS
        //=====================================================================
        _buildBstDirepig(fur)          { this._suidBase(fur, { tusks: true, tuskLen: 0.34, bristles: true, eyeGlow: true }); }
        _buildBstFlyingpig(fur)        { this._suidBase(fur, { tusks: false, hump: false, wings: true, wingColor: 0xffffff }); }
        _buildBstRazorbackboar(fur)    { this._suidBase(fur, { tusks: true, tuskLen: 0.3, bristles: true, bristleLen: 0.32, bristleMat: this._mat(this.profile.accent, 1.0, 0.4) }); }
        _buildBstWildboar(fur)         { this._suidBase(fur, { tusks: true, bristles: true }); }
        _buildBstNormalpig(fur)        { this._suidBase(fur, { tusks: false, hump: false, bristles: false, discColor: this.profile.accent }); }
        _buildBstMadboar(fur)          { this._suidBase(fur, { tusks: true, tuskLen: 0.3, bristles: true, eyeGlow: true, bristleMat: this._mat(this.profile.accent, 1.0, 0.4, this.profile.accent) }); }

        //=====================================================================
        // BESPOKE PRIMATES
        //=====================================================================
        _buildBstMaleficentape(fur)    { this._primateBase(fur, { sizeBody: 1.15, eyeGlow: true, ears: true }); }
        _buildBstOrgangrindermonkey(fur){ this._primateBase(fur, { sizeBody: 0.78, ears: true });
            // A grim little organ box held in front.
            const box = this._mat(this.profile.accent, 1.0, 0.4); const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.16), box); b.position.set(0, 0.9, 0.4); this._deco(b);
            const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), this._mat(0x2a2018, 1.0, 0.5)); crank.rotation.z = Math.PI / 2; crank.position.set(0.18, 0.9, 0.4); this._deco(crank); }
        _buildBstTreemonkey(fur)       { this._primateBase(fur, { sizeBody: 0.78, ears: true });
            // A thrown object clutched in one fist.
            const rock = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), this._mat(0x5a5248, 1.0, 0.9)); rock.position.set(-0.5, 0.35, 0.1); this._deco(rock); }

        // ── Chromatic Manticore: lion body, rainbow mane + spiked tail ───────
        _buildChromaticmanticore(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 1.2, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); chest.position.z = 0.52; this.body.add(chest);
            this.body.position.set(0, 1.0, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur));
            const muzzle = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.04, 0.22); this.head.add(muzzle);
            // Chaotic rainbow mane ring.
            for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const c = new THREE.Color().setHSL((i / 14 + this.idRand()) % 1, 0.9, 0.55); const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 5), this._mat(c.getHex(), 1.0, 0.5, c.getHex())); sp.position.set(Math.cos(a) * 0.3, 0.04 + Math.sin(a) * 0.3, -0.12); sp.rotation.set(0, 0, -a + Math.PI / 2); this.head.add(sp); }
            this._eye(this.head, -0.1, 0.05, 0.2, 0.05, p.accent, true);
            this._eye(this.head, 0.1, 0.05, 0.2, 0.05, p.accent, true);
            this.head.position.set(0, 1.18, 0.62); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.22, 0.42, 0.86, 0.92, 'pad');
            this.frontRight = this._leg(fur, 0.22, 0.42, 0.86, 0.92, 'pad');
            this.rearLeft   = this._leg(fur, -0.22, -0.44, 0.86, 0.92, 'pad');
            this.rearRight  = this._leg(fur, 0.22, -0.44, 0.86, 0.92, 'pad');
            // Scorpion-like tail tipped with a glowing prismatic barb.
            this.tail = this._tail(fur, 1.0, -0.62, 6, 0.92, 1.0);
            const barb = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 6), this._mat(p.accent, 1.0, 0.4, p.accent)); barb.position.set(0, -0.62, 0.42); this.tail.add(barb);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Chupacabra: gaunt spined predator, fangs, hunched back ───────────
        _buildChupacabra(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.95, 10), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const ribs = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), fur); ribs.scale.set(1.1, 0.8, 1.0); ribs.position.z = 0.4; this.body.add(ribs);
            // Hunched dorsal spines.
            for (let i = 0; i < 7; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26 - i * 0.02, 5), this._mat(p.accent, 1.0, 0.5)); sp.position.set(0, 0.22 + Math.sin(i / 6 * Math.PI) * 0.12, 0.42 - i * 0.13); this.body.add(sp); }
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), fur); skull.scale.set(0.85, 0.8, 1.1); this.head.add(skull);
            const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 7), fur); jaw.rotation.x = Math.PI / 2; jaw.position.set(0, -0.05, 0.26); this.head.add(jaw);
            for (const fx of [-0.06, 0.06]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 5), this._mat(0xfff4d0, 1.0, 0.3)); f.position.set(fx, -0.13, 0.32); f.rotation.x = Math.PI; this.head.add(f); }
            for (const ex of [-0.12, 0.12]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), fur); ear.position.set(ex, 0.2, -0.02); this.head.add(ear); }
            this._eye(this.head, -0.09, 0.04, 0.16, 0.05, p.accent, true);
            this._eye(this.head, 0.09, 0.04, 0.16, 0.05, p.accent, true);
            this.head.position.set(0, 1.1, 0.56); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.18, 0.4, 0.92, 1.0, 'paw');
            this.frontRight = this._leg(fur, 0.18, 0.4, 0.92, 1.0, 'paw');
            this.rearLeft   = this._leg(fur, -0.18, -0.42, 0.86, 0.92, 'paw');
            this.rearRight  = this._leg(fur, 0.18, -0.42, 0.86, 0.92, 'paw');
            this.tail = this._tail(fur, 0.96, -0.56, 4, 0.78, 0.7);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Giant Snail: coiled spiral shell, eyestalks, no real legs ────────
        _buildGiantsnail(fur) {
            const p = this.profile;
            const fleshMat = this._mat(p.accent, 1.0, 0.85);
            this.body = new THREE.Group();
            // Slug foot.
            const foot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), fleshMat); foot.scale.set(0.9, 0.4, 1.7); this.body.add(foot);
            // Coiled spiral shell built from shrinking spheres.
            let sr = 0.42, sa = 0, sx = 0, sy = 0.35;
            for (let i = 0; i < 9; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(sr, 12, 12), fur); seg.position.set(sx, sy + Math.sin(sa) * 0.12, -0.1 + Math.cos(sa) * 0.25); this.body.add(seg); sa += 0.8; sr *= 0.84; sy += 0.05; }
            this.body.position.set(0, 0.55, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), fleshMat); neck.rotation.x = 1.0; neck.position.set(0, 0.0, 0.12); this.head.add(neck);
            const snout = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), fleshMat); snout.scale.set(1, 0.8, 1.3); snout.position.set(0, 0.18, 0.34); this.head.add(snout);
            // Two long retractable eyestalks.
            for (const sx2 of [-0.09, 0.09]) { const stk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), fleshMat); stk.position.set(sx2, 0.42, 0.36); stk.rotation.x = -0.3; this.head.add(stk); this._eye(this.head, sx2, 0.62, 0.42, 0.07, p.accent, true); }
            this.head.position.set(0, 0.55, 0.55); this.bodyGroup.add(this.head);

            // No legs: small slime-foot nubs along the underside.
            this.frontLeft  = this._nub(fleshMat, -0.18, 0.2, 0.4, 0.1);
            this.frontRight = this._nub(fleshMat, 0.18, 0.2, 0.4, 0.1);
            this.rearLeft   = this._nub(fleshMat, -0.18, 0.2, -0.4, 0.1);
            this.rearRight  = this._nub(fleshMat, 0.18, 0.2, -0.4, 0.1);
            this.tail = this._nub(fleshMat, 0, 0.2, -0.75, 0.14);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Infernal Cerberus: three-headed hellhound wreathed in flame ──────
        _buildInfernalcerberus(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 1.1, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 12), fur); shoulders.position.z = 0.5; this.body.add(shoulders);
            // Flame jets along the spine.
            for (let i = 0; i < 5; i++) { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), this._mat(p.accent, 0.9, 0.4, p.accent)); fl.position.set(0, 0.34, 0.42 - i * 0.21); this.body.add(fl); }
            this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);

            // Three heads on one neck group.
            this.head = new THREE.Group();
            for (const hx of [-0.32, 0, 0.32]) {
                const sub = new THREE.Group();
                const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur); skull.scale.set(0.9, 0.85, 1.1); sub.add(skull);
                const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 7), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.04, 0.28); sub.add(snout);
                const maw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(p.accent, 1.0, 0.4, p.accent)); maw.position.set(0, -0.04, 0.42); sub.add(maw);
                for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), fur); ear.position.set(ex, 0.22, -0.02); sub.add(ear); }
                this._eye(sub, -0.09, 0.05, 0.2, 0.04, p.accent, true);
                this._eye(sub, 0.09, 0.05, 0.2, 0.04, p.accent, true);
                sub.position.set(hx, 0, hx === 0 ? 0.06 : 0); sub.rotation.y = hx * 0.7; this.head.add(sub);
            }
            this.head.position.set(0, 1.28, 0.55); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.26, 0.42, 0.96, 1.0, 'paw');
            this.frontRight = this._leg(fur, 0.26, 0.42, 0.96, 1.0, 'paw');
            this.rearLeft   = this._leg(fur, -0.26, -0.44, 0.96, 1.0, 'paw');
            this.rearRight  = this._leg(fur, 0.26, -0.44, 0.96, 1.0, 'paw');
            this.tail = this._tail(this._mat(p.accent, 0.9, 0.4, p.accent), 1.06, -0.6, 5, 0.85, 0.6);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Jungle Predator: plant-beast hybrid, maw-pod head, thorned vines ─
        _buildJunglepredator(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), fur); bulb.scale.set(1.0, 0.95, 1.3); this.body.add(bulb);
            // Leafy fronds across the back.
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI - Math.PI / 2; const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 4), this._mat(0x3f7a33, 1.0, 0.7)); leaf.position.set(Math.sin(a) * 0.32, 0.3, -0.1 - Math.cos(a) * 0.1); leaf.rotation.set(-0.8, 0, Math.sin(a)); this.body.add(leaf); }
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            // Venus-flytrap maw head.
            this.head = new THREE.Group();
            for (const sgn of [1, -1]) { const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI), this._mat(p.accent, 1.0, 0.6)); lobe.scale.set(1, 0.6, 1.2); lobe.rotation.x = sgn * 0.55 - Math.PI / 2; lobe.position.set(0, sgn * 0.08, 0.16); this.head.add(lobe); }
            // Inner thorn teeth.
            for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const th = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 4), this._mat(0xfff0e0, 1.0, 0.4)); th.position.set(Math.cos(a) * 0.18, 0, 0.3); th.rotation.x = Math.PI / 2; this.head.add(th); }
            this._eye(this.head, -0.14, 0.18, 0.1, 0.05, 0xffee44, true);
            this._eye(this.head, 0.14, 0.18, 0.1, 0.05, 0xffee44, true);
            this.head.position.set(0, 1.1, 0.6); this.bodyGroup.add(this.head);

            // Thorned vine legs (paw feet = root clumps).
            this.frontLeft  = this._leg(this._mat(0x2f5a2a, 1.0, 0.7), -0.24, 0.4, 0.9, 0.95, 'paw');
            this.frontRight = this._leg(this._mat(0x2f5a2a, 1.0, 0.7), 0.24, 0.4, 0.9, 0.95, 'paw');
            this.rearLeft   = this._leg(this._mat(0x2f5a2a, 1.0, 0.7), -0.24, -0.42, 0.9, 0.95, 'paw');
            this.rearRight  = this._leg(this._mat(0x2f5a2a, 1.0, 0.7), 0.24, -0.42, 0.9, 0.95, 'paw');
            // Thorned tail vine.
            this.tail = this._tail(this._mat(0x2f5a2a, 1.0, 0.7), 0.96, -0.58, 6, 0.88, 0.8);
            for (let i = 0; i < 4; i++) { const th = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), this._mat(0xffe0e8, 1.0, 0.4)); th.position.set((i % 2 ? 0.08 : -0.08), -i * 0.13, 0); th.rotation.z = i % 2 ? -1.4 : 1.4; this.tail.add(th); }
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Mianni: animated crayon scribble that defies physics ─────────────
        _buildMianni(fur) {
            const p = this.profile;
            const palette = [0xff4444, 0xffcc22, 0x44cc55, 0x4488ff, 0xcc55dd];
            const crayonMat = (i) => this._mat(palette[i % palette.length], 1.0, 0.5, palette[i % palette.length]);
            // Wobbly stacked-crayon torso, each a tilted cylinder.
            this.body = new THREE.Group();
            for (let i = 0; i < 4; i++) { const cr = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.34, 8), crayonMat(i)); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.16, 8), crayonMat(i + 2)); tip.position.y = 0.24; cr.add(tip); cr.position.set(Math.sin(i * 1.3) * 0.12, i * 0.3, Math.cos(i * 1.7) * 0.1); cr.rotation.set(this.idRand() * 0.6 - 0.3, 0, this.idRand() * 0.6 - 0.3); this.body.add(cr); }
            this.body.position.set(0, 0.9, 0); this.bodyGroup.add(this.body);

            // Floating scribble head (defies gravity, no neck).
            this.head = new THREE.Group();
            const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), crayonMat(1)); ball.scale.set(1.1, 0.9, 1.0); this.head.add(ball);
            // Squiggly antennae.
            for (const ax of [-0.12, 0.12]) { const sq = new THREE.Mesh(new THREE.TorusKnotGeometry(0.06, 0.02, 24, 4), crayonMat(3)); sq.position.set(ax, 0.34, 0); this.head.add(sq); }
            this._eye(this.head, -0.1, 0.05, 0.26, 0.07, 0x000000, false);
            this._eye(this.head, 0.12, 0.02, 0.25, 0.06, 0x000000, false);
            this.head.position.set(0, 2.05, 0.12); this.bodyGroup.add(this.head);

            // Detached floating crayon limbs (no joints, physics ignored).
            this.frontLeft  = this._nub(crayonMat(0), -0.5, 1.3, 0.0, 0.1);
            this.frontRight = this._nub(crayonMat(2), 0.5, 1.5, 0.0, 0.1);
            this.rearLeft   = this._nub(crayonMat(3), -0.42, 0.5, 0.0, 0.12);
            this.rearRight  = this._nub(crayonMat(4), 0.42, 0.55, 0.0, 0.12);
            this.tail = this._nub(crayonMat(1), 0, 0.6, -0.5, 0.13);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Palette Phantom: spectral cat trailing rainbow haze ──────────────
        _buildPalettephantom(fur) {
            const p = this.profile;
            const ghost = this._mat(p.bodyColor, 0.5, 0.3, p.bodyColor);
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.1, 12), ghost); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), ghost); chest.position.z = 0.5; this.body.add(chest);
            // Drifting colour orbs around the body.
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const c = new THREE.Color().setHSL((i / 6 + this.idRand()) % 1, 0.9, 0.6); const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(c.getHex(), 0.7, 0.3, c.getHex())); orb.position.set(Math.cos(a) * 0.34, 0.08 + Math.sin(a) * 0.2, -0.1); this.body.add(orb); }
            this.body.position.set(0, 0.98, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), ghost));
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8), ghost); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.05, 0.18); this.head.add(muzzle);
            for (const ex of [-0.13, 0.13]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 6), ghost); ear.position.set(ex, 0.21, 0); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.04, 0.18, 0.05, p.accent, true);
            this._eye(this.head, 0.1, 0.04, 0.18, 0.05, p.accent, true);
            this.head.position.set(0, 1.06, 0.6); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(ghost, -0.18, 0.42, 0.84, 0.86, 'pad');
            this.frontRight = this._leg(ghost, 0.18, 0.42, 0.84, 0.86, 'pad');
            this.rearLeft   = this._leg(ghost, -0.18, -0.44, 0.84, 0.86, 'pad');
            this.rearRight  = this._leg(ghost, 0.18, -0.44, 0.84, 0.86, 'pad');
            // Wispy spectral tail dissolving into colour.
            this.tail = this._tail(this._mat(p.accent, 0.55, 0.3, p.accent), 0.98, -0.6, 7, 0.92, 0.7);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Radiant Unicorn: equine body + spiraling horn of light ───────────
        _buildRadiantunicorn(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 1.0, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); chest.position.z = 0.46; this.body.add(chest);
            // Flowing mane crest along the neck/back.
            for (let i = 0; i < 5; i++) { const c = new THREE.Color().setHSL((i / 5 * 0.3 + 0.5) % 1, 0.6, 0.7); const m = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 5), this._mat(c.getHex(), 0.85, 0.4, c.getHex())); m.position.set(0, 0.26, 0.36 - i * 0.16); m.rotation.x = -0.5; this.body.add(m); }
            this.body.position.set(0, 1.18, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 10), fur); neck.rotation.x = 0.45; neck.position.set(0, 0.18, 0.0); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), fur); skull.scale.set(0.8, 0.9, 1.3); skull.position.set(0, 0.5, 0.2); this.head.add(skull);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.45, 0.42); this.head.add(muzzle);
            for (const ex of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), fur); ear.position.set(ex, 0.64, 0.06); this.head.add(ear); }
            // Spiral horn of light made of stacked, twisting cones.
            const hornMat = this._mat(p.accent, 1.0, 0.2, p.accent);
            for (let i = 0; i < 5; i++) { const seg = new THREE.Mesh(new THREE.ConeGeometry(0.07 - i * 0.012, 0.12, 6), hornMat); seg.position.set(Math.sin(i * 1.2) * 0.02, 0.66 + i * 0.1, 0.32); seg.rotation.y = i * 0.6; this.head.add(seg); }
            this._eye(this.head, -0.1, 0.5, 0.3, 0.04, 0x4466cc, true);
            this._eye(this.head, 0.1, 0.5, 0.3, 0.04, 0x4466cc, true);
            this.head.position.set(0, 1.28, 0.5); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.22, 0.42, 1.08, 1.12, 'hoof');
            this.frontRight = this._leg(fur, 0.22, 0.42, 1.08, 1.12, 'hoof');
            this.rearLeft   = this._leg(fur, -0.22, -0.44, 1.08, 1.12, 'hoof');
            this.rearRight  = this._leg(fur, 0.22, -0.44, 1.08, 1.12, 'hoof');
            this.tail = this._tail(this._mat(0xffffff, 0.9, 0.5, p.accent), 1.2, -0.58, 6, 0.9, 0.5);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Rhinobeetle: chitin carapace, head horn, mandibles, six legs ─────
        _buildRhinobeetle(fur) {
            const p = this.profile;
            const chitin = this._skinMat(p.bodyColor, 0.35);
            this.body = new THREE.Group();
            // Rounded carapace shell.
            const carapace = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), chitin); carapace.scale.set(1.0, 0.7, 1.5); this.body.add(carapace);
            const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), chitin); thorax.scale.set(1.0, 0.7, 1.0); thorax.position.z = 0.5; this.body.add(thorax);
            // Wing-case seam ridge.
            const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.9), this._mat(p.accent, 1.0, 0.4)); seam.position.set(0, 0.34, -0.1); this.body.add(seam);
            this.body.position.set(0, 0.78, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), chitin); skull.scale.set(1.1, 0.8, 0.9); this.head.add(skull);
            // Big upward rhino horn.
            const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 7), this._mat(p.accent, 1.0, 0.4)); horn.position.set(0, 0.28, 0.18); horn.rotation.x = -0.4; this.head.add(horn);
            // Razor mandibles.
            for (const mx of [-0.1, 0.1]) { const md = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 5), this._mat(0x100a08, 1.0, 0.3)); md.position.set(mx, -0.08, 0.24); md.rotation.set(1.4, 0, mx > 0 ? -0.4 : 0.4); this.head.add(md); }
            this._eye(this.head, -0.13, 0.06, 0.14, 0.05, 0x080606, false);
            this._eye(this.head, 0.13, 0.06, 0.14, 0.05, 0x080606, false);
            this.head.position.set(0, 0.82, 0.66); this.bodyGroup.add(this.head);

            // Six insect legs (rear pair maps to tail slot via extra nubs).
            this.frontLeft  = this._leg(chitin, -0.34, 0.42, 0.7, 0.7, 'pad');
            this.frontRight = this._leg(chitin, 0.34, 0.42, 0.7, 0.7, 'pad');
            this.rearLeft   = this._leg(chitin, -0.36, -0.42, 0.7, 0.72, 'pad');
            this.rearRight  = this._leg(chitin, 0.36, -0.42, 0.7, 0.72, 'pad');
            this._leg(chitin, -0.36, 0.0, 0.7, 0.72, 'pad'); this._leg(chitin, 0.36, 0.0, 0.7, 0.72, 'pad');
            this.tail = this._nub(chitin, 0, 0.78, -0.72, 0.12);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Rummaging Opossum: low marsupial, pointed snout, naked tail ──────
        _buildRummagingopossum(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 12), fur); torso.scale.set(1.0, 0.85, 1.4); this.body.add(torso);
            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); rump.position.z = -0.4; this.body.add(rump);
            this.body.position.set(0, 0.74, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), this._mat(0xe8e4dc, 1.0, 0.7)); skull.scale.set(0.9, 0.9, 1.0); this.head.add(skull);
            // Long pointed pink snout.
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 8), this._mat(0xe8e4dc, 1.0, 0.7)); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.06, 0.28); this.head.add(snout);
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), this._mat(p.accent, 1.0, 0.5)); nose.position.set(0, -0.06, 0.46); this.head.add(nose);
            for (const ex of [-0.15, 0.15]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), this._mat(0x2a1a1a, 1.0, 0.6)); ear.position.set(ex, 0.2, -0.04); ear.scale.set(1, 1, 0.3); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.06, 0.18, 0.045, 0x080606, false);
            this._eye(this.head, 0.1, 0.06, 0.18, 0.045, 0x080606, false);
            this.head.position.set(0, 0.86, 0.56); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.24, 0.36, 0.62, 0.62, 'paw');
            this.frontRight = this._leg(fur, 0.24, 0.36, 0.62, 0.62, 'paw');
            this.rearLeft   = this._leg(fur, -0.24, -0.38, 0.62, 0.62, 'paw');
            this.rearRight  = this._leg(fur, 0.24, -0.38, 0.62, 0.62, 'paw');
            // Long bare prehensile tail.
            this.tail = this._tail(this._mat(0xc8b8a8, 1.0, 0.7), 0.74, -0.5, 7, 0.88, 0.6);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Beast 666: many-horned apocalyptic chimera ───────────────────────
        _buildBeast666(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.32, 1.2, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), fur); shoulders.position.z = 0.52; this.body.add(shoulders);
            // Scattered horns bristling from the back.
            const hornMat = this._mat(0x1a0606, 1.0, 0.5, p.accent);
            for (let i = 0; i < 8; i++) { const a = this.idRand() * Math.PI * 2; const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 5), hornMat); h.position.set(Math.cos(a) * 0.28, 0.28, 0.4 - i * 0.13); h.rotation.set(this.idRand() * 0.6, 0, Math.cos(a) * 0.9); this.body.add(h); }
            // Glowing 666 brand sigil.
            const brand = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 16), this._mat(p.accent, 1.0, 0.3, p.accent)); brand.position.set(0, 0.36, 0.5); this.body.add(brand);
            this.body.position.set(0, 1.12, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); skull.scale.set(1.0, 0.9, 1.1); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 7), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.06, 0.3); this.head.add(snout);
            const maw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this._mat(p.accent, 1.0, 0.3, p.accent)); maw.position.set(0, -0.06, 0.46); this.head.add(maw);
            // Crown of seven curled horns.
            for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * Math.PI; const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 10, Math.PI), hornMat); h.position.set(Math.sin(a) * 0.24, 0.24, -0.06); h.rotation.set(0.6, a, Math.cos(a) * 0.5); this.head.add(h); }
            this._eye(this.head, -0.12, 0.06, 0.22, 0.06, p.accent, true);
            this._eye(this.head, 0.12, 0.06, 0.22, 0.06, p.accent, true);
            this._eye(this.head, 0, 0.22, 0.2, 0.05, p.accent, true);
            this.head.position.set(0, 1.34, 0.58); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.3, 0.44, 1.04, 1.08, 'paw');
            this.frontRight = this._leg(fur, 0.3, 0.44, 1.04, 1.08, 'paw');
            this.rearLeft   = this._leg(fur, -0.3, -0.46, 1.04, 1.08, 'hoof');
            this.rearRight  = this._leg(fur, 0.3, -0.46, 1.04, 1.08, 'hoof');
            this.tail = this._tail(this._mat(0x1a0606, 1.0, 0.5, p.accent), 1.14, -0.64, 6, 0.88, 0.7);
            const sting = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), this._mat(p.accent, 1.0, 0.3, p.accent)); sting.position.set(0, -0.6, 0.4); this.tail.add(sting);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Tempest Pegasus: winged horse spinning miniature tornadoes ───────
        _buildTempestpegasus(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 1.0, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); chest.position.z = 0.46; this.body.add(chest);
            // Feathered wings: stacked tapering feather cones each side.
            const featherMat = this._mat(0xeef4fa, 0.95, 0.6);
            for (const side of [-1, 1]) { const wing = new THREE.Group(); for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55 - i * 0.05, 5), featherMat); f.position.set(side * (0.1 + i * 0.12), i * 0.04, -0.05 - i * 0.06); f.rotation.set(Math.PI / 2, 0, side * (0.5 + i * 0.12)); wing.add(f); } wing.position.set(side * 0.28, 0.22, 0.05); this.body.add(wing); }
            this.body.position.set(0, 1.2, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 10), fur); neck.rotation.x = 0.45; neck.position.set(0, 0.18, 0.0); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), fur); skull.scale.set(0.8, 0.9, 1.3); skull.position.set(0, 0.5, 0.2); this.head.add(skull);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.45, 0.42); this.head.add(muzzle);
            for (const ex of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), fur); ear.position.set(ex, 0.64, 0.06); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.5, 0.3, 0.04, p.accent, true);
            this._eye(this.head, 0.1, 0.5, 0.3, 0.04, p.accent, true);
            this.head.position.set(0, 1.3, 0.5); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.22, 0.42, 1.1, 1.14, 'hoof');
            this.frontRight = this._leg(fur, 0.22, 0.42, 1.1, 1.14, 'hoof');
            this.rearLeft   = this._leg(fur, -0.22, -0.44, 1.1, 1.14, 'hoof');
            this.rearRight  = this._leg(fur, 0.22, -0.44, 1.1, 1.14, 'hoof');
            // Tail trailing into a swirling vortex of wind.
            this.tail = new THREE.Group();
            for (let i = 0; i < 5; i++) { const r = 0.18 - i * 0.025; const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 14), this._mat(p.accent, 0.6, 0.3, p.accent)); ring.position.set(0, -i * 0.14, 0.05); ring.rotation.x = Math.PI / 2; this.tail.add(ring); }
            this.tail.position.set(0, 1.2, -0.6); this.bodyGroup.add(this.tail);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Velocicorn: lightning-swift slim equine with a spiral horn ───────
        _buildVelocicorn(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.05, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); chest.position.z = 0.48; this.body.add(chest);
            // Crackling speed-bolts streaming off the rump.
            for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.4, 4), this._mat(p.accent, 0.85, 0.3, p.accent)); b.position.set((i % 2 ? 0.18 : -0.18), 0.1, -0.6 - i * 0.08); b.rotation.x = Math.PI / 2 + 0.3; this.body.add(b); }
            this.body.position.set(0, 1.16, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.5, 10), fur); neck.rotation.x = 0.5; neck.position.set(0, 0.16, 0.0); this.head.add(neck);
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), fur); skull.scale.set(0.8, 0.9, 1.35); skull.position.set(0, 0.46, 0.22); this.head.add(skull);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.42, 0.44); this.head.add(muzzle);
            for (const ex of [-0.08, 0.08]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 5), fur); ear.position.set(ex, 0.6, 0.08); this.head.add(ear); }
            // Long forward spiral horn (twisting stacked cones).
            const hornMat = this._mat(p.accent, 1.0, 0.2, p.accent);
            for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.ConeGeometry(0.06 - i * 0.008, 0.13, 6), hornMat); seg.position.set(Math.sin(i * 1.4) * 0.015, 0.5 + i * 0.02, 0.5 + i * 0.11); seg.rotation.set(1.2, i * 0.7, 0); this.head.add(seg); }
            this._eye(this.head, -0.1, 0.46, 0.32, 0.04, p.accent, true);
            this._eye(this.head, 0.1, 0.46, 0.32, 0.04, p.accent, true);
            this.head.position.set(0, 1.26, 0.52); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.2, 0.42, 1.06, 1.12, 'hoof');
            this.frontRight = this._leg(fur, 0.2, 0.42, 1.06, 1.12, 'hoof');
            this.rearLeft   = this._leg(fur, -0.2, -0.44, 1.06, 1.12, 'hoof');
            this.rearRight  = this._leg(fur, 0.2, -0.44, 1.06, 1.12, 'hoof');
            this.tail = this._tail(this._mat(p.accent, 0.8, 0.4, p.accent), 1.18, -0.58, 5, 0.88, 0.6);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Swamp Leviathan: colossal heavy-legged marsh monstrosity ─────────
        _buildSwampleviathan(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 12), fur); torso.scale.set(1.2, 0.95, 1.7); this.body.add(torso);
            const back = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), fur); back.scale.set(1.1, 0.8, 1.2); back.position.set(0, 0.22, -0.1); this.body.add(back);
            // Mossy plated ridges down the spine.
            for (let i = 0; i < 6; i++) { const pl = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), this._mat(p.accent, 1.0, 0.85)); pl.position.set(0, 0.42, 0.5 - i * 0.22); this.body.add(pl); }
            this.body.position.set(0, 1.3, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), fur); skull.scale.set(1.0, 0.8, 1.3); this.head.add(skull);
            const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.5), fur); jaw.position.set(0, -0.18, 0.26); this.head.add(jaw);
            for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), this._mat(0xd8d0b0, 1.0, 0.4)); t.position.set(-0.22 + i * 0.088, -0.1, 0.46); t.rotation.x = Math.PI; this.head.add(t); }
            this._eye(this.head, -0.18, 0.14, 0.28, 0.06, p.accent, true);
            this._eye(this.head, 0.18, 0.14, 0.28, 0.06, p.accent, true);
            this.head.position.set(0, 1.32, 0.92); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.42, 0.5, 1.18, 1.2, 'paw');
            this.frontRight = this._leg(fur, 0.42, 0.5, 1.18, 1.2, 'paw');
            this.rearLeft   = this._leg(fur, -0.42, -0.52, 1.18, 1.2, 'paw');
            this.rearRight  = this._leg(fur, 0.42, -0.52, 1.18, 1.2, 'paw');
            this.tail = this._tail(fur, 1.3, -0.85, 6, 0.9, 0.4);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Inverted Hunger: inside-out maw-beast, gaping ring of teeth ──────
        _buildInvertedhunger(fur) {
            const p = this.profile;
            const flesh = this._mat(p.bodyColor, 1.0, 0.85);
            const innerMat = this._mat(p.accent, 1.0, 0.6, p.accent);
            this.body = new THREE.Group();
            // Torus body: the creature IS a ring-shaped mouth turned outward.
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.26, 14, 20), flesh); ring.rotation.x = Math.PI / 2; this.body.add(ring);
            // Glowing inverted gullet pulled through the middle.
            const gullet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), innerMat); gullet.scale.set(1, 1, 0.6); this.body.add(gullet);
            // Inward-facing teeth ringing the maw.
            for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const t = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 4), this._mat(0xf4e8d8, 1.0, 0.4)); t.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.18); t.lookAt(0, 0, 0.6); this.body.add(t); }
            this.body.position.set(0, 1.2, 0); this.bodyGroup.add(this.body);

            // "Head" = the pulsing core uvula deep in the throat.
            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), innerMat));
            this._eye(this.head, -0.07, 0.0, 0.14, 0.05, 0x111111, false);
            this._eye(this.head, 0.07, 0.0, 0.14, 0.05, 0x111111, false);
            this.head.position.set(0, 1.2, 0.05); this.bodyGroup.add(this.head);

            // Stubby fleshy tendril feet (no real legs).
            this.frontLeft  = this._nub(flesh, -0.3, 0.55, 0.3, 0.13);
            this.frontRight = this._nub(flesh, 0.3, 0.55, 0.3, 0.13);
            this.rearLeft   = this._nub(flesh, -0.3, 0.55, -0.3, 0.13);
            this.rearRight  = this._nub(flesh, 0.3, 0.55, -0.3, 0.13);
            this.tail = this._tail(flesh, 1.2, -0.6, 4, 0.8, -0.5);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Void Howler: shadow bear leaking tendrils of pure darkness ───────
        _buildVoidhowler(fur) {
            const p = this.profile;
            const voidMat = this._mat(p.bodyColor, 0.92, 0.4, 0x1a0a2a);
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 12), voidMat); torso.scale.set(1.0, 0.95, 1.5); this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 12), voidMat); shoulders.position.set(0, 0.16, 0.46); this.body.add(shoulders);
            // Writhing void tendrils sprouting from the back.
            const tendrilMat = this._mat(p.accent, 0.8, 0.2, p.accent);
            for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const td = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.55, 5), tendrilMat); td.position.set(Math.cos(a) * 0.3, 0.34, -0.05 + Math.sin(a) * 0.2); td.rotation.set(Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8); this.body.add(td); }
            this.body.position.set(0, 1.05, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), voidMat));
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.3, 10), voidMat); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.05, 0.32); this.head.add(snout);
            // Glowing void maw mid-howl.
            const maw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), this._mat(p.accent, 1.0, 0.3, p.accent)); maw.position.set(0, -0.06, 0.44); this.head.add(maw);
            for (const ex of [-0.2, 0.2]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 5), voidMat); ear.position.set(ex, 0.3, -0.02); this.head.add(ear); }
            this._eye(this.head, -0.13, 0.08, 0.24, 0.06, p.accent, true);
            this._eye(this.head, 0.13, 0.08, 0.24, 0.06, p.accent, true);
            this.head.position.set(0, 1.5, 0.6); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(voidMat, -0.32, 0.42, 0.92, 0.95, 'paw');
            this.frontRight = this._leg(voidMat, 0.32, 0.42, 0.92, 0.95, 'paw');
            this.rearLeft   = this._leg(voidMat, -0.32, -0.42, 0.92, 0.95, 'paw');
            this.rearRight  = this._leg(voidMat, 0.32, -0.42, 0.92, 0.95, 'paw');
            this.tail = this._tail(tendrilMat, 1.0, -0.74, 5, 0.85, 0.7);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Feast of Famine: banquet table whose food is its own flesh ───────
        _buildFeastoffamine(fur) {
            const p = this.profile;
            const wood = this._mat(0x4a3220, 1.0, 0.7);
            const flesh = this._mat(p.accent, 1.0, 0.7, 0x2a0808);
            this.body = new THREE.Group();
            // Flat table-top slab body.
            const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.0), wood); top.position.y = 0.1; this.body.add(top);
            // Heaped fleshy "dishes" laid out across the table.
            for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const r = 0.5; const lump = new THREE.Mesh(new THREE.SphereGeometry(0.13 + this.idRand() * 0.06, 10, 10), flesh); lump.scale.set(1, 0.7, 1); lump.position.set(Math.cos(a) * r * 1.3, 0.22, Math.sin(a) * r * 0.8); this.body.add(lump); }
            // A central roast: a big lobe of regenerating meat.
            const roast = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), flesh); roast.scale.set(1.3, 0.7, 0.9); roast.position.set(0, 0.26, 0); this.body.add(roast);
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            // A pleading face peering up from the spread.
            this.head = new THREE.Group();
            this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), flesh));
            const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this._mat(0x1a0606, 1.0, 0.4)); mouth.position.set(0, -0.1, 0.16); this.head.add(mouth);
            this._eye(this.head, -0.08, 0.04, 0.18, 0.05, 0xffee88, true);
            this._eye(this.head, 0.08, 0.04, 0.18, 0.05, 0xffee88, true);
            this.head.position.set(0, 1.32, 0.36); this.bodyGroup.add(this.head);

            // Four carved table legs.
            this.frontLeft  = this._leg(wood, -0.6, 0.4, 0.85, 0.85, 'pad');
            this.frontRight = this._leg(wood, 0.6, 0.4, 0.85, 0.85, 'pad');
            this.rearLeft   = this._leg(wood, -0.6, -0.4, 0.85, 0.85, 'pad');
            this.rearRight  = this._leg(wood, 0.6, -0.4, 0.85, 0.85, 'pad');
            this.tail = this._nub(flesh, 0, 1.0, -0.55, 0.14);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Maternity Ward: bloated brood-beast mimicking a pregnant woman ───
        _buildMaternityward(fur) {
            const p = this.profile;
            const skin = this._mat(p.bodyColor, 1.0, 0.75);
            this.body = new THREE.Group();
            // Grotesquely swollen distended belly.
            const belly = new THREE.Mesh(new THREE.SphereGeometry(0.58, 16, 14), skin); belly.scale.set(1.0, 1.1, 1.0); this.body.add(belly);
            // Smaller squirming broodlings bulging through the skin.
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), this._mat(p.accent, 1.0, 0.6, 0x3a0a0a)); b.position.set(Math.cos(a) * 0.5, -0.05 + Math.sin(a) * 0.25, 0.42); this.body.add(b); }
            // A torn birthing slit emitting glow.
            const slit = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), this._mat(0x2a0808, 1.0, 0.4, p.accent)); slit.scale.set(0.5, 1.4, 0.5); slit.position.set(0, -0.4, 0.5); this.body.add(slit);
            this.body.position.set(0, 1.1, 0); this.bodyGroup.add(this.body);

            // Gaunt mimicked human-ish head atop the bloat.
            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin); skull.scale.set(0.9, 1.1, 0.9); this.head.add(skull);
            const hair = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.6), this._mat(0x2a1c18, 1.0, 0.8)); hair.position.y = 0.04; this.head.add(hair);
            const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this._mat(0x1a0606, 1.0, 0.4)); mouth.position.set(0, -0.12, 0.2); mouth.scale.set(1.4, 0.6, 0.6); this.head.add(mouth);
            this._eye(this.head, -0.09, 0.04, 0.2, 0.05, p.accent, true);
            this._eye(this.head, 0.09, 0.04, 0.2, 0.05, p.accent, true);
            this.head.position.set(0, 1.92, 0.18); this.bodyGroup.add(this.head);

            // Thin spindly limbs clutching the belly.
            this.frontLeft  = this._leg(skin, -0.46, 0.32, 1.5, 0.7, 'pad');
            this.frontRight = this._leg(skin, 0.46, 0.32, 1.5, 0.7, 'pad');
            this.rearLeft   = this._leg(skin, -0.3, -0.2, 0.62, 0.66, 'pad');
            this.rearRight  = this._leg(skin, 0.3, -0.2, 0.62, 0.66, 'pad');
            this.tail = this._nub(this._mat(p.accent, 1.0, 0.6, 0x3a0a0a), 0, 0.7, -0.5, 0.14);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Starving Saber-Cat: gaunt sabertooth, ribs showing, huge fangs ───
        _buildStarvingsabercat(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.2, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); haunch.scale.set(0.9, 0.85, 1.0); haunch.position.set(0, 0.04, -0.5); this.body.add(haunch);
            // Starved ribcage rings showing through.
            for (let i = 0; i < 4; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 6, 12), this._mat(0xd8c8a0, 1.0, 0.5)); rib.rotation.y = Math.PI / 2; rib.position.set(0, 0, 0.32 - i * 0.16); this.body.add(rib); }
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur); skull.scale.set(0.85, 0.85, 1.05); this.head.add(skull);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.18, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.06, 0.2); this.head.add(muzzle);
            // Oversized iron-tinged sabre fangs.
            for (const fx of [-0.07, 0.07]) { const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 6), this._mat(0xe8e0c8, 1.0, 0.3)); fang.position.set(fx, -0.24, 0.28); fang.rotation.x = Math.PI; this.head.add(fang); }
            for (const ex of [-0.13, 0.13]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 6), fur); ear.position.set(ex, 0.2, 0); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.04, 0.18, 0.045, p.accent, true);
            this._eye(this.head, 0.1, 0.04, 0.18, 0.045, p.accent, true);
            this.head.position.set(0, 1.0, 0.62); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.2, 0.44, 0.86, 0.92, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.44, 0.86, 0.92, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.46, 0.86, 0.92, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.46, 0.86, 0.92, 'pad');
            this.tail = this._felineTail(fur, 0.98, -0.66, 7, 0.88);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Ashen Prowler: ash-grey feral canine, slung-low stalking gait ────
        _buildAshenprowler(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 1.1, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); chest.position.z = 0.5; this.body.add(chest);
            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), fur); rump.position.z = -0.52; this.body.add(rump);
            // Drifting ash motes clinging to its coat.
            for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), this._mat(0xbfbcb6, 0.6, 0.9)); m.position.set(Math.sin(i * 1.7) * 0.18, 0.24 + i * 0.02, 0.4 - i * 0.2); this.body.add(m); }
            this.body.position.set(0, 0.92, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 12), fur); skull.scale.set(0.9, 0.85, 1.05); skull.position.set(0, 0.2, 0.16); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.16, 0.42); this.head.add(snout);
            for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), fur); ear.position.set(ex, 0.4, 0.04); this.head.add(ear); }
            this._eye(this.head, -0.09, 0.22, 0.28, 0.045, p.accent, true);
            this._eye(this.head, 0.09, 0.22, 0.28, 0.045, p.accent, true);
            this.head.position.set(0, 1.0, 0.52); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.2, 0.42, 0.84, 0.9, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.42, 0.84, 0.9, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.44, 0.84, 0.9, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.44, 0.84, 0.9, 'pad');
            this.tail = this._tail(fur, 0.92, -0.66, 5, 0.82, -0.5);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Gaunt Snapper: hollow-eyed emaciated beast, oversized snapping jaws ─
        _buildGauntsnapper(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 1.05, 10), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const hips = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), fur); hips.scale.set(1.1, 0.8, 1.0); hips.position.z = -0.46; this.body.add(hips);
            for (let i = 0; i < 5; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 12), this._mat(0xc8c0a8, 1.0, 0.5)); rib.rotation.y = Math.PI / 2; rib.position.set(0, 0, 0.36 - i * 0.15); this.body.add(rib); }
            this.body.position.set(0, 0.95, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), fur); skull.scale.set(0.8, 0.8, 1.0); skull.position.y = 0.06; this.head.add(skull);
            // Oversized upper + lower snapping jaw.
            const upper = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.42), fur); upper.position.set(0, 0.02, 0.34); this.head.add(upper);
            const lower = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.4), fur); lower.position.set(0, -0.14, 0.32); this.head.add(lower);
            const fangMat = this._mat(0xfff4d0, 1.0, 0.3);
            for (let i = 0; i < 5; i++) { const tx = -0.08 + i * 0.04; const tu = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.12, 4), fangMat); tu.position.set(tx, -0.04, 0.5); tu.rotation.x = Math.PI; this.head.add(tu); const tl = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.12, 4), fangMat); tl.position.set(tx, -0.1, 0.48); this.head.add(tl); }
            // Hollow glowing eye sockets.
            this._eye(this.head, -0.09, 0.1, 0.16, 0.055, p.accent, true);
            this._eye(this.head, 0.09, 0.1, 0.16, 0.055, p.accent, true);
            this.head.position.set(0, 1.04, 0.58); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.17, 0.4, 0.9, 0.96, 'paw');
            this.frontRight = this._leg(fur, 0.17, 0.4, 0.9, 0.96, 'paw');
            this.rearLeft   = this._leg(fur, -0.17, -0.42, 0.86, 0.92, 'paw');
            this.rearRight  = this._leg(fur, 0.17, -0.42, 0.86, 0.92, 'paw');
            this.tail = this._tail(fur, 0.95, -0.58, 4, 0.74, 0.6);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Hollow-Eyed Boar: rabid boar, empty glowing sockets, tusks, hump ─
        _buildHolloweyedboar(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), fur); torso.scale.set(1.0, 0.85, 1.55); this.body.add(torso);
            const hump = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 12), fur); hump.scale.set(1.0, 1.15, 0.9); hump.position.set(0, 0.24, 0.42); this.body.add(hump);
            // Ragged raised bristles down the hump.
            for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.3, 4), this._mat(0x140d0a, 1.0, 0.9)); b.position.set(0, 0.34 + Math.sin(i / 6 * Math.PI) * 0.06, 0.5 - i * 0.16); this.body.add(b); }
            this.body.position.set(0, 0.9, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); skull.scale.set(0.9, 0.9, 1.2); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.32, 10), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.07, 0.3); this.head.add(snout);
            const tuskMat = this._mat(0xe8dcc0, 1.0, 0.4);
            for (const tx of [-0.11, 0.11]) { const tk = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 6), tuskMat); tk.position.set(tx, -0.1, 0.38); tk.rotation.set(-0.8, 0, tx > 0 ? 0.35 : -0.35); this.head.add(tk); }
            for (const ex of [-0.16, 0.16]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), fur); ear.position.set(ex, 0.22, 0); this.head.add(ear); }
            // Empty glowing eye sockets sunk into the skull.
            for (const sx of [-0.13, 0.13]) { const socket = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this._mat(0x000000, 1.0, 0.4)); socket.position.set(sx, 0.06, 0.16); this.head.add(socket); this._eye(this.head, sx, 0.06, 0.19, 0.035, p.accent, true); }
            this.head.position.set(0, 0.92, 0.62); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.26, 0.38, 0.78, 0.78, 'hoof');
            this.frontRight = this._leg(fur, 0.26, 0.38, 0.78, 0.78, 'hoof');
            this.rearLeft   = this._leg(fur, -0.26, -0.4, 0.78, 0.78, 'hoof');
            this.rearRight  = this._leg(fur, 0.26, -0.4, 0.78, 0.78, 'hoof');
            this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), fur); this.tail.position.set(0, 0.9, -0.62); this.bodyGroup.add(this.tail);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Feral Lynx: compact scarred cat, tufted ears, bobbed tail ────────
        _buildFerallynx(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.9, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), fur); haunch.position.set(0, 0.06, -0.42); this.body.add(haunch);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), fur); chest.position.z = 0.42; this.body.add(chest);
            // A jagged scar gash across the flank.
            const scar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), this._mat(0xc04030, 1.0, 0.5)); scar.position.set(0.2, 0.1, 0.1); scar.rotation.z = 0.5; this.body.add(scar);
            this.body.position.set(0, 0.92, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur); face.scale.set(1.1, 1.0, 0.95); this.head.add(face);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.06, 0.18); this.head.add(muzzle);
            // Ruff cheek-fur + tufted (black-tipped) ears.
            for (const ex of [-0.18, 0.18]) { const ruff = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 6), fur); ruff.position.set(ex, -0.06, 0.04); ruff.rotation.z = ex > 0 ? -0.6 : 0.6; this.head.add(ruff); }
            for (const ex of [-0.13, 0.13]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), fur); ear.position.set(ex, 0.22, 0); this.head.add(ear); const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.12, 4), this._mat(0x140d0a, 1.0, 0.9)); tuft.position.set(ex, 0.34, 0); this.head.add(tuft); }
            this._eye(this.head, -0.1, 0.04, 0.18, 0.05, p.accent, true);
            this._eye(this.head, 0.1, 0.04, 0.18, 0.05, p.accent, true);
            this.head.position.set(0, 1.0, 0.56); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.2, 0.4, 0.84, 0.88, 'pad');
            this.frontRight = this._leg(fur, 0.2, 0.4, 0.84, 0.88, 'pad');
            this.rearLeft   = this._leg(fur, -0.2, -0.42, 0.84, 0.88, 'pad');
            this.rearRight  = this._leg(fur, 0.2, -0.42, 0.84, 0.88, 'pad');
            // Stubby bobbed tail.
            this.tail = this._nub(fur, 0, 0.92, -0.56, 0.11);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Dire Gnasher: pack predator with a huge teeth-crammed gnashing jaw ─
        _buildDiregnasher(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 1.0, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); shoulders.position.z = 0.46; this.body.add(shoulders);
            this.body.position.set(0, 0.98, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur); skull.scale.set(0.9, 0.85, 1.0); skull.position.y = 0.08; this.head.add(skull);
            // Massively oversized gnashing jaw assembly.
            const upper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.5), fur); upper.position.set(0, 0.06, 0.36); this.head.add(upper);
            const lower = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, 0.46), fur); lower.position.set(0, -0.16, 0.34); this.head.add(lower);
            const fangMat = this._mat(0xfff4d0, 1.0, 0.3);
            for (let i = 0; i < 7; i++) { const tx = -0.13 + i * 0.043; const tu = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.16, 5), fangMat); tu.position.set(tx, 0.0, 0.58); tu.rotation.x = Math.PI; this.head.add(tu); const tl = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.16, 5), fangMat); tl.position.set(tx, -0.1, 0.54); this.head.add(tl); }
            for (const ex of [-0.11, 0.11]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), fur); ear.position.set(ex, 0.28, -0.02); this.head.add(ear); }
            this._eye(this.head, -0.1, 0.12, 0.2, 0.045, p.accent, true);
            this._eye(this.head, 0.1, 0.12, 0.2, 0.045, p.accent, true);
            this.head.position.set(0, 1.04, 0.56); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.22, 0.42, 0.9, 0.96, 'paw');
            this.frontRight = this._leg(fur, 0.22, 0.42, 0.9, 0.96, 'paw');
            this.rearLeft   = this._leg(fur, -0.22, -0.44, 0.9, 0.96, 'paw');
            this.rearRight  = this._leg(fur, 0.22, -0.44, 0.9, 0.96, 'paw');
            this.tail = this._tail(fur, 0.98, -0.6, 4, 0.8, -0.3);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Gaunt Clawrunner: lean sprinter, huge raking foreclaws, leyline static ─
        _buildGauntclawrunner(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.15, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); chest.position.z = 0.52; this.body.add(chest);
            // Crackling static arcs along the spine.
            for (let i = 0; i < 6; i++) { const arc = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4), this._mat(p.accent, 0.8, 0.4, p.accent)); arc.position.set(Math.sin(i * 1.9) * 0.05, 0.22, 0.45 - i * 0.16); this.body.add(arc); }
            this.body.position.set(0, 0.96, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), fur); skull.scale.set(0.85, 0.8, 1.05); skull.position.set(0, 0.18, 0.14); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.14, 0.4); this.head.add(snout);
            for (const ex of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 5), fur); ear.position.set(ex, 0.38, 0.04); this.head.add(ear); }
            this._eye(this.head, -0.09, 0.2, 0.26, 0.045, p.accent, true);
            this._eye(this.head, 0.09, 0.2, 0.26, 0.045, p.accent, true);
            this.head.position.set(0, 1.02, 0.54); this.bodyGroup.add(this.head);

            // Long raking foreclaw blades on the front legs.
            const clawMat = this._mat(0xe8ecf0, 1.0, 0.3);
            this.frontLeft  = this._leg(fur, -0.19, 0.42, 0.9, 0.96, 'paw');
            this.frontRight = this._leg(fur, 0.19, 0.42, 0.9, 0.96, 'paw');
            for (const fg of [this.frontLeft, this.frontRight]) for (const cx of [-0.06, 0, 0.06]) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.3, 5), clawMat); claw.position.set(cx, -0.9, 0.2); claw.rotation.x = 1.4; fg.add(claw); }
            this.rearLeft   = this._leg(fur, -0.19, -0.44, 0.86, 0.92, 'pad');
            this.rearRight  = this._leg(fur, 0.19, -0.44, 0.86, 0.92, 'pad');
            this.tail = this._tail(fur, 0.96, -0.6, 5, 0.82, -0.4);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Bloodmaw Direwolf: huge mangy wolf, blood-soaked maw, bushy tail ─
        _buildBloodmawdirewolf(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.15, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), fur); chest.position.z = 0.54; this.body.add(chest);
            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), fur); rump.position.z = -0.58; this.body.add(rump);
            // Mangy raised hackles down the back.
            for (let i = 0; i < 7; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 5), fur); sp.position.set(0, 0.3, 0.45 - i * 0.17); this.body.add(sp); }
            this.body.position.set(0, 1.1, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); skull.scale.set(0.9, 0.85, 1.1); skull.position.set(0, 0.24, 0.16); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.18, 0.48); this.head.add(snout);
            // Blood-soaked dripping maw + bared fangs.
            const bloodMat = this._mat(p.accent, 1.0, 0.3, 0x440000);
            const maw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), bloodMat); maw.scale.set(1.1, 0.7, 1.3); maw.position.set(0, 0.08, 0.6); this.head.add(maw);
            for (let i = 0; i < 3; i++) { const drip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), bloodMat); drip.position.set(-0.06 + i * 0.06, -0.05 - i * 0.04, 0.58); this.head.add(drip); }
            for (const fx of [-0.07, 0.07]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 5), this._mat(0xfff4d0, 1.0, 0.3)); f.position.set(fx, 0.04, 0.64); f.rotation.x = Math.PI; this.head.add(f); }
            for (const ex of [-0.12, 0.12]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 5), fur); ear.position.set(ex, 0.48, 0.06); this.head.add(ear); }
            this._eye(this.head, -0.11, 0.28, 0.32, 0.05, p.accent, true);
            this._eye(this.head, 0.11, 0.28, 0.32, 0.05, p.accent, true);
            this.head.position.set(0, 1.26, 0.6); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.24, 0.44, 1.04, 1.1, 'pad');
            this.frontRight = this._leg(fur, 0.24, 0.44, 1.04, 1.1, 'pad');
            this.rearLeft   = this._leg(fur, -0.24, -0.46, 1.04, 1.1, 'pad');
            this.rearRight  = this._leg(fur, 0.24, -0.46, 1.04, 1.1, 'pad');
            this.tail = this._tail(fur, 1.12, -0.74, 5, 0.9, -0.4);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Gaunt Lynx: emaciated bobcat, visible ribs, tufted ears, bob tail ─
        _buildGauntlynx(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.85, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), fur); haunch.position.set(0, 0.04, -0.4); this.body.add(haunch);
            // Starvation ribs showing through the flank.
            for (let i = 0; i < 4; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 6, 12), this._mat(0xc8c0a8, 1.0, 0.5)); rib.rotation.y = Math.PI / 2; rib.position.set(0, 0, 0.28 - i * 0.16); this.body.add(rib); }
            this.body.position.set(0, 0.9, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), fur); face.scale.set(1.1, 0.95, 0.9); this.head.add(face);
            const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 8), fur); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.06, 0.16); this.head.add(muzzle);
            // Cheek ruff + black-tipped tufted ears.
            for (const ex of [-0.16, 0.16]) { const ruff = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.15, 6), fur); ruff.position.set(ex, -0.06, 0.02); ruff.rotation.z = ex > 0 ? -0.6 : 0.6; this.head.add(ruff); }
            for (const ex of [-0.12, 0.12]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), fur); ear.position.set(ex, 0.2, 0); this.head.add(ear); const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.13, 4), this._mat(0x140d0a, 1.0, 0.9)); tuft.position.set(ex, 0.33, 0); this.head.add(tuft); }
            this._eye(this.head, -0.09, 0.04, 0.16, 0.05, p.accent, true);
            this._eye(this.head, 0.09, 0.04, 0.16, 0.05, p.accent, true);
            this.head.position.set(0, 0.96, 0.54); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.18, 0.38, 0.82, 0.88, 'pad');
            this.frontRight = this._leg(fur, 0.18, 0.38, 0.82, 0.88, 'pad');
            this.rearLeft   = this._leg(fur, -0.18, -0.4, 0.82, 0.88, 'pad');
            this.rearRight  = this._leg(fur, 0.18, -0.4, 0.82, 0.88, 'pad');
            this.tail = this._nub(fur, 0, 0.9, -0.52, 0.1);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Feral Badger: low stocky three-tailed digger, striped face, big claws ─
        _buildFeralbadger(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), fur); torso.scale.set(1.05, 0.7, 1.6); this.body.add(torso);
            this.body.position.set(0, 0.6, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), fur); skull.scale.set(0.95, 0.85, 1.1); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.04, 0.24); this.head.add(snout);
            // Bold white facial stripes flanking dark cheeks.
            const stripeMat = this._mat(p.accent, 1.0, 0.6);
            for (const sx of [-0.12, 0, 0.12]) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.12), stripeMat); stripe.position.set(sx, 0.02, 0.2); this.head.add(stripe); }
            for (const ex of [-0.15, 0.15]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), fur); ear.position.set(ex, 0.2, 0.02); ear.scale.z = 0.5; this.head.add(ear); }
            this._eye(this.head, -0.11, 0.05, 0.2, 0.04, 0x120c08, false);
            this._eye(this.head, 0.11, 0.05, 0.2, 0.04, 0x120c08, false);
            this.head.position.set(0, 0.62, 0.56); this.bodyGroup.add(this.head);

            // Short legs with oversized digging claws on the front.
            const clawMat = this._mat(0xe8dcc0, 1.0, 0.4);
            this.frontLeft  = this._leg(fur, -0.24, 0.36, 0.52, 0.5, 'paw');
            this.frontRight = this._leg(fur, 0.24, 0.36, 0.52, 0.5, 'paw');
            for (const fg of [this.frontLeft, this.frontRight]) for (const cx of [-0.05, 0, 0.05]) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.2, 5), clawMat); claw.position.set(cx, -0.48, 0.16); claw.rotation.x = 1.5; fg.add(claw); }
            this.rearLeft   = this._leg(fur, -0.24, -0.38, 0.52, 0.5, 'paw');
            this.rearRight  = this._leg(fur, 0.24, -0.38, 0.52, 0.5, 'paw');
            // Three short stub tails.
            this.tail = new THREE.Group();
            for (const tx of [-0.14, 0, 0.14]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), fur); t.position.set(tx, 0, 0); t.rotation.x = -1.8; this.tail.add(t); }
            this.tail.position.set(0, 0.6, -0.6); this.bodyGroup.add(this.tail);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Starving Gnasher: ribby three-tailed pack hunter, oversized jaw ──
        _buildStarvinggnasher(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 1.05, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); shoulders.position.z = 0.46; this.body.add(shoulders);
            for (let i = 0; i < 5; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 6, 12), this._mat(0xc8c0a8, 1.0, 0.5)); rib.rotation.y = Math.PI / 2; rib.position.set(0, 0, 0.3 - i * 0.15); this.body.add(rib); }
            this.body.position.set(0, 0.96, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), fur); skull.scale.set(0.85, 0.8, 1.0); skull.position.y = 0.08; this.head.add(skull);
            const upper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.48), fur); upper.position.set(0, 0.04, 0.36); this.head.add(upper);
            const lower = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.44), fur); lower.position.set(0, -0.15, 0.34); this.head.add(lower);
            const fangMat = this._mat(0xfff4d0, 1.0, 0.3);
            for (let i = 0; i < 6; i++) { const tx = -0.11 + i * 0.044; const tu = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 5), fangMat); tu.position.set(tx, -0.01, 0.56); tu.rotation.x = Math.PI; this.head.add(tu); const tl = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 5), fangMat); tl.position.set(tx, -0.11, 0.52); this.head.add(tl); }
            for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), fur); ear.position.set(ex, 0.28, -0.02); this.head.add(ear); }
            this._eye(this.head, -0.09, 0.12, 0.18, 0.05, p.accent, true);
            this._eye(this.head, 0.09, 0.12, 0.18, 0.05, p.accent, true);
            this.head.position.set(0, 1.02, 0.56); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.18, 0.42, 0.9, 0.96, 'paw');
            this.frontRight = this._leg(fur, 0.18, 0.42, 0.9, 0.96, 'paw');
            this.rearLeft   = this._leg(fur, -0.18, -0.44, 0.86, 0.92, 'paw');
            this.rearRight  = this._leg(fur, 0.18, -0.44, 0.86, 0.92, 'paw');
            // Three thin whip tails.
            this.tail = new THREE.Group();
            for (const tx of [-0.1, 0, 0.1]) { const t = this._tail(fur, 0, 0, 4, 0.78, 0.6); t.position.x = tx; this.tail.add(t); this.bodyGroup.remove(t); }
            this.tail.position.set(0, 0.96, -0.56); this.bodyGroup.add(this.tail);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        // ── Feral Ridgeback: starving stalk-hound with a raised bristle spine ─
        _buildFeralridgeback(fur) {
            const p = this.profile;
            this.body = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 1.1, 12), fur); torso.rotation.x = Math.PI / 2; this.body.add(torso);
            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), fur); chest.position.z = 0.5; this.body.add(chest);
            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), fur); rump.position.z = -0.5; this.body.add(rump);
            // Pronounced raised spinal ridge of stiff back-swept bristles.
            const bristleMat = this._mat(0x2a221c, 1.0, 0.9);
            for (let i = 0; i < 9; i++) { const ridge = Math.sin(i / 8 * Math.PI); const b = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18 + ridge * 0.22, 4), bristleMat); b.position.set(0, 0.26 + ridge * 0.16, 0.5 - i * 0.13); b.rotation.x = -0.5; this.body.add(b); }
            this.body.position.set(0, 0.94, 0); this.bodyGroup.add(this.body);

            this.head = new THREE.Group();
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), fur); skull.scale.set(0.85, 0.8, 1.05); skull.position.set(0, 0.18, 0.14); this.head.add(skull);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 8), fur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.14, 0.42); this.head.add(snout);
            for (const ex of [-0.1, 0.1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 5), fur); ear.position.set(ex, 0.36, 0.04); ear.rotation.x = 0.3; this.head.add(ear); }
            this._eye(this.head, -0.09, 0.2, 0.28, 0.045, p.accent, true);
            this._eye(this.head, 0.09, 0.2, 0.28, 0.045, p.accent, true);
            this.head.position.set(0, 0.98, 0.54); this.bodyGroup.add(this.head);

            this.frontLeft  = this._leg(fur, -0.19, 0.42, 0.86, 0.92, 'pad');
            this.frontRight = this._leg(fur, 0.19, 0.42, 0.86, 0.92, 'pad');
            this.rearLeft   = this._leg(fur, -0.19, -0.44, 0.86, 0.92, 'pad');
            this.rearRight  = this._leg(fur, 0.19, -0.44, 0.86, 0.92, 'pad');
            this.tail = this._tail(fur, 0.94, -0.62, 5, 0.8, -0.5);
            this._wireQuad({ body: this.body, head: this.head, fl: this.frontLeft, fr: this.frontRight, rl: this.rearLeft, rr: this.rearRight, tail: this.tail });
        }

        animatePose(deltaTime) {
            if (this._baseY === null) this._baseY = this.model.position.y;
            const t = this.animTime, anim = this.currentAnimation;
            let growth = 1.0;
            if (anim === 'spawn') growth = Math.min(1.0, t / 0.7);
            this.applyModelScale(growth);
            const fast = (anim === 'attack' || anim === 'specialattack');

            if (this.variant === 'ape' || this.variant === 'bst_maleficentape' || this.variant === 'bst_organgrindermonkey' || this.variant === 'bst_treemonkey') { this._animApe(t, anim, fast); return; }

            // Quadruped gait: diagonal leg pairs swing in anti-phase, faster on attack.
            const gait = fast ? 9 : 2.4;
            const amp = fast ? 0.5 : (anim === 'hit' ? 0.0 : 0.2);
            const sw = (leg, ph) => { if (leg && leg.visible) leg.rotation.x = Math.sin(t * gait + ph) * amp; };
            sw(this.frontLeft, 0); sw(this.rearRight, 0);
            sw(this.frontRight, Math.PI); sw(this.rearLeft, Math.PI);

            const hitJolt = anim === 'hit' ? Math.sin(t * 26) * Math.exp(-t * 6) * 0.15 : 0;
            this.model.position.y = this._baseY + Math.abs(Math.sin(t * gait)) * (fast ? 0.1 : 0.025) * this.scale;
            this.model.rotation.z = hitJolt;
            if (this.tail && this.tail.visible) this.tail.rotation.z = Math.sin(t * 3) * 0.25;
            if (this.head && this.head.visible) this.head.rotation.x = Math.sin(t * 1.6) * 0.05;

            // Per-variant flavour (kept off model.rotation.x, which the base owns).
            switch (this.variant) {
                case 'bear':
                    if (fast) this.model.position.y += Math.max(0, Math.sin(Math.min(t * 6, Math.PI))) * 0.18 * this.scale;
                    if (this.head && fast) this.head.rotation.x = -0.3 + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'wolf':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.22 : 0.0) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'bigcat':
                    if (fast) { const c = Math.max(0, Math.sin(Math.min(t * 7, Math.PI))); this.model.position.y += c * 0.28 * this.scale; }
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * 4) * 0.2;
                    break;
                case 'boar':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.3 : 0.0) + Math.sin(t * 1.6) * 0.04;
                    break;
                case 'ungulate':
                    if (this.head && this.head.visible && fast) this.head.rotation.x = Math.sin(Math.min(t * 8, Math.PI)) * 0.5;
                    break;
                case 'fieldmouse':
                case 'forestrat':
                case 'giantrat':
                case 'sewerrat':
                case 'swamprat':
                case 'frostraccoon':
                case 'nightraccoon':
                case 'woodsquirrel':
                case 'armoredbeaver':
                case 'wastelandbeaver':
                case 'spikeyporcupine':
                case 'plaguerattus':
                case 'rodent': {
                    this.model.position.x = Math.sin(t * 9) * 0.03 * this.scale;
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 7) * 0.08;
                    break;
                }
                case 'caffeinatedsquirrel':
                    // Espresso jitters: violent twitch on every axis.
                    this.model.position.x = Math.sin(t * 28) * 0.05 * this.scale;
                    this.model.position.y = this._baseY + Math.abs(Math.sin(t * 22)) * 0.04 * this.scale;
                    if (this.head && this.head.visible) { this.head.rotation.z = Math.sin(t * 24) * 0.18; this.head.rotation.x = Math.sin(t * 19) * 0.12; }
                    if (this.tail && this.tail.visible) this.tail.rotation.x = -0.35 + Math.sin(t * 16) * 0.2;
                    break;
                case 'armoredporcupine':
                    // Curls and spins into a death ball on the attack.
                    if (fast) this.model.rotation.y += 0.5;
                    else if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 6) * 0.07;
                    break;
                case 'ratking':
                    // Heads writhe out of sync; the swarm never stills.
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 7) * 0.08;
                    if (this._extraHeads) this._extraHeads.forEach((h, i) => { if (h.visible) { h.rotation.z = Math.sin(t * (3 + i) + i * 1.6) * 0.18; h.rotation.x = Math.sin(t * 2.4 + i) * 0.1; } });
                    this.model.position.x = Math.sin(t * 5) * 0.02 * this.scale;
                    break;
                case 'molerodent':
                case 'tunnelingmole':
                    // Snuffling head bob and digging-paw paddle.
                    if (this.head && this.head.visible) this.head.rotation.x = Math.sin(t * 5) * 0.12;
                    [this.frontLeft, this.frontRight].forEach((l, i) => { if (l && l.visible) l.rotation.x = Math.sin(t * (fast ? 14 : 6) + i * Math.PI) * 0.4; });
                    break;
                case 'icelemming':
                    // Trembles harder as it nears its explosive end.
                    this.model.position.x = Math.sin(t * 30) * (fast ? 0.06 : 0.03) * this.scale;
                    this.model.rotation.z = Math.sin(t * 26) * 0.05;
                    break;
                case 'chromaticmanticore':
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 2) * 0.06;
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * 3.5) * 0.3;
                    break;
                case 'giantsnail':
                    // Extremely slow, swaying eyestalks.
                    if (this.head && this.head.visible) { this.head.rotation.z = Math.sin(t * 0.8) * 0.12; this.head.rotation.x = Math.sin(t * 0.6) * 0.06; }
                    this.model.position.y = this._baseY + Math.sin(t * 0.7) * 0.01 * this.scale;
                    break;
                case 'infernalcerberus':
                    // Heads sway out of sync, flame flicker.
                    if (this.head && this.head.visible) this.head.children.forEach((h, i) => { h.rotation.x = Math.sin(t * 2 + i * 1.7) * 0.1; });
                    break;
                case 'junglepredator':
                    if (this.head && this.head.visible) this.head.rotation.x = Math.sin(t * 2.5) * 0.12;
                    break;
                case 'mianni':
                    // Defies physics: chaotic floaty wobble.
                    this.model.position.y = this._baseY + Math.sin(t * 3) * 0.08 * this.scale;
                    this.model.rotation.z = Math.sin(t * 1.7) * 0.08;
                    if (this.head && this.head.visible) this.head.rotation.y = Math.sin(t * 2.3) * 0.4;
                    [this.frontLeft, this.frontRight, this.rearLeft, this.rearRight].forEach((l, i) => { if (l && l.visible) l.position.y += Math.sin(t * 4 + i * 1.5) * 0.01 * this.scale; });
                    break;
                case 'palettephantom':
                    // Drifting spectral hover with hue-cycling glow.
                    this.model.position.y = this._baseY + Math.sin(t * 1.4) * 0.04 * this.scale;
                    this.body.children.forEach((c, i) => { if (c.material && c.material.emissive) c.material.emissive.setHSL((t * 0.2 + i * 0.13) % 1, 0.9, 0.5); });
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * 4) * 0.25;
                    break;
                case 'radiantunicorn':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? -0.2 : 0.0) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'tempestpegasus':
                    // Spinning tail vortex + wing flap.
                    if (this.tail && this.tail.visible) this.tail.rotation.y = t * 6;
                    this.body.children.forEach((c) => { if (c.type === 'Group') c.rotation.z = Math.sin(t * (fast ? 10 : 3)) * 0.25; });
                    if (fast) this.model.position.y += Math.max(0, Math.sin(Math.min(t * 6, Math.PI))) * 0.22 * this.scale;
                    break;
                case 'rhinobeetle':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? -0.35 : 0.0) + Math.sin(t * 2) * 0.04;
                    break;
                case 'rummagingopossum':
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 6) * 0.1;
                    break;
                case 'beast666':
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 1.8) * 0.06;
                    this.body.children.forEach((c) => { if (c.material && c.material.emissive && c.geometry && c.geometry.type === 'TorusGeometry') c.material.emissiveIntensity = 0.5 + Math.sin(t * 5) * 0.4; });
                    break;
                case 'velocicorn':
                    // Twitchy, fast head bob; horn lowers on charge.
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? -0.35 : 0.0) + Math.sin(t * 4) * 0.06;
                    break;
                case 'swampleviathan':
                    // Heavy ground-shaking lurch.
                    this.model.position.y = this._baseY + Math.abs(Math.sin(t * (fast ? 5 : 1.4))) * 0.05 * this.scale;
                    this.model.rotation.z = Math.sin(t * 1.4) * 0.03;
                    if (this.head && this.head.visible) this.head.rotation.x = Math.sin(t * 1.2) * 0.06;
                    break;
                case 'invertedhunger':
                    // Pulsing maw that breathes in and out.
                    { const pulse = 1.0 + Math.sin(t * 3) * 0.08; if (this.body) this.body.scale.set(pulse, pulse, 1.0); }
                    if (this.head && this.head.visible) this.head.position.z = 0.05 + Math.sin(t * 3) * 0.06;
                    break;
                case 'voidhowler':
                    // Writhing tendrils + howl head-raise; flickering void glow.
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? -0.4 : -0.15) + Math.sin(t * 1.6) * 0.06;
                    this.body.children.forEach((c, i) => { if (c.geometry && c.geometry.type === 'ConeGeometry') c.rotation.z += Math.sin(t * 2 + i) * 0.01; });
                    break;
                case 'feastoffamine':
                    // Regenerating dishes quiver; face glances around.
                    this.body.children.forEach((c, i) => { if (c.geometry && c.geometry.type === 'SphereGeometry') c.scale.y = 0.7 + Math.sin(t * 4 + i * 1.3) * 0.12; });
                    if (this.head && this.head.visible) this.head.rotation.y = Math.sin(t * 2) * 0.3;
                    break;
                case 'maternityward':
                    // Belly heaves; broodlings squirm.
                    if (this.body) { const h = 1.0 + Math.sin(t * 2.2) * 0.05; this.body.scale.set(1, h, 1); }
                    this.body.children.forEach((c, i) => { if (c.geometry && c.geometry.type === 'SphereGeometry' && c.position.z > 0.3) c.position.z = 0.42 + Math.sin(t * 5 + i * 2) * 0.04; });
                    if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 1.5) * 0.08;
                    break;
                case 'starvingsabercat':
                case 'ferallynx':
                    if (fast) { const c = Math.max(0, Math.sin(Math.min(t * 7, Math.PI))); this.model.position.y += c * 0.26 * this.scale; }
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.25 : 0.0) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'ashenprowler':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.22 : -0.05) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'gauntclawrunner':
                case 'feralridgeback':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.2 : -0.05) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'bloodmawdirewolf':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.24 : 0.0) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'gauntlynx':
                    if (fast) { const c = Math.max(0, Math.sin(Math.min(t * 7, Math.PI))); this.model.position.y += c * 0.24 * this.scale; }
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.22 : 0.0) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'starvinggnasher':
                case 'gauntsnapper':
                case 'diregnasher':
                    // Jaw chomp: lower jaw box (the 2nd head child) gnashes open and shut.
                    if (this.head && this.head.visible) { const lower = this.head.children[2]; if (lower) lower.position.y = -0.15 - Math.abs(Math.sin(t * (fast ? 12 : 4))) * 0.1; this.head.rotation.x = (fast ? 0.18 : 0.0) + Math.sin(t * 1.6) * 0.05; }
                    break;
                case 'holloweyedboar':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.3 : 0.0) + Math.sin(t * 1.6) * 0.04;
                    break;
                // ── Bespoke canids: canine head-lower lunge ─────────────────
                case 'bst_arcticfox':
                case 'bst_cottonfox':
                case 'bst_icewolfpup':
                case 'bst_graywolf':
                case 'bst_manedterrorwolf':
                case 'bst_redfox':
                case 'bst_alphadirewolf':
                case 'bst_alphawarg':
                case 'bst_arcticwolf':
                case 'bst_rabidcoyote':
                case 'bst_scavengingcoyote':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.24 : 0.0) + Math.sin(t * 1.6) * 0.05;
                    break;
                case 'bst_rabidhyena':
                case 'bst_feralhyenapack':
                    // Hunched cackling bob, quicker head jitter.
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.2 : 0.0) + Math.sin(t * 3.2) * 0.06;
                    this.model.position.y = this._baseY + Math.abs(Math.sin(t * gait)) * (fast ? 0.1 : 0.025) * this.scale;
                    break;
                // ── Bespoke felines: pounce crouch + tail lash ──────────────
                case 'bst_lazycat':
                    // Barely moves; a lazy tail flick.
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * 1.2) * 0.3;
                    break;
                case 'bst_feralalleycat':
                    // Skittish: quick head snaps, a fast flicking tail, and a
                    // low crouch before it springs.
                    if (fast) { const c = Math.max(0, Math.sin(Math.min(t * 8, Math.PI))); this.model.position.y += c * 0.22 * this.scale; }
                    if (this.head && this.head.visible) { this.head.rotation.y = Math.sin(t * 2.6) * 0.35; this.head.rotation.x = (fast ? 0.2 : -0.08); }
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * 6) * 0.3;
                    break;
                case 'bst_blackpanther':
                case 'bst_reflectivetiger':
                case 'bst_sabercat':
                case 'bst_wildcat':
                case 'bst_goldenlion':
                case 'bst_stripedtiger':
                case 'bst_umbrapanthera':
                case 'bst_mysticpanther':
                case 'bst_sabertoothalpha':
                case 'bst_diresabertoothalpha':
                    if (fast) { const c = Math.max(0, Math.sin(Math.min(t * 7, Math.PI))); this.model.position.y += c * 0.26 * this.scale; }
                    if (this.tail && this.tail.visible) this.tail.rotation.x = Math.sin(t * 4) * 0.2;
                    break;
                // ── Bespoke ungulates: nervous graze / charge head-toss ─────
                case 'bst_thirstycamel':
                case 'bst_foreststag':
                case 'bst_pastoralsheep':
                case 'bst_armoredrhinoceros':
                case 'bst_bloodbellcow':
                case 'bst_deersprite':
                case 'bst_hollowgoat':
                case 'bst_ironhoofcharger':
                case 'bst_rancorousbull':
                case 'bst_titanotherealpha':
                    if (this.head && this.head.visible && fast) this.head.rotation.x = Math.sin(Math.min(t * 8, Math.PI)) * 0.5;
                    break;
                // ── Bespoke ursids: rear-up slam on attack ──────────────────
                case 'bst_brownbear':
                case 'bst_hornedbear':
                case 'bst_youngyeti':
                case 'bst_frostbackursid':
                case 'bst_panda':
                case 'bst_polarbear':
                case 'bst_timewornowlbear':
                case 'bst_demonbear':
                case 'bst_kodiakbear':
                case 'bst_emberclawbear':
                case 'bst_frostfangbear':
                case 'bst_thundermawursine':
                case 'bst_titaniccavebear':
                    if (fast) this.model.position.y += Math.max(0, Math.sin(Math.min(t * 6, Math.PI))) * 0.18 * this.scale;
                    if (this.head && fast) this.head.rotation.x = -0.3 + Math.sin(t * 1.6) * 0.05;
                    break;
                // ── Bespoke suids: head-down gore, flap for flyers ──────────
                case 'bst_flyingpig':
                case 'bst_flyingpig2':
                    if (this._wings) this._wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * (0.3 + Math.sin(t * (fast ? 12 : 6)) * 0.4); });
                    this.model.position.y = this._baseY + Math.sin(t * 2.5) * 0.06 * this.scale;
                    break;
                case 'bst_direpig':
                case 'bst_razorbackboar':
                case 'bst_wildboar':
                case 'bst_normalpig':
                case 'bst_madboar':
                    if (this.head && this.head.visible) this.head.rotation.x = (fast ? 0.3 : 0.0) + Math.sin(t * 1.6) * 0.04;
                    break;
            }
        }

        _animApe(t, anim, fast) {
            this.model.position.y = this._baseY + Math.sin(t * 1.6) * 0.03 * this.scale;
            const swing = fast ? Math.sin(t * 11) * 0.6 : Math.sin(t * 2.2) * 0.18;
            if (this.leftArm) this.leftArm.rotation.x = swing;
            if (this.rightArm) this.rightArm.rotation.x = -swing;
            // Chest-beat on a special attack.
            if (anim === 'specialattack') {
                const beat = Math.abs(Math.sin(t * 14));
                if (this.leftArm) this.leftArm.rotation.x = -0.6 - beat * 0.5;
                if (this.rightArm) this.rightArm.rotation.x = -0.6 - beat * 0.5;
            }
            if (this.leftLeg) this.leftLeg.rotation.x = Math.sin(t * 2.2) * 0.08;
            if (this.rightLeg) this.rightLeg.rotation.x = -Math.sin(t * 2.2) * 0.08;
            if (this.head && this.head.visible) this.head.rotation.z = Math.sin(t * 1.4) * 0.05;
            this.model.rotation.z = anim === 'hit' ? Math.sin(t * 26) * Math.exp(-t * 6) * 0.12 : 0;
        }

        deathPose(deltaTime) {
            const t = this.animTime, prog = Math.min(1.0, t / 1.1);
            for (const mat of this._materials) mat.opacity = Math.min(mat.opacity, 1.0 - prog);
            if (this._baseY === null) this._baseY = this.model.position.y;
            this.model.position.y = this._baseY - prog * 0.35 * this.scale;
            this.model.rotation.z = prog * (this.variant === 'ape' ? 0.9 : 1.4);
        }
    }

    const make = (scale, offsetY, enemy, weaponType, key) =>
        new BeastBattler3D(scale, offsetY, enemy, weaponType, key);

    const reg = window.Battler3D.registerArchetype;
    const S = B_PROFILES;
    // These override the matching tokens previously owned by the generic `beast`
    // quadruped (this file loads after Quadruped). Unlisted tokens (badger,
    // skunk, opossum, kangaroo, weasel, wolverine, ...) keep the generic rig.
    reg('bear',     { aliases: ['bear', 'bears', 'ursid', 'ursine', 'ursus', 'owlbear', 'yeti', 'panda'], scale: S.bear.scale, weapon: 0, create: make });
    reg('wolf',     { aliases: ['wolf', 'wolves', 'warg', 'wargs', 'coyote', 'hyena', 'hyenas', 'jackal', 'dingo', 'fox', 'foxes', 'vixen'], scale: S.wolf.scale, weapon: 0, create: make });
    reg('bigcat',   { aliases: ['bigcat', 'cat', 'cats', 'panther', 'panthera', 'tiger', 'tigers', 'lion', 'lions', 'lioness', 'leopard', 'jaguar', 'lynx', 'cougar', 'puma', 'wildcat', 'sabertooth', 'saber', 'ocelot', 'cheetah', 'feline'], scale: S.bigcat.scale, weapon: 0, create: make });
    reg('boar',     { aliases: ['boar', 'boars', 'pig', 'pigs', 'hog', 'hogs', 'swine', 'razorback', 'warthog', 'sow'], scale: S.boar.scale, weapon: 0, create: make });
    reg('rodent',   { aliases: ['rodent', 'rat', 'rats', 'rattus', 'mouse', 'mice', 'squirrel', 'raccoon', 'mole', 'beaver', 'porcupine', 'purcupine', 'lemming', 'vermin', 'chipmunk', 'hamster', 'gopher', 'gerbil'], scale: S.rodent.scale, weapon: 0, create: make });
    reg('ungulate', { aliases: ['ungulate', 'stag', 'deer', 'elk', 'moose', 'bull', 'bulls', 'ox', 'oxen', 'cow', 'cows', 'bovine', 'bison', 'buffalo', 'goat', 'goats', 'ram', 'sheep', 'rhino', 'rhinoceros', 'camel', 'antelope', 'gazelle', 'charger', 'titanothere'], scale: S.ungulate.scale, weapon: 0, create: make });
    reg('ape',      { aliases: ['ape', 'apes', 'monkey', 'monkeys', 'gorilla', 'primate', 'chimp', 'chimpanzee', 'baboon', 'simian'], scale: S.ape.scale, weapon: 0, create: make });
    reg('chromaticmanticore', { aliases: ['chromaticmanticore'], scale: S.chromaticmanticore.scale, weapon: 0, create: make });
    reg('chupacabra',         { aliases: ['chupacabra'], scale: S.chupacabra.scale, weapon: 0, create: make });
    reg('giantsnail',         { aliases: ['giantsnail'], scale: S.giantsnail.scale, weapon: 0, create: make });
    reg('infernalcerberus',   { aliases: ['infernalcerberus'], scale: S.infernalcerberus.scale, weapon: 0, create: make });
    reg('junglepredator',     { aliases: ['junglepredator'], scale: S.junglepredator.scale, weapon: 0, create: make });
    reg('mianni',             { aliases: ['mianni'], scale: S.mianni.scale, weapon: 0, create: make });
    reg('palettephantom',     { aliases: ['palettephantom'], scale: S.palettephantom.scale, weapon: 0, create: make });
    reg('radiantunicorn',     { aliases: ['radiantunicorn'], scale: S.radiantunicorn.scale, weapon: 0, create: make });
    reg('rhinobeetle',        { aliases: ['rhinobeetle'], scale: S.rhinobeetle.scale, weapon: 0, create: make });
    reg('rummagingopossum',   { aliases: ['rummagingopossum'], scale: S.rummagingopossum.scale, weapon: 0, create: make });
    reg('beast666',           { aliases: ['beast666'], scale: S.beast666.scale, weapon: 0, create: make });
    reg('tempestpegasus',     { aliases: ['tempestpegasus'], scale: S.tempestpegasus.scale, weapon: 0, create: make });
    reg('velocicorn',         { aliases: ['velocicorn'], scale: S.velocicorn.scale, weapon: 0, create: make });
    reg('swampleviathan',     { aliases: ['swampleviathan'], scale: S.swampleviathan.scale, weapon: 0, create: make });
    reg('invertedhunger',     { aliases: ['invertedhunger'], scale: S.invertedhunger.scale, weapon: 0, create: make });
    reg('voidhowler',         { aliases: ['voidhowler'], scale: S.voidhowler.scale, weapon: 0, create: make });
    reg('feastoffamine',      { aliases: ['feastoffamine'], scale: S.feastoffamine.scale, weapon: 0, create: make });
    reg('maternityward',      { aliases: ['maternityward'], scale: S.maternityward.scale, weapon: 0, create: make });
    reg('starvingsabercat',   { aliases: ['starvingsabercat'], scale: S.starvingsabercat.scale, weapon: 0, create: make });
    reg('ashenprowler',       { aliases: ['ashenprowler'], scale: S.ashenprowler.scale, weapon: 0, create: make });
    reg('gauntsnapper',       { aliases: ['gauntsnapper'], scale: S.gauntsnapper.scale, weapon: 0, create: make });
    reg('holloweyedboar',     { aliases: ['holloweyedboar'], scale: S.holloweyedboar.scale, weapon: 0, create: make });
    reg('ferallynx',          { aliases: ['ferallynx'], scale: S.ferallynx.scale, weapon: 0, create: make });
    reg('diregnasher',        { aliases: ['diregnasher'], scale: S.diregnasher.scale, weapon: 0, create: make });
    reg('gauntclawrunner',    { aliases: ['gauntclawrunner'], scale: S.gauntclawrunner.scale, weapon: 0, create: make });
    reg('bloodmawdirewolf',   { aliases: ['bloodmawdirewolf'], scale: S.bloodmawdirewolf.scale, weapon: 0, create: make });
    reg('gauntlynx',          { aliases: ['gauntlynx'], scale: S.gauntlynx.scale, weapon: 0, create: make });
    reg('feralbadger',        { aliases: ['feralbadger'], scale: S.feralbadger.scale, weapon: 0, create: make });
    reg('starvinggnasher',    { aliases: ['starvinggnasher'], scale: S.starvinggnasher.scale, weapon: 0, create: make });
    reg('feralridgeback',     { aliases: ['feralridgeback'], scale: S.feralridgeback.scale, weapon: 0, create: make });
    ["bf_packboar","bf_packripper","bf_stormgnasher","bf_lonejackal","bf_rabidlynx","bf_threetailedlynx","bf_rabidbadger","bf_mangyridgeback","bf_mudcakedgnasher","bf_mudcakedprowler","bf_threetailedhornbeast","bf_feralprowler","bf_frosthornbeast","bf_ironfangeddirewolf","bf_mangyhowler","bf_ashendirewolf","bf_ironfangedmawhound","bf_packridgeback","bf_cinderthornhide","bf_packclawrunner","bf_packhornbeast","bf_gauntripper","bf_bloodmawmawhound","bf_threetailedboar","bf_mudcakedripper","bf_cinderdirewolf","bf_direclawrunner","bf_packjackal","bf_stormhowler","bf_starvingclawrunner","bf_scarredclawrunner","bf_mangystalkhound","bf_mudcakedclawrunner","bf_scarredbristleback","bf_packlynx","bf_holloweyedsnapper","bf_ironfangedhornbeast","bf_holloweyedbristleback"].forEach(k => reg(k, { aliases: [k], scale: S[k].scale, weapon: 0, create: make }));
    // Rodent one-offs (narrow aliases; pinned by exact name below).
    reg('armoredbeaver',       { aliases: ['armoredbeaver'],       scale: S.armoredbeaver.scale,       weapon: 0, create: make });
    reg('wastelandbeaver',     { aliases: ['wastelandbeaver'],     scale: S.wastelandbeaver.scale,     weapon: 0, create: make });
    reg('armoredporcupine',    { aliases: ['armoredporcupine'],    scale: S.armoredporcupine.scale,    weapon: 0, create: make });
    reg('spikeyporcupine',     { aliases: ['spikeyporcupine'],     scale: S.spikeyporcupine.scale,     weapon: 0, create: make });
    reg('caffeinatedsquirrel', { aliases: ['caffeinatedsquirrel'], scale: S.caffeinatedsquirrel.scale, weapon: 0, create: make });
    reg('woodsquirrel',        { aliases: ['woodsquirrel'],        scale: S.woodsquirrel.scale,        weapon: 0, create: make });
    reg('fieldmouse',          { aliases: ['fieldmouse'],          scale: S.fieldmouse.scale,          weapon: 0, create: make });
    reg('forestrat',           { aliases: ['forestrat'],           scale: S.forestrat.scale,           weapon: 0, create: make });
    reg('giantrat',            { aliases: ['giantrat'],            scale: S.giantrat.scale,            weapon: 0, create: make });
    reg('sewerrat',            { aliases: ['sewerrat'],            scale: S.sewerrat.scale,            weapon: 0, create: make });
    reg('swamprat',            { aliases: ['swamprat'],            scale: S.swamprat.scale,            weapon: 0, create: make });
    reg('plaguerattus',        { aliases: ['plaguerattus'],        scale: S.plaguerattus.scale,        weapon: 0, create: make });
    reg('ratking',             { aliases: ['ratking'],             scale: S.ratking.scale,             weapon: 0, create: make });
    reg('frostraccoon',        { aliases: ['frostraccoon'],        scale: S.frostraccoon.scale,        weapon: 0, create: make });
    reg('nightraccoon',        { aliases: ['nightraccoon'],        scale: S.nightraccoon.scale,        weapon: 0, create: make });
    reg('molerodent',          { aliases: ['molerodent'],          scale: S.molerodent.scale,          weapon: 0, create: make });
    reg('tunnelingmole',       { aliases: ['tunnelingmole'],       scale: S.tunnelingmole.scale,       weapon: 0, create: make });
    reg('icelemming',          { aliases: ['icelemming'],          scale: S.icelemming.scale,          weapon: 0, create: make });
    // Bespoke Beast splits (narrow aliases; pinned by exact name below).
    ["bst_arcticfox","bst_cottonfox","bst_icewolfpup","bst_rabidhyena","bst_feralhyenapack","bst_graywolf","bst_manedterrorwolf","bst_redfox","bst_alphadirewolf","bst_alphawarg","bst_arcticwolf","bst_rabidcoyote","bst_scavengingcoyote","bst_lazycat","bst_blackpanther","bst_reflectivetiger","bst_sabercat","bst_wildcat","bst_feralalleycat","bst_goldenlion","bst_stripedtiger","bst_umbrapanthera","bst_mysticpanther","bst_sabertoothalpha","bst_diresabertoothalpha","bst_thirstycamel","bst_foreststag","bst_pastoralsheep","bst_armoredrhinoceros","bst_bloodbellcow","bst_deersprite","bst_hollowgoat","bst_ironhoofcharger","bst_rancorousbull","bst_titanotherealpha","bst_brownbear","bst_hornedbear","bst_youngyeti","bst_frostbackursid","bst_panda","bst_polarbear","bst_timewornowlbear","bst_demonbear","bst_kodiakbear","bst_emberclawbear","bst_frostfangbear","bst_thundermawursine","bst_titaniccavebear","bst_direpig","bst_flyingpig","bst_razorbackboar","bst_wildboar","bst_flyingpig2","bst_normalpig","bst_madboar","bst_maleficentape","bst_organgrindermonkey","bst_treemonkey"].forEach(k => reg(k, { aliases: [k], scale: S[k].scale, weapon: 0, create: make }));

    //=========================================================================
    // Name assignments. Every "beast" enemy carries <Archetype: Beast>, which
    // the core resolves BEFORE name-token aliases, so the aliases above alone
    // would never fire for them. registerNamed outranks the Archetype meta, so
    // we pin each Beast-tagged enemy to its specific body plan here. Names
    // already claimed by a bespoke model elsewhere (Behemoth Gorilla -> colossus,
    // Bull Wyvern -> dragon, ...) are intentionally omitted; the unmatched rest
    // (badger, skunk, opossum, kangaroo, unicorn, ...) keep the generic Quadruped
    // beast rig.
    const NAMED = {
        // Bear/wolf/bigcat/boar/ungulate/ape names split into bespoke bst_ rigs below.
        bear: [],
        wolf: [],
        bigcat: [],
        boar: [],
        // ── Bespoke canid pins ──────────────────────────────────────────────
        bst_arcticfox: ["Arctic Fox"],
        bst_cottonfox: ["Cotton Fox"],
        bst_icewolfpup: ["Ice Wolf Pup"],
        bst_rabidhyena: ["Rabid Hyena"],
        bst_feralhyenapack: ["Feral Hyena Pack"],
        bst_graywolf: ["Gray Wolf"],
        bst_manedterrorwolf: ["Maned Terror Wolf"],
        bst_redfox: ["Red Fox"],
        bst_alphadirewolf: ["Alpha Dire Wolf"],
        bst_alphawarg: ["Alpha Warg"],
        bst_arcticwolf: ["Arctic Wolf"],
        bst_rabidcoyote: ["Rabid Coyote"],
        bst_scavengingcoyote: ["Scavenging Coyote"],
        // ── Bespoke feline pins ─────────────────────────────────────────────
        bst_lazycat: ["Lazy Cat"],
        bst_blackpanther: ["Black Panther"],
        bst_reflectivetiger: ["Reflective Tiger"],
        bst_sabercat: ["Saber Cat"],
        bst_wildcat: ["Wildcat"],
        bst_feralalleycat: ["Feral Alley Cat"],
        bst_goldenlion: ["Golden Lion"],
        bst_stripedtiger: ["Striped Tiger"],
        bst_umbrapanthera: ["Umbra Panthera"],
        bst_mysticpanther: ["Mystic Panther"],
        bst_sabertoothalpha: ["Sabertooth Alpha"],
        bst_diresabertoothalpha: ["Dire Saber-tooth Alpha"],
        // ── Bespoke ungulate pins ───────────────────────────────────────────
        bst_thirstycamel: ["Thirsty Camel"],
        bst_foreststag: ["Forest Stag"],
        bst_pastoralsheep: ["Pastoral Sheep"],
        bst_armoredrhinoceros: ["Armored Rhinoceros"],
        bst_bloodbellcow: ["Bloodbell Cow"],
        bst_deersprite: ["Deer Sprite"],
        bst_hollowgoat: ["Hollow Goat"],
        bst_ironhoofcharger: ["Ironhoof Charger"],
        bst_rancorousbull: ["Rancorous Bull"],
        bst_titanotherealpha: ["Titanothere Alpha"],
        // ── Bespoke ursid pins ──────────────────────────────────────────────
        bst_brownbear: ["Brown Bear"],
        bst_hornedbear: ["Horned Bear"],
        bst_youngyeti: ["Young Yeti"],
        bst_frostbackursid: ["Frostback Ursid"],
        bst_panda: ["Panda"],
        bst_polarbear: ["Polar Bear"],
        bst_timewornowlbear: ["Timeworn Owlbear"],
        bst_demonbear: ["Demon Bear"],
        bst_kodiakbear: ["Kodiak Bear"],
        bst_emberclawbear: ["Emberclaw Bear"],
        bst_frostfangbear: ["Frostfang Bear"],
        bst_thundermawursine: ["Thundermaw Ursine"],
        bst_titaniccavebear: ["Titanic Cave Bear"],
        // ── Bespoke suid pins ───────────────────────────────────────────────
        bst_direpig: ["Dire Pig"],
        bst_flyingpig: ["Flying pig"],
        bst_razorbackboar: ["Razorback Boar"],
        bst_wildboar: ["Wild Boar"],
        bst_flyingpig2: ["Flying Pig"],
        bst_normalpig: ["Normal pig"],
        bst_madboar: ["Mad Boar"],
        // ── Bespoke primate pins ────────────────────────────────────────────
        bst_maleficentape: ["Maleficent Ape"],
        bst_organgrindermonkey: ["Organ Grinder Monkey"],
        bst_treemonkey: ["Tree Monkey"],
        // Each former generic `rodent` enemy now has its own bespoke body plan.
        armoredbeaver: ["Armored Beaver"],
        wastelandbeaver: ["Wasteland Beaver"],
        armoredporcupine: ["Armored Purcupine"],
        spikeyporcupine: ["Spikey Porcupine"],
        caffeinatedsquirrel: ["Caffeinated Squirrel"],
        woodsquirrel: ["Squirrel"],
        fieldmouse: ["Field Mouse"],
        forestrat: ["Forest Rat"],
        giantrat: ["Giant Rat"],
        sewerrat: ["Sewer Rat"],
        swamprat: ["Swamp Rat"],
        plaguerattus: ["Plaguebro Rattus"],
        ratking: ["Rat King"],
        frostraccoon: ["Frost Raccoon"],
        nightraccoon: ["Night Raccoon"],
        molerodent: ["Mole"],
        tunnelingmole: ["Tunneling Mole"],
        icelemming: ["Ice Lemming"],
        ungulate: [],
        ape: [],
        chromaticmanticore: ["Chromatic Manticore"],
        chupacabra: ["Chupacabra Fiend"],
        giantsnail: ["Giant Slithering Snail"],
        infernalcerberus: ["Infernal Cerberus"],
        junglepredator: ["Jungle Predator"],
        mianni: ["Mianni"],
        palettephantom: ["Palette Phantom"],
        radiantunicorn: ["Radiant Unicorn"],
        rhinobeetle: ["Rhinobeetle"],
        rummagingopossum: ["Rummaging Opossum"],
        beast666: ["Beast 666"],
        tempestpegasus: ["Tempest Pegasus"],
        velocicorn: ["Velocicorn"],
        swampleviathan: ["Swamp Leviathan"],
        invertedhunger: ["Inverted Hunger"],
        voidhowler: ["Void Howler"],
        feastoffamine: ["Feast of Famine"],
        maternityward: ["Maternity Ward"],
        starvingsabercat: ["Starving Saber-Cat"],
        ashenprowler: ["Ashen Prowler"],
        gauntsnapper: ["Gaunt Snapper"],
        holloweyedboar: ["Hollow-Eyed Boar"],
        ferallynx: ["Feral Lynx"],
        diregnasher: ["Dire Gnasher"],
        gauntclawrunner: ["Gaunt Clawrunner"],
        bloodmawdirewolf: ["Bloodmaw Direwolf"],
        gauntlynx: ["Gaunt Lynx"],
        feralbadger: ["Feral Badger"],
        starvinggnasher: ["Starving Gnasher"],
        feralridgeback: ["Feral Ridgeback"],
    };
    if (window.Battler3D.registerNamed) {
        for (const key in NAMED) NAMED[key].forEach(n => window.Battler3D.registerNamed(n, key));
    }

    debugLog('Beasts family registered');
})();
