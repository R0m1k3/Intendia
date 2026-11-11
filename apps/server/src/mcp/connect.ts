/**
 * Puts the share_file MCP server of Intendia into Hermes by its dashboard API, so nobody copies a YAML
 * block: entry `intendia` of the `default` profile, bearer token kept in the Hermes env file
 * (`MCP_INTENDIA_API_KEY`), never in clear in its config file.
 */
import type { AppConfig } from '../config.js';
import { mcpTokenEnv } from '../connectors/config/index.js';
import type { Db } from '../db/index.js';
import { ConfigConflictError, type ConfigService } from '../hermes-config/service.js';
import { isMcpSynced, markMcpSynced, mcpToken, mcpUrl, rotateMcpToken } from './server.js';

export const MCP_NAME = 'intendia';
const PROFILE = 'default';
/** Operations of the config module needed here (the web keeps a copy in Settings.tsx). */
export const MCP_AUTO_OPS = ['raw', 'mcpServers', 'addMcp', 'removeMcp', 'putEnv', 'putRaw', 'testMcp'] as const;
/** Header Hermes writes for `auth: header`: the token stays in its env file. */
const MANAGED_AUTH = `Bearer \${${mcpTokenEnv(MCP_NAME)}}`;

/**
 * - `connected`: managed entry, current token sent; `stale`: managed entry, token not sent since the last rotation;
 * - `manual`: right URL but not managed (token in clear, other header, disabled); `other_url`: another server named `intendia`;
 * - `plugin`: provided by a Hermes plugin (cannot be changed); `missing`; `unknown`: Hermes unreadable or operations missing.
 */
export type McpState = 'connected' | 'stale' | 'manual' | 'other_url' | 'plugin' | 'missing' | 'unknown';
export interface McpTest { ok: boolean; tools: string[]; error?: string }

export class McpLink {
  /** One connect / rotate at a time per instance: state read → write → synced flag. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly db: Db,
    private readonly config: Pick<AppConfig, 'mcpPort' | 'mcpUrlBase'>,
  ) {}

  private queued<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.chains.set(id, run);
    void run.catch(() => undefined).finally(() => {
      if (this.chains.get(id) === run) this.chains.delete(id);
    });
    return run;
  }

  async state(id: string): Promise<McpState> {
    try {
      if (!this.configService.canAll(id, MCP_AUTO_OPS)) return 'unknown';
      const e = await this.configService.mcpRawEntry(id, PROFILE, MCP_NAME);
      if (e.status === 'unreadable') return 'unknown';
      if (e.status === 'absent') return 'missing';
      if (e.source === 'plugin') return 'plugin';
      if (e.url !== mcpUrl(this.config, id)) return 'other_url';
      if (e.authorization !== MANAGED_AUTH || !e.enabled) return 'manual';
      return isMcpSynced(this.db, id) ? 'connected' : 'stale';
    } catch {
      return 'unknown';
    }
  }

  /** Sends the current token (managed entry) or replaces the entry; then, outside the queue, Hermes tests it. */
  async connect(id: string, opts: { replaceOther?: boolean; test: boolean }): Promise<{ state: McpState; test?: McpTest }> {
    await this.queued(id, async () => {
      const state = await this.state(id);
      if (state === 'plugin') throw new ConfigConflictError('mcp_plugin', 'Le serveur MCP « intendia » vient d’un plugin d’Hermes : il ne peut pas être remplacé');
      if (state === 'unknown') throw new ConfigConflictError('mcp_unavailable', 'Hermes ne répond pas, ou ne permet pas d’ajouter un serveur MCP');
      if (state === 'other_url' && !opts.replaceOther) {
        throw new ConfigConflictError('mcp_other', 'Un autre serveur MCP nommé « intendia » existe dans Hermes');
      }
      await this.write(id, state);
    });
    const test = opts.test ? await this.test(id) : undefined;
    return { state: await this.state(id), ...(test ? { test } : {}) };
  }

  /** New token; Hermes gets it when the entry is managed. A Hermes error does not undo the rotation. */
  async rotate(id: string): Promise<{ state: McpState; test?: McpTest; error?: string }> {
    let sent = false;
    let error: string | undefined;
    await this.queued(id, async () => {
      const before = await this.state(id);
      rotateMcpToken(this.db, id);
      if (before !== 'connected' && before !== 'stale') return;
      try {
        await this.write(id, before);
        sent = true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    });
    const test = sent ? await this.test(id) : undefined;
    return { state: await this.state(id), ...(test ? { test } : {}), ...(error ? { error } : {}) };
  }

  private async write(id: string, state: McpState): Promise<void> {
    const token = mcpToken(this.db, id);
    if (state === 'connected' || state === 'stale') {
      await this.configService.setEnv(id, PROFILE, mcpTokenEnv(MCP_NAME), token);
    } else {
      await this.configService.replaceMcp(id, PROFILE, { name: MCP_NAME, url: mcpUrl(this.config, id), token, exists: state !== 'missing' });
    }
    markMcpSynced(this.db, id);
  }

  private async test(id: string): Promise<McpTest> {
    try {
      const out = await this.configService.testMcp(id, PROFILE, MCP_NAME);
      const ok = out.ok && out.tools.includes('share_file');
      const error = out.error ?? (out.ok && !ok ? 'Hermes joint le serveur mais ne voit pas l’outil share_file' : undefined);
      return { ok, tools: out.tools, ...(error ? { error } : {}) };
    } catch (err) {
      return { ok: false, tools: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
