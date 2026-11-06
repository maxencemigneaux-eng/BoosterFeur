// Démarrage, connexion, navigation
import { S, $, $$, esc, fmt, api, indexData, setMe, icon, cardFace, toast, sfx, packHTML } from './core.js';
import { viewShop, viewBinder, viewAchievements, viewLeaderboard, renderStatus, tickShop } from './views.js';

const app = $('#app');
try { S.muted = localStorage.getItem('bc-muted') === '1'; } catch {}

// Bords dentelés des boosters (générés une fois)
(function zigzag() {
  const n = 22, h = 1.6, pts = [];
  for (let i = 0; i <= n; i++) pts.push(`${(i / n) * 100}% ${i % 2 ? h : 0}%`);
  for (let i = n; i >= 0; i--) pts.push(`${(i / n) * 100}% ${100 - (i % 2 ? h : 0)}%`);
  document.documentElement.style.setProperty('--zig', `polygon(${pts.join(',')})`);
})();

async function boot() {
  try {
    indexData(await api('/data'));
  } catch (e) {
    app.innerHTML = `<div class="fatal panel"><h2>Impossible de charger le jeu</h2><p>${esc(e.message)}</p><button class="btn gold" onclick="location.reload()">Réessayer</button></div>`;
    return;
  }
  try {
    const r = await api('/me');
    S.coll = r.collection;
    setMe(r.user);
    renderShell();
  } catch (e) {
    if (e.status === 401) renderAuth();
    else app.innerHTML = `<div class="fatal panel"><h2>Serveur injoignable</h2><p>${esc(e.message)}</p><button class="btn gold" onclick="location.reload()">Réessayer</button></div>`;
  }
}

// ═════════════ CONNEXION / INSCRIPTION ═════════════
function renderAuth() {
  document.body.classList.add('auth-mode');
  const showcase = S.cards.filter(c => ['SIR', 'IR', 'HYR', 'MHR', 'SR', 'UR'].includes(c.tier));
  const pick = Array.from({ length: 14 }, () => showcase[Math.floor(Math.random() * showcase.length)]).filter(Boolean);
  const heroSet = S.sets[Math.floor(Math.random() * S.sets.length)];
  app.innerHTML = `
    <div class="auth">
      <div class="auth-float">${pick.map((c, i) => `<div class="float-card" style="--i:${i};--x:${(i * 37) % 100};--dur:${18 + (i % 5) * 4}s;--delay:${-i * 2.3}s">${cardFace(c, { q: 'low' })}</div>`).join('')}</div>
      <div class="auth-hero">
        <div class="auth-pack">${packHTML(heroSet)}</div>
        <div>
          <h1 class="logo-big">Booster<br><span>Club</span></h1>
          <p class="tagline">Ouvre des boosters, complète ton classeur et montre tes plus belles cartes à tes potes.</p>
          <ul class="auth-feats">
            <li>${icon('pack')} ${S.sets.length} extensions, ${fmt(S.cards.length)} vraies cartes</li>
            <li>${icon('gift')} Un booster gratuit toutes les ${Math.round(S.economy.freePackCooldownMs / 3600e3)} h</li>
            <li>${icon('podium')} Classement entre amis</li>
          </ul>
        </div>
      </div>
      <form class="auth-box panel" id="auth-form" autocomplete="on">
        <div class="tabs2">
          <button type="button" class="on" data-mode="login">Connexion</button>
          <button type="button" data-mode="register">Créer un compte</button>
        </div>
        <label>Pseudo<input name="username" required minlength="3" maxlength="20" autocomplete="username" placeholder="Ton pseudo"></label>
        <label>Mot de passe<input name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="••••••"></label>
        <p class="auth-err" id="auth-err"></p>
        <button class="btn gold big full" type="submit" id="auth-submit">Se connecter</button>
        <p class="muted small center" id="auth-note">Pas encore de compte ? Crée-le en 5 secondes, tu commences avec ₽1 000.</p>
      </form>
    </div>
    <footer class="fan-note">Fangame non officiel et non commercial. Pokémon et les cartes Pokémon appartiennent à Nintendo, Creatures Inc. et GAME FREAK. Images et données : TCGdex.</footer>`;
  let mode = 'login';
  const form = $('#auth-form');
  $$('.tabs2 button').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$('.tabs2 button').forEach(x => x.classList.toggle('on', x === b));
    $('#auth-submit').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
    form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-note').textContent = mode === 'login' ? 'Pas encore de compte ? Crée-le en 5 secondes, tu commences avec ₽1 000.' : 'Pseudo : lettres, chiffres, _ ou -. Mot de passe : 6 caractères minimum.';
    $('#auth-err').textContent = '';
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#auth-submit');
    btn.disabled = true;
    $('#auth-err').textContent = '';
    try {
      const r = await api(mode === 'login' ? '/login' : '/register', { username: form.username.value, password: form.password.value });
      setMe(r.user);
      const me = await api('/me');
      S.coll = me.collection;
      document.body.classList.remove('auth-mode');
      renderShell();
      if (mode === 'register') toast('Tu as <b class="gold">₽1 000</b> et un booster gratuit qui t\'attend !', 'success', { title: `Bienvenue ${esc(r.user.username)} !`, timeout: 6000 });
    } catch (err) {
      $('#auth-err').textContent = err.message;
      btn.disabled = false;
    }
  };
}

// ═════════════ STRUCTURE DE L'APPLI ═════════════
const NAV = [
  ['boutique', 'Boutique', 'pack'],
  ['classeur', 'Classeur', 'book'],
  ['succes', 'Succès', 'trophy'],
  ['classement', 'Classement', 'podium'],
];

function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <a class="logo" href="#/boutique"><span class="logo-mark"></span><span>Booster<b>Club</b></span></a>
      <nav class="nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${icon(i)}<span>${l}</span></a>`).join('')}</nav>
      <div class="top-right">
        <div class="coins" id="coins" title="Pokédollars"><i class="pd">₽</i><span id="coins-val">${fmt(S.me.coins)}</span></div>
        <button class="icon-btn" id="mute" title="Son">${icon(S.muted ? 'mute' : 'sound')}</button>
        <div class="user-chip">${icon('user')}<span>${esc(S.me.username)}</span></div>
        <button class="icon-btn" id="logout" title="Se déconnecter">${icon('logout')}</button>
      </div>
    </header>
    <main id="view" class="view"></main>
    <footer class="fan-note">Fangame non officiel et non commercial, fait pour s'amuser. Pokémon et les cartes Pokémon appartiennent à Nintendo, Creatures Inc. et GAME FREAK. Images et données des cartes : <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a>.</footer>`;
  $('#mute').onclick = () => {
    S.muted = !S.muted;
    try { localStorage.setItem('bc-muted', S.muted ? '1' : '0'); } catch {}
    $('#mute').innerHTML = icon(S.muted ? 'mute' : 'sound');
    if (!S.muted) sfx.click();
  };
  $('#logout').onclick = async () => {
    try { await api('/logout', {}); } catch {}
    location.hash = '';
    renderAuth();
  };
  route();
}

let lastRoute = '';
function route() {
  if (!S.me || !$('#view')) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const page = parts[0] || 'boutique';
  const key = location.hash;
  const navKey = page === 'joueur' ? 'classement' : page;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  const scrollTop = key === lastRoute ? scrollY : 0;
  lastRoute = key;
  const done = () => requestAnimationFrame(() => scrollTo(0, scrollTop));
  switch (page) {
    case 'classeur': viewBinder(parts[1] || lastSet()).then(done); break;
    case 'succes': viewAchievements().then(done); break;
    case 'classement': viewLeaderboard().then(done); break;
    case 'joueur': viewBinder(parts[2] || S.sets[0].id, parts[1]).then(done); break;
    default: viewShop().then(done);
  }
  if (page === 'classeur' && parts[1]) try { localStorage.setItem('bc-last-set', parts[1]); } catch {}
}
function lastSet() {
  try { return localStorage.getItem('bc-last-set') || S.sets[0].id; } catch { return S.sets[0].id; }
}

addEventListener('hashchange', route);
addEventListener('bc:refresh', () => route());

// Tic chaque seconde : compte à rebours du booster gratuit
setInterval(() => { if (S.me) tickShop(); }, 1000);

// Rafraîchit l'état (bonus du jour, booster gratuit) quand on revient sur l'onglet
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.me || $('.opening')) return;
  try {
    const r = await api('/me');
    S.coll = r.collection;
    setMe(r.user);
    renderStatus();
  } catch {}
});

boot();
