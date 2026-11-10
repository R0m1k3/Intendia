import type { CompatService } from '../compat/service.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import {
  ActionStartSchema, ActionStatusSchema, actionName, ContentSchema, HubOfficialSchema, HubSearchSchema, ScanSchema,
  SkillListSchema, ToolsetListSchema, UPDATE_ACTION, type HermesHubResult, type HermesScan, type HermesSkill,
} from '../connectors/skills/index.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';

export interface PublicSkill {
  name: string;
  description: string | null;
  category: string | null;
  /** null: the list came from a route without the enabled state (API server fallback). */
  enabled: boolean | null;
  provenance: string | null;
  usage: number;
  locked: boolean;
}

export interface PublicToolset {
  name: string;
  label: string;
  description: string | null;
  enabled: boolean | null;
  configured: boolean | null;
  tools: string[];
}

export interface PublicHubResult {
  name: string;
  identifier: string;
  description: string | null;
  source: string | null;
  trust: string | null;
  repo: string | null;
  tags: string[];
  installed: boolean;
}

export interface PublicScan {
  verdict: string;
  policy: string;
  reason: string | null;
  summary: string | null;
  trust: string | null;
  findings: Record<string, unknown>[];
  counts: Record<string, number>;
}

export interface PublicActionStatus {
  running: boolean;
  exitCode: number | null;
  lines: string[];
  /** No start header in the tail: the beginning of this run's log is cut. */
  truncated: boolean;
}

/** The scan does not allow the install (block, ask without consent, unknown policy). */
export class ScanRefusedError extends Error {
  readonly code = 'scan_refused';
  constructor(message: string, readonly scan: PublicScan) {
    super(message);
    this.name = 'ScanRefusedError';
  }
}

/** An action with the same Hermes name is running (Hermes keeps one process per name). */
export class ActionBusyError extends Error {
  readonly code = 'busy';
  constructor(readonly action: string) {
    super('Une action identique est en cours');
    this.name = 'ActionBusyError';
  }
}

export const CONTENT_MAX = 200_000;
const SLOW_MS = 40_000;
const INSTALL_MS = 60_000;
const STATUS_LINES = 200;
const KEEP_LINES = 20;
const LINE_MAX = 300;
const EMOJI_RE = /^\p{Extended_Pictographic}️?\s*/u;

/** Hermes 404 → NotFoundError (unknown profile, skill or action, with Hermes' message), 400/422 → ValidationError. */
async function translate<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HermesError && err.kind === 'http') {
      if (err.detail.status === 404) throw new NotFoundError(`${what} : ${hermesDetail(err)}`);
      if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(`Requête refusée par Hermes : ${hermesDetail(err)}`);
    }
    throw err;
  }
}

function toSkill(s: HermesSkill): PublicSkill {
  return {
    name: s.name,
    description: s.description ?? null,
    category: s.category ?? null,
    enabled: s.enabled ?? null,
    provenance: s.provenance ?? null,
    usage: s.usage ?? 0,
    locked: s.locked ?? false,
  };
}

function toScan(s: HermesScan): PublicScan {
  return {
    verdict: s.verdict,
    policy: s.policy,
    reason: s.policy_reason ?? null,
    summary: s.summary ?? null,
    trust: s.trust_level ?? null,
    findings: (s.findings ?? []) as Record<string, unknown>[],
    counts: s.severity_counts ?? {},
  };
}

function toHub(r: HermesHubResult, installedIds?: Record<string, unknown>): PublicHubResult {
  const installed = r.installed
    ?? Boolean(installedIds && (r.identifier in installedIds || (r.source === 'clawhub' && `clawhub/${r.identifier}` in installedIds)));
  return {
    name: r.name,
    identifier: r.identifier,
    description: r.description ?? null,
    source: r.source ?? null,
    trust: r.trust_level ?? null,
    repo: r.repo ?? null,
    tags: r.tags ?? [],
    installed,
  };
}

/** Lines of the last run only (Hermes appends every run to one log per action name), capped. */
export function lastRunLines(name: string, lines: string[]): { lines: string[]; truncated: boolean } {
  const header = `=== ${name} started`;
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith(header)) { start = i + 1; break; }
  }
  const run = (start >= 0 ? lines.slice(start) : lines).filter((l, i, all) => l !== '' || (i > 0 && i < all.length - 1));
  return { lines: run.slice(-KEEP_LINES).map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l)), truncated: start < 0 };
}

export class SkillService {
  /** Starts in flight (`inst:action`): closes the gap between the busy check and the Hermes call. */
  private readonly starting = new Set<string>();

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore) {}

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId) };
  }

  async list(instanceId: string, profile: string): Promise<PublicSkill[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'list', { profile }), 'Agent introuvable');
    const parsed = SkillListSchema.parse(raw);
    return (Array.isArray(parsed) ? parsed : parsed.data).map(toSkill);
  }

  async setEnabled(instanceId: string, profile: string, name: string, enabled: boolean): Promise<PublicSkill> {
    // Hermes accepts any name and adds it to the disabled list: check first
    if (!(await this.list(instanceId, profile)).some((s) => s.name === name)) throw new NotFoundError(`Skill introuvable : ${name}`);
    const { http, report } = this.ctx(instanceId);
    await translate(() => callOp(http, report, 'skills', 'toggle', { profile, body: { name, enabled } }), 'Skill introuvable');
    const skill = (await this.list(instanceId, profile)).find((s) => s.name === name);
    if (!skill) throw new NotFoundError(`Skill introuvable : ${name}`);
    return skill;
  }

  async content(instanceId: string, profile: string, name: string): Promise<{ name: string; content: string; truncated: boolean }> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'content', { profile, query: { name } }), 'Skill introuvable');
    const { content } = ContentSchema.parse(raw);
    return { name, content: content.slice(0, CONTENT_MAX), truncated: content.length > CONTENT_MAX };
  }

  async toolsets(instanceId: string, profile: string): Promise<PublicToolset[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'toolsets', { profile }), 'Agent introuvable');
    const parsed = ToolsetListSchema.parse(raw);
    return (Array.isArray(parsed) ? parsed : parsed.data).map((t) => ({
      name: t.name,
      label: (t.label ?? t.name).replace(EMOJI_RE, '') || t.name,
      description: t.description ?? null,
      enabled: t.enabled ?? null,
      configured: t.configured ?? null,
      tools: t.tools ?? [],
    }));
  }

  async official(instanceId: string, profile: string): Promise<{ results: PublicHubResult[]; timedOut: string[] }> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'hubOfficial', { profile }), 'Agent introuvable');
    return { results: HubOfficialSchema.parse(raw).skills.map((r) => toHub(r)), timedOut: [] };
  }

  async search(instanceId: string, profile: string, q: string): Promise<{ results: PublicHubResult[]; timedOut: string[] }> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(
      () => callOp<unknown>(http, report, 'skills', 'hubSearch', { profile, query: { q, limit: 30 }, timeoutMs: SLOW_MS }),
      'Agent introuvable',
    );
    const parsed = HubSearchSchema.parse(raw);
    return { results: parsed.results.map((r) => toHub(r, parsed.installed)), timedOut: parsed.timed_out ?? [] };
  }

  async scan(instanceId: string, profile: string, identifier: string): Promise<PublicScan> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(
      () => callOp<unknown>(http, report, 'skills', 'hubScan', { profile, query: { identifier }, timeoutMs: SLOW_MS }),
      'Skill introuvable dans le hub',
    );
    return toScan(ScanSchema.parse(raw));
  }

  async install(instanceId: string, profile: string, identifier: string, acknowledged: boolean): Promise<{ action: string }> {
    // --yes answers Hermes' own "ask" prompt: the consent is checked here, from a fresh scan
    const scan = await this.scan(instanceId, profile, identifier);
    const allowed = scan.policy === 'allow' || (scan.policy === 'ask' && acknowledged);
    if (!allowed) {
      throw new ScanRefusedError(
        scan.policy === 'block' ? 'Installation refusée par le scan de sécurité'
          : scan.policy === 'ask' ? 'Le scan demande une confirmation' : `Résultat de scan inconnu : ${scan.policy}`,
        scan,
      );
    }
    return this.start(instanceId, actionName('install', identifier), () =>
      this.write(instanceId, 'install', { profile, body: { identifier }, timeoutMs: INSTALL_MS }));
  }

  uninstall(instanceId: string, profile: string, name: string): Promise<{ action: string }> {
    return this.start(instanceId, actionName('uninstall', name), () => this.write(instanceId, 'uninstall', { profile, body: { name } }));
  }

  update(instanceId: string, profile: string): Promise<{ action: string }> {
    return this.start(instanceId, UPDATE_ACTION, () => this.write(instanceId, 'update', { profile, body: {} }));
  }

  async actionStatus(instanceId: string, action: string): Promise<PublicActionStatus> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(
      () => callOp<unknown>(http, report, 'skills', 'actionStatus', { params: { name: action }, query: { lines: STATUS_LINES } }),
      'Action inconnue',
    );
    const s = ActionStatusSchema.parse(raw);
    return { running: s.running, exitCode: s.exit_code, ...lastRunLines(action, s.lines) };
  }

  private async write(instanceId: string, op: 'install' | 'uninstall' | 'update', opts: Parameters<typeof callOp>[4]): Promise<string> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', op, opts), 'Skill introuvable');
    const parsed = ActionStartSchema.safeParse(raw);
    if (!parsed.success) throw new HermesError('schema', `skills.${op}: unexpected response shape`);
    return parsed.data.name;
  }

  private async start(instanceId: string, expected: string, run: () => Promise<string>): Promise<{ action: string }> {
    const key = `${instanceId}:${expected}`;
    if (this.starting.has(key)) throw new ActionBusyError(expected);
    this.starting.add(key);
    try {
      await this.busy(instanceId, expected);
      return { action: await run() };
    } finally {
      this.starting.delete(key);
    }
  }

  /** Throws ActionBusyError while an action of that name runs; an unknown action (404) is free. */
  private async busy(instanceId: string, action: string): Promise<void> {
    const { http, report } = this.ctx(instanceId);
    let running = false;
    try {
      const raw = await callOp<unknown>(http, report, 'skills', 'actionStatus', { params: { name: action }, query: { lines: 1 } });
      running = ActionStatusSchema.parse(raw).running;
    } catch (err) {
      if (!(err instanceof HermesError && err.kind === 'http' && err.detail.status === 404)) throw err;
    }
    if (running) throw new ActionBusyError(action);
  }
}
