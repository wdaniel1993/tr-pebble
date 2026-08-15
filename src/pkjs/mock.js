/**
 * mock.js — fake payload injector for qemu emulator / offline testing (task 6.1).
 *
 * Generates a deterministic random-walk payload so every UI state and both
 * form factors can be exercised without a live Trade Republic session.
 */
(function (global) {
  'use strict';

  var NAMES = ['1D', '1W', '1M', '1Y', 'MAX'];
  var seed = 42;

  function rnd() {
    // LCG — deterministic across runs
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /** next(prev) -> a new payload with slightly moved values. */
  function next(prev) {
    var total = 10000 + Math.round(rnd() * 8000 * 100) / 100;
    var intervals = [];
    for (var i = 0; i < NAMES.length; i++) {
      var abs = round2((rnd() - 0.48) * total * 0.05);
      var pct = round2(abs / (total - abs) * 100);
      intervals.push({ range: ['1d', '5d', '1m', '1y', 'max'][i], name: NAMES[i], abs: abs, pct: pct });
    }
    return {
      total: total,
      cash: round2(total * 0.12),
      currency: 'EUR',
      intervals: intervals
    };
  }

  global.Mock = { next: next };
})(typeof window !== 'undefined' ? window : this);
