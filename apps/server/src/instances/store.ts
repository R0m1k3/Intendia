import { eq } from 'drizzle-orm';
import { InstanceConfigSchema, type AppConfig, type InstanceConfig } from '../config.js';
import { decrypt, encrypt } from '../crypto.js';
import type { Db } from '../db/index.js';
import { instances } from '../db/schema.js';

export interface PublicInstance {
  id: string;
  label: string;
  api: string;
  dashboard: string | null;
  dashboardLink: string | null;
  mount: string;
  profiles: string[];
  source: 'env' | 'db';
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

  remove(id: string): void {
    if (this.declarative) throw new Error('Instances are declared in INTENDIA_INSTANCES and cannot be edited from the UI');
    this.db.delete(instances).where(eq(instances.id, id)).run();
  }

  static toPublic(i: InstanceConfig, source: 'env' | 'db'): PublicInstance {
    return {
      id: i.id,
      label: i.label,
      api: i.api,
      dashboard: i.dashboard ?? null,
      dashboardLink: i.dashboardLink ?? null,
      mount: i.mount,
      profiles: Object.keys(i.profileKeys),
      source,
    };
  }
}
