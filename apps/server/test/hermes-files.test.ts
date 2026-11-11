import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeHermes, fakeFetch, FAKE_DASH_TOKEN } from 'fake-hermes';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { FIXTURES, tempDir, testApp } from './helpers.js';

const runsPosted = (t: Awaited<ReturnType<typeof testApp>>) => t.fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/runs');
const instructions = (t: Awaited<ReturnType<typeof testApp>>) => (runsPosted(t).at(-1)!.body as Record<string, string>).instructions!;

describe('chat while Hermes files are unreachable', () => {
  it('sends the last AGENTS.md read', async () => {
    const breaks: Record<string, { status: number }> = {};
    const t = await testApp({ breaks });
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    await t.request('PUT', '/x/workspaces/dev/agents-md', { text: 'Réponds en français.' });
    const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    breaks['dash GET /api/files/download'] = { status: 503 };
    expect((await t.request('POST', `/x/sessions/fake/${s.id}/runs`, { input: 'Bonjour' })).status).toBe(200);
    expect(instructions(t)).toContain('Réponds en français.');
  });

  it('after a restart (nothing in memory): a line says the instructions are unavailable', async () => {
    const breaks: Record<string, { status: number }> = {};
    const t = await testApp({ breaks });
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    breaks['dash GET /api/files'] = { status: 503 };
    breaks['dash POST /api/files/mkdir'] = { status: 503 };
    breaks['dash GET /api/files/download'] = { status: 503 };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session; // session folder: logged, not fatal
    expect(warn.mock.calls.some((c) => String(c[0]).includes('session folder'))).toBe(true);
    warn.mockRestore();
    expect((await t.request('POST', `/x/sessions/fake/${s.id}/runs`, { input: 'Bonjour' })).status).toBe(200);
    expect(instructions(t)).toContain(`Dossier de travail : ${t.root}/dev/`);
    expect(instructions(t)).toContain('Consignes du projet indisponibles (Hermes a répondu HTTP 503)');
  });
});

describe('configuration written before 0.0.4', () => {
  it('mount and agentMount are accepted, ignored, with one warning per instance', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inst = { id: 'ancien', label: 'Ancien', api: 'http://h:8642', apiKey: 'k'.repeat(20), mount: '/workspace', agentMount: '/opt/data/workspace' };
    const env = { INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_INSTANCES: JSON.stringify([inst]) };
    const parsed = loadConfig(env).envInstances![0]!;
    loadConfig(env);
    expect(parsed).not.toHaveProperty('mount');
    expect(parsed).not.toHaveProperty('agentMount');
    const lines = warn.mock.calls.filter((c) => String(c[0]).includes('mount/agentMount ignorés'));
    expect(lines).toHaveLength(1);
    expect(String(lines[0]![0])).toContain('"ancien"');
    warn.mockRestore();
  });
});

describe('fake-hermes managed files (like Hermes 0.23)', () => {
  const setup = () => {
    const root = tempDir();
    const fake = createFakeHermes({ fixturesDir: FIXTURES, filesRoot: root });
    const f = fakeFetch(fake);
    const auth = { Authorization: `Bearer ${FAKE_DASH_TOKEN}` };
    const get = (path: string) => f(`http://fake-dash/api/files?path=${encodeURIComponent(path)}`, { method: 'GET', headers: auth });
    const json = (method: string, route: string, body: unknown) =>
      f(`http://fake-dash${route}`, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const upload = (path: string, text: string, overwrite = true) => {
      const form = new FormData();
      form.set('file', new Blob([text]), 'x');
      form.set('path', path);
      form.set('overwrite', String(overwrite));
      return f('http://fake-dash/api/files/upload-stream', { method: 'POST', headers: auth, body: form });
    };
    return { root: fake.files.root, f, get, json, upload, auth };
  };

  it('locks the root, refuses "..", resolves links, hides credential names', async () => {
    const h = setup();
    mkdirSync(join(h.root, 'w'));
    writeFileSync(join(h.root, 'w', 'a.txt'), 'a');
    writeFileSync(join(h.root, 'w', '.env'), 'S=1');
    symlinkSync(join(h.root, 'w', 'a.txt'), join(h.root, 'w', 'l'));
    symlinkSync(join(h.root, 'nowhere'), join(h.root, 'w', 'broken'));
    const list = (await (await h.get('w')).json()) as any;
    expect(list).toMatchObject({ path: join(h.root, 'w'), locked_root: h.root });
    const by = (n: string) => list.entries.find((e: any) => e.name === n);
    expect(by('.env')).toBeUndefined();
    expect(by('l').path).toBe(join(h.root, 'w', 'a.txt'));
    expect(by('broken')).toMatchObject({ broken_link: true, path: join(h.root, 'w', 'broken'), is_directory: false });
    expect((await h.get('w/../..')).status).toBe(400);
    expect((await h.get('/etc')).status).toBe(403);
    symlinkSync('/etc', join(h.root, 'w', 'out'));
    expect((await h.get('w')).status).toBe(403);
    expect((await h.f('http://fake-dash/api/files', { method: 'GET' })).status).toBe(401);
  });

  it('upload-stream: overwrite=false → 409, parents created; mkdir; DELETE with a JSON body', async () => {
    const h = setup();
    expect((await h.upload(`${h.root}/w/sub/a.txt`, 'un')).status).toBe(200);
    expect(readFileSync(join(h.root, 'w', 'sub', 'a.txt'), 'utf8')).toBe('un');
    expect((await h.upload(`${h.root}/w/sub/a.txt`, 'deux', false)).status).toBe(409);
    expect((await h.upload(`${h.root}/w/sub/a.txt`, 'trois')).status).toBe(200);
    expect(readFileSync(join(h.root, 'w', 'sub', 'a.txt'), 'utf8')).toBe('trois');
    expect((await h.json('POST', '/api/files/mkdir', { path: `${h.root}/w/d/e` })).status).toBe(200);
    expect((await h.json('DELETE', '/api/files', { path: `${h.root}/w/d`, recursive: false })).status).toBe(409);
    expect((await h.json('DELETE', '/api/files', { path: `${h.root}/w/d`, recursive: true })).status).toBe(200);
    expect((await h.json('DELETE', '/api/files', { path: h.root, recursive: true })).status).toBe(400);
    const dl = await h.f(`http://fake-dash/api/files/download?path=${encodeURIComponent(`${h.root}/w/sub/a.txt`)}`, { method: 'GET', headers: h.auth });
    expect(dl.headers.get('content-length')).toBe('5');
    expect(await dl.text()).toBe('trois');
  });
});
