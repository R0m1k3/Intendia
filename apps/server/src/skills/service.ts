import { stringify } from 'yaml';
import { AdminError } from '../admin-error.js';
import type { CompatService } from '../compat/service.js';
import { hostPaths, Masker } from '../hermes-config/mask.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import {
  ActionStartSchema, ActionStatusSchema, actionName, ContentSchema, HubOfficialSchema, HubSearchSchema, ScanSchema,
  SkillListSchema, ToolsetListSchema, UPDATE_ACTION, type HermesHubResult, type HermesScan, type HermesSkill,
} from '../connectors/skills/index.js';
import { lastRunLines } from '../connectors/actions.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';
import { msg } from '../i18n/index.js';

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
    super(msg('Une action identique est en cours'));
    this.name = 'ActionBusyError';
  }
}

export const CONTENT_MAX = 200_000;
/** Hermes' own limits (skill_manager_tool.py): name and category, SKILL.md size, description on create. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SKILL_MAX = 100_000;
export const DESCRIPTION_MAX = 60;
/** Only skills the user or the agent wrote can be edited or archived (not hub, bundled or external ones). */
export const ARCHIVABLE_PROVENANCE = 'agent';
const SLOW_MS = 40_000;
const INSTALL_MS = 60_000;
const STATUS_LINES = 200;
const EMOJI_RE = /^\p{Extended_Pictographic}️?\s*/u;

/** Hermes 404 → NotFoundError (unknown profile, skill or action, with Hermes' message), 400/422 → ValidationError. */
async function translate<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HermesError && err.kind === 'http') {
      if (err.detail.status === 404) throw new NotFoundError(msg('{what} : {detail}', { what, detail: hermesDetail(err) }));
      if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(msg('Requête refusée par Hermes : {detail}', { detail: hermesDetail(err) }));
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

export { lastRunLines };

export class SkillService {
  /** Starts in flight (`inst:action`): closes the gap between the busy check and the Hermes call. */
  private readonly starting = new Set<string>();

  private readonly mask: Masker;

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore, secret: string) {
    this.mask = new Masker(secret);
  }

  /** A Hermes refusal of a write, with secrets and host paths hidden ("already exists at <path>"). */
  private async writeOp<T = unknown>(instanceId: string, op: string, opts: Parameters<typeof callOp>[4], what = msg('Skill introuvable')): Promise<T> {
    const { http, report } = this.ctx(instanceId);
    try {
      return await callOp<T>(http, report, 'skills', op, opts);
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') {
        const detail = hostPaths(this.mask.text(hermesDetail(err)));
        if (err.detail.status === 404) throw new NotFoundError(msg('{what} : {detail}', { what, detail }));
        if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(msg('Requête refusée par Hermes : {detail}', { detail }));
        throw new HermesError('http', msg('Hermes a répondu {status} : {detail}', { status: err.detail.status, detail }), err.detail);
      }
      throw err;
    }
  }

  private async own(instanceId: string, profile: string, name: string): Promise<PublicSkill> {
    const skill = (await this.list(instanceId, profile)).find((s) => s.name === name);
    if (!skill) throw new NotFoundError(msg('Skill introuvable : {name}', { name }));
    if (skill.provenance !== ARCHIVABLE_PROVENANCE) {
      throw new AdminError('protected', msg('Seuls les skills écrits par vous ou par l’agent se modifient ici (pas ceux du hub ni ceux fournis)'));
    }
    return skill;
  }

  /**
   * New skill: Intendia writes the front matter (name, description escaped as YAML) above the body. YAML 1.1 like
   * Hermes' PyYAML: `on`, `yes`, `no`, a date… are quoted, else Hermes would read a boolean or a date.
   */
  async create(instanceId: string, profile: string, input: { name: string; category?: string; description: string; body: string }): Promise<PublicSkill> {
    const description = input.description.trim();
    if (!SKILL_NAME_RE.test(input.name)) throw new ValidationError(msg('Nom de skill invalide : minuscules, chiffres, . _ - (64 caractères au plus)'));
    if (input.category && !SKILL_NAME_RE.test(input.category)) throw new ValidationError(msg('Catégorie invalide : minuscules, chiffres, . _ - (64 caractères au plus)'));
    if (!description || description.length > DESCRIPTION_MAX || /[\r\n]/.test(description)) {
      throw new ValidationError(msg('Description d’une ligne, {max} caractères au plus', { max: DESCRIPTION_MAX }));
    }
    if (!input.body.trim()) throw new ValidationError(msg('Le corps du skill est vide'));
    const content = `---\n${stringify({ name: input.name, description }, { version: '1.1' }).trimEnd()}\n---\n\n${input.body.trim()}\n`;
    if (content.length > SKILL_MAX) throw new ValidationError(msg('SKILL.md trop long ({max} caractères au plus)', { max: SKILL_MAX }));
    await this.writeOp(instanceId, 'create', { profile, body: { name: input.name, content, ...(input.category ? { category: input.category } : {}) } });
    const skill = (await this.list(instanceId, profile)).find((s) => s.name === input.name);
    if (!skill) throw new NotFoundError(msg('Skill introuvable après création : {name}', { name: input.name }));
    return skill;
  }

  /** Rewrites SKILL.md from a draft of the masked text (secrets put back from the current content, read again). */
  async putContent(instanceId: string, profile: string, name: string, draft: string): Promise<{ content: string }> {
    await this.own(instanceId, profile, name);
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'content', { profile, query: { name } }), msg('Skill introuvable'));
    const current = ContentSchema.parse(raw).content;
    if (current.length > CONTENT_MAX) throw new AdminError('too_long', msg('SKILL.md trop long pour l’éditeur : modifiez-le dans Hermes'));
    const content = this.mask.restoreText(draft, current);
    if (content.length > SKILL_MAX) throw new ValidationError(msg('SKILL.md trop long ({max} caractères au plus)', { max: SKILL_MAX }));
    if (!content.startsWith('---')) throw new ValidationError(msg('Le SKILL.md doit commencer par son en-tête (---)'));
    await this.writeOp(instanceId, 'putContent', { profile, body: { name, content } });
    return { content: this.mask.text(content) };
  }

  /** Locked: the agent and the curator may no longer change it (the user still can). */
  async lock(instanceId: string, profile: string, name: string, locked: boolean): Promise<PublicSkill> {
    if (!(await this.list(instanceId, profile)).some((s) => s.name === name)) throw new NotFoundError(msg('Skill introuvable : {name}', { name }));
    await this.writeOp(instanceId, 'lock', { profile, body: { name, locked } });
    const skill = (await this.list(instanceId, profile)).find((s) => s.name === name);
    if (!skill) throw new NotFoundError(msg('Skill introuvable : {name}', { name }));
    return skill;
  }

  /** Archives a user or agent skill (Hermes keeps it in skills/.archive; a pinned skill is refused by Hermes). */
  async archive(instanceId: string, profile: string, name: string): Promise<{ ok: true }> {
    await this.own(instanceId, profile, name);
    await this.writeOp(instanceId, 'archive', { profile, body: { id: name, profile } });
    return { ok: true };
  }

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(msg('Instance inconnue : {id}', { id: instanceId }));
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId) };
  }

  async list(instanceId: string, profile: string): Promise<PublicSkill[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'list', { profile }), msg('Agent introuvable'));
    const parsed = SkillListSchema.parse(raw);
    return (Array.isArray(parsed) ? parsed : parsed.data).map(toSkill);
  }

  async setEnabled(instanceId: string, profile: string, name: string, enabled: boolean): Promise<PublicSkill> {
    // Hermes accepts any name and adds it to the disabled list: check first
    if (!(await this.list(instanceId, profile)).some((s) => s.name === name)) throw new NotFoundError(msg('Skill introuvable : {name}', { name }));
    const { http, report } = this.ctx(instanceId);
    await translate(() => callOp(http, report, 'skills', 'toggle', { profile, body: { name, enabled } }), msg('Skill introuvable'));
    const skill = (await this.list(instanceId, profile)).find((s) => s.name === name);
    if (!skill) throw new NotFoundError(msg('Skill introuvable : {name}', { name }));
    return skill;
  }

  async content(instanceId: string, profile: string, name: string): Promise<{ name: string; content: string; truncated: boolean }> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'content', { profile, query: { name } }), msg('Skill introuvable'));
    const { content } = ContentSchema.parse(raw);
    // a skill written by the agent may hold a key: shown (and edited) masked
    return { name, content: this.mask.text(content.slice(0, CONTENT_MAX)), truncated: content.length > CONTENT_MAX };
  }

  async toolsets(instanceId: string, profile: string): Promise<PublicToolset[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'toolsets', { profile }), msg('Agent introuvable'));
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
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', 'hubOfficial', { profile }), msg('Agent introuvable'));
    return { results: HubOfficialSchema.parse(raw).skills.map((r) => toHub(r)), timedOut: [] };
  }

  async search(instanceId: string, profile: string, q: string): Promise<{ results: PublicHubResult[]; timedOut: string[] }> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(
      () => callOp<unknown>(http, report, 'skills', 'hubSearch', { profile, query: { q, limit: 30 }, timeoutMs: SLOW_MS }),
      msg('Agent introuvable'),
    );
    const parsed = HubSearchSchema.parse(raw);
    return { results: parsed.results.map((r) => toHub(r, parsed.installed)), timedOut: parsed.timed_out ?? [] };
  }

  async scan(instanceId: string, profile: string, identifier: string): Promise<PublicScan> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(
      () => callOp<unknown>(http, report, 'skills', 'hubScan', { profile, query: { identifier }, timeoutMs: SLOW_MS }),
      msg('Skill introuvable dans le hub'),
    );
    return toScan(ScanSchema.parse(raw));
  }

  async install(instanceId: string, profile: string, identifier: string, acknowledged: boolean): Promise<{ action: string }> {
    // --yes answers Hermes' own "ask" prompt: the consent is checked here, from a fresh scan
    const scan = await this.scan(instanceId, profile, identifier);
    const allowed = scan.policy === 'allow' || (scan.policy === 'ask' && acknowledged);
    if (!allowed) {
      throw new ScanRefusedError(
        scan.policy === 'block' ? msg('Installation refusée par le scan de sécurité')
          : scan.policy === 'ask' ? msg('Le scan demande une confirmation') : msg('Résultat de scan inconnu : {policy}', { policy: scan.policy }),
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
      msg('Action inconnue'),
    );
    const s = ActionStatusSchema.parse(raw);
    return { running: s.running, exitCode: s.exit_code, ...lastRunLines(action, s.lines) };
  }

  private async write(instanceId: string, op: 'install' | 'uninstall' | 'update', opts: Parameters<typeof callOp>[4]): Promise<string> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'skills', op, opts), msg('Skill introuvable'));
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
