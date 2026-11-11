import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forgetMcpToken, mcpToken, rotateMcpToken } from '../src/mcp/server.js';
import { configVersions } from '../src/db/schema.js';
import { parse } from '../src/hermes-config/mask.js';
import { testApp } from './helpers.js';

async function setup(env: Record<string, string> = { INTENDIA_PUBLIC_URL: 'https://intendia.example.test' }) {
  const t = await testApp({ env });
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const ws = join(t.root, 'dev');
  writeFileSync(join(ws, 'files', 'r.md'), '# r');
  mkdirSync(join(ws, 'files', 'd'));
  symlinkSync(join(ws, 'files', 'r.md'), join(ws, 'files', 'host'));
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
    const ok = await t.call(`${t.root}/dev/files/r.md`);
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toMatch(/^https:\/\/intendia\.example\.test\/f\/[0-9A-Za-z]{10}$/);
    const row = t.db.$client.prepare('SELECT path, public_until FROM share_links').get() as any;
    expect(row).toEqual({ path: 'dev/files/r.md', public_until: null });
    expect((await t.call(`${t.root}/dev/files/r.md`)).content[0].text).toBe(ok.content[0].text);
    for (const bad of ['/etc/passwd', `${t.root}/dev/files/d`, `${t.root}/dev/files/none.md`, `${t.root}/dev/files/host`, 'files/r.md', `${t.root}/../etc/passwd`, '/opt/data/workspace/dev/files/r.md', 42]) {
      expect((await t.call(bad)).isError, String(bad)).toBe(true);
    }
  });

  it('without INTENDIA_PUBLIC_URL the tool says the link only works in Intendia', async () => {
    const t = await setup({});
    const text = (await t.call(`${t.root}/dev/files/r.md`)).content[0].text as string;
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
    expect(info).toEqual({ url: 'http://intendia:3001/mcp/fake', token: t.token, publicUrlSet: true, state: 'missing' });
    const next = (await t.request('POST', '/x/instances/fake/mcp/rotate')).json;
    expect(next.token).not.toBe(t.token);
    expect((await t.request('GET', '/x/instances/nope/mcp')).status).toBe(404);
  });
});

describe('mcp: put into Hermes by Intendia', () => {
  type T = Awaited<ReturnType<typeof testApp>>;
  const KEY = 'MCP_INTENDIA_API_KEY';
  const entry = (t: T) => (parse(t.fake.config.raw).toJS() as any).mcp_servers?.intendia;
  const writes = (t: T) => t.fake.requests.filter((r) => r.via === 'dash' && r.method !== 'GET'
    && (r.path === '/api/env' || (r.path.startsWith('/api/mcp/servers') && !r.path.endsWith('/test'))));
  const state = async (t: T) => (await t.request('GET', '/x/instances/fake/mcp')).json.state;
  const historyCount = (t: T) => t.db.select().from(configVersions).all().length;
  const addOther = (t: T, url: string, header = 'Bearer pasted-token-in-clear') =>
    t.fake.config.setRaw(`${t.fake.config.raw}\n`.replace(/\nmcp_servers:\n/, `\nmcp_servers:\n  intendia:\n    url: ${url}\n    headers:\n      Authorization: "${header}"\n`));

  it('connects a missing entry: token in the env file, not in the YAML, tested by Hermes', async () => {
    const t = await testApp();
    expect(await state(t)).toBe('missing');
    const before = historyCount(t);
    const res = await t.request('POST', '/x/instances/fake/mcp/connect', {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ state: 'connected', test: { ok: true, tools: ['share_file'] } });
    expect(entry(t)).toMatchObject({ url: 'http://intendia:3001/mcp/fake', headers: { Authorization: `Bearer \${${KEY}}` } });
    expect(t.fake.config.envValues.get(KEY)).toBe(mcpToken(t.db, 'fake'));
    expect(t.fake.config.raw).not.toContain(mcpToken(t.db, 'fake'));
    expect(historyCount(t)).toBe(before + 1);
  });

  it('only rewrites the env variable when the entry is managed', async () => {
    const t = await testApp();
    await t.request('POST', '/x/instances/fake/mcp/connect', {});
    const n = writes(t).length;
    const res = await t.request('POST', '/x/instances/fake/mcp/connect', {});
    expect(res.json.state).toBe('connected');
    expect(writes(t).slice(n).map((r) => `${r.method} ${r.path}`)).toEqual(['PUT /api/env']);
  });

  it('replaces a block pasted by hand (token in clear) without asking', async () => {
    const t = await testApp();
    addOther(t, 'http://intendia:3001/mcp/fake');
    expect(entry(t)?.url).toBe('http://intendia:3001/mcp/fake');
    expect(await state(t)).toBe('manual');
    expect((await t.request('POST', '/x/instances/fake/mcp/connect', {})).json.state).toBe('connected');
    expect(t.fake.config.raw).not.toContain('pasted-token-in-clear');
  });

  it('asks before replacing another server named intendia', async () => {
    const t = await testApp();
    addOther(t, 'https://elsewhere.example.test/mcp');
    expect(await state(t)).toBe('other_url');
    const refused = await t.request('POST', '/x/instances/fake/mcp/connect', {});
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('mcp_other');
    expect(entry(t).url).toBe('https://elsewhere.example.test/mcp');
    expect((await t.request('POST', '/x/instances/fake/mcp/connect', { replaceOther: true })).json.state).toBe('connected');
  });

  it('never touches a server provided by a plugin', async () => {
    const t = await testApp();
    t.fake.config.pluginMcpName = 'intendia';
    expect(await state(t)).toBe('plugin');
    const res = await t.request('POST', '/x/instances/fake/mcp/connect', {});
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('mcp_plugin');
  });

  it('puts the other entry back when Hermes refuses the new one', async () => {
    const t = await testApp({ env: { INTENDIA_MCP_URL: 'http://refuse.example.test:3001' } });
    addOther(t, 'https://elsewhere.example.test/mcp');
    const before = t.fake.config.raw;
    const res = await t.request('POST', '/x/instances/fake/mcp/connect', { replaceOther: true });
    expect(res.status).toBe(400);
    expect(t.fake.config.raw).toBe(before);
    expect(await state(t)).toBe('other_url');
  });

  it('sends a new token to Hermes; a failure leaves the state stale until the next connect', async () => {
    const breaks: Record<string, { status: number }> = {};
    const t = await testApp({ breaks });
    await t.request('POST', '/x/instances/fake/mcp/connect', {});
    const rotated = await t.request('POST', '/x/instances/fake/mcp/rotate');
    expect(rotated.json).toMatchObject({ state: 'connected', test: { ok: true } });
    expect(t.fake.config.envValues.get(KEY)).toBe(rotated.json.token);
    breaks['dash PUT /api/env'] = { status: 500 };
    const failed = await t.request('POST', '/x/instances/fake/mcp/rotate');
    expect(failed.json.state).toBe('stale');
    expect(failed.json.error).toBeTruthy();
    expect(failed.json.token).not.toBe(rotated.json.token);
    delete breaks['dash PUT /api/env'];
    expect((await t.request('POST', '/x/instances/fake/mcp/connect', {})).json.state).toBe('connected');
    expect(t.fake.config.envValues.get(KEY)).toBe(failed.json.token);
  });

  it('a rotation does not reach Hermes when the entry is not managed', async () => {
    const t = await testApp();
    const n = writes(t).length;
    const res = await t.request('POST', '/x/instances/fake/mcp/rotate');
    expect(res.json.state).toBe('missing');
    expect(writes(t).length).toBe(n);
  });

  it('reports a failed test with a masked error', async () => {
    const t = await testApp({ env: { INTENDIA_MCP_URL: 'http://echec.example.test:3001' } });
    const res = await t.request('POST', '/x/instances/fake/mcp/connect', {});
    expect(res.json.state).toBe('connected');
    expect(res.json.test.ok).toBe(false);
    expect(res.json.test.error).toBeTruthy();
    expect(JSON.stringify(res.json)).not.toMatch(/sk-test/);
    expect(entry(t).url).toBe('http://echec.example.test:3001/mcp/fake');
  });

  it('runs a connect and a rotation one after the other', async () => {
    const t = await testApp();
    await t.request('POST', '/x/instances/fake/mcp/connect', {});
    const [, rotated] = await Promise.all([
      t.request('POST', '/x/instances/fake/mcp/connect', {}),
      t.request('POST', '/x/instances/fake/mcp/rotate'),
    ]);
    expect(t.fake.config.envValues.get(KEY)).toBe(rotated.json.token);
    expect(await state(t)).toBe('connected');
  });
});
