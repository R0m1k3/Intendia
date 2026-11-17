import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';
import { connectionState, initConnection, PROBE_MS } from './connection';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const down = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
const expired = () => vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Session expirée : reconnectez-vous', code: 'unauthenticated' })));
const settle = () => vi.advanceTimersByTimeAsync(0);

function setup(opts: { embedded?: boolean; answers?: (string | null)[]; login?: (p: string) => Promise<unknown> } = {}) {
  const queryClient = { invalidateQueries: vi.fn() };
  const router = { invalidate: vi.fn() };
  const answers = [...(opts.answers ?? [])];
  const askText = vi.fn(async (_o: unknown): Promise<string | null> => (answers.length ? answers.shift()! : null));
  const probe = vi.fn(async () => json(502, null));
  const login = vi.fn(opts.login ?? (async () => ({ ok: true })));
  initConnection({ queryClient, router, embedded: opts.embedded ?? false, askText, login, fetch: probe as unknown as typeof fetch });
  return { queryClient, router, askText, probe, login };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server unreachable', () => {
  it('one probe for several failures; a 502 probe keeps it down; `{ ok: true }` brings it back with one invalidation', async () => {
    const h = setup();
    down();
    await api.compat().catch(() => {});
    await api.compat().catch(() => {});
    expect(connectionState().serverDown).toBe(true);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(connectionState().serverDown).toBe(true);

    h.probe.mockImplementation(async () => json(200, { ok: true }));
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(connectionState().serverDown).toBe(false);
    expect(h.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PROBE_MS * 3);
    expect(h.probe).toHaveBeenCalledTimes(2);
  });

  it('the first answer of Intendia ends the outage', async () => {
    const h = setup();
    down();
    await api.compat().catch(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'introuvable' })));
    await api.compat().catch(() => {});
    expect(connectionState().serverDown).toBe(false);
    expect(h.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

describe('session expired', () => {
  it('two 401 in a row open a single dialog; cancel sends to the sign-in page', async () => {
    const h = setup();
    let answer: (v: string | null) => void = () => {};
    h.askText.mockImplementation(() => new Promise((r) => { answer = r; }));
    expired();
    await api.compat().catch(() => {});
    await api.compat().catch(() => {});
    await settle();
    expect(h.askText).toHaveBeenCalledTimes(1);
    expect(h.askText.mock.calls[0]![0]).toMatchObject({ title: 'Session expirée', password: true });
    answer(null);
    await settle();
    expect(h.router.invalidate).toHaveBeenCalledTimes(1);
    expect(h.login).not.toHaveBeenCalled();
  });

  it('a wrong password shows the dialog again with the server message, the right one reloads the data', async () => {
    const h = setup({
      answers: ['faux', 'juste'],
      login: async (p) => { if (p !== 'juste') throw new ApiError(401, 'Mot de passe incorrect'); return { ok: true }; },
    });
    expired();
    await api.compat().catch(() => {});
    await settle();
    expect(h.askText).toHaveBeenCalledTimes(2);
    expect(h.askText.mock.calls[1]![0]).toMatchObject({ message: 'Mot de passe incorrect' });
    expect(h.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(h.router.invalidate).not.toHaveBeenCalled();
    // signed in again: a later expiry opens a new dialog
    await api.compat().catch(() => {});
    await settle();
    expect(h.askText).toHaveBeenCalledTimes(3);
  });
});

describe('side chat iframe', () => {
  it('no probe and no dialog; a write timeout still reloads the data', async () => {
    const h = setup({ embedded: true, answers: ['juste'] });
    down();
    await api.compat().catch(() => {});
    expect(connectionState().serverDown).toBe(false);
    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(h.probe).not.toHaveBeenCalled();
    expired();
    await api.compat().catch(() => {});
    await settle();
    expect(h.askText).not.toHaveBeenCalled();
  });
});
