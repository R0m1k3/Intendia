import { AdminError } from '../admin-error.js';
import type { CompatService } from '../compat/service.js';
import { GraphSchema, MemoryStatusSchema, NodeSchema, type HermesGraph } from '../connectors/memory/index.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import { hostPaths, Masker } from '../hermes-config/mask.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';

/** `memory:<memory|profile>:<index>:<fingerprint>` (Hermes 0.23: sha256 of the entry, 12 hex). */
export const MEMORY_ID_RE = /^memory:(memory|profile):\d{1,6}:[0-9a-f]{12}$/;
/** Hermes' defaults of `memory.memory_char_limit` and `memory.user_char_limit`. */
export const DEFAULT_LIMITS = { memory: 2200, user: 1375 } as const;
export const ENTRY_MAX = 20_000;
const STALE_RE = /stale/i;
const OVER_RE = /Replacement would put memory at/i;

export type MemorySource = 'memory' | 'profile';
export interface PublicMemoryEntry {
  id: string;
  /** `memory` = MEMORY.md (notes of the agent), `profile` = USER.md (what it knows of the user). */
  source: MemorySource;
  title: string;
  /** First 1200 characters, masked. */
  excerpt: string;
  timestamp: number | null;
  /** Learned skills Hermes finds close to this entry. */
  skills: string[];
}
export interface PublicLearnedSkill {
  name: string;
  category: string | null;
  useCount: number;
  state: string | null;
  pinned: boolean;
  createdBy: string | null;
  /** Other learned skills linked to it (`related_skills`). */
  related: string[];
  /** Memory entries close to it (ids). */
  memories: string[];
}
export interface PublicMemory {
  /** External memory provider ("" / null = built-in files only). */
  active: string | null;
  /** Size of the two files in bytes and Hermes' limit in characters; null when Hermes did not say. */
  usage: { memory: { bytes: number; limit: number } | null; user: { bytes: number; limit: number } | null };
  entries: PublicMemoryEntry[];
  skills: PublicLearnedSkill[];
  stats: { skills: number; links: number; isolatedPct: number | null };
}

const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback);

/**
 * Built-in memory (MEMORY.md, USER.md) and learning graph of a profile (lot 8 D). The list comes from the graph, the
 * full text from `GET /api/learning/node`; everything shown is masked, and an edit puts the secrets back from the
 * entry read again (`restoreText`). There is no route to add an entry: the agent does it from a chat.
 */
export class MemoryService {
  private readonly mask: Masker;

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore, secret: string) {
    this.mask = new Masker(secret);
  }

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId) };
  }

  /** Hermes' refusals, masked; "stale" → 409 `stale`, over the file's budget → 400 `over_budget`. */
  private async call<T>(instanceId: string, op: string, opts: Parameters<typeof callOp>[4]): Promise<T> {
    const { http, report } = this.ctx(instanceId);
    try {
      return await callOp<T>(http, report, 'memory', op, opts);
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') {
        const detail = hostPaths(this.mask.text(hermesDetail(err)));
        if (STALE_RE.test(detail)) throw new AdminError('stale', 'L’entrée a changé depuis la lecture de la liste : rechargez');
        if (OVER_RE.test(detail)) throw new AdminError('over_budget', `Mémoire pleine : ${detail}`);
        if (err.detail.status === 404) throw new NotFoundError(`Entrée introuvable : ${detail}`);
        if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(`Requête refusée par Hermes : ${detail}`);
        throw new HermesError('http', `Hermes : ${detail}`, err.detail);
      }
      throw err;
    }
  }

  /** `memory.memory_char_limit` / `user_char_limit` of the profile; Hermes' defaults when the config is not readable. */
  private async limits(instanceId: string, profile: string): Promise<{ memory: number; user: number }> {
    try {
      const { http, report } = this.ctx(instanceId);
      const cfg = await callOp<Record<string, unknown>>(http, report, 'config', 'get', { profile });
      const mem = (cfg.memory && typeof cfg.memory === 'object' ? cfg.memory : {}) as Record<string, unknown>;
      return { memory: int(mem.memory_char_limit, DEFAULT_LIMITS.memory), user: int(mem.user_char_limit, DEFAULT_LIMITS.user) };
    } catch {
      return { ...DEFAULT_LIMITS };
    }
  }

  async overview(instanceId: string, profile: string): Promise<PublicMemory> {
    const [graph, status, limits] = await Promise.all([
      this.call<unknown>(instanceId, 'graph', { profile }).then((g) => GraphSchema.parse(g)),
      this.call<unknown>(instanceId, 'status', { profile }).then((s) => MemoryStatusSchema.parse(s), () => null),
      this.limits(instanceId, profile),
    ]);
    const files = status?.builtin_files;
    const size = (bytes: number | null | undefined, limit: number) => (typeof bytes === 'number' ? { bytes, limit } : null);
    return {
      active: status?.active || null,
      usage: { memory: size(files?.memory, limits.memory), user: size(files?.user, limits.user) },
      ...this.fromGraph(graph),
    };
  }

  private fromGraph(graph: HermesGraph): Pick<PublicMemory, 'entries' | 'skills' | 'stats'> {
    const edges = graph.edges ?? [];
    const linked = (id: string) => edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []));
    const skillNodes = graph.nodes.filter((n) => n.kind === 'skill');
    const skillNames = new Set(skillNodes.map((n) => n.id));
    const cards = graph.memory ?? [];
    const entries: PublicMemoryEntry[] = graph.nodes.filter((n) => n.kind === 'memory' && MEMORY_ID_RE.test(n.id)).map((n) => {
      const fp = n.id.split(':')[3];
      const card = cards.find((c) => c.fingerprint === fp);
      const source = (n.memorySource ?? n.id.split(':')[1]) === 'profile' ? 'profile' : 'memory';
      return {
        id: n.id, source,
        title: this.mask.text(card?.title ?? n.label ?? ''),
        excerpt: this.mask.text(card?.body ?? ''),
        timestamp: card?.timestamp ?? n.timestamp ?? null,
        skills: linked(n.id).filter((x) => skillNames.has(x)),
      };
    });
    const skills: PublicLearnedSkill[] = skillNodes.map((n) => {
      const near = linked(n.id);
      return {
        name: n.id, category: n.category ?? null, useCount: n.useCount ?? 0, state: n.state ?? null, pinned: n.pinned ?? false,
        createdBy: n.createdBy ?? null, related: near.filter((x) => skillNames.has(x)), memories: near.filter((x) => x.startsWith('memory:')),
      };
    });
    const s = graph.stats;
    return { entries, skills, stats: { skills: s?.learned_skills ?? skills.length, links: s?.related_edges ?? 0, isolatedPct: s?.isolated_pct ?? null } };
  }

  private checkId(id: string): void {
    if (!MEMORY_ID_RE.test(id)) throw new ValidationError('Identifiant d’entrée invalide');
  }

  private async raw(instanceId: string, profile: string, id: string): Promise<string> {
    this.checkId(id);
    const node = NodeSchema.parse(await this.call<unknown>(instanceId, 'node', { profile, query: { id } }));
    return node.content;
  }

  /** Full text of an entry, masked. */
  async entry(instanceId: string, profile: string, id: string): Promise<{ id: string; content: string }> {
    return { id, content: this.mask.text(await this.raw(instanceId, profile, id)) };
  }

  /** Rewrites an entry from a draft of its masked text; the secrets come back from the entry read again. */
  async update(instanceId: string, profile: string, id: string, draft: string): Promise<{ ok: true }> {
    this.checkId(id);
    if (!draft.trim()) throw new ValidationError('Entrée vide : utilisez Supprimer');
    if (draft.length > ENTRY_MAX) throw new ValidationError(`Entrée trop longue (${ENTRY_MAX} caractères au plus)`);
    const current = await this.raw(instanceId, profile, id);
    const content = this.mask.restoreText(draft, current);
    await this.call(instanceId, 'putNode', { profile, body: { id, content, profile } });
    return { ok: true };
  }

  async remove(instanceId: string, profile: string, id: string): Promise<{ ok: true }> {
    this.checkId(id);
    await this.call(instanceId, 'deleteNode', { profile, body: { id, profile } });
    return { ok: true };
  }
}
