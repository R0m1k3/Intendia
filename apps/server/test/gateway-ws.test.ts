import { describe, expect, it } from 'vitest';
import { createFakeHermes, fakeWebSocketFactory } from 'fake-hermes';
import { dashboardSocketUrl, type WsLike } from '../src/hermes/events.js';
import { callGatewaySocket, GatewaySocketError, oneshot, probeSessionStats, probeSocket, sessionStats } from '../src/hermes/gateway-ws.js';
import { FIXTURES, fakeInstance } from './helpers.js';

const fake = (sessionStats: boolean) => {
  const f = createFakeHermes({ fixturesDir: FIXTURES, sessionStats });
  return fakeWebSocketFactory(f);
};

describe('dashboard JSON-RPC WebSocket', () => {
  it('builds the address from the dashboard base path, with the token', () => {
    expect(dashboardSocketUrl(fakeInstance({ dashboard: 'https://h.example/hermes/' }), '/api/ws'))
      .toMatch(/^wss:\/\/h\.example\/hermes\/api\/ws\?token=/);
  });

  it('reads session.stats, skipping the event frames', async () => {
    const stats = await sessionStats(fakeInstance(), 's1', { factory: fake(true) });
    expect(stats).toMatchObject({ context_tokens: 12_345, context_length: 200_000, plan_gauge: { label: 'Plan Pro', used_bp: 4200 } });
  });

  it('a standalone dashboard answers -32601: the probe says absent; another error says present', async () => {
    await expect(callGatewaySocket(fakeInstance(), 'session.stats', { session_id: 's1' }, { factory: fake(false) }))
      .rejects.toMatchObject({ code: -32601 });
    expect((await probeSessionStats(fakeInstance(), { factory: fake(false) })).sessionStats).toBe(false);
    // the probe's made-up session gets "session not found": the method exists
    expect((await probeSessionStats(fakeInstance(), { factory: fake(true) })).sessionStats).toBe(true);
  });

  it('probes llm.oneshot on its own, without changing the session.stats result', async () => {
    const make = (sessionStats: boolean, one: 'ok' | 'off' | 'no_model') => fakeWebSocketFactory(createFakeHermes({ fixturesDir: FIXTURES, sessionStats, oneshot: one }));
    expect(await probeSocket(fakeInstance(), { factory: make(false, 'ok') })).toMatchObject({ sessionStats: false, oneshot: true });
    expect(await probeSocket(fakeInstance(), { factory: make(true, 'off') })).toMatchObject({ sessionStats: true, oneshot: false });
    const silent = (): WsLike => ({ addEventListener: () => {}, send: () => {}, close: () => {} });
    expect(await probeSocket(fakeInstance(), { factory: silent, timeoutMs: 30 })).toMatchObject({ sessionStats: false, oneshot: false });
    expect(await oneshot(fakeInstance(), { instructions: 'Titre', input: 'Utilisateur : Ventes de Noël à Frouard', task: 'title_generation' }, { factory: make(false, 'ok') }))
      .toContain('Ventes de Noël');
    await expect(oneshot(fakeInstance(), { instructions: 'Titre', input: 'x', task: 'title_generation' }, { factory: make(false, 'no_model') }))
      .rejects.toMatchObject({ code: 5030 });
  });

  it('gives up a handshake never answered, and closes the socket; never shows the address', async () => {
    let closed = false;
    const silent = (): WsLike => ({ addEventListener: () => {}, send: () => {}, close: () => { closed = true; } });
    const err = await callGatewaySocket(fakeInstance(), 'session.stats', {}, { factory: silent, timeoutMs: 30 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewaySocketError);
    expect((err as GatewaySocketError).code).toBeNull();
    expect((err as Error).message).not.toMatch(/token|ws:/);
    expect(closed).toBe(true);
    expect((await probeSessionStats(fakeInstance(), { factory: silent, timeoutMs: 30 })).sessionStats).toBe(false);
  });

  it('a refused connection rejects at once', async () => {
    const refused = (): WsLike => {
      const l: Record<string, (ev: object) => void> = {};
      queueMicrotask(() => l.close?.({ code: 1008 }));
      return { addEventListener: (t, f) => { l[t] = f; }, send: () => {}, close: () => {} };
    };
    await expect(callGatewaySocket(fakeInstance(), 'session.stats', {}, { factory: refused })).rejects.toMatchObject({ code: null });
  });
});
