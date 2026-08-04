/*:
 * @target MZ
 * @plugindesc NPCShared v1.0.0, Common utilities for the NPC simulation suite
 * @author Omni-Lex
 * @help
 * ============================================================================
 * NPCShared, single home for helpers the NPC plugins used to copy-paste
 * ============================================================================
 * Exposes window.NPCShared with:
 *   nameHash(str)              djb2-xor string hash (alias: nameToSeed)
 *   Rng                        xorshift32 seeded RNG:
 *                                next()            float in [0,1)
 *                                int(min, max)     integer, max INCLUSIVE
 *                                nextInt(min, max) integer, max EXCLUSIVE
 *                                pick(arr)         random element
 *   worldSeed()                HistoryManager seed, or 19002001 (canon default)
 *   sampleCount(rng, expected) expected-count sampling: rate×days → concrete
 *                              event count without iterating days
 *   clamp(v, min, max)
 *   seededShuffle(arr, rng)    Fisher–Yates returning a new array
 *   escapeHtml(s)
 *
 * The Rng bit stream is identical to the SeededRng / LifeRng / PolRng /
 * WebRng / MiniRng classes it replaces, so existing worlds stay deterministic.
 *
 * Load order: before every other NPC/* plugin.
 * Node-safe: no DOM access; test harnesses require() this file first.
 */

(() => {
  "use strict";

  const DEFAULT_SEED = 19002001;

  function nameHash(str) {
    let h = 5381;
    for (let i = 0; i < String(str).length; i++) h = ((h * 33) ^ String(str).charCodeAt(i)) >>> 0;
    return h || 1;
  }

  class Rng {
    constructor(seed) { this._s = (seed || 1) >>> 0; }
    next() {
      let x = this._s;
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;  x >>>= 0;
      this._s = x;
      return x / 4294967296;
    }
    int(min, max)     { return min + Math.floor(this.next() * (max - min + 1)); }
    nextInt(min, max) { return min + Math.floor(this.next() * (max - min)); }
    pick(arr)         { return arr[Math.floor(this.next() * arr.length)]; }
  }

  function worldSeed() {
    return (window.HistoryManager && window.HistoryManager.getSeed)
      ? window.HistoryManager.getSeed() : DEFAULT_SEED;
  }

  function sampleCount(rng, expected) {
    if (expected <= 0) return 0;
    const base = Math.floor(expected);
    return base + (rng.next() < expected - base ? 1 : 0);
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function seededShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Money is stored in gold, displayed in euros: 100 gold = 1.00€.
  function formatMoney(gold) {
    const eur = Math.floor(Number(gold) || 0) / 100;
    if (eur >= 1_000_000_000) return `${(eur / 1_000_000_000).toFixed(2)}B€`;
    if (eur >= 1_000_000)     return `${(eur / 1_000_000).toFixed(2)}M€`;
    if (eur >= 1_000)         return `${(eur / 1_000).toFixed(1)}K€`;
    return `${eur.toFixed(2)}€`;
  }

  // Older log lines embed raw amounts as "<n>g" ("earned 16g", "42881g saved").
  // Rewrite every such amount into the euro display.
  function goldTextToEuros(text) {
    return String(text ?? "").replace(/(\d[\d,]*)\s*g\b/g, (m, num) =>
      formatMoney(Number(String(num).replace(/,/g, ""))));
  }

  window.NPCShared = {
    DEFAULT_SEED,
    nameHash,
    nameToSeed: nameHash,
    Rng,
    worldSeed,
    sampleCount,
    clamp,
    seededShuffle,
    escapeHtml,
    formatMoney,
    goldTextToEuros,
  };

})();
