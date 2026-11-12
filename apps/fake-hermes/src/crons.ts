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

/** Three templates like Hermes' catalogue (the prompt is never returned by the list). */
const BLUEPRINTS = [
  {
    key: 'morning-brief', title: 'Morning brief', description: 'A short summary of your day every morning.', category: 'daily', tags: ['daily'],
    fields: [
      { name: 'time', type: 'time', label: 'Time', default: '08:00', options: [], optional: false, strict: true, help: 'When to send it' },
      { name: 'recurrence', type: 'weekdays', label: 'Repeat on', default: 'everyday', options: ['everyday', 'weekdays', 'weekends'], optional: false, strict: true, help: '' },
      { name: 'style', type: 'enum', label: 'Style', default: 'short', options: ['short', 'detailed'], optional: false, strict: true, help: '' },
      // like Hermes' deliver slot: options are suggestions, any value is accepted
      { name: 'deliver', type: 'enum', label: 'Where to deliver?', default: 'origin', options: ['origin', 'local'], optional: false, strict: false, help: 'origin = the chat you set this up from' },
    ],
    source: 'builtin', plugin: null, schedule: '{minute} {hour} * * {dow}', scheduleHuman: 'daily at 08:00', command: 'hermes cron add …', appUrl: '/cron?blueprint=morning-brief',
    prompt: (v: Record<string, string>) => `Write a ${v.style ?? 'short'} morning brief.`,
    sched: (v: Record<string, string>) => {
      const [h, m] = (v.time ?? '08:00').split(':');
      const dow = ({ everyday: '*', weekdays: '1-5', weekends: '0,6' } as Record<string, string>)[v.recurrence ?? 'everyday'] ?? '*';
      return `${Number(m)} ${Number(h)} * * ${dow}`;
    },
  },
  {
    key: 'price-watch', title: 'Price watch', description: 'Checks a product page and reports price changes.', category: 'shopping', tags: [],
    fields: [
      { name: 'url', type: 'text', label: 'Product URL', default: '', options: [], optional: false, strict: true, help: 'Page to watch' },
      { name: 'note', type: 'text', label: 'Note', default: null, options: [], optional: true, strict: true, help: '' },
    ],
    source: 'builtin', plugin: null, schedule: 'every 6h', scheduleHuman: 'Every 6 hours', command: null, appUrl: null,
    prompt: (v: Record<string, string>) => `Check the price at ${v.url ?? ''}.`,
    sched: () => 'every 6h',
  },
  {
    key: 'plugin-x', title: 'Plugin report', description: 'Template shipped by a plugin.', category: 'plugins', tags: [],
    fields: [], source: 'plugin', plugin: 'fake-plugin', schedule: 'every 24h', scheduleHuman: 'Every day', command: null, appUrl: null,
    prompt: () => 'Run the plugin report.', sched: () => 'every 24h',
  },
];

function badTimezone(tz: unknown): boolean {
  if (tz === null || tz === undefined) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(tz) });
    return false;
  } catch {
    return true;
  }
}

export class CronStore {
  jobs = new Map<string, Job>();
  runs: Run[] = [];
  private n = 0;

  constructor(private readonly stepMs: number, private readonly sessions: CronSessionSink) {}

  /** Hermes' checks of the advanced fields (create and update). */
  private checkAdvanced(b: Record<string, unknown>, profile: string): Response | null {
    if ('repeat' in b && b.repeat !== null && b.repeat !== 'forever' && b.repeat !== 'once' && !(Number.isInteger(b.repeat) && Number(b.repeat) >= 1)) {
      return json({ detail: 'repeat must be a positive integer, "once" or "forever"' }, 400);
    }
    if (badTimezone(b.timezone)) return json({ detail: `Unknown timezone '${String(b.timezone)}'` }, 400);
    if ('enabled_toolsets' in b && b.enabled_toolsets !== null && !Array.isArray(b.enabled_toolsets)) return json({ detail: 'enabled_toolsets must be a list of toolset names (or [] for none).' }, 400);
    if ('catch_up' in b && b.catch_up !== null && typeof b.catch_up !== 'boolean') return json({ detail: 'catch_up must be true, false, or null (use the default).' }, 400);
    const ctx = b.context_from === null || b.context_from === undefined ? [] : Array.isArray(b.context_from) ? b.context_from : [b.context_from];
    for (const id of ctx) {
      const other = this.jobs.get(String(id));
      if (!other || other.profile !== profile) return json({ detail: `context_from: job '${String(id)}' not found in profile '${profile}'` }, 400);
    }
    return null;
  }

  private newJob(body: Record<string, unknown>, profile: string): Job | Response {
    const schedule = parseSchedule(String(body.schedule ?? ''));
    if (!schedule) return json({ detail: `Invalid schedule '${String(body.schedule ?? '')}'. ${SCHEDULE_HELP}` }, 400);
    const bad = this.checkAdvanced(body, profile);
    if (bad) return bad;
    const times = typeof body.repeat === 'number' ? body.repeat : schedule.kind === 'once' ? 1 : null;
    this.n += 1;
    const paused = body.paused === true;
    const job: Job = {
      id: (0xa00000000000 + this.n).toString(16), profile, profile_name: profile,
      name: String(body.name ?? ''), prompt: String(body.prompt ?? ''), skills: Array.isArray(body.skills) ? body.skills : [],
      skill: null, model: body.model ?? null, provider: null, script: null, no_agent: false,
      schedule, schedule_display: schedule.display, repeat: { times, completed: 0 },
      enabled: !paused, state: paused ? 'paused' : 'scheduled', paused_at: paused ? iso(Date.now()) : null, paused_reason: null,
      created_at: iso(Date.now()), next_run_at: paused ? null : nextRun(schedule), last_run_at: null, last_status: null,
      last_error: null, last_delivery_error: null, failure_streak: 0, deliver: body.deliver ?? 'local', origin: null,
      workdir: body.workdir ?? null, timezone: body.timezone ?? null, hermes_home: `/opt/data/profiles/${profile}`, monitor_url: null,
      enabled_toolsets: body.enabled_toolsets ?? null, context_from: body.context_from ?? null,
      ...(typeof body.catch_up === 'boolean' ? { catch_up: body.catch_up } : {}),
      ...(typeof body.grace_minutes === 'number' ? { grace_minutes: body.grace_minutes } : {}),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private update(job: Job, updates: Record<string, unknown>): Job | Response {
    const bad = this.checkAdvanced(Object.fromEntries(Object.entries(updates).filter(([k]) => k !== 'context_from' || updates[k] !== null)), job.profile);
    if (bad) return bad;
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'repeat') {
        const completed = Number((job.repeat as { completed?: number } | null)?.completed ?? 0);
        job.repeat = { times: v === 'forever' || v === null ? null : v === 'once' ? 1 : Number(v), completed };
        continue;
      }
      if (k === 'context_from' && typeof v === 'string') { job.context_from = [v]; continue; }
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
    if (via === 'dash' && path === '/api/cron/blueprints' && method === 'GET') {
      return json({ blueprints: BLUEPRINTS.map(({ prompt: _p, sched: _s, ...bp }) => bp) });
    }
    if (via === 'dash' && path === '/api/cron/blueprints/instantiate' && method === 'POST') {
      const bp = BLUEPRINTS.find((x) => x.key === b.blueprint);
      if (!bp) return json({ detail: `Unknown blueprint: ${String(b.blueprint)}` }, 404);
      const values = (b.values ?? {}) as Record<string, string>;
      // Hermes' fill_blueprint errors are 422 with a text detail
      const unknown = Object.keys(values).filter((k) => !bp.fields.some((f) => f.name === k));
      if (unknown.length) return json({ detail: `unknown slot: ${unknown.join(', ')}` }, 422);
      for (const f of bp.fields) {
        const v = values[f.name] ?? f.default;
        if (!f.optional && !v) return json({ detail: `missing required value: ${f.name} (${f.label})` }, 422);
        if (f.type === 'enum' && f.strict && v && !(f.options as string[]).includes(String(v))) {
          return json({ detail: `${f.name}='${String(v)}' not allowed — one of ${(f.options as string[]).join(', ')}` }, 422);
        }
      }
      // like Hermes: ?profile= absent means "default", not the active profile
      const job = this.newJob({ name: bp.title, prompt: bp.prompt({ ...Object.fromEntries(bp.fields.map((f) => [f.name, String(f.default ?? '')])), ...values }), schedule: bp.sched(values), deliver: values.deliver ?? 'origin' }, query.profile || 'default');
      return job instanceof Response ? job : json(job);
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
