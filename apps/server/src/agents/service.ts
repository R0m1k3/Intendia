import type { CompatService } from '../compat/service.js';
import { ProfileListSchema } from '../connectors/agents/index.js';
import { callOp } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError } from '../workspaces/service.js';

/** Minimal agents service: the profile list for the selectors. The Agents phase extends it. */
export class AgentService {
  constructor(private readonly compat: CompatService, private readonly store: InstanceStore) {}

  /** Hermes profiles (dashboard); without it, `default` plus the profiles that have an API server key. */
  async profiles(instanceId: string): Promise<string[]> {
    const inst = this.store.get(instanceId);
    if (!inst) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    try {
      const raw = await callOp<unknown>(this.compat.http(instanceId), this.compat.get(instanceId), 'agents', 'list');
      const names = ProfileListSchema.parse(raw).profiles.map((p) => p.name);
      if (names.length) return [...new Set(names)];
    } catch {
      // fall through to the configured profiles
    }
    return [...new Set(['default', ...Object.keys(inst.profileKeys)])];
  }
}
