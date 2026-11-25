import { and, eq } from 'drizzle-orm';
import { InstanceConfigSchema, type AppConfig, type InstanceConfig } from '../config.js';
import { decrypt, encrypt } from '../crypto.js';
import { msg } from '../i18n/index.js';
import type { Db } from '../db/index.js';
import { instances, profileKeys } from '../db/schema.js';

const KEY_PURPOSE = 'profile-keys-v1';

export interface PublicInstance {
  id: string;
  label: string;
  api: string;
  dashboard: string | null;
  dashboardLink: string | null;
  /** Root of the workspaces read during the last check, or why there is none; null = not checked yet. */
  files: { workspaceRoot: string | null; reason: string | null } | null;
  profiles: string[];
  source: 'env' | 'db';
}

/** Instances declared in INTENDIA_INSTANCES are read-only from the UI. */
export class DeclarativeError extends Error {
  constructor() {
    super(msg('Instances déclarées par INTENDIA_INSTANCES : modifiez-les dans la configuration du conteneur'));
    this.name = 'DeclarativeError';
  }
}

/** An edit that would send a saved secret to a new host (400 `secret_required`). */
export class InstanceEditError extends Error {
  readonly code = 'secret_required';
  constructor(message: string, readonly field: 'apiKey' | 'dashboardToken') {
    super(message);
    this.name = 'InstanceEditError';
  }
}

/**
 * Change of a saved instance (PATCH /x/instances/:id). Absent or empty = unchanged; `null` removes the dashboard (and
 * its token) or the public dashboard link; `profileKeys` is merged by name (`null` removes one).
 */
export interface InstancePatch {
  label?: string;
  api?: string;
  apiKey?: string;
  dashboard?: string | null;
  dashboardToken?: string;
  dashboardLink?: string | null;
  profileKeys?: Record<string, string | null>;
}

/** Origin of a URL (scheme, host, port); an invalid URL is its own origin (the schema refuses it afterwards). */
function origin(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

const given = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';

/**
 * Applies `patch` to `current` (pure). A saved secret never goes to a new host: a new origin of `api` (or `dashboard`)
 * requires `apiKey` (or `dashboardToken`), and a new API origin drops the `profileKeys` the patch does not send again.
 * The result is not validated: callers parse it with `InstanceConfigSchema`.
 */
export function mergeInstance(current: InstanceConfig, patch: InstancePatch): InstanceConfig {
  const out: InstanceConfig = { ...current, profileKeys: { ...current.profileKeys } };
  if (given(patch.label)) out.label = patch.label.trim();

  if (given(patch.api)) {
    const api = patch.api.trim();
    if (origin(api) !== origin(current.api)) {
      if (!given(patch.apiKey)) throw new InstanceEditError(msg('Nouvelle adresse de l’API server : ressaisissez sa clé'), 'apiKey');
      out.profileKeys = {};
    }
    out.api = api;
  }
  if (given(patch.apiKey)) out.apiKey = patch.apiKey.trim();

  if (patch.dashboard === null) {
    delete out.dashboard;
    delete out.dashboardToken;
  } else if (given(patch.dashboard)) {
    const dashboard = patch.dashboard.trim();
    // a dashboard added where there was none has no saved token to protect
    if (current.dashboard !== undefined && origin(dashboard) !== origin(current.dashboard)) {
      if (!given(patch.dashboardToken)) throw new InstanceEditError(msg('Nouvelle adresse du dashboard : ressaisissez son jeton'), 'dashboardToken');
      delete out.dashboardToken;
    }
    out.dashboard = dashboard;
  }
  if (given(patch.dashboardToken) && patch.dashboard !== null) out.dashboardToken = patch.dashboardToken.trim();

  if (patch.dashboardLink === null) delete out.dashboardLink;
  else if (given(patch.dashboardLink)) out.dashboardLink = patch.dashboardLink.trim();

  for (const [name, key] of Object.entries(patch.profileKeys ?? {})) {
    if (key === null) delete out.profileKeys[name];
    else if (given(key)) out.profileKeys[name] = key.trim();
  }
  return out;
}

/** Fields that differ between two configs of the same instance. */
export function changedFields(a: InstanceConfig, b: InstanceConfig): (keyof InstanceConfig)[] {
  const keys: (keyof InstanceConfig)[] = ['label', 'api', 'apiKey', 'dashboard', 'dashboardToken', 'dashboardLink', 'profileKeys'];
  const same = (x: unknown, y: unknown) => {
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const xs = Object.entries(x).sort(([p], [q]) => p.localeCompare(q));
      const ys = Object.entries(y).sort(([p], [q]) => p.localeCompare(q));
      return JSON.stringify(xs) === JSON.stringify(ys);
    }
    return x === y;
  };
  return keys.filter((k) => !same(a[k], b[k]));
}

export class InstanceStore {
  /** Decrypted rows, read once until the next write; every write goes through this store (one process opens the db). */
  private cache: InstanceConfig[] | null = null;

  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  /** Declared in INTENDIA_INSTANCES: the UI cannot edit them. */
  get declarative(): boolean {
    return this.config.envInstances !== null;
  }

  /** The returned array and objects are shared: never modify them (copy, as `mergeInstance` does). */
  list(): InstanceConfig[] {
    this.cache ??= this.withMadeKeys(this.configured());
    return this.cache;
  }

  /** Instances as configured (INTENDIA_INSTANCES or saved), without the keys made by Intendia. */
  private configured(): InstanceConfig[] {
    if (this.config.envInstances) return this.config.envInstances;
    return this.db.select().from(instances).all().map((row) => {
      return InstanceConfigSchema.parse(JSON.parse(decrypt(this.config.secret, row.configEnc)));
    });
  }

  /** Keys made by Intendia fill in the profiles without one; a key of the configuration wins. */
  private withMadeKeys(list: InstanceConfig[]): InstanceConfig[] {
    const made = new Map<string, Record<string, string>>();
    const origins = new Map(list.map((i) => [i.id, origin(i.api)]));
    for (const row of this.db.select().from(profileKeys).all()) {
      // a key goes only to the API server it was written for
      if (origins.get(row.instanceId) !== row.apiOrigin) continue;
      try {
        made.set(row.instanceId, { ...made.get(row.instanceId), [row.profile]: decrypt(this.config.secret, row.keyEnc, KEY_PURPOSE) });
      } catch {
        // INTENDIA_SECRET changed: the agent has to be connected again
      }
    }
    return list.map((i) => (made.has(i.id) ? { ...i, profileKeys: { ...made.get(i.id), ...i.profileKeys } } : i));
  }

  /** The profile's key comes from the configuration: Intendia never replaces it. */
  declaredProfileKey(instanceId: string, profile: string): boolean {
    return Boolean(this.configured().find((i) => i.id === instanceId)?.profileKeys[profile]);
  }

  /** A key Intendia wrote in a profile's .env (instances of INTENDIA_INSTANCES too). */
  setProfileKey(instanceId: string, profile: string, key: string): void {
    const apiOrigin = origin(this.configured().find((i) => i.id === instanceId)?.api);
    if (!apiOrigin) throw new Error(`Unknown instance "${instanceId}"`);
    const keyEnc = encrypt(this.config.secret, key, KEY_PURPOSE);
    this.db.insert(profileKeys).values({ instanceId, profile, keyEnc, apiOrigin, createdAt: Date.now() })
      .onConflictDoUpdate({ target: [profileKeys.instanceId, profileKeys.profile], set: { keyEnc, apiOrigin } }).run();
    this.cache = null;
  }

  /** Forgets the keys Intendia made for an instance (one profile, or all). */
  removeProfileKeys(instanceId: string, profile?: string): void {
    const where = profile === undefined ? eq(profileKeys.instanceId, instanceId) : and(eq(profileKeys.instanceId, instanceId), eq(profileKeys.profile, profile));
    this.db.delete(profileKeys).where(where).run();
    this.cache = null;
  }

  get(id: string): InstanceConfig | undefined {
    return this.list().find((i) => i.id === id);
  }

  save(input: InstanceConfig): InstanceConfig {
    if (this.declarative) throw new DeclarativeError();
    const parsed = InstanceConfigSchema.parse(input);
    const before = this.configured().find((i) => i.id === parsed.id);
    // a key made by Intendia stays in profile_keys (read back by list()), never copied into the saved config
    const made = this.withMadeKeys([{ ...parsed, api: before?.api ?? parsed.api, profileKeys: {} }])[0]!.profileKeys;
    const value = { ...parsed, profileKeys: Object.fromEntries(Object.entries(parsed.profileKeys).filter(([p, k]) => made[p] !== k)) };
    if (before && origin(before.api) !== origin(value.api)) {
      this.removeProfileKeys(value.id); // keys never go to a new API server
    } else {
      // a made key left out (or replaced) by the new config is forgotten: the config says which keys stay
      for (const [p, k] of Object.entries(made)) if (parsed.profileKeys[p] !== k) this.removeProfileKeys(value.id, p);
    }
    const configEnc = encrypt(this.config.secret, JSON.stringify(value));
    this.db.insert(instances).values({ id: value.id, configEnc, createdAt: Date.now() })
      .onConflictDoUpdate({ target: instances.id, set: { configEnc } }).run();
    this.cache = null;
    return value;
  }

  /** New display name; the id, URLs and keys stay. Null when the id is unknown. */
  rename(id: string, label: string): InstanceConfig | null {
    if (this.declarative) throw new DeclarativeError();
    const inst = this.get(id);
    if (!inst) return null;
    return this.save({ ...inst, label });
  }

  remove(id: string): void {
    if (this.declarative) throw new DeclarativeError();
    this.db.delete(instances).where(eq(instances.id, id)).run();
    this.removeProfileKeys(id);
  }

  static toPublic(i: InstanceConfig, source: 'env' | 'db', files: PublicInstance['files'] = null): PublicInstance {
    return {
      id: i.id,
      label: i.label,
      api: i.api,
      dashboard: i.dashboard ?? null,
      dashboardLink: i.dashboardLink ?? null,
      files,
      profiles: Object.keys(i.profileKeys),
      source,
    };
  }
}
