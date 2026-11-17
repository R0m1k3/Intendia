/** globalTeardown: stops the bench's process groups, waits for its port to close, removes its files. */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, STATE, TMP_PATH } from './ports.js';

export default async function teardown(): Promise<void> {
  if (!existsSync(TMP_PATH)) return;
  const tmp = readFileSync(TMP_PATH, 'utf8').trim();
  const pidFile = join(tmp, 'pids.json');
  const pids: number[] = existsSync(pidFile) ? JSON.parse(readFileSync(pidFile, 'utf8')) : [];
  for (const pid of pids) {
    try {
      process.kill(-pid, 'SIGTERM'); // whole group: both are started `detached`
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') console.error(`e2e teardown: kill ${pid}: ${(err as Error).message}`);
    }
  }
  for (let i = 0; i < 20; i++) {
    if (!(await fetch(`${BASE_URL}/x/health`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (process.env.E2E_KEEP) console.log(`e2e teardown: kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
  rmSync(STATE, { force: true });
  rmSync(TMP_PATH, { force: true });
}
