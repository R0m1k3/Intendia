// Built-in memory and learning graph of the dashboard (Hermes 0.23 `/api/memory`, `/api/learning/graph`,
// `/api/learning/node` for memory ids): MEMORY.md / USER.md entries separated by "\n§\n", ids and messages as Hermes.
import { createHash } from 'node:crypto';

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };
type Source = 'memory' | 'profile';

export const FAKE_MEMORY_LIMITS = { memory: 2200, user: 1375 };
const DELIMITER = '\n§\n';
const FILE: Record<Source, string> = { memory: 'MEMORY.md', profile: 'USER.md' };
const BASE_TS = Math.floor(Date.UTC(2026, 10, 10, 9, 0, 0) / 1000);

export const fingerprint = (entry: string) => createHash('sha256').update(entry.trim(), 'utf8').digest('hex').slice(0, 12);

/** Seeded entries of the default profile: one holds a secret, one is "instable" (its text changes on every read). */
export const FAKE_MEMORY_SEED = {
  memory: [
    'Le serveur de production s’appelle atlas.\nIl tourne sous Debian 12 et sauvegarde chaque nuit.',
    'Accès au service météo : Authorization: Bearer fake-memory-token-1234567890',
    'Note instable : relue 0 fois',
    'Les rapports hebdomadaires partent le lundi matin, en PDF.',
  ],
  profile: [
    'Michael préfère des réponses courtes, en français.',
    'Fuseau horaire : Europe/Paris.',
  ],
};

interface LearnedSkill { name: string; category: string; useCount: number; createdBy: string; pinned: boolean }

export class MemoryStore {
  private readonly files = new Map<string, Record<Source, string[]>>();
  /** Hermes' mtime per profile and file (seconds), changed on every write. */
  private readonly mtimes = new Map<string, number>();

  constructor(private readonly learned: () => LearnedSkill[]) {
    this.files.set('default', { memory: [...FAKE_MEMORY_SEED.memory], profile: [...FAKE_MEMORY_SEED.profile] });
  }

  entries(profile: string): Record<Source, string[]> {
    let f = this.files.get(profile);
    if (!f) { f = { memory: [], profile: [] }; this.files.set(profile, f); }
    return f;
  }

  private cards(profile: string) {
    const f = this.entries(profile);
    const out: { source: Source; timestamp: number; title: string; body: string; fingerprint: string }[] = [];
    for (const source of ['memory', 'profile'] as Source[]) {
      const ts = this.mtimes.get(`${profile}:${source}`) ?? BASE_TS;
      f[source].forEach((chunk, i) => {
        const first = chunk.split('\n')[0]!.trim().replace(/^#+\s*/, '').trim();
        out.push({ source, timestamp: ts + i, title: first.length > 80 ? `${first.slice(0, 80)}…` : first, body: chunk.slice(0, 1200), fingerprint: fingerprint(chunk) });
      });
    }
    return out;
  }

  private graph(profile: string): Json {
    const cards = this.cards(profile);
    const skills = profile === 'default' ? this.learned() : [];
    const skillEdges = skills.length > 1 ? [[skills[0]!.name, skills[1]!.name]] : [];
    const memEdges: [string, string][] = [];
    const nodes = [
      ...skills.map((s) => ({ id: s.name, label: s.name, kind: 'skill', timestamp: BASE_TS, category: s.category, useCount: s.useCount, state: 'active', createdBy: s.createdBy, pinned: s.pinned })),
      ...cards.map((c, i) => {
        const id = `memory:${c.source}:${i}:${c.fingerprint}`;
        // the first two notes are "close to" the first skills (Hermes: lexical overlap)
        if (c.source === 'memory' && i < 2 && skills[i]) memEdges.push([id, skills[i]!.name]);
        return { id, label: c.title, kind: 'memory', memorySource: c.source, timestamp: c.timestamp, category: 'memory', useCount: 0, state: 'active', createdBy: 'memory', pinned: false };
      }),
    ];
    const categories = new Map<string, number>();
    for (const s of skills) categories.set(s.category, (categories.get(s.category) ?? 0) + 1);
    if (cards.length) categories.set('memory', cards.length);
    const linked = new Set(skillEdges.flat());
    return {
      nodes,
      edges: [...skillEdges, ...memEdges].map(([source, target]) => ({ source, target })),
      clusters: [...categories].map(([category, count]) => ({ category, count })),
      memory: cards,
      stats: {
        nodes: skills.length, related_edges: skillEdges.length, edges_per_node: skills.length ? skillEdges.length / skills.length : 0,
        linked_nodes: linked.size, isolated_pct: skills.length ? Math.round(((skills.length - linked.size) / skills.length) * 100) : 0,
        categories: new Set(skills.map((s) => s.category)).size, agent_created: skills.filter((s) => s.createdBy === 'agent').length,
        used: skills.filter((s) => s.useCount > 0).length, top_categories: [...categories].filter(([c]) => c !== 'memory').slice(0, 8),
        memory_nodes: cards.length, memory_skill_edges: memEdges.length, learned_skills: skills.length,
      },
    };
  }

  /** Resolves `memory:<source>:<index>:<fingerprint>` like Hermes: by text, else stale. */
  private locate(profile: string, id: string): { source: Source; local: number } | Reply {
    const m = /^memory:(memory|profile):(\d+)(?::([0-9a-f]{12}))?$/.exec(id);
    if (!m) return { status: 400, body: { detail: `bad memory node id: '${id}'` } };
    const source = m[1] as Source;
    const list = this.entries(profile)[source];
    const local = list.findIndex((e) => fingerprint(e) === m[3]);
    if (local < 0) return { status: 400, body: { detail: 'memory node id is stale — refresh the graph' } };
    return { source, local };
  }

  private touch(profile: string, source: Source) {
    this.mtimes.set(`${profile}:${source}`, (this.mtimes.get(`${profile}:${source}`) ?? BASE_TS) + 3600);
  }

  /** null: not a memory route (skill ids of /api/learning/node go to the skills store). */
  handle(method: string, path: string, query: Record<string, string>, body: unknown): Reply | null {
    const b = (body && typeof body === 'object' ? body : {}) as Json;
    const profile = String(b.profile ?? query.profile ?? 'default') || 'default';
    if (method === 'GET' && path === '/api/memory') {
      const f = this.entries(profile);
      const bytes = (l: string[]) => Buffer.byteLength(l.join(DELIMITER), 'utf8');
      return { status: 200, body: { active: '', providers: [], builtin_files: { memory: bytes(f.memory), user: bytes(f.profile) } } };
    }
    if (method === 'GET' && path === '/api/learning/graph') return { status: 200, body: this.graph(profile) };
    if (path !== '/api/learning/node') return null;
    const id = String(method === 'GET' ? query.id ?? '' : b.id ?? '');
    if (!id.startsWith('memory:')) return null;
    const at = this.locate(profile, id);
    if ('status' in at) return method === 'GET' ? { status: 404, body: at.body } : at;
    const list = this.entries(profile)[at.source];
    if (method === 'GET') {
      const content = list[at.local]!.trim();
      // "instable": the agent rewrites it after every read, so the id read here is stale at once
      if (content.includes('instable')) list[at.local] = content.replace(/relue (\d+) fois/, (_m, n: string) => `relue ${Number(n) + 1} fois`);
      return { status: 200, body: { ok: true, kind: 'memory', id, label: content.split('\n')[0]!.slice(0, 80), content } };
    }
    if (method === 'DELETE') {
      list.splice(at.local, 1);
      this.touch(profile, at.source);
      return { status: 200, body: { ok: true, message: `deleted memory from ${FILE[at.source]}` } };
    }
    if (method === 'PUT') {
      const text = String(b.content ?? '').trim();
      if (!text) return { status: 400, body: { detail: 'empty memory — use delete to remove it' } };
      const next = [...list];
      next[at.local] = text;
      const limit = at.source === 'memory' ? FAKE_MEMORY_LIMITS.memory : FAKE_MEMORY_LIMITS.user;
      const total = next.join(DELIMITER).length;
      if (total > limit) {
        return { status: 400, body: { detail: `Replacement would put memory at ${total.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} chars. Shorten the new content.` } };
      }
      list.splice(0, list.length, ...next);
      this.touch(profile, at.source);
      return { status: 200, body: { ok: true, message: `updated memory in ${FILE[at.source]}` } };
    }
    return null;
  }
}
