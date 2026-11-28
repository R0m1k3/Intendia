/** share_file in Hermes (apps/server/src/mcp/connect.ts). */
export type McpState = 'connected' | 'stale' | 'manual' | 'other_url' | 'plugin' | 'missing' | 'unknown';
export interface McpTest { ok: boolean; tools: string[]; error?: string }
export interface McpInfo {
  url: string;
  token: string;
  publicUrlSet: boolean;
  state: McpState;
}
export interface McpCatalogEntry {
  name: string; description: string; docsUrl: string | null; auth: string; requiredEnv: { name: string; prompt: string; required: boolean }[];
  transport: string | null; url: string | null; command: string | null; args: string[]; needsInstall: boolean; postInstall: string;
  installed: boolean; enabled: boolean;
}
export interface McpCatalog { entries: McpCatalogEntry[]; diagnostics: string[]; relay: boolean }
export interface McpFlow { id: string; status: string; authorizationUrl: string | null; error: string | null; tools: string[] }
export type McpOauthMode = 'relay' | 'hermes' | 'custom';
export interface Plugin {
  name: string; version: string | null; description: string; source: string | null; status: string | null;
  canRemove: boolean; authRequired: boolean; authCommand: string | null; hidden: boolean; removedReason: string | null;
}
export interface PluginCatalogEntry {
  name: string; title: string; description: string; maintainer: string | null; tier: string | null; category: string | null;
  version: string | null; shaShort: string; docsUrl: string | null; requiresHermes: string | null; platforms: string[];
  tools: string[]; hooks: string[]; middleware: string[]; requiresEnv: string[]; knownIssues: string[];
  installed: boolean; updateAvailable: boolean;
}
export interface PluginCatalog { entries: PluginCatalogEntry[]; removed: { name: string; reason: string | null }[]; generatedAt: string | null }
export interface PluginInstallResult {
  state: 'installed' | 'consent'; plugin: string | null; enabled: boolean; restartRequired: boolean; gatewayReloaded: boolean;
  missingEnv: string[]; warnings: string[]; knownIssues: string[]; message: string | null;
}
export interface PluginJob {
  id: string; name: string; state: 'running' | 'done' | 'failed'; startedAt: number; finishedAt: number | null;
  result: PluginInstallResult | null; error: string | null;
}
export interface McpServer {
  name: string; transport: string | null; url: string | null; command: string | null; args: string[];
  env: { key: string; isSet: boolean }[]; auth: string | null; enabled: boolean; tools: string[]; source: string | null; plugin: string | null;
}
export interface McpInput { name: string; url?: string; token?: string; command?: string; args?: string[]; env?: Record<string, string> }
