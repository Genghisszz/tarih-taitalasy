'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { zoomPoints, sparkPoints, resolveWave, scorchedTotal, applyFinal } = require('../server/modes');
const { compile, match, keyOf } = require('../server/match');
const { validateNickname, sanitizeSettings } = require('../server/rooms');
const { yearTiers, ERAS, SCORCHED } = require('../server/questions');

test('zoom: tier points only when right at the chosen tier', () => {
  const round = { tiers: [{ points: 3, correct: 1 }, { points: 6, correct: 2 }, { points: 10, correct: 0 }] };
  assert.equal(zoomPoints(round, { tier: 0, choice: 1 }), 3);
  assert.equal(zoomPoints(round, { tier: 1, choice: 2 }), 6);
  assert.equal(zoomPoints(round, { tier: 2, choice: 0 }), 10);
  assert.equal(zoomPoints(round, { tier: 2, choice: 1 }), 0, 'wrong at the precise tier pays nothing');
  assert.equal(zoomPoints(round, { tier: 1, choice: null }), 0);
  assert.equal(zoomPoints(round, null), 0);
});

test('spark: 10 points instantly, 2 at the buzzer, 0 if not found', () => {
  assert.equal(sparkPoints(0, 30000), 10);
  assert.equal(sparkPoints(30000, 30000), 2);
  assert.equal(sparkPoints(15000, 30000), 6);
  assert.equal(sparkPoints(null, 30000), 0);
});

test('scorched: unique scores, duplicates char, burned/invalid/none score 0, flawless bonus', () => {
  const burned = new Set();
  const w1 = resolveWave([{ id: 'a', idx: 0 }, { id: 'b', idx: 0 }, { id: 'c', idx: 1 }, { id: 'd', idx: -1 }, { id: 'e', idx: null }], burned, 0);
  assert.deepEqual([...w1.values()].map((r) => r.status), ['dup', 'dup', 'unique', 'invalid', 'none']);
  assert.equal(w1.get('c').points, 3);
  assert.equal(w1.get('a').points, 0);
  assert.ok(burned.has(0) && burned.has(1), 'duplicates are burned too');
  const w2 = resolveWave([{ id: 'a', idx: 1 }, { id: 'c', idx: 2 }], burned, 1);
  assert.equal(w2.get('a').status, 'burned');
  assert.equal(w2.get('c').points, 4);
  const w3 = resolveWave([{ id: 'c', idx: 3 }], burned, 2);
  assert.equal(w3.get('c').points, 5);
  const tot = scorchedTotal([w1.get('c'), w2.get('c'), w3.get('c')]);
  assert.deepEqual(tot, { base: 12, flawless: true, total: 15 });
  assert.equal(scorchedTotal([w1.get('a'), w2.get('a')]).total, 0);
});

test('final doubles', () => {
  assert.equal(applyFinal(6, true), 12);
  assert.equal(applyFinal(6, false), 6);
});

test('answer matching: Kazakh letters, Russian keyboard, Latin, titles, typos', () => {
  const m = compile([['Абылай', 'Әбілмансұр'], ['Тәуке', 'Әз Тәуке'], ['Тәуекел'], ['Әлихан Бөкейхан', 'Бөкейханов'], ['Хан'], ['Халел Досмұхамедұлы'], ['Жаһанша Досмұхамедұлы']]);
  assert.equal(match('абылай хан', m), 0);
  assert.equal(match('Абылай', m), 0);
  assert.equal(match('Abylai', m), 0, 'Latin');
  assert.equal(match('Тауке', m), 1, 'typed without Kazakh letters');
  assert.equal(match('Тәуекел хан', m), 2);
  assert.equal(match('Бокейхан', m), 3, 'surname alone, Russian keyboard');
  assert.equal(match('Әлихан Бөкейхнан', m), 3, 'small typo');
  assert.equal(match('хан', m), 4, 'a title on its own is still an answer');
  assert.equal(match('Досмұхамедұлы', m), -1, 'ambiguous surname is not accepted');
  assert.equal(match('Наполеон', m), -1);
  assert.equal(match('   ', m), -1);
  assert.equal(keyOf('«Қасым хан»'), 'касым');
});

test('content: every spark answer matches itself and every category is well-formed', () => {
  for (const era of ERAS) {
    assert.ok(era.zoom.length >= 3, `${era.id} zoom`);
    assert.ok(era.spark.length >= 4, `${era.id} spark`);
    for (const s of era.spark) assert.equal(match(s.answer, s.matcher), 0, `${era.id}: ${s.answer}`);
  }
  assert.ok(SCORCHED.length >= 12);
  for (const c of SCORCHED) {
    c.names.forEach((n, i) => {
      const got = match(n, c.matcher);
      assert.equal(got, i, `${c.id}: «${n}» matched «${c.names[got]}»`);
    });
  }
});

test('year tiers: right answer first, four distinct options per tier', () => {
  for (const y of [552, 1465, 1801, 1991, 2017]) {
    const tiers = yearTiers(y);
    assert.equal(tiers.length, 3);
    for (const t of tiers) assert.equal(new Set(t.answers).size, 4, `${y} ${t.name}`);
    assert.match(tiers[2].answers[0], new RegExp(`^${y}`));
  }
  assert.equal(yearTiers(1801)[0].answers[0], 'XIX ғасыр');
  assert.equal(yearTiers(1465)[1].answers[0], '1460–1469 жж.');
});

test('nicknames and settings', () => {
  assert.equal(validateNickname('  Әлихан   Бөкей ').nickname, 'Әлихан Бөкей');
  assert.equal(validateNickname('<script>').code, 'NICK_CHARS');
  assert.equal(validateNickname('Ай​герім').nickname, 'Айгерім');
  const s = sanitizeSettings({ mode: 'hack', eras: ['nope'], length: 'huge' });
  assert.equal(s.mode, 'mix');
  assert.equal(s.eras.length, 12);
  assert.equal(s.length, 'normal');
});
