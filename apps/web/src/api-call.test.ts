import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isTransient, setCallHooks } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const hooks = { network: vi.fn(), unauthenticated: vi.fn(), writeTimeout: vi.fn() };

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error('no error');
}

/** AbortSignal.timeout on the (fake) timers of the test: Node's own runs on internal timers. */
function fakeTimeouts() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  });
}

/** fetch that never answers, but rejects like the browser when its signal fires. */
function hanging() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
  }));
}

beforeEach(() => {
  for (const f of Object.values(hooks)) f.mockReset();
  setCallHooks(hooks);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('call()', () => {
  it('turns a network failure into a translated `network` error and tells the hook', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await failure(api.compat());
    expect(err.status).toBe(0);
    expect(err.message).toBe('Serveur Intendia injoignable');
    expect(err.data).toEqual({ code: 'network' });
    expect(hooks.network).toHaveBeenCalledWith(false);
    expect(isTransient(err)).toBe(true);
  });

  it('502 without a body is transient (proxy), 502 with JSON is final', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Gateway', { status: 502 })));
    const proxy = await failure(api.compat());
    expect(isTransient(proxy)).toBe(true);
    expect(proxy.message).toBe('Réponse inattendue du serveur Intendia (HTTP 502)');
    expect(hooks.network).toHaveBeenLastCalledWith(false);

    vi.stubGlobal('fetch', vi.fn(async () => json(502, { error: 'Hermes a répondu 502' })));
    const hermes = await failure(api.compat());
    expect(isTransient(hermes)).toBe(false);
    expect(hermes.message).toBe('Hermes a répondu 502');
    expect(hooks.network).toHaveBeenLastCalledWith(true);
  });

  it('404, 409 and 500 with JSON are final', async () => {
    for (const status of [404, 409, 500, 503, 504]) {
      vi.stubGlobal('fetch', vi.fn(async () => json(status, { error: 'non' })));
      expect(isTransient(await failure(api.compat())), String(status)).toBe(false);
    }
  });

  it('401 `unauthenticated` calls the hook; the wrong password 401 does not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Session expirée : reconnectez-vous', code: 'unauthenticated' })));
    const expired = await failure(api.compat());
    expect(expired.status).toBe(401);
    expect(hooks.unauthenticated).toHaveBeenCalledTimes(1);

    hooks.unauthenticated.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Mot de passe incorrect' })));
    const wrong = await failure(api.login('x'));
    expect(wrong.message).toBe('Mot de passe incorrect');
    expect(hooks.unauthenticated).not.toHaveBeenCalled();
  });

  it('a read with no answer stops after 60 s, without the write hook', async () => {
    fakeTimeouts();
    vi.stubGlobal('fetch', hanging());
    const p = failure(api.compat());
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await p;
    expect(err.data).toMatchObject({ code: 'timeout', timeoutMs: 60_000 });
    expect(err.message).toBe("Pas de réponse d'Intendia après 60 s");
    expect(hooks.writeTimeout).not.toHaveBeenCalled();
    expect(isTransient(err)).toBe(false);
  });

  it('a write with no answer stops after 150 s and calls the write hook', async () => {
    fakeTimeouts();
    vi.stubGlobal('fetch', hanging());
    const p = failure(api.logout());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hooks.writeTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000);
    const err = await p;
    expect(err.data).toMatchObject({ code: 'timeout', timeoutMs: 150_000 });
    expect(err.message).toContain("l'action a peut-être abouti");
    expect(hooks.writeTimeout).toHaveBeenCalledTimes(1);
  });

  it('an error without JSON gives a translated message with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('teapot', { status: 418 })));
    expect((await failure(api.compat())).message).toBe('Réponse inattendue du serveur Intendia (HTTP 418)');
  });

  it('a JSON success answers the data and tells the network hook', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { reports: [] })));
    expect(await api.compat()).toEqual({ reports: [] });
    expect(hooks.network).toHaveBeenCalledWith(true);
  });
});
