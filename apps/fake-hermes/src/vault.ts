// Credential vault of Hermes 0.23 (agent/vault_store.py, tui_gateway/methods_vault.py), reached by the dashboard
// JSON-RPC WebSocket `/api/ws`: `vault.list`, `vault.add`, `vault.remove`, per profile. Validations and messages imitate
// Hermes (English), not Intendia's rules. Secrets are kept in clear so tests can check what Hermes received.

export type FakeVaultMode = 'on' | 'off' | 'external' | 'list_fail' | 'remove_fail';

export interface FakeVaultItem {
  id: string;
  kind: 'login' | 'payment' | 'address';
  label: string;
  origin: string | null;
  created_at: string;
  identifier?: string;
  identifier_type?: string;
  has_otp?: boolean;
  /** What `vault.add` received (never returned by `vault.list`). */
  secret: Record<string, string>;
}

const KINDS = ['login', 'payment', 'address'] as const;
const ID_TYPES = ['email', 'phone', 'username'];
const PAYMENT_FIELDS = ['card_number', 'cardholder_name', 'exp_month', 'exp_year', 'cvc', 'billing_postal_code'];
const ADDRESS_FIELDS = ['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country'];
const REQUIRED: Record<'payment' | 'address', string[]> = {
  payment: ['card_number', 'exp_month', 'exp_year', 'cvc'],
  address: ['address_line1', 'city', 'postal_code', 'country'],
};

export class VaultRpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** `scheme://host[:port]`, like Hermes' normalize_origin (default ports dropped). */
function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export class FakeVault {
  private readonly items = new Map<string, FakeVaultItem[]>();
  private seq = 0;
  mode: FakeVaultMode;

  constructor(mode: FakeVaultMode = 'on', private readonly profileExists: (name: string) => boolean = () => true) {
    this.mode = mode;
  }

  /** Items of a profile, secrets included (tests). */
  list(profile = 'default'): FakeVaultItem[] {
    return this.items.get(profile) ?? [];
  }

  clear(): void {
    this.items.clear();
  }

  /** One JSON-RPC call; throws VaultRpcError like Hermes' `_err`. */
  call(method: string, params: Record<string, unknown>): unknown {
    if (this.mode === 'off') throw new VaultRpcError(-32601, `unknown method: ${method}`);
    const profile = typeof params.profile === 'string' && params.profile ? params.profile : 'default';
    if (!this.profileExists(profile)) throw new VaultRpcError(4064, `Profile '${profile}' does not exist.`);
    if (method === 'vault.list') return this.rpcList(profile);
    if (method === 'vault.add') return this.rpcAdd(profile, params);
    if (method === 'vault.remove') return this.rpcRemove(profile, params);
    throw new VaultRpcError(-32601, `unknown method: ${method}`);
  }

  private rpcList(profile: string) {
    if (this.mode === 'list_fail') throw new VaultRpcError(5095, '1Password CLI timed out');
    const items: Record<string, unknown>[] = this.list(profile).map(({ secret: _secret, ...meta }) => ({ ...meta, backend: 'local' }));
    if (this.mode === 'external') {
      items.push({ id: 'op_abc123', kind: 'login', label: 'Compte 1Password', origin: 'https://example.org', created_at: null, identifier: 'moi@example.org', identifier_type: 'email', backend: 'onepassword' });
    }
    return { items };
  }

  private rpcAdd(profile: string, params: Record<string, unknown>) {
    const raw = params.secret;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
      throw new VaultRpcError(5095, 'secret payload is required');
    }
    const secret = Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
    const kind = String(params.kind ?? '');
    if (!(KINDS as readonly string[]).includes(kind)) throw new VaultRpcError(5095, `unknown vault kind '${kind}' (expected one of ('login', 'payment', 'address'))`);
    const label = String(params.label ?? '').trim();
    if (!label) throw new VaultRpcError(5095, 'label is required');
    const originRaw = params.origin ? String(params.origin) : '';
    const origin = originRaw ? normalizeOrigin(originRaw) : null;
    if (originRaw && !origin) throw new VaultRpcError(5095, `invalid origin '${originRaw}'`);
    const item: FakeVaultItem = { id: `vault_${(++this.seq).toString(16).padStart(12, '0')}`, kind: kind as FakeVaultItem['kind'], label, origin, created_at: new Date().toISOString(), secret: {} };
    if (kind === 'login') {
      if (!origin) throw new VaultRpcError(5095, 'origin is required for login items');
      const idType = (secret.identifier_type ?? 'email').trim().toLowerCase();
      if (!ID_TYPES.includes(idType)) throw new VaultRpcError(5095, `identifier_type must be one of ('email', 'phone', 'username')`);
      const identifier = (secret.identifier ?? '').trim();
      if (!identifier || !secret.password) throw new VaultRpcError(5095, 'login items require identifier and password');
      item.identifier = identifier;
      item.identifier_type = idType;
      item.secret = { password: secret.password, ...(secret.otp_secret?.trim() ? { otp_secret: secret.otp_secret } : {}) };
      if (item.secret.otp_secret) item.has_otp = true;
    } else {
      const allowed = kind === 'payment' ? PAYMENT_FIELDS : ADDRESS_FIELDS;
      const kept = Object.fromEntries(Object.entries(secret).filter(([k, v]) => allowed.includes(k) && v.trim()));
      const missing = REQUIRED[kind as 'payment' | 'address'].filter((f) => !(f in kept));
      if (missing.length) throw new VaultRpcError(5095, `${kind} items require ${missing.join(', ')}`);
      item.secret = kept;
    }
    this.items.set(profile, [...this.list(profile), item]);
    return { id: item.id };
  }

  private rpcRemove(profile: string, params: Record<string, unknown>) {
    const id = String(params.id ?? '');
    if (!id) throw new VaultRpcError(5095, 'id is required');
    const before = this.list(profile);
    const after = before.filter((i) => i.id !== id);
    if (after.length === before.length) return { removed: false };
    if (this.mode === 'remove_fail') throw new VaultRpcError(5095, 'vault is locked by another process');
    this.items.set(profile, after);
    return { removed: true };
  }
}

/** The JSON a `browser_vault action=save_login` returns in an API server session (Hermes 0.23). */
export function promptUnavailableResult(origin: string): string {
  return JSON.stringify({
    success: false,
    error_type: 'prompt_unavailable',
    error: `This session cannot ask the user for a login (headless/cron/API). Tell them to run \`hermes vault add\` or use Desktop → Settings → Passwords & Logins for ${origin}.`,
  });
}
