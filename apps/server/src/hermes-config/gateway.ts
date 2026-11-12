import { AdminError } from '../admin-error.js';
import type { CompatService } from '../compat/service.js';
import { ActionStatusSchema, lastRunLines } from '../connectors/actions.js';
import { GATEWAY_RESTART_ACTION } from '../connectors/config/index.js';
import { callOp, HermesError, hermesDetail, type CallOptions } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError } from '../workspaces/service.js';
import { Masker } from './mask.js';
import { toConfigError, type PublicRestart } from './service.js';

export const GATEWAY_ACTIONS = ['start', 'stop', 'restart'] as const;
export type GatewayAction = (typeof GATEWAY_ACTIONS)[number];

const ACTION_NAME: Record<GatewayAction, string> = { start: 'gateway-start', stop: 'gateway-stop', restart: GATEWAY_RESTART_ACTION };
const OP: Record<GatewayAction, string> = { start: 'gatewayStart', stop: 'gatewayStop', restart: 'restartGateway' };
const STATUS_LINES = 200;

/**
 * Start, stop and restart of a profile's gateway (dashboard background actions). Hermes checks the multiplexer first,
 * then (stop only) the live sessions: a 409 is read from that order, never from its text.
 */
export class GatewayService {
  private readonly mask: Masker;

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore, secret: string) {
    this.mask = new Masker(secret);
  }

  private async call<T = unknown>(instanceId: string, profile: string, op: string, opts: CallOptions = {}): Promise<T> {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return callOp<T>(this.compat.http(instanceId), this.compat.get(instanceId), 'config', op, { profile, ...opts });
  }

  /** `interrupt` (stop only) ends the live sessions of the profile. */
  async run(instanceId: string, profile: string, action: GatewayAction, interrupt = false): Promise<{ ok: true }> {
    const query = action === 'stop' && interrupt ? { interrupt: 'true' } : undefined;
    try {
      await this.call(instanceId, profile, OP[action], { query });
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http' && err.detail.status === 409 && action !== 'restart') {
        const detail = this.mask.text(hermesDetail(err));
        if (action === 'stop' && !interrupt) throw new AdminError('refused', detail);
        throw new AdminError('multiplexed', detail);
      }
      throw toConfigError(this.mask, err);
    }
    return { ok: true };
  }

  async status(instanceId: string, profile: string, action: GatewayAction): Promise<PublicRestart> {
    const name = ACTION_NAME[action];
    try {
      const raw = await this.call<unknown>(instanceId, profile, 'actionStatus', { params: { name }, query: { lines: STATUS_LINES } });
      const s = ActionStatusSchema.parse(raw);
      const last = lastRunLines(name, s.lines);
      return { running: s.running, exitCode: s.exit_code, lines: last.lines.map((l) => this.mask.text(l)), truncated: last.truncated };
    } catch (err) {
      // never run yet: Hermes does not know the action
      if (err instanceof HermesError && err.kind === 'http' && err.detail.status === 404) return { running: false, exitCode: null, lines: [], truncated: false };
      throw toConfigError(this.mask, err);
    }
  }
}
