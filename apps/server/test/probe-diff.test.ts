import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffRecordings } from '../src/cli/probe-diff.js';
import { tempDir } from './helpers.js';

interface Rec {
  version?: string;
  routes?: string[];
  modules?: { id: string; state: string }[];
  sessions?: { status: number; body: unknown };
}

function recording(r: Rec = {}): string {
  const d = tempDir();
  mkdirSync(join(d, 'api'));
  mkdirSync(join(d, 'dash'));
  const w = (f: string, x: unknown) => writeFileSync(join(d, f), JSON.stringify(x));
  w('surface.json', {
    version: r.version ?? '1.0.0',
    api: { features: { runs: true }, endpoints: { runs: { method: 'POST', path: '/v1/runs' } } },
    dash: { configured: true, reachable: true, routes: r.routes ?? ['GET /api/sessions'] },
  });
  w('compat-report.json', { modules: r.modules ?? [{ id: 'chat', state: 'full' }] });
  w('dash/GET_api_sessions.json', r.sessions ?? { status: 200, body: { sessions: [{ id: 's1', title: 'A' }], total: 1 } });
  return d;
}

describe('probe diff (diffRecordings)', () => {
  it('a new module absent from the old report is a note, not a change', () => {
    const r = diffRecordings(recording(), recording({ version: '1.0.1', modules: [{ id: 'chat', state: 'full' }, { id: 'files', state: 'full' }] }));
    expect(r.header).toBe('Hermes 1.0.0 → 1.0.1');
    expect(r.changes).toEqual([]);
    expect(r.notes).toContain('module files: full');
  });

  it('an added dashboard route is a note', () => {
    const r = diffRecordings(recording(), recording({ routes: ['GET /api/sessions', 'GET /api/files'] }));
    expect(r.changes).toEqual([]);
    expect(r.notes).toContain('Dashboard route: + GET /api/files');
  });

  it('a removed dashboard route is a change', () => {
    const r = diffRecordings(recording({ routes: ['GET /api/sessions', 'GET /api/files'] }), recording());
    expect(r.changes).toEqual(['Dashboard route: - GET /api/files']);
  });

  it('response fields: added = note; removed or retyped = change; null and empty arrays tell nothing', () => {
    const base = recording();
    const added = diffRecordings(base, recording({ sessions: { status: 200, body: { sessions: [{ id: 's1', title: 'A', cost: 1 }], total: 1 } } }));
    expect(added.changes).toEqual([]);
    expect(added.notes).toContain('dash/GET_api_sessions.json: + sessions[].cost');

    const changed = diffRecordings(base, recording({ sessions: { status: 200, body: { sessions: [{ id: 2 }], total: null } } }));
    expect(changed.changes).toEqual([
      'dash/GET_api_sessions.json: sessions[].id: string → number',
      'dash/GET_api_sessions.json: - sessions[].title',
    ]);

    const empty = diffRecordings(base, recording({ sessions: { status: 200, body: { sessions: [], total: 0 } } }));
    expect(empty.changes).toEqual([]);
  });

  it('a status 200 → 404 is a change', () => {
    const r = diffRecordings(recording(), recording({ sessions: { status: 404, body: { detail: 'Not Found' } } }));
    expect(r.changes).toEqual(['dash/GET_api_sessions.json: HTTP 200 → 404']);
  });

  it('runs on the real recordings', () => {
    const f = resolve(import.meta.dirname, '../../../fixtures');
    const r = diffRecordings(join(f, 'hermes-0.23.0'), join(f, 'hermes-0.23.1'));
    expect(r.header).toBe('Hermes 0.23.0 → 0.23.1');
  });
});
