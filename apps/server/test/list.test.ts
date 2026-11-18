import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cronsModule, JobListSchema } from '../src/connectors/crons/index.js';
import { gitModule } from '../src/connectors/git/index.js';
import { kanbanModule } from '../src/connectors/kanban/index.js';
import type { ModuleDef } from '../src/connectors/types.js';
import { DROP_LOG_MS, rawLength, resetDropLog, tolerantArray } from '../src/connectors/list.js';
import { FIXTURES, testApp } from './helpers.js';

const Item = z.looseObject({ id: z.string() });

describe('tolerantArray', () => {
  beforeEach(() => resetDropLog());
  afterEach(() => vi.restoreAllMocks());

  it('drops a bad item and logs once per label in 10 min', () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const s = tolerantArray(Item, 'test.items');
      expect(s.parse([{ id: 'a' }, { id: 42 }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(s.parse([{ id: 'a' }, null])).toEqual([{ id: 'a' }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toBe('[intendia] test.items: 1 élément(s) ignoré(s) sur 3');
      // another label logs on its own
      tolerantArray(Item, 'test.other').parse([{ id: 'a' }, 1]);
      expect(warn).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(DROP_LOG_MS);
      s.parse([{ id: 'a' }, 1]);
      expect(warn).toHaveBeenCalledTimes(3);
      // nothing dropped: nothing logged
      vi.advanceTimersByTime(DROP_LOG_MS);
      s.parse([{ id: 'a' }]);
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts an empty list, refuses a non-empty list with no valid item, and a non-array', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = tolerantArray(Item, 'test.items');
    expect(s.parse([])).toEqual([]);
    const bad = s.safeParse([{ id: 1 }, 'x']);
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.message).toBe('test.items: no valid item');
    expect(s.safeParse({ id: 'a' }).success).toBe(false);
    expect(s.nullish().parse(null)).toBeNull();
    expect(s.default([]).parse(undefined)).toEqual([]);
  });

  it('keeps the union of the two cron list shapes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const job = { id: 'j1', name: 'n', prompt: 'p' };
    expect(JobListSchema.parse([job, { id: 42 }])).toEqual([job]);
    expect(JobListSchema.parse({ jobs: [job, { id: 42 }] })).toMatchObject({ jobs: [job] });
    expect(JobListSchema.safeParse([{ id: 42 }]).success).toBe(false);
  });
});

describe('tolerant lists, end to end', () => {
  beforeEach(() => resetDropLog());
  afterEach(() => vi.restoreAllMocks());
  const job = (JSON.parse(readFileSync(join(FIXTURES, 'dash', 'GET_api_cron_jobs.json'), 'utf8')) as { body: unknown[] }).body[0];

  it('one bad cron job: the others are listed and the compat probe stays ok', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await testApp({ breaks: { 'dash GET /api/cron/jobs': { body: [job, { id: 42 }] } } });
    const op = t.compat.get('fake')!.modules.find((m) => m.id === 'crons')!.ops.list!;
    expect(op).toMatchObject({ ok: true, route: { via: 'dash', path: '/api/cron/jobs' } });
    const res = await t.request('GET', '/x/i/fake/crons');
    expect(res.status).toBe(200);
    expect(res.json.crons).toHaveLength(1);
    expect(res.json.crons[0]).toMatchObject({ name: (job as { name: string }).name });
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('[intendia] crons.jobs: 1 élément(s) ignoré(s) sur 2'))).toBe(true);
  });

  it('a cron list with no valid job fails the probe (never ok)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await testApp({ breaks: {
      'dash GET /api/cron/jobs': { body: [{ id: 42 }] },
      'api GET /api/jobs': { body: { jobs: [{ id: 42 }] } },
    } });
    const op = t.compat.get('fake')!.modules.find((m) => m.id === 'crons')!.ops.list!;
    expect(op.ok).toBe(false);
  });
});

/** The read schema of the op behind this exact route. */
function schemaOf(mod: ModuleDef, path: string): z.ZodType {
  const op = Object.values(mod.ops).find((o) => o.kind === 'read' && o.routes.some((r) => r.path === path));
  expect(op?.schema, path).toBeDefined();
  return op!.schema!;
}

describe('lists made tolerant after B3', () => {
  beforeEach(() => resetDropLog());
  afterEach(() => vi.restoreAllMocks());
  const K = '/api/plugins/kanban';
  const task = { id: 't1', title: 'T', status: 'todo' };
  // [label, module, route, body around the list, valid item, invalid item]
  const cases: [string, ModuleDef, string, (list: unknown[]) => Record<string, unknown>, unknown, unknown][] = [
    ['crons.targets', cronsModule, '/api/cron/delivery-targets', (l) => ({ targets: l }), { id: 'local' }, { id: 1 }],
    ['kanban.columns', kanbanModule, `${K}/board`, (l) => ({ columns: l }), { name: 'todo', tasks: [task] }, { name: 2, tasks: [] }],
    ['kanban.workflow', kanbanModule, `${K}/workflow`, (l) => ({ columns: l }), { key: 'todo' }, { label: 'sans clé' }],
    ['kanban.assignees', kanbanModule, `${K}/assignees`, (l) => ({ assignees: l }), { name: 'default' }, { on_disk: true }],
    ['kanban.comments', kanbanModule, `${K}/tasks/{task_id}`, (l) => ({ task, comments: l }), { id: 1, body: 'b' }, { id: 2 }],
    ['kanban.events', kanbanModule, `${K}/tasks/{task_id}`, (l) => ({ task, events: l }), { id: 1, kind: 'created' }, { id: 2 }],
    ['kanban.attachments', kanbanModule, `${K}/tasks/{task_id}`, (l) => ({ task, attachments: l }), { id: 1 }, { name: 'x' }],
    ['kanban.link_tasks', kanbanModule, `${K}/tasks/{task_id}`, (l) => ({ task, link_tasks: l }), { id: 't2' }, { id: 3 }],
    ['kanban.runs', kanbanModule, `${K}/tasks/{task_id}`, (l) => ({ task, runs: l }), { id: 1 }, {}],
    ['git.status_files', gitModule, '/api/git/status', (l) => ({ branch: 'main', files: l }), { path: 'a' }, { path: 1 }],
    ['git.list', gitModule, '/api/git/review/list', (l) => ({ files: l }), { path: 'a', status: 'M' }, { status: 'M' }],
    ['git.branches', gitModule, '/api/git/branches', (l) => ({ branches: l }), { name: 'main' }, { name: null }],
  ];

  it.each(cases)('%s: a bad item dropped and logged, a list without a valid item refused', (label, mod, path, wrap, good, bad) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = schemaOf(mod, path);
    const key = Object.keys(wrap([])).find((k) => k !== 'task' && k !== 'branch')!;
    const parsed = schema.parse(wrap([good, bad])) as Record<string, unknown[]>;
    expect(parsed[key]).toHaveLength(1);
    expect(rawLength(parsed[key]!)).toBe(2);
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith(`[intendia] ${label}: 1 élément(s) ignoré(s) sur 2`))).toBe(true);
    expect(schema.safeParse(wrap([bad])).success).toBe(false);
  });

  it('one bad delivery target: the compat probe of crons stays ok', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await testApp({ breaks: { 'dash GET /api/cron/delivery-targets': { body: { targets: [{ id: 'local', name: 'Local' }, { id: 7 }] } } } });
    const op = t.compat.get('fake')!.modules.find((m) => m.id === 'crons')!.ops.targets!;
    expect(op).toMatchObject({ ok: true, route: { path: '/api/cron/delivery-targets' } });
  });
});
