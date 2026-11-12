/**
 * Simulated Hermes profiles (dashboard /api/profiles*), shapes of Hermes 0.23.0 (checked 2026-11-10).
 * Starts from the recorded list; creation, description and SOUL.md live in memory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Profile = Record<string, unknown> & { name: string; description: string };

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = new Set(['hermes', 'default', 'test', 'tmp', 'root', 'sudo']);
export const FAKE_SOUL = 'You are Hermes Agent.\n\nKeep answers short. Example header: Authorization: Bearer fake-soul-token-1234567890\n';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface GatewayAction { running: boolean; exit_code: number | null; lines: string[] }

/** Profiles whose gateway refuses: `multi` is served by the multiplexer, `occupe` has live sessions. */
export const MULTIPLEXED_PROFILE = 'multi';
export const BUSY_PROFILE = 'occupe';

export class ProfileStore {
  profiles: Profile[] = [];
  souls = new Map<string, string>();
  /** Profiles whose gateway was stopped: their API server answers 503. */
  readonly stopped = new Set<string>();
  /** Last `PUT /api/profiles/{name}/model` and `POST /api/profiles` bodies (tests). */
  readonly writes: { path: string; body: unknown }[] = [];
  private readonly actions = new Map<string, GatewayAction>();

  constructor(fixturesDir: string, private readonly stepMs = 5) {
    const file = join(fixturesDir, 'dash', 'GET_api_profiles.json');
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { body: { profiles: [] } };
    this.profiles = (raw.body?.profiles ?? []).map((p: Profile) => ({ ...p }));
    for (const p of this.profiles) this.souls.set(p.name, FAKE_SOUL);
  }

  has(name: string): boolean {
    return this.profiles.some((p) => p.name === name);
  }

  names(): string[] {
    return this.profiles.map((p) => p.name);
  }

  private runAction(name: string, lines: string[], done: () => void): void {
    const prev = this.actions.get(name);
    const a: GatewayAction = { running: true, exit_code: null, lines: [...(prev?.lines ?? []), '', `=== ${name} started 2026-11-12 12:00:00 ===`, ''] };
    this.actions.set(name, a);
    setTimeout(() => {
      a.lines.push(...lines, '');
      a.running = false;
      a.exit_code = 0;
      done();
    }, this.stepMs * 3);
  }

  private gatewayRunning(name: string): boolean {
    return !this.stopped.has(name);
  }

  /** null when the route is not a profiles route. */
  handle(via: 'api' | 'dash', method: string, path: string, body: unknown, query: Record<string, string> = {}): Response | null {
    if (via !== 'dash') return null;
    const b = (body ?? {}) as Record<string, unknown>;
    const profile = query.profile ?? 'default';
    if (method === 'POST' && (path === '/api/gateway/start' || path === '/api/gateway/stop')) {
      const verb = path.endsWith('start') ? 'start' : 'stop';
      if (profile === MULTIPLEXED_PROFILE) {
        return json({ detail: `Profile '${profile}' does not get a gateway of its own: one host gateway serves every profile (multiplexer). Manage it from /opt/data/.hermes.` }, 409);
      }
      if (verb === 'stop' && profile === BUSY_PROFILE && query.interrupt !== 'true') {
        return json({ detail: `2 live sessions on '${profile}': stop with interrupt to end them.` }, 409);
      }
      const name = `gateway-${verb}`;
      this.runAction(name, [verb === 'stop' ? `Gateway for ${profile} stopped token=sk-test-gw-0010` : `Gateway for ${profile} started`], () => {
        if (verb === 'stop') this.stopped.add(profile);
        else this.stopped.delete(profile);
      });
      return json({ ok: true, pid: 4343, name });
    }
    const act = /^\/api\/actions\/(gateway-start|gateway-stop)\/status$/.exec(path);
    if (act && method === 'GET') {
      const a = this.actions.get(act[1]!);
      if (!a) return json({ detail: `Unknown action: ${act[1]}` }, 404);
      return json({ name: act[1], running: a.running, exit_code: a.exit_code, pid: 4343, lines: a.lines.slice(-Number(query.lines ?? 200)) });
    }
    if (method === 'GET' && path === '/api/profiles') return json({ profiles: this.profiles.map((p) => ({ ...p, gateway_running: this.gatewayRunning(p.name) })) });
    if (method === 'GET' && path === '/api/plugins/kanban/profiles') {
      return json({
        profiles: this.profiles.map((p) => ({
          name: p.name, is_default: p.is_default, model: p.model, provider: p.provider, description: p.description,
          description_auto: false, skill_count: p.skill_count,
        })),
      });
    }
    if (method === 'POST' && path === '/api/profiles') {
      this.writes.push({ path, body });
      const name = String(b.name ?? '');
      if (!NAME_RE.test(name)) return json({ detail: `Invalid profile name '${name}'.` }, 400);
      if (RESERVED.has(name)) return json({ detail: `Profile name '${name}' is reserved.` }, 400);
      if (this.has(name)) return json({ detail: `Profile '${name}' already exists.` }, 400);
      const from = typeof b.clone_from === 'string' && b.clone_from ? this.profiles.find((p) => p.name === b.clone_from) : undefined;
      if (b.clone_from && !from) return json({ detail: `Profile '${String(b.clone_from)}' does not exist.` }, 400);
      this.profiles.push({
        name, path: `/opt/data/profiles/${name}`, is_default: false, model: from?.model ?? null, provider: from?.provider ?? null,
        has_env: false, skill_count: from?.skill_count ?? 44, gateway_running: false,
        description: typeof b.description === 'string' ? b.description : '', description_auto: false,
      });
      const soul = typeof b.soul === 'string' ? b.soul : null;
      this.souls.set(name, soul ?? (from ? this.souls.get(from.name) ?? '' : ''));
      const created = this.profiles.at(-1)!;
      let modelError = '';
      if (typeof b.model === 'string' && b.model) {
        if (b.model.includes('refuse')) modelError = `Model '${b.model}' is not available for provider '${String(b.provider)}' (see /opt/data/profiles/${name}/config.yaml)`;
        else { created.model = b.model; created.provider = b.provider ?? null; }
      }
      return json({ ok: true, name, path: `/opt/data/profiles/${name}`, model_set: Boolean(b.model) && !modelError, model_error: modelError, mcp_written: 0, skills_disabled: 0, hub_installs: [], soul_set: soul !== null });
    }
    const del = /^\/api\/profiles\/([^/]+)$/.exec(path);
    if (del && method === 'DELETE') {
      const name = decodeURIComponent(del[1]!);
      if (name === 'default') return json({ detail: 'Cannot delete the default profile.' }, 400);
      const i = this.profiles.findIndex((x) => x.name === name);
      if (i < 0) return json({ detail: `Profile '${name}' does not exist.` }, 404);
      this.profiles.splice(i, 1);
      this.souls.delete(name);
      this.stopped.delete(name);
      if (name.startsWith('lent')) return json({ ok: true, path: `/opt/data/profiles/${name}`, identity_settled: false, settlement_pending: true, retry_command: `hermes profile delete ${name} --yes` });
      return json({ ok: true, path: `/opt/data/profiles/${name}` });
    }
    let m = /^\/api\/profiles\/([^/]+)\/(soul|description|model|describe-auto)$/.exec(path);
    if (m) {
      const name = decodeURIComponent(m[1]!);
      const p = this.profiles.find((x) => x.name === name);
      if (!p) return json({ detail: `Profile '${name}' does not exist.` }, 404);
      if (m[2] === 'soul' && method === 'GET') return json({ content: this.souls.get(name) ?? '' });
      if (m[2] === 'soul' && method === 'PUT') {
        this.souls.set(name, String(b.content ?? ''));
        return json({ ok: true, name });
      }
      if (m[2] === 'model' && method === 'PUT') {
        this.writes.push({ path, body });
        if (String(b.model ?? '').includes('refuse')) return json({ detail: `Model '${String(b.model)}' is not available` }, 400);
        p.model = String(b.model ?? '');
        p.provider = String(b.provider ?? '');
        return json({ ok: true, name, provider: p.provider, model: p.model });
      }
      if (m[2] === 'describe-auto' && method === 'POST') {
        if (name === 'muet') return json({ ok: false, reason: 'no auxiliary model', description: '' });
        const description = 'Agent de test';
        if (b.overwrite || !p.description) p.description = description;
        return json({ ok: true, reason: '', description });
      }
      if (m[2] === 'description' && method === 'PUT') {
        p.description = String(b.description ?? '');
        return json({ ok: true, name, description: p.description });
      }
      return null;
    }
    m = /^\/api\/plugins\/kanban\/profiles\/([^/]+)$/.exec(path);
    if (m && method === 'PATCH') {
      const p = this.profiles.find((x) => x.name === decodeURIComponent(m![1]!));
      if (!p) return json({ detail: 'profile not found' }, 404);
      p.description = String(b.description ?? '');
      return json({ ok: true, name: p.name, description: p.description });
    }
    return null;
  }
}
