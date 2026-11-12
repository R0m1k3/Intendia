import { AdminError } from '../admin-error.js';
import { presets } from '../chat/presets.js';
import type { CompatService } from '../compat/service.js';
import { DescribeAutoSchema, ProfileCreatedSchema, ProfileDeletedSchema, ProfileListSchema, SoulSchema } from '../connectors/agents/index.js';
import type { Db } from '../db/index.js';
import { callOp, HermesError, hermesDetail, ModuleUnavailableError, type CallOptions } from '../connectors/runtime.js';
import { Masker } from '../hermes-config/mask.js';
import type { InstanceStore } from '../instances/store.js';
import type { KanbanService, PublicWorker } from '../kanban/service.js';
import { NotFoundError, ValidationError, type WorkspaceService } from '../workspaces/service.js';

export const SOUL_MAX = 64 * 1024;
const DESCRIPTION_MAX = 1000;

export interface CreateAgentInput {
  name: string;
  description?: string;
  cloneFrom?: string;
  /** with cloneFrom: memories, sessions… too */
  cloneAll?: boolean;
  noSkills?: boolean;
  soul?: string;
  provider?: string;
  model?: string;
}

export class AgentConflictError extends Error {
  readonly code = 'agent_exists';
}

export interface PublicAgent {
  name: string;
  isDefault: boolean;
  description: string;
  model: string | null;
  provider: string | null;
  skillCount: number | null;
  gatewayRunning: boolean | null;
  /** Intendia can chat with it: `default` uses the instance key, the others need `profileKeys[name]`. */
  hasKey: boolean;
  /** Active kanban workers assigned to it; null when the kanban module is unavailable. */
  workers: number | null;
}

export interface AgentDetail extends PublicAgent {
  /** SOUL.md, secrets that look like tokens masked; null when Hermes does not expose it. */
  soul: string | null;
  soulTruncated: boolean;
  activeWorkers: PublicWorker[];
}

async function translate<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HermesError && err.kind === 'http') {
      if (err.detail.status === 404) throw new NotFoundError(`${what} : ${hermesDetail(err)}`);
      if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(`Refusé par Hermes : ${hermesDetail(err)}`);
    }
    throw err;
  }
}

/** Hermes profiles (agents) of an instance. */
export class AgentService {
  private readonly mask: Masker;

  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    secret: string,
    private readonly kanban: KanbanService,
    private readonly workspaces: WorkspaceService,
    private readonly db: Db,
  ) {
    this.mask = new Masker(secret);
  }

  private instance(instanceId: string) {
    const inst = this.store.get(instanceId);
    if (!inst) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return inst;
  }

  private call<T = unknown>(instanceId: string, op: string, opts: CallOptions = {}, what = 'Agent introuvable'): Promise<T> {
    return translate(() => callOp<T>(this.compat.http(instanceId), this.compat.get(instanceId), 'agents', op, opts), what);
  }

  /** Hermes profiles (dashboard); without it, `default` plus the profiles that have an API server key. */
  async profiles(instanceId: string): Promise<string[]> {
    const inst = this.instance(instanceId);
    try {
      const names = ProfileListSchema.parse(await this.call<unknown>(instanceId, 'list')).profiles.map((p) => p.name);
      if (names.length) return [...new Set(names)];
    } catch {
      // fall through to the configured profiles
    }
    return [...new Set(['default', ...Object.keys(inst.profileKeys)])];
  }

  /** Workers by assignee, or null when the kanban cannot be read (the page hides the column). */
  private async workers(instanceId: string): Promise<PublicWorker[] | null> {
    if (!this.kanban.can(instanceId, 'workers') || !this.kanban.can(instanceId, 'boards')) return null;
    try {
      return await this.kanban.workers(instanceId);
    } catch {
      return null;
    }
  }

  async list(instanceId: string): Promise<PublicAgent[]> {
    const inst = this.instance(instanceId);
    const [raw, workers] = await Promise.all([this.call<unknown>(instanceId, 'list'), this.workers(instanceId)]);
    return ProfileListSchema.parse(raw).profiles.map((p) => ({
      name: p.name,
      isDefault: p.is_default ?? p.name === 'default',
      description: p.description ?? '',
      model: p.model ?? null,
      provider: p.provider ?? null,
      skillCount: p.skill_count ?? null,
      gatewayRunning: p.gateway_running ?? null,
      hasKey: p.name === 'default' || Boolean(inst.profileKeys[p.name]),
      workers: workers ? workers.filter((w) => w.assignee === p.name).length : null,
    }));
  }

  async get(instanceId: string, name: string): Promise<AgentDetail> {
    const agent = (await this.list(instanceId)).find((a) => a.name === name);
    if (!agent) throw new NotFoundError(`Agent introuvable : ${name}`);
    let soul: string | null = null;
    let soulTruncated = false;
    try {
      const raw = SoulSchema.parse(await this.call(instanceId, 'soul', { params: { name } }));
      let text = raw.content ?? '';
      if (text.length > SOUL_MAX) {
        text = text.slice(0, SOUL_MAX);
        soulTruncated = true;
      }
      soul = this.mask.text(text);
    } catch (err) {
      if (!(err instanceof ModuleUnavailableError) && !(err instanceof NotFoundError)) throw err;
    }
    const workers = (await this.workers(instanceId)) ?? [];
    return { ...agent, soul, soulTruncated, activeWorkers: workers.filter((w) => w.assignee === name) };
  }

  /**
   * Creates a profile. Hermes validates the name (format, reserved names) and its message is shown as is. Never sent:
   * `clone_channels` (two agents would fight over one bot), `mcp_servers`, `hub_skills`, `keep_skills`, `api_key`.
   */
  async create(instanceId: string, input: CreateAgentInput): Promise<{ name: string; keySource: 'env' | 'db'; modelError: string | null }> {
    this.instance(instanceId);
    const name = input.name.trim();
    if (!name || name.length > 64) throw new ValidationError('Nom d’agent manquant ou trop long (64 caractères au plus)');
    const description = (input.description ?? '').trim();
    if (description.length > DESCRIPTION_MAX) throw new ValidationError(`Description trop longue (${DESCRIPTION_MAX} caractères au plus)`);
    if (input.soul !== undefined && input.soul.length > SOUL_MAX) throw new ValidationError('SOUL.md trop long (64 Ko au plus)');
    if (Boolean(input.provider) !== Boolean(input.model)) throw new ValidationError('Choisir le fournisseur et le modèle ensemble');
    const existing = await this.profiles(instanceId);
    if (existing.includes(name)) throw new AgentConflictError(`L’agent ${name} existe déjà`);
    if (input.cloneFrom && !existing.includes(input.cloneFrom)) throw new ValidationError(`Agent à copier inconnu : ${input.cloneFrom}`);
    const body: Record<string, unknown> = { name, description };
    if (input.cloneFrom) body.clone_from = input.cloneFrom;
    // clone_all without clone_from would copy `default`: only with an explicit source
    if (input.cloneFrom && input.cloneAll) body.clone_all = true;
    if (input.noSkills) body.no_skills = true;
    if (input.soul?.trim()) body.soul = input.soul;
    if (input.provider && input.model) {
      body.provider = input.provider;
      body.model = input.model;
    }
    const res = ProfileCreatedSchema.parse(await this.call(instanceId, 'create', { body, timeoutMs: 60_000 }));
    return { name, keySource: this.store.declarative ? 'env' : 'db', modelError: res.model_error ? this.mask.text(res.model_error) : null };
  }

  /**
   * Writes SOUL.md from a draft of the masked text: placeholders get their value back from the current text, read
   * again just before (a secret moved where it would show in clear is refused).
   */
  async setSoul(instanceId: string, name: string, draft: string): Promise<{ soul: string }> {
    this.instance(instanceId);
    if (draft.length > SOUL_MAX) throw new AdminError('too_long', 'SOUL.md trop long (64 Ko au plus)');
    const current = SoulSchema.parse(await this.call(instanceId, 'soul', { params: { name } })).content ?? '';
    // the editor never had the whole text: writing would cut it
    if (current.length > SOUL_MAX) throw new AdminError('too_long', 'SOUL.md trop long pour l’éditeur : modifiez-le dans Hermes');
    const content = this.mask.restoreText(draft, current);
    await this.call(instanceId, 'setSoul', { params: { name }, body: { content } });
    return { soul: this.mask.text(content) };
  }

  async setModel(instanceId: string, name: string, provider: string, model: string): Promise<{ provider: string; model: string }> {
    this.instance(instanceId);
    await this.call(instanceId, 'setModel', { params: { name }, body: { provider, model } });
    return { provider, model };
  }

  /** Description written by Hermes' auxiliary model (never over an existing one); null when it proposes nothing. */
  async describeAuto(instanceId: string, name: string): Promise<{ description: string | null; reason: string | null }> {
    this.instance(instanceId);
    const res = DescribeAutoSchema.parse(await this.call(instanceId, 'describeAuto', { params: { name }, body: { overwrite: false }, timeoutMs: 70_000 }));
    if (!res.ok || !res.description) return { description: null, reason: res.reason ? this.mask.text(res.reason) : null };
    return { description: res.description, reason: null };
  }

  /**
   * Deletes a profile (its whole folder at Hermes). Refused for `default` and for a profile Intendia still uses; the
   * Intendia settings of the profile go with it. `keyLeft`: its API key stays in INTENDIA_INSTANCES (environment).
   */
  async remove(instanceId: string, name: string): Promise<{ ok: true; keyLeft: boolean; pending: boolean }> {
    const inst = this.instance(instanceId);
    if (name === 'default') throw new AdminError('protected', 'Le profil principal ne peut pas être supprimé');
    const uses = this.workspaces.usesProfile(instanceId, name);
    if (uses.workspaces.length || uses.sessions) {
      throw new AdminError('in_use', 'Agent encore utilisé par Intendia', { workspaces: uses.workspaces, sessions: uses.sessions });
    }
    const res = ProfileDeletedSchema.parse(await this.call(instanceId, 'remove', { params: { name }, query: { profile: name }, timeoutMs: 30_000 }));
    presets.dropProfile(this.db, instanceId, name);
    return { ok: true, keyLeft: Boolean(inst.profileKeys[name]), pending: res.settlement_pending === true };
  }

  async setDescription(instanceId: string, name: string, description: string): Promise<{ description: string }> {
    this.instance(instanceId);
    const text = description.trim();
    if (text.length > DESCRIPTION_MAX) throw new ValidationError(`Description trop longue (${DESCRIPTION_MAX} caractères au plus)`);
    await this.call(instanceId, 'setDescription', { params: { name }, body: { description: text } });
    return { description: text };
  }
}
