'use strict';
/**
 * Game modes and scoring (pure functions — easy to read, test and tweak).
 * Points are never negative: a miss only means sitting out the scoring.
 *
 *  Зум (Zoom, precision)      Pick a precision tier first (+3 / +6 / +10), then one of four cards
 *                             from that tier only. Right at your tier = its points, wrong = 0.
 *  Ұшқын (Spark, connections) Three clues → one typed answer. 10 points if instant, falling to 2
 *                             at the buzzer. A wrong try freezes you for a few seconds.
 *  Күйген жер (Scorched Earth) One category, three waves. Each wave type ONE answer: unique valid
 *                             answers score 3 / 4 / 5; the same answer from two players in one wave
 *                             scores 0; every answer given is burned for the rest of the round.
 *                             Unique answers in all three waves: +3 bonus.
 *  Финал (Final)              The last three rounds score ×2.
 *  Аралас (Mix)               Zoom act → Spark act → Scorched Earth act → final.
 */

const MODES = {
  zoom: { id: 'zoom', name: 'Зум' },
  spark: { id: 'spark', name: 'Ұшқын' },
  scorched: { id: 'scorched', name: 'Күйген жер' },
  mix: { id: 'mix', name: 'Аралас' },
};
const ROUND_TYPES = ['zoom', 'spark', 'scorched'];

const FINAL_MULTIPLIER = 2;
const ZOOM = { points: [3, 6, 10] };
const SPARK = { max: 10, min: 2, freezeMs: 4000, maxAttempts: 15 };
const SCORCHED = { wavePoints: [3, 4, 5], flawlessBonus: 3, waves: 3 };

/** Zoom: points for a player's (tier, choice). */
function zoomPoints(round, rec) {
  if (rec?.tier == null || rec.choice == null) return 0;
  const t = round.tiers[rec.tier];
  return rec.choice === t.correct ? t.points : 0;
}

/** Spark: points for finding the answer `foundMs` into a `limitMs` window. */
function sparkPoints(foundMs, limitMs) {
  if (foundMs == null || !(limitMs > 0)) return 0;
  const k = Math.min(1, Math.max(0, 1 - foundMs / limitMs));
  return Math.round(SPARK.min + (SPARK.max - SPARK.min) * k);
}

/**
 * Scorched Earth: resolve one wave.
 * @param {Array<{id:string, idx:number}>} entries  idx = matched item (-1 invalid, null no answer)
 * @param {Set<number>} burned  items burned in earlier waves (mutated: this wave's answers are added)
 * @param {number} wave 0..2
 * @returns {Map<string,{status:'unique'|'dup'|'burned'|'invalid'|'none', points:number}>}
 */
function resolveWave(entries, burned, wave) {
  const counts = new Map();
  for (const e of entries) if (e.idx != null && e.idx >= 0 && !burned.has(e.idx)) counts.set(e.idx, (counts.get(e.idx) || 0) + 1);
  const out = new Map();
  for (const e of entries) {
    let status;
    if (e.idx == null) status = 'none';
    else if (e.idx < 0) status = 'invalid';
    else if (burned.has(e.idx)) status = 'burned';
    else if (counts.get(e.idx) > 1) status = 'dup';
    else status = 'unique';
    out.set(e.id, { status, points: status === 'unique' ? SCORCHED.wavePoints[wave] : 0 });
  }
  for (const idx of counts.keys()) burned.add(idx);
  return out;
}

/** Scorched Earth: round total from per-wave results. */
function scorchedTotal(waves) {
  const base = waves.reduce((s, w) => s + (w?.points || 0), 0);
  const flawless = waves.length === SCORCHED.waves && waves.every((w) => w?.status === 'unique');
  return { base, flawless, total: base + (flawless ? SCORCHED.flawlessBonus : 0) };
}

const applyFinal = (points, final) => points * (final ? FINAL_MULTIPLIER : 1);

module.exports = { MODES, ROUND_TYPES, FINAL_MULTIPLIER, ZOOM, SPARK, SCORCHED, zoomPoints, sparkPoints, resolveWave, scorchedTotal, applyFinal };
