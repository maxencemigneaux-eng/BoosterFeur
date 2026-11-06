// Génère data/cards.json à partir de la base open-source TCGdex (github.com/tcgdex/cards-database).
//
// Utilisation :
//   git clone --depth 1 https://github.com/tcgdex/cards-database.git ../cards-database
//   npm run build-data                       (ou : node scripts/build-data.mjs <chemin-vers-cards-database>)
//
// Les extensions à inclure sont listées dans data/sets-config.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.resolve(process.argv[2] || process.env.TCGDEX_DB || path.join(ROOT, '..', 'cards-database'));
const DATA = path.join(DB, 'data');

if (!fs.existsSync(DATA)) {
  console.error(`Dossier introuvable : ${DATA}\nClone d'abord : git clone --depth 1 https://github.com/tcgdex/cards-database.git`);
  process.exit(1);
}

// Lit un fichier .ts de TCGdex (un objet littéral) SANS l'exécuter :
// petit analyseur qui ne comprend que les valeurs littérales (objets, tableaux,
// chaînes, nombres, booléens). Les références à d'autres variables valent null.
function loadTs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /const\s+\w+\s*(?::\s*[\w.]+)?\s*=\s*\{/.exec(src);
  if (!m) throw new Error('objet introuvable');
  let i = m.index + m[0].length - 1;

  const err = (msg) => { throw new Error(`${msg} (position ${i})`); };
  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      break;
    }
  };
  const readString = () => {
    const q = src[i++]; let s = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        const n = src[i + 1];
        const map = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', '`': '`' };
        if (n === 'u') { s += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 6; continue; }
        s += map[n] ?? n; i += 2; continue;
      }
      s += src[i++];
    }
    i++; return s;
  };
  const readIdent = () => { const s = i; while (i < src.length && /[\w$.]/.test(src[i])) i++; return src.slice(s, i); };
  const value = () => {
    skip();
    const ch = src[i];
    if (ch === '{') {
      i++; const o = {};
      for (;;) {
        skip();
        if (src[i] === '}') { i++; return o; }
        const key = (src[i] === '"' || src[i] === "'") ? readString() : readIdent();
        if (!key) err('clé invalide');
        skip();
        if (src[i] === ':') { i++; o[key] = value(); } else o[key] = null;
        skip();
        if (src[i] === ',') i++;
        else if (src[i] !== '}') err('virgule attendue');
      }
    }
    if (ch === '[') {
      i++; const a = [];
      for (;;) {
        skip();
        if (src[i] === ']') { i++; return a; }
        a.push(value()); skip();
        if (src[i] === ',') i++;
        else if (src[i] !== ']') err('virgule attendue');
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') return readString();
    if (/[-\d.]/.test(ch)) { const s = i; i++; while (/[\d.eE+-]/.test(src[i])) i++; return Number(src.slice(s, i)); }
    const id = readIdent();
    if (!id) err('valeur inattendue');
    if (id === 'true') return true;
    if (id === 'false') return false;
    return null; // null, undefined ou référence (Set, serie...)
  };
  return value();
}

// Raretés TCGdex -> palier de jeu
const TIER_OF = {
  'Common': 'C',
  'Uncommon': 'U',
  'Rare': 'R',
  'Holo Rare': 'HOLO',
  'Holo Rare V': 'DR',
  'Double rare': 'DR',
  'Holo Rare VMAX': 'VMAX',
  'ACE SPEC Rare': 'ACE',
  'Illustration rare': 'IR',
  'Ultra Rare': 'UR',
  'Special illustration rare': 'SIR',
  'Secret Rare': 'SR',
  'Hyper rare': 'HYR',
  'Mega Hyper Rare': 'MHR',
};

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sets-config.json'), 'utf8'));
const out = { generatedAt: new Date().toISOString(), sets: [], cards: [] };
const unknownRarities = new Set();

for (const cfg of config.sets) {
  const setDir = path.join(DATA, cfg.folder);
  const setFile = setDir + '.ts';
  const serieFile = path.join(DATA, cfg.folder.split('/')[0] + '.ts');
  const set = loadTs(setFile);
  const serie = loadTs(serieFile);
  if (set.id !== cfg.id) console.warn(`⚠ id différent pour ${cfg.folder} : ${set.id} (config : ${cfg.id})`);

  const files = fs.readdirSync(setDir).filter(f => f.endsWith('.ts'));
  let count = 0;
  for (const f of files) {
    const localId = f.replace(/\.ts$/, '');
    let c;
    try { c = loadTs(path.join(setDir, f)); }
    catch (e) { console.warn(`  ✗ ${cfg.folder}/${f} : ${e.message}`); continue; }

    let tier = TIER_OF[c.rarity];
    if (!tier) { unknownRarities.add(c.rarity); tier = 'C'; }
    const variants = Array.isArray(c.variants) ? c.variants.map(v => v.type) : [];
    // Époque Wizards : les rares holo sont notées "Rare" avec la variante holo
    if (serie.id === 'base' && tier === 'R' && variants.includes('holo') && !variants.includes('normal')) tier = 'HOLO';

    out.cards.push({
      id: `${set.id}-${localId}`,
      set: set.id,
      localId,
      num: parseInt(localId, 10) || 0,
      name: c.name?.fr || c.name?.en || localId,
      nameEn: c.name?.en || '',
      rarity: c.rarity || 'None',
      tier,
      category: c.category || '',
      hp: c.hp || null,
      types: c.types || [],
      stage: c.stage || '',
      dexId: c.dexId || [],
      illustrator: c.illustrator || '',
      img: `${serie.id}/${set.id}/${localId}`,
    });
    count++;
  }

  out.sets.push({
    id: set.id,
    name: set.name?.fr || set.name?.en,
    nameEn: set.name?.en,
    serie: serie.id,
    serieName: serie.name?.fr || serie.name?.en,
    releaseDate: set.releaseDate,
    official: set.cardCount?.official || count,
    total: count,
    abbr: set.abbreviations?.fr || set.abbreviations?.official || '',
  });
  console.log(`✓ ${set.name?.fr || set.name?.en} (${set.id}) : ${count} cartes`);
}

out.cards.sort((a, b) => a.set.localeCompare(b.set) || a.num - b.num || a.localId.localeCompare(b.localId));
if (unknownRarities.size) console.warn('Raretés inconnues (classées Commune) :', [...unknownRarities]);

fs.writeFileSync(path.join(ROOT, 'data', 'cards.json'), JSON.stringify(out));
console.log(`\n${out.cards.length} cartes écrites dans data/cards.json`);
