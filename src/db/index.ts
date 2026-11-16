import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

// Le serveur standalone fait un chdir : le dossier est donc configurable (MIGRATIONS_DIR).
const MIGRATIONS = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'src/db/migrations');

export function openDb(url = process.env.DATABASE_URL ?? './data/singletrack.db') {
  if (url !== ':memory:') fs.mkdirSync(path.dirname(url), { recursive: true });
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { sqlite, db };
}

export type Db = ReturnType<typeof openDb>['db'];

let cached: ReturnType<typeof openDb> | undefined;

/** Connexion unique par processus ; les migrations sont appliquées à la première ouverture. */
export function getDb() {
  cached ??= openDb();
  return cached;
}
