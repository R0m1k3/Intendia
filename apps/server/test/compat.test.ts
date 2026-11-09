import { describe, expect, it } from 'vitest';
import { checkInstance } from '../src/compat/engine.js';
import type { CompatReport, ModuleId } from '../src/connectors/types.js';
import { fakeHttp, fakeInstance } from './helpers.js';

const state = (r: CompatReport, id: ModuleId) => r.modules.find((m) => m.id === id)!;
const states = (r: CompatReport) => Object.fromEntries(r.modules.map((m) => [m.id, m.state]));

describe('compatibility engine (Hermes 0.23.0 recording)', () => {
  it('reports every module complete on the recorded release', async () => {
    const { report } = await checkInstance(fakeHttp().http);
    expect(report.hermesVersion).toBe('0.23.0');
    expect(report.dash.openapi).toBe(true);
    expect(states(report)).toEqual({
      health: 'full', chat: 'full', sessions: 'full', crons: 'full',
      skills: 'full', config: 'full', agents: 'full', kanban: 'full',
    });
  });

  it('uses the dashboard skills list because /v1/skills is broken in 0.23.0', async () => {
    const { report } = await checkInstance(fakeHttp().http);
    expect(state(report, 'skills').ops.list!.route).toMatchObject({ via: 'dash', path: '/api/skills' });
  });

  it('falls back to the next route when the preferred one fails', async () => {
    const { http } = fakeHttp({ breaks: { 'dash GET /api/cron/jobs': { status: 500 } } });
    const { report } = await checkInstance(http);
    const crons = state(report, 'crons');
    expect(crons.state).toBe('full');
    expect(crons.ops.list!.route).toMatchObject({ via: 'api', path: '/api/jobs' });
    expect(crons.ops.list!.notes[0]).toContain('HTTP 500');
  });

  it('a 404 on one module route disables that module only', async () => {
    const { http } = fakeHttp({ breaks: { 'dash GET /api/config/schema': { status: 404 } } });
    const { report } = await checkInstance(http);
    const config = state(report, 'config');
    expect(config.state).toBe('unavailable');
    expect(config.reasons.join(' ')).toContain('HTTP 404');
    expect(config.dashboardLink).toBe('https://dash.example.test/config');
    for (const id of ['health', 'chat', 'sessions', 'crons', 'skills', 'agents', 'kanban'] as const) {
      expect(state(report, id).state).toBe('full');
    }
  });

  it('a renamed field is caught by the schema and degrades the module', async () => {
    const { http } = fakeHttp({ breaks: { 'dash GET /api/plugins/kanban/board': { body: { lanes: [] } } } });
    const { report } = await checkInstance(http);
    expect(state(report, 'kanban').state).toBe('unavailable');
    expect(state(report, 'kanban').reasons[0]).toContain('réponse inattendue');
  });

  it('a write route that disappears makes the module read-only', async () => {
    const { http } = fakeHttp({ hide: { capabilities: ['run_stop'] } });
    const { report } = await checkInstance(http);
    expect(state(report, 'chat').state).toBe('readonly');
    expect(state(report, 'chat').reasons[0]).toContain('/v1/capabilities');
  });

  it('a dashboard route removed from the OpenAPI is not used', async () => {
    const { http } = fakeHttp({ hide: { openapi: ['PUT /api/skills/toggle'] } });
    const { report } = await checkInstance(http);
    expect(state(report, 'skills').state).toBe('readonly');
    expect(state(report, 'skills').ops.toggle!.ok).toBe(false);
  });

  it('follows a path moved in /v1/capabilities', async () => {
    const { http } = fakeHttp({
      breaks: {
        'api GET /v1/capabilities': {
          body: {
            features: { run_submission: true },
            endpoints: { runs: { method: 'POST', path: '/v2/runs' }, health_detailed: { method: 'GET', path: '/health/detailed' } },
          },
        },
      },
    });
    const { report } = await checkInstance(http);
    expect(state(report, 'chat').ops.createRun!.route).toMatchObject({ path: '/v2/runs' });
  });

  it('without a dashboard, dashboard-only modules are unavailable and the rest works', async () => {
    const { http } = fakeHttp({}, fakeInstance({ dashboard: undefined, dashboardToken: undefined }));
    const { report } = await checkInstance(http);
    // crons: list/create/update work through the API server; cancel and runs exist only on the dashboard
    expect(states(report)).toMatchObject({ chat: 'full', sessions: 'full', crons: 'readonly', config: 'unavailable', kanban: 'unavailable', agents: 'unavailable', skills: 'unavailable' });
    expect(state(report, 'crons').ops.list!.ok).toBe(true);
    expect(state(report, 'config').reasons[0]).toContain('non configuré');
  });

  it('an unreachable API server makes API modules unavailable without throwing', async () => {
    const { http } = fakeHttp({}, fakeInstance({ api: 'http://nowhere' }));
    const { report } = await checkInstance(http);
    expect(report.api.reachable).toBe(false);
    expect(state(report, 'chat').state).toBe('unavailable');
    expect(state(report, 'kanban').state).toBe('full');
  });
});
