/**
 * Accounts (OAuth) and credential pool of the dashboard, per profile (each Hermes profile has its own auth.json):
 * GET /api/providers/oauth, POST …/{id}/start, GET …/{id}/poll/{session}, DELETE …/sessions/{session},
 * DELETE …/{id}; GET/POST /api/credentials/pool, DELETE …/{provider}/{index}.
 * - `start` of an `external` provider → 400 like Hermes; a device-code session gives `FAKE-1234`, `poll` answers
 *   `pending` once then `approved` (`xai-oauth` → `denied`); `nous` approved also writes the main model (`onModel`).
 * - cancelling removes the session (a later poll → 404), like `cancel_oauth_session`.
 * - a key containing `refuse` → 400 whose detail repeats the key (Hermes answers `str(exc)`).
 * - starts with no account connected and an empty pool (`seedSamples` adds an env entry and an OAuth login).
 * - `anthropic` (« Anthropic Account », external, not disconnectable: 400 like Hermes): connected by its variables,
 *   read at each call in Hermes's order (`ANTHROPIC_API_KEY`, `ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`,
 *   `source: env_var`), unless a test set `logged_in` with `setAccount`.
 */

type Obj = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export interface FakeAccount {
  id: string; name: string; flow: 'device_code' | 'external'; cli_command: string; docs_url: string;
  disconnectable: boolean; logged_in: boolean; source_label: string; source?: string;
}
export interface FakePoolEntry {
  provider: string; id: string; label: string; auth_type: string; source: string; access_token: string; last_status: string | null;
}
interface Session { provider: string; profile: string; polls: number }

export const NOUS_MODEL = 'nous/hermes-4';

function startAccounts(): FakeAccount[] {
  const a = (id: string, name: string, flow: FakeAccount['flow'], extra: Partial<FakeAccount> = {}): FakeAccount => ({
    id, name, flow, cli_command: `hermes auth add ${id}`, docs_url: `https://example.test/docs/${id}`, disconnectable: true,
    logged_in: false, source_label: name, ...extra,
  });
  return [
    a('nous', 'Nous Portal', 'device_code'),
    a('openai-codex', 'OpenAI Codex', 'device_code'),
    a('xai-oauth', 'xAI', 'device_code', { source_label: '/opt/data/auth.json' }),
    a('minimax-oauth', 'MiniMax (OAuth)', 'device_code'),
    a('anthropic', 'Anthropic Account', 'external', { disconnectable: false }),
    a('claude-code', 'Anthropic OAuth: Required Extra Usage Credits to Use Subscription', 'external', { cli_command: 'claude setup-token', disconnectable: false }),
  ];
}

/** Entries Hermes adds by itself (a key variable, an OAuth login), added by `seedSamples` for tests. */
export const SAMPLE_POOL: FakePoolEntry[] = [
    { provider: 'mistral', id: 'env001', label: 'MISTRAL_API_KEY', auth_type: 'api_key', source: 'env:MISTRAL_API_KEY', access_token: 'sk-test-mistral-env-0001', last_status: 'ok' },
    { provider: 'openai-codex', id: 'oau001', label: 'device_code', auth_type: 'oauth', source: 'device_code', access_token: 'sk-test-codex-oauth-0001', last_status: null },
];

/** Variables Hermes reads for Anthropic, in its order. */
export const ANTHROPIC_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;

const preview = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}...${t.slice(-4)}` : '');

export class ProviderStore {
  private readonly accounts = new Map<string, FakeAccount[]>();
  private readonly pools = new Map<string, FakePoolEntry[]>();
  private readonly sessions = new Map<string, Session>();
  private seq = 0;

  /** `onModel(model)`: called when an approved login also chooses the main model (Nous). */
  constructor(private readonly onModel: (model: string) => void, private readonly envIsSet: (key: string) => boolean = () => false) {}

  /** The card as read now: Anthropic follows its variables unless a test connected it by `setAccount`. */
  private view(a: FakeAccount): FakeAccount {
    if (a.id !== 'anthropic' || a.logged_in) return a;
    const v = ANTHROPIC_VARS.find((k) => this.envIsSet(k));
    return v ? { ...a, logged_in: true, source: 'env_var', source_label: `${v} (.env)` } : a;
  }

  accountsOf(profile: string): FakeAccount[] {
    let list = this.accounts.get(profile);
    if (!list) this.accounts.set(profile, (list = startAccounts()));
    return list;
  }

  poolOf(profile: string): FakePoolEntry[] {
    let list = this.pools.get(profile);
    if (!list) this.pools.set(profile, (list = []));
    return list;
  }

  /** Tests: a `MISTRAL_API_KEY` entry and a connected OpenAI Codex account with its OAuth pool entry. */
  seedSamples(profile = 'default'): void {
    const pool = this.poolOf(profile);
    for (const e of SAMPLE_POOL) if (!pool.some((x) => x.id === e.id)) pool.push({ ...e });
    this.setAccount(profile, 'openai-codex', { logged_in: true });
  }

  /** Tests: changes one account (e.g. `disconnectable: false`). */
  setAccount(profile: string, id: string, patch: Partial<FakeAccount>): void {
    const acc = this.accountsOf(profile).find((a) => a.id === id);
    if (acc) Object.assign(acc, patch);
  }

  /** Providers with a credential for this profile: a connected account or an API key of the pool. */
  authenticated(profile: string): Set<string> {
    const out = new Set(this.accountsOf(profile).map((a) => this.view(a)).filter((a) => a.logged_in).map((a) => a.id));
    for (const e of this.poolOf(profile)) if (e.auth_type === 'api_key') out.add(e.provider);
    return out;
  }

  handle(method: string, path: string, profile: string, body: unknown): Response | null {
    const b = (body ?? {}) as Obj;
    if (path === '/api/providers/oauth' && method === 'GET') {
      return json({
        providers: this.accountsOf(profile).map((x) => this.view(x)).map((a) => ({
          id: a.id, name: a.name, flow: a.flow, cli_command: a.cli_command, docs_url: a.docs_url,
          disconnect_hint: a.disconnectable ? null : 'Managed by that provider\'s CLI; remove it there.',
          disconnect_command: null, disconnectable: a.disconnectable,
          status: { logged_in: a.logged_in, source: a.source ?? a.id, source_label: a.source_label, token_preview: a.logged_in ? 'sk-t...0001' : '', expires_at: a.logged_in ? '2026-12-31T00:00:00Z' : null, has_refresh_token: a.logged_in },
        })),
      });
    }
    const cancel = /^\/api\/providers\/oauth\/sessions\/([^/]+)$/.exec(path);
    if (cancel && method === 'DELETE') {
      const sid = decodeURIComponent(cancel[1]!);
      return json({ ok: this.sessions.delete(sid), session_id: sid });
    }
    const start = /^\/api\/providers\/oauth\/([^/]+)\/start$/.exec(path);
    if (start && method === 'POST') {
      const id = decodeURIComponent(start[1]!);
      const acc = this.accountsOf(profile).find((a) => a.id === id);
      if (!acc) return json({ detail: `Unknown provider ${id}` }, 400);
      if (acc.flow === 'external') return json({ detail: `${id} uses an external CLI; run \`${acc.cli_command}\` manually` }, 400);
      const sid = `sess${++this.seq}`;
      this.sessions.set(sid, { provider: id, profile, polls: 0 });
      return json({ session_id: sid, flow: 'device_code', user_code: 'FAKE-1234', verification_url: 'https://example.test/device', expires_in: 900, poll_interval: 2 });
    }
    const poll = /^\/api\/providers\/oauth\/([^/]+)\/poll\/([^/]+)$/.exec(path);
    if (poll && method === 'GET') {
      const id = decodeURIComponent(poll[1]!);
      const sid = decodeURIComponent(poll[2]!);
      const s = this.sessions.get(sid);
      if (!s) return json({ detail: 'Session not found or expired' }, 404);
      if (s.provider !== id) return json({ detail: 'Provider mismatch for session' }, 400);
      if (s.profile !== profile) return json({ detail: 'OAuth session profile mismatch' }, 400);
      s.polls += 1;
      const base = { session_id: sid, error_message: null, expires_at: null, model: null as string | null };
      if (id === 'xai-oauth') return json({ ...base, status: 'denied', error_message: 'access_denied: the user refused' });
      if (s.polls < 2) return json({ ...base, status: 'pending' });
      const acc = this.accountsOf(profile).find((a) => a.id === id);
      if (acc && !acc.logged_in) {
        acc.logged_in = true;
        if (id === 'nous') this.onModel(NOUS_MODEL);
      }
      return json({ ...base, status: 'approved', model: id === 'nous' ? NOUS_MODEL : null });
    }
    const account = /^\/api\/providers\/oauth\/([^/]+)$/.exec(path);
    if (account && method === 'DELETE') {
      const id = decodeURIComponent(account[1]!);
      const acc = this.accountsOf(profile).find((a) => a.id === id);
      if (!acc) return json({ detail: `Unknown provider ${id}` }, 400);
      if (!acc.disconnectable) return json({ detail: `${acc.name} cannot be disconnected automatically. Managed by that provider's CLI; remove it there.` }, 400);
      if (!acc.logged_in) return json({ detail: `No stored credentials were removed for ${acc.name}.` }, 409);
      acc.logged_in = false;
      const pool = this.poolOf(profile);
      this.pools.set(profile, pool.filter((e) => !(e.provider === id && e.auth_type !== 'api_key')));
      return json({ ok: true, provider: id });
    }
    if (path === '/api/credentials/pool' && method === 'GET') {
      const by = new Map<string, FakePoolEntry[]>();
      for (const e of this.poolOf(profile)) by.set(e.provider, [...(by.get(e.provider) ?? []), e]);
      return json({
        providers: [...by.keys()].sort().map((p) => ({
          provider: p,
          entries: by.get(p)!.map((e, i) => ({
            index: i + 1, id: e.id, label: e.label, auth_type: e.auth_type, source: e.source, priority: 0,
            last_status: e.last_status, request_count: 0, token_preview: preview(e.access_token), has_refresh: e.auth_type !== 'api_key',
          })),
        })),
      });
    }
    if (path === '/api/credentials/pool' && method === 'POST') {
      const provider = String(b.provider ?? '').trim().toLowerCase();
      const key = String(b.api_key ?? '').trim();
      if (!provider || !key) return json({ detail: 'provider and api_key are required' }, 400);
      if (key.includes('refuse')) return json({ detail: `invalid key ${key}` }, 400);
      const pool = this.poolOf(profile);
      const mine = pool.filter((e) => e.provider === provider);
      const label = String(b.label ?? '').trim() || `key #${mine.length + 1}`;
      const id = (++this.seq).toString(16).padStart(6, 'a').slice(-6);
      pool.push({ provider, id, label, auth_type: 'api_key', source: 'manual', access_token: key, last_status: null });
      return json({ ok: true, provider, count: mine.length + 1 });
    }
    const remove = /^\/api\/credentials\/pool\/([^/]+)\/([^/]+)$/.exec(path);
    if (remove && method === 'DELETE') {
      const provider = decodeURIComponent(remove[1]!).toLowerCase();
      const index = Number(remove[2]);
      const pool = this.poolOf(profile);
      const mine = pool.filter((e) => e.provider === provider);
      const entry = Number.isInteger(index) ? mine[index - 1] : undefined;
      if (!entry) return json({ detail: 'No pool entry at that index' }, 404);
      pool.splice(pool.indexOf(entry), 1);
      return json({ ok: true, provider, count: mine.length - 1, cleaned: [], hints: [] });
    }
    return null;
  }
}
