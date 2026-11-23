'use strict';
/**
 * End-to-end over real sockets: a host and up to 26 players on a fast clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server/app');
const { fold } = require('../server/match');

const FAST = {
  countdown: 30,
  intro: 30,
  introLong: 30,
  questionLead: 0,
  zoom: 4000,
  spark: 4000,
  wave: 4000,
  waveReveal: 40,
  sparkFreeze: 300,
  revealAuto: 60_000,
  allAnsweredGrace: 20,
  lateGrace: 100,
  lobbyOfflineGrace: 60_000,
  sweepInterval: 60_000,
};
const HOST_KEY = 'test-host-key-0123456789abcdef';

let inst;
let url;
const sockets = [];

test.before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
  inst = createApp({ dataDir, timings: FAST });
  const addr = await inst.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${addr.port}`;
});
test.after(async () => {
  sockets.forEach((s) => s.close());
  await inst.close();
});

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  s.latest = null;
  s.on('state', (st) => (s.latest = st));
  sockets.push(s);
  return s;
}
const emit = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));
function waitFor(s, pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    if (s.latest && pred(s.latest)) return resolve(s.latest);
    const t = setTimeout(() => {
      s.off('state', on);
      reject(new Error(`timeout; last phase=${s.latest?.phase} r=${s.latest?.rIndex}`));
    }, ms);
    function on(st) {
      if (pred(st)) {
        clearTimeout(t);
        s.off('state', on);
        resolve(st);
      }
    }
    s.on('state', on);
  });
}
async function newRoom(settings) {
  const host = client();
  const res = await emit(host, 'host:create', { hostKey: HOST_KEY, settings });
  assert.equal(res.ok, true, res.error);
  await waitFor(host, (s) => s.code === res.code);
  return { host, code: res.code, room: inst.manager.get(res.code) };
}
async function join(code, nickname, token) {
  const s = client();
  s.join = await emit(s, 'player:join', { code, nickname, token });
  return s;
}
async function players(code, prefix, n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await join(code, `${prefix}-${i}`));
  return out;
}
const act = (p, payload) => emit(p, 'player:act', payload);

/** Plays every round: `onRound(roundIndex, round)` makes the moves, then the host moves on. */
async function play(host, room, onRound) {
  assert.equal((await emit(host, 'host:action', { action: 'start' })).ok, true);
  for (let i = 0; i < room.rounds.length; i++) {
    await waitFor(host, (s) => s.phase === 'play' && s.rIndex === i);
    await onRound(i, room.rounds[i]);
    await waitFor(host, (s) => s.phase === 'reveal' && s.rIndex === i);
    await emit(host, 'host:action', { action: 'next' });
  }
  const end = await waitFor(host, (s) => s.phase === 'end');
  await inst.storage.flush();
  return end;
}

test('lobby: unique nicknames, 25-player cap, reconnect, kick', async () => {
  const { host, code } = await newRoom({ mode: 'zoom', length: 'short' });
  const first = await join(code, 'Әлия');
  assert.equal(first.join.ok, true);
  const dup = await join(code, '  әлия ');
  assert.equal(dup.join.code, 'NICK_TAKEN', 'case-insensitive with Kazakh letters');
  const ps = [first];
  for (let i = 2; i <= 25; i++) ps.push(await join(code, `Ойыншы ${i}`));
  assert.ok(ps.every((p) => p.join.ok));
  await waitFor(host, (s) => s.playerCount === 25);
  assert.equal((await join(code, 'Жиырма алты')).join.code, 'ROOM_FULL');

  first.close();
  await waitFor(host, (s) => s.report.players.some((p) => p.nickname === 'Әлия' && !p.connected));
  const back = await join(code, 'басқа', first.join.token);
  assert.equal(back.join.rejoined, true);
  assert.equal(back.join.nickname, 'Әлия');

  const victim = ps[24];
  const kicked = new Promise((r) => victim.once('kicked', r));
  assert.equal((await emit(host, 'host:action', { action: 'kick', playerId: victim.join.playerId })).ok, true);
  await kicked;
  assert.equal((await join(code, 'Ойыншы 25')).join.code, 'KICKED');
  const intruder = client();
  assert.equal((await emit(intruder, 'host:attach', { code, hostKey: 'someone-else-key-0123456789abc' })).code, 'FORBIDDEN');
});

test('Zoom: choose a tier first, cards stay hidden until then, tier points ×2 in the final', async () => {
  const { host, code, room } = await newRoom({ mode: 'zoom', length: 'short', finalEnabled: true });
  const ps = await players(code, 'z', 4);
  await waitFor(host, (s) => s.playerCount === 4);
  const end = await play(host, room, async (i, r) => {
    const st = await waitFor(ps[0], (s) => s.phase === 'play' && s.rIndex === i);
    assert.equal(st.my.options, null, 'no cards before choosing a tier');
    assert.equal(st.round.tiers.length, 3);
    assert.equal(st.round.tiers[0].options, undefined);
    // p1: precise and right; p2: broad and wrong; p3: middle and right; p4: no answer
    const moves = [[2, r.tiers[2].correct], [0, (r.tiers[0].correct + 1) % 4], [1, r.tiers[1].correct]];
    for (const [k, [tier, choice]] of moves.entries()) {
      const t = await act(ps[k], { r: i, kind: 'tier', tier });
      assert.equal(t.ok, true);
      assert.equal(t.options.length, 4);
      assert.equal((await act(ps[k], { r: i, kind: 'tier', tier: 0 })).code, 'ALREADY', 'tier is final');
      assert.equal((await act(ps[k], { r: i, kind: 'pick', choice })).ok, true);
    }
    await emit(host, 'host:action', { action: 'skip' });
  });
  const by = Object.fromEntries(end.report.players.map((p) => [p.nickname, p]));
  const finals = room.rounds.filter((r) => r.final).length;
  const normal = room.rounds.length - finals;
  assert.equal(by['z-1'].score, normal * 10 + finals * 20);
  assert.equal(by['z-3'].score, normal * 6 + finals * 12);
  assert.equal(by['z-2'].score, 0);
  assert.equal(by['z-1'].rank, 1);
  assert.equal(by['z-4'].stats.answered, 0);
  assert.equal(by['z-1'].stats.accuracy, 1);
  assert.equal(by['z-1'].cells[0].d.tier, 2);
  assert.ok(end.report.rounds.every((r) => r.revealed && r.tiers.every((t) => typeof t.correct === 'number')));
});

test('Spark: typed answer, forgiving spelling, wrong guess freezes', async () => {
  const { host, code, room } = await newRoom({ mode: 'spark', length: 'short' });
  const ps = await players(code, 's', 4);
  await waitFor(host, (s) => s.playerCount === 4);
  const end = await play(host, room, async (i, r) => {
    const st = await waitFor(ps[0], (s) => s.phase === 'play' && s.rIndex === i);
    assert.equal(st.round.answer, undefined, 'answer hidden while playing');
    assert.equal(st.round.clues.length, 3);
    const a = await act(ps[0], { r: i, kind: 'guess', text: r.answer });
    assert.equal(a.correct, true);
    const wrong = await act(ps[1], { r: i, kind: 'guess', text: 'Наполеон Бонапарт' });
    assert.equal(wrong.correct, false);
    assert.equal((await act(ps[1], { r: i, kind: 'guess', text: r.answer })).code, 'FROZEN');
    // without Kazakh letters, all lowercase — as typed on a Russian keyboard
    const sloppy = fold(r.answer);
    assert.equal((await act(ps[2], { r: i, kind: 'guess', text: sloppy })).correct, true, `«${sloppy}» for «${r.answer}»`);
    await emit(host, 'host:action', { action: 'skip' });
  });
  const by = Object.fromEntries(end.report.players.map((p) => [p.nickname, p]));
  assert.ok(by['s-1'].score >= room.rounds.length * 9, 'instant answers are worth ~10');
  assert.equal(by['s-2'].score, 0);
  assert.ok(by['s-3'].score > 0);
  assert.equal(by['s-2'].cells[0].d.attempts[0].text, 'Наполеон Бонапарт', 'admin sees what was typed');
  assert.ok(end.report.rounds.every((r) => typeof r.answer === 'string'));
});

test('Scorched Earth: duplicates char, burned answers score nothing, flawless bonus', async () => {
  const { host, code, room } = await newRoom({ mode: 'scorched', length: 'short', finalEnabled: false });
  const ps = await players(code, 'k', 3);
  await waitFor(host, (s) => s.playerCount === 3);
  let firstRound = null;
  const end = await play(host, room, async (i, r) => {
    const names = r.names;
    // wave 1: k-1 and k-2 give the same answer (charred), k-3 a unique one
    await act(ps[0], { r: i, kind: 'submit', wave: 0, text: names[0] });
    await act(ps[1], { r: i, kind: 'submit', wave: 0, text: names[0].toLocaleLowerCase('kk-KZ') });
    await act(ps[2], { r: i, kind: 'submit', wave: 0, text: names[1] });
    const w1 = await waitFor(host, (s) => s.phase === 'wave_reveal' && s.round.wave === 0);
    assert.equal(w1.round.waveResult.dup[0].nicks.length, 2);
    assert.equal(w1.round.waveResult.unique[0].name, names[1]);
    // wave 2: k-1 repeats a burned answer, k-2 types nonsense, k-3 unique
    await waitFor(host, (s) => s.phase === 'play' && s.round.wave === 1);
    const pv = await waitFor(ps[0], (s) => s.phase === 'play' && s.round.wave === 1);
    assert.deepEqual(new Set(pv.round.burned), new Set([names[0], names[1]]), 'burned answers are shown');
    await act(ps[0], { r: i, kind: 'submit', wave: 1, text: names[1] });
    await act(ps[1], { r: i, kind: 'submit', wave: 1, text: 'мүлде басқа нәрсе' });
    await act(ps[2], { r: i, kind: 'submit', wave: 1, text: names[2] });
    await waitFor(host, (s) => s.phase === 'play' && s.round.wave === 2);
    await act(ps[2], { r: i, kind: 'submit', wave: 2, text: names[3] });
    await emit(host, 'host:action', { action: 'skip' }); // the others pass
    if (i === 0) firstRound = r;
  });
  assert.ok(firstRound);
  const by = Object.fromEntries(end.report.players.map((p) => [p.nickname, p]));
  assert.equal(by['k-3'].score, room.rounds.length * (3 + 4 + 5 + 3), 'unique in all three waves + flawless');
  assert.equal(by['k-1'].score, 0);
  assert.deepEqual(by['k-1'].cells[0].d.waves.map((w) => w.status), ['dup', 'burned', 'none']);
  assert.deepEqual(by['k-2'].cells[0].d.waves.map((w) => w.status), ['dup', 'invalid', 'none']);
  assert.equal(by['k-3'].cells[0].d.flawless, true);
  const st = end.report.rounds[0].stats;
  assert.equal(st.foundCount, 4);
  assert.ok(st.left.length > 0, 'reveal shows what was left to find');
});

test('Mix: zoom → spark → scorched acts, then the ×2 final', async () => {
  const { host, code, room } = await newRoom({ mode: 'mix', length: 'short', finalEnabled: true });
  const types = room.rounds.map((r) => r.type + (r.final ? '*' : ''));
  assert.deepEqual(types, ['zoom', 'zoom', 'zoom', 'spark', 'spark', 'spark', 'scorched', 'zoom*', 'spark*', 'scorched*']);
  const [p] = await players(code, 'm', 1);
  let sawFinal = false;
  host.on('state', (s) => s.phase === 'intro' && s.introKind === 'final' && (sawFinal = true));
  const end = await play(host, room, async (i, r) => {
    if (r.type === 'zoom') {
      await act(p, { r: i, kind: 'tier', tier: 0 });
      await act(p, { r: i, kind: 'pick', choice: r.tiers[0].correct });
    } else if (r.type === 'spark') {
      await act(p, { r: i, kind: 'guess', text: r.answer });
    } else {
      for (let w = 0; w < 3; w++) {
        await waitFor(host, (s) => s.phase === 'play' && s.round.wave === w);
        await act(p, { r: i, kind: 'submit', wave: w, text: r.names[w] });
      }
    }
    if (host.latest.phase === 'play') await emit(host, 'host:action', { action: 'skip' }).catch(() => {});
  });
  assert.ok(sawFinal, 'final intro card shown');
  assert.equal(end.report.rounds.length, 10);
  assert.ok(end.report.players[0].score > 0);
});

test('history API: list, detail, auth, delete', async () => {
  const base = { 'x-host-key': HOST_KEY };
  const list = await (await fetch(`${url}/api/history`, { headers: base })).json();
  assert.ok(list.games.length >= 4);
  const g = list.games[0];
  assert.equal(g.status, 'finished');
  assert.equal(g.hostHash, undefined);
  const detail = await (await fetch(`${url}/api/history/${g.id}`, { headers: base })).json();
  assert.ok(detail.report.rounds.length > 0);
  assert.equal((await fetch(`${url}/api/history/${g.id}`, { headers: { 'x-host-key': 'other-key-0123456789abcdefghij' } })).status, 404);
  assert.equal((await fetch(`${url}/api/history`)).status, 401);
  assert.equal((await fetch(`${url}/api/history/${g.id}`, { method: 'DELETE', headers: base })).status, 200);
});

test('meta lists 12 eras with content counts and 4 modes', async () => {
  const meta = await (await fetch(`${url}/api/meta`)).json();
  assert.equal(meta.eras.length, 12);
  assert.equal(meta.modes.length, 4);
  assert.ok(meta.eras.every((e) => e.counts.zoom > 0 && e.counts.spark > 0 && e.counts.scorched > 0));
});
