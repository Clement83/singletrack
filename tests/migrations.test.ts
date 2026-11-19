import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableName, is } from 'drizzle-orm';
import { openDb } from '@/db';
import * as schema from '@/db/schema';

// Every migration on an empty database, then the real schema matches src/db/schema.ts (#1482).
const DIR = path.join(process.cwd(), 'src/db/migrations');
const tables = Object.values(schema).filter((v) => is(v, SQLiteTable)) as SQLiteTable[];

describe('migrations', () => {
  it('le journal liste exactement les fichiers .sql, dans l’ordre, sans trou', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(DIR, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort();
    expect(journal.entries.map((e) => e.tag)).toEqual(files);
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
    const whens = journal.entries.map((e) => e.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
    // The numeric prefix is continuous.
    files.forEach((f, i) => expect(Number(f.slice(0, 4))).toBe(i));
  });

  it('toutes les migrations s’appliquent sur une base vide, et chaque migration a été appliquée', () => {
    const { sqlite } = openDb(':memory:');
    const n = (sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
    expect(n).toBe(fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).length);
    sqlite.close();
  });

  it('chaque table et colonne de schema.ts existe en base, avec le bon type et la bonne nullité', () => {
    const { sqlite } = openDb(':memory:');
    const existing = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name));
    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(existing.has(cfg.name), `table ${cfg.name}`).toBe(true);
      const cols = sqlite.prepare(`PRAGMA table_info("${cfg.name}")`).all() as { name: string; type: string; notnull: number; pk: number }[];
      const byName = new Map(cols.map((c) => [c.name, c]));
      for (const c of cfg.columns) {
        const real = byName.get(c.name);
        expect(real, `${cfg.name}.${c.name} manquante`).toBeDefined();
        expect(real!.type.toLowerCase(), `${cfg.name}.${c.name} type`).toBe(c.getSQLType().toLowerCase());
        if (!c.primary) expect(!!real!.notnull, `${cfg.name}.${c.name} notNull`).toBe(c.notNull);
      }
      // No orphan column in the database: the Drizzle schema describes them all.
      expect([...byName.keys()].sort(), `${cfg.name} colonnes`).toEqual(cfg.columns.map((c) => c.name).sort());
    }
    sqlite.close();
  });

  it('chaque index et clé étrangère déclarés existent, et les clés étrangères sont cohérentes', () => {
    const { sqlite } = openDb(':memory:');
    const idx = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name));
    for (const t of tables) {
      const cfg = getTableConfig(t);
      for (const i of cfg.indexes) expect(idx.has(i.config.name), `index ${i.config.name}`).toBe(true);
      const fks = sqlite.prepare(`PRAGMA foreign_key_list("${cfg.name}")`).all();
      expect(fks.length, `${getTableName(t)} clés étrangères`).toBe(cfg.foreignKeys.length);
    }
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    sqlite.close();
  });

  it('rejouer les migrations sur une base déjà migrée ne change rien (démarrage répété)', () => {
    const file = path.join(process.env.TMPDIR ?? '/tmp', `st-mig-${process.pid}-${Date.now()}.db`);
    try {
      openDb(file).sqlite.close();
      const again = openDb(file);
      expect((again.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).length);
      again.sqlite.close();
    } finally {
      for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true });
    }
  });
});
