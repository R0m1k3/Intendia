import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CompatService } from '../compat/service.js';
import {
  JobGetSchema, JobListSchema, normaliseJobs, RunListSchema, TargetListSchema, updateBody, type HermesJob,
} from '../connectors/crons/index.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import { blockLines, folderKey, frame, unframe } from '../workspaces/framing.js';
import { NotFoundError, ValidationError, type Workspace, type WorkspaceService } from '../workspaces/service.js';

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

export interface Upcoming {
  instanceId: string;
  instanceLabel: string;
  id: string;
  profile: string;
  name: string;
  nextRunAt: string;
  schedule: PublicSchedule;
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
  };
}

// ---------------------------------------------------------------- service

/** Hermes 400 → CronInputError, 404 → NotFoundError; anything else is rethrown. */
async function translate<T>(fn: () => Promise<T>, what = 'Cron introuvable'): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HermesError && err.kind === 'http') {
      if (err.detail.status === 404) throw new NotFoundError(`${what} : ${hermesDetail(err)}`);
      if (err.detail.status === 400 || err.detail.status === 422) {
        const detail = hermesDetail(err);
        const isSchedule = detail.startsWith('Invalid schedule');
        throw new CronInputError(isSchedule ? 'Planning invalide' : 'Requête refusée par Hermes', isSchedule ? 'schedule' : null, detail);
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
  ) {}

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
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
    if (ws.instanceId !== instanceId) throw new ValidationError(`Le workspace ${slug} appartient à une autre instance`);
    return ws;
  }

  private blockLines(ws: Workspace, folder: string): string[] {
    return blockLines(ws, 'crons', folder, this.workspaces.framingLines(ws, `crons/${folder}`), this.workspaces.agentPath(ws));
  }

  /** Keys already used by the instance's crons, and folders already on disk under the workspace's crons/. */
  private async takenKeys(instanceId: string, ws: Workspace, exceptJobId?: string): Promise<string[]> {
    const keys = (await this.rawList(instanceId)).filter((j) => j.id !== exceptJobId)
      .map((j) => unframe(j.prompt ?? '').folder).filter((k): k is string => Boolean(k));
    const dir = join(this.workspaces.dir(ws), 'crons');
    if (existsSync(dir)) keys.push(...readdirSync(dir));
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
      skills: input.skills, model: input.model, paused: input.paused ?? false,
    };
    let profile: string | undefined;
    if (ws) {
      const folder = folderKey(input.name, await this.takenKeys(instanceId, ws));
      body.prompt = frame(input.prompt, this.blockLines(ws, folder));
      body.workdir = this.workspaces.agentPath(ws);
      profile = ws.profile ?? 'default';
    }
    const raw = await translate(() => callOp(http, report, 'crons', 'create', { body, profile }));
    return this.pub(instanceId, asJob(raw));
  }

  async update(instanceId: string, id: string, profile: string, input: CronInput): Promise<PublicCron> {
    const { http, report } = this.ctx(instanceId);
    const job = await this.rawGet(instanceId, id, profile);
    const current = unframe(job.prompt ?? '');
    const fields: Record<string, unknown> = {
      name: input.name, prompt: input.prompt, deliver: input.deliver, skills: input.skills, model: input.model,
    };
    if (input.schedule !== undefined) fields.schedule = input.schedule;
    if (input.workspace) {
      const ws = this.workspaceFor(instanceId, input.workspace);
      const wsProfile = ws.profile ?? 'default';
      const jobProfile = job.profile ?? profile;
      if (wsProfile !== jobProfile) {
        throw new ValidationError(`Ce workspace utilise le profil ${wsProfile}, ce cron le profil ${jobProfile}`);
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
  async upcoming(limit = 3): Promise<Upcoming[]> {
    const instances = this.store.list();
    const results = await Promise.allSettled(instances.map(async (inst) => {
      const jobs = await this.rawList(inst.id, UPCOMING_TIMEOUT_MS);
      return jobs.filter((j) => j.enabled !== false && j.next_run_at).map((j): Upcoming => ({
        instanceId: inst.id, instanceLabel: inst.label ?? inst.id, id: j.id, profile: j.profile ?? 'default',
        name: j.name || '(sans nom)', nextRunAt: j.next_run_at!, schedule: schedule(j.schedule, j.schedule_display),
      }));
    }));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
      .slice(0, limit);
  }
}
