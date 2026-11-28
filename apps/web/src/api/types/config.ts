// ---------------------------------------------------------------- Hermes configuration (phase 6)

export interface ConfigField { type?: string; description?: string; category?: string; options?: unknown[]; clearable?: boolean; searchable?: boolean }
export interface ConfigForm { values: Record<string, unknown>; schema: Record<string, ConfigField>; categories: string[]; version: string | null; managed: boolean | null }
export interface ConfigVersion { id: number; createdAt: number; source: string; readable: boolean }
export interface EnvVar {
  key: string; isSet: boolean; description: string | null; category: string | null; isPassword: boolean;
  advanced: boolean; channelManaged: boolean; provider: string | null; custom: boolean;
}
export interface Platform {
  id: string; name: string; enabled: boolean; configured: boolean; state: string | null; errorMessage: string | null;
  env: { key: string; isSet: boolean; required: boolean }[];
}
export type GatewayAction = 'start' | 'stop' | 'restart';
export interface RestartStatus { running: boolean; exitCode: number | null; lines: string[]; truncated: boolean }
export interface WriteResult { version: string | null }
