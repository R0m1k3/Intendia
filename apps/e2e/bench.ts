/**
 * globalSetup: starts fake-hermes and Intendia (repo build) on their own ports with data in a temporary folder,
 * chooses the password once and saves the session cookie as storageState (sign-ins are limited to 5 per minute).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BASE_URL, FAKE_API_PORT, FAKE_DASH_PORT, MCP_PORT, PASSWORD, PORT, STATE, TMP_PATH } from './ports.js';
import teardown from './teardown.js';

const here = import.meta.dirname;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function bench(): Promise<void> {
  try {
    await start();
  } catch (err) {
    await teardown(); // what was started is stopped, the setup error stays the reported one
    throw err;
  }
}

async function start(): Promise<void> {
  const root = resolve(here, '../..');
  if (!existsSync(join(root, 'apps/server/dist/index.js')) || !existsSync(join(root, 'apps/web/dist/index.html'))) {
    throw new Error('Run pnpm build first (apps/server/dist and apps/web/dist are needed)');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'intendia-e2e-'));
  const files = join(tmp, 'workspace');
  mkdirSync(files);
  process.env.E2E_TMP = tmp;
  process.env.E2E_FILES = files;
  writeFileSync(TMP_PATH, tmp);
  const logPath = join(tmp, 'bench.log');
  const log = openSync(logPath, 'a');
  const pids: number[] = [];
  const savePids = () => writeFileSync(join(tmp, 'pids.json'), JSON.stringify(pids));

  let exited: string | null = null;
  const watch = (name: string, child: ChildProcess) => {
    if (child.pid) pids.push(child.pid);
    savePids();
    child.on('exit', (code, signal) => { exited = `${name} exited (${code ?? signal})`; });
  };
  const failed = (what: string) => {
    const tail = readFileSync(logPath, 'utf8').split('\n').slice(-30).join('\n');
    return new Error(`${what}\n--- last lines of ${logPath}\n${tail}`);
  };
  const until = async (what: string, tries: number, ms: number, ok: () => Promise<boolean>) => {
    for (let i = 0; i < tries; i++) {
      if (exited) throw failed(exited);
      if (await ok().catch(() => false)) return;
      await sleep(ms);
    }
    throw failed(`${what}: not ready`);
  };

  const fake = spawn('pnpm', ['dev'], {
    cwd: join(root, 'apps/fake-hermes'),
    env: { ...process.env, FAKE_API_PORT: String(FAKE_API_PORT), FAKE_DASH_PORT: String(FAKE_DASH_PORT), FAKE_FILES_ROOT: files, FAKE_KANBAN_STEP_MS: '500' },
    stdio: ['ignore', log, log],
    detached: true,
  });
  watch('fake-hermes', fake);
  await until('fake-hermes', 40, 250, async () => (await fetch(`http://127.0.0.1:${FAKE_API_PORT}/health`, { signal: AbortSignal.timeout(1_000) })).ok);

  const intendia = spawn('node', ['dist/index.js'], {
    cwd: join(root, 'apps/server'),
    env: {
      ...process.env,
      INTENDIA_INSTANCES: JSON.stringify([{
        id: 'fake', label: 'Hermes simulé',
        api: `http://127.0.0.1:${FAKE_API_PORT}`, apiKey: 'fake-api-key-000000000000',
        dashboard: `http://127.0.0.1:${FAKE_DASH_PORT}`, dashboardToken: 'fake-dashboard-token',
      }]),
      INTENDIA_SECRET: randomBytes(32).toString('hex'),
      INTENDIA_DATA_DIR: join(tmp, 'data'),
      INTENDIA_PORT: String(PORT),
      INTENDIA_MCP_PORT: String(MCP_PORT),
      INTENDIA_WEB_DIR: join(root, 'apps/web/dist'),
    },
    stdio: ['ignore', 'pipe', log],
    detached: true,
  });
  watch('Intendia', intendia);
  let out = '';
  intendia.stdout!.on('data', (d: Buffer) => { out += d.toString(); writeSync(log, d); });

  let code = '';
  await until('installation code', 60, 500, async () => {
    code = /Installation code: (\S+)/.exec(out)?.[1] ?? '';
    return code !== '';
  });
  // the code is printed before the port is bound: wait for Intendia's own health answer (EADDRINUSE exits meanwhile)
  await until('Intendia', 40, 250, async () => (await fetch(`${BASE_URL}/x/health`, { signal: AbortSignal.timeout(1_000) })).ok);
  const res = await fetch(`${BASE_URL}/x/setup/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-intendia': '1' },
    body: JSON.stringify({ code, password: PASSWORD }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: Error) => { throw failed(`setup password: ${err.message}`); });
  const cookie = /intendia_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!res.ok || !cookie) throw failed(`setup password: HTTP ${res.status}, no session cookie`);
  writeFileSync(STATE, JSON.stringify({
    cookies: [{ name: 'intendia_session', value: cookie, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' }],
    origins: [],
  }));
  if (process.env.CI) console.log(`e2e bench: ${BASE_URL}, log ${logPath}`);
}
