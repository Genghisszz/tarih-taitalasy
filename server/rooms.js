'use strict';
const crypto = require('crypto');
const config = require('./config');
const { MODES, SPARK, SCORCHED, zoomPoints, sparkPoints, resolveWave, scorchedTotal, applyFinal } = require('./modes');
const { ERAS, ERA_BY_ID, pickRounds, shuffle } = require('./questions');
const { match } = require('./match');

const { MAX_PLAYERS, NICK_MIN, NICK_MAX, TITLE_MAX, ANSWER_MAX, LENGTHS, PLANS, FINAL_ROUNDS } = config;

// Letters (any script, incl. Kazakh), digits, combining marks; inner spaces, dot, dash, underscore.
const NICK_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M} _.\-]*[\p{L}\p{N}\p{M}])?$/u;
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

const err = (code, error) => ({ ok: false, code, error });

function cleanText(s) {
  return String(s ?? '').normalize('NFC').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
}
function nickKey(s) {
  return cleanText(s).toLocaleLowerCase('kk-KZ');
}
function validateNickname(raw) {
  const nick = cleanText(raw);
  const len = [...nick].length;
  if (len < NICK_MIN) return err('NICK_SHORT', `Есім кемінде ${NICK_MIN} таңбадан тұруы керек`);
  if (len > NICK_MAX) return err('NICK_LONG', `Есім ${NICK_MAX} таңбадан аспауы керек`);
  if (!NICK_RE.test(nick)) return err('NICK_CHARS', 'Есімде тек әріп, сан, бос орын, «-», «_» және «.» болуы мүмкін');
  return { ok: true, nickname: nick, key: nickKey(nick) };
}
const cleanAnswer = (s) => [...cleanText(s)].slice(0, ANSWER_MAX).join('');

function sanitizeSettings(input) {
  const s = input && typeof input === 'object' ? input : {};
  let eras = Array.isArray(s.eras) ? [...new Set(s.eras.filter((id) => ERA_BY_ID.has(id)))] : [];
  if (!eras.length) eras = ERAS.map((e) => e.id);
  eras.sort((a, b) => ERA_BY_ID.get(a).order - ERA_BY_ID.get(b).order);
  return {
    title: [...cleanText(s.title)].slice(0, TITLE_MAX).join(''),
    mode: Object.hasOwn(MODES, s.mode) ? s.mode : 'mix',
    eras,
    length: LENGTHS.includes(s.length) ? s.length : 'normal',
    finalEnabled: s.finalEnabled !== false,
    autoAdvance: s.autoAdvance !== false,
    chrono: s.chrono !== false,
  };
}

const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');

function newRecord(type) {
  if (type === 'zoom') return { tier: null, tierMs: null, choice: null, timeMs: null, points: 0 };
  if (type === 'spark') return { attempts: [], foundMs: null, frozenUntil: 0, points: 0 };
  return { waves: [], flawless: false, points: 0 };
}

class Room {
  constructor(manager, { code, hostHash, settings }) {
    this.mgr = manager;
    this.io = manager.io;
    this.t = manager.timings;
    this.id = crypto.randomUUID();
    this.code = code;
    this.hostHash = hostHash;
    this.settings = settings;
    this.rounds = pickRounds(settings, { plans: PLANS, finalRounds: FINAL_ROUNDS });
    this.rounds.forEach((r) => {
      r.burned = new Set(); // scorched: item indexes already given
      r.waveResults = []; // scorched: summary per wave
      r.stats = null;
    });
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.endedEarly = false;
    this.phase = 'lobby';
    this.rIndex = -1;
    this.wave = 0;
    this.introKind = null;
    this.startsAt = 0;
    this.endsAt = 0;
    this.phaseEndsAt = null;
    this.timer = null;
    this.players = new Map();
    this.byToken = new Map();
    this.banned = new Set();
    this.lastActivity = Date.now();
    this.flushPending = false;
    this.destroyed = false;
  }

  get hostChannel() {
    return `h:${this.code}`;
  }
  get playerChannel() {
    return `p:${this.code}`;
  }
  get round() {
    return this.rounds[this.rIndex] || null;
  }
  /** Rounds whose results are public. */
  get revealedCount() {
    return ['reveal', 'end'].includes(this.phase) ? this.rIndex + 1 : Math.max(0, this.rIndex);
  }
  /** Rounds that have started (the current one included once it is being played). */
  get openedCount() {
    return ['play', 'wave_reveal', 'reveal', 'end'].includes(this.phase) ? this.rIndex + 1 : Math.max(0, this.rIndex);
  }
  limitFor(r) {
    return r.type === 'zoom' ? this.t.zoom : r.type === 'spark' ? this.t.spark : this.t.wave;
  }
  touch() {
    this.lastActivity = Date.now();
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.destroyed) fn();
    }, Math.max(0, ms));
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------- players ----------

  attachPlayer(socket, p) {
    if (p.socketId && p.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(p.socketId);
      if (old) {
        old.emit('session:replaced');
        old.leave(this.playerChannel);
        old.data = {};
      }
    }
    p.socketId = socket.id;
    p.connected = true;
    p.offlineSince = null;
    socket.join(this.playerChannel);
    socket.data = { role: 'player', code: this.code, playerId: p.id };
  }

  join(socket, { nickname, token }) {
    this.touch();
    if (typeof token === 'string' && this.byToken.has(token)) {
      const p = this.byToken.get(token);
      this.attachPlayer(socket, p);
      this.broadcast();
      return { ok: true, playerId: p.id, token: p.token, nickname: p.nickname, rejoined: true };
    }
    if (this.phase === 'end') return err('GAME_ENDED', 'Бұл ойын аяқталып қойған');
    const v = validateNickname(nickname);
    if (!v.ok) return v;
    if (this.banned.has(v.key) || (token && this.banned.has(token))) return err('KICKED', 'Жүргізуші сізді бұл бөлмеден шығарып жіберген');
    for (const p of this.players.values()) {
      if (p.key === v.key) return err('NICK_TAKEN', `«${p.nickname}» есімі бос емес — басқа есім таңдаңыз`);
    }
    if (this.players.size >= MAX_PLAYERS) return err('ROOM_FULL', `Бөлме толы (${MAX_PLAYERS}/${MAX_PLAYERS})`);
    const p = {
      id: newId(),
      token: newToken(),
      nickname: v.nickname,
      key: v.key,
      socketId: null,
      connected: false,
      offlineSince: null,
      joinedAt: Date.now(),
      score: 0,
      scoredTimeMs: 0,
      eligible: [],
      recs: [],
      rank: null,
      prevRank: null,
    };
    this.players.set(p.id, p);
    this.byToken.set(p.token, p);
    this.attachPlayer(socket, p);
    this.rank();
    this.broadcast();
    return { ok: true, playerId: p.id, token: p.token, nickname: p.nickname, rejoined: false };
  }

  removePlayer(p) {
    this.players.delete(p.id);
    this.byToken.delete(p.token);
    const s = p.socketId && this.io.sockets.sockets.get(p.socketId);
    if (s) {
      s.leave(this.playerChannel);
      s.data = {};
    }
    this.rank();
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p) return err('NO_PLAYER', 'Ойыншы табылмады');
    this.banned.add(p.token);
    this.banned.add(p.key);
    const s = p.socketId && this.io.sockets.sockets.get(p.socketId);
    if (s) s.emit('kicked');
    this.removePlayer(p);
    this.checkAllDone();
    this.broadcast();
    return { ok: true };
  }

  leave(p) {
    if (this.phase === 'lobby') this.removePlayer(p);
    else {
      p.connected = false;
      p.offlineSince = Date.now();
      const s = p.socketId && this.io.sockets.sockets.get(p.socketId);
      if (s) {
        s.leave(this.playerChannel);
        s.data = {};
      }
      p.socketId = null;
      this.checkAllDone();
    }
    this.broadcast();
  }

  onDisconnect(socket) {
    const p = this.players.get(socket.data.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.offlineSince = Date.now();
    p.socketId = null;
    this.checkAllDone();
    this.broadcast();
  }

  // ---------- game flow ----------

  start() {
    if (this.phase !== 'lobby') return err('BAD_PHASE', 'Ойын басталып кеткен');
    if (this.players.size === 0) return err('NO_PLAYERS', 'Кемінде бір ойыншы қосылуы керек');
    if (!this.rounds.length) return err('NO_CONTENT', 'Таңдалған кезеңдерде бұл режимге сұрақ жоқ');
    this.touch();
    this.startedAt = Date.now();
    this.phase = 'countdown';
    this.phaseEndsAt = Date.now() + this.t.countdown;
    this.setTimer(this.t.countdown, () => this.nextRound());
    this.save('in_progress');
    this.broadcast();
    return { ok: true };
  }

  nextRound() {
    this.clearTimer();
    const i = this.rIndex + 1;
    if (i >= this.rounds.length) return this.finish();
    const prev = this.rounds[i - 1];
    const r = this.rounds[i];
    this.rIndex = i;
    this.wave = 0;
    this.phase = 'intro';
    this.introKind = r.final && !prev?.final ? 'final' : !prev || prev.type !== r.type ? 'mode' : 'round';
    const ms = this.introKind === 'round' ? this.t.intro : this.t.introLong;
    this.phaseEndsAt = Date.now() + ms;
    this.setTimer(ms, () => this.openPlay());
    this.broadcast();
    return { ok: true };
  }

  openPlay() {
    this.touch();
    const r = this.round;
    for (const p of this.players.values()) {
      p.eligible[this.rIndex] = true;
      p.recs[this.rIndex] = newRecord(r.type);
    }
    if (r.type === 'scorched') return this.openWave(0);
    this.openClock(this.limitFor(r), () => this.endPlay());
  }

  openClock(limit, onEnd) {
    const now = Date.now();
    this.phase = 'play';
    this.startsAt = now + this.t.questionLead;
    this.endsAt = this.startsAt + limit;
    this.phaseEndsAt = this.endsAt;
    this.setTimer(this.endsAt - now + this.t.lateGrace, onEnd);
    this.broadcast();
  }

  openWave(w) {
    this.wave = w;
    this.openClock(this.t.wave, () => this.resolveCurrentWave());
  }

  resolveCurrentWave() {
    if (this.phase !== 'play' || this.round?.type !== 'scorched') return err('BAD_PHASE', 'Қазір толқын жоқ');
    this.clearTimer();
    const r = this.round;
    const w = this.wave;
    const entries = [];
    for (const p of this.players.values()) {
      if (!p.eligible[this.rIndex]) continue;
      const rec = p.recs[this.rIndex];
      const text = rec.waves[w]?.text || null;
      const idx = text == null ? null : match(text, r.matcher);
      rec.waves[w] = { text, idx: idx ?? null, name: idx != null && idx >= 0 ? r.names[idx] : null };
      entries.push({ id: p.id, idx: idx ?? null });
    }
    const results = resolveWave(entries, r.burned, w);
    const groups = new Map();
    const summary = { wave: w, points: SCORCHED.wavePoints[w], unique: [], dup: [], burned: 0, invalid: 0, none: 0 };
    for (const [id, res] of results) {
      const p = this.players.get(id);
      const rec = p.recs[this.rIndex];
      Object.assign(rec.waves[w], res);
      if (res.status === 'unique' || res.status === 'dup') {
        const g = groups.get(rec.waves[w].idx) || { name: rec.waves[w].name, nicks: [], status: res.status };
        g.nicks.push(p.nickname);
        groups.set(rec.waves[w].idx, g);
      } else summary[res.status]++;
    }
    for (const g of groups.values()) (g.status === 'unique' ? summary.unique : summary.dup).push({ name: g.name, nicks: g.nicks });
    r.waveResults[w] = summary;
    this.phase = 'wave_reveal';
    this.phaseEndsAt = Date.now() + this.t.waveReveal;
    this.setTimer(this.t.waveReveal, () => (w < SCORCHED.waves - 1 ? this.openWave(w + 1) : this.endPlay()));
    this.broadcast();
    return { ok: true };
  }

  /** Skip the rest of the current play phase (host button). */
  skip() {
    if (this.phase !== 'play') return err('BAD_PHASE', 'Қазір жауап беру кезеңі емес');
    return this.round.type === 'scorched' ? this.resolveCurrentWave() : this.endPlay();
  }

  act(p, payload) {
    const r = this.round;
    const { r: ri, kind } = payload || {};
    if (this.phase !== 'play' || ri !== this.rIndex) return err('LATE', 'Бұл раундтың уақыты өтіп кетті');
    if (!p.eligible[this.rIndex]) return err('NOT_ELIGIBLE', 'Келесі раундты күтіңіз');
    const now = Date.now();
    if (now > this.endsAt + this.t.lateGrace) return err('LATE', 'Уақыт бітті');
    const t = Math.min(this.endsAt - this.startsAt, Math.max(0, now - this.startsAt));
    const rec = p.recs[this.rIndex];
    let res;
    if (r.type === 'zoom' && kind === 'tier') {
      const tier = payload.tier;
      if (rec.tier != null) return err('ALREADY', 'Деңгей таңдалған');
      if (!Number.isInteger(tier) || tier < 0 || tier > 2) return err('BAD', 'Деңгей қате');
      rec.tier = tier;
      rec.tierMs = t;
      res = { ok: true, options: r.tiers[tier].options };
    } else if (r.type === 'zoom' && kind === 'pick') {
      const choice = payload.choice;
      if (rec.tier == null) return err('NO_TIER', 'Алдымен деңгейді таңдаңыз');
      if (rec.choice != null) return err('ALREADY', 'Жауап берілген');
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return err('BAD', 'Жауап қате');
      rec.choice = choice;
      rec.timeMs = t;
      res = { ok: true, timeMs: t };
    } else if (r.type === 'spark' && kind === 'guess') {
      if (rec.foundMs != null) return err('ALREADY', 'Сен жауапты таптың');
      if (now < rec.frozenUntil) return { ...err('FROZEN', 'Біраз күте тұр'), frozenUntil: rec.frozenUntil };
      if (rec.attempts.length >= SPARK.maxAttempts) return err('TOO_MANY', 'Әрекеттер таусылды');
      const text = cleanAnswer(payload.text);
      if (!text) return err('EMPTY', 'Жауапты жазыңыз');
      const ok = match(text, r.matcher) === 0;
      rec.attempts.push({ text, ok, t });
      if (ok) {
        rec.foundMs = t;
        res = { ok: true, correct: true, timeMs: t };
      } else {
        rec.frozenUntil = now + this.t.sparkFreeze;
        res = { ok: true, correct: false, frozenUntil: rec.frozenUntil };
      }
    } else if (r.type === 'scorched' && kind === 'submit') {
      if (payload.wave !== this.wave) return err('LATE', 'Бұл толқын аяқталды');
      const text = cleanAnswer(payload.text);
      if (!text) return err('EMPTY', 'Жауапты жазыңыз');
      rec.waves[this.wave] = { text, t };
      res = { ok: true };
    } else {
      return err('BAD', 'Белгісіз әрекет');
    }
    this.touch();
    this.checkAllDone();
    this.broadcast();
    return res;
  }

  isDone(p) {
    const rec = p.recs[this.rIndex];
    const r = this.round;
    if (!rec) return true;
    if (r.type === 'zoom') return rec.choice != null;
    if (r.type === 'spark') return rec.foundMs != null;
    return !!rec.waves[this.wave]?.text;
  }

  /** Move on early once every connected, eligible player is done. */
  checkAllDone() {
    if (this.phase !== 'play') return;
    let waiting = 0;
    let done = 0;
    for (const p of this.players.values()) {
      if (!p.eligible[this.rIndex]) continue;
      if (this.isDone(p)) done++;
      else if (p.connected) waiting++;
    }
    if (waiting === 0 && done > 0) {
      const next = this.round.type === 'scorched' ? () => this.resolveCurrentWave() : () => this.endPlay();
      this.phaseEndsAt = Date.now() + this.t.allAnsweredGrace;
      this.setTimer(this.t.allAnsweredGrace, next);
    }
  }

  endPlay() {
    if (!['play', 'wave_reveal'].includes(this.phase)) return err('BAD_PHASE', 'Қазір раунд жоқ');
    this.clearTimer();
    this.touch();
    const r = this.round;
    const limit = this.limitFor(r);
    const timeOf = (rec) => (r.type === 'zoom' ? rec.timeMs : r.type === 'spark' ? rec.foundMs : null);
    for (const p of this.players.values()) {
      if (!p.eligible[this.rIndex]) continue;
      const rec = p.recs[this.rIndex];
      let base = 0;
      if (r.type === 'zoom') base = zoomPoints(r, rec);
      else if (r.type === 'spark') base = sparkPoints(rec.foundMs, limit);
      else {
        const tot = scorchedTotal(rec.waves);
        rec.flawless = tot.flawless;
        base = tot.total;
      }
      rec.points = applyFinal(base, r.final);
      p.score += rec.points;
      if (rec.points > 0 && timeOf(rec) != null) p.scoredTimeMs += timeOf(rec);
    }
    r.stats = this.roundStats(r);
    for (const p of this.players.values()) p.prevRank = p.rank;
    this.rank();
    this.phase = 'reveal';
    this.phaseEndsAt = this.settings.autoAdvance ? Date.now() + this.t.revealAuto : null;
    if (this.settings.autoAdvance) this.setTimer(this.t.revealAuto, () => this.nextRound());
    this.save('in_progress');
    this.broadcast();
    return { ok: true };
  }

  roundStats(r) {
    const i = this.rounds.indexOf(r);
    const recs = [...this.players.values()].filter((p) => p.eligible[i]).map((p) => ({ p, rec: p.recs[i] }));
    const base = { eligible: recs.length, scored: recs.filter((x) => x.rec.points > 0).length };
    if (r.type === 'zoom') {
      const tiers = r.tiers.map((_, k) => ({ chose: 0, right: 0, counts: [0, 0, 0, 0] }));
      let answered = 0;
      let timeSum = 0;
      for (const { rec } of recs) {
        if (rec.tier == null) continue;
        tiers[rec.tier].chose++;
        if (rec.choice != null) {
          answered++;
          timeSum += rec.timeMs;
          tiers[rec.tier].counts[rec.choice]++;
          if (rec.choice === r.tiers[rec.tier].correct) tiers[rec.tier].right++;
        }
      }
      return { ...base, answered, avgTimeMs: answered ? Math.round(timeSum / answered) : null, tiers };
    }
    if (r.type === 'spark') {
      const finders = recs
        .filter((x) => x.rec.foundMs != null)
        .map((x) => ({ nickname: x.p.nickname, timeMs: x.rec.foundMs, points: x.rec.points }))
        .sort((a, b) => a.timeMs - b.timeMs);
      const tries = recs.reduce((n, x) => n + x.rec.attempts.length, 0);
      return { ...base, found: finders.length, tries, finders, avgTimeMs: finders.length ? Math.round(finders.reduce((s, f) => s + f.timeMs, 0) / finders.length) : null };
    }
    const found = r.waveResults.flatMap((w) => [...w.unique, ...w.dup].map((g) => ({ ...g, wave: w.wave })));
    const left = shuffle(r.names.filter((_, idx) => !r.burned.has(idx))).slice(0, 10);
    const flawless = recs.filter((x) => x.rec.flawless).map((x) => x.p.nickname);
    return { ...base, found, foundCount: r.burned.size, total: r.names.length, left, flawless, waves: r.waveResults };
  }

  finish({ early = false } = {}) {
    if (this.phase === 'end') return { ok: true };
    if (this.phase === 'lobby') return err('BAD_PHASE', 'Ойын әлі басталған жоқ');
    this.clearTimer();
    if (this.phase === 'intro') this.rIndex -= 1; // that round never started
    if (this.phase === 'play' || this.phase === 'wave_reveal') {
      if (this.phase === 'play' && this.round.type === 'scorched') this.resolveCurrentWave();
      this.endPlay();
    }
    this.clearTimer();
    this.endedEarly = early && this.revealedCount < this.rounds.length;
    for (const p of this.players.values()) p.prevRank = p.rank;
    this.rank();
    this.phase = 'end';
    this.phaseEndsAt = null;
    this.endedAt = Date.now();
    this.save('finished');
    this.broadcast();
    this.mgr.scheduleCleanup(this);
    return { ok: true };
  }

  rank() {
    const list = [...this.players.values()].sort((a, b) => b.score - a.score || a.scoredTimeMs - b.scoredTimeMs || a.joinedAt - b.joinedAt);
    list.forEach((p, i) => (p.rank = i + 1));
    return list;
  }

  // ---------- admin report ----------

  timeOf(r, rec) {
    if (r.type === 'zoom') return rec.timeMs;
    if (r.type === 'spark') return rec.foundMs;
    return null;
  }

  playerStats(p) {
    let eligible = 0;
    let acted = 0;
    let scored = 0;
    let timed = 0;
    let totalTimeMs = 0;
    for (let i = 0; i < this.revealedCount; i++) {
      if (!p.eligible[i]) continue;
      const r = this.rounds[i];
      const rec = p.recs[i];
      eligible++;
      if (this.acted(r, rec)) acted++;
      if (rec.points > 0) scored++;
      const t = this.timeOf(r, rec);
      if (t != null) {
        timed++;
        totalTimeMs += t;
      }
    }
    return { eligible, answered: acted, correct: scored, accuracy: eligible ? scored / eligible : null, avgTimeMs: timed ? Math.round(totalTimeMs / timed) : null, totalTimeMs };
  }

  acted(r, rec) {
    if (!rec) return false;
    if (r.type === 'zoom') return rec.choice != null;
    if (r.type === 'spark') return rec.attempts.length > 0;
    return rec.waves.some((w) => w?.text);
  }

  cell(p, i, revealed) {
    const r = this.rounds[i];
    if (!p.eligible[i]) return { s: 'x' };
    const rec = p.recs[i];
    // Live: ✓ means done with the current step (Spark: found it; Scorched: answered this wave).
    if (!revealed) return { s: (this.phase === 'play' && i === this.rIndex ? this.isDone(p) : this.acted(r, rec)) ? 'p' : 'q' };
    const s = rec.points > 0 ? 'c' : this.acted(r, rec) ? 'w' : 'n';
    const c = { s, pts: rec.points, t: this.timeOf(r, rec) };
    if (r.type === 'zoom') {
      c.d = { tier: rec.tier, choice: rec.choice, tierMs: rec.tierMs };
    } else if (r.type === 'spark') {
      c.d = { attempts: rec.attempts.map((a) => ({ text: a.text, ok: a.ok, t: a.t })) };
    } else {
      c.d = { waves: rec.waves.map((w) => (w ? { text: w.text, name: w.name, status: w.status, points: w.points } : null)), flawless: rec.flawless };
    }
    return c;
  }

  roundInfo(r, i, revealed) {
    const base = { n: i + 1, type: r.type, final: r.final, eraName: r.eraName, revealed };
    if (r.type === 'zoom') {
      return {
        ...base,
        title: r.q,
        tiers: r.tiers.map((t) => ({ name: t.name, points: t.points, ...(revealed ? { options: t.options, correct: t.correct } : {}) })),
        fact: revealed ? r.fact : null,
        stats: revealed ? r.stats : null,
      };
    }
    if (r.type === 'spark') return { ...base, title: r.clues.join(' · '), clues: r.clues, answer: revealed ? r.answer : null, fact: revealed ? r.fact : null, stats: revealed ? r.stats : null };
    return { ...base, title: r.cat, cat: r.cat, hint: r.hint, fact: revealed ? r.fact : null, stats: revealed ? r.stats : null };
  }

  /** Full admin report: every player's answer to every round so far. */
  report() {
    const opened = this.openedCount;
    const revealed = this.revealedCount;
    const rounds = this.rounds.slice(0, opened).map((r, i) => this.roundInfo(r, i, i < revealed));
    const players = this.rank().map((p) => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      joinedAt: p.joinedAt,
      score: p.score,
      rank: p.rank,
      stats: this.playerStats(p),
      cells: rounds.map((_, i) => this.cell(p, i, i < revealed)),
    }));
    return { rounds, players };
  }

  // ---------- views ----------

  /** What everyone may see about the current round right now. */
  publicRound() {
    const r = this.round;
    if (!r) return null;
    const out = { n: this.rIndex + 1, type: r.type, final: r.final, eraName: r.eraName };
    if (this.phase === 'intro') return out;
    if (r.type === 'zoom') {
      out.q = r.q;
      out.tiers = r.tiers.map((t) => ({ name: t.name, points: t.points * (r.final ? 2 : 1) }));
    } else if (r.type === 'spark') {
      out.clues = r.clues;
    } else {
      out.cat = r.cat;
      out.hint = r.hint;
      out.wave = this.wave;
      out.wavePoints = SCORCHED.wavePoints.map((x) => x * (r.final ? 2 : 1));
      out.burned = [...r.burned].map((idx) => r.names[idx]);
      if (this.phase === 'wave_reveal') out.waveResult = r.waveResults[this.wave];
    }
    if (this.phase === 'reveal' || this.phase === 'end') {
      out.fact = r.fact;
      out.stats = r.stats;
      if (r.type === 'zoom') out.tiers = r.tiers.map((t) => ({ name: t.name, points: t.points * (r.final ? 2 : 1), options: t.options, correct: t.correct }));
      if (r.type === 'spark') out.answer = r.answer;
    }
    return out;
  }

  baseView() {
    return {
      code: this.code,
      title: this.settings.title,
      mode: this.settings.mode,
      phase: this.phase,
      serverNow: Date.now(),
      phaseEndsAt: this.phaseEndsAt,
      rIndex: this.rIndex,
      rCount: this.rounds.length,
      introKind: this.phase === 'intro' ? this.introKind : null,
      timing: this.phase === 'play' ? { startsAt: this.startsAt, endsAt: this.endsAt } : null,
      round: ['intro', 'play', 'wave_reveal', 'reveal'].includes(this.phase) ? this.publicRound() : null,
      finalCount: this.rounds.filter((r) => r.final).length,
      playerCount: this.players.size,
      maxPlayers: MAX_PLAYERS,
    };
  }

  topList(n) {
    return this.rank()
      .slice(0, n)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        rank: p.rank,
        prevRank: p.prevRank,
        delta: this.phase === 'reveal' && p.eligible[this.rIndex] ? p.recs[this.rIndex]?.points ?? 0 : 0,
      }));
  }

  /** Live progress for the host stage. */
  live() {
    const r = this.round;
    if (!r || this.phase !== 'play') return null;
    let eligible = 0;
    let done = 0;
    const tierCounts = [0, 0, 0];
    const finders = [];
    for (const p of this.players.values()) {
      if (!p.eligible[this.rIndex]) continue;
      eligible++;
      const rec = p.recs[this.rIndex];
      if (this.isDone(p)) done++;
      if (r.type === 'zoom' && rec.tier != null) tierCounts[rec.tier]++;
      if (r.type === 'spark' && rec.foundMs != null) finders.push({ nickname: p.nickname, timeMs: rec.foundMs });
    }
    finders.sort((a, b) => a.timeMs - b.timeMs);
    return { eligible, done, tierCounts, finders };
  }

  hostView() {
    const v = this.baseView();
    v.role = 'host';
    v.roomId = this.id;
    v.settings = this.settings;
    v.endedEarly = this.endedEarly;
    v.live = this.live();
    v.leaderboard = this.topList(this.phase === 'end' ? 25 : 8);
    v.report = this.report();
    return v;
  }

  myRound(p) {
    const r = this.round;
    if (!r || !p.eligible[this.rIndex]) return null;
    const rec = p.recs[this.rIndex];
    if (!rec) return null;
    if (r.type === 'zoom') return { tier: rec.tier, options: rec.tier != null ? r.tiers[rec.tier].options : null, choice: rec.choice, timeMs: rec.timeMs, points: this.phase === 'reveal' ? rec.points : null };
    if (r.type === 'spark') return { attempts: rec.attempts.map((a) => ({ text: a.text, ok: a.ok })), foundMs: rec.foundMs, frozenUntil: rec.frozenUntil, points: this.phase === 'reveal' ? rec.points : null };
    return {
      text: this.phase === 'play' ? rec.waves[this.wave]?.text || null : null,
      waves: rec.waves.map((w, k) => (w && (k < this.wave || this.phase !== 'play') ? { text: w.text, name: w.name, status: w.status, points: w.points } : null)),
      flawless: rec.flawless,
      points: this.phase === 'reveal' ? rec.points : null,
    };
  }

  playerView(p) {
    const v = this.baseView();
    v.role = 'player';
    v.me = { id: p.id, nickname: p.nickname, score: p.score, rank: p.rank, prevRank: p.prevRank };
    if (this.phase === 'lobby') v.lobby = [...this.players.values()].map((x) => ({ id: x.id, nickname: x.nickname, connected: x.connected }));
    if (['play', 'wave_reveal', 'reveal'].includes(this.phase)) {
      v.eligible = !!p.eligible[this.rIndex];
      v.my = this.myRound(p);
    }
    if (this.phase === 'reveal') v.leaderboard = this.topList(5);
    if (this.phase === 'end') {
      v.leaderboard = this.topList(10);
      v.stats = this.playerStats(p);
      v.endedEarly = this.endedEarly;
    }
    return v;
  }

  broadcast() {
    if (this.flushPending || this.destroyed) return;
    this.flushPending = true;
    setImmediate(() => {
      this.flushPending = false;
      if (this.destroyed) return;
      this.io.to(this.hostChannel).emit('state', this.hostView());
      for (const p of this.players.values()) if (p.socketId) this.io.to(p.socketId).emit('state', this.playerView(p));
    });
  }

  record(status) {
    return {
      id: this.id,
      code: this.code,
      hostHash: this.hostHash,
      title: this.settings.title,
      mode: this.settings.mode,
      eras: this.settings.eras,
      settings: this.settings,
      status,
      endedEarly: this.endedEarly,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      questionCount: this.rounds.length,
      report: this.report(),
    };
  }

  save(status) {
    return this.mgr.storage.save(this.record(status));
  }

  destroy() {
    this.destroyed = true;
    this.clearTimer();
    this.io.to(this.hostChannel).emit('room:closed');
    this.io.to(this.playerChannel).emit('room:closed');
    this.io.in(this.hostChannel).socketsLeave(this.hostChannel);
    this.io.in(this.playerChannel).socketsLeave(this.playerChannel);
  }
}

class RoomManager {
  constructor({ io, storage, timings }) {
    this.io = io;
    this.storage = storage;
    this.timings = { ...config.timings, ...(timings || {}) };
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), this.timings.sweepInterval);
    this.sweeper.unref();
  }

  newCode() {
    for (let tries = 0; tries < 1000; tries++) {
      const code = String(crypto.randomInt(100000, 1000000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Бос бөлме коды табылмады');
  }

  create(hostKey, settingsInput) {
    const settings = sanitizeSettings(settingsInput);
    const room = new Room(this, { code: this.newCode(), hostHash: this.storage.hashKey(hostKey), settings });
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code ?? '').replace(/\D/g, ''));
  }

  scheduleCleanup(room) {
    setTimeout(() => this.remove(room), this.timings.endedRoomTtl).unref();
  }

  remove(room) {
    if (this.rooms.get(room.code) !== room) return;
    this.rooms.delete(room.code);
    room.destroy();
  }

  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.phase === 'lobby') {
        let changed = false;
        for (const p of [...room.players.values()]) {
          if (!p.connected && p.offlineSince && now - p.offlineSince > this.timings.lobbyOfflineGrace) {
            room.removePlayer(p);
            changed = true;
          }
        }
        if (changed) room.broadcast();
      }
      const hostOnline = (this.io.sockets.adapter.rooms.get(room.hostChannel)?.size || 0) > 0;
      const anyoneOnline = [...room.players.values()].some((p) => p.connected);
      if (!hostOnline && !anyoneOnline && now - room.lastActivity > this.timings.idleRoomTtl) {
        if (!['lobby', 'end'].includes(room.phase)) room.save('interrupted');
        this.remove(room);
      }
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}

module.exports = { Room, RoomManager, sanitizeSettings, validateNickname, nickKey, cleanText };
