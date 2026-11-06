// Pages : boutique, classeur, succès, classement, fiche carte
import {
  S, $, $$, esc, fmt, api, setMe, packHTML, cardFace, setLogo, icon, coinTag, toast, toastAchievements,
  confirmBox, modal, attachTilt, sfx, now, timeAgo, countdown, setProgress, tierOf, rankOf,
} from './core.js';
import { openPack } from './opening.js';

const main = () => $('#view');

// ═════════════ BOUTIQUE ═════════════
export async function viewShop() {
  const series = [];
  for (const s of S.sets) {
    let g = series.find(x => x.name === s.serieName);
    if (!g) series.push(g = { name: s.serieName, sets: [] });
    g.sets.push(s);
  }
  const totalOwned = Object.keys(S.coll).filter(id => S.byId.has(id)).length;
  main().innerHTML = `
    <section class="shop-top">
      <div class="panel status daily" id="daily-box"></div>
      <div class="panel status free" id="free-box"></div>
      <div class="panel status mine">
        <div class="status-ico">${icon('book')}</div>
        <div class="status-txt">
          <small>Ma collection</small>
          <b>${fmt(totalOwned)} <span class="muted">/ ${fmt(S.cards.length)} cartes</span></b>
          <div class="bar"><i style="width:${(totalOwned / S.cards.length) * 100}%"></i></div>
        </div>
        <a class="btn ghost small" href="#/classeur">Ouvrir le classeur</a>
      </div>
    </section>
    <div class="shop-layout">
      <div class="shop-packs">
        ${series.map(g => `
          <section class="serie">
            <h2 class="serie-title"><span>${esc(g.name)}</span></h2>
            <div class="pack-grid">
              ${g.sets.map(s => packTile(s)).join('')}
            </div>
          </section>`).join('')}
      </div>
      <aside class="panel feed">
        <h3>${icon('flame')} Derniers gros tirages</h3>
        <div id="feed-list" class="feed-list"><p class="muted small">Chargement…</p></div>
      </aside>
    </div>`;
  renderStatus();
  $$('.pack-tile').forEach(t => {
    const open = () => {
      const s = S.setById.get(t.dataset.set);
      const free = S.me.freePackAt <= now();
      sfx.click();
      openPack(s.id, { free });
    };
    t.querySelector('.pack-click').onclick = open;
    t.querySelector('.buy').onclick = open;
  });
  loadFeed();
}

function packTile(s) {
  const p = setProgress(s.id);
  const free = S.me.freePackAt <= now();
  const year = (s.releaseDate || '').slice(0, 4);
  return `<article class="pack-tile" data-set="${s.id}" style="--c1:${s.colors[1]};--c2:${s.colors[2]}">
    <button class="pack-click" aria-label="Ouvrir un booster ${esc(s.name)}">
      ${packHTML(s)}
      ${free ? '<span class="free-ribbon">Gratuit</span>' : ''}
    </button>
    <div class="pt-info">
      <div class="pt-name">${esc(s.name)}</div>
      <div class="pt-meta">${year} · ${s.total} cartes</div>
      <div class="bar small"><i style="width:${p.pct}%"></i></div>
      <div class="pt-meta">${p.owned} / ${p.total} obtenues · ${p.pct} %</div>
    </div>
    <button class="btn buy ${free ? 'gold' : ''} ${!free && S.me.coins < s.price ? 'poor' : ''}">
      ${free ? `${icon('gift')} Ouvrir gratuitement` : `${icon('pack')} <i class="pd">₽</i>${fmt(s.price)}`}
    </button>
  </article>`;
}

export function renderStatus() {
  const d = $('#daily-box'), f = $('#free-box');
  if (!d || !S.me) return;
  const streak = S.me.dailyAvailable ? S.me.nextStreak - 1 : S.me.streak;
  const dots = Array.from({ length: 7 }, (_, i) => `<i class="${i < Math.min(streak, 7) ? 'on' : ''} ${S.me.dailyAvailable && i === Math.min(streak, 6) ? 'next' : ''}"></i>`).join('');
  d.innerHTML = `
    <div class="status-ico">${icon('calendar')}</div>
    <div class="status-txt">
      <small>Bonus quotidien</small>
      <b>${S.me.dailyAvailable ? `+₽${fmt(S.me.dailyReward)} à récupérer` : 'Récupéré aujourd\'hui'}</b>
      <div class="streak">${dots}<span>Série : ${streak} j</span></div>
    </div>
    <button class="btn ${S.me.dailyAvailable ? 'gold pulse' : 'ghost'} small" id="claim-daily" ${S.me.dailyAvailable ? '' : 'disabled'}>
      ${S.me.dailyAvailable ? 'Récupérer' : 'Demain !'}
    </button>`;
  const btn = $('#claim-daily');
  if (S.me.dailyAvailable) btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await api('/daily', {});
      setMe(r.user);
      sfx.coin();
      toast(`Série de ${r.streak} jour${r.streak > 1 ? 's' : ''} · <b class="gold">+₽${fmt(r.reward)}</b>`, 'coin', { title: 'Bonus quotidien' });
      toastAchievements(r.achievements);
      renderStatus();
      refreshPackButtons();
    } catch (e) { toast(esc(e.message), 'error'); btn.disabled = false; }
  };
  const ready = S.me.freePackAt <= now();
  f.classList.toggle('ready', ready);
  f.innerHTML = `
    <div class="status-ico">${icon('gift')}</div>
    <div class="status-txt">
      <small>Booster gratuit</small>
      <b>${ready ? 'Prêt ! Choisis ton booster' : `Prochain dans <span data-countdown>${countdown(S.me.freePackAt - now())}</span>`}</b>
      <span class="muted small">Un booster offert toutes les ${Math.round(S.economy.freePackCooldownMs / 3600e3)} h</span>
    </div>`;
}

function refreshPackButtons() {
  $$('.pack-tile').forEach(t => {
    const s = S.setById.get(t.dataset.set);
    const free = S.me.freePackAt <= now();
    t.querySelector('.buy').classList.toggle('poor', !free && S.me.coins < s.price);
  });
}

// Mise à jour chaque seconde (compte à rebours du booster gratuit)
export function tickShop() {
  const el = $('[data-countdown]');
  if (!el || !S.me) return;
  const left = S.me.freePackAt - now();
  if (left <= 0) { viewShop(); return; }
  el.textContent = countdown(left);
}

async function loadFeed() {
  const box = $('#feed-list');
  if (!box) return;
  try {
    const { feed } = await api('/feed');
    if (!feed.length) { box.innerHTML = '<p class="muted small">Personne n\'a encore eu de grosse carte. Ce sera peut-être toi !</p>'; return; }
    box.innerHTML = feed.map(f => {
      const c = S.byId.get(f.cardId);
      if (!c) return '';
      const t = tierOf(c);
      return `<button class="feed-item" data-id="${c.id}" style="--tc:${t.color}">
        <div class="feed-thumb">${cardFace(c)}</div>
        <div><b>${esc(f.username)}</b> a obtenu <b>${esc(c.name)}</b>
          <div class="feed-meta"><span class="rarity-pill tiny" style="--tc:${t.color}">${esc(c.rarity)}</span> ${timeAgo(f.at)}</div>
        </div>
      </button>`;
    }).join('');
    $$('.feed-item', box).forEach(b => b.onclick = () => showCard(b.dataset.id, { readonly: true }));
  } catch { box.innerHTML = '<p class="muted small">Fil indisponible.</p>'; }
}

// ═════════════ CLASSEUR ═════════════
const binderState = { filter: 'all', tier: '', q: '', sort: 'num' };

export async function viewBinder(setId, player) {
  let coll = S.coll, owner = null;
  if (player) {
    try {
      const p = await api('/players/' + encodeURIComponent(player));
      coll = p.collection; owner = p.username;
      if (owner.toLowerCase() === S.me.username.toLowerCase()) { owner = null; coll = S.coll; }
    } catch (e) { main().innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  }
  const set = S.setById.get(setId) || S.sets[0];
  const base = owner ? `#/joueur/${encodeURIComponent(owner)}` : '#/classeur';
  const p = setProgress(set.id, coll);
  const tiersInSet = [...new Set(S.bySet.get(set.id).map(c => c.tier))].sort((a, b) => S.tiers[a].rank - S.tiers[b].rank);
  main().innerHTML = `
    ${owner ? `<div class="visit-banner panel">${icon('user')} Tu regardes le classeur de <b>${esc(owner)}</b><a class="btn ghost small" href="#/classement">${icon('back')} Classement</a></div>` : ''}
    <nav class="set-tabs">
      ${S.sets.map(s => {
        const sp = setProgress(s.id, coll);
        return `<a class="set-tab ${s.id === set.id ? 'active' : ''}" href="${base}/${s.id}" style="--c1:${s.colors[1]}">
          ${setLogo(s, 'tiny')}<span class="st-pct">${sp.pct} %</span>
        </a>`;
      }).join('')}
    </nav>
    <section class="panel binder-head" style="--c0:${set.colors[0]};--c1:${set.colors[1]};--c2:${set.colors[2]}">
      <div class="bh-logo">${setLogo(set, 'big')}</div>
      <div class="bh-main">
        <div class="bh-title"><h1>${esc(set.name)}</h1><span class="muted">${esc(set.serieName)} · ${(set.releaseDate || '').slice(0, 4)}</span></div>
        <div class="bar big"><i style="width:${(p.owned / p.total) * 100}%"></i></div>
        <div class="bh-stats">
          <span><b>${p.owned}</b> / ${p.total} cartes</span>
          <span><b>${p.pct} %</b> complété</span>
          <span><b>${p.dupes}</b> doublon${p.dupes > 1 ? 's' : ''}</span>
        </div>
      </div>
      ${owner ? '' : `<div class="bh-actions">
        <button class="btn gold" id="open-here">${icon('pack')} Ouvrir un booster</button>
        <button class="btn ghost" id="sell-set" ${p.dupes ? '' : 'disabled'}>${icon('coin')} Vendre les doublons ${p.dupes ? `(+₽${fmt(p.dupeValue)})` : ''}</button>
      </div>`}
    </section>
    <div class="binder-tools">
      <div class="chips">
        ${[['all', 'Toutes'], ['owned', 'Obtenues'], ['missing', 'Manquantes'], ['dupes', 'Doublons']].map(([k, l]) =>
          `<button class="chip ${binderState.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
      </div>
      <select id="tier-filter" class="select">
        <option value="">Toutes les raretés</option>
        ${tiersInSet.map(t => `<option value="${t}" ${binderState.tier === t ? 'selected' : ''}>${esc(S.tiers[t].name)}</option>`).join('')}
      </select>
      <select id="sort" class="select">
        <option value="num" ${binderState.sort === 'num' ? 'selected' : ''}>Tri : numéro</option>
        <option value="rarity" ${binderState.sort === 'rarity' ? 'selected' : ''}>Tri : rareté</option>
        <option value="qty" ${binderState.sort === 'qty' ? 'selected' : ''}>Tri : quantité</option>
      </select>
      <label class="search">${icon('search')}<input id="q" placeholder="Rechercher une carte" value="${esc(binderState.q)}"></label>
    </div>
    <div class="binder-grid" id="binder-grid"></div>`;

  const renderGrid = () => {
    const q = binderState.q.trim().toLowerCase();
    let list = S.bySet.get(set.id).filter(c => {
      const n = coll[c.id] || 0;
      if (binderState.filter === 'owned' && !n) return false;
      if (binderState.filter === 'missing' && n) return false;
      if (binderState.filter === 'dupes' && n < 2) return false;
      if (binderState.tier && c.tier !== binderState.tier) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.nameEn.toLowerCase().includes(q)) return false;
      return true;
    });
    if (binderState.sort === 'rarity') list = [...list].sort((a, b) => rankOf(b) - rankOf(a) || a.num - b.num);
    if (binderState.sort === 'qty') list = [...list].sort((a, b) => (coll[b.id] || 0) - (coll[a.id] || 0) || a.num - b.num);
    const grid = $('#binder-grid');
    if (!list.length) { grid.innerHTML = '<div class="empty muted">Aucune carte ne correspond.</div>'; return; }
    grid.innerHTML = list.map(c => {
      const n = coll[c.id] || 0;
      return `<button class="bcard ${n ? '' : 'missing'}" data-id="${c.id}" style="--tc:${tierOf(c).color}">
        ${cardFace(c, { holo: n > 0 && rankOf(c) >= 3 })}
        <span class="bnum">${esc(c.localId)}</span>
        ${n > 1 ? `<span class="qty">×${n}</span>` : ''}
        ${n && rankOf(c) >= 4 ? '<span class="tier-dot"></span>' : ''}
      </button>`;
    }).join('');
    $$('.bcard', grid).forEach(b => b.onclick = () => showCard(b.dataset.id, { coll, readonly: !!owner, list: list.map(c => c.id) }));
  };
  renderGrid();

  $$('.chip').forEach(ch => ch.onclick = () => { binderState.filter = ch.dataset.f; $$('.chip').forEach(x => x.classList.toggle('on', x === ch)); renderGrid(); });
  $('#tier-filter').onchange = (e) => { binderState.tier = e.target.value; renderGrid(); };
  $('#sort').onchange = (e) => { binderState.sort = e.target.value; renderGrid(); };
  $('#q').oninput = (e) => { binderState.q = e.target.value; renderGrid(); };
  $('.set-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (!owner) {
    $('#open-here').onclick = () => openPack(set.id, { free: S.me.freePackAt <= now() });
    $('#sell-set').onclick = () => sellDupes(set.id, p);
  }
}

async function sellDupes(setId, p) {
  const ok = await confirmBox('Vendre les doublons ?',
    `Tu vas vendre <b>${p.dupes}</b> doublon${p.dupes > 1 ? 's' : ''} de cette extension pour ${coinTag(p.dupeValue)}. Tu gardes toujours un exemplaire de chaque carte.`,
    'Vendre');
  if (!ok) return;
  try {
    const r = await api('/sell', { setId });
    S.coll = r.collection;
    setMe(r.user);
    sfx.coin();
    toast(`${r.count} carte${r.count > 1 ? 's' : ''} vendue${r.count > 1 ? 's' : ''} · <b class="gold">+₽${fmt(r.earned)}</b>`, 'coin');
    toastAchievements(r.achievements);
    window.dispatchEvent(new CustomEvent('bc:refresh'));
  } catch (e) { toast(esc(e.message), 'error'); }
}

// ═════════════ FICHE CARTE ═════════════
export function showCard(id, { coll = S.coll, readonly = false, list = null } = {}) {
  const c = S.byId.get(id);
  if (!c) return;
  const set = S.setById.get(c.set);
  const t = tierOf(c);
  const n = coll[c.id] || 0;
  const holo = rankOf(c) >= 3;
  const idx = list ? list.indexOf(id) : -1;
  const m = modal(`
    <div class="card-detail" style="--tc:${t.color}">
      <div class="cd-visual">
        ${idx > 0 ? `<button class="cd-nav prev" aria-label="Carte précédente">${icon('left')}</button>` : ''}
        <div class="cd-card ${n ? '' : 'missing'}">${cardFace(c, { q: 'high', lazy: false, holo })}</div>
        ${list && idx < list.length - 1 ? `<button class="cd-nav next" aria-label="Carte suivante">${icon('right')}</button>` : ''}
      </div>
      <div class="cd-info">
        <span class="rarity-pill" style="--tc:${t.color}">${esc(c.rarity)}</span>
        <h2>${esc(c.name)}</h2>
        <p class="muted">${esc(set.name)} · n° ${esc(c.localId)}/${set.official}</p>
        <dl>
          ${c.hp ? `<dt>PV</dt><dd>${c.hp}</dd>` : ''}
          <dt>Catégorie</dt><dd>${{ Pokemon: 'Pokémon', Trainer: 'Dresseur', Energy: 'Énergie' }[c.category] || esc(c.category)}</dd>
          ${c.illustrator ? `<dt>Illustration</dt><dd>${esc(c.illustrator)}</dd>` : ''}
          <dt>Possédée</dt><dd>${n ? `×${n}` : '<span class="muted">pas encore</span>'}</dd>
          <dt>Revente</dt><dd>${coinTag(t.value)} / doublon</dd>
        </dl>
        ${!readonly && n > 1 ? `<div class="cd-actions">
          <button class="btn ghost" data-sell="1">Vendre 1 doublon · +₽${fmt(t.value)}</button>
          ${n > 2 ? `<button class="btn ghost" data-sell="${n - 1}">Vendre les ${n - 1} doublons · +₽${fmt(t.value * (n - 1))}</button>` : ''}
        </div>` : ''}
      </div>
    </div>`, { cls: 'modal-card' });
  const cardEl = m.el.querySelector('.cd-card');
  attachTilt(cardEl, 22);
  const go = (d) => { m.close(); showCard(list[idx + d], { coll, readonly, list }); };
  m.el.querySelector('.prev')?.addEventListener('click', () => go(-1));
  m.el.querySelector('.next')?.addEventListener('click', () => go(1));
  const onKey = (e) => {
    if (!m.el.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.key === 'ArrowLeft' && idx > 0) { document.removeEventListener('keydown', onKey); go(-1); }
    if (e.key === 'ArrowRight' && list && idx < list.length - 1) { document.removeEventListener('keydown', onKey); go(1); }
  };
  document.addEventListener('keydown', onKey);
  m.el.querySelectorAll('[data-sell]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api('/sell', { cardId: c.id, qty: Number(b.dataset.sell) });
      S.coll = r.collection;
      setMe(r.user);
      sfx.coin();
      toast(`<b class="gold">+₽${fmt(r.earned)}</b>`, 'coin', { title: 'Vendu !' });
      toastAchievements(r.achievements);
      m.close();
      window.dispatchEvent(new CustomEvent('bc:refresh'));
    } catch (e) { toast(esc(e.message), 'error'); b.disabled = false; }
  });
}

// ═════════════ SUCCÈS ═════════════
export async function viewAchievements() {
  main().innerHTML = '<div class="loading-block"></div>';
  let list;
  try { ({ achievements: list } = await api('/achievements')); }
  catch (e) { main().innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const done = list.filter(a => a.unlockedAt);
  const earned = done.reduce((s, a) => s + a.reward, 0);
  const sorted = [...list].sort((a, b) => (!!b.unlockedAt - !!a.unlockedAt) || (b.progress / b.goal - a.progress / a.goal));
  main().innerHTML = `
    <section class="page-head">
      <h1>${icon('trophy')} Succès</h1>
      <div class="head-stats">
        <div class="stat-big"><b>${done.length}</b><span>/ ${list.length} débloqués</span></div>
        <div class="stat-big"><b class="gold">₽${fmt(earned)}</b><span>gagnés</span></div>
      </div>
      <div class="bar big"><i style="width:${(done.length / list.length) * 100}%"></i></div>
    </section>
    <div class="ach-grid">
      ${sorted.map(a => {
        const pct = Math.min(100, (a.progress / a.goal) * 100);
        return `<article class="ach ${a.unlockedAt ? 'done' : ''}">
          <div class="ach-ico">${icon(a.unlockedAt ? a.icon : a.icon)}</div>
          <div class="ach-body">
            <h3>${esc(a.name)}</h3>
            <p>${esc(a.desc)}</p>
            ${a.unlockedAt
              ? `<div class="ach-done">${icon('check')} Débloqué le ${new Date(a.unlockedAt).toLocaleDateString('fr-FR')}</div>`
              : `<div class="bar small"><i style="width:${pct}%"></i></div><div class="ach-prog">${fmt(a.progress)} / ${fmt(a.goal)}</div>`}
          </div>
          <div class="ach-reward">${coinTag(a.reward)}</div>
        </article>`;
      }).join('')}
    </div>`;
}

// ═════════════ CLASSEMENT ═════════════
export async function viewLeaderboard() {
  main().innerHTML = '<div class="loading-block"></div>';
  let board, achTotal;
  try { ({ board, achievementsTotal: achTotal } = await api('/leaderboard')); }
  catch (e) { main().innerHTML = `<div class="panel empty">${esc(e.message)}</div>`; return; }
  const podium = board.slice(0, 3);
  const medal = ['gold', 'silver', 'bronze'];
  main().innerHTML = `
    <section class="page-head">
      <h1>${icon('podium')} Classement</h1>
      <p class="muted">Classé par valeur de collection (chaque carte différente compte selon sa rareté). Clique sur un joueur pour voir son classeur.</p>
    </section>
    <div class="podium">
      ${[1, 0, 2].map(i => podium[i] ? `<a class="pod pod-${i + 1} ${medal[i]}" href="#/joueur/${encodeURIComponent(podium[i].username)}">
        <div class="pod-card">${podium[i].best ? cardFace(S.byId.get(podium[i].best)) : '<div class="card-back-mini"></div>'}</div>
        <div class="pod-rank">${i + 1}</div>
        <div class="pod-name">${esc(podium[i].username)}${podium[i].me ? ' <small>(toi)</small>' : ''}</div>
        <div class="pod-val">${fmt(podium[i].value)} pts</div>
      </a>` : '').join('')}
    </div>
    <div class="panel lb">
      <div class="lb-row lb-head"><span>#</span><span>Joueur</span><span>Valeur</span><span>Cartes</span><span class="hide-sm">Boosters</span><span class="hide-sm">Succès</span><span class="hide-sm">Meilleure carte</span></div>
      ${board.map((u, i) => {
        const b = u.best && S.byId.get(u.best);
        return `<a class="lb-row ${u.me ? 'me' : ''}" href="#/joueur/${encodeURIComponent(u.username)}">
          <span class="lb-rank ${medal[i] || ''}">${i + 1}</span>
          <span class="lb-name">${esc(u.username)}${u.me ? ' <small>(toi)</small>' : ''}</span>
          <span><b>${fmt(u.value)}</b> pts</span>
          <span>${fmt(u.unique)}</span>
          <span class="hide-sm">${fmt(u.packs)}</span>
          <span class="hide-sm">${u.achievements}/${achTotal}</span>
          <span class="hide-sm lb-best">${b ? `<span class="rarity-pill tiny" style="--tc:${tierOf(b).color}">${esc(b.name)}</span>` : '—'}</span>
        </a>`;
      }).join('')}
    </div>`;
}
