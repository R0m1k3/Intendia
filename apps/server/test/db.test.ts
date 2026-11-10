import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/index.js';
import { tempDir } from './helpers.js';

const MIGRATIONS = resolve(import.meta.dirname, '../src/db/migrations');

describe('migrations', () => {
  it('first start applies the schema without a backup', () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'intendia.db'));
    const r = migrate(db, dir, MIGRATIONS);
    expect(r.applied).toEqual(['0001_init.sql', '0002_sessions.sql']);
    expect(r.backup).toBeNull();
  });

  it('copies the database with VACUUM INTO before each migration', () => {
    const dir = tempDir();
    const mdir = join(dir, 'migrations');
    mkdirSync(mdir);
    copyFileSync(join(MIGRATIONS, '0001_init.sql'), join(mdir, '0001_init.sql'));
    const db = new Database(join(dir, 'intendia.db'));
    migrate(db, dir, mdir);
    db.prepare("INSERT INTO settings (key, value) VALUES ('k', 'before')").run();

    writeFileSync(join(mdir, '0002_add.sql'), 'ALTER TABLE workspaces ADD COLUMN color TEXT;');
    const r = migrate(db, dir, mdir);
    expect(r.applied).toEqual(['0002_add.sql']);
    expect(r.backup).toMatch(/backups\/intendia-v0001-.*\.db$/);
    const copy = new Database(r.backup!);
    expect(copy.prepare("SELECT value FROM settings WHERE key = 'k'").get()).toEqual({ value: 'before' });
    expect(copy.prepare('SELECT MAX(id) AS v FROM _migrations').get()).toEqual({ v: 1 });
  });

  it('keeps only the last five backups', () => {
    const dir = tempDir();
    const mdir = join(dir, 'migrations');
    mkdirSync(mdir);
    copyFileSync(join(MIGRATIONS, '0001_init.sql'), join(mdir, '0001_init.sql'));
    const db = new Database(join(dir, 'intendia.db'));
    migrate(db, dir, mdir);
    for (let i = 2; i <= 8; i++) {
      writeFileSync(join(mdir, `000${i}_m.sql`), `CREATE TABLE t${i} (x INTEGER);`);
      migrate(db, dir, mdir);
    }
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(5);
  });
});
