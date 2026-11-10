import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const KEEP_BACKUPS = 5;

function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev (tsx): src/db/migrations ; build (esbuild bundle): dist/migrations
  for (const candidate of [join(here, 'migrations'), join(here, 'db', 'migrations')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Migrations directory not found next to ${here}`);
}

interface Migration {
  id: number;
  name: string;
  sql: string;
}

function listMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ id: Number(f.slice(0, 4)), name: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

/**
 * Copies the database with VACUUM INTO before any migration, keeps the last five copies.
 * Returns the backup path, or null when the database was empty (first start).
 */
export function backupBeforeMigration(sqlite: Database.Database, dataDir: string, fromVersion: number): string | null {
  if (fromVersion === 0) return null;
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `intendia-v${String(fromVersion).padStart(4, '0')}-${stamp}.db`);
  sqlite.prepare('VACUUM INTO ?').run(target);
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith('intendia-') && f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of backups.slice(KEEP_BACKUPS)) rmSync(join(dir, old.f));
  return target;
}

export function migrate(sqlite: Database.Database, dataDir: string, migrationsDir = defaultMigrationsDir()) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const row = sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS v FROM _migrations').get() as { v: number };
  // every migration not applied yet, not only those above the highest: branches merged in any order (0005 before
  // 0004) still get all of theirs
  const done = new Set((sqlite.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id));
  const pending = listMigrations(migrationsDir).filter((m) => !done.has(m.id));
  if (pending.length === 0) return { applied: [] as string[], backup: null as string | null };
  const backup = backupBeforeMigration(sqlite, dataDir, row.v);
  const applied: string[] = [];
  for (const m of pending) {
    sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, Date.now());
    })();
    applied.push(m.name);
  }
  return { applied, backup };
}

export function openDb(dataDir: string, file = 'intendia.db'): Db {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(file === ':memory:' ? ':memory:' : join(dataDir, file));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  migrate(sqlite, dataDir);
  return drizzle(sqlite, { schema }) as Db;
}
