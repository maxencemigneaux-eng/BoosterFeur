// Booster Club — serveur du jeu
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { db, db_kind, migrate, one, all, run } from './db.js';
import {
  ECONOMY, TIERS, ACHIEVEMENTS, loadData, rollPack, isFeedWorthy,
  computeStats, achievementProgress, newlyEarned, today,
} from './game.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const LOG_FILE = path.join(ROOT, 'erreurs.log');

// Toute erreur est affichée ET écrite dans erreurs.log (pratique pour comprendre un plantage)
function logError(where, err) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${where} : ${err?.stack || err}\n`;
  console.error(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}
process.on('uncaughtException', (e) => logError('Erreur inattendue', e));
process.on('unhandledRejection', (e) => logError('Promesse rejetée', e));
const SESSION_DAYS = 30;
const COOKIE = 'bc_session';

const data = loadData();
await migrate();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ───────────── Données du jeu (servies une fois, compressées) ─────────────
const gameDataJson = JSON.stringify({
  tiers: TIERS,
  sets: data.sets,
  cards: data.cards,
  economy: { freePackCooldownMs: ECONOMY.freePackCooldownMs, godPackChance: ECONOMY.godPackChance },
});
const gameDataGz = zlib.gzipSync(gameDataJson);
const gameDataEtag = '"' + crypto.createHash('sha1').update(gameDataJson).digest('hex').slice(0, 16) + '"';
app.get('/api/data', (req, res) => {
  res.setHeader('ETag', gameDataEtag);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === gameDataEtag) return res.status(304).end();
  res.type('application/json');
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    return res.end(gameDataGz);
  }
  res.end(gameDataJson);
});

// ───────────── Sessions ─────────────
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

async function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400e3;
  await run('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)', [token, userId, expires]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_DAYS * 86400e3, path: '/',
  });
}

async function auth(req, res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'Non connecté' });
    const row = await one(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?',
      [token, Date.now()]
    );
    if (!row) return res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
    req.user = row;
    req.token = token;
    next();
  } catch (e) { next(e); }
}

// Petit anti-bruteforce en mémoire
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, reset: now + 15 * 60e3 };
  if (now > a.reset) { a.n = 0; a.reset = now + 15 * 60e3; }
  a.n++;
  attempts.set(key, a);
  if (a.n > 30) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes' });
  next();
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ───────────── Helpers joueur ─────────────
async function getCollection(userId) {
  const rows = await all('SELECT card_id, qty FROM collection WHERE user_id = ? AND qty > 0', [userId]);
  const coll = {};
  for (const r of rows) coll[r.card_id] = Number(r.qty);
  return coll;
}

async function getUnlocked(userId) {
  const rows = await all('SELECT ach_id, at FROM achievements WHERE user_id = ?', [userId]);
  return Object.fromEntries(rows.map(r => [r.ach_id, Number(r.at)]));
}

// Vérifie les succès, crédite les récompenses, renvoie les nouveaux succès
async function checkAchievements(userId) {
  const user = await one('SELECT * FROM users WHERE id = ?', [userId]);
  const [coll, unlocked] = await Promise.all([getCollection(userId), getUnlocked(userId)]);
  const stats = computeStats(user, coll, data);
  const earned = newlyEarned(stats, unlocked);
  if (!earned.length) return [];
  const now = Date.now();
  const granted = [];
  for (const a of earned) {
    const r = await run('INSERT OR IGNORE INTO achievements (user_id, ach_id, at) VALUES (?, ?, ?)', [userId, a.id, now]);
    if (r.rowsAffected) {
      await run('UPDATE users SET coins = coins + ? WHERE id = ?', [a.reward, userId]);
      granted.push({ id: a.id, name: a.name, desc: a.desc, reward: a.reward, icon: a.icon });
    }
  }
  return granted;
}

function publicUser(u) {
  const now = Date.now();
  const nextStreak = u.last_daily === today(-1) ? Number(u.streak) + 1 : 1;
  return {
    id: Number(u.id),
    username: u.username,
    coins: Number(u.coins),
    streak: Number(u.streak),
    dailyAvailable: u.last_daily !== today(),
    dailyReward: dailyReward(nextStreak),
    nextStreak,
    freePackAt: Number(u.last_free) + ECONOMY.freePackCooldownMs,
    serverNow: now,
    packsOpened: Number(u.packs_opened),
  };
}

function dailyReward(streakDay) {
  const d = Math.min(streakDay, ECONOMY.dailyMaxStreak);
  return ECONOMY.dailyBase + ECONOMY.dailyPerStreakDay * (d - 1);
}

// ───────────── Comptes ─────────────
app.post('/api/register', rateLimit, wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_\-]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères (lettres, chiffres, _ ou -)' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  if (await one('SELECT id FROM users WHERE username = ?', [username]))
    return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
  const hash = await bcrypt.hash(password, 10);
  const r = await run(
    'INSERT INTO users (username, pass_hash, coins, created_at) VALUES (?, ?, ?, ?)',
    [username, hash, ECONOMY.startCoins, Date.now()]
  );
  await createSession(res, req, Number(r.lastInsertRowid));
  const user = await one('SELECT * FROM users WHERE id = ?', [Number(r.lastInsertRowid)]);
  res.json({ user: publicUser(user) });
}));

app.post('/api/login', rateLimit, wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = await one('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !(await bcrypt.compare(password, user.pass_hash)))
    return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
  await createSession(res, req, Number(user.id));
  res.json({ user: publicUser(user) });
}));

app.post('/api/logout', wrap(async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await run('DELETE FROM sessions WHERE token = ?', [token]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const coll = await getCollection(req.user.id);
  res.json({ user: publicUser(req.user), collection: coll });
}));

// ───────────── Bonus quotidien ─────────────
app.post('/api/daily', auth, wrap(async (req, res) => {
  const u = req.user;
  const t = today();
  if (u.last_daily === t) return res.status(400).json({ error: 'Bonus déjà récupéré aujourd\'hui, reviens demain !' });
  const streak = u.last_daily === today(-1) ? Number(u.streak) + 1 : 1;
  const reward = dailyReward(streak);
  const r = await run(
    `UPDATE users SET coins = coins + ?, last_daily = ?, streak = ?, best_streak = MAX(best_streak, ?)
     WHERE id = ? AND (last_daily IS NULL OR last_daily != ?)`,
    [reward, t, streak, streak, u.id, t]
  );
  if (!r.rowsAffected) return res.status(400).json({ error: 'Bonus déjà récupéré' });
  const achievements = await checkAchievements(u.id);
  const user = await one('SELECT * FROM users WHERE id = ?', [u.id]);
  res.json({ reward, streak, user: publicUser(user), achievements });
}));

// ───────────── Ouvrir un booster ─────────────
app.post('/api/open', auth, wrap(async (req, res) => {
  const u = req.user;
  const set = data.setById.get(String(req.body.setId));
  if (!set) return res.status(400).json({ error: 'Extension inconnue' });
  const free = !!req.body.free;
  const now = Date.now();

  if (free) {
    const r = await run(
      'UPDATE users SET last_free = ? WHERE id = ? AND last_free = ? AND last_free + ? <= ?',
      [now, u.id, u.last_free, ECONOMY.freePackCooldownMs, now]
    );
    if (!r.rowsAffected) return res.status(400).json({ error: 'Ton booster gratuit n\'est pas encore prêt' });
  } else {
    const r = await run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', [set.price, u.id, set.price]);
    if (!r.rowsAffected) return res.status(400).json({ error: 'Pas assez de Pokédollars !' });
  }

  const { cards, god } = rollPack(data, set.id);
  const ids = cards.map(c => c.id);
  const ownedRows = await all(
    `SELECT card_id FROM collection WHERE user_id = ? AND qty > 0 AND card_id IN (${ids.map(() => '?').join(',')})`,
    [u.id, ...ids]
  );
  const alreadyOwned = new Set(ownedRows.map(r => r.card_id));

  const stmts = cards.map(c => ({
    sql: `INSERT INTO collection (user_id, card_id, qty, first_at) VALUES (?, ?, 1, ?)
          ON CONFLICT(user_id, card_id) DO UPDATE SET qty = qty + 1`,
    args: [u.id, c.id, now],
  }));
  stmts.push({ sql: 'UPDATE users SET packs_opened = packs_opened + 1, god_packs = god_packs + ? WHERE id = ?', args: [god ? 1 : 0, u.id] });
  for (const c of cards) {
    if (isFeedWorthy(data.byId.get(c.id), data))
      stmts.push({ sql: 'INSERT INTO pulls (user_id, card_id, at) VALUES (?, ?, ?)', args: [u.id, c.id, now] });
  }
  await db.batch(stmts, 'write');

  const seen = new Set();
  const result = cards.map(c => {
    const isNew = !alreadyOwned.has(c.id) && !seen.has(c.id);
    seen.add(c.id);
    return { id: c.id, rev: c.rev, isNew };
  });
  const achievements = await checkAchievements(u.id);
  const user = await one('SELECT * FROM users WHERE id = ?', [u.id]);
  res.json({ cards: result, god, free, user: publicUser(user), achievements });
}));

// ───────────── Vendre des doublons ─────────────
// body: { cardId, qty }  ou  { setId }  (tous les doublons d'une extension, "all" = tout)
app.post('/api/sell', auth, wrap(async (req, res) => {
  const u = req.user;
  // Transaction : lecture + vente atomiques (impossible de vendre deux fois la même carte)
  const tx = await db.transaction('write');
  let earned = 0, count = 0;
  try {
    const rows = (await tx.execute({ sql: 'SELECT card_id, qty FROM collection WHERE user_id = ? AND qty > 1', args: [u.id] })).rows;
    const coll = Object.fromEntries(rows.map(r => [r.card_id, Number(r.qty)]));
    const toSell = [];
    if (req.body.cardId) {
      const id = String(req.body.cardId);
      const max = (coll[id] || 0) - 1;
      if (!data.byId.has(id) || max < 1) { await tx.rollback(); return res.status(400).json({ error: 'Pas de doublon à vendre' }); }
      toSell.push([id, Math.min(Math.max(1, parseInt(req.body.qty, 10) || 1), max)]);
    } else {
      const setId = String(req.body.setId || 'all');
      for (const [id, q] of Object.entries(coll)) {
        const card = data.byId.get(id);
        if (!card || (setId !== 'all' && card.set !== setId)) continue;
        toSell.push([id, q - 1]);
      }
      if (!toSell.length) { await tx.rollback(); return res.status(400).json({ error: 'Aucun doublon à vendre' }); }
    }
    for (const [id, qty] of toSell) {
      earned += TIERS[data.byId.get(id).tier].value * qty;
      count += qty;
    }
    await tx.batch([
      ...toSell.map(([id, qty]) => ({ sql: 'UPDATE collection SET qty = qty - ? WHERE user_id = ? AND card_id = ?', args: [qty, u.id, id] })),
      { sql: 'UPDATE users SET coins = coins + ?, cards_sold = cards_sold + ? WHERE id = ?', args: [earned, count, u.id] },
    ]);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  } finally {
    tx.close();
  }
  const achievements = await checkAchievements(u.id);
  const user = await one('SELECT * FROM users WHERE id = ?', [u.id]);
  res.json({ earned, count, user: publicUser(user), collection: await getCollection(u.id), achievements });
}));

// ───────────── Succès ─────────────
app.get('/api/achievements', auth, wrap(async (req, res) => {
  const [coll, unlocked] = await Promise.all([getCollection(req.user.id), getUnlocked(req.user.id)]);
  const stats = computeStats(req.user, coll, data);
  res.json({ achievements: achievementProgress(stats, unlocked) });
}));

// ───────────── Classement & profils ─────────────
app.get('/api/leaderboard', auth, wrap(async (req, res) => {
  const users = await all('SELECT * FROM users ORDER BY id');
  const rows = await all('SELECT user_id, card_id, qty FROM collection WHERE qty > 0');
  const colls = {};
  for (const r of rows) (colls[r.user_id] ||= {})[r.card_id] = Number(r.qty);
  const achRows = await all('SELECT user_id, COUNT(*) AS n FROM achievements GROUP BY user_id');
  const achCount = Object.fromEntries(achRows.map(r => [r.user_id, Number(r.n)]));
  const board = users.map(u => {
    const s = computeStats(u, colls[u.id] || {}, data);
    return {
      username: u.username, unique: s.unique, total: s.total, value: s.value, packs: Number(u.packs_opened),
      setsDone: s.setsDone, best: s.best, achievements: achCount[u.id] || 0, me: u.id === req.user.id,
    };
  }).sort((a, b) => b.value - a.value || b.unique - a.unique);
  res.json({ board, achievementsTotal: ACHIEVEMENTS.length });
}));

app.get('/api/players/:username', auth, wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE username = ?', [String(req.params.username)]);
  if (!u) return res.status(404).json({ error: 'Joueur introuvable' });
  const coll = await getCollection(u.id);
  const s = computeStats(u, coll, data);
  res.json({ username: u.username, collection: coll, unique: s.unique, value: s.value, packs: Number(u.packs_opened) });
}));

app.get('/api/feed', auth, wrap(async (req, res) => {
  const rows = await all(
    'SELECT p.card_id, p.at, u.username FROM pulls p JOIN users u ON u.id = p.user_id ORDER BY p.at DESC, p.id DESC LIMIT 24'
  );
  res.json({ feed: rows.map(r => ({ cardId: r.card_id, at: Number(r.at), username: r.username })) });
}));

// ───────────── Front-end ─────────────
app.use(express.static(path.join(ROOT, 'public'), {
  extensions: ['html'],
  // Polices : en cache 7 jours. Le reste est revalidé à chaque visite (les mises à jour sont prises tout de suite)
  setHeaders: (res, file) => res.setHeader('Cache-Control', file.endsWith('.woff2') ? 'public, max-age=604800' : 'no-cache'),
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.use((err, req, res, _next) => {
  logError(`${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'Erreur serveur, réessaie' });
});

// Nettoyage des sessions expirées
setInterval(() => run('DELETE FROM sessions WHERE expires < ?', [Date.now()]).catch(() => {}), 3600e3).unref();

// Démarrage : si le port est pris (jeu déjà lancé ou autre appli), on essaie le suivant
function start(port, tries = 0) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Booster Club lancé → ${url}`);
    console.log(`  ${data.sets.length} extensions, ${data.cards.length} cartes`);
    console.log(`  Base de données : ${db_kind}`);
    if (process.env.OPEN_BROWSER) {
      console.log('\n  /!\\  Laisse cette fenêtre ouverte pendant que tu joues : si tu la fermes, le jeu s\'arrête.\n');
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && !process.env.PORT && tries < 10) {
      console.log(`  Le port ${port} est déjà utilisé, essai sur ${port + 1}…`);
      return start(port + 1, tries + 1);
    }
    logError('Démarrage du serveur', e);
    process.exit(1);
  });
}
start(PORT);
