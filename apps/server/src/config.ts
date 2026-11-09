import { z } from 'zod';

/**
 * Instance declared in INTENDIA_INSTANCES (declarative install) or through the setup wizard.
 * Only `id`, `label`, `api` and `apiKey` are required: the dashboard (port 9119) is optional,
 * modules that need it are then reported as unavailable with the reason.
 */
export const InstanceConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'id: a-z, 0-9 and dash, 40 characters max'),
  label: z.string().min(1).max(80),
  api: z.url(),
  apiKey: z.string().min(16, 'apiKey: Hermes requires at least 16 characters'),
  dashboard: z.url().optional(),
  dashboardToken: z.string().min(1).optional(),
  /** Public URL of the official dashboard, used for "open in the dashboard" links. */
  dashboardLink: z.url().optional(),
  /** Where this instance's workspace volume is mounted inside the Intendia container. */
  mount: z.string().startsWith('/').default('/workspace'),
  /** Multi-profile routing: each /p/<profile>/ prefix has its own API key. */
  profileKeys: z.record(z.string(), z.string().min(16)).default({}),
});
export type InstanceConfig = z.infer<typeof InstanceConfigSchema>;

const EnvSchema = z.object({
  INTENDIA_PUBLIC_URL: z.url().optional(),
  INTENDIA_SECRET: z.string().min(32, 'INTENDIA_SECRET must be at least 32 characters (openssl rand -hex 32)'),
  INTENDIA_PASSWORD_HASH: z.string().startsWith('$argon2').optional(),
  INTENDIA_INSTANCES: z.string().optional(),
  INTENDIA_DATA_DIR: z.string().default('/data'),
  INTENDIA_PORT: z.coerce.number().int().default(3000),
  INTENDIA_MCP_PORT: z.coerce.number().int().default(3001),
  INTENDIA_WEB_DIR: z.string().optional(),
  INTENDIA_TRUST_PROXY: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Optional webhook called when a module changes state (JSON POST). */
  INTENDIA_WEBHOOK_URL: z.url().optional(),
  /** Minutes between two cheap version checks of each instance. */
  INTENDIA_VERSION_CHECK_MINUTES: z.coerce.number().int().min(1).default(5),
});

export interface AppConfig {
  publicUrl: string | undefined;
  secret: string;
  passwordHash: string | undefined;
  envInstances: InstanceConfig[] | null;
  dataDir: string;
  port: number;
  mcpPort: number;
  webDir: string | undefined;
  trustProxy: boolean;
  webhookUrl: string | undefined;
  versionCheckMinutes: number;
}

export function parseInstances(raw: string): InstanceConfig[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('INTENDIA_INSTANCES is not valid JSON');
  }
  const list = z.array(InstanceConfigSchema).parse(json);
  const ids = new Set<string>();
  for (const i of list) {
    if (ids.has(i.id)) throw new Error(`INTENDIA_INSTANCES: duplicate id "${i.id}"`);
    ids.add(i.id);
  }
  return list;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    publicUrl: e.INTENDIA_PUBLIC_URL?.replace(/\/$/, ''),
    secret: e.INTENDIA_SECRET,
    passwordHash: e.INTENDIA_PASSWORD_HASH,
    envInstances: e.INTENDIA_INSTANCES ? parseInstances(e.INTENDIA_INSTANCES) : null,
    dataDir: e.INTENDIA_DATA_DIR,
    port: e.INTENDIA_PORT,
    mcpPort: e.INTENDIA_MCP_PORT,
    webDir: e.INTENDIA_WEB_DIR,
    trustProxy: e.INTENDIA_TRUST_PROXY,
    webhookUrl: e.INTENDIA_WEBHOOK_URL,
    versionCheckMinutes: e.INTENDIA_VERSION_CHECK_MINUTES,
  };
}
