// Admin report views shared by the live host panel and the saved-history page.
// Player-typed text (Spark guesses, Scorched answers) is untrusted: it is only ever set via textContent.
import { h, icon, avatar, fmtNum, fmtSec, fmtPct, fmtDate, MODES, SCORCH_STATUS } from './common.js';

const sortState = new Map();
const TIER_LEVEL = ['Кең', 'Орташа', 'Нақты'];
const TYPE_SHORT = { zoom: 'Зум', spark: 'Ұшқын', scorched: 'Күйген жер' };

const COLS = [
  { id: 'rank', label: 'Орын', get: (p) => p.rank, num: true },
  { id: 'nick', label: 'Ойыншы', get: (p) => p.nickname.toLocaleLowerCase('kk-KZ') },
  { id: 'score', label: 'Ұпай', get: (p) => p.score, num: true, desc: true },
  { id: 'correct', label: 'Ұпайлы раунд', get: (p) => p.stats.correct, num: true, desc: true },
  { id: 'acc', label: 'Дәлдік', get: (p) => p.stats.accuracy ?? -1, num: true, desc: true },
  { id: 'avg', label: 'Орт. уақыт', get: (p) => p.stats.avgTimeMs ?? Infinity, num: true },
  { id: 'total', label: 'Жалпы уақыт', get: (p) => p.stats.totalTimeMs, num: true },
];

function accCell(acc) {
  if (acc == null) return h('span', { class: 'dim' }, '—');
  const pct = Math.round(acc * 100);
  return h('span', { class: 'acc' }, h('span', { class: 'bar' }, h('i', { style: { width: `${pct}%`, background: `hsl(${Math.round(pct * 1.4)} 75% 55%)` } })), `${pct}%`);
}

function liveStatus(p, report) {
  const last = p.cells[p.cells.length - 1];
  const r = report.rounds[report.rounds.length - 1];
  if (r && !r.revealed) {
    if (last?.s === 'p') return h('span', { class: 'chip', style: { color: '#9BE6FA' } }, icon('check'), 'Жауап берді');
    if (last?.s === 'q') return h('span', { class: 'chip dim' }, h('span', { class: 'dots' }, 'Ойлануда'));
  }
  return p.connected === false ? h('span', { class: 'chip dim' }, 'Желіде жоқ') : h('span', { class: 'chip' }, h('span', { class: 'dot' }), 'Онлайн');
}

/** opts: { live, onKick(player), onOpen(player), sortKey } */
export function playersTable(report, opts = {}) {
  const wrap = h('div', { class: 'table-wrap' });
  const key = opts.sortKey || 'default';
  const st = sortState.get(key) || { col: 'rank', dir: 1 };
  const draw = () => {
    const col = COLS.find((c) => c.id === st.col) || COLS[0];
    const rows = [...report.players].sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * st.dir;
    });
    const head = h(
      'tr',
      null,
      COLS.map((c) =>
        h(
          'th',
          {
            class: `sortable ${c.num && c.id !== 'rank' ? 'r' : ''}`,
            scope: 'col',
            'aria-sort': st.col === c.id ? (st.dir > 0 ? 'ascending' : 'descending') : null,
            onclick: () => {
              if (st.col === c.id) st.dir *= -1;
              else Object.assign(st, { col: c.id, dir: c.desc ? -1 : 1 });
              sortState.set(key, st);
              draw();
            },
          },
          c.label,
          st.col === c.id ? h('span', { class: 'arrow' }, st.dir > 0 ? ' ↑' : ' ↓') : null
        )
      ),
      opts.live ? h('th', null, 'Күйі') : null,
      opts.onKick ? h('th', null, h('span', { class: 'sr-only' }, 'Әрекет')) : null
    );
    const body = rows.map((p) =>
      h(
        'tr',
        { class: opts.onOpen ? 'clickable' : '', onclick: opts.onOpen ? () => opts.onOpen(p) : null, title: opts.onOpen ? 'Толық жауаптарын көру' : null },
        h('td', { class: 'num' }, p.rank === 1 ? h('span', { style: { color: 'var(--gold)', fontWeight: 800 } }, '1') : p.rank),
        h('td', null, h('div', { class: 'nick-cell' }, opts.live ? h('span', { class: `dot ${p.connected ? '' : 'off'}` }) : null, avatar(p.nickname), h('span', null, p.nickname))),
        h('td', { class: 'r', style: { fontWeight: 800 } }, fmtNum(p.score)),
        h('td', { class: 'r' }, `${p.stats.correct} / ${p.stats.eligible}`),
        h('td', { class: 'r' }, accCell(p.stats.accuracy)),
        h('td', { class: 'r' }, fmtSec(p.stats.avgTimeMs)),
        h('td', { class: 'r' }, fmtSec(p.stats.totalTimeMs)),
        opts.live ? h('td', null, liveStatus(p, report)) : null,
        opts.onKick
          ? h(
              'td',
              null,
              h(
                'button',
                {
                  class: 'btn btn-danger btn-sm',
                  onclick: (e) => {
                    e.stopPropagation();
                    opts.onKick(p);
                  },
                },
                'Шығару'
              )
            )
          : null
      )
    );
    wrap.replaceChildren(report.players.length ? h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, body)) : h('p', { class: 'muted', style: { padding: '24px', margin: 0, textAlign: 'center' } }, 'Әзірге ойыншы жоқ'));
  };
  draw();
  return wrap;
}

/** Short label + tooltip for one player's round. */
function cellSummary(c, r) {
  const pts = c.pts > 0 ? `+${c.pts}` : '0';
  if (r.type === 'zoom') {
    const d = c.d || {};
    if (d.tier == null) return { main: '—', sub: '', tip: 'Жауап бермеді' };
    const t = r.tiers[d.tier];
    const chosen = d.choice != null && t.options ? t.options[d.choice] : '—';
    return { main: pts, sub: TIER_LEVEL[d.tier], tip: `${t.name} (+${t.points}): ${chosen}${c.t != null ? ' · ' + fmtSec(c.t) : ''}` };
  }
  if (r.type === 'spark') {
    const tries = c.d?.attempts || [];
    if (!tries.length) return { main: '—', sub: '', tip: 'Жауап бермеді' };
    return { main: c.s === 'c' ? pts : '✗', sub: c.s === 'c' ? fmtSec(c.t) : `${tries.length} әрекет`, tip: tries.map((a) => `${a.ok ? '✓' : '✗'} ${a.text}`).join('\n') };
  }
  const waves = c.d?.waves || [];
  const uniq = waves.filter((w) => w?.status === 'unique').length;
  if (!waves.some((w) => w?.text)) return { main: '—', sub: '', tip: 'Жауап бермеді' };
  return { main: pts, sub: `${uniq}/3`, tip: waves.map((w, k) => `${k + 1}: ${w?.text || '—'} → ${SCORCH_STATUS[w?.status] || SCORCH_STATUS.none}`).join('\n') };
}

function cellBox(c, r) {
  if (c.s === 'x') return h('span', { class: 'cellbox x', title: 'Қатыспады' }, '·');
  if (c.s === 'p') return h('span', { class: 'cellbox p', title: 'Жауап берді (әлі көрсетілмеді)' }, '✓');
  if (c.s === 'q') return h('span', { class: 'cellbox q', title: 'Ойлануда' });
  const m = cellSummary(c, r);
  return h('span', { class: `cellbox ${c.s}`, title: m.tip }, h('span', null, m.main, m.sub ? h('small', null, m.sub) : null));
}

/** Every player × every round. */
export function answersMatrix(report) {
  const rs = report.rounds;
  if (!rs.length) return h('p', { class: 'muted', style: { textAlign: 'center', padding: '24px' } }, 'Ойын басталғанда жауаптар осында пайда болады');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data matrix' },
      h('thead', null, h('tr', null, h('th', null, 'Ойыншы'), h('th', { class: 'r' }, 'Ұпай'), rs.map((r) => h('th', { class: `q ${r.final ? 'final' : ''}`, title: `${TYPE_SHORT[r.type]}: ${r.title}` }, `Р${r.n}`, h('small', { style: { display: 'block', fontWeight: 600, opacity: 0.8 } }, TYPE_SHORT[r.type] + (r.final ? ' ×2' : '')))))),
      h(
        'tbody',
        null,
        report.players.map((p) =>
          h(
            'tr',
            null,
            h('td', null, h('div', { class: 'nick-cell' }, h('span', { class: 'dim num', style: { width: '20px' } }, p.rank), avatar(p.nickname), h('span', null, p.nickname))),
            h('td', { class: 'r', style: { fontWeight: 800 } }, fmtNum(p.score)),
            p.cells.map((c, i) => h('td', { class: 'cell' }, cellBox(c, rs[i])))
          )
        )
      ),
      h('tfoot', null, h('tr', null, h('td', null, 'Ұпай алғандар'), h('td'), rs.map((r) => h('td', null, r.stats && r.stats.eligible ? `${Math.round((r.stats.scored / r.stats.eligible) * 100)}%` : '…'))))
    )
  );
}

/** Per-round breakdown. */
export function roundsList(report) {
  if (!report.rounds.length) return h('p', { class: 'muted', style: { textAlign: 'center', padding: '24px' } }, 'Әзірге раунд өткен жоқ');
  return h(
    'div',
    { class: 'stack' },
    report.rounds.map((r) => {
      const st = r.stats;
      const head = h(
        'div',
        { class: 'q-meta' },
        h('span', { class: 'chip' }, `Р${r.n}`),
        h('span', { class: `chip mode-${r.type}` }, TYPE_SHORT[r.type]),
        r.eraName ? h('span', { class: 'chip' }, r.eraName) : null,
        r.final ? h('span', { class: 'chip gold' }, 'Финал ×2') : null,
        st ? h('span', { class: 'chip' }, icon('target'), `${st.scored}/${st.eligible} ұпай алды`) : h('span', { class: 'chip dim' }, 'Жүріп жатыр')
      );
      let body = [];
      if (r.type === 'zoom') {
        body = [
          h('h4', null, r.title),
          h(
            'div',
            { class: 'qbars' },
            r.tiers.map((t, k) => {
              const ts = st?.tiers?.[k];
              return h('div', { class: 'qbar ok' }, h('i', { style: { transform: `scaleX(${ts && st.eligible ? ts.chose / st.eligible : 0})` } }), h('span', { class: 'l' }, `+${t.points}`), h('span', { class: 't' }, `${t.name}: `, h('b', null, r.revealed ? t.options[t.correct] : '…')), h('span', { class: 'n num' }, ts ? `${ts.right}/${ts.chose}` : ''));
            })
          ),
        ];
      } else if (r.type === 'spark') {
        body = [h('h4', null, r.clues.join(' · ')), r.revealed ? h('p', { style: { margin: '0 0 8px', fontWeight: 800, color: '#8BF5BF' } }, `Жауап: ${r.answer}`) : null, st?.finders?.length ? h('div', { class: 'chips' }, st.finders.map((f) => h('span', { class: 'chip' }, `${f.nickname} · ${fmtSec(f.timeMs)} · +${f.points}`))) : null];
      } else {
        body = [
          h('h4', null, r.cat),
          st ? h('p', { class: 'small muted', style: { margin: '0 0 8px' } }, `Табылғаны: ${st.foundCount} / ${st.total}${st.flawless.length ? ' · Мінсіз: ' + st.flawless.join(', ') : ''}`) : null,
          st ? h('div', { class: 'chips' }, st.found.map((g) => h('span', { class: `chip ${g.nicks.length === 1 ? 'found' : 'burnt'}` }, g.name, h('small', null, ` · ${g.nicks.join(', ')}`)))) : null,
        ];
      }
      return h('article', { class: 'qcard' }, head, ...body, st && r.type !== 'scorched' && st.avgTimeMs != null ? h('p', { class: 'small muted', style: { margin: '10px 0 0' } }, `Орташа уақыт: ${fmtSec(st.avgTimeMs)}`) : null);
    })
  );
}

function detailLines(c, r) {
  const meta = [];
  const d = c.d || {};
  if (r.type === 'zoom') {
    if (d.tier == null) meta.push(h('span', null, h('b', null, 'Жауап бермеді')));
    else {
      const t = r.tiers[d.tier];
      meta.push(h('span', null, 'Деңгей: ', h('b', null, `${t.name} (+${t.points})`)));
      if (d.choice != null && t.options) meta.push(h('span', null, 'Таңдауы: ', h('b', null, t.options[d.choice])));
      if (r.revealed && t.options && d.choice !== t.correct) meta.push(h('span', null, 'Дұрысы: ', h('b', null, t.options[t.correct])));
    }
  } else if (r.type === 'spark') {
    const tries = d.attempts || [];
    if (!tries.length) meta.push(h('span', null, h('b', null, 'Жауап бермеді')));
    tries.forEach((a) => meta.push(h('span', null, a.ok ? '✓ ' : '✗ ', h('b', { style: { color: a.ok ? 'var(--good)' : '#FFB0BC' } }, a.text), ` · ${fmtSec(a.t)}`)));
    if (r.revealed && c.s !== 'c') meta.push(h('span', null, 'Жауап: ', h('b', null, r.answer)));
  } else {
    (d.waves || []).forEach((w, k) => meta.push(h('span', null, `${k + 1}-толқын: `, h('b', null, w?.text || '—'), w?.name && w.name !== w.text ? ` (${w.name})` : '', ` · ${SCORCH_STATUS[w?.status] || SCORCH_STATUS.none}`)));
    if (d.flawless) meta.push(h('span', { style: { color: 'var(--gold)' } }, 'Мінсіз +3'));
  }
  if (c.t != null && r.type !== 'spark') meta.push(h('span', null, 'Уақыт: ', h('b', null, fmtSec(c.t))));
  if (c.pts != null) meta.push(h('span', null, 'Ұпай: ', h('b', null, `${c.pts > 0 ? '+' : ''}${fmtNum(c.pts)}`)));
  return meta;
}

/** Slide-over with one player's every round. */
export function openPlayer(report, playerId) {
  const p = report.players.find((x) => x.id === playerId);
  if (!p) return;
  const close = () => {
    back.remove();
    drawer.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  const back = h('div', { class: 'drawer-backdrop', onclick: close });
  const items = report.rounds.map((r, i) => {
    const c = p.cells[i] || { s: 'x' };
    const status = { c: 'Ұпай алды', w: 'Ұпайсыз', n: 'Жауап бермеді', x: 'Қатыспады', p: 'Жауап берді', q: 'Ойлануда' }[c.s];
    return h(
      'div',
      { class: 'answer-item' },
      h('span', { class: `n ${c.s}` }, i + 1),
      h(
        'div',
        null,
        h('div', { class: 'qt' }, `${TYPE_SHORT[r.type]}${r.final ? ' ×2' : ''} · `, r.title),
        h('div', { class: 'meta', style: { flexDirection: r.type === 'zoom' ? 'row' : 'column' } }, h('span', null, 'Күйі: ', h('b', { style: { color: c.s === 'c' ? 'var(--good)' : c.s === 'w' ? 'var(--bad)' : null } }, status)), ...(['x', 'p', 'q'].includes(c.s) ? [] : detailLines(c, r)))
      )
    );
  });
  const drawer = h(
    'aside',
    { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': p.nickname },
    h('header', null, avatar(p.nickname, 'lg'), h('div', { style: { minWidth: 0, flex: 1 } }, h('h2', { style: { margin: 0, overflowWrap: 'anywhere' } }, p.nickname), h('div', { class: 'muted small' }, `${p.rank}-орын · ${fmtNum(p.score)} ұпай`)), h('button', { class: 'btn btn-icon', 'aria-label': 'Жабу', onclick: close, html: icon('cross').innerHTML })),
    h(
      'div',
      { class: 'body' },
      h(
        'div',
        { class: 'stats', style: { marginBottom: '8px' } },
        [
          ['Ұпайлы раунд', `${p.stats.correct} / ${p.stats.eligible}`],
          ['Дәлдік', fmtPct(p.stats.accuracy)],
          ['Орт. уақыт', fmtSec(p.stats.avgTimeMs)],
          ['Жалпы уақыт', fmtSec(p.stats.totalTimeMs)],
        ].map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k)))
      ),
      items.length ? items : h('p', { class: 'muted' }, 'Әзірге жауап жоқ')
    )
  );
  document.body.append(back, drawer);
  drawer.querySelector('button').focus();
}

/** CSV (semicolon-separated, UTF-8 BOM — opens cleanly in Excel with Cyrillic). */
export function downloadCsv(report, meta = {}) {
  const esc = (v) => {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[=+@-]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // spreadsheet formula guard
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const sec = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1).replace('.', ','));
  const head = ['Орын', 'Ойыншы', 'Ұпай', 'Ұпайлы раунд', 'Қатысқан раунд', 'Дәлдік %', 'Орт. уақыт (с)', 'Жалпы уақыт (с)'];
  report.rounds.forEach((r) => head.push(`Р${r.n} ${TYPE_SHORT[r.type]}${r.final ? ' ×2' : ''}`, `Р${r.n} ұпай`));
  const lines = [head];
  for (const p of report.players) {
    const row = [p.rank, p.nickname, p.score, p.stats.correct, p.stats.eligible, p.stats.accuracy == null ? '' : Math.round(p.stats.accuracy * 100), sec(p.stats.avgTimeMs), sec(p.stats.totalTimeMs)];
    p.cells.forEach((c, i) => {
      const r = report.rounds[i];
      row.push(['x', 'p', 'q'].includes(c.s) ? '' : cellSummary(c, r).tip.replace(/\n/g, ' | '), c.pts ?? '');
    });
    lines.push(row);
  }
  lines.push([]);
  lines.push(['№', 'Режим', 'Кезең', 'Сұрақ / санат', 'Жауап', 'Ұпай алғандар']);
  for (const r of report.rounds) {
    const answer = r.type === 'zoom' && r.revealed ? r.tiers.map((t) => `${t.name}: ${t.options[t.correct]}`).join(' | ') : r.type === 'spark' ? r.answer || '' : r.stats ? `${r.stats.foundCount}/${r.stats.total} табылды` : '';
    lines.push([r.n, TYPE_SHORT[r.type] + (r.final ? ' ×2' : ''), r.eraName, r.title, answer, r.stats ? `${r.stats.scored}/${r.stats.eligible}` : '']);
  }
  const csv = String.fromCharCode(0xfeff) + lines.map((row) => row.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${meta.filename || 'tarih-taitalasy'}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function summaryLine(meta) {
  const m = MODES[meta.mode] || MODES.mix;
  return `${m.name} · ${fmtDate(meta.startedAt || meta.createdAt)}`;
}
