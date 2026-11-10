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

export class ProfileStore {
  profiles: Profile[] = [];
  souls = new Map<string, string>();

  constructor(fixturesDir: string) {
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

  /** null when the route is not a profiles route. */
  handle(via: 'api' | 'dash', method: string, path: string, body: unknown): Response | null {
    if (via !== 'dash') return null;
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === 'GET' && path === '/api/profiles') return json({ profiles: this.profiles });
    if (method === 'GET' && path === '/api/plugins/kanban/profiles') {
      return json({
        profiles: this.profiles.map((p) => ({
          name: p.name, is_default: p.is_default, model: p.model, provider: p.provider, description: p.description,
          description_auto: false, skill_count: p.skill_count,
        })),
      });
    }
    if (method === 'POST' && path === '/api/profiles') {
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
      this.souls.set(name, from ? this.souls.get(from.name) ?? '' : '');
      return json({ ok: true, name, path: `/opt/data/profiles/${name}`, model_set: false, model_error: '', mcp_written: 0, skills_disabled: 0, hub_installs: [], soul_set: false });
    }
    let m = /^\/api\/profiles\/([^/]+)\/(soul|description)$/.exec(path);
    if (m) {
      const name = decodeURIComponent(m[1]!);
      const p = this.profiles.find((x) => x.name === name);
      if (!p) return json({ detail: `Profile '${name}' does not exist.` }, 404);
      if (m[2] === 'soul' && method === 'GET') return json({ content: this.souls.get(name) ?? '' });
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
