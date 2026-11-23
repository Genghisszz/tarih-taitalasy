import {
  $,
  h,
  icon,
  ICONS,
  LETTERS,
  MODES,
  LENGTHS,
  FINAL_RULE,
  modeChip,
  fmtSec,
  fmtCode,
  avatar,
  clock,
  connect,
  emitAck,
  connectionBanner,
  mount,
  confetti,
  toast,
  store,
  backdrop,
  hostKey,
  runTimer,
  copyText,
  podium,
  lbRow,
  animatedLeaderboard,
  introCard,
} from './common.js';
import { playersTable, answersMatrix, roundsList, openPlayer, downloadCsv } from './report.js';

backdrop();
const root = $('#root');
const socket = connect();
connectionBanner(socket);
const KEY = hostKey();

let meta = null;
let roomCode = (new URLSearchParams(location.search).get('room') || '').replace(/\D/g, '') || null;
let state = null;
let ui = null;
let tab = 'stage';

const joinUrl = (code) => `${location.origin}/?code=${code}`;
const TIER_LEVEL = ['Кең', 'Орташа', 'Нақты'];

// ---------- boot ----------
(async function boot() {
  try {
    meta = await (await fetch('/api/meta')).json();
  } catch {
    root.replaceChildren(h('div', { class: 'wrap', style: { padding: '40px 0' } }, h('h2', null, 'Сервермен байланыс жоқ'), h('button', { class: 'btn', onclick: () => location.reload() }, 'Қайталау')));
    return;
  }
  if (roomCode) showLoading();
  else showCreate();
  if (socket.connected && roomCode) attach(roomCode);
})();

socket.on('connect', () => {
  if (roomCode && meta) attach(roomCode);
});
socket.on('state', (s) => {
  if (s.role !== 'host' || (roomCode && s.code !== roomCode)) return;
  clock.sync(s.serverNow);
  state = s;
  if (!ui) buildRoom();
  renderRoom();
});
socket.on('room:closed', () => {
  toast('Бөлме жабылды');
  exitRoom();
});

async function attach(code) {
  const res = await emitAck(socket, 'host:attach', { code, hostKey: KEY });
  if (!res.ok) {
    exitRoom();
    toast(res.error, 'bad');
  }
}

function exitRoom() {
  roomCode = null;
  state = null;
  ui = null;
  tab = 'stage';
  history.replaceState(null, '', '/host');
  showCreate();
}

function showLoading() {
  root.replaceChildren(h('div', { class: 'center', style: { minHeight: '100dvh' } }, h('div', { class: 'stack', style: { alignItems: 'center' } }, h('div', { class: 'pulse-ring' }, h('img', { src: '/img/logo.svg', width: 48, height: 48, alt: '' })), h('p', { class: 'muted dots' }, 'Бөлмеге қосылуда'))));
}

async function act(action, extra = {}) {
  const res = await emitAck(socket, 'host:action', { action, ...extra });
  if (!res.ok) toast(res.error, 'bad');
  return res;
}

// ---------- create ----------
function showCreate() {
  const saved = store.get('tt.lastSettings') || {};
  const allEras = meta.eras.map((e) => e.id);
  const s = {
    title: saved.title || '',
    mode: MODES[saved.mode] ? saved.mode : 'mix',
    eras: Array.isArray(saved.eras) && saved.eras.some((id) => allEras.includes(id)) ? saved.eras.filter((id) => allEras.includes(id)) : [...allEras],
    length: meta.lengths.includes(saved.length) ? saved.length : 'normal',
    finalEnabled: saved.finalEnabled ?? true,
    autoAdvance: saved.autoAdvance ?? true,
    chrono: saved.chrono ?? true,
  };
  const avail = () => s.eras.reduce((a, id) => {
    const c = meta.eras.find((e) => e.id === id)?.counts || {};
    return { zoom: a.zoom + (c.zoom || 0), spark: a.spark + (c.spark || 0), scorched: Math.max(a.scorched, c.scorched || 0) };
  }, { zoom: 0, spark: 0, scorched: 0 });
  const SECS = { zoom: (meta.timings.zoom + 12000) / 1000, spark: (meta.timings.spark + 12000) / 1000, scorched: (meta.timings.wave * 3 + 15000 + 12000) / 1000 };
  function estimate() {
    const a = avail();
    const P = meta.plans;
    let plan;
    if (s.mode === 'mix') {
      const [z, sp, sc] = P.mix[s.length];
      plan = { zoom: Math.min(z, a.zoom), spark: Math.min(sp, a.spark), scorched: Math.min(sc, a.scorched) };
      if (s.finalEnabled) ['zoom', 'spark', 'scorched'].forEach((t) => a[t] > plan[t] && plan[t]++);
    } else plan = { zoom: 0, spark: 0, scorched: 0, [s.mode]: Math.min(P[s.mode][s.length], a[s.mode]) };
    const rounds = plan.zoom + plan.spark + plan.scorched;
    const secs = plan.zoom * SECS.zoom + plan.spark * SECS.spark + plan.scorched * SECS.scorched;
    return { rounds, mins: Math.max(1, Math.round(secs / 60)), plan };
  }

  const modeCards = Object.entries(MODES).map(([id, m]) =>
    h(
      'button',
      { type: 'button', class: `mode-card mode-${id}-c`, role: 'radio', dataset: { mode: id }, onclick: () => ((s.mode = id), sync()) },
      h('span', { class: 'tick', html: ICONS.check }),
      h('span', { class: 'mi', html: ICONS[m.icon] }),
      h('span', { class: 'nm' }, m.name),
      h('span', { class: 'tg' }, m.tagline),
      h('ul', { class: 'rules' }, m.rules.map((r) => h('li', null, r)))
    )
  );
  const eraBtns = meta.eras.map((e) =>
    h(
      'button',
      {
        type: 'button',
        class: 'era',
        dataset: { id: e.id },
        onclick: () => {
          s.eras = s.eras.includes(e.id) ? s.eras.filter((x) => x !== e.id) : [...s.eras, e.id];
          sync();
        },
      },
      h('span', { class: 'no' }, String(e.order).padStart(2, '0')),
      h('span', null, h('span', { class: 'nm' }, e.name), h('span', { class: 'pd' }, e.period))
    )
  );
  const allBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ((s.eras = s.eras.length === allEras.length ? [] : [...allEras]), sync()) });
  const eraCount = h('span', { class: 'chip gold' });
  const lengthSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ұзақтығы' }, meta.lengths.map((l) => h('button', { type: 'button', dataset: { v: l }, onclick: () => ((s.length = l), sync()) }, LENGTHS[l])));
  const switchIn = (key) => h('input', { type: 'checkbox', onchange: (e) => ((s[key] = e.target.checked), sync()) });
  const finalSwitch = switchIn('finalEnabled');
  const autoSwitch = switchIn('autoAdvance');
  const chronoSwitch = switchIn('chrono');
  const titleIn = h('input', { class: 'input', maxlength: 60, placeholder: 'Мысалы: 9 «Ә» сынып — Қазақ хандығы', value: s.title, oninput: (e) => (s.title = e.target.value) });
  const sum = {};
  ['mode', 'eras', 'rounds', 'final', 'dur'].forEach((k) => (sum[k] = h('dd')));
  const createBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: create }, icon('play'), 'Бөлме құру');
  const errEl = h('div', { class: 'form-error', role: 'alert' });

  function sync() {
    modeCards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.mode === s.mode)));
    eraBtns.forEach((b) => b.setAttribute('aria-pressed', String(s.eras.includes(b.dataset.id))));
    allBtn.textContent = s.eras.length === allEras.length ? 'Тазалау' : 'Барлығын таңдау';
    eraCount.textContent = `${s.eras.length} / ${allEras.length} кезең`;
    [...lengthSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.length)));
    finalSwitch.checked = s.finalEnabled;
    autoSwitch.checked = s.autoAdvance;
    chronoSwitch.checked = s.chrono;
    const est = estimate();
    sum.mode.replaceChildren(modeChip(s.mode));
    sum.eras.textContent = s.eras.length === allEras.length ? 'Барлық тарих' : `${s.eras.length} кезең`;
    sum.rounds.textContent = s.mode === 'mix' ? `${est.rounds} (${est.plan.zoom} / ${est.plan.spark} / ${est.plan.scorched})` : `${est.rounds}`;
    sum.final.textContent = s.finalEnabled ? 'соңғы 3 раунд ×2' : 'жоқ';
    sum.dur.textContent = `≈ ${est.mins} мин`;
    createBtn.disabled = s.eras.length === 0 || est.rounds === 0;
    errEl.textContent = s.eras.length === 0 ? 'Кемінде бір кезең таңдаңыз' : est.rounds === 0 ? 'Бұл кезеңдерде осы режимге сұрақ жоқ' : '';
  }

  async function create() {
    createBtn.disabled = true;
    tab = 'stage';
    const res = await emitAck(socket, 'host:create', { hostKey: KEY, settings: { ...s, title: titleIn.value } });
    createBtn.disabled = false;
    if (!res.ok) return (errEl.textContent = res.error);
    store.set('tt.lastSettings', { ...s, title: titleIn.value });
    roomCode = res.code;
    history.replaceState(null, '', `/host?room=${res.code}`);
  }

  const switchRow = (input, label, hint) => h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', null, label, hint ? h('span', { class: 'small muted', style: { display: 'block', fontWeight: 600 } }, hint) : null));
  const section = (n, title, extra, ...body) => h('div', { class: 'card' }, h('div', { class: 'section-head' }, h('span', { class: 'step' }, n), h('h2', null, title), h('span', { class: 'spacer' }), extra), ...body);

  root.replaceChildren(
    h(
      'div',
      { class: 'wrap h-create' },
      h('div', { class: 'topline' }, h('a', { class: 'brand', href: '/' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', { class: 'word' }, 'Тарих', h('b', null, 'Тайталасы'))), h('span', { class: 'spacer' }), h('a', { class: 'btn btn-sm', href: '/history' }, icon('history'), 'Ойындар тарихы')),
      h('h1', null, 'Жаңа ойын құру'),
      h('p', { class: 'lead' }, `Ойыншылар тіркелусіз кіреді — тек бөлме коды мен есім. Бір бөлмеге ${meta.maxPlayers} ойыншыға дейін.`),
      h(
        'div',
        { class: 'create-grid' },
        h(
          'div',
          { class: 'stack' },
          section(1, 'Режим', null, h('div', { class: 'mode-cards four', role: 'radiogroup', 'aria-label': 'Режим' }, modeCards)),
          section(2, 'Тарихи кезеңдер', h('div', { class: 'row' }, eraCount, allBtn), h('div', { class: 'era-grid' }, eraBtns)),
          section(
            3,
            'Баптаулар',
            null,
            h(
              'div',
              { class: 'settings-grid' },
              h('div', { class: 'field' }, h('label', null, 'Ойын атауы (міндетті емес)'), titleIn),
              h('div', { class: 'setting' }, h('span', { class: 'label' }, 'Ойын ұзақтығы'), lengthSeg),
              switchRow(finalSwitch, 'Финал ×2', 'Соңғы 3 раундта ұпай екі есе'),
              switchRow(autoSwitch, 'Келесі раундқа автоматты өту', 'Өшірсеңіз, әр раундты өзіңіз ауыстырасыз'),
              switchRow(chronoSwitch, 'Хронологиялық рет', 'Әр актіде тас дәуірінен бүгінге қарай')
            )
          )
        ),
        h('aside', { class: 'card summary' }, h('h2', null, 'Қорытынды'), h('dl', null, h('dt', null, 'Режим'), sum.mode, h('dt', null, 'Тақырып'), sum.eras, h('dt', null, 'Раунд'), sum.rounds, h('dt', null, 'Финал'), sum.final, h('dt', null, 'Ұзақтығы'), sum.dur), errEl, createBtn)
      )
    )
  );
  sync();
}

// ---------- room ----------
function buildRoom() {
  const codeEl = h('span', { class: 'code num' });
  const phaseEl = h('span', { class: 'phase-pill' });
  const controls = h('div', { class: 'controls' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const stage = h('section', { class: 'h-stage stage-root', 'aria-live': 'polite' });
  const side = h('aside', { class: 'h-side' });
  const main = h('main', { class: 'h-main' }, stage, side);
  const panel = h('section', { class: 'panel-wrap hidden' });
  root.replaceChildren(
    h(
      'header',
      { class: 'h-bar' },
      h('div', { class: 'brand' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', { class: 'word' }, 'Тарих', h('b', null, 'Тайталасы'))),
      h('div', { class: 'codebox' }, h('div', null, h('div', { class: 'lbl' }, 'Бөлме коды'), codeEl), h('button', { class: 'btn btn-sm', onclick: copyLink, title: 'Қосылу сілтемесін көшіру' }, icon('copy'), 'Сілтеме')),
      modeChip(state.mode),
      phaseEl,
      controls
    ),
    h('div', { class: 'h-tabs-row' }, tabs, h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm btn-ghost', onclick: toggleFullscreen, title: 'Толық экран (проектор үшін)' }, icon('expand'), 'Толық экран'), h('a', { class: 'btn btn-sm btn-ghost', href: '/history', target: '_blank', rel: 'noopener' }, icon('history'), 'Тарих')),
    main,
    panel
  );
  ui = { codeEl, phaseEl, controls, tabs, stage, side, main, panel, stageKey: null, stage$: null, sideKey: null, side$: null, controlsKey: null, controlsStop: null };
}

function copyLink() {
  copyText(joinUrl(state.code)).then((ok) => toast(ok ? 'Сілтеме көшірілді' : 'Көшіру мүмкін болмады', ok ? 'good' : 'bad'));
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function phaseLabel(s) {
  const n = `${s.rIndex + 1} / ${s.rCount}`;
  return { lobby: 'Ойыншыларды күтуде', countdown: 'Басталуда…', intro: `Раунд ${n}`, play: `Раунд ${n}`, wave_reveal: `Раунд ${n} · толқын нәтижесі`, reveal: `Раунд ${n} · нәтиже`, end: 'Ойын аяқталды' }[s.phase];
}

function renderRoom() {
  const s = state;
  ui.codeEl.textContent = fmtCode(s.code);
  ui.phaseEl.textContent = phaseLabel(s);
  document.title = `${fmtCode(s.code)} · Тарих Тайталасы`;
  renderControls();
  renderTabs();
  const onStage = tab === 'stage';
  ui.main.classList.toggle('hidden', !onStage);
  ui.panel.classList.toggle('hidden', onStage);
  if (onStage) {
    renderStage();
    renderSide();
  } else renderPanel();
}

function renderControls() {
  const s = state;
  const key = `${s.phase}:${s.rIndex}:${s.round?.wave ?? ''}`;
  if (key !== ui.controlsKey) {
    ui.controlsStop?.();
    ui.controlsStop = null;
    ui.controlsKey = key;
    const endBtn = h('button', { class: 'btn btn-danger', onclick: endGame }, icon('stop'), 'Аяқтау');
    const kids = [];
    if (s.phase === 'lobby') kids.push(h('button', { class: 'btn btn-primary', dataset: { role: 'start' }, onclick: () => act('start') }, icon('play'), 'Ойынды бастау'));
    if (s.phase === 'play') kids.push(h('button', { class: 'btn', onclick: () => act('skip') }, icon('eye'), s.round?.type === 'scorched' ? 'Толқынды аяқтау' : 'Уақытты аяқтау'), endBtn);
    if (['countdown', 'intro', 'wave_reveal'].includes(s.phase)) kids.push(endBtn);
    if (s.phase === 'reveal') {
      const note = h('span', { class: 'auto-note' });
      const last = s.rIndex + 1 >= s.rCount;
      kids.push(note, h('button', { class: 'btn btn-primary', onclick: () => act('next') }, last ? 'Нәтижелер' : 'Келесі раунд', icon('next')), endBtn);
      if (s.phaseEndsAt) {
        const iv = setInterval(() => (note.textContent = `Авто: ${Math.max(0, Math.ceil((state.phaseEndsAt - clock.now()) / 1000))} с`), 200);
        ui.controlsStop = () => clearInterval(iv);
      }
    }
    if (s.phase === 'end') kids.push(h('button', { class: 'btn', onclick: () => downloadCsv(s.report, { filename: `tarih-${s.code}` }) }, icon('download'), 'CSV'), h('button', { class: 'btn btn-primary', onclick: exitRoom }, icon('plus'), 'Жаңа ойын'));
    ui.controls.replaceChildren(...kids);
  }
  const start = ui.controls.querySelector('[data-role="start"]');
  if (start) start.disabled = s.playerCount === 0;
}

async function endGame() {
  if (!confirm('Ойынды қазір аяқтайсыз ба? Осы уақытқа дейінгі нәтижелер тарихқа сақталады.')) return;
  await act('end');
}

function renderTabs() {
  const items = [
    ['stage', 'Сахна'],
    ['players', 'Ойыншылар', state.playerCount],
    ['answers', 'Жауаптар'],
    ['rounds', 'Раундтар'],
  ];
  if (ui.tabs.childElementCount !== items.length) {
    ui.tabs.replaceChildren(...items.map(([id, label]) => h('button', { role: 'tab', dataset: { id }, onclick: () => ((tab = id), renderRoom()) }, label, h('span', { class: 'count hidden' }))));
  }
  for (const b of ui.tabs.children) {
    const it = items.find((x) => x[0] === b.dataset.id);
    b.setAttribute('aria-selected', String(b.dataset.id === tab));
    const c = b.querySelector('.count');
    c.classList.toggle('hidden', it[2] == null);
    c.textContent = it[2] ?? '';
  }
}

// ---------- stage ----------
function stageKey(s) {
  const w = s.round?.type === 'scorched' ? `:${s.round.wave}` : '';
  return ['intro', 'play', 'wave_reveal', 'reveal'].includes(s.phase) ? `${s.phase}:${s.rIndex}${w}` : s.phase;
}

function renderStage() {
  const s = state;
  const key = stageKey(s);
  ui.main.classList.toggle('wide', ['lobby', 'end', 'intro', 'countdown'].includes(s.phase));
  if (key === ui.stageKey) return ui.stage$?.update?.(s);
  ui.stage$?.stop?.forEach((f) => f());
  const builders = { lobby: lobbyStage, countdown: countdownStage, intro: introStage, play: playStage, wave_reveal: waveStage, reveal: revealStage, end: endStage };
  ui.stageKey = key;
  ui.stage$ = builders[s.phase]();
  mount(ui.stage, ui.stage$.el);
  ui.stage$.update?.(s);
}

function lobbyStage() {
  const s = state;
  const m = MODES[s.mode];
  const url = joinUrl(s.code);
  const cloud = h('div', { class: 'players-cloud' });
  const count = h('span', { class: 'num' });
  const empty = h('div', { class: 'empty-wait' }, h('div', { class: 'pulse-ring' }, h('span', { html: ICONS.users, style: { width: '34px', height: '34px', color: 'var(--gold)' } })), h('span', { class: 'dots' }, 'Ойыншыларды күтудеміз'));
  const startBtn = h('button', { class: 'btn btn-primary btn-xl', onclick: () => act('start') }, icon('play'), 'Ойынды бастау');
  const el = h(
    'div',
    { class: 'join-grid' },
    h(
      'div',
      { class: 'card join-card' },
      h('div', { class: 'eyebrow' }, 'Телефоннан кіріңіз'),
      h('div', { class: 'url' }, location.host),
      h('div', { class: 'bigcode num' }, fmtCode(s.code)),
      h('div', { class: 'qr' }, h('img', { src: `/api/qr?text=${encodeURIComponent(url)}`, alt: `QR: ${url}` })),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Кодты енгізіп, есіміңізді жазыңыз — тіркелу керек емес')
    ),
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'card lobby-players' }, h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, s.title || 'Ойыншылар'), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, icon('users'), count)), empty, cloud, h('div', { class: 'center' }, startBtn)),
      h('div', { class: 'card tight stack' }, h('div', { class: 'row wrap-row' }, modeChip(s.mode), h('span', { class: 'chip' }, icon('target'), `${s.rCount} раунд`), s.finalCount ? h('span', { class: 'chip gold' }, 'Финал ×2') : null), h('ul', { class: 'rules' }, m.rules.map((r) => h('li', null, r)), s.finalCount ? h('li', null, FINAL_RULE) : null))
    )
  );
  const update = (ns) => {
    count.textContent = `${ns.playerCount} / ${ns.maxPlayers}`;
    startBtn.disabled = ns.playerCount === 0;
    empty.classList.toggle('hidden', ns.playerCount > 0);
    const want = new Map(ns.report.players.map((p) => [p.id, p]));
    for (const c of [...cloud.children]) if (!want.has(c.dataset.id)) c.remove();
    for (const p of want.values()) {
      let c = cloud.querySelector(`[data-id="${p.id}"]`);
      if (!c) {
        c = h('span', { class: 'pchip', dataset: { id: p.id } }, avatar(p.nickname), h('span', { class: 'name' }, p.nickname), h('button', { class: 'kick', title: 'Шығару', 'aria-label': `${p.nickname} — шығару`, html: ICONS.cross, onclick: () => kick(p) }));
        cloud.append(c);
      }
      c.classList.toggle('off', !p.connected);
    }
  };
  return { el, update };
}

async function kick(p) {
  if (!confirm(`«${p.nickname}» ойыншысын бөлмеден шығарасыз ба?`)) return;
  const res = await act('kick', { playerId: p.id });
  if (res.ok) toast(`${p.nickname} шығарылды`);
}

function countdownStage() {
  const holder = h('div');
  const el = h('div', { class: 'card stage-card splash' }, h('div', { class: 'stack', style: { alignItems: 'center' } }, h('div', { class: 'eyebrow' }, 'Дайындалыңыздар!'), holder, modeChip(state.mode)));
  let last = null;
  const iv = setInterval(() => {
    const n = Math.ceil(Math.max(0, (state.phaseEndsAt || 0) - clock.now()) / 1000);
    const label = n > 0 ? String(Math.min(n, 3)) : 'Бастадық!';
    if (label !== last) {
      last = label;
      holder.replaceChildren(h('div', { class: 'count-num', style: n > 0 ? null : { fontSize: 'clamp(48px,8vw,110px)' } }, label));
    }
  }, 100);
  return { el, stop: [() => clearInterval(iv)] };
}

function introStage() {
  const card = introCard(state, { big: true });
  return { el: card.classList.contains('splash') ? h('div', { class: 'card stage-card splash final-splash' }, ...card.childNodes) : h('div', { class: 'stage-intro' }, card) };
}

function ring() {
  const C = 2 * Math.PI * 46;
  const secs = h('span', { class: 'secs num' });
  const el = h('div', { class: 'ring' });
  el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="46"/></svg>`;
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('class', 'fg');
  c.setAttribute('cx', 50);
  c.setAttribute('cy', 50);
  c.setAttribute('r', 46);
  c.style.strokeDasharray = C;
  el.firstChild.append(c);
  el.append(secs);
  el.set = (frac, left, low) => {
    c.style.strokeDashoffset = C * (1 - frac);
    secs.textContent = Math.ceil(left / 1000);
    el.classList.toggle('low', low);
  };
  return el;
}

const stageMeta = (s, extra) => h('div', { class: 'q-meta' }, h('span', { class: 'chip' }, `Раунд ${s.round.n} / ${s.rCount}`), modeChip(s.round.type), s.round.eraName ? h('span', { class: 'chip' }, s.round.eraName) : null, s.round.final ? h('span', { class: 'chip final' }, 'ФИНАЛ ×2') : null, extra);

function meter(label) {
  const fill = h('i', { style: { width: '0%' } });
  const n = h('span', { class: 'n' });
  const el = h('div', { class: 'answered-meter' }, h('span', { class: 'chip' }, icon('users'), label), h('div', { class: 'track' }, fill), n);
  el.set = (done, total) => {
    fill.style.width = `${total ? (done / total) * 100 : 0}%`;
    n.textContent = `${done} / ${total}`;
  };
  return el;
}

function playStage() {
  const s = state;
  const r = s.round;
  const rg = ring();
  const stop = runTimer({ startsAt: s.timing.startsAt, endsAt: s.timing.endsAt, total: s.timing.endsAt - s.timing.startsAt, onTick: rg.set });
  let body;
  let m;
  let update;
  if (r.type === 'zoom') {
    const cnts = r.tiers.map(() => h('span', { class: 'cnt' }, '0 адам'));
    body = [h('div', { class: 'h-q-head' }, h('h1', { class: 'q-text enter' }, r.q), rg), h('div', { class: 'tiers' }, r.tiers.map((t, k) => h('div', { class: 'tier' }, h('span', { class: 'lvl' }, TIER_LEVEL[k]), h('span', { class: 'pts' }, `+${t.points}`), h('span', { class: 'nm' }, t.name), cnts[k]))), h('p', { class: 'muted', style: { margin: 0, textAlign: 'center', fontWeight: 700 } }, 'Ойыншылар дәлдікті таңдап, сол деңгейдің 4 картасының бірін белгілейді')];
    m = meter('Жауап берді');
    update = (ns) => {
      const l = ns.live;
      if (!l) return;
      l.tierCounts.forEach((n, k) => (cnts[k].textContent = `${n} адам`));
      m.set(l.done, l.eligible);
    };
  } else if (r.type === 'spark') {
    const finders = h('div', { class: 'chips' });
    body = [h('div', { class: 'h-q-head' }, h('div', { class: 'eyebrow', style: { flex: 1 } }, 'Үш кілт — бір жауап. Телефондарыңызға жазыңыз!'), rg), h('div', { class: 'clues' }, r.clues.map((c, i) => h('div', { class: 'clue' }, h('span', { class: 'no' }, i + 1), h('span', null, c)))), finders];
    m = meter('Тапқандар');
    update = (ns) => {
      const l = ns.live;
      if (!l) return;
      m.set(l.done, l.eligible);
      if (finders.childElementCount !== l.finders.length) finders.replaceChildren(...l.finders.map((f, i) => h('span', { class: `chip ${i === 0 ? 'gold' : 'found'}` }, i === 0 ? icon('bolt') : null, `${f.nickname} · ${fmtSec(f.timeMs)}`)));
    };
  } else {
    body = [
      h('div', { class: 'h-q-head' }, h('div', { style: { flex: 1 } }, h('h1', { class: 'big-cat q-text enter' }, r.cat), r.hint ? h('p', { class: 'muted', style: { margin: '8px 0 0', fontWeight: 700 } }, r.hint) : null), rg),
      h('div', { class: 'waves' }, r.wavePoints.map((p, k) => h('div', { class: `wave-step ${k === r.wave ? 'on' : k < r.wave ? 'done' : ''}` }, h('b', null, `+${p}`), `${k + 1}-толқын`))),
      r.burned.length ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Күйген жауаптар'), h('div', { class: 'chips' }, r.burned.map((b) => h('span', { class: 'chip burnt' }, b)))) : h('p', { class: 'muted', style: { margin: 0, fontWeight: 700 } }, 'Әр ойыншы бір жауап жазады. Ешкім қайталамаған жауап қана ұпай әкеледі!'),
    ];
    m = meter('Жазғандар');
    update = (ns) => ns.live && m.set(ns.live.done, ns.live.eligible);
  }
  const el = h('div', { class: `card stage-card mode-${r.type}` }, stageMeta(s), ...body, m);
  return { el, update, stop: [stop] };
}

function waveStage() {
  const s = state;
  const r = s.round;
  const res = r.waveResult;
  const el = h(
    'div',
    { class: 'card stage-card' },
    stageMeta(s),
    h('h1', { class: 'big-cat' }, r.cat),
    h('div', { class: 'waves' }, r.wavePoints.map((p, k) => h('div', { class: `wave-step ${k <= r.wave ? 'done' : ''}` }, h('b', null, `+${p}`), `${k + 1}-толқын`))),
    h('div', { class: 'eyebrow' }, `${r.wave + 1}-толқын: бірегей жауаптар (+${res.points})`),
    res.unique.length ? h('div', { class: 'chips' }, res.unique.map((g) => h('span', { class: 'chip found', style: { fontSize: '16px', height: '40px' } }, g.name, h('small', null, `· ${g.nicks.join(', ')}`)))) : h('p', { class: 'muted', style: { margin: 0 } }, 'Бұл толқында бірегей жауап болмады'),
    res.dup.length ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Қайталанып, күйіп кеткендер (0)'), h('div', { class: 'chips' }, res.dup.map((g) => h('span', { class: 'chip burnt' }, g.name, h('small', null, `· ${g.nicks.join(', ')}`))))) : null,
    h('p', { class: 'small muted', style: { margin: 0, fontWeight: 700 } }, `Бұрын айтылған: ${res.burned} · Қабылданбаған: ${res.invalid} · Жауапсыз: ${res.none}`)
  );
  return { el };
}

function revealStage() {
  const s = state;
  const r = s.round;
  const st = r.stats || {};
  const pct = st.eligible ? Math.round((st.scored / st.eligible) * 100) : 0;
  let body = [];
  if (r.type === 'zoom') {
    body = [
      h('h1', { class: 'q-text', style: { fontSize: 'clamp(20px,2.4vw,32px)' } }, r.q),
      h(
        'div',
        { class: 'stack', style: { gap: '10px' } },
        r.tiers.map((t, k) => h('div', { class: 'tier-row' }, h('span', { class: 'nm' }, `+${t.points}`, h('b', null, t.name)), h('span', { class: 'ans', style: { fontSize: '20px' } }, t.options[t.correct]), h('span', { class: 'st' }, st.tiers ? `${st.tiers[k].chose} таңдады · ${st.tiers[k].right} дұрыс` : '')))
      ),
    ];
  } else if (r.type === 'spark') {
    body = [h('div', { class: 'center stack', style: { gap: '6px' } }, h('div', { class: 'eyebrow' }, 'Жауап'), h('div', { class: 'answer-big' }, r.answer)), h('div', { class: 'clues' }, r.clues.map((c, i) => h('div', { class: 'clue', style: { fontSize: '17px', padding: '12px 16px' } }, h('span', { class: 'no' }, i + 1), h('span', null, c)))), st.finders?.length ? h('div', { class: 'chips' }, st.finders.map((f, i) => h('span', { class: `chip ${i === 0 ? 'gold' : 'found'}` }, i === 0 ? icon('bolt') : null, `${f.nickname} · ${fmtSec(f.timeMs)} · +${f.points}`))) : h('p', { class: 'muted', style: { margin: 0 } }, 'Бұл жолы ешкім таппады')];
  } else {
    body = [
      h('h1', { class: 'big-cat' }, r.cat),
      h('div', { class: 'eyebrow' }, `Табылғаны: ${st.foundCount ?? 0} / ${st.total ?? 0}${st.flawless?.length ? ' · Мінсіз: ' + st.flawless.join(', ') : ''}`),
      h('div', { class: 'chips' }, (st.found || []).map((g) => h('span', { class: `chip ${g.nicks.length === 1 ? 'found' : 'burnt'}` }, g.name, h('small', null, `· ${g.nicks.join(', ')}`)))),
      st.left?.length ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'eyebrow' }, 'Ешкім айтпаған жауаптар'), h('div', { class: 'chips' }, st.left.map((n) => h('span', { class: 'chip left' }, n)))) : null,
    ];
  }
  const el = h('div', { class: `card stage-card mode-${r.type}` }, stageMeta(s, h('span', { class: 'chip', style: { color: 'var(--good)' } }, icon('target'), `${pct}% ұпай алды`)), ...body, r.fact ? h('div', { class: 'fact' }, h('b', null, 'Білгенге маржан'), r.fact) : null);
  return { el };
}

function endStage() {
  const s = state;
  const lb = s.leaderboard;
  const el = h(
    'div',
    { class: 'card stage-card' },
    h('div', { class: 'center stack', style: { gap: '6px' } }, h('div', { class: 'eyebrow' }, s.title || 'Ойын аяқталды'), h('h1', { style: { margin: 0 } }, 'Жеңімпаздар'), s.endedEarly ? h('span', { class: 'chip' }, 'Ойын ерте аяқталды') : null),
    podium(lb.slice(0, 3)),
    h(
      'div',
      { class: 'row wrap-row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', onclick: () => ((tab = 'players'), renderRoom()) }, icon('users'), 'Толық есеп'),
      h('button', { class: 'btn', onclick: () => ((tab = 'answers'), renderRoom()) }, icon('target'), 'Барлық жауаптар'),
      h('button', { class: 'btn', onclick: () => downloadCsv(s.report, { filename: `tarih-${s.code}` }) }, icon('download'), 'CSV жүктеу'),
      h('a', { class: 'btn', href: '/history' }, icon('history'), 'Тарихта сақталды ✓')
    ),
    lb.length > 3 ? h('ol', { class: 'lb', style: { maxWidth: '720px', width: '100%', margin: '0 auto' } }, lb.slice(3).map((p) => lbRow(p))) : null
  );
  const t = setTimeout(() => confetti(4000), 1700);
  return { el, stop: [() => clearTimeout(t)] };
}

// ---------- live sidebar ----------
function renderSide() {
  const s = state;
  if (['lobby', 'end', 'intro', 'countdown'].includes(s.phase)) {
    ui.side.replaceChildren();
    ui.sideKey = s.phase;
    return;
  }
  if (s.phase === 'reveal') {
    const key = `r:${s.rIndex}`;
    if (ui.sideKey === key) return;
    ui.sideKey = key;
    ui.side$?.cancel?.();
    const lb = animatedLeaderboard(s.leaderboard, { delay: 1200 });
    ui.side$ = lb;
    ui.side.replaceChildren(h('div', { class: 'card tight stack' }, h('div', { class: 'eyebrow' }, 'Рейтинг'), lb));
    return;
  }
  ui.sideKey = `${s.phase}:${s.rIndex}`;
  const live = s.phase === 'play';
  const rows = s.report.players.slice(0, 12).map((p) => {
    const last = p.cells[p.cells.length - 1];
    const stateIco = !live ? null : last?.s === 'p' ? h('span', { class: 'state-ico ok', title: 'Жауап берді', html: ICONS.check }) : last?.s === 'q' ? h('span', { class: 'state-ico wait', title: 'Ойлануда' }) : h('span', { class: 'state-ico' });
    const row = lbRow(p);
    if (stateIco) row.insertBefore(stateIco, row.lastChild);
    return row;
  });
  const more = s.report.players.length - 12;
  ui.side.replaceChildren(h('div', { class: 'card tight stack' }, h('div', { class: 'row' }, h('div', { class: 'eyebrow' }, live ? 'Тірі рейтинг' : 'Рейтинг'), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, icon('users'), s.playerCount)), h('ol', { class: 'lb' }, rows), more > 0 ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((tab = 'players'), renderRoom()) }, `тағы ${more} ойыншы →`) : null));
}

// ---------- admin panel tabs ----------
function renderPanel() {
  const s = state;
  const titles = { players: 'Ойыншылар', answers: 'Әр ойыншының жауаптары', rounds: 'Раундтар бойынша' };
  const prevScroll = ui.panel.querySelector('.table-wrap')?.scrollLeft || 0;
  const body =
    tab === 'players'
      ? playersTable(s.report, { live: s.phase !== 'end', sortKey: 'live', onOpen: (p) => openPlayer(s.report, p.id), onKick: s.phase !== 'end' ? kick : null })
      : tab === 'answers'
        ? answersMatrix(s.report)
        : roundsList(s.report);
  ui.panel.replaceChildren(
    h(
      'div',
      { class: 'panel-head' },
      h('h2', null, titles[tab]),
      h('span', { class: 'chip' }, `${s.report.rounds.filter((r) => r.revealed).length} / ${s.rCount} раунд`),
      h('span', { class: 'spacer' }),
      tab !== 'rounds' ? h('span', { class: 'small muted' }, tab === 'players' ? 'Жолды басып, ойыншының әр жауабын көріңіз' : 'Ұяшыққа тінтуірді апарсаңыз, толық жауап көрінеді') : null,
      h('button', { class: 'btn btn-sm', onclick: () => downloadCsv(s.report, { filename: `tarih-${s.code}` }) }, icon('download'), 'CSV')
    ),
    body
  );
  const wrap = ui.panel.querySelector('.table-wrap');
  if (wrap) wrap.scrollLeft = prevScroll;
}
