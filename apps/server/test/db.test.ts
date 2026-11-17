import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(r.applied).toEqual(['0001_init.sql', '0002_sessions.sql', '0003_run_options.sql', '0004_run_cost_runs.sql', '0005_model_provider.sql', '0006_session_flags.sql', '0007_session_replaces.sql', '0008_prompts.sql', '0009_session_settings.sql', '0010_kanban_missions.sql', '0011_session_goals.sql', '0012_delegation_wakes.sql', '0013_goal_key_attempt.sql']);
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

  it('applies a migration below the highest one when it was missing (branches merged in any order)', () => {
    const dir = tempDir();
    const mdir = join(dir, 'migrations');
    mkdirSync(mdir);
    for (const f of ['0001_init.sql', '0002_sessions.sql', '0003_run_options.sql', '0005_model_provider.sql']) copyFileSync(join(MIGRATIONS, f), join(mdir, f));
    const db = new Database(join(dir, 'intendia.db'));
    migrate(db, dir, mdir);
    writeFileSync(join(mdir, '0004_late.sql'), 'ALTER TABLE workspaces ADD COLUMN late TEXT;');
    const r = migrate(db, dir, mdir);
    expect(r.applied).toEqual(['0004_late.sql']);
    expect(r.backup).toMatch(/backups\/intendia-v0005-.*\.db$/);
    expect(migrate(db, dir, mdir).applied).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('workspaces') WHERE name IN ('late', 'model_provider')").get()).toEqual({ n: 2 });
  });

  it('0003 keeps the model existing sessions use (it came from their workspace)', () => {
    const dir = tempDir();
    const mdir = join(dir, 'migrations');
    mkdirSync(mdir);
    for (const f of ['0001_init.sql', '0002_sessions.sql']) copyFileSync(join(MIGRATIONS, f), join(mdir, f));
    const db = new Database(join(dir, 'intendia.db'));
    migrate(db, dir, mdir);
    db.prepare("INSERT INTO workspaces (slug, name, instance_id, model, created_at) VALUES ('a', 'A', 'i', 'opus', 1), ('b', 'B', 'i', NULL, 1)").run();
    db.prepare("INSERT INTO session_workspace (session_id, instance_id, workspace_slug, created_at) VALUES ('s1', 'i', 'a', 1), ('s2', 'i', 'b', 1)").run();
    copyFileSync(join(MIGRATIONS, '0003_run_options.sql'), join(mdir, '0003_run_options.sql'));
    expect(migrate(db, dir, mdir).applied).toEqual(['0003_run_options.sql']);
    expect(db.prepare('SELECT session_id, model, effort FROM session_workspace ORDER BY session_id').all()).toEqual([
      { session_id: 's1', model: 'opus', effort: null }, { session_id: 's2', model: null, effort: null },
    ]);
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

  describe('followed by file name (lot C)', () => {
    const base = () => {
      const dir = tempDir();
      const mdir = join(dir, 'migrations');
      mkdirSync(mdir);
      copyFileSync(join(MIGRATIONS, '0001_init.sql'), join(mdir, '0001_init.sql'));
      return { dir, mdir, db: new Database(join(dir, 'intendia.db')) };
    };

    it('refuses two files of the same number, naming both', () => {
      const { dir, mdir, db } = base();
      writeFileSync(join(mdir, '0002_a.sql'), 'SELECT 1;');
      writeFileSync(join(mdir, '0002_b.sql'), 'SELECT 1;');
      expect(() => migrate(db, dir, mdir)).toThrow(/0002_a\.sql and 0002_b\.sql share the number 0002/);
    });

    it('refuses a database migrated by a newer Intendia, pointing to the backups', () => {
      const { dir, mdir, db } = base();
      migrate(db, dir, mdir);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (99, ?, 0)').run('0099_x.sql');
      expect(() => migrate(db, dir, mdir)).toThrow(/newer Intendia \(0099_x\.sql unknown\).*backups/);
    });

    it('refuses a row whose number has another file name', () => {
      const { dir, mdir, db } = base();
      writeFileSync(join(mdir, '0002_old.sql'), 'SELECT 1;');
      migrate(db, dir, mdir);
      rmSync(join(mdir, '0002_old.sql'));
      writeFileSync(join(mdir, '0002_new.sql'), 'SELECT 1;');
      expect(() => migrate(db, dir, mdir)).toThrow(/0002 applied as 0002_old\.sql, but the code has 0002_new\.sql/);
    });

    it('an existing database (rows id, name of the old code) replays nothing', () => {
      const dir = tempDir();
      const db = new Database(join(dir, 'intendia.db'));
      migrate(db, dir, MIGRATIONS);
      expect(migrate(db, dir, MIGRATIONS)).toEqual({ applied: [], backup: null });
    });

    it('the shipped migrations all have a different number', () => {
      const numbers = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => f.slice(0, 4));
      expect(new Set(numbers).size).toBe(numbers.length);
    });
  });
});
