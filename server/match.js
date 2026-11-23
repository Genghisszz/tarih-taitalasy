'use strict';
/**
 * Free-text answer matching for Spark and Scorched Earth.
 * Forgiving by design: case, punctuation, Kazakh-specific letters (ә→а, қ→к …), Latin input,
 * titles ("хан", "би", "батыр" …) and small typos are all tolerated.
 */

const KZ = { 'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о', 'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и', 'ё': 'е', 'й': 'и', 'ы': 'ы' };
const LATIN_DIGRAPHS = [
  ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['kh', 'х'], ['gh', 'г'], ['ng', 'н'], ['ts', 'ц'], ['ya', 'я'], ['yu', 'ю'],
];
const LATIN = {
  a: 'а', ä: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', ğ: 'г', h: 'х', i: 'и', ı: 'ы', j: 'ж', k: 'к', l: 'л', m: 'м',
  n: 'н', ñ: 'н', o: 'о', ö: 'о', p: 'п', q: 'к', r: 'р', s: 'с', ş: 'ш', t: 'т', u: 'у', ū: 'у', ü: 'у', v: 'в', w: 'у',
  x: 'х', y: 'ы', z: 'з',
};

// Normalized forms (after letter folding) of words that never decide an answer on their own.
const TITLES = new Set(
  [
    'хан', 'ханы', 'би', 'биі', 'батыр', 'сұлтан', 'қаған', 'әмір', 'жырау', 'ақын', 'шешен', 'сал', 'сері', 'баһадүр',
    'патшайым', 'ата', 'ана', 'баб', 'кесенесі', 'кесене', 'қаласы', 'қала', 'облысы', 'ауданы', 'шайқасы', 'шайқас',
    'көтерілісі', 'мемлекеті', 'қағанаты', 'мәдениеті', 'қорғаны', 'тауы', 'таулары', 'өзені', 'күні', 'мейрамы', 'мерекесі',
  ].map((w) => fold(w))
);

function fold(s) {
  let t = String(s ?? '').normalize('NFC').toLocaleLowerCase('kk-KZ');
  if (/[a-zäğıñöşūü]/.test(t)) {
    for (const [lat, cyr] of LATIN_DIGRAPHS) t = t.split(lat).join(cyr);
    t = t.replace(/[a-zäğıñöşūü]/g, (ch) => LATIN[ch] || ch);
  }
  t = t.replace(/[әғқңөұүһіёй]/g, (ch) => KZ[ch]);
  t = t.replace(/[ъь]/g, '');
  t = t.replace(/[«»"'`’‘“”()[\].,;:!?–—\-_/\\]+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Comparable key: folded, titles dropped (unless the title is all there is). */
function keyOf(s) {
  const toks = fold(s).split(' ').filter(Boolean);
  if (!toks.length) return '';
  const core = toks.filter((t) => !TITLES.has(t));
  return (core.length ? core : toks.slice(0, 1)).join(' ');
}

function lev(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const tolerance = (len) => (len >= 9 ? 2 : len >= 5 ? 1 : 0);

/** items: Array<string[]> — each entry lists the canonical name first, then accepted variants. */
function compile(items) {
  return items.map((names, idx) => {
    const keys = [...new Set(names.map(keyOf).filter(Boolean))];
    const surnames = keys
      .map((k) => k.split(' '))
      .filter((t) => t.length >= 2 && t[t.length - 1].length >= 5)
      .map((t) => t[t.length - 1]);
    return { idx, name: names[0], keys, surnames };
  });
}

/** Returns the matched item index, or -1. */
function match(text, compiled) {
  const k = keyOf(text);
  if (!k) return -1;
  let best = null;
  for (const it of compiled) {
    for (const key of it.keys) {
      const tol = tolerance(key.length);
      const d = lev(k, key, tol);
      if (d <= tol && (!best || d < best.d)) best = { idx: it.idx, d };
      if (best?.d === 0) return best.idx;
    }
  }
  if (best) return best.idx;
  // Surname only ("Бөкейхан" for "Әлихан Бөкейхан") — accepted when it points to exactly one item.
  const hits = compiled.filter((it) => it.surnames.some((s) => lev(k, s, tolerance(s.length)) <= tolerance(s.length)));
  return hits.length === 1 ? hits[0].idx : -1;
}

module.exports = { fold, keyOf, lev, compile, match };
