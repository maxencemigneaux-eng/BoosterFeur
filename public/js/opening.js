// Ouverture d'un booster : déchirage, révélation carte par carte, récapitulatif
import {
  S, $, $$, esc, fmt, api, setMe, packHTML, cardFace, cardBack, cardUrl, preloadImages,
  rankOf, tierOf, sfx, toast, toastAchievements, attachTilt, icon, coinTag, now,
} from './core.js';

let O = null; // état de l'ouverture en cours

export async function openPack(setId, { free = false } = {}) {
  if (O) return;
  const set = S.setById.get(setId);
  if (!set) return;
  if (!free && S.me.coins < set.price) { toast('Pas assez de Pokédollars ! Vends des doublons ou récupère ton bonus.', 'error'); return; }

  O = { set, free, phase: 'loading', idx: 0, flipped: false, busy: false };
  const el = document.createElement('div');
  el.className = 'opening';
  el.style.setProperty('--c0', set.colors[0]);
  el.style.setProperty('--c1', set.colors[1]);
  el.style.setProperty('--c2', set.colors[2]);
  el.innerHTML = `
    <div class="op-bg"><div class="op-rays"></div></div>
    <canvas class="op-fx"></canvas>
    <div class="op-flash"></div>
    <div class="op-top">
      <div class="op-title">${esc(set.name)}</div>
      <div class="op-counter"></div>
      <button class="btn ghost small op-skip" hidden>Tout révéler</button>
    </div>
    <div class="op-stage">
      <div class="op-packwrap">
        <div class="op-pack">
          <div class="op-pack-top">${packHTML(set, { big: true })}</div>
          <div class="op-pack-body">${packHTML(set, { big: true })}</div>
          <div class="op-cut"><div class="op-cut-line"></div></div>
        </div>
        <div class="op-hint">Préparation du booster…</div>
      </div>
      <div class="op-stack"></div>
      <div class="op-info"></div>
    </div>
    <div class="op-summary" hidden></div>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  O.el = el;
  O.fx = new Particles($('.op-fx', el));
  requestAnimationFrame(() => el.classList.add('in'));

  const keyHandler = (e) => {
    if (!O) return;
    if (e.key === 'Escape' && O.phase === 'summary') return close();
    if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (O.phase === 'ready') tear();
      else if (O.phase === 'reveal') advance();
    }
  };
  document.addEventListener('keydown', keyHandler);
  O.keyHandler = keyHandler;

  let res;
  try {
    [res] = await Promise.all([api('/open', { setId, free }), new Promise(r => setTimeout(r, 650))]);
  } catch (e) {
    toast(esc(e.message), 'error');
    return close(true);
  }
  O.res = res;
  setMe(res.user);
  for (const c of res.cards) S.coll[c.id] = (S.coll[c.id] || 0) + 1;
  O.cards = res.cards.map(c => ({ ...c, card: S.byId.get(c.id) }));
  O.preload = preloadImages(O.cards.map(c => cardUrl(c.card, 'high')), 5000);
  O.phase = 'ready';
  $('.op-hint', el).innerHTML = `${icon('sparkle')} Glisse le long du haut du booster pour l'ouvrir <span>ou clique dessus</span>`;
  el.classList.add('ready');
  if (res.god) el.classList.add('god');
  setupTear();
}

function setupTear() {
  const pack = $('.op-pack', O.el);
  let startX = null, moved = 0;
  pack.addEventListener('pointerdown', (e) => {
    if (O.phase !== 'ready') return;
    startX = e.clientX; moved = 0;
    pack.setPointerCapture(e.pointerId);
  });
  pack.addEventListener('pointermove', (e) => {
    if (startX === null || O.phase !== 'ready') return;
    const r = pack.getBoundingClientRect();
    moved = Math.max(moved, Math.abs(e.clientX - startX));
    const k = Math.min(1, moved / (r.width * 0.75));
    pack.style.setProperty('--cut', k);
    pack.classList.add('cutting');
    if (k >= 1) { startX = null; tear(); }
  });
  pack.addEventListener('pointerup', () => {
    if (startX === null) return;
    startX = null;
    if (O.phase === 'ready') tear();
  });
}

async function tear() {
  if (O.phase !== 'ready') return;
  O.phase = 'tearing';
  const el = O.el;
  const pack = $('.op-pack', el);
  pack.classList.add('cutting');
  pack.style.setProperty('--cut', 1);
  sfx.tear();
  await wait(180);
  el.classList.add('torn');
  O.fx.burst(innerWidth / 2, $('.op-pack', el).getBoundingClientRect().top + 30, 26, O.set.colors[2], { spread: 1.2, up: true });
  await Promise.all([O.preload, wait(650)]);
  buildStack();
  el.classList.add('revealing');
  O.phase = 'reveal';
  $('.op-skip', el).hidden = false;
  $('.op-skip', el).onclick = () => showSummary();
  updateCounter();
  await wait(550);
  flipCurrent();
}

function buildStack() {
  const stack = $('.op-stack', O.el);
  const n = O.cards.length;
  stack.innerHTML = O.cards.map((c, i) => {
    const holo = rankOf(c.card) >= 3 || c.rev;
    const r = rankOf(c.card);
    return `<div class="ocard ${c.rev ? 'rev' : ''} ${r >= 4 ? 'glow' : ''} ${r >= 8 ? 'glow-max' : ''}" data-i="${i}" style="z-index:${n - i};--d:${i};--tc:${tierOf(c.card).color}">
      <div class="ocard-inner">
        <div class="ocard-back">${cardBack()}</div>
        <div class="ocard-front">${cardFace(c.card, { q: 'high', lazy: false, holo, extra: c.rev ? 'reverse' : '' })}</div>
      </div>
    </div>`;
  }).join('');
  O.els = $$('.ocard', stack);
  O.els.forEach(e => attachTilt(e, 18));
  stack.onclick = () => advance();
  // Les cartes rares brillent avant d'être retournées
  markHint();
}

function markHint() {
  const c = O.cards[O.idx], e = O.els[O.idx];
  if (!c || !e) return;
  const r = rankOf(c.card);
  if (r >= 4) {
    e.classList.add('hint', r >= 8 ? 'hint-max' : r >= 6 ? 'hint-high' : 'hint-mid');
    sfx.hint();
  }
}

function updateCounter() {
  $('.op-counter', O.el).textContent = `${Math.min(O.idx + 1, O.cards.length)} / ${O.cards.length}`;
}

function advance() {
  if (!O || O.phase !== 'reveal' || O.busy) return;
  if (!O.flipped) return flipCurrent();
  // jeter la carte actuelle
  const e = O.els[O.idx];
  e.classList.add('thrown');
  e.style.setProperty('--throw', O.idx % 2 ? 1 : -1);
  sfx.whoosh();
  $('.op-info', O.el).classList.remove('show');
  O.idx++;
  O.flipped = false;
  if (O.idx >= O.cards.length) { O.busy = true; setTimeout(showSummary, 350); return; }
  updateCounter();
  markHint();
  const next = O.cards[O.idx];
  if (rankOf(next.card) < 4) { O.busy = true; setTimeout(() => { O.busy = false; flipCurrent(); }, 260); }
}

function flipCurrent() {
  const c = O.cards[O.idx], e = O.els[O.idx];
  if (!c || O.flipped) return;
  O.flipped = true;
  const r = rankOf(c.card);
  if (r < 6) O.el.classList.remove('rays');
  e.classList.remove('hint', 'hint-mid', 'hint-high', 'hint-max');
  e.classList.add('flipped');
  sfx.flip();
  const t = tierOf(c.card);
  const info = $('.op-info', O.el);
  info.innerHTML = `
    <div class="oi-name">${esc(c.card.name)}</div>
    <div class="oi-tags">
      <span class="rarity-pill" style="--tc:${t.color}">${esc(c.card.rarity)}</span>
      ${c.rev ? '<span class="tag tag-rev">Reverse</span>' : ''}
      ${c.isNew ? '<span class="tag tag-new">Nouvelle !</span>' : `<span class="tag tag-dupe">×${S.coll[c.id] || 1}</span>`}
    </div>`;
  info.style.setProperty('--tc', t.color);
  info.classList.remove('show'); void info.offsetWidth; info.classList.add('show');

  if (r >= 3) {
    setTimeout(() => {
      const rect = e.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      sfx.rare(r);
      O.fx.burst(cx, cy, r >= 8 ? 140 : r >= 6 ? 80 : r >= 4 ? 50 : 26, t.color, { spread: r >= 8 ? 2.2 : 1.4, stars: r >= 6 });
      if (r >= 6) O.el.classList.add('rays');
      if (r >= 8) {
        O.el.classList.remove('flash', 'shake'); void O.el.offsetWidth;
        O.el.classList.add('flash', 'shake');
        setTimeout(() => O.fx.burst(cx, cy, 90, '#ffffff', { spread: 2.6, stars: true }), 250);
      }
      O.el.style.setProperty('--ray', t.color);
    }, 220);
  }
}

function showSummary() {
  if (!O || O.phase === 'summary') return;
  O.phase = 'summary';
  O.busy = false;
  const el = O.el;
  el.classList.remove('rays', 'revealing');
  el.classList.add('done');
  $('.op-skip', el).hidden = true;
  $('.op-counter', el).textContent = '';
  const newCount = O.cards.filter(c => c.isNew).length;
  const value = O.cards.reduce((s, c) => s + tierOf(c.card).value, 0);
  const best = O.cards.reduce((b, c) => (rankOf(c.card) > rankOf(b.card) ? c : b), O.cards[0]);
  const set = O.set;
  const freeAgain = S.me.freePackAt <= now();
  const canBuy = S.me.coins >= set.price;
  const sum = $('.op-summary', el);
  sum.hidden = false;
  sum.innerHTML = `
    <div class="os-head">
      ${O.res.god ? '<div class="god-banner">BOOSTER DIVIN !</div>' : ''}
      <h2>${newCount ? `${newCount} nouvelle${newCount > 1 ? 's' : ''} carte${newCount > 1 ? 's' : ''} !` : 'Que des doublons… la prochaine sera la bonne !'}</h2>
      <p>Meilleure carte : <b style="color:${tierOf(best.card).color}">${esc(best.card.name)}</b> · ${esc(best.card.rarity)} · valeur de revente du booster ${coinTag(value)}</p>
    </div>
    <div class="os-grid">
      ${O.cards.map((c, i) => `<button class="os-card ${rankOf(c.card) >= 4 ? 'is-hit' : ''}" style="--i:${i};--tc:${tierOf(c.card).color}" data-id="${c.id}">
        ${cardFace(c.card, { q: 'low', lazy: false, holo: rankOf(c.card) >= 3 || c.rev, extra: c.rev ? 'reverse' : '' })}
        ${c.isNew ? '<span class="tag tag-new">Nouvelle</span>' : ''}
      </button>`).join('')}
    </div>
    <div class="os-actions">
      <button class="btn ghost" data-a="close">Fermer</button>
      <button class="btn" data-a="binder">${icon('book')} Voir le classeur</button>
      ${freeAgain
        ? `<button class="btn gold big" data-a="again-free">${icon('gift')} Ouvrir un autre · Gratuit</button>`
        : `<button class="btn gold big" data-a="again" ${canBuy ? '' : 'disabled'}>${icon('pack')} Ouvrir un autre · ₽${fmt(set.price)}</button>`}
    </div>`;
  $$('.os-card', sum).forEach(b => b.onclick = () => import('./views.js').then(v => v.showCard(b.dataset.id)));
  sum.querySelector('[data-a=close]').onclick = () => close();
  sum.querySelector('[data-a=binder]').onclick = () => { close(); location.hash = `#/classeur/${set.id}`; };
  const again = sum.querySelector('[data-a^=again]');
  again && (again.onclick = () => { const f = again.dataset.a === 'again-free'; close(); setTimeout(() => openPack(set.id, { free: f }), 320); });
  toastAchievements(O.res.achievements);
}

function close(silent) {
  if (!O) return;
  const el = O.el;
  document.removeEventListener('keydown', O.keyHandler);
  O.fx.stop();
  el.classList.remove('in');
  el.classList.add('out');
  setTimeout(() => { el.remove(); if (!$('.opening')) document.body.classList.remove('no-scroll'); }, 320);
  O = null;
  if (!silent) window.dispatchEvent(new CustomEvent('bc:refresh'));
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ───────────── Particules ─────────────
class Particles {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.p = []; this.running = false; this.alive = true;
    this.resize = () => { const d = Math.min(2, devicePixelRatio || 1); this.c.width = innerWidth * d; this.c.height = innerHeight * d; this.g.setTransform(d, 0, 0, d, 0, 0); };
    this.resize();
    addEventListener('resize', this.resize);
  }
  burst(x, y, n, color, { spread = 1.4, stars = false, up = false } = {}) {
    for (let i = 0; i < n; i++) {
      const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const v = (2 + Math.random() * 6) * spread;
      this.p.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (up ? 2 : 1.5),
        life: 1, decay: 0.008 + Math.random() * 0.018, size: 2 + Math.random() * (stars ? 5 : 3.5),
        color: Math.random() < 0.3 ? '#ffffff' : color, star: stars && Math.random() < 0.5, rot: Math.random() * 6,
      });
    }
    if (!this.running) { this.running = true; requestAnimationFrame(() => this.tick()); }
  }
  tick() {
    if (!this.alive) return;
    const g = this.g;
    g.clearRect(0, 0, innerWidth, innerHeight);
    this.p = this.p.filter(p => p.life > 0);
    for (const p of this.p) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.985; p.life -= p.decay; p.rot += 0.1;
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.shadowColor = p.color; g.shadowBlur = 12;
      if (p.star) {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath();
        for (let k = 0; k < 4; k++) { g.lineTo(0, -p.size * 1.8); g.rotate(Math.PI / 4); g.lineTo(0, -p.size * 0.5); g.rotate(Math.PI / 4); }
        g.closePath(); g.fill(); g.restore();
      } else {
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
    if (this.p.length) requestAnimationFrame(() => this.tick());
    else this.running = false;
  }
  stop() { this.alive = false; removeEventListener('resize', this.resize); }
}
