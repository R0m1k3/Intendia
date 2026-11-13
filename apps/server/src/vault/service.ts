// The credential vault of Hermes (logins, cards, addresses) for the "Accès" page, through the dashboard WebSocket.
// Secrets go straight to Hermes: never stored, logged or put in an error. No text of Hermes reaches the browser.
import { AdminError } from '../admin-error.js';
import type { CompatService } from '../compat/service.js';
import { HermesError } from '../connectors/runtime.js';
import { GatewaySocketError, vaultAdd, vaultList, vaultRemove } from '../hermes/gateway-ws.js';
import type { InstanceStore } from '../instances/store.js';
import type { InstanceConfig } from '../config.js';
import { NotFoundError } from '../workspaces/service.js';
import { FIELD_LABEL, HERMES_TO_FIELD, toHermes, type VaultInput } from './input.js';

export interface PublicVaultItem {
  id: string;
  kind: 'login' | 'payment' | 'address';
  label: string;
  origin: string | null;
  createdAt: string | null;
  /** logins only */
  identifier: string | null;
  identifierType: 'email' | 'phone' | 'username' | null;
  hasOtp: boolean;
}

const ID_RE = /^vault_[0-9a-f]{6,40}$/;
const ID_TYPES = new Set(['email', 'phone', 'username']);
type Op = 'list' | 'add' | 'remove';
const FAILED: Record<Op, string> = {
  list: "Hermes n'a pas pu lire le coffre (un gestionnaire de mots de passe externe peut le bloquer)",
  add: "Hermes a refusé l'enregistrement",
  remove: "Hermes n'a pas pu supprimer l'accès",
};

/** A refusal of `vault.add` (5095) read for its field names only; never its text. */
function addRefusal(message: string): AdminError {
  const req = /^(?:login|payment|address) items require (.+)$/.exec(message);
  if (req) {
    const fields = req[1]!.split(/,\s*|\s+and\s+/).map((n) => HERMES_TO_FIELD[n.trim()]).filter((f): f is string => Boolean(f));
    if (fields.length) {
      return new AdminError('invalid_field', `Champs obligatoires : ${fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}`, { field: fields[0] });
    }
  }
  if (/origin is required/.test(message)) return new AdminError('invalid_field', 'Champ obligatoire', { field: 'origin' });
  if (/label is required/.test(message)) return new AdminError('invalid_field', 'Champ obligatoire', { field: 'label' });
  if (/otp|authenticator/i.test(message)) return new AdminError('invalid_field', "Clé d'authentification invalide", { field: 'otpSecret' });
  return new AdminError('invalid_field', FAILED.add);
}

/** Any failure of a vault call → an error of Intendia with a fixed French message. */
function convert(err: unknown, op: Op): Error {
  if (err instanceof AdminError || err instanceof NotFoundError) return err;
  if (!(err instanceof GatewaySocketError)) return new HermesError('schema', "Erreur d'Hermes");
  if (err.code === -32601) return new AdminError('unsupported', "Cette version d'Hermes ne permet pas de gérer le coffre");
  if (err.code === 4064) return new NotFoundError('Profil inconnu');
  if (err.code === 5095) return op === 'add' ? addRefusal(err.message) : new HermesError('http', FAILED[op]);
  if (err.code !== null) return new HermesError('http', `Erreur d'Hermes (code ${err.code})`);
  if (err.message === 'Dashboard non configuré') return new HermesError('unconfigured', 'Dashboard non configuré');
  return new HermesError('timeout', 'Hermes ne répond pas');
}

export class VaultService {
  private readonly timeoutMs: number;

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private target(instanceId: string): InstanceConfig {
    const inst = this.store.get(instanceId);
    if (!inst) throw new NotFoundError('Instance inconnue');
    if (this.compat.get(instanceId)?.socket?.vault !== true) {
      throw new AdminError('unsupported', "Cette version d'Hermes ne permet pas de gérer le coffre");
    }
    return inst;
  }

  private opts() {
    return { factory: this.compat.wsFactory, timeoutMs: this.timeoutMs };
  }

  private static checkId(id: string): void {
    if (!ID_RE.test(id)) throw new AdminError('invalid_field', 'Identifiant invalide', { field: 'id' });
  }

  async list(instanceId: string, profile: string): Promise<{ items: PublicVaultItem[]; external: number }> {
    const inst = this.target(instanceId);
    let raw;
    try {
      raw = await vaultList(inst, profile, this.opts());
    } catch (err) {
      throw convert(err, 'list');
    }
    const local = raw.filter((i) => !i.backend || i.backend === 'local');
    const items = local.map((i): PublicVaultItem => ({
      id: i.id, kind: i.kind, label: i.label, origin: i.origin ?? null, createdAt: i.created_at ?? null,
      identifier: i.kind === 'login' ? i.identifier ?? null : null,
      identifierType: i.kind === 'login' && i.identifier_type && ID_TYPES.has(i.identifier_type) ? (i.identifier_type as PublicVaultItem['identifierType']) : null,
      hasOtp: i.has_otp === true,
    })).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return { items, external: raw.length - local.length };
  }

  async add(instanceId: string, profile: string, input: VaultInput): Promise<{ id: string }> {
    const inst = this.target(instanceId);
    try {
      return { id: await vaultAdd(inst, profile, toHermes(input), this.opts()) };
    } catch (err) {
      throw convert(err, 'add');
    }
  }

  async remove(instanceId: string, profile: string, id: string): Promise<void> {
    VaultService.checkId(id);
    const inst = this.target(instanceId);
    let removed: boolean;
    try {
      removed = await vaultRemove(inst, profile, id, this.opts());
    } catch (err) {
      throw convert(err, 'remove');
    }
    if (!removed) throw new NotFoundError('Accès introuvable');
  }

  /**
   * New item first, then the old one removed: a failed add leaves the old item as it was. `oldKept`: the new item is
   * saved but the old one could not be removed (an old item already gone, or not in the local vault, is not kept).
   */
  async replace(instanceId: string, profile: string, oldId: string, input: VaultInput): Promise<{ id: string; oldKept: boolean }> {
    VaultService.checkId(oldId);
    const { id } = await this.add(instanceId, profile, input);
    try {
      await vaultRemove(this.target(instanceId), profile, oldId, this.opts());
      return { id, oldKept: false };
    } catch {
      return { id, oldKept: true };
    }
  }
}
