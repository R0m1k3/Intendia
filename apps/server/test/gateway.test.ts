import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/config/gateway';
type T = Awaited<ReturnType<typeof testApp>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dashCalls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);

async function follow(t: T, action: string, profile: string) {
  let s: { running: boolean; exitCode: number | null; lines: string[] } = { running: true, exitCode: null, lines: [] };
  for (let i = 0; i < 100 && s.running; i++) {
    await sleep(5);
    s = (await t.request('GET', `${BASE}/${action}?profile=${profile}`)).json;
  }
  return s;
}
const running = async (t: T, name: string) => (await t.request('GET', '/x/i/fake/agents')).json.agents.find((a: any) => a.name === name)?.gatewayRunning;

describe('gateway start / stop', () => {
  it('stops then starts a profile gateway, with masked action lines', async () => {
    const t = await testApp();
    await t.request('POST', '/x/i/fake/agents', { name: 'veille' });
    expect((await t.request('GET', `${BASE}/stop?profile=veille`)).json).toEqual({ running: false, exitCode: null, lines: [], truncated: false });
    expect((await t.request('POST', `${BASE}/stop?profile=veille`, {})).status).toBe(202);
    expect(dashCalls(t, 'POST', '/api/gateway/stop').at(-1)?.query).toEqual({ profile: 'veille' });
    const s = await follow(t, 'stop', 'veille');
    expect(s.exitCode).toBe(0);
    expect(s.lines.join('\n')).toContain('Gateway for veille stopped');
    expect(s.lines.join('\n')).not.toContain('sk-test-gw-0010');
    expect(await running(t, 'veille')).toBe(false);
    expect((await t.request('POST', `${BASE}/start?profile=veille`)).status).toBe(202);
    expect((await follow(t, 'start', 'veille')).lines.join('\n')).toContain('Gateway for veille started');
    expect(await running(t, 'veille')).toBe(true);
  });

  it('a stop refused for live sessions asks first, then interrupts', async () => {
    const t = await testApp();
    await t.request('POST', '/x/i/fake/agents', { name: 'occupe' });
    const refused = await t.request('POST', `${BASE}/stop?profile=occupe`, {});
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('refused');
    expect(refused.json.error).toContain('live sessions');
    const forced = await t.request('POST', `${BASE}/stop?profile=occupe`, { interrupt: true });
    expect(forced.status).toBe(202);
    expect(dashCalls(t, 'POST', '/api/gateway/stop').at(-1)?.query).toEqual({ profile: 'occupe', interrupt: 'true' });
  });

  it('a multiplexed profile: start 409 and stop with interrupt 409 are multiplexer refusals', async () => {
    const t = await testApp();
    await t.request('POST', '/x/i/fake/agents', { name: 'multi' });
    const start = await t.request('POST', `${BASE}/start?profile=multi`);
    expect(start.status).toBe(409);
    expect(start.json.code).toBe('multiplexed');
    // without interrupt Hermes already answers with the multiplexer refusal, Intendia cannot tell: "refused" then ask
    expect((await t.request('POST', `${BASE}/stop?profile=multi`, {})).json.code).toBe('refused');
    expect((await t.request('POST', `${BASE}/stop?profile=multi`, { interrupt: true })).json.code).toBe('multiplexed');
  });

  it('unknown action and invalid profile are refused before Hermes', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${BASE}/explose`)).status).toBe(400);
    expect((await t.request('POST', `${BASE}/start?profile=..%2Fx`)).status).toBe(400);
    expect(dashCalls(t, 'POST', '/api/gateway/start')).toHaveLength(0);
  });

  it('a stopped gateway takes the API server of that profile down, the dashboard still starts it', async () => {
    const t = await testApp({ profileKeys: { veille: 'veille-profile-key-0000' } });
    await t.request('POST', '/x/i/fake/agents', { name: 'veille' });
    await t.request('POST', `${BASE}/stop?profile=veille`, {});
    await follow(t, 'stop', 'veille');
    const r = await t.fake.api.request('/p/veille/v1/capabilities', { headers: { Authorization: 'Bearer veille-profile-key-0000' } });
    expect(r.status).toBe(503);
    expect((await t.request('POST', `${BASE}/start?profile=veille`)).status).toBe(202);
  });
});
