// Règles du jeu : raretés, composition des boosters, économie et succès.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ───────────── Économie ─────────────
export const ECONOMY = {
  startCoins: 1000,              // Pokédollars à l'inscription
  freePackCooldownMs: 8 * 3600e3, // un booster gratuit toutes les 8 h
  dailyBase: 300,                 // bonus quotidien jour 1
  dailyPerStreakDay: 50,          // +50 par jour de série (plafonné à 7 jours)
  dailyMaxStreak: 7,
  godPackChance: 1 / 400,         // "booster divin" : que des cartes rares
  timezone: 'Europe/Paris',
};

// ───────────── Raretés (paliers) ─────────────
// value = prix de revente d'un doublon
export const TIERS = {
  C:    { name: 'Commune',                    rank: 0,  value: 2,   color: '#a3acb9' },
  U:    { name: 'Peu commune',                rank: 1,  value: 4,   color: '#60a5fa' },
  R:    { name: 'Rare',                       rank: 2,  value: 10,  color: '#34d399' },
  HOLO: { name: 'Rare Holo',                  rank: 3,  value: 20,  color: '#22d3ee' },
  DR:   { name: 'Double Rare',                rank: 4,  value: 30,  color: '#a78bfa' },
  ACE:  { name: 'Rare ACE SPEC',              rank: 5,  value: 40,  color: '#f472b6' },
  VMAX: { name: 'Rare Holo VMAX',             rank: 5,  value: 45,  color: '#c084fc' },
  IR:   { name: 'Illustration Rare',          rank: 6,  value: 50,  color: '#fb923c' },
  UR:   { name: 'Ultra Rare',                 rank: 7,  value: 70,  color: '#facc15' },
  SR:   { name: 'Rare Secrète',               rank: 8,  value: 160, color: '#fbbf24' },
  SIR:  { name: 'Illustration Spéciale Rare', rank: 9,  value: 200, color: '#f43f5e' },
  HYR:  { name: 'Hyper Rare',                 rank: 10, value: 250, color: '#fde047' },
  MHR:  { name: 'Méga Hyper Rare',            rank: 11, value: 500, color: '#e879f9' },
};

const RARITY_FR = {
  'Common': 'Commune', 'Uncommon': 'Peu commune', 'Rare': 'Rare', 'Holo Rare': 'Rare Holo',
  'Holo Rare V': 'Rare Holo V', 'Holo Rare VMAX': 'Rare Holo VMAX', 'Double rare': 'Double Rare',
  'ACE SPEC Rare': 'Rare ACE SPEC', 'Illustration rare': 'Illustration Rare', 'Ultra Rare': 'Ultra Rare',
  'Special illustration rare': 'Illustration Spéciale Rare', 'Secret Rare': 'Rare Secrète',
  'Hyper rare': 'Hyper Rare', 'Mega Hyper Rare': 'Méga Hyper Rare',
};

// ───────────── Composition des boosters ─────────────
// Chaque emplacement = tirage pondéré parmi des paliers. rev = effet "reverse holo".
const C = { pick: { C: 1 } }, U = { pick: { U: 1 } };
const TEMPLATES = {
  // Époque Wizards (1999) : 11 cartes, 1 rare holo sur 3 boosters
  wotc: [C, C, C, C, C, C, C, U, U, U, { pick: { R: 2, HOLO: 1 } }],
  // Épée et Bouclier : 10 cartes
  swsh: [C, C, C, C, C, U, U, U,
    { rev: true, pick: { C: 55, U: 33, R: 8, HOLO: 4 } },
    { pick: { R: 50, HOLO: 22, DR: 14, VMAX: 6, UR: 5, SR: 3 } }],
  // Écarlate et Violet : 10 cartes, 2 reverse dont une peut être une Illustration Rare
  sv: [C, C, C, C, U, U, U,
    { rev: true, pick: { C: 55, U: 33, R: 12 } },
    { rev: true, pick: { C: 45, U: 30, R: 12, ACE: 5, IR: 9, SIR: 3 } },
    { pick: { R: 72, DR: 19, UR: 6.5, HYR: 2.5 } }],
  // Méga-Évolution : comme EV, avec les Méga Hyper Rares
  me: [C, C, C, C, U, U, U,
    { rev: true, pick: { C: 55, U: 33, R: 12 } },
    { rev: true, pick: { C: 45, U: 30, R: 12, IR: 9, SIR: 3 } },
    { pick: { R: 72, DR: 19, UR: 6.5, MHR: 0.7 } }],
};
const GOD_SLOT = { pick: { IR: 6, UR: 3, SR: 3, SIR: 3, HYR: 1, MHR: 0.5, HOLO: 2 } };

// ───────────── Données des cartes ─────────────
export function loadData() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cards.json'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sets-config.json'), 'utf8'));
  const sets = [];
  for (const c of cfg.sets) {
    const meta = raw.sets.find(s => s.id === c.id);
    if (!meta) { console.warn(`Extension ${c.id} absente de cards.json (lance npm run build-data)`); continue; }
    sets.push({ ...meta, price: c.price, template: c.template, colors: c.colors });
  }
  const setIds = new Set(sets.map(s => s.id));
  const cards = raw.cards.filter(c => setIds.has(c.set)).map(c => ({
    id: c.id, set: c.set, localId: c.localId, num: c.num, name: c.name, nameEn: c.nameEn,
    rarity: c.tier === 'HOLO' && c.rarity === 'Rare' ? 'Rare Holo' : (RARITY_FR[c.rarity] || TIERS[c.tier].name),
    tier: c.tier, category: c.category, hp: c.hp, types: c.types, illustrator: c.illustrator, img: c.img,
  }));
  const byId = new Map(cards.map(c => [c.id, c]));
  const bySet = new Map(sets.map(s => [s.id, cards.filter(c => c.set === s.id)]));
  const pools = new Map(); // set -> tier -> [cards]
  for (const s of sets) {
    const p = {};
    for (const c of bySet.get(s.id)) (p[c.tier] ||= []).push(c);
    pools.set(s.id, p);
  }
  return { sets, cards, byId, bySet, pools, setById: new Map(sets.map(s => [s.id, s])) };
}

const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

function weightedTier(weights, pool) {
  const entries = Object.entries(weights).filter(([t]) => pool[t]?.length);
  if (!entries.length) return pool.C ? 'C' : Object.keys(pool)[0];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [t, w] of entries) { if ((r -= w) < 0) return t; }
  return entries[entries.length - 1][0];
}

// Tire le contenu d'un booster. Renvoie [{ id, rev }] trié de la moins rare à la plus rare.
export function rollPack(data, setId) {
  const set = data.setById.get(setId);
  const pool = data.pools.get(setId);
  let slots = TEMPLATES[set.template] || TEMPLATES.sv;
  const god = set.template !== 'wotc' && rand() < ECONOMY.godPackChance;
  if (god) slots = slots.map((s, i) => (i >= slots.length - 3 ? GOD_SLOT : s));
  const taken = new Set();
  const out = [];
  for (const slot of slots) {
    const tier = weightedTier(slot.pick, pool);
    const list = pool[tier];
    let card;
    for (let tries = 0; tries < 8; tries++) {
      card = list[Math.floor(rand() * list.length)];
      if (!taken.has(card.id)) break;
    }
    taken.add(card.id);
    out.push({ id: card.id, rev: !!slot.rev && TIERS[tier].rank <= 3 });
  }
  const rank = (p) => TIERS[data.byId.get(p.id).tier].rank;
  out.sort((a, b) => rank(a) - rank(b) || (a.rev - b.rev));
  return { cards: out, god };
}

// Cartes assez rares pour apparaître dans le fil "Derniers gros tirages"
export function isFeedWorthy(card, data) {
  const r = TIERS[card.tier].rank;
  return r >= 6 || (card.tier === 'HOLO' && data.setById.get(card.set)?.serie === 'base');
}

// ───────────── Succès ─────────────
// stat(s) renvoie la progression actuelle, goal = objectif.
const hasTier = (...tiers) => (s) => (tiers.some(t => s.tiers.has(t)) ? 1 : 0);
export const ACHIEVEMENTS = [
  { id: 'packs_1',    icon: 'pack',   name: 'Premier booster',        desc: 'Ouvre ton tout premier booster.',                 reward: 100,  goal: 1,    stat: s => s.packs },
  { id: 'packs_10',   icon: 'pack',   name: 'Ça devient sérieux',     desc: 'Ouvre 10 boosters.',                              reward: 250,  goal: 10,   stat: s => s.packs },
  { id: 'packs_50',   icon: 'pack',   name: 'Déchireur pro',          desc: 'Ouvre 50 boosters.',                              reward: 600,  goal: 50,   stat: s => s.packs },
  { id: 'packs_100',  icon: 'pack',   name: 'Centurion',              desc: 'Ouvre 100 boosters.',                             reward: 1200, goal: 100,  stat: s => s.packs },
  { id: 'packs_250',  icon: 'pack',   name: 'Usine à boosters',       desc: 'Ouvre 250 boosters.',                             reward: 3000, goal: 250,  stat: s => s.packs },
  { id: 'unique_50',  icon: 'cards',  name: 'Collectionneur en herbe', desc: 'Possède 50 cartes différentes.',                 reward: 150,  goal: 50,   stat: s => s.unique },
  { id: 'unique_200', icon: 'cards',  name: 'Collectionneur confirmé', desc: 'Possède 200 cartes différentes.',                reward: 500,  goal: 200,  stat: s => s.unique },
  { id: 'unique_500', icon: 'cards',  name: 'Maître collectionneur',  desc: 'Possède 500 cartes différentes.',                 reward: 1500, goal: 500,  stat: s => s.unique },
  { id: 'unique_1000',icon: 'cards',  name: 'Encyclopédie vivante',   desc: 'Possède 1 000 cartes différentes.',               reward: 4000, goal: 1000, stat: s => s.unique },
  { id: 'hit_dr',     icon: 'star',   name: 'Double dose',            desc: 'Obtiens une Double Rare ou une carte V.',         reward: 100,  goal: 1,    stat: hasTier('DR', 'VMAX') },
  { id: 'hit_ir',     icon: 'brush',  name: 'Œuvre d\'art',           desc: 'Obtiens une Illustration Rare.',                  reward: 150,  goal: 1,    stat: hasTier('IR') },
  { id: 'hit_ur',     icon: 'star',   name: 'Ultra classe',           desc: 'Obtiens une Ultra Rare.',                         reward: 250,  goal: 1,    stat: hasTier('UR') },
  { id: 'hit_sir',    icon: 'brush',  name: 'Chef-d\'œuvre',          desc: 'Obtiens une Illustration Spéciale Rare.',         reward: 500,  goal: 1,    stat: hasTier('SIR') },
  { id: 'hit_gold',   icon: 'crown',  name: 'Ruée vers l\'or',        desc: 'Obtiens une Hyper Rare, une Rare Secrète ou une Méga Hyper Rare.', reward: 600, goal: 1, stat: hasTier('HYR', 'SR', 'MHR') },
  { id: 'charizard',  icon: 'flame',  name: 'Le Graal',               desc: 'Obtiens le Dracaufeu holo du Set de Base.',       reward: 1000, goal: 1,    stat: s => (s.owned.has('base1-4') ? 1 : 0) },
  { id: 'pikachu',    icon: 'bolt',   name: 'Pika-fan',               desc: 'Possède 5 cartes Pikachu différentes.',           reward: 300,  goal: 5,    stat: s => s.pikachu },
  { id: 'all_sets',   icon: 'globe',  name: 'Globe-trotter',          desc: 'Possède au moins une carte de chaque extension.', reward: 300,  goal: s => s.setsTotal, stat: s => s.setsTouched },
  { id: 'set_25',     icon: 'book',   name: 'Bon début',              desc: 'Complète 25 % d\'une extension.',                 reward: 200,  goal: 25,   stat: s => s.bestSetPct },
  { id: 'set_50',     icon: 'book',   name: 'À mi-chemin',            desc: 'Complète 50 % d\'une extension.',                 reward: 600,  goal: 50,   stat: s => s.bestSetPct },
  { id: 'set_100',    icon: 'trophy', name: 'Classeur complet',       desc: 'Complète 100 % d\'une extension.',                reward: 5000, goal: 100,  stat: s => s.bestSetPct },
  { id: 'sold_100',   icon: 'coin',   name: 'Revendeur',              desc: 'Vends 100 doublons.',                             reward: 200,  goal: 100,  stat: s => s.sold },
  { id: 'streak_7',   icon: 'calendar', name: 'Fidèle au poste',      desc: 'Récupère le bonus quotidien 7 jours d\'affilée.', reward: 500,  goal: 7,    stat: s => s.bestStreak },
  { id: 'god_pack',   icon: 'sparkle', name: 'Booster divin',         desc: 'Ouvre un booster divin (1 chance sur 400).',      reward: 1000, goal: 1,    stat: s => s.godPacks },
];

// Statistiques d'un joueur à partir de sa collection { cardId: qty }
export function computeStats(user, coll, data) {
  const owned = new Set(Object.keys(coll).filter(id => coll[id] > 0 && data.byId.has(id)));
  const tiers = new Set();
  let total = 0, value = 0, pikachu = 0, best = null;
  const perSet = {};
  for (const id of owned) {
    const c = data.byId.get(id);
    tiers.add(c.tier);
    total += coll[id];
    value += TIERS[c.tier].value;
    if (/pikachu/i.test(c.nameEn)) pikachu++;
    perSet[c.set] = (perSet[c.set] || 0) + 1;
    if (!best || TIERS[c.tier].rank > TIERS[best.tier].rank) best = c;
  }
  let bestSetPct = 0, setsTouched = 0, setsDone = 0;
  for (const s of data.sets) {
    const n = perSet[s.id] || 0;
    if (n) setsTouched++;
    const pct = Math.floor((n / s.total) * 100);
    if (n >= s.total) setsDone++;
    bestSetPct = Math.max(bestSetPct, n >= s.total ? 100 : Math.min(pct, 99));
  }
  return {
    owned, tiers, unique: owned.size, total, value, pikachu, perSet, bestSetPct, setsTouched, setsDone,
    setsTotal: data.sets.length, best: best?.id || null,
    packs: user.packs_opened, sold: user.cards_sold, bestStreak: user.best_streak, godPacks: user.god_packs,
  };
}

const goalOf = (a, stats) => (typeof a.goal === 'function' ? a.goal(stats) : a.goal);

export function achievementProgress(stats, unlocked) {
  return ACHIEVEMENTS.map(a => {
    const goal = goalOf(a, stats);
    return {
      id: a.id, icon: a.icon, name: a.name, desc: a.desc, reward: a.reward, goal,
      progress: Math.min(a.stat(stats), goal),
      unlockedAt: unlocked[a.id] || null,
    };
  });
}

export function newlyEarned(stats, unlocked) {
  return ACHIEVEMENTS.filter(a => !unlocked[a.id] && a.stat(stats) >= goalOf(a, stats));
}

// Date du jour (AAAA-MM-JJ) dans le fuseau du jeu
export function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: ECONOMY.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
