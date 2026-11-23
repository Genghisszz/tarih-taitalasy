// Shared client helpers. All user-provided text goes through textContent (never innerHTML).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny element builder. `html` is reserved for trusted static markup (icons). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const svg = (body, vb = '0 0 24 24', extra = '') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  bolt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.6L13.5 2Z"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FF5C74"/><stop offset=".55" stop-color="#FF8A3D"/><stop offset="1" stop-color="#FFD866"/></linearGradient></defs><path fill="url(#fl)" d="M12 2c1 3.5 5 5.8 5 11a5 5 0 0 1-10 0c0-2.2 1-3.8 2.2-5 .2 1.8 1.1 2.9 2.3 3.3C11 8.6 11.3 5 12 2Z"/><path fill="#FFF3C9" opacity=".85" d="M12 13.2c.5 1.4 2 2.2 2 4a2 2 0 0 1-4 0c0-1.1.6-2 2-4Z"/></svg>`,
  land: svg('<path d="M3 19 9 9l4 6 3-4 5 8H3Z"/><path d="M14 5.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0"/>'),
  crown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7.5 7.5 11 12 4l4.5 7L21 7.5 19 18H5L3 7.5Z"/><rect x="5" y="19.2" width="14" height="2" rx="1" fill="currentColor"/></svg>`,
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', '0 0 24 24', 'stroke-width="3"'),
  cross: svg('<path d="M6 6l12 12M18 6 6 18"/>', '0 0 24 24', 'stroke-width="3"'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.4-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8Z"/></svg>`,
  next: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/>'),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 18v3"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  zoom: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>'),
  fire: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c1 3.5 5 5.8 5 11a5 5 0 0 1-10 0c0-2.2 1-3.8 2.2-5 .2 1.8 1.1 2.9 2.3 3.3C11 8.6 11.3 5 12 2Z"/></svg>`,
  mix: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  send: svg('<path d="M4 12 20 4l-6 16-3-7-7-1Z"/>'),
};
export const icon = (name, cls) => h('span', { class: `ico ${cls || ''}`.trim(), html: ICONS[name] || '' });

export const LETTERS = ['A', 'B', 'C', 'D'];

export const MODES = {
  zoom: {
    name: 'Зум',
    tagline: 'Дәлдік режимі',
    icon: 'zoom',
    rules: ['Алдымен дәлдікті таңда: кең (+3), орташа (+6) не нақты (+10)', 'Сосын тек сол деңгейдің 4 картасының бірін таңдайсың', 'Таңдаған деңгейде қателессең — 0 ұпай'],
  },
  spark: {
    name: 'Ұшқын',
    tagline: 'Байланыс режимі',
    icon: 'flame',
    rules: ['Әр қырынан 3 кілт — бір ғана жауап', 'Жауапты жаз: бірден тапсаң 10 ұпай, соңғы сәтте 2', 'Қате жазсаң — 4 секунд күтесің'],
  },
  scorched: {
    name: 'Күйген жер',
    tagline: 'Тереңдік режимі',
    icon: 'fire',
    rules: ['Бір санат, үш толқын — әр толқында бір жауап жаз', 'Ешкім қайталамаған дұрыс жауап: +3, +4, +5', 'Екі адам бірдей жазса — 0. Айтылған жауап күйіп кетеді', 'Үш толқында да бірегей жауап — +3 бонус'],
  },
  mix: {
    name: 'Аралас',
    tagline: 'Үш режим қатар',
    icon: 'mix',
    rules: ['1-акт: Зум → 2-акт: Ұшқын → 3-акт: Күйген жер', 'Соңында финал: әр режимнен бір раунд, ұпай ×2'],
  },
};
export const FINAL_RULE = 'Финал: соңғы раундтарда ұпай екі есе (×2)';
export const LENGTHS = { short: 'Қысқа', normal: 'Қалыпты', long: 'Ұзақ' };
export const SCORCH_STATUS = {
  unique: 'Бірегей жауап!',
  dup: 'Біреу дәл осыны жазды — күйді',
  burned: 'Бұл жауап бұрын айтылған',
  invalid: 'Бұл жауап қабылданбады',
  none: 'Жауап жоқ',
};

export function modeChip(mode) {
  const m = MODES[mode] || MODES.zoom;
  return h('span', { class: `chip mode-${mode}` }, icon(m.icon), m.name);
}

// ---------- formatting ----------
const nf = new Intl.NumberFormat('ru-RU'); // space-separated thousands, as used in Kazakh
export const fmtNum = (n) => nf.format(Math.round(n || 0));
export function fmtSec(ms, digits = 1) {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(digits).replace('.', ',')} с`;
}
export function fmtPct(x) {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const months = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtCode(code) {
  return String(code || '').replace(/^(\d{3})(\d{3})$/, '$1 $2');
}
export function hueOf(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.codePointAt(0)) % 360;
  return x;
}
export function avatar(nick, cls = '') {
  const first = [...String(nick || '?').trim()][0] || '?';
  return h('span', { class: `avatar ${cls}`, style: { '--hue': hueOf(nick) }, 'aria-hidden': 'true' }, first.toLocaleUpperCase('kk-KZ'));
}

// ---------- server clock ----------
export const clock = {
  offset: 0,
  sync(serverNow) {
    if (typeof serverNow === 'number') this.offset = serverNow - Date.now();
  },
  now() {
    return Date.now() + this.offset;
  },
};

// ---------- sockets ----------
export function connect() {
  // global `io` comes from /socket.io/socket.io.js
  return window.io({ reconnectionDelay: 600, reconnectionDelayMax: 4000 });
}
export function emitAck(socket, event, payload, timeout = 8000) {
  return new Promise((resolve) => {
    socket.timeout(timeout).emit(event, payload, (err, res) => {
      resolve(err ? { ok: false, error: 'Сервер жауап бермеді. Қайталап көріңіз' } : res);
    });
  });
}

/** Shows a "reconnecting…" pill while the socket is down. */
export function connectionBanner(socket) {
  let el = null;
  let timer = null;
  const show = () => {
    if (el) return;
    el = h('div', { class: 'conn', role: 'status' }, h('span', { class: 'spinner' }), 'Байланыс үзілді. Қайта қосылуда…');
    document.body.append(el);
  };
  socket.on('disconnect', () => {
    clearTimeout(timer);
    timer = setTimeout(show, 700);
  });
  socket.on('connect', () => {
    clearTimeout(timer);
    el?.remove();
    el = null;
  });
}

// ---------- screens ----------
/** Cross-fades to a new screen inside a `.stage-root`. */
export function mount(root, el) {
  for (const old of root.querySelectorAll(':scope > .screen:not(.leaving)')) {
    old.classList.add('leaving');
    old.setAttribute('aria-hidden', 'true');
    setTimeout(() => old.remove(), 340);
  }
  el.classList.add('screen');
  root.append(el);
  return el;
}

// ---------- animation helpers ----------
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function countUp(el, from, to, dur = 900) {
  if (reduceMotion() || from === to) {
    el.textContent = fmtNum(to);
    return;
  }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtNum(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** FLIP: re-render `list` and animate items (matched by data-key) from old to new positions. */
export function flip(list, render) {
  const before = new Map([...list.children].map((c) => [c.dataset.key, c.getBoundingClientRect().top]));
  render();
  if (reduceMotion()) return;
  for (const c of list.children) {
    const top = before.get(c.dataset.key);
    if (top == null) {
      c.animate([{ opacity: 0, transform: 'translateY(14px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
        duration: 450,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
      continue;
    }
    const dy = top - c.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) {
      c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: 750,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  }
}

export function confetti(duration = 3200) {
  if (reduceMotion()) return;
  const c = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(c);
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (c.width = innerWidth * dpr);
  const H = (c.height = innerHeight * dpr);
  const colors = ['#FFC83D', '#FFE08A', '#3CC8F0', '#E8456E', '#2FD681', '#FFFFFF', '#B79CFF'];
  const parts = Array.from({ length: 170 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35 + (Math.random() - 0.5) * H * 0.1,
    vx: (Math.random() - 0.5) * 22 * dpr,
    vy: (-Math.random() * 20 - 8) * dpr,
    s: (5 + Math.random() * 7) * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    const k = (t - t0) / duration;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.55 * dpr;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- toast ----------
let toastBox = null;
export function toast(msg, kind = '') {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ---------- storage (wrapped: private mode can throw) ----------
export const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

/** The creator's secret key: identifies "my games" without any registration. */
export function hostKey() {
  let k = store.get('tt.hostKey');
  if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(k)) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    k = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('tt.hostKey', k);
  }
  return k;
}

/** Shared page backdrop (orbs + ornament). */
export function backdrop() {
  if ($('.backdrop')) return;
  document.body.prepend(
    h('div', { class: 'backdrop', 'aria-hidden': 'true' }, h('div', { class: 'orb o1' }), h('div', { class: 'orb o2' }), h('div', { class: 'orb o3' }), h('div', { class: 'oyu' }))
  );
}

/** Animated timer: a horizontal bar or SVG ring driven by server time. Returns stop(). */
export function runTimer({ startsAt, endsAt, total, onTick, lowAt = 5000 }) {
  let raf = 0;
  const loop = () => {
    const now = clock.now();
    const left = Math.max(0, endsAt - Math.max(now, startsAt));
    const frac = total > 0 ? left / total : 0;
    onTick(frac, left, left <= lowAt);
    if (left > 0) raf = requestAnimationFrame(loop);
  };
  loop();
  return () => cancelAnimationFrame(raf);
}

/** Top-3 podium with staged rise animation. `list` is sorted by rank. */
export function podium(list, meId) {
  const order = [list[1], list[0], list[2]];
  const cls = ['p2', 'p1', 'p3'];
  const nums = [2, 1, 3];
  return h(
    'div',
    { class: 'podium' },
    order.map((p, i) =>
      h(
        'div',
        { class: `place ${cls[i]}` },
        p
          ? h(
              'div',
              { class: 'who' },
              nums[i] === 1 ? h('span', { class: 'crown', html: ICONS.crown }) : null,
              avatar(p.nickname, nums[i] === 1 ? 'lg' : ''),
              h('span', { class: 'nm', style: p.id === meId ? { color: 'var(--gold)' } : null }, p.nickname),
              h('span', { class: 'sc num' }, `${fmtNum(p.score)} ұпай`)
            )
          : h('div', { class: 'who' }),
        h('div', { class: 'block' }, nums[i])
      )
    )
  );
}

/** Leaderboard row. `delta` shows points gained on the last question. */
export function lbRow(p, { meId, delta = false, score = p.score, rank = p.rank } = {}) {
  const d = p.delta || 0;
  return h(
    'li',
    { class: `${p.id === meId ? 'me' : ''} ${p.eliminated ? 'out' : ''}`.trim(), dataset: { key: p.id } },
    h('span', { class: 'rk' }, rank ?? '–'),
    avatar(p.nickname),
    h('span', { class: 'nm' }, p.nickname),
    delta ? h('span', { class: `dl ${d < 0 ? 'neg' : d === 0 ? 'zero' : ''}` }, d > 0 ? `+${fmtNum(d)}` : d < 0 ? `−${fmtNum(-d)}` : '0') : null,
    h('span', { class: 'sc' }, fmtNum(score))
  );
}

/**
 * Animated reveal leaderboard: first shows the previous standings, then slides rows
 * into the new order while scores count up.
 */
export function animatedLeaderboard(list, { meId, delay = 900 } = {}) {
  const ol = h('ol', { class: 'lb' });
  const prev = [...list].sort((a, b) => (a.prevRank ?? 999) - (b.prevRank ?? 999));
  ol.append(...prev.map((p) => lbRow(p, { meId, delta: true, score: p.score - (p.delta || 0), rank: p.prevRank ?? '–' })));
  const t = setTimeout(() => {
    if (!ol.isConnected) return;
    flip(ol, () => ol.replaceChildren(...list.map((p) => lbRow(p, { meId, delta: true }))));
    list.forEach((p, i) => {
      const sc = ol.children[i]?.querySelector('.sc');
      if (sc) countUp(sc, p.score - (p.delta || 0), p.score, 800);
    });
  }, delay);
  ol.cancel = () => clearTimeout(t);
  return ol;
}

/** Rules card shown before a round — or the "ФИНАЛ ×2" splash before the final. */
export function introCard(s, { big = false } = {}) {
  const r = s.round;
  const m = MODES[r.type];
  const ms = Math.max(300, (s.phaseEndsAt || 0) - clock.now());
  if (s.introKind === 'final') {
    return h(
      'div',
      { class: 'splash final-splash' },
      h('div', { class: 'rays' }),
      h('div', null, h('div', { class: 'title' }, 'ФИНАЛ'), h('div', { class: 'x2' }, 'Ұпай ×2'), h('div', { class: 'sub' }, `Соңғы ${s.finalCount} раунд — әр ұпай екі есе! Алдымен: ${m.name}`))
    );
  }
  const full = s.introKind === 'mode' || big;
  return h(
    'div',
    { class: `card rule-card mode-${r.type}-c` },
    h('div', { class: 'eyebrow' }, `Раунд ${r.n} / ${s.rCount}${r.eraName ? ' · ' + r.eraName : ''}`),
    h('div', { class: 'mi', html: ICONS[m.icon] }),
    h('h1', null, m.name),
    h('div', { class: 'tg' }, m.tagline),
    full ? h('ul', { class: 'rules' }, m.rules.map((x) => h('li', null, x))) : null,
    r.final ? h('span', { class: 'chip final' }, 'ФИНАЛ ×2') : null,
    h('div', { class: 'intro-bar' }, h('i', { style: { animationDuration: `${ms}ms` } }))
  );
}
