'use strict';
/**
 * Content loader for the three modes.
 *  - Zoom (precision): custom 3-tier questions + year questions (century → decade → exact year).
 *  - Spark (connections): three clues → one typed answer.
 *  - Scorched Earth (depth): a category with many valid answers.
 * Era files live in ./data/*.json; Scorched Earth categories in ./scorched.json.
 * Everything is validated at startup so a typo in a file stops the server with a clear message.
 */
const fs = require('fs');
const path = require('path');
const { compile } = require('../match');

const DATA_DIR = path.join(__dirname, 'data');
const SCORCHED_FILE = path.join(__dirname, 'scorched.json');
const ZOOM_POINTS = [3, 6, 10];
const YEAR_RE = /^(\d{3,4}) жыл/;

function fail(file, msg) {
  throw new Error(`Мазмұн файлы қате (${file}): ${msg}`);
}
const uniq4 = (arr) => Array.isArray(arr) && arr.length === 4 && arr.every((x) => typeof x === 'string' && x.trim()) && new Set(arr.map((x) => x.trim().toLowerCase())).size === 4;

function loadEras(dir = DATA_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const seen = new Set();
  const eras = files.map((file) => {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      fail(file, `JSON оқылмады: ${e.message}`);
    }
    if (!raw.id || !raw.name) fail(file, 'id және name міндетті');
    if (seen.has(raw.id)) fail(file, `id қайталанады: ${raw.id}`);
    seen.add(raw.id);

    const zoom = [];
    (raw.zoom || []).forEach((z, i) => {
      const where = `zoom #${i + 1}`;
      if (typeof z.q !== 'string' || !z.q.trim()) fail(file, `${where}: q жоқ`);
      if (z.y != null) {
        if (!Number.isInteger(z.y) || z.y < 1 || z.y > new Date().getFullYear()) fail(file, `${where}: y (жыл) қате`);
        zoom.push({ id: `${raw.id}-z${i + 1}`, q: z.q.trim(), year: z.y, fact: z.f || '' });
        return;
      }
      if (!Array.isArray(z.t) || z.t.length !== 3) fail(file, `${where}: t дәл 3 деңгей болуы керек`);
      z.t.forEach(([name, opts], k) => {
        if (typeof name !== 'string' || !name.trim()) fail(file, `${where}: ${k + 1}-деңгей атауы жоқ`);
        if (!uniq4(opts)) fail(file, `${where}: ${k + 1}-деңгейде 4 түрлі жауап болуы керек`);
      });
      zoom.push({ id: `${raw.id}-z${i + 1}`, q: z.q.trim(), tiers: z.t.map(([name, opts]) => ({ name, answers: opts.map((o) => o.trim()) })), fact: z.f || '' });
    });
    // Multiple-choice "which year" questions double as Zoom year questions.
    (raw.questions || []).forEach((q, i) => {
      const m = Array.isArray(q.a) && YEAR_RE.exec(q.a[0]);
      if (m) zoom.push({ id: `${raw.id}-y${i + 1}`, q: q.q.trim(), year: Number(m[1]), fact: q.f || '' });
    });

    const spark = (raw.spark || []).map((s, i) => {
      const where = `spark #${i + 1}`;
      if (!Array.isArray(s.c) || s.c.length !== 3 || s.c.some((c) => typeof c !== 'string' || !c.trim())) fail(file, `${where}: c дәл 3 кілт сөз болуы керек`);
      if (typeof s.a !== 'string' || !s.a.trim()) fail(file, `${where}: a (жауап) жоқ`);
      const names = [s.a, ...(Array.isArray(s.v) ? s.v : [])].map((x) => String(x).trim()).filter(Boolean);
      return { id: `${raw.id}-s${i + 1}`, clues: s.c.map((c) => c.trim()), answer: s.a.trim(), matcher: compile([names]), fact: s.f || '' };
    });

    return { id: raw.id, order: Number(raw.order) || 0, name: raw.name, period: raw.period || '', icon: raw.icon || '', zoom, spark };
  });
  eras.sort((a, b) => a.order - b.order);
  return eras;
}

function loadScorched(file = SCORCHED_FILE, eraIds) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set();
  return raw.map((c, i) => {
    const where = `#${i + 1} ${c.id || ''}`;
    if (!c.id || seen.has(c.id)) fail('scorched.json', `${where}: id жоқ не қайталанады`);
    seen.add(c.id);
    if (!Array.isArray(c.eras) || !c.eras.length || c.eras.some((e) => !eraIds.has(e))) fail('scorched.json', `${where}: eras қате`);
    if (typeof c.cat !== 'string' || !c.cat.trim()) fail('scorched.json', `${where}: cat жоқ`);
    if (!Array.isArray(c.items) || c.items.length < 8) fail('scorched.json', `${where}: кемінде 8 жауап керек`);
    const items = c.items.map((names) => names.map((n) => String(n).trim()).filter(Boolean));
    if (items.some((n) => !n.length)) fail('scorched.json', `${where}: бос жауап бар`);
    return { id: c.id, eras: c.eras, cat: c.cat.trim(), hint: c.hint || '', fact: c.f || '', names: items.map((n) => n[0]), matcher: compile(items) };
  });
}

const ERAS = loadEras();
const ERA_BY_ID = new Map(ERAS.map((e) => [e.id, e]));
const SCORCHED = loadScorched(SCORCHED_FILE, new Set(ERA_BY_ID.keys()));

function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

/** Three distinct neighbours of `center`, nearest first, skipping invalid ones. */
function around(center, step, isValid, rnd) {
  const out = [];
  for (let k = 1; out.length < 3 && k < 60; k++) {
    for (const x of shuffle([center - k * step, center + k * step], rnd)) if (out.length < 3 && isValid(x)) out.push(x);
  }
  return out;
}

/** Century → decade → exact year, with plausible decoys around the right answer. */
function yearTiers(y, rnd = Math.random) {
  const now = new Date().getFullYear();
  const c = Math.floor((y - 1) / 100) + 1;
  const maxC = Math.floor((now - 1) / 100) + 1;
  const d = Math.floor(y / 10) * 10;
  const cDecoys = around(c, 1, (x) => x >= 1 && x <= maxC, rnd);
  const dDecoys = around(d, 10, (x) => x > 0 && x <= now, rnd);
  const yDecoys = shuffle(Array.from({ length: 10 }, (_, k) => d + k).filter((x) => x !== y && x <= now), rnd).slice(0, 3);
  for (let k = d - 1; yDecoys.length < 3; k--) yDecoys.push(k);
  return [
    { name: 'Ғасыр', answers: [c, ...cDecoys].map((x) => `${ROMAN[x]} ғасыр`) },
    { name: 'Онжылдық', answers: [d, ...dDecoys].map((x) => `${x}–${x + 9} жж.`) },
    { name: 'Нақты жыл', answers: [y, ...yDecoys].map((x) => `${x} ж.`) },
  ];
}

const counts = (eraIds) => {
  const set = new Set(eraIds);
  return {
    zoom: eraIds.reduce((n, id) => n + (ERA_BY_ID.get(id)?.zoom.length || 0), 0),
    spark: eraIds.reduce((n, id) => n + (ERA_BY_ID.get(id)?.spark.length || 0), 0),
    scorched: SCORCHED.filter((c) => c.eras.some((e) => set.has(e))).length,
  };
};

/** Round types in play order, with final flags. */
function plan(mode, length, finalEnabled, plans, finalRounds) {
  if (mode === 'mix') {
    const [z, s, sc] = plans.mix[length];
    const acts = [...Array(z).fill('zoom'), ...Array(s).fill('spark'), ...Array(sc).fill('scorched')].map((type) => ({ type, final: false }));
    if (finalEnabled) acts.push(...['zoom', 'spark', 'scorched'].map((type) => ({ type, final: true })));
    return acts;
  }
  const n = plans[mode][length];
  const finals = finalEnabled ? Math.min(finalRounds, n - 1) : 0;
  return Array.from({ length: n }, (_, i) => ({ type: mode, final: i >= n - finals }));
}

/**
 * Build the rounds for a game. Content is spread across the chosen eras and never repeats;
 * if an era selection runs out of a kind of content, those rounds are dropped.
 */
function pickRounds({ mode, length, eras, finalEnabled, chrono }, { plans, finalRounds }, rnd = Math.random) {
  const order = (id) => ERA_BY_ID.get(id)?.order || 0;
  const eraSet = new Set(eras);
  const pools = {
    zoom: shuffle(eras.flatMap((id) => ERA_BY_ID.get(id).zoom.map((x) => ({ ...x, eraId: id }))), rnd),
    spark: shuffle(eras.flatMap((id) => ERA_BY_ID.get(id).spark.map((x) => ({ ...x, eraId: id }))), rnd),
    scorched: shuffle(SCORCHED.filter((c) => c.eras.some((e) => eraSet.has(e))).map((c) => ({ ...c, eraId: c.eras.find((e) => eraSet.has(e)) })), rnd),
  };
  // Spread across eras: take round-robin by era from the shuffled pools.
  const take = (type) => {
    const pool = pools[type];
    if (!pool.length) return null;
    const used = take.used[type] || (take.used[type] = new Map());
    let bestIdx = 0;
    let bestUse = Infinity;
    pool.forEach((x, i) => {
      const u = used.get(x.eraId) || 0;
      if (u < bestUse) {
        bestUse = u;
        bestIdx = i;
      }
    });
    const [item] = pool.splice(bestIdx, 1);
    used.set(item.eraId, (used.get(item.eraId) || 0) + 1);
    return item;
  };
  take.used = {};

  const slots = plan(mode, length, finalEnabled, plans, finalRounds);
  const picked = slots.map((slot) => ({ ...slot, item: take(slot.type) })).filter((s) => s.item);
  if (chrono) {
    // Within each act (same type, not final), go from the Stone Age to today.
    const key = (s) => `${s.final ? 1 : 0}:${s.type}`;
    const groups = new Map();
    picked.forEach((s, i) => {
      const k = key(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    for (const idxs of groups.values()) {
      if (picked[idxs[0]].final) continue;
      const sorted = idxs.map((i) => picked[i]).sort((a, b) => order(a.item.eraId) - order(b.item.eraId));
      idxs.forEach((i, k) => (picked[i] = sorted[k]));
    }
  }
  return picked.map(({ type, final, item }) => {
    const eraName = ERA_BY_ID.get(item.eraId)?.name || '';
    if (type === 'zoom') {
      const tiers = (item.year != null ? yearTiers(item.year, rnd) : item.tiers).map((t, k) => {
        const perm = shuffle([0, 1, 2, 3], rnd);
        return { name: t.name, points: ZOOM_POINTS[k], options: perm.map((p) => t.answers[p]), correct: perm.indexOf(0) };
      });
      return { type, final, id: item.id, eraId: item.eraId, eraName, q: item.q, tiers, fact: item.fact };
    }
    if (type === 'spark') {
      return { type, final, id: item.id, eraId: item.eraId, eraName, clues: item.clues, answer: item.answer, matcher: item.matcher, fact: item.fact };
    }
    return { type, final, id: item.id, eraId: item.eraId, eraName, cat: item.cat, hint: item.hint, names: item.names, matcher: item.matcher, fact: item.fact };
  });
}

module.exports = { ERAS, ERA_BY_ID, SCORCHED, ZOOM_POINTS, loadEras, loadScorched, pickRounds, yearTiers, counts, plan, shuffle };
