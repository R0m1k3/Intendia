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

describe('HermesHttp errors', () => {
  const answer = (status: number, body: string) => async () => new Response(body, { status });
  const catchErr = (p: Promise<unknown>) => p.then(() => { throw new Error('no error'); }, (e: unknown) => e as HermesError);

  it('a fetch that rejects is a network error', async () => {
    const http = new HermesHttp(fakeInstance(), async () => { throw new Error('ECONNREFUSED'); });
    const err = await catchErr(http.json('api', 'GET', '/x'));
    expect(err).toBeInstanceOf(HermesError);
    expect(err.kind).toBe('network');
    expect(err.message).toBe('api GET /x: ECONNREFUSED');
  });

  it('a 404 is an http error with the status and the body cut at 500 characters', async () => {
    const http = new HermesHttp(fakeInstance(), answer(404, 'x'.repeat(800)));
    const err = await catchErr(http.json('dash', 'GET', '/api/nope'));
    expect(err.kind).toBe('http');
    expect(err.detail.status).toBe(404);
    expect(err.detail.body).toHaveLength(500);
  });

  it('an empty 200 body is null', async () => {
    const http = new HermesHttp(fakeInstance(), answer(200, ''));
    expect(await http.json('api', 'GET', '/x')).toBeNull();
  });

  it('a 200 body that is not JSON is a schema error', async () => {
    const http = new HermesHttp(fakeInstance(), answer(200, '<html>login</html>'));
    expect((await catchErr(http.json('dash', 'GET', '/api/status'))).kind).toBe('schema');
  });

  it("an abort by the caller's signal is a network error, not a timeout", async () => {
    const ctrl = new AbortController();
    const http = new HermesHttp(fakeInstance(), (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const p = catchErr(http.json('api', 'GET', '/x', { signal: ctrl.signal, timeoutMs: 5_000 }));
    ctrl.abort();
    expect((await p).kind).toBe('network');
  });

  it('sends the bearer of each side, none when anonymous, and ?profile= on the dashboard', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const inst = fakeInstance({ apiKey: 'api-key-1234567890', dashboardToken: 'dash-token-1234567890' });
    const http = new HermesHttp(inst, async (url, init) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return new Response('{}', { status: 200 });
    });
    await http.json('api', 'GET', '/v1/models');
    await http.json('dash', 'GET', '/api/skills', { profile: 'work' });
    await http.json('dash', 'GET', '/api/auth/public', { anonymous: true });
    expect(seen[0]!.auth).toBe('Bearer api-key-1234567890');
    expect(seen[1]!.auth).toBe('Bearer dash-token-1234567890');
    expect(new URL(seen[1]!.url).searchParams.get('profile')).toBe('work');
    expect(seen[2]!.auth).toBeUndefined();
  });
});
