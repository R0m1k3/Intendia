import type { CompatService } from '../compat/service.js';
import {
  BlueprintListSchema, JobGetSchema, JobListSchema, normaliseJobs, RunListSchema, TargetListSchema, updateBody, type HermesJob,
} from '../connectors/crons/index.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import type { FileRoots } from '../files/hermes-fs.js';
import type { InstanceStore } from '../instances/store.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import { blockLines, folderKey, frame, unframe } from '../workspaces/framing.js';
import { NotFoundError, ValidationError, type Workspace, type WorkspaceService } from '../workspaces/service.js';
import { msg } from '../i18n/index.js';

/** A Hermes 400 on a cron write: shown under the matching editor field. */
export class CronInputError extends Error {
  constructor(message: string, readonly field: 'schedule' | null, readonly detail: string) {
    super(message);
    this.name = 'CronInputError';
  }
}

export interface PublicSchedule {
  kind: string;
  minutes: number | null;
  expr: string | null;
  runAt: string | null;
  display: string | null;
}

export interface PublicCron {
  id: string;
  instanceId: string;
  profile: string;
  name: string;
  prompt: string;
  workspace: { slug: string; name: string | null; folder: string; missing: boolean } | null;
  schedule: PublicSchedule;
  enabled: boolean;
  state: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastDeliveryError: string | null;
  failureStreak: number;
  deliver: string | null;
  skills: string[];
  model: string | null;
  /** advanced options (null = Hermes' default) */
  repeat: number | null;
  repeatCompleted: number;
  timezone: string | null;
  enabledToolsets: string[] | null;
  catchUp: boolean | null;
  graceMinutes: number | null;
  contextFrom: string[];
}

export interface PublicBlueprintField {
  name: string;
  type: string;
  label: string;
  default: string | null;
  options: { value: string; label: string }[];
  optional: boolean;
  /** false: the options are only suggestions */
  strict: boolean;
  help: string | null;
}

export interface PublicBlueprint {
  key: string;
  title: string;
  description: string | null;
  category: string | null;
  schedule: string | null;
  fields: PublicBlueprintField[];
  /** "plugin" templates come from an installed Hermes plugin (name in `plugin`) */
  source: string | null;
  plugin: string | null;
}

export interface PublicRun {
  id: string;
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  costUsd: number | null;
  model: string | null;
}

/** An active cron of any instance, for the home page (next runs, timeline, failures, counter). */
export interface OverviewCron {
  instanceId: string;
  instanceLabel: string;
  id: string;
  profile: string;
  name: string;
  schedule: PublicSchedule;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  /** The cron's own IANA time zone, null = Hermes' zone. */
  timezone: string | null;
}

export interface CronInput {
  name: string;
  prompt: string;
  /** Hermes schedule string; optional on update (unchanged when absent). */
  schedule?: string;
  deliver: string;
  skills: string[];
  model: string | null;
  workspace: string | null;
  /** Creation only. */
  paused?: boolean;
  /**
   * Advanced options. Absent = not sent (creation) / unchanged (update); null on update = back to Hermes' default.
   * `enabledToolsets` is never sent as [] (for Hermes an empty list allows no tool): [] and null both mean "all".
   */
  repeat?: number | 'forever';
  timezone?: string | null;
  enabledToolsets?: string[] | null;
  catchUp?: boolean | null;
  graceMinutes?: number | null;
  contextFrom?: string[] | null;
}

// framing block: workspaces/framing.ts (shared with the kanban)
export { folderKey, frame, unframe } from '../workspaces/framing.js';

function schedule(raw: HermesJob['schedule'], display: string | null | undefined): PublicSchedule {
  if (raw && typeof raw === 'object') {
    return {
      kind: raw.kind, minutes: raw.minutes ?? null, expr: raw.expr ?? null, runAt: raw.run_at ?? null,
      display: raw.display ?? display ?? null,
    };
  }
  return { kind: 'unknown', minutes: null, expr: null, runAt: null, display: typeof raw === 'string' ? raw : display ?? null };
}

/** Hermes job → what the browser sees (no hermes_home, script, monitor_*, origin, workdir). */
export function toPublic(instanceId: string, job: HermesJob, findWorkspace: (slug: string) => Workspace | undefined): PublicCron {
  const u = unframe(job.prompt ?? '');
  const ws = u.slug ? findWorkspace(u.slug) : undefined;
  return {
    id: job.id,
    instanceId,
    profile: job.profile ?? 'default',
    name: job.name ?? '',
    prompt: u.prompt,
    workspace: u.slug ? { slug: u.slug, name: ws?.name ?? null, folder: u.folder!, missing: !ws } : null,
    schedule: schedule(job.schedule, job.schedule_display),
    enabled: job.enabled !== false,
    state: job.state ?? null,
    nextRunAt: job.next_run_at ?? null,
    lastRunAt: job.last_run_at ?? null,
    lastStatus: job.last_status ?? null,
    lastError: job.last_error ?? null,
    lastDeliveryError: job.last_delivery_error ?? null,
    failureStreak: job.failure_streak ?? 0,
    deliver: job.deliver ?? null,
    skills: job.skills ?? [],
    model: job.model ?? null,
    repeat: job.repeat?.times ?? null,
    repeatCompleted: job.repeat?.completed ?? 0,
    timezone: job.timezone ?? null,
    enabledToolsets: job.enabled_toolsets ?? null,
    catchUp: job.catch_up ?? null,
    graceMinutes: job.grace_minutes ?? null,
    contextFrom: job.context_from ?? [],
  };
}

/**
 * Hermes fields of the advanced options. Creation: only the given non-empty ones. Update (`reset`): a value set back
 * to empty is sent as null (Hermes' default) and repeat as "forever".
 */
export function advancedFields(input: CronInput, reset: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.repeat !== undefined) {
    if (input.repeat !== 'forever') out.repeat = input.repeat;
    else if (reset) out.repeat = 'forever';
  }
  const put = (key: string, v: unknown, empty: boolean) => {
    if (v === undefined) return;
    if (!empty) out[key] = v;
    else if (reset) out[key] = null;
  };
  put('timezone', input.timezone, !input.timezone);
  put('enabled_toolsets', input.enabledToolsets, !input.enabledToolsets?.length);
  put('catch_up', input.catchUp, input.catchUp === null);
  put('grace_minutes', input.graceMinutes, input.graceMinutes === null);
  put('context_from', input.contextFrom, !input.contextFrom?.length);
  return out;
}

// ---------------------------------------------------------------- service

/** Hermes 400 → CronInputError, 404 → NotFoundError; anything else is rethrown. */
async function translate<T>(fn: () => Promise<T>, what = msg('Cron introuvable')): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HermesError && err.kind === 'http') {
      if (err.detail.status === 404) throw new NotFoundError(msg('{what} : {detail}', { what, detail: hermesDetail(err) }));
      if (err.detail.status === 400 || err.detail.status === 422) {
        const detail = hermesDetail(err);
        const isSchedule = detail.startsWith('Invalid schedule');
        throw new CronInputError(isSchedule ? msg('Planning invalide') : msg('Requête refusée par Hermes'), isSchedule ? 'schedule' : null, detail);
      }
    }
    throw err;
  }
}

function asJob(raw: unknown): HermesJob {
  const parsed = JobGetSchema.safeParse(raw);
  if (!parsed.success) throw new HermesError('schema', 'crons: unexpected job shape in a write response');
  return parsed.data;
}

const UPCOMING_TIMEOUT_MS = 5_000;

export class CronService {
  constructor(
    private readonly compat: CompatService,
    private readonly workspaces: WorkspaceService,
    private readonly store: InstanceStore,
    private readonly roots: FileRoots,
  ) {}

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(msg('Instance inconnue : {id}', { id: instanceId }));
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId) };
  }

  private finder(): (slug: string) => Workspace | undefined {
    const all = this.workspaces.listWorkspaces();
    return (slug) => all.find((w) => w.slug === slug);
  }

  private pub(instanceId: string, job: HermesJob): PublicCron {
    return toPublic(instanceId, job, this.finder());
  }

  private async rawList(instanceId: string, timeoutMs?: number): Promise<HermesJob[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await callOp<unknown>(http, report, 'crons', 'list', { timeoutMs });
    return normaliseJobs(JobListSchema.parse(raw));
  }

  private async rawGet(instanceId: string, id: string, profile: string): Promise<HermesJob> {
    const { http, report } = this.ctx(instanceId);
    return translate(async () => (await callOp<HermesJob>(http, report, 'crons', 'get', { params: { job_id: id }, profile })));
  }

  /** Workspace of the same instance, or a 400. */
  private workspaceFor(instanceId: string, slug: string): Workspace {
    const ws = this.workspaces.getWorkspace(slug);
    if (ws.instanceId !== instanceId) throw new ValidationError(msg('Le workspace {slug} appartient à une autre instance', { slug }));
    return ws;
  }

  private blockLines(ws: Workspace, folder: string): string[] {
    return blockLines(ws, 'crons', folder, this.workspaces.framingLines(ws, `crons/${folder}`), this.workspaces.agentPath(ws));
  }

  /** Keys already used by the instance's crons, and folders already on disk under the workspace's crons/. */
  private async takenKeys(instanceId: string, ws: Workspace, exceptJobId?: string): Promise<string[]> {
    const keys = (await this.rawList(instanceId)).filter((j) => j.id !== exceptJobId)
      .map((j) => unframe(j.prompt ?? '').folder).filter((k): k is string => Boolean(k));
    try {
      const { entries } = await this.roots.fs(ws.instanceId).list(`${ws.slug}/crons`);
      keys.push(...entries.map((e) => e.name));
    } catch (err) {
      if (!(err instanceof WorkspaceFsError && err.code === 'not_found')) throw err;
    }
    return keys;
  }

  async list(instanceId: string): Promise<PublicCron[]> {
    const find = this.finder();
    return (await this.rawList(instanceId)).map((j) => toPublic(instanceId, j, find));
  }

  async get(instanceId: string, id: string, profile: string): Promise<PublicCron> {
    return this.pub(instanceId, await this.rawGet(instanceId, id, profile));
  }

  async create(instanceId: string, input: CronInput): Promise<PublicCron> {
    const { http, report } = this.ctx(instanceId);
    const ws = input.workspace ? this.workspaceFor(instanceId, input.workspace) : null;
    const body: Record<string, unknown> = {
      name: input.name, prompt: input.prompt, schedule: input.schedule, deliver: input.deliver,
      skills: input.skills, model: input.model, paused: input.paused ?? false, ...advancedFields(input, false),
    };
    let profile: string | undefined;
    if (ws) {
      const folder = folderKey(input.name, await this.takenKeys(instanceId, ws));
      body.prompt = frame(input.prompt, this.blockLines(ws, folder));
      body.workdir = this.workspaces.agentPath(ws);
      profile = ws.profile ?? 'default';
    }
    if (input.contextFrom?.length) await this.checkContext(instanceId, profile ?? 'default', input.contextFrom);
    const raw = await translate(() => callOp(http, report, 'crons', 'create', { body, profile }));
    return this.pub(instanceId, asJob(raw));
  }

  /** `context_from` ids must be crons of the same profile (Hermes refuses the others with a host-path-free 400). */
  private async checkContext(instanceId: string, profile: string, ids: string[], self?: string): Promise<void> {
    const known = new Set((await this.rawList(instanceId)).filter((j) => (j.profile ?? 'default') === profile && j.id !== self).map((j) => j.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) throw new ValidationError(msg('Cron de contexte inconnu pour cet agent : {ids}', { ids: unknown.join(', ') }));
  }

  async update(instanceId: string, id: string, profile: string, input: CronInput): Promise<PublicCron> {
    const { http, report } = this.ctx(instanceId);
    const job = await this.rawGet(instanceId, id, profile);
    const current = unframe(job.prompt ?? '');
    const fields: Record<string, unknown> = {
      name: input.name, prompt: input.prompt, deliver: input.deliver, skills: input.skills, model: input.model,
      ...advancedFields(input, true),
    };
    if (input.contextFrom?.length) await this.checkContext(instanceId, job.profile ?? profile, input.contextFrom, id);
    if (input.schedule !== undefined) fields.schedule = input.schedule;
    if (input.workspace) {
      const ws = this.workspaceFor(instanceId, input.workspace);
      const wsProfile = ws.profile ?? 'default';
      const jobProfile = job.profile ?? profile;
      if (wsProfile !== jobProfile) {
        throw new ValidationError(msg('Ce workspace utilise le profil {wsProfile}, ce cron le profil {jobProfile}', { wsProfile, jobProfile }));
      }
      // same workspace: the folder never changes. Another workspace: keep the key only if it is free there
      // (a folder left by a deleted cron must not be reused), else allocate one against the destination
      const folder = current.folder && current.slug === ws.slug
        ? current.folder
        : folderKey(current.folder ?? input.name, await this.takenKeys(instanceId, ws, id));
      fields.prompt = frame(input.prompt, this.blockLines(ws, folder));
      fields.workdir = this.workspaces.agentPath(ws);
    } else if (current.slug) {
      fields.workdir = null;
    }
    const raw = await translate(() => callOp(http, report, 'crons', 'update', {
      params: { job_id: id }, profile, body: (via: 'api' | 'dash') => updateBody(via, fields),
    }));
    return this.pub(instanceId, asJob(raw));
  }

  /** Cron templates of a profile (Hermes keeps their prompt to itself). */
  async blueprints(instanceId: string, profile: string): Promise<PublicBlueprint[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'crons', 'blueprints', { profile }), msg('Agent introuvable'));
    return BlueprintListSchema.parse(raw).blueprints.map((b) => ({
      key: b.key,
      title: b.title || b.key,
      description: b.description ?? null,
      category: b.category ?? null,
      schedule: b.scheduleHuman ?? null,
      source: b.source ?? null,
      plugin: b.plugin ?? null,
      fields: (b.fields ?? []).map((f) => ({
        name: f.name,
        type: f.type ?? 'text',
        label: f.label || f.name,
        default: f.default === undefined || f.default === null ? null : String(f.default),
        options: (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: o.label ?? String(o.value) })),
        optional: f.optional ?? false,
        strict: f.strict ?? true,
        help: f.help || null,
      })),
    }));
  }

  /**
   * Creates a cron from a template, always with an explicit profile (Hermes would take `default`). With a workspace,
   * the created cron is then framed like an Intendia cron (prompt block + workdir); if that write fails the cron stays,
   * unattached (`attached: false`).
   */
  async instantiate(instanceId: string, profile: string, key: string, values: Record<string, string>, workspace: string | null): Promise<{ cron: PublicCron; attached: boolean }> {
    const { http, report } = this.ctx(instanceId);
    const bp = (await this.blueprints(instanceId, profile)).find((b) => b.key === key);
    if (!bp) throw new NotFoundError(msg('Modèle de cron inconnu : {key}', { key }));
    const names = new Set(bp.fields.map((f) => f.name));
    const extra = Object.keys(values).filter((k) => !names.has(k));
    if (extra.length) throw new ValidationError(msg('Champ inconnu pour ce modèle : {fields}', { fields: extra.join(', ') }));
    const ws = workspace ? this.workspaceFor(instanceId, workspace) : null;
    if (ws && (ws.profile ?? 'default') !== profile) throw new ValidationError(msg('Ce workspace utilise le profil {wsProfile}, pas {profile}', { wsProfile: ws.profile ?? 'default', profile }));
    const job = asJob(await translate(() => callOp(http, report, 'crons', 'instantiate', { profile, body: { blueprint: key, values } })));
    if (!ws) return { cron: this.pub(instanceId, job), attached: false };
    try {
      const folder = folderKey(job.name || bp.title, await this.takenKeys(instanceId, ws, job.id));
      const fields = { prompt: frame(job.prompt ?? '', this.blockLines(ws, folder)), workdir: this.workspaces.agentPath(ws) };
      const raw = await translate(() => callOp(http, report, 'crons', 'update', {
        params: { job_id: job.id }, profile, body: (via: 'api' | 'dash') => updateBody(via, fields),
      }));
      return { cron: this.pub(instanceId, asJob(raw)), attached: true };
    } catch {
      return { cron: this.pub(instanceId, job), attached: false };
    }
  }

  private async action(instanceId: string, id: string, profile: string, op: 'pause' | 'resume' | 'trigger'): Promise<PublicCron> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp(http, report, 'crons', op, { params: { job_id: id }, profile }));
    return this.pub(instanceId, asJob(raw));
  }

  pause(instanceId: string, id: string, profile: string) { return this.action(instanceId, id, profile, 'pause'); }
  resume(instanceId: string, id: string, profile: string) { return this.action(instanceId, id, profile, 'resume'); }
  trigger(instanceId: string, id: string, profile: string) { return this.action(instanceId, id, profile, 'trigger'); }

  async cancel(instanceId: string, id: string, profile: string): Promise<{ cancelled: boolean; detail: string | null }> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<{ cancelled?: unknown; detail?: unknown }>(http, report, 'crons', 'cancel', { params: { job_id: id }, profile }));
    return { cancelled: raw?.cancelled === true, detail: typeof raw?.detail === 'string' ? raw.detail : null };
  }

  async remove(instanceId: string, id: string, profile: string): Promise<void> {
    const { http, report } = this.ctx(instanceId);
    await translate(() => callOp(http, report, 'crons', 'remove', { params: { job_id: id }, profile }));
  }

  async runs(instanceId: string, id: string, profile: string): Promise<PublicRun[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await translate(() => callOp<unknown>(http, report, 'crons', 'runs', { params: { job_id: id }, profile, query: { limit: 20 } }));
    return RunListSchema.parse(raw).runs.map((r) => ({
      id: r.id, startedAt: r.started_at ?? null, endedAt: r.ended_at ?? null, endReason: r.end_reason ?? null,
      messageCount: r.message_count ?? 0, toolCallCount: r.tool_call_count ?? 0, costUsd: r.estimated_cost_usd ?? null, model: r.model ?? null,
    }));
  }

  async targets(instanceId: string): Promise<{ id: string; name: string }[]> {
    const { http, report } = this.ctx(instanceId);
    const raw = await callOp<unknown>(http, report, 'crons', 'targets');
    return TargetListSchema.parse(raw).targets.map((t) => ({ id: t.id, name: t.name ?? t.id }));
  }

  /** Next active crons across instances; an instance that fails or times out is left out. */
  /** Every active cron of every instance; an instance that does not answer adds an error line. */
  async overview(): Promise<{ crons: OverviewCron[]; errors: { instance: string; message: string }[] }> {
    const instances = this.store.list();
    const errors: { instance: string; message: string }[] = [];
    const results = await Promise.all(instances.map(async (inst) => {
      try {
        const jobs = await this.rawList(inst.id, UPCOMING_TIMEOUT_MS);
        return jobs.filter((j) => j.enabled !== false).map((j): OverviewCron => ({
          instanceId: inst.id, instanceLabel: inst.label ?? inst.id, id: j.id, profile: j.profile ?? 'default',
          name: j.name || msg('(sans nom)'), schedule: schedule(j.schedule, j.schedule_display),
          nextRunAt: j.next_run_at ?? null, lastRunAt: j.last_run_at ?? null, lastStatus: j.last_status ?? null,
          lastError: j.last_error ?? null, timezone: j.timezone ?? null,
        }));
      } catch (err) {
        errors.push({ instance: inst.label ?? inst.id, message: err instanceof Error ? err.message : String(err) });
        return [];
      }
    }));
    const t = (v: string | null) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
    return { crons: results.flat().sort((a, b) => t(a.nextRunAt) - t(b.nextRunAt)), errors };
  }
}
