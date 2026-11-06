// État global, appels API, petits utilitaires d'interface
export const S = {
  tiers: {}, sets: [], setById: new Map(), cards: [], byId: new Map(), bySet: new Map(),
  me: null, coll: {}, skew: 0, muted: false, economy: {},
};

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
export const now = () => Date.now() + S.skew;
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await fetch('/api' + path, opts); break; }
    catch {
      if (attempt < 2) { await sleep(1200); continue; }
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      const e = new Error(local
        ? 'Le serveur du jeu ne répond plus. Vérifie que la fenêtre noire « Booster Club » est toujours ouverte (sinon relance Lancer-le-jeu.bat), puis réessaie.'
        : 'Le serveur du jeu ne répond pas. Réessaie dans un instant.');
      e.status = 0;
      throw e;
    }
  }
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || 'Erreur'); e.status = r.status; throw e; }
  return j;
}

export function indexData(d) {
  S.tiers = d.tiers;
  S.sets = d.sets;
  S.cards = d.cards;
  S.economy = d.economy;
  S.setById = new Map(d.sets.map(s => [s.id, s]));
  S.byId = new Map(d.cards.map(c => [c.id, c]));
  S.bySet = new Map(d.sets.map(s => [s.id, d.cards.filter(c => c.set === s.id)]));
  for (const s of d.sets) s.mascot = pickMascot(s);
}

// Carte vedette affichée sur le booster
const MASCOTS = { base1: 'base1-4', base2: 'base2-1', base3: 'base3-15' };
function pickMascot(set) {
  if (MASCOTS[set.id] && S.byId.has(MASCOTS[set.id])) return S.byId.get(MASCOTS[set.id]);
  const list = S.bySet.get(set.id).filter(c => c.category === 'Pokemon');
  for (const t of ['SIR', 'IR', 'UR', 'SR', 'VMAX', 'HOLO', 'DR', 'R']) {
    const c = list.find(x => x.tier === t);
    if (c) return c;
  }
  return list[0];
}

export const tierOf = (card) => S.tiers[card.tier];
export const rankOf = (card) => S.tiers[card.tier].rank;

// ───────────── Images (TCGdex) avec repli FR → EN → carte dessinée ─────────────
const ASSETS = 'https://assets.tcgdex.net';
export const cardUrl = (card, q = 'low', lang = 'fr') => `${ASSETS}/${lang}/${card.img}/${q}.webp`;
export const logoUrl = (set, lang = 'fr') => `${ASSETS}/${lang}/${set.serie}/${set.id}/logo.webp`;

const TYPE_COLORS = {
  Grass: '#4ade80', Fire: '#fb923c', Water: '#38bdf8', Lightning: '#facc15', Psychic: '#c084fc',
  Fighting: '#d97706', Darkness: '#475569', Metal: '#94a3b8', Dragon: '#ca8a04', Fairy: '#f9a8d4',
  Colorless: '#e2e8f0',
};

export function cardFace(card, { q = 'low', lazy = true, holo = false, extra = '' } = {}) {
  const t = tierOf(card);
  const color = card.category === 'Pokemon' ? (TYPE_COLORS[card.types?.[0]] || '#cbd5e1') : card.category === 'Trainer' ? '#93c5fd' : '#fde68a';
  return `<div class="card-face ${holo ? 'is-holo tier-' + card.tier : ''} ${extra}" style="--tc:${t.color};--type:${color}">
    <img class="cimg" src="${cardUrl(card, q)}" data-fb="${cardUrl(card, q, 'en')}" ${lazy ? 'loading="lazy"' : ''} decoding="async" alt="${esc(card.name)}" draggable="false">
    <div class="cfb">
      <div class="cfb-top"><span>${esc(card.name)}</span>${card.hp ? `<b>${card.hp} PV</b>` : ''}</div>
      <div class="cfb-art"></div>
      <div class="cfb-bottom"><span>${esc(card.rarity)}</span><span>${esc(card.localId)}/${S.setById.get(card.set)?.official ?? ''}</span></div>
    </div>
    ${holo ? '<div class="holo-layer"></div><div class="glare"></div>' : ''}
  </div>`;
}

export function setLogo(set, cls = '') {
  return `<span class="set-logo ${cls}"><img class="slogo" src="${logoUrl(set)}" data-fb="${logoUrl(set, 'en')}" alt="${esc(set.name)}" loading="lazy"><span class="slogo-txt">${esc(set.name)}</span></span>`;
}

// Repli automatique quand une image ne charge pas
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fb = img.dataset.fb;
  if (fb) { img.dataset.fb = ''; img.src = fb; return; }
  img.classList.add('failed');
  img.parentElement?.classList.add('noimg');
}, true);

export function preloadImages(urls, timeout = 4000) {
  return Promise.race([
    Promise.all(urls.map(u => new Promise(res => {
      const i = new Image();
      i.onload = i.onerror = () => res();
      i.src = u;
    }))),
    sleep(timeout),
  ]);
}

// ───────────── Dos de carte (création originale) ─────────────
export function cardBack() {
  return `<div class="card-back"><div class="cb-inner"><div class="cb-ring"><div class="cb-star">${icon('sparkle')}</div></div><div class="cb-title">BOOSTER<br>CLUB</div></div></div>`;
}

// ───────────── Booster dessiné en CSS ─────────────
export function packHTML(set, { big = false } = {}) {
  const [c0, c1, c2] = set.colors;
  const m = set.mascot;
  return `<div class="pack ${big ? 'pack-big' : ''}" style="--c0:${c0};--c1:${c1};--c2:${c2}">
    <div class="pack-shape">
      <div class="pack-crimp"></div>
      <div class="pack-art">${m ? `<img class="cimg" src="${cardUrl(m, 'high')}" data-fb="${cardUrl(m, 'high', 'en')}" alt="" loading="lazy" draggable="false">` : ''}</div>
      <div class="pack-logo">${setLogo(set)}</div>
      <div class="pack-foot">Booster · ${set.template === 'wotc' ? 11 : 10} cartes</div>
      <div class="pack-crimp bottom"></div>
      <div class="pack-sheen"></div>
    </div>
  </div>`;
}

// ───────────── Icônes (SVG) ─────────────
const ICONS = {
  pack: 'M6 3l1.5 1.5L9 3l1.5 1.5L12 3l1.5 1.5L15 3l1.5 1.5L18 3v18l-1.5-1.5L15 21l-1.5-1.5L12 21l-1.5-1.5L9 21l-1.5-1.5L6 21z M9 9h6 M9 13h6',
  book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z',
  trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22 M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8 M18 2H6v7a6 6 0 0 0 12 0z',
  podium: 'M3 21h18 M4 21v-6h5v6 M9.5 21V8h5v13 M15 21v-9h5v9',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 16.5V7.5h3.3a2.6 2.6 0 0 1 0 5.2H9.5 M8 10.2h7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  sound: 'M11 5 6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14',
  mute: 'M11 5 6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  brush: 'M12 22a10 10 0 1 1 10-10c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22z M7.5 10.5h.01 M10.5 7h.01 M15 7.5h.01',
  crown: 'M2.5 6l3.5 11h12l3.5-11-6 5-3.5-7-3.5 7z M6 21h12',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  sparkle: 'M12 2.5l2.2 6.6 6.8 2.4-6.8 2.4L12 20.5l-2.2-6.6L3 11.5l6.8-2.4z',
  cards: 'M9 3h9a2 2 0 0 1 2 2v12 M5 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  gift: 'M20 12v10H4V12 M2 7h20v5H2z M12 22V7 M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 2',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M21 21l-4.3-4.3',
  x: 'M18 6 6 18 M6 6l12 12',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  back: 'M19 12H5 M12 19l-7-7 7-7',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 21a8 8 0 0 1 16 0',
  check: 'M20 6 9 17l-5-5',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
};
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.star}"/></svg>`;
}

export const coinTag = (n, cls = '') => `<span class="coin-tag ${cls}"><i class="pd">₽</i>${fmt(n)}</span>`;

// ───────────── Toasts ─────────────
export function toast(msg, type = 'info', { title, timeout = 3800 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const ic = { error: 'x', success: 'check', ach: 'trophy', coin: 'coin', info: 'sparkle' }[type] || 'sparkle';
  el.innerHTML = `<div class="toast-ico">${icon(ic)}</div><div>${title ? `<b>${esc(title)}</b>` : ''}<span>${msg}</span></div>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, timeout);
}

export function toastAchievements(list = []) {
  list.forEach((a, i) => setTimeout(() => {
    toast(`${esc(a.name)} · <b class="gold">+₽${fmt(a.reward)}</b>`, 'ach', { title: 'Succès débloqué !', timeout: 5200 });
    sfx.success();
  }, 400 + i * 900));
}

// ───────────── Fenêtres ─────────────
export function modal(html, { cls = '', onClose } = {}) {
  const el = document.createElement('div');
  el.className = `modal ${cls}`;
  el.innerHTML = `<div class="modal-bg"></div><div class="modal-box" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Fermer">${icon('x')}</button>${html}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const close = () => {
    if (!el.isConnected) return;
    el.classList.remove('in');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => el.remove(), 250);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.modal-bg').onclick = close;
  el.querySelector('.modal-x').onclick = close;
  return { el, close };
}

export function confirmBox(title, text, okLabel = 'Confirmer') {
  return new Promise(resolve => {
    let done = false;
    const m = modal(`<div class="confirm"><h3>${esc(title)}</h3><p>${text}</p>
      <div class="row-end"><button class="btn ghost" data-a="no">Annuler</button><button class="btn gold" data-a="yes">${esc(okLabel)}</button></div></div>`,
      { cls: 'modal-small', onClose: () => { if (!done) resolve(false); } });
    m.el.querySelector('[data-a=no]').onclick = () => m.close();
    m.el.querySelector('[data-a=yes]').onclick = () => { done = true; resolve(true); m.close(); };
  });
}

// ───────────── Pokédollars ─────────────
let shownCoins = null;
export function setMe(user) {
  S.me = user;
  S.skew = user.serverNow - Date.now();
  const el = $('#coins-val');
  if (!el) { shownCoins = user.coins; return; }
  const from = shownCoins ?? user.coins, to = user.coins;
  shownCoins = to;
  if (from === to) { el.textContent = fmt(to); return; }
  const pill = $('#coins');
  pill?.classList.remove('bump-up', 'bump-down');
  void pill?.offsetWidth;
  pill?.classList.add(to > from ? 'bump-up' : 'bump-down');
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((now() - ts) / 1000));
  if (s < 60) return 'à l\'instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(sec).padStart(2, '0')}`;
}

// Statistiques locales de la collection
export function setProgress(setId, coll = S.coll) {
  const list = S.bySet.get(setId) || [];
  let owned = 0, dupes = 0, dupeValue = 0;
  for (const c of list) {
    const q = coll[c.id] || 0;
    if (q > 0) owned++;
    if (q > 1) { dupes += q - 1; dupeValue += (q - 1) * S.tiers[c.tier].value; }
  }
  return { owned, total: list.length, pct: list.length ? Math.floor((owned / list.length) * 100) : 0, dupes, dupeValue };
}

// ───────────── Effet 3D + reflet holo qui suit la souris ─────────────
export function attachTilt(el, strength = 14) {
  const target = el;
  const move = (x, y) => {
    const r = target.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (x - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (y - r.top) / r.height));
    target.style.setProperty('--rx', `${(0.5 - py) * strength}deg`);
    target.style.setProperty('--ry', `${(px - 0.5) * strength}deg`);
    target.style.setProperty('--mx', `${px * 100}%`);
    target.style.setProperty('--my', `${py * 100}%`);
    target.style.setProperty('--hyp', Math.hypot(px - 0.5, py - 0.5).toFixed(3));
    target.classList.add('tilting');
  };
  const reset = () => {
    target.classList.remove('tilting');
    target.style.setProperty('--rx', '0deg');
    target.style.setProperty('--ry', '0deg');
  };
  target.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
  target.addEventListener('pointerleave', reset);
  return { move, reset };
}

// ───────────── Sons (synthétisés, aucun fichier) ─────────────
let ac = null;
function ctx() {
  if (S.muted) return null;
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  } catch { return null; }
}
function tone(freq, start, dur, { type = 'sine', vol = 0.15, slideTo } = {}) {
  const a = ctx(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, a.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}
function noise(start, dur, { vol = 0.25, from = 3000, to = 500, q = 1.2 } = {}) {
  const a = ctx(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(from, a.currentTime + start);
  f.frequency.exponentialRampToValueAtTime(to, a.currentTime + start + dur);
  const g = a.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}
export const sfx = {
  tear() { noise(0, 0.42, { vol: 0.5, from: 4500, to: 700, q: 0.8 }); noise(0.05, 0.3, { vol: 0.25, from: 2000, to: 300 }); },
  flip() { noise(0, 0.06, { vol: 0.25, from: 2500, to: 1200, q: 2 }); tone(520, 0, 0.08, { vol: 0.05, type: 'triangle' }); },
  whoosh() { noise(0, 0.22, { vol: 0.12, from: 900, to: 2400, q: 0.7 }); },
  hint() { tone(300, 0, 0.5, { vol: 0.06, slideTo: 620, type: 'sine' }); },
  rare(rank) {
    const base = rank >= 8 ? 523.25 : rank >= 6 ? 440 : 392;
    const notes = rank >= 8 ? [0, 4, 7, 12, 16, 19, 24] : rank >= 5 ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
    notes.forEach((n, i) => tone(base * Math.pow(2, n / 12), i * 0.07, 0.5, { type: 'triangle', vol: 0.09 }));
    if (rank >= 8) { tone(base * 4, 0.5, 1.2, { vol: 0.04 }); noise(0.45, 0.8, { vol: 0.08, from: 8000, to: 6000, q: 0.5 }); }
  },
  coin() { tone(988, 0, 0.12, { type: 'square', vol: 0.04 }); tone(1319, 0.08, 0.3, { type: 'square', vol: 0.04 }); },
  success() { [0, 4, 7, 12].forEach((n, i) => tone(587.33 * Math.pow(2, n / 12), i * 0.09, 0.35, { type: 'triangle', vol: 0.07 })); },
  click() { tone(700, 0, 0.05, { vol: 0.03, type: 'triangle' }); },
};
