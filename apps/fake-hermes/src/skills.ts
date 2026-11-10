// In-memory skills for fake-hermes (dashboard only), modelled on Hermes 0.23.0:
// install / uninstall / update start a background action followed through /api/actions/{name}/status.
// One state for every profile: ?profile= is only logged.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Via = 'api' | 'dash';

interface Skill {
  name: string;
  description: string;
  category: string;
  locked: boolean;
  enabled: boolean;
  usage: number;
  provenance: string;
}

interface HubEntry {
  name: string;
  description: string;
  source: string;
  identifier: string;
  trust_level: string;
  repo: string | null;
  tags: string[];
  category: string;
  policy: 'allow' | 'ask' | 'block';
}

interface Action {
  name: string;
  running: boolean;
  exit_code: number | null;
  pid: number;
  lines: string[];
  timer?: ReturnType<typeof setTimeout>;
}

const EXTRA_HUB: HubEntry[] = [
  {
    name: 'caution-skill', description: 'Community skill whose scan asks for confirmation.', source: 'github',
    identifier: 'fake/caution-skill', trust_level: 'community', repo: 'someone/skills', tags: ['demo'], category: 'productivity', policy: 'ask',
  },
  {
    name: 'dangerous-skill', description: 'Community skill blocked by the security scan.', source: 'github',
    identifier: 'fake/dangerous-skill', trust_level: 'community', repo: 'someone/skills', tags: ['demo'], category: 'productivity', policy: 'block',
  },
];

const VERDICT = { allow: 'safe', ask: 'caution', block: 'dangerous' } as const;

/** Same rule as Hermes `_hub_action_name` (copied; server tests check it against real names). */
function hubActionName(verb: string, key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill';
  return `skills-${verb}-${slug}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function fixture<T>(dir: string, file: string): T {
  return (JSON.parse(readFileSync(join(dir, 'dash', file), 'utf8')) as { body: T }).body;
}

export class SkillStore {
  readonly skills: Skill[];
  readonly hub: HubEntry[];
  readonly actions = new Map<string, Action>();
  private pid = 9000;

  constructor(fixturesDir: string, private readonly stepMs: number) {
    this.skills = fixture<Skill[]>(fixturesDir, 'GET_api_skills.json').map((s) => ({ ...s }));
    const official = fixture<{ skills: Omit<HubEntry, 'policy'>[] }>(fixturesDir, 'GET_api_skills_hub_official.json').skills;
    this.hub = [...official.map((e) => ({ ...e, policy: 'allow' as const })), ...EXTRA_HUB];
  }

  private installed(e: HubEntry): boolean {
    return this.skills.some((s) => s.name === e.name && s.provenance === 'hub');
  }

  private pub(e: HubEntry) {
    const { policy: _p, ...rest } = e;
    return rest;
  }

  private start(name: string, work: () => { code: number; lines: string[] }): Response {
    const prev = this.actions.get(name);
    if (prev?.timer) clearTimeout(prev.timer);
    const action: Action = {
      name, running: true, exit_code: null, pid: ++this.pid,
      lines: [...(prev?.lines ?? []), '', `=== ${name} started 2026-11-09 12:00:00 ===`, ''],
    };
    this.actions.set(name, action);
    action.timer = setTimeout(() => {
      const out = work();
      action.lines.push(...out.lines, '');
      action.exit_code = out.code;
      action.running = false;
      action.timer = undefined;
    }, this.stepMs);
    return json({ ok: true, pid: action.pid, name });
  }

  /** null when the route is not a skills route. */
  async handle(via: Via, method: string, path: string, query: Record<string, string>, body: unknown): Promise<Response | null> {
    if (via !== 'dash') return null;
    const b = (body ?? {}) as Record<string, unknown>;

    if (method === 'GET' && path === '/api/skills') return json(this.skills);
    if (method === 'PUT' && path === '/api/skills/toggle') {
      const name = String(b.name ?? '');
      const enabled = Boolean(b.enabled);
      // like Hermes: an unknown name is accepted
      const s = this.skills.find((x) => x.name === name);
      if (s) s.enabled = enabled;
      return json({ ok: true, name, enabled });
    }
    if (method === 'GET' && path === '/api/skills/content') {
      const s = this.skills.find((x) => x.name === query.name);
      if (!s) return json({ detail: `Skill '${query.name}' not found.` }, 404);
      const requires = s.name === 'claude-code' ? '    requires_toolsets: [terminal]\n' : '';
      const content = `---\nname: ${s.name}\ndescription: ${s.description}\nmetadata:\n  hermes:\n${requires}---\n\n# ${s.name}\n\n${s.description}\n\n<script>alert(1)</script> stays text.\n`;
      return json({ name: s.name, content, path: `/opt/hermes/skills/${s.category}/${s.name}/SKILL.md` });
    }
    if (method === 'GET' && path === '/api/tools/toolsets') return null; // fixture
    if (method === 'GET' && path === '/api/skills/hub/official') {
      return json({ skills: this.hub.filter((e) => e.source === 'official').map((e) => ({ ...this.pub(e), installed: this.installed(e) })) });
    }
    if (method === 'GET' && path === '/api/skills/hub/search') {
      const q = (query.q ?? '').trim().toLowerCase();
      if (!q) return json({ results: [], source_counts: {}, timed_out: [], installed: {} });
      const slow = q.includes('lent');
      if (slow) await new Promise((r) => setTimeout(r, this.stepMs * 10));
      const words = q.split(/\s+/).filter((w) => w !== 'lent');
      const results = this.hub.filter((e) => words.every((w) => `${e.name} ${e.description} ${e.identifier}`.toLowerCase().includes(w)));
      const installed = Object.fromEntries(this.hub.filter((e) => this.installed(e)).map((e) => [e.identifier, { name: e.name }]));
      return json({
        results: results.slice(0, Number(query.limit ?? 20)).map((e) => this.pub(e)),
        source_counts: { official: results.filter((e) => e.source === 'official').length, github: results.filter((e) => e.source === 'github').length },
        timed_out: slow ? ['github'] : [], installed,
      });
    }
    if (method === 'GET' && path === '/api/skills/hub/scan') {
      const e = this.hub.find((x) => x.identifier === query.identifier);
      if (!e) return json({ detail: `Skill not found: ${query.identifier}` }, 404);
      const findings = e.policy === 'allow' ? [] : [{ severity: e.policy === 'block' ? 'critical' : 'medium', rule: 'fake-rule', message: 'Runs a remote script' }];
      return json({
        name: e.name, identifier: e.identifier, source: e.source, trust_level: e.trust_level, verdict: VERDICT[e.policy],
        summary: `${e.name}: ${e.policy === 'allow' ? 'clean scan, no threats detected' : 'findings to review'}`,
        policy: e.policy, policy_reason: e.policy === 'allow' ? 'Allowed (builtin source, safe verdict)' : e.policy === 'ask' ? 'Community source, caution verdict' : 'Community source, dangerous verdict',
        findings, severity_counts: { critical: e.policy === 'block' ? 1 : 0, high: 0, medium: e.policy === 'ask' ? 1 : 0, low: 0 }, tier1: null,
      });
    }
    if (method === 'POST' && path === '/api/skills/hub/install') {
      const identifier = String(b.identifier ?? '').trim();
      if (!identifier) return json({ detail: 'identifier is required' }, 400);
      return this.start(hubActionName('install', identifier), () => {
        const e = this.hub.find((x) => x.identifier === identifier);
        if (!e) return { code: 1, lines: [`Fetching: ${identifier}`, `Error: Could not download '${identifier}'.`] };
        if (e.policy === 'block') return { code: 1, lines: [`Fetching: ${identifier}`, 'Scan: DANGEROUS', `Installation blocked: '${e.name}' has high-risk findings.`] };
        if (this.installed(e)) return { code: 0, lines: [`'${e.name}' is already installed. Use --force to reinstall.`] };
        this.skills.push({ name: e.name, description: e.description, category: e.category, locked: false, enabled: true, usage: 0, provenance: 'hub' });
        return { code: 0, lines: [`Fetching: ${identifier}`, `Scan: ${e.name} Verdict: ${VERDICT[e.policy].toUpperCase()}`, `Installed: ${e.category}/${e.name}`] };
      });
    }
    if (method === 'POST' && path === '/api/skills/hub/uninstall') {
      const name = String(b.name ?? '').trim();
      if (!name) return json({ detail: 'name is required' }, 400);
      return this.start(hubActionName('uninstall', name), () => {
        const i = this.skills.findIndex((s) => s.name === name && s.provenance === 'hub');
        if (i < 0) return { code: 1, lines: [`Error: '${name}' is not a hub-installed skill (may be a builtin)`] };
        const [s] = this.skills.splice(i, 1);
        return { code: 0, lines: [`Uninstalled '${name}' from ${s!.category}/${name}`] };
      });
    }
    if (method === 'POST' && path === '/api/skills/hub/update') {
      return this.start('skills-update', () => ({ code: 0, lines: ['No updates available.'] }));
    }
    const m = /^\/api\/actions\/([^/]+)\/status$/.exec(path);
    if (method === 'GET' && m) {
      const a = this.actions.get(decodeURIComponent(m[1]!));
      if (!a) return json({ detail: `Unknown action: ${m[1]}` }, 404);
      return json({ name: a.name, running: a.running, exit_code: a.exit_code, pid: a.pid, lines: a.lines.slice(-Number(query.lines ?? 200)) });
    }
    return null;
  }
}
