import { msg } from '../i18n/index.js';
import type { CompatService } from '../compat/service.js';
import { callOp, HermesError, ModuleUnavailableError } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, type PublicSession, type WorkspaceService } from '../workspaces/service.js';

const TIMEOUT_MS = 3_000;
/** Lines of a search answer. */
export const SEARCH_LIMIT = 30;

export const SESSION_SOURCES = ['all', 'intendia', 'cli', 'telegram', 'discord', 'cron', 'kanban'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/**
 * Hermes `source` values read for a filter (undefined = no filter). Hermes 0.23 stores sessions of the CLI, TUI and
 * desktop app as `local` (gateway/session_policy.py), older ones as `cli`: the CLI filter reads both.
 */
export function hermesSources(source: SessionSource): (string | undefined)[] {
  if (source === 'all') return [undefined];
  if (source === 'cli') return ['local', 'cli'];
  return [source];
}

type Owned = PublicSession & { workspaceName: string; profile: string };
type Err = { instance: string; message: string };

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
  /** Search hit in the messages (Hermes text, hit between `>>>` and `<<<`); null outside a search. */
  snippet: string | null;
}

export interface HermesSessionRaw {
  id: unknown;
  source?: unknown;
  title?: unknown;
  preview?: unknown;
  started_at?: unknown;
  last_active?: unknown;
  message_count?: unknown;
  snippet?: unknown;
}

/** The snippet without its hit markers. */
export const stripMarks = (v: string): string => v.replace(/>>>|<<</g, '');

const secMs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Title of a list line: title, else the preview cut at 80 characters, else a fallback. */
export function lineTitle(title: unknown, preview: unknown): string {
  const t = text(title);
  if (t) return t;
  const p = text(preview);
  if (p) return p.length > 80 ? `${p.slice(0, 79)}…` : p;
  return msg('Session sans titre');
}

/** Both sources in one list, most recent first, without duplicates (a Hermes may list a session under two profiles). */
export function mergeRecent(
  intendia: (Owned & { snippet?: string | null })[],
  hermes: { instanceId: string; label: string; profile: string; sessions: HermesSessionRaw[] }[],
  limit: number,
): RecentSession[] {
  const out: RecentSession[] = intendia.map((s) => ({
    kind: 'intendia', instanceId: s.instanceId, profile: s.profile, id: s.id, source: 'intendia',
    title: s.title || msg('Nouvelle session'), sub: s.workspaceName, workspace: s.workspace, at: s.lastActiveAt ?? s.createdAt,
    snippet: s.snippet ?? null,
  }));
  const seen = new Set(out.map((s) => `${s.instanceId}:${s.id}`));
  for (const h of hermes) {
    for (const raw of h.sessions) {
      const id = String(raw.id);
      const key = `${h.instanceId}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const count = typeof raw.message_count === 'number' ? raw.message_count : null;
      const snippet = text(raw.snippet);
      out.push({
        kind: 'hermes', instanceId: h.instanceId, profile: h.profile, id, source: text(raw.source),
        title: lineTitle(raw.title, raw.preview ?? (snippet ? stripMarks(snippet) : null)),
        sub: count === null ? h.label : `${h.label} · ${count} message${count > 1 ? 's' : ''}`,
        workspace: null, at: secMs(raw.last_active) ?? secMs(raw.started_at) ?? 0, snippet,
      });
    }
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).slice(0, limit);
}

/** A search the instance cannot serve (no dashboard, route missing, 404 or 500): only Intendia titles are searched there. */
function searchUnavailable(err: unknown): boolean {
  if (err instanceof ModuleUnavailableError) return true;
  return err instanceof HermesError && (err.kind === 'unconfigured' || (err.kind === 'http' && (err.detail.status === 404 || err.detail.status === 500)));
}

/** Pages of Hermes sessions read per profile at most when skipping Intendia's own. */
const MAX_PAGES = 5;

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Sessions of every source across instances; an instance that does not answer adds an error line. */
export class RecentService {
  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    private readonly workspaces: WorkspaceService,
  ) {}

  /** Profiles read on an instance: default plus those of its workspaces and of its sessions (with a key). */
  private profiles(instanceId: string): string[] {
    const inst = this.store.get(instanceId);
    const all = this.workspaces.listWorkspaces();
    const used = [
      ...all.filter((w) => w.instanceId === instanceId && w.profile).map((w) => w.profile!),
      ...this.workspaces.sessionProfiles(instanceId),
    ];
    return [...new Set(['default', ...used.filter((p) => inst?.profileKeys[p])])];
  }

  private instance(instanceId: string) {
    const inst = this.store.get(instanceId);
    if (!inst) throw new NotFoundError(msg('Instance inconnue : {id}', { id: instanceId }));
    return inst;
  }

  /** The instance's sessions of every source (Intendia, Telegram, crons…), most recent first. */
  async list(instanceId: string, limit: number, source: SessionSource = 'all'): Promise<{ sessions: RecentSession[]; errors: Err[] }> {
    const one = this.instance(instanceId);
    const errors: Err[] = [];
    const intendia = source === 'all' || source === 'intendia' ? this.workspaces.recentSessions(limit, instanceId) : [];
    const hermes = source === 'intendia' ? [] : (await Promise.all([one].map(async (inst) => {
      const owned = this.workspaces.ownedIds(inst.id);
      const pages = await Promise.all(this.profiles(inst.id).map(async (profile) => {
        try {
          // Intendia's own rows are dropped, so keep reading pages until `limit` others are found (bounded).
          const sessions: HermesSessionRaw[] = [];
          for (const src of hermesSources(source)) {
            const found: HermesSessionRaw[] = [];
            for (let page = 0; page < MAX_PAGES && found.length < limit; page++) {
              const res = await callOp<{ data: HermesSessionRaw[] }>(this.compat.http(inst.id), this.compat.get(inst.id), 'sessions', 'list', {
                profile, query: { limit, offset: page * limit, ...(src ? { source: src } : {}) }, timeoutMs: TIMEOUT_MS,
              });
              found.push(...res.data.filter((s) => !owned.has(String(s.id))));
              if (res.data.length < limit) break;
            }
            sessions.push(...found);
          }
          // not cut here: with several sources (CLI = local + cli) mergeRecent sorts them by activity, then limits
          return { instanceId: inst.id, label: inst.label, profile, sessions };
        } catch (err) {
          if (!errors.some((e) => e.instance === inst.label)) errors.push({ instance: inst.label, message: errText(err) });
          return null;
        }
      }));
      return pages.filter((p) => p !== null);
    }))).flat();
    return { sessions: mergeRecent(intendia, hermes, limit), errors };
  }

  /** The instance's Intendia titles containing `q`, plus its Hermes' content search when it has it. */
  async search(instanceId: string, q: string, source: SessionSource = 'all'): Promise<{ sessions: RecentSession[]; errors: Err[]; partial: string[] }> {
    const one = this.instance(instanceId);
    const errors: Err[] = [];
    const partial: string[] = [];
    const withIntendia = source === 'all' || source === 'intendia';
    const byTitle: (Owned & { snippet?: string | null })[] = withIntendia ? this.workspaces.searchSessions(q, SEARCH_LIMIT, instanceId) : [];
    const hermes: { instanceId: string; label: string; profile: string; sessions: HermesSessionRaw[] }[] = [];
    await Promise.all([one].map(async (inst) => {
      const owned = this.workspaces.ownedIds(inst.id);
      const hits: { id: string; snippet: string | null }[] = [];
      await Promise.all(this.profiles(inst.id).map(async (profile) => {
        try {
          const results: (HermesSessionRaw & { session_id?: unknown })[] = [];
          for (const src of source === 'intendia' ? [undefined] : hermesSources(source)) {
            const res = await callOp<{ results: (HermesSessionRaw & { session_id?: unknown })[] }>(
              this.compat.http(inst.id), this.compat.get(inst.id), 'sessions', 'search', {
                profile, query: { q, limit: SEARCH_LIMIT, ...(src ? { source: src } : {}) }, timeoutMs: TIMEOUT_MS,
              });
            results.push(...res.results);
          }
          const rows: HermesSessionRaw[] = [];
          for (const r of results) {
            const id = text(r.session_id) ?? text(r.id);
            if (!id) continue;
            if (owned.has(id)) {
              if (withIntendia) hits.push({ id, snippet: text(r.snippet) });
            } else if (source !== 'intendia') rows.push({ ...r, id });
          }
          hermes.push({ instanceId: inst.id, label: inst.label, profile, sessions: rows });
        } catch (err) {
          if (searchUnavailable(err)) {
            if (!partial.includes(inst.label)) partial.push(inst.label);
          } else if (!errors.some((e) => e.instance === inst.label)) errors.push({ instance: inst.label, message: errText(err) });
        }
      }));
      // an owned hit becomes an Intendia line (with its snippet), replacing the title hit of the same session
      const snippets = new Map(hits.map((h) => [h.id, h.snippet]));
      for (const s of this.workspaces.sessionsByIds(inst.id, [...snippets.keys()])) {
        const at = byTitle.findIndex((t) => t.instanceId === s.instanceId && t.id === s.id);
        if (at >= 0) byTitle.splice(at, 1);
        byTitle.push({ ...s, snippet: snippets.get(s.id) ?? null });
      }
    }));
    return { sessions: mergeRecent(byTitle, hermes, SEARCH_LIMIT), errors, partial };
  }
}
