// Base de données : SQLite en local (fichier), ou Turso (gratuit) en ligne.
//   Local  : rien à configurer, crée booster-club.db
//   Turso  : définir TURSO_DATABASE_URL et TURSO_AUTH_TOKEN
import { createClient } from '@libsql/client';

export const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: process.env.DATABASE_FILE ? `file:${process.env.DATABASE_FILE}` : 'file:booster-club.db' }
);

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
