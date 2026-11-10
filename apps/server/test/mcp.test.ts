import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forgetMcpToken, mcpToken, rotateMcpToken } from '../src/mcp/server.js';
import { testApp } from './helpers.js';

async function setup(env: Record<string, string> = { INTENDIA_PUBLIC_URL: 'https://intendia.example.test' }) {
  const t = await testApp({ instance: { agentMount: '/opt/data/workspace' }, env });
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const ws = join(t.mount, 'dev');
  writeFileSync(join(ws, 'files', 'r.md'), '# r');
  mkdirSync(join(ws, 'files', 'd'));
  symlinkSync('/etc/hostname', join(ws, 'files', 'host'));
  const token = mcpToken(t.db, 'fake');
  const post = (body: unknown, o: { token?: string; inst?: string; raw?: string } = {}) => t.mcp.request(`/mcp/${o.inst ?? 'fake'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${o.token ?? token}` },
    body: o.raw ?? JSON.stringify(body),
  });
  const rpc = async (method: string, params?: unknown) => (await (await post({ jsonrpc: '2.0', id: 1, method, params })).json()) as any;
  const call = async (path: unknown) => (await rpc('tools/call', { name: 'share_file', arguments: { path } })).result;
  return { ...t, token, post, rpc, call };
}

describe('MCP server', () => {
  it('method, instance and token checks, in that order', async () => {
    const t = await setup();
    expect((await t.mcp.request('/mcp/fake', { method: 'GET' })).status).toBe(405);
    expect((await t.mcp.request('/mcp/fake', { method: 'HEAD' })).status).toBe(405);
    expect((await t.post({}, { inst: 'nope' })).status).toBe(404);
    expect((await t.mcp.request('/mcp/fake', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await t.post({}, { token: 'x'.repeat(32) })).status).toBe(401);
    rotateMcpToken(t.db, 'fake');
    expect((await t.post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
  });

  it('deleting the instance forgets its token', async () => {
    const t = await setup();
    const before = t.token;
    forgetMcpToken(t.db, 'fake'); // called by DELETE /x/instances/:id (instances are declarative in tests)
    expect(mcpToken(t.db, 'fake')).not.toBe(before);
  });

  it('initialize negotiates the version; notifications get 202', async () => {
    const t = await setup();
    const r = await t.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hermes', version: '0.23.0' } });
    expect(r.result.protocolVersion).toBe('2025-11-25');
    expect(r.result.serverInfo.name).toBe('intendia');
    expect(r.result.capabilities.tools).toBeDefined();
    expect((await t.rpc('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion).toBe('2025-03-26');
    expect((await t.rpc('initialize', { protocolVersion: '2099-01-01' })).result.protocolVersion).toBe('2025-11-25');
    expect((await t.post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await t.rpc('ping')).result).toEqual({});
  });

  it('tools/list and share_file', async () => {
    const t = await setup();
    const tools = (await t.rpc('tools/list')).result.tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'share_file', inputSchema: { required: ['path'] } });
    const ok = await t.call('/opt/data/workspace/dev/files/r.md');
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toMatch(/^https:\/\/intendia\.example\.test\/f\/[0-9A-Za-z]{10}$/);
    const row = t.db.$client.prepare('SELECT path, public_until FROM share_links').get() as any;
    expect(row).toEqual({ path: 'dev/files/r.md', public_until: null });
    expect((await t.call('/opt/data/workspace/dev/files/r.md')).content[0].text).toBe(ok.content[0].text);
    for (const bad of ['/etc/passwd', '/opt/data/workspace/dev/files/d', '/opt/data/workspace/dev/files/none.md', '/opt/data/workspace/dev/files/host', 'files/r.md', '/opt/data/workspace/../etc/passwd', 42]) {
      expect((await t.call(bad)).isError, String(bad)).toBe(true);
    }
  });

  it('without INTENDIA_PUBLIC_URL the tool says the link only works in Intendia', async () => {
    const t = await setup({});
    const text = (await t.call('/opt/data/workspace/dev/files/r.md')).content[0].text as string;
    expect(text).toMatch(/^\/f\/[0-9A-Za-z]{10}\n\(INTENDIA_PUBLIC_URL n'est pas configurée/);
  });

  it('JSON-RPC errors and body limit', async () => {
    const t = await setup();
    expect((await t.rpc('resources/list')).error.code).toBe(-32601);
    expect((await (await t.post([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).json() as any).error.code).toBe(-32600);
    expect((await (await t.post(null, { raw: '{not json' })).json() as any).error.code).toBe(-32700);
    expect((await t.rpc('tools/call', { name: 'other' })).error.code).toBe(-32602);
    expect((await t.post(null, { raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(70_000) }) })).status).toBe(413);
  });

  it('instance route gives the URL and the token; rotate changes it', async () => {
    const t = await setup();
    const info = (await t.request('GET', '/x/instances/fake/mcp')).json;
    expect(info).toEqual({ url: 'http://intendia:3001/mcp/fake', token: t.token, publicUrlSet: true });
    const next = (await t.request('POST', '/x/instances/fake/mcp/rotate')).json;
    expect(next.token).not.toBe(t.token);
    expect((await t.request('GET', '/x/instances/nope/mcp')).status).toBe(404);
  });
});
