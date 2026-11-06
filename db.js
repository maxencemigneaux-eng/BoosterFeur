// Base de données
//   Sur ton PC : fichier booster-club.db, géré par le SQLite intégré à Node.js
//                (aucun module natif à compiler, fonctionne pareil sur Windows/Mac/Linux)
//   En ligne   : Turso (gratuit) si TURSO_DATABASE_URL et TURSO_AUTH_TOKEN sont définis
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export let db_kind = '';

async function openDatabase() {
  if (process.env.TURSO_DATABASE_URL) {
    const { createClient } = await import('@libsql/client/web');
    db_kind = 'Turso (en ligne)';
    return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  const file = process.env.DATABASE_FILE || path.join(ROOT, 'booster-club.db');
  try {
    const sqlite = await importNodeSqlite();
    db_kind = `fichier local (${path.basename(file)})`;
    return new LocalDb(new sqlite.DatabaseSync(file));
  } catch (e) {
    // Node.js trop ancien (< 22.13) : on se rabat sur le module libsql
    console.log(`  (SQLite intégré indisponible : ${e.message} — utilisation de libsql)`);
    const { createClient } = await import('@libsql/client');
    db_kind = `fichier local via libsql (${path.basename(file)})`;
    return createClient({ url: 'file:' + file });
  }
}

async function importNodeSqlite() {
  // Masque l'avertissement "SQLite is an experimental feature" de Node
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w?.message || w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
  try { return await import('node:sqlite'); }
  finally { setTimeout(() => { process.emitWarning = emit; }, 0); }
}

// Adaptateur : même interface que @libsql/client (execute, batch, transaction)
class LocalDb {
  constructor(sqlite) {
    this.s = sqlite;
    this.s.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.cache = new Map();
    this.lock = null; // transaction en cours
  }
  stmt(sql) {
    let st = this.cache.get(sql);
    if (!st) { st = this.s.prepare(sql); this.cache.set(sql, st); }
    return st;
  }
  run1(q) {
    const sql = typeof q === 'string' ? q : q.sql;
    const args = (typeof q === 'string' ? [] : q.args || []).map(a => (typeof a === 'boolean' ? Number(a) : a));
    const st = this.stmt(sql);
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      return { rows: st.all(...args), rowsAffected: 0, lastInsertRowid: undefined };
    }
    const r = st.run(...args);
    return { rows: [], rowsAffected: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  runBatch(stmts) {
    this.s.exec('BEGIN IMMEDIATE');
    try {
      const out = stmts.map(q => this.run1(q));
      this.s.exec('COMMIT');
      return out;
    } catch (e) {
      try { this.s.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }
  async wait() { while (this.lock) await this.lock.promise; }
  async execute(q) { await this.wait(); return this.run1(q); }
  async batch(stmts) { await this.wait(); return this.runBatch(stmts); }
  async transaction() {
    await this.wait();
    let release;
    this.lock = { promise: new Promise(r => { release = r; }) };
    this.s.exec('BEGIN IMMEDIATE');
    let open = true;
    const end = () => { if (open) { open = false; this.lock = null; release(); } };
    return {
      execute: async (q) => this.run1(q),
      batch: async (stmts) => stmts.map(q => this.run1(q)),
      commit: async () => { if (open) { this.s.exec('COMMIT'); end(); } },
      rollback: async () => { if (open) { try { this.s.exec('ROLLBACK'); } finally { end(); } } },
      close: () => { if (open) { try { this.s.exec('ROLLBACK'); } catch {} end(); } },
    };
  }
}

// Ouverture (après la déclaration de LocalDb)
export const db = await openDatabase();

export async function migrate() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_daily TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_free INTEGER NOT NULL DEFAULT 0,
      packs_opened INTEGER NOT NULL DEFAULT 0,
      cards_sold INTEGER NOT NULL DEFAULT 0,
      god_packs INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS collection (
      user_id INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      first_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, card_id)
    )`,
    `CREATE TABLE IF NOT EXISTS achievements (
      user_id INTEGER NOT NULL,
      ach_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (user_id, ach_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pulls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS pulls_at ON pulls(at DESC)`,
  ], 'write');
}

export async function one(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}

export async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}

export async function run(sql, args = []) {
  return db.execute({ sql, args });
}
