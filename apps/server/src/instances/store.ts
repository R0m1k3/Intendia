import { eq } from 'drizzle-orm';
import { InstanceConfigSchema, type AppConfig, type InstanceConfig } from '../config.js';
import { decrypt, encrypt } from '../crypto.js';
import { msg } from '../i18n/index.js';
import type { Db } from '../db/index.js';
import { instances } from '../db/schema.js';

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
    super(msg('Instances déclarées par INTENDIA_INSTANCES : changez le nom dans la configuration du conteneur'));
    this.name = 'DeclarativeError';
  }
}

export class InstanceStore {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  /** Declared in INTENDIA_INSTANCES: the UI cannot edit them. */
  get declarative(): boolean {
    return this.config.envInstances !== null;
  }

  list(): InstanceConfig[] {
    if (this.config.envInstances) return this.config.envInstances;
    return this.db.select().from(instances).all().map((row) => {
      return InstanceConfigSchema.parse(JSON.parse(decrypt(this.config.secret, row.configEnc)));
    });
  }

  get(id: string): InstanceConfig | undefined {
    return this.list().find((i) => i.id === id);
  }

  save(input: InstanceConfig): InstanceConfig {
    if (this.declarative) throw new Error('Instances are declared in INTENDIA_INSTANCES and cannot be edited from the UI');
    const value = InstanceConfigSchema.parse(input);
    const configEnc = encrypt(this.config.secret, JSON.stringify(value));
    this.db.insert(instances).values({ id: value.id, configEnc, createdAt: Date.now() })
      .onConflictDoUpdate({ target: instances.id, set: { configEnc } }).run();
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
    if (this.declarative) throw new Error('Instances are declared in INTENDIA_INSTANCES and cannot be edited from the UI');
    this.db.delete(instances).where(eq(instances.id, id)).run();
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
