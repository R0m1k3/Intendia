import type { CompatService } from '../compat/service.js';
import { callOp } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import type { PublicSession, WorkspaceService } from '../workspaces/service.js';

const TIMEOUT_MS = 3_000;
/** One page of Hermes sessions per instance and profile (the home page shows a few lines). */
const HERMES_PAGE = 50;

export interface RecentSession {
  kind: 'intendia' | 'hermes';
  instanceId: string;
  profile: string;
  id: string;
  /** "intendia" for Intendia's sessions, else Hermes' source (telegram, cron, cli, api_server…) or null. */
  source: string | null;
  title: string;
  /** Workspace name (Intendia) or "<instance> · <n> messages" (Hermes). */
  sub: string;
  /** Workspace slug of an Intendia session. */
  workspace: string | null;
  /** Last activity, ms. */
  at: number;
}

export interface HermesSessionRaw {
  id: unknown;
  source?: unknown;
  title?: unknown;
  preview?: unknown;
  started_at?: unknown;
  last_active?: unknown;
  message_count?: unknown;
}

const secMs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Title of a list line: title, else the preview cut at 80 characters, else a fallback. */
export function lineTitle(title: unknown, preview: unknown): string {
  const t = text(title);
  if (t) return t;
  const p = text(preview);
  if (p) return p.length > 80 ? `${p.slice(0, 79)}…` : p;
  return 'Session sans titre';
}

/** Both sources in one list, most recent first, without duplicates (a Hermes may list a session under two profiles). */
export function mergeRecent(
  intendia: (PublicSession & { workspaceName: string; profile: string })[],
  hermes: { instanceId: string; label: string; profile: string; sessions: HermesSessionRaw[] }[],
  limit: number,
): RecentSession[] {
  const out: RecentSession[] = intendia.map((s) => ({
    kind: 'intendia', instanceId: s.instanceId, profile: s.profile, id: s.id, source: 'intendia',
    title: s.title || 'Nouvelle session', sub: s.workspaceName, workspace: s.workspace, at: s.lastActiveAt ?? s.createdAt,
  }));
  const seen = new Set(out.map((s) => `${s.instanceId}:${s.id}`));
  for (const h of hermes) {
    for (const raw of h.sessions) {
      const id = String(raw.id);
      const key = `${h.instanceId}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const count = typeof raw.message_count === 'number' ? raw.message_count : null;
      out.push({
        kind: 'hermes', instanceId: h.instanceId, profile: h.profile, id, source: text(raw.source),
        title: lineTitle(raw.title, raw.preview),
        sub: count === null ? h.label : `${h.label} · ${count} message${count > 1 ? 's' : ''}`,
        workspace: null, at: secMs(raw.last_active) ?? secMs(raw.started_at) ?? 0,
      });
    }
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).slice(0, limit);
}

/** Recent sessions of every source across instances; an instance that does not answer adds an error line. */
export class RecentService {
  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    private readonly workspaces: WorkspaceService,
  ) {}

  async list(limit: number): Promise<{ sessions: RecentSession[]; errors: { instance: string; message: string }[] }> {
    const errors: { instance: string; message: string }[] = [];
    const intendia = this.workspaces.recentSessions(limit);
    const all = this.workspaces.listWorkspaces();
    const hermes = (await Promise.all(this.store.list().map(async (inst) => {
      // profiles with a key used by a workspace of this instance, plus default
      const profiles = [...new Set(['default', ...all.filter((w) => w.instanceId === inst.id && w.profile && inst.profileKeys[w.profile]).map((w) => w.profile!)])];
      const owned = this.workspaces.ownedIds(inst.id);
      const pages = await Promise.all(profiles.map(async (profile) => {
        try {
          const res = await callOp<{ data: HermesSessionRaw[] }>(this.compat.http(inst.id), this.compat.get(inst.id), 'sessions', 'list', {
            profile, query: { limit: HERMES_PAGE, offset: 0 }, timeoutMs: TIMEOUT_MS,
          });
          return { instanceId: inst.id, label: inst.label, profile, sessions: res.data.filter((s) => !owned.has(String(s.id))) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!errors.some((e) => e.instance === inst.label)) errors.push({ instance: inst.label, message });
          return null;
        }
      }));
      return pages.filter((p) => p !== null);
    }))).flat();
    return { sessions: mergeRecent(intendia, hermes, limit), errors };
  }
}
