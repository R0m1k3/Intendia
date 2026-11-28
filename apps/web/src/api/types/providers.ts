export interface ModelProvider {
  slug: string; name: string; authenticated: boolean; keyEnv: string | null; models: string[]; warning: string | null;
  /** Models declared in Hermes for this provider (what the chat offers; none = whole catalogue). */
  declared: string[];
  /** The declaration can be changed from Intendia (else: YAML tab). */
  editable: boolean;
}
export interface ConfigModels {
  main: { provider: string; model: string; contextLength: number | null };
  providers: ModelProvider[];
  auxiliary: { task: string; label: string | null; provider: string; model: string }[];
  version: string | null;
}
/** Provider account (subscription) of an agent: connected by a device code, or by a command on the Hermes machine. */
export interface ProviderAccount {
  id: string; name: string; flow: 'device_code' | 'external';
  cliCommand: string | null; docsUrl: string | null;
  disconnectable: boolean; disconnectHint: string | null;
  connected: boolean; expiresAt: string | null;
  /** Anthropic only: `token` = setup-token variable, `api_key` = a paid API key is used, `hermes` = login on its machine. */
  via?: 'token' | 'api_key' | 'hermes' | null;
}
/** API key of the credential pool (never its value). `source`: `manual`, or `env:NAME` for a key variable. */
/** Custom endpoint of the config file: `providers.<slug>` (v12) or an old `custom_providers` entry (slug null). */
export interface CustomProvider {
  slug: string | null;
  name: string;
  baseUrl: string;
  model: string | null;
  key: { kind: 'env'; name: string; set: boolean } | { kind: 'inline' } | null;
  legacy: boolean;
}
export interface ProviderKey { provider: string; id: string; label: string; source: string; lastStatus: string | null }
export interface ProvidersInfo {
  accounts: ProviderAccount[] | null;
  keys: ProviderKey[] | null;
  keyProviders: { slug: string; name: string }[];
}
export interface ConnectStart { sessionId: string; userCode: string; verificationUrl: string; pollInterval: number | null; expiresIn: number | null }
export interface ConnectPoll { status: string; error: string | null; model: string | null }
export interface ModelInput { scope: 'main' | 'auxiliary'; provider: string; model: string; task?: string; confirm?: boolean; version: string }
