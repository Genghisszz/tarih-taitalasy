import { $, h, icon, ICONS, MODES, modeChip, fmtNum, fmtPct, fmtDate, fmtCode, avatar, toast, store, backdrop, hostKey, copyText, podium } from './common.js';
import { playersTable, answersMatrix, roundsList, openPlayer, downloadCsv } from './report.js';

backdrop();
const root = $('#root');
let KEY = hostKey();
let meta = null;
let tab = 'players';

const STATUS = {
  finished: ['Аяқталды', 'chip', 'var(--good)'],
  in_progress: ['Жүріп жатыр', 'chip', 'var(--sky)'],
  interrupted: ['Үзілді', 'chip', 'var(--bad)'],
};

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'x-host-key': KEY, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Ойын табылмады' : 'Сервер қатесі');
  return res.json();
}

function eraSummary(ids) {
  if (!meta) return '';
  if (ids.length === meta.eras.length) return 'Барлық тарих (12 кезең)';
  const names = ids.map((id) => meta.eras.find((e) => e.id === id)?.name).filter(Boolean);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

function statusChip(st) {
  const [label, cls, color] = STATUS[st] || STATUS.finished;
  return h('span', { class: cls, style: { color } }, label);
}

function shell(...kids) {
  root.replaceChildren(
    h(
      'div',
      { class: 'wrap h-create' },
      h('div', { class: 'topline' }, h('a', { class: 'brand', href: '/' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', { class: 'word' }, 'Тарих', h('b', null, 'Тайталасы'))), h('span', { class: 'spacer' }), h('a', { class: 'btn btn-primary btn-sm', href: '/host' }, icon('plus'), 'Жаңа ойын')),
      ...kids
    )
  );
}

// ---------- list ----------
async function showList() {
  shell(h('h1', null, 'Ойындар тарихы'), h('p', { class: 'lead' }, h('span', { class: 'dots' }, 'Жүктелуде')));
  let games;
  try {
    games = (await api('/api/history')).games;
  } catch (e) {
    return shell(h('h1', null, 'Ойындар тарихы'), h('p', { class: 'form-error' }, e.message));
  }

  const keyIn = h('input', { class: 'input', placeholder: 'Басқа құрылғыдағы кілтті қойыңыз', autocomplete: 'off', style: { fontSize: '15px', minHeight: '46px' } });
  const keyCard = h(
    'details',
    { class: 'card tight', style: { marginBottom: '20px' } },
    h('summary', { style: { cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { html: ICONS.key, style: { width: '20px', height: '20px', color: 'var(--gold)' } }), 'Жүргізуші кілті — тарихты басқа құрылғыда ашу'),
    h(
      'div',
      { class: 'stack', style: { marginTop: '14px' } },
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Тіркелу жоқ: ойындарыңыз осы браузерде сақталған құпия кілтке байланған. Басқа компьютерден көру үшін кілтті көшіріп, сол жерде енгізіңіз. Кілтті ешкімге бермеңіз.'),
      h('div', { class: 'row wrap-row' }, h('code', { class: 'chip', style: { fontFamily: 'monospace' } }, `${KEY.slice(0, 6)}••••••${KEY.slice(-4)}`), h('button', { class: 'btn btn-sm', onclick: () => copyText(KEY).then((ok) => toast(ok ? 'Кілт көшірілді' : 'Көшіру мүмкін болмады', ok ? 'good' : 'bad')) }, icon('copy'), 'Кілтті көшіру')),
      h(
        'div',
        { class: 'row' },
        keyIn,
        h(
          'button',
          {
            class: 'btn btn-sm',
            onclick: () => {
              const k = keyIn.value.trim();
              if (!/^[A-Za-z0-9_-]{24,128}$/.test(k)) return toast('Кілт жарамсыз', 'bad');
              if (!confirm('Осы кілтке ауысасыз ба? Бұл браузер енді сол кілттің ойындарын көрсетеді.')) return;
              store.set('tt.hostKey', k);
              KEY = k;
              showList();
            },
          },
          'Енгізу'
        )
      )
    )
  );

  const list = games.length
    ? h(
        'div',
        { class: 'stack' },
        games.map((g, i) =>
          h(
            'a',
            { class: 'card tight game-row', href: `#/game/${g.id}`, style: { animationDelay: `${Math.min(i, 10) * 0.04}s` } },
            h('div', { class: 'gr-main' }, h('div', { class: 'gr-title' }, g.title || 'Атаусыз ойын'), h('div', { class: 'small muted' }, `${fmtDate(g.startedAt || g.createdAt)} · код ${fmtCode(g.code)} · ${eraSummary(g.eras)}`)),
            h(
              'div',
              { class: 'row wrap-row gr-meta' },
              modeChip(g.mode),
              h('span', { class: 'chip' }, icon('users'), g.playerCount),
              h('span', { class: 'chip' }, icon('target'), `${g.questionsPlayed}/${g.questionCount}`),
              g.avgAccuracy != null ? h('span', { class: 'chip' }, `${fmtPct(g.avgAccuracy)} дәлдік`) : null,
              g.winner ? h('span', { class: 'chip gold' }, icon('crown'), g.winner.nickname) : null,
              statusChip(g.status)
            )
          )
        )
      )
    : h('div', { class: 'card center stack', style: { padding: '48px 20px' } }, h('div', { class: 'pulse-ring' }, h('span', { html: ICONS.history, style: { width: '34px', height: '34px', color: 'var(--gold)' } })), h('h2', { style: { margin: 0 } }, 'Әзірге сақталған ойын жоқ'), h('p', { class: 'muted', style: { margin: 0 } }, 'Ойын басталған сәттен бастап нәтижелер осында автоматты түрде сақталады.'), h('a', { class: 'btn btn-primary', href: '/host' }, icon('plus'), 'Алғашқы ойынды құру'));

  shell(h('h1', null, 'Ойындар тарихы'), h('p', { class: 'lead' }, `Барлығы ${games.length} ойын. Әр ойынның толық есебі: әр ойыншының жауаптары, дәлдігі және уақыты.`), keyCard, list);
}

// ---------- detail ----------
async function showGame(id) {
  shell(h('p', { class: 'lead dots' }, 'Жүктелуде'));
  let g;
  try {
    g = await api(`/api/history/${encodeURIComponent(id)}`);
  } catch (e) {
    return shell(h('a', { class: 'btn btn-sm', href: '#/' }, icon('back'), 'Тізімге'), h('p', { class: 'form-error' }, e.message));
  }
  const rep = g.report;
  const top = rep.players.slice(0, 3);
  const played = rep.rounds.filter((q) => q.revealed).length;
  const avgAcc = rep.players.length ? rep.players.reduce((s, p) => s + (p.stats.accuracy || 0), 0) / rep.players.length : null;
  const avgTime = (() => {
    const xs = rep.players.map((p) => p.stats.avgTimeMs).filter((x) => x != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  })();
  const filename = `tarih-${(g.startedAt ? new Date(g.startedAt) : new Date()).toISOString().slice(0, 10)}-${g.code}`;

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  const drawTab = () => {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.id === tab));
    body.replaceChildren(
      tab === 'players'
        ? playersTable(rep, { sortKey: 'history', onOpen: (p) => openPlayer(rep, p.id) })
        : tab === 'answers'
          ? answersMatrix(rep)
          : roundsList(rep)
    );
  };
  tabs.append(
    ...[
      ['players', 'Ойыншылар'],
      ['answers', 'Жауаптар'],
      ['rounds', 'Раундтар'],
    ].map(([id, label]) => h('button', { role: 'tab', dataset: { id }, onclick: () => ((tab = id), drawTab()) }, label))
  );

  const del = async () => {
    if (!confirm('Бұл ойынның есебін біржола жоясыз ба?')) return;
    try {
      await api(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Ойын жойылды', 'good');
      location.hash = '#/';
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  shell(
    h('div', { class: 'row wrap-row', style: { marginBottom: '14px' } }, h('a', { class: 'btn btn-sm', href: '#/' }, icon('back'), 'Тізімге'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm', onclick: () => downloadCsv(rep, { filename }) }, icon('download'), 'CSV жүктеу'), h('button', { class: 'btn btn-sm btn-danger', onclick: del }, icon('trash'), 'Жою')),
    h('h1', { style: { margin: '0 0 8px' } }, g.title || 'Атаусыз ойын'),
    h('div', { class: 'row wrap-row', style: { marginBottom: '22px' } }, modeChip(g.mode), statusChip(g.status), h('span', { class: 'chip' }, fmtDate(g.startedAt || g.createdAt)), h('span', { class: 'chip' }, `Код ${fmtCode(g.code)}`), h('span', { class: 'chip' }, eraSummary(g.eras)), g.settings?.finalEnabled ? h('span', { class: 'chip gold' }, 'Финал ×2') : null),
    h(
      'div',
      { class: 'stats', style: { marginBottom: '22px' } },
      [
        ['Ойыншы', rep.players.length],
        ['Раунд', `${played} / ${g.questionCount}`],
        ['Орташа дәлдік', fmtPct(avgAcc)],
        ['Орташа жауап уақыты', avgTime == null ? '—' : `${(avgTime / 1000).toFixed(1).replace('.', ',')} с`],
        ['Жеңімпаз', top[0] ? `${top[0].nickname}` : '—'],
        ['Жоғары ұпай', top[0] ? fmtNum(top[0].score) : '—'],
      ].map(([k, v], i) => h('div', { class: 'stat', style: { animationDelay: `${i * 0.05}s` } }, h('div', { class: 'v', style: { overflowWrap: 'anywhere' } }, v), h('div', { class: 'k' }, k)))
    ),
    top.length ? h('div', { class: 'card', style: { marginBottom: '22px' } }, podium(top)) : null,
    h('div', { class: 'row wrap-row', style: { marginBottom: '14px' } }, tabs, h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'Ойыншы жолын басып, оның әр жауабын көріңіз')),
    body
  );
  drawTab();
}

function route() {
  const m = location.hash.match(/^#\/game\/([a-f0-9-]{36})$/);
  if (m) showGame(m[1]);
  else showList();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', route);
(async () => {
  try {
    meta = await (await fetch('/api/meta')).json();
  } catch {
    /* era names fall back to ids */
  }
  route();
})();
