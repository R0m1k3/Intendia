/**
 * Simulated cron jobs, shared by the dashboard (/api/cron/*) and the API server (/api/jobs*).
 * Shapes follow Hermes 0.23.0 (checked 2026-11-09). Words in a job prompt choose the run:
 * - default: ends after 4 steps, last_status "ok"
 * - "bloque": ends at once in "blocked_config" with last_error, no message
 * - "long": lasts 100 steps; POST .../cancel ends it as "cancelled"
 * - "rate": ends after 4 steps with last_status "error" and last_error "RuntimeError: rate"
 */

export const CRON_PROFILES = ['default', 'recherche'];

const SCHEDULE_HELP = "Use:\n  - Interval: '30m', 'every 30m', 'every 2h' (recurring)\n  - One-shot delay: 'in 30m', 'in 2h' (fires once)\n  - Weekly/daily: 'every monday 9am', 'weekdays at 9am' (recurring)\n  - Cron: '0 9 * * *' (cron expression)\n  - Timestamp: '2026-02-03T14:00:00' (one-shot at time)";

export interface CronSessionSink {
  /** Adds a message to a simulated Hermes session (visible through /api/sessions/{id}/messages). */
  addMessage(sessionId: string, role: string, content: string): void;
}

type Job = Record<string, unknown> & { id: string; profile: string };

interface Run {
  id: string;
  jobId: string;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  message_count: number;
  timer?: NodeJS.Timeout;
}

const iso = (ms: number) => new Date(ms).toISOString().replace('Z', '+00:00');

export function parseSchedule(raw: string): Record<string, unknown> | null {
  const s = raw.trim();
  let m = /^(?:every\s+)?(\d+)\s*([mh])$/i.exec(s);
  if (m) {
    const minutes = Number(m[1]) * (m[2]!.toLowerCase() === 'h' ? 60 : 1);
    return { kind: 'interval', minutes, display: `every ${minutes}m` };
  }
  m = /^in\s+(\d+)\s*([mh])$/i.exec(s);
  if (m) {
    const minutes = Number(m[1]) * (m[2]!.toLowerCase() === 'h' ? 60 : 1);
    return { kind: 'once', run_at: iso(Date.now() + minutes * 60_000), display: `once in ${s.slice(3)}` };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return { kind: 'once', run_at: `${s.length === 16 ? `${s}:00` : s}+00:00`, display: `once at ${s.replace('T', ' ').slice(0, 16)}` };
  }
  const fields = s.split(/\s+/);
  if (fields.length === 5 && fields.every((f) => /^[\d*/,-]+$/.test(f))) return { kind: 'cron', expr: s, display: s };
  return null;
}

function nextRun(schedule: Record<string, unknown>): string {
  if (schedule.kind === 'interval') return iso(Date.now() + Number(schedule.minutes) * 60_000);
  if (schedule.kind === 'once') return String(schedule.run_at);
  return iso(Date.now() + 86_400_000);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

const NOT_FOUND = () => json({ detail: 'Job not found' }, 404);

export class CronStore {
  jobs = new Map<string, Job>();
  runs: Run[] = [];
  private n = 0;

  constructor(private readonly stepMs: number, private readonly sessions: CronSessionSink) {}

  private newJob(body: Record<string, unknown>, profile: string): Job | Response {
    const schedule = parseSchedule(String(body.schedule ?? ''));
    if (!schedule) return json({ detail: `Invalid schedule '${String(body.schedule ?? '')}'. ${SCHEDULE_HELP}` }, 400);
    this.n += 1;
    const paused = body.paused === true;
    const job: Job = {
      id: (0xa00000000000 + this.n).toString(16), profile, profile_name: profile,
      name: String(body.name ?? ''), prompt: String(body.prompt ?? ''), skills: Array.isArray(body.skills) ? body.skills : [],
      skill: null, model: body.model ?? null, provider: null, script: null, no_agent: false,
      schedule, schedule_display: schedule.display, repeat: { times: schedule.kind === 'once' ? 1 : null, completed: 0 },
      enabled: !paused, state: paused ? 'paused' : 'scheduled', paused_at: paused ? iso(Date.now()) : null, paused_reason: null,
      created_at: iso(Date.now()), next_run_at: paused ? null : nextRun(schedule), last_run_at: null, last_status: null,
      last_error: null, last_delivery_error: null, failure_streak: 0, deliver: body.deliver ?? 'local', origin: null,
      workdir: body.workdir ?? null, timezone: null, hermes_home: `/opt/data/profiles/${profile}`, monitor_url: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private update(job: Job, updates: Record<string, unknown>): Job | Response {
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'schedule') {
        const schedule = parseSchedule(String(v ?? ''));
        if (!schedule) return json({ detail: `Invalid schedule '${String(v ?? '')}'. ${SCHEDULE_HELP}` }, 400);
        job.schedule = schedule;
        job.schedule_display = schedule.display;
        if (job.enabled) job.next_run_at = nextRun(schedule);
      } else if (k === 'enabled') {
        job.enabled = v === true;
        job.state = job.enabled ? 'scheduled' : 'paused';
        job.paused_at = job.enabled ? null : iso(Date.now());
        if (job.enabled && !job.next_run_at) job.next_run_at = nextRun(job.schedule as Record<string, unknown>);
      } else if (k !== 'paused' && k !== 'id' && k !== 'profile') {
        job[k] = v; // Hermes ignores `paused` in updates (checked on 0.23.0)
      }
    }
    return job;
  }

  private trigger(job: Job) {
    const prompt = String(job.prompt ?? '');
    const run: Run = { id: `cron_${job.id}_${this.runs.length + 1}`, jobId: job.id, started_at: Date.now() / 1000, ended_at: null, end_reason: null, message_count: 0 };
    this.runs.push(run);
    const finish = (status: string, error: string | null) => {
      job.last_run_at = iso(Date.now());
      job.last_status = status;
      job.last_error = error;
      job.failure_streak = status === 'ok' || status === 'cancelled' ? 0 : Number(job.failure_streak ?? 0) + 1;
      if (status !== 'blocked_config') {
        run.ended_at = Date.now() / 1000;
        run.end_reason = status === 'cancelled' ? 'cancelled' : 'completed';
      }
    };
    if (/bloque/i.test(prompt)) {
      finish('blocked_config', '[blocked_config] provider credential missing: Hermes is not connected to any AI provider yet.');
      return;
    }
    this.sessions.addMessage(run.id, 'user', prompt);
    run.message_count = 1;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      if (/\brate\b/i.test(prompt)) {
        finish('error', 'RuntimeError: rate');
        return;
      }
      this.sessions.addMessage(run.id, 'assistant', 'Cron exécuté.');
      run.message_count = 2;
      finish('ok', null);
    }, this.stepMs * (/long/i.test(prompt) ? 100 : 4));
    (run as Run & { finish?: typeof finish }).finish = finish;
  }

  private cancel(job: Job) {
    const run = this.runs.find((r) => r.jobId === job.id && r.timer);
    if (!run) return { success: true, cancelled: false, execution_id: null, detail: 'No run of this job is in flight — nothing to cancel.', job_id: job.id };
    clearTimeout(run.timer);
    run.timer = undefined;
    (run as Run & { finish: (s: string, e: string | null) => void }).finish('cancelled', null);
    return { success: true, cancelled: true, execution_id: run.id, detail: 'Cancelled.', job_id: job.id };
  }

  /** Handles a cron route; null = not a cron route. */
  handle(via: 'api' | 'dash', method: string, path: string, query: Record<string, string>, body: unknown, apiProfile: string): Response | null {
    const b = (body ?? {}) as Record<string, unknown>;
    if (via === 'dash' && method === 'GET' && path === '/api/cron/delivery-targets') {
      return json({ targets: [
        { id: 'local', name: 'Local (save only)', home_target_set: true, home_env_var: null },
        { id: 'bot-chat:default', name: 'Bot Chat (default)', home_target_set: true, home_env_var: null },
      ] });
    }
    const base = via === 'dash' ? '/api/cron/jobs' : '/api/jobs';
    if (path !== base && !path.startsWith(`${base}/`)) return null;

    const asked = via === 'dash' ? query.profile : apiProfile;
    if (asked && asked !== 'all' && !CRON_PROFILES.includes(asked)) return json({ detail: `Profile '${asked}' does not exist.` }, 404);
    const wrap = (job: Job) => (via === 'api' ? { job } : job);

    if (path === base) {
      if (method === 'GET') {
        const list = [...this.jobs.values()].filter((j) => (via === 'api' ? j.profile === apiProfile : !asked || asked === 'all' || j.profile === asked));
        return json(via === 'api' ? { jobs: list } : list);
      }
      if (method === 'POST') {
        const job = this.newJob(b, asked && asked !== 'all' ? asked : 'default');
        return job instanceof Response ? job : json(wrap(job));
      }
      return null;
    }
    const m = /^\/([^/]+)(?:\/([a-z]+))?$/.exec(path.slice(base.length));
    if (!m) return null;
    const job = this.jobs.get(decodeURIComponent(m[1]!));
    const profile = asked && asked !== 'all' ? asked : 'default';
    if (!job || job.profile !== profile) return NOT_FOUND();
    const sub = m[2];
    if (!sub) {
      if (method === 'GET') return json(wrap(job));
      if (method === 'DELETE') {
        this.jobs.delete(job.id);
        return json({ success: true });
      }
      if ((via === 'dash' && method === 'PUT') || (via === 'api' && method === 'PATCH')) {
        const updates = via === 'dash' ? (b.updates as Record<string, unknown> | undefined) ?? {} : b;
        const out = this.update(job, updates);
        return out instanceof Response ? out : json(wrap(out));
      }
      return null;
    }
    if (method === 'GET' && sub === 'runs' && via === 'dash') {
      const runs = this.runs.filter((r) => r.jobId === job.id).reverse().slice(0, Number(query.limit ?? 20))
        .map(({ timer: _t, ...r }) => ({ ...r, source: 'cron', tool_call_count: 0, estimated_cost_usd: null, model: 'fake/model', cron_execution_id: r.id }));
      return json({ runs, limit: Number(query.limit ?? 20) });
    }
    if (method !== 'POST') return null;
    if (sub === 'pause') return json(wrap(this.update(job, { enabled: false }) as Job));
    if (sub === 'resume') return json(wrap(this.update(job, { enabled: true }) as Job));
    if (sub === (via === 'dash' ? 'trigger' : 'run')) {
      this.trigger(job);
      return json(wrap(job));
    }
    if (sub === 'cancel' && via === 'dash') return json(this.cancel(job));
    return null;
  }
}
