import {
  $,
  h,
  icon,
  ICONS,
  LETTERS,
  MODES,
  FINAL_RULE,
  SCORCH_STATUS,
  modeChip,
  fmtNum,
  fmtSec,
  fmtPct,
  avatar,
  clock,
  connect,
  emitAck,
  connectionBanner,
  mount,
  countUp,
  confetti,
  toast,
  store,
  backdrop,
  runTimer,
  podium,
  lbRow,
  animatedLeaderboard,
  introCard,
} from './common.js';

backdrop();
const app = $('#app');
const socket = connect();
connectionBanner(socket);

const SESSION_KEY = 'tt.player';
const urlCode = (new URLSearchParams(location.search).get('code') || '').replace(/\D/g, '').slice(0, 6);
let session = store.get(SESSION_KEY);
if (urlCode && session?.code !== urlCode) session = null;
let state = null;
let cur = { key: null, update: null, stop: [] };

function setSession(s) {
  session = s;
  if (s) store.set(SESSION_KEY, s);
  else store.del(SESSION_KEY);
}

// ---------- screen plumbing ----------
function show(key, build) {
  for (const fn of cur.stop) fn();
  const screen = build();
  cur = { key, update: screen.update || null, stop: screen.stop || [] };
  mount(app, screen.el);
  screen.update?.(state);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function keyOf(s) {
  const wave = s.round?.type === 'scorched' ? `:${s.round.wave}` : '';
  switch (s.phase) {
    case 'intro':
      return `i:${s.rIndex}`;
    case 'play':
      return `p:${s.rIndex}${wave}`;
    case 'wave_reveal':
      return `w:${s.rIndex}${wave}`;
    case 'reveal':
      return `r:${s.rIndex}`;
    default:
      return s.phase;
  }
}

function render() {
  if (!state) return;
  const key = keyOf(state);
  if (key === cur.key) return cur.update?.(state);
  const builders = { lobby: lobbyScreen, countdown: countdownScreen, intro: introScreen, play: playScreen, wave_reveal: waveRevealScreen, reveal: revealScreen, end: endScreen };
  show(key, builders[state.phase]);
}

// ---------- socket ----------
socket.on('connect', () => {
  if (session?.token) rejoin();
  else if (!cur.key) showJoin();
});
socket.on('state', (s) => {
  clock.sync(s.serverNow);
  state = s;
  render();
});
socket.on('kicked', () => {
  setSession(null);
  state = null;
  showMessage('Сізді ойыннан шығарды', 'Жүргізуші сізді бұл бөлмеден шығарып жіберді.');
});
socket.on('room:closed', () => {
  setSession(null);
  state = null;
  showMessage('Бөлме жабылды', 'Бұл ойын бөлмесі енді қолжетімсіз.');
});
socket.on('session:replaced', () => {
  state = null;
  showMessage('Басқа терезеден кірдіңіз', 'Ойын енді басқа терезеде ашық тұр.', { label: 'Осында жалғастыру', onclick: rejoin });
});

async function rejoin() {
  if (!session?.token) return showJoin();
  if (!cur.key) showLoading();
  const res = await emitAck(socket, 'player:join', { code: session.code, token: session.token, nickname: session.nickname });
  if (res.ok) return setSession({ ...session, nickname: res.nickname, playerId: res.playerId });
  const nick = session.nickname;
  setSession(null);
  state = null;
  showJoin({ nickname: nick, error: res.code === 'ROOM_NOT_FOUND' ? 'Алдыңғы бөлме жабылған — жаңа кодты енгізіңіз' : res.error });
}

async function leave() {
  await emitAck(socket, 'player:leave', {});
  setSession(null);
  state = null;
  showJoin({ nickname: store.get('tt.nick') || '' });
}

async function act(payload) {
  const res = await emitAck(socket, 'player:act', { r: state.rIndex, ...payload });
  if (!res.ok && res.code !== 'FROZEN') toast(res.error, 'bad');
  return res;
}

// ---------- join ----------
function showLoading() {
  show('loading', () => ({
    el: h('section', { class: 'p-screen p-center' }, h('div', { class: 'pulse-ring' }, h('img', { src: '/img/logo.svg', width: 48, height: 48, alt: '' })), h('p', { class: 'muted dots' }, 'Қосылуда')),
  }));
}

function showJoin({ code = urlCode, nickname = store.get('tt.nick') || '', error = '' } = {}) {
  show('join', () => {
    const codeIn = h('input', { class: 'input code', id: 'code', inputmode: 'numeric', autocomplete: 'off', maxlength: 7, placeholder: '······', 'aria-label': 'Бөлме коды', value: code });
    const nickIn = h('input', { class: 'input', id: 'nick', autocomplete: 'nickname', maxlength: 16, placeholder: 'Мысалы: Айбек', value: nickname, enterkeyhint: 'go' });
    const errEl = h('div', { class: 'form-error', role: 'alert' }, error);
    const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Ойынға кіру', icon('next'));
    codeIn.addEventListener('input', () => {
      const digits = codeIn.value.replace(/\D/g, '').slice(0, 6);
      codeIn.value = digits;
      codeIn.classList.remove('invalid');
      if (digits.length === 6 && !nickIn.value) nickIn.focus();
    });
    nickIn.addEventListener('input', () => nickIn.classList.remove('invalid'));
    const form = h('form', { class: 'card stack', novalidate: true }, h('div', { class: 'field' }, h('label', { for: 'code' }, 'Бөлме коды'), codeIn), h('div', { class: 'field' }, h('label', { for: 'nick' }, 'Лақап атың'), nickIn), errEl, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = codeIn.value.replace(/\D/g, '');
      const n = nickIn.value.trim();
      errEl.textContent = '';
      if (c.length !== 6) {
        codeIn.classList.add('invalid');
        errEl.textContent = 'Код 6 саннан тұрады';
        return codeIn.focus();
      }
      if ([...n].length < 2) {
        nickIn.classList.add('invalid');
        errEl.textContent = 'Есіміңізді жазыңыз (кемінде 2 таңба)';
        return nickIn.focus();
      }
      btn.disabled = true;
      const res = await emitAck(socket, 'player:join', { code: c, nickname: n });
      btn.disabled = false;
      if (!res.ok) {
        errEl.textContent = res.error;
        const target = ['ROOM_NOT_FOUND', 'GAME_ENDED', 'ROOM_FULL'].includes(res.code) ? codeIn : nickIn;
        target.classList.add('invalid');
        target.focus();
        return;
      }
      store.set('tt.nick', res.nickname);
      setSession({ code: c, token: res.token, nickname: res.nickname, playerId: res.playerId });
      if (urlCode) history.replaceState(null, '', '/');
    });
    setTimeout(() => (code.length === 6 ? nickIn : codeIn).focus({ preventScroll: true }), 400);
    return {
      el: h(
        'section',
        { class: 'p-screen p-join' },
        h('div', { class: 'brand big' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', { class: 'word' }, 'Тарих', h('b', null, 'Тайталасы'))),
        h('p', { class: 'tagline' }, 'Қазақ тарихы бойынша онлайн жарыс. Тіркелу керек емес — тек код пен есім.'),
        form,
        h('p', { class: 'foot' }, 'Ойын өткізгіңіз келе ме? ', h('a', { href: '/host' }, 'Бөлме құру →'))
      ),
    };
  });
}

function showMessage(title, text, action) {
  show(`msg:${title}`, () => ({
    el: h('section', { class: 'p-screen p-center' }, h('div', { class: 'card stack', style: { maxWidth: '440px', alignItems: 'center' } }, h('h2', null, title), h('p', { class: 'muted', style: { margin: 0 } }, text), action ? h('button', { class: 'btn btn-primary', onclick: action.onclick }, action.label) : null, h('button', { class: 'btn', onclick: () => showJoin() }, 'Басты бет'))),
  }));
}

// ---------- shared parts ----------
function topBar(s) {
  const score = h('b', { class: 'num' }, fmtNum(s.me.score));
  const el = h(
    'header',
    { class: 'p-top' },
    h('img', { src: '/img/logo.svg', class: 'mini-logo', alt: '' }),
    h('div', { class: 'who' }, avatar(s.me.nickname), h('span', null, s.me.nickname)),
    h('span', { class: 'spacer' }),
    s.rIndex >= 0 ? h('span', { class: 'chip num' }, `${s.rIndex + 1}/${s.rCount}`) : null,
    h('span', { class: 'score-pill' }, score, h('small', null, 'ұпай'))
  );
  el.update = (ns) => (score.textContent = fmtNum(ns.me.score));
  return el;
}
const banner = (content, kind = '') => h('div', { class: `p-banner ${kind}` }, content);
const roundMeta = (s) => h('div', { class: 'q-meta' }, modeChip(s.round.type), s.round.eraName ? h('span', { class: 'chip' }, s.round.eraName) : null, s.round.final ? h('span', { class: 'chip final' }, 'ФИНАЛ ×2') : null);

function timerBar(s) {
  const bar = h('i');
  const el = h('div', { class: 'timerbar', role: 'progressbar', 'aria-label': 'Қалған уақыт' }, bar);
  const stop = runTimer({
    startsAt: s.timing.startsAt,
    endsAt: s.timing.endsAt,
    total: s.timing.endsAt - s.timing.startsAt,
    onTick: (f, left, low) => {
      bar.style.transform = `scaleX(${f})`;
      el.classList.toggle('low', low);
    },
  });
  return { el, stop };
}

// ---------- lobby / countdown / intro ----------
function lobbyScreen() {
  const s = state;
  const m = MODES[s.mode];
  const cloud = h('div', { class: 'players-cloud' });
  const count = h('span', { class: 'num' });
  const el = h(
    'section',
    { class: 'p-screen p-lobby' },
    h('header', { class: 'p-top' }, h('img', { src: '/img/logo.svg', class: 'mini-logo', alt: '' }), h('span', { class: 'eyebrow' }, s.title || 'Тарих Тайталасы'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-ghost btn-sm', onclick: leave }, icon('logout'), 'Шығу')),
    h(
      'div',
      { class: 'card me-card' },
      h('div', { class: 'eyebrow' }, 'Сен ойындасың!'),
      avatar(s.me.nickname, 'lg'),
      h('div', { class: 'me-name' }, s.me.nickname),
      h('div', { class: 'row wrap-row', style: { justifyContent: 'center' } }, modeChip(s.mode), h('span', { class: 'chip' }, icon('target'), `${s.rCount} раунд`), s.finalCount ? h('span', { class: 'chip gold' }, 'Финал ×2') : null),
      h('p', { class: 'muted', style: { margin: 0, fontWeight: 600 } }, h('span', { class: 'dots' }, 'Жүргізуші ойынды бастағанша күте тұр'))
    ),
    h('div', { class: 'card tight stack' }, h('div', { class: 'eyebrow' }, `${m.name} — ${m.tagline}`), h('ul', { class: 'rules' }, m.rules.map((r) => h('li', null, r)), s.finalCount ? h('li', null, FINAL_RULE) : null)),
    h('div', { class: 'card tight stack' }, h('div', { class: 'row' }, h('div', { class: 'eyebrow' }, 'Ойыншылар'), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, icon('users'), count)), cloud)
  );
  const update = (ns) => {
    count.textContent = `${ns.playerCount}/${ns.maxPlayers}`;
    const want = new Map((ns.lobby || []).map((p) => [p.id, p]));
    for (const chip of [...cloud.children]) if (!want.has(chip.dataset.id)) chip.remove();
    for (const p of want.values()) {
      let chip = cloud.querySelector(`[data-id="${p.id}"]`);
      if (!chip) {
        chip = h('span', { class: `pchip ${p.id === ns.me.id ? 'me' : ''}`, dataset: { id: p.id } }, avatar(p.nickname), h('span', { class: 'name' }, p.nickname));
        cloud.append(chip);
      }
      chip.classList.toggle('off', !p.connected);
    }
  };
  return { el, update };
}

function countdownScreen() {
  const holder = h('div');
  const el = h('section', { class: 'p-screen p-center splash' }, h('div', { class: 'stack', style: { alignItems: 'center' } }, h('div', { class: 'eyebrow' }, 'Дайындал!'), holder, modeChip(state.mode)));
  let last = null;
  const iv = setInterval(() => {
    const n = Math.ceil(Math.max(0, (state.phaseEndsAt || 0) - clock.now()) / 1000);
    const label = n > 0 ? String(Math.min(n, 3)) : 'Бастадық!';
    if (label !== last) {
      last = label;
      holder.replaceChildren(h('div', { class: 'count-num', style: n > 0 ? null : { fontSize: 'clamp(44px,12vw,90px)' } }, label));
    }
  }, 100);
  return { el, stop: [() => clearInterval(iv)] };
}

function introScreen() {
  return { el: h('section', { class: 'p-screen p-center' }, topBar(state), h('div', { style: { margin: 'auto 0', width: '100%' } }, introCard(state))) };
}

// ---------- play ----------
function playScreen() {
  if (!state.eligible) {
    return { el: h('section', { class: 'p-screen' }, topBar(state), roundMeta(state), banner('Сен келесі раундтан бастап ойнайсың — қазір көрермен боп тұр')) };
  }
  return { zoom: zoomPlay, spark: sparkPlay, scorched: scorchedPlay }[state.round.type]();
}

const TIER_LEVEL = ['Кең', 'Орташа', 'Нақты'];

function zoomPlay() {
  const s = state;
  const r = s.round;
  const top = topBar(s);
  const timer = timerBar(s);
  const tiers = h(
    'div',
    { class: 'tiers', role: 'group', 'aria-label': 'Дәлдік деңгейі' },
    r.tiers.map((t, k) => h('button', { class: 'tier', type: 'button', onclick: () => chooseTier(k) }, h('span', { class: 'lvl' }, TIER_LEVEL[k]), h('span', { class: 'pts' }, `+${t.points}`), h('span', { class: 'nm' }, t.name)))
  );
  const hint = h('p', { class: 'muted small', style: { margin: 0, textAlign: 'center', fontWeight: 700 } }, 'Алдымен дәлдікті таңда — нұсқалар содан кейін ашылады');
  const optsHost = h('div');
  const status = h('div');
  let busy = false;
  let shownTier = null;
  const accepted = (ms) => banner([h('span', null, 'Жауап қабылданды'), h('b', null, fmtSec(ms)), h('span', { class: 'muted dots' }, 'күтеміз')], 'gold');

  async function chooseTier(k) {
    if (busy || state.my?.tier != null) return;
    busy = true;
    const res = await act({ kind: 'tier', tier: k });
    busy = false;
    if (res.ok) renderOptions(k, res.options);
  }
  async function pick(i) {
    if (busy || state.my?.choice != null) return;
    busy = true;
    const list = optsHost.querySelector('.options');
    list?.classList.add('locked');
    list?.children[i]?.classList.add('picked');
    navigator.vibrate?.(12);
    const res = await act({ kind: 'pick', choice: i });
    busy = false;
    if (!res.ok) {
      list?.classList.remove('locked');
      list?.children[i]?.classList.remove('picked');
    } else status.replaceChildren(accepted(res.timeMs));
  }
  function renderOptions(k, options) {
    if (shownTier === k) return;
    shownTier = k;
    tiers.classList.add('chosen');
    [...tiers.children].forEach((b, i) => {
      b.classList.toggle('on', i === k);
      b.disabled = true;
    });
    hint.textContent = `«${r.tiers[k].name}» деңгейі: дұрыс болса +${r.tiers[k].points} ұпай`;
    optsHost.replaceChildren(h('div', { class: 'options' }, options.map((txt, i) => h('button', { class: 'opt', type: 'button', onclick: () => pick(i) }, h('span', { class: 'letter' }, LETTERS[i]), h('span', { class: 'otext' }, txt)))));
  }
  const el = h('section', { class: 'p-screen p-question mode-zoom' }, top, h('div', { class: 'card q-card' }, roundMeta(s), h('h1', { class: 'q-text enter' }, r.q), timer.el), tiers, hint, status, optsHost);
  const update = (ns) => {
    top.update(ns);
    const my = ns.my;
    if (my?.tier != null && my.options) renderOptions(my.tier, my.options);
    if (my?.choice != null) {
      const list = optsHost.querySelector('.options');
      list?.classList.add('locked');
      [...(list?.children || [])].forEach((o, i) => o.classList.toggle('picked', i === my.choice));
      if (!status.firstChild) status.replaceChildren(accepted(my.timeMs));
    }
  };
  return { el, update, stop: [timer.stop] };
}

function answerForm({ placeholder, onSubmit, label = 'Жіберу' }) {
  const input = h('input', { class: 'input', placeholder, maxlength: 48, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': placeholder });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('send'), label);
  const form = h('form', { class: 'answer-form' }, input, btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (v) onSubmit(v, input, btn);
  });
  setTimeout(() => input.focus({ preventScroll: true }), 700);
  return { form, input, btn };
}

function sparkPlay() {
  const s = state;
  const r = s.round;
  const top = topBar(s);
  const timer = timerBar(s);
  const attempts = h('div', { class: 'attempts' });
  const status = h('div');
  let freezeTimer = null;
  let done = false;
  const f = answerForm({
    placeholder: 'Жауабың…',
    onSubmit: async (v, input, btn) => {
      btn.disabled = true;
      const res = await act({ kind: 'guess', text: v });
      btn.disabled = false;
      if (res.ok && !res.correct) {
        input.value = '';
        navigator.vibrate?.(60);
      }
      if (res.code === 'FROZEN' || (res.ok && !res.correct)) freeze(res.frozenUntil);
    },
  });
  function freeze(until) {
    clearInterval(freezeTimer);
    f.input.disabled = true;
    f.btn.disabled = true;
    const tick = () => {
      const left = Math.max(0, until - clock.now());
      if (left <= 0) {
        clearInterval(freezeTimer);
        freezeTimer = null;
        status.replaceChildren();
        f.input.disabled = false;
        f.btn.disabled = false;
        f.input.focus({ preventScroll: true });
        return;
      }
      status.replaceChildren(h('div', { class: 'frozen' }, icon('clock'), `Қате! ${Math.ceil(left / 1000)} с күт`));
    };
    tick();
    freezeTimer = setInterval(tick, 200);
  }
  const el = h(
    'section',
    { class: 'p-screen p-question mode-spark' },
    top,
    h('div', { class: 'card q-card' }, roundMeta(s), h('div', { class: 'eyebrow' }, 'Үш кілт — бір жауап'), timer.el),
    h('div', { class: 'clues' }, r.clues.map((c, i) => h('div', { class: 'clue' }, h('span', { class: 'no' }, i + 1), h('span', null, c)))),
    status,
    f.form,
    attempts
  );
  const update = (ns) => {
    top.update(ns);
    const my = ns.my;
    if (!my) return;
    attempts.replaceChildren(...my.attempts.filter((a) => !a.ok).map((a) => h('span', { class: 'chip bad' }, a.text)));
    if (my.foundMs != null && !done) {
      done = true;
      clearInterval(freezeTimer);
      f.form.remove();
      status.replaceChildren(h('div', { class: 'status-line good' }, icon('check'), `Таптың! ${fmtSec(my.foundMs)}`, h('span', { class: 'pts muted dots' }, 'күтеміз')));
      navigator.vibrate?.([20, 40, 20]);
    } else if (!done && my.frozenUntil > clock.now() && !freezeTimer) freeze(my.frozenUntil);
  };
  return { el, update, stop: [timer.stop, () => clearInterval(freezeTimer)] };
}

function waveSteps(r, phase) {
  return h(
    'div',
    { class: 'waves' },
    r.wavePoints.map((p, k) => h('div', { class: `wave-step ${k === r.wave && phase === 'play' ? 'on' : k < r.wave || (k === r.wave && phase !== 'play') ? 'done' : ''}` }, h('b', null, `+${p}`), `${k + 1}-толқын`))
  );
}

function scorchedPlay() {
  const s = state;
  const r = s.round;
  const top = topBar(s);
  const timer = timerBar(s);
  const mine = h('div');
  const f = answerForm({
    placeholder: 'Ешкім айтпайтын жауап…',
    onSubmit: async (v, input, btn) => {
      btn.disabled = true;
      const res = await act({ kind: 'submit', wave: r.wave, text: v });
      btn.disabled = false;
      if (res.ok) input.value = '';
    },
  });
  const el = h(
    'section',
    { class: 'p-screen p-question mode-scorched' },
    top,
    h('div', { class: 'card q-card' }, roundMeta(s), h('h1', { class: 'big-cat q-text enter' }, r.cat), r.hint ? h('p', { class: 'muted small', style: { margin: 0, fontWeight: 700 } }, r.hint) : null, timer.el),
    waveSteps(r, s.phase),
    mine,
    f.form,
    r.burned.length ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Күйген жауаптар — бұларды жазба'), h('div', { class: 'chips' }, r.burned.map((b) => h('span', { class: 'chip burnt' }, b)))) : null
  );
  const update = (ns) => {
    top.update(ns);
    const t = ns.my?.text;
    if (t) mine.replaceChildren(banner([h('span', null, 'Жауабың:'), h('b', null, `«${t}»`), h('span', { class: 'muted small' }, 'өзгертуге болады')], 'gold'));
  };
  return { el, update, stop: [timer.stop] };
}

// ---------- results ----------
function statusLine(w) {
  if (!w) return h('div', { class: 'status-line dim' }, SCORCH_STATUS.none);
  const good = w.status === 'unique';
  return h(
    'div',
    { class: `status-line ${good ? 'good' : w.status === 'none' ? 'dim' : 'bad'}` },
    icon(good ? 'check' : w.status === 'dup' || w.status === 'burned' ? 'fire' : w.status === 'none' ? 'clock' : 'cross'),
    h('span', null, w.text ? `«${w.text}» — ` : '', SCORCH_STATUS[w.status] || SCORCH_STATUS.none),
    h('span', { class: 'pts' }, good ? `+${w.points}` : '0')
  );
}

function waveRevealScreen() {
  const s = state;
  const r = s.round;
  const res = r.waveResult;
  const me = s.my?.waves?.[r.wave];
  return {
    el: h(
      'section',
      { class: 'p-screen p-question mode-scorched' },
      topBar(s),
      h('div', { class: 'card q-card' }, roundMeta(s), h('h1', { class: 'big-cat' }, r.cat)),
      waveSteps(r, s.phase),
      s.eligible ? statusLine(me) : null,
      res.unique.length ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Бірегей жауаптар'), h('div', { class: 'chips' }, res.unique.map((g) => h('span', { class: 'chip found' }, g.name, h('small', null, `· ${g.nicks.join(', ')}`))))) : null,
      res.dup.length ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Қайталанып, күйіп кеткендер'), h('div', { class: 'chips' }, res.dup.map((g) => h('span', { class: 'chip burnt' }, g.name, h('small', null, `· ${g.nicks.length} адам`))))) : null,
      h('p', { class: 'small muted', style: { margin: 0, textAlign: 'center', fontWeight: 700 } }, `Бұрын айтылған: ${res.burned} · Қабылданбаған: ${res.invalid} · Жауапсыз: ${res.none}`)
    ),
  };
}

function resultHero(s, extraBadges = []) {
  const my = s.my;
  const pts = my?.points ?? 0;
  const kind = !my ? 'skip' : pts > 0 ? 'ok' : 'no';
  const ptsEl = h('span', { class: 'num' }, '0');
  setTimeout(() => countUp(ptsEl, 0, pts, 900), 300);
  if (kind === 'ok') navigator.vibrate?.([20, 40, 20]);
  return h(
    'div',
    { class: 'result-hero' },
    h('div', { class: `result-icon ${kind === 'ok' ? 'ok' : kind === 'no' ? 'no' : 'none'}`, html: ICONS[kind === 'ok' ? 'check' : kind === 'no' ? 'cross' : 'eye'] }),
    h('h1', { class: 'result-title' }, kind === 'ok' ? 'Жарайсың!' : kind === 'no' ? 'Бұл жолы болмады' : 'Бұл раундқа қатыспадың'),
    my ? h('div', { class: `points-big ${pts === 0 ? 'zero' : ''}` }, pts > 0 ? '+' : '', ptsEl, h('span', { style: { fontSize: '0.45em', marginLeft: '8px' } }, 'ұпай')) : null,
    extraBadges.length || s.round.final ? h('div', { class: 'badges' }, s.round.final ? h('span', { class: 'chip final' }, 'Финал ×2') : null, ...extraBadges) : null
  );
}

function revealScreen() {
  const s = state;
  const r = s.round;
  const my = s.my;
  const top = topBar(s);
  const parts = [];
  const badges = [];
  if (r.type === 'zoom') {
    if (my?.tier != null) badges.push(h('span', { class: 'chip' }, `${TIER_LEVEL[my.tier]} деңгей`));
    if (my?.timeMs != null) badges.push(h('span', { class: 'chip' }, icon('clock'), fmtSec(my.timeMs)));
    parts.push(
      h('p', { class: 'muted', style: { margin: 0, fontWeight: 700 } }, r.q),
      h(
        'div',
        { class: 'stack', style: { gap: '8px' } },
        r.tiers.map((t, k) =>
          h(
            'div',
            { class: `tier-row ${my?.tier === k ? 'mine' : ''}` },
            h('span', { class: 'nm' }, `+${t.points}`, h('b', null, t.name)),
            h('span', { class: 'ans' }, t.options[t.correct]),
            my?.tier === k && my.choice != null && my.choice !== t.correct
              ? h('span', { class: 'st', style: { color: '#FFB0BC' } }, `сен: ${t.options[my.choice]}`)
              : h('span', { class: 'st' }, r.stats ? `${r.stats.tiers[k].right}/${r.stats.tiers[k].chose} дұрыс` : '')
          )
        )
      )
    );
  } else if (r.type === 'spark') {
    if (my?.foundMs != null) badges.push(h('span', { class: 'chip' }, icon('clock'), fmtSec(my.foundMs)));
    if (my?.attempts?.length) badges.push(h('span', { class: 'chip' }, `${my.attempts.length} әрекет`));
    parts.push(h('div', { class: 'card tight center stack', style: { gap: '6px' } }, h('div', { class: 'eyebrow' }, 'Жауап'), h('div', { class: 'answer-big' }, r.answer)));
    parts.push(h('div', { class: 'clues' }, r.clues.map((c, i) => h('div', { class: 'clue', style: { fontSize: '15px', padding: '10px 14px' } }, h('span', { class: 'no' }, i + 1), h('span', null, c)))));
    if (r.stats?.finders?.length) parts.push(h('div', { class: 'chips' }, r.stats.finders.slice(0, 8).map((f, i) => h('span', { class: `chip ${i === 0 ? 'gold' : ''}` }, i === 0 ? icon('bolt') : null, `${f.nickname} · ${fmtSec(f.timeMs)}`))));
  } else {
    if (my?.flawless) badges.push(h('span', { class: 'chip gold' }, icon('crown'), 'Мінсіз! +3'));
    parts.push(h('h2', { style: { margin: 0 } }, r.cat));
    if (my) parts.push(h('div', { class: 'stack', style: { gap: '8px' } }, [0, 1, 2].map((k) => statusLine(my.waves?.[k]))));
    const st = r.stats;
    if (st) {
      parts.push(h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, `Табылғаны: ${st.foundCount} / ${st.total}`), h('div', { class: 'chips' }, st.found.map((g) => h('span', { class: `chip ${g.nicks.length === 1 ? 'found' : 'burnt'}` }, g.name)))));
      if (st.left.length) parts.push(h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Ешкім айтпаған жауаптар'), h('div', { class: 'chips' }, st.left.map((n) => h('span', { class: 'chip left' }, n)))));
    }
  }
  const lb = animatedLeaderboard(s.leaderboard, { meId: s.me.id });
  const inTop = s.leaderboard.some((p) => p.id === s.me.id);
  const moved = s.me.prevRank && s.me.rank ? s.me.prevRank - s.me.rank : 0;
  const el = h(
    'section',
    { class: 'p-screen p-reveal' },
    top,
    s.eligible ? resultHero(s, badges) : h('div', { class: 'card tight' }, roundMeta(s)),
    ...parts,
    r.fact ? h('div', { class: 'fact' }, h('b', null, 'Білгенге маржан'), r.fact) : null,
    h('div', { class: 'card tight stack' }, h('div', { class: 'eyebrow' }, 'Рейтинг'), lb, !inTop ? h('ol', { class: 'lb' }, lbRow({ ...s.me, delta: my?.points || 0 }, { meId: s.me.id, delta: true })) : null),
    h('p', { class: 'rank-line' }, 'Орның: ', h('b', null, s.me.rank), ` / ${s.playerCount}`, moved > 0 ? h('span', { style: { color: 'var(--good)' } }, `  ▲ ${moved}`) : moved < 0 ? h('span', { style: { color: 'var(--bad)' } }, `  ▼ ${-moved}`) : null)
  );
  return { el, update: (ns) => top.update(ns), stop: [lb.cancel] };
}

// ---------- end ----------
function endScreen() {
  const s = state;
  const st = s.stats || {};
  const tiles = [
    ['Ұпай', fmtNum(s.me.score)],
    ['Ұпайлы раунд', `${st.correct ?? 0} / ${st.eligible ?? 0}`],
    ['Дәлдік', fmtPct(st.accuracy)],
    ['Орташа уақыт', fmtSec(st.avgTimeMs)],
  ];
  const el = h(
    'section',
    { class: 'p-screen p-end' },
    h('header', { class: 'p-top' }, h('img', { src: '/img/logo.svg', class: 'mini-logo', alt: '' }), h('span', { class: 'eyebrow' }, 'Ойын аяқталды'), h('span', { class: 'spacer' }), modeChip(s.mode)),
    podium(s.leaderboard.slice(0, 3), s.me.id),
    h('div', { class: 'myplace' }, h('div', { class: 'eyebrow' }, 'Сенің орның'), h('div', { class: 'big' }, s.me.rank), h('div', { class: 'muted' }, `${s.playerCount} ойыншының ішінде`)),
    h('div', { class: 'stats' }, tiles.map(([k, v], i) => h('div', { class: 'stat', style: { animationDelay: `${2 + i * 0.08}s` } }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k)))),
    h('div', { class: 'card tight stack' }, h('div', { class: 'eyebrow' }, 'Қорытынды рейтинг'), h('ol', { class: 'lb' }, s.leaderboard.map((p) => lbRow(p, { meId: s.me.id })))),
    h('button', { class: 'btn btn-primary btn-lg', onclick: leave }, 'Жаңа ойынға кіру')
  );
  const t = s.me.rank <= 3 ? setTimeout(() => confetti(), 1900) : null;
  return { el, stop: [() => clearTimeout(t)] };
}

if (session?.token) showLoading();
else showJoin();
