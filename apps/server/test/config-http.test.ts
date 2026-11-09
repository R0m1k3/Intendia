import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { HermesError, HermesHttp } from '../src/hermes/http.js';
import { fakeInstance } from './helpers.js';

describe('config', () => {
  it('treats empty INTENDIA_* values (Compose env file `KEY=` lines) as unset', () => {
    const c = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_PASSWORD_HASH: '', INTENDIA_WEBHOOK_URL: ' ', INTENDIA_PUBLIC_URL: '' });
    expect(c.passwordHash).toBeUndefined();
    expect(c.webhookUrl).toBeUndefined();
    expect(c.publicUrl).toBeUndefined();
    expect(() => loadConfig({ INTENDIA_SECRET: '' })).toThrow(/INTENDIA_SECRET/);
  });
});

/** Headers at once, then a body that never ends (or ends after `ms`). */
function stalling(ms: number | null) {
  return async (_url: string, init: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        init.signal?.addEventListener('abort', () => ctrl.error(new Error('aborted')));
        if (ms !== null) setTimeout(() => { ctrl.enqueue(new TextEncoder().encode('{"ok":true}')); ctrl.close(); }, ms);
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

describe('HermesHttp timeouts', () => {
  it('a JSON request stays bounded while the body is read', async () => {
    const http = new HermesHttp(fakeInstance(), stalling(null));
    const t0 = Date.now();
    const err = await http.json('api', 'GET', '/v1/models', { timeoutMs: 40 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HermesError);
    expect((err as HermesError).kind).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a body that arrives in time is read', async () => {
    const http = new HermesHttp(fakeInstance(), stalling(10));
    expect(await http.json('api', 'GET', '/v1/models', { timeoutMs: 500 })).toEqual({ ok: true });
  });

  it('a raw request (SSE) is not cut once headers arrived', async () => {
    const http = new HermesHttp(fakeInstance(), stalling(80));
    const res = await http.request('api', 'GET', '/v1/runs/x/events', { timeoutMs: 20 });
    expect(await res.text()).toBe('{"ok":true}');
  });
});
