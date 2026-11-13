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
    expect(r.applied).toEqual(['0001_init.sql', '0002_sessions.sql', '0003_run_options.sql', '0004_run_cost_runs.sql', '0005_model_provider.sql', '0006_session_flags.sql', '0007_session_replaces.sql', '0008_prompts.sql', '0009_session_settings.sql', '0010_kanban_missions.sql', '0011_session_goals.sql', '0012_delegation_wakes.sql']);
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
});
