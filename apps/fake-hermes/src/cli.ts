// Runs the fake Hermes on two ports. FAKE_FIXTURES defaults to the newest fixtures/hermes-* directory.
import { serve } from '@hono/node-server';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeHermes, FAKE_API_KEY, FAKE_DASH_TOKEN } from './index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const latest = readdirSync(root).filter((d) => d.startsWith('hermes-')).sort().at(-1);
const fixturesDir = process.env.FAKE_FIXTURES ?? join(root, latest ?? '');
const map = process.env.FAKE_PATH_MAP?.split('=');
const pathMap = map?.length === 2 ? { from: map[0]!.replace(/\/$/, ''), to: map[1]!.replace(/\/$/, '') } : undefined;
const fake = createFakeHermes({ fixturesDir, breaks: process.env.FAKE_BREAKS ? JSON.parse(process.env.FAKE_BREAKS) : undefined, pathMap,
  // cron runs last 4 steps ("long": 100): 500 ms makes the live follow-up visible by hand
  cronStepMs: Number(process.env.FAKE_CRON_STEP_MS ?? 500),
  // skills actions (install, uninstall, update): long enough to see the follow-up
  skillStepMs: Number(process.env.FAKE_SKILL_STEP_MS ?? 500),
});
const apiPort = Number(process.env.FAKE_API_PORT ?? 18642);
const dashPort = Number(process.env.FAKE_DASH_PORT ?? 19119);
serve({ fetch: fake.api.fetch, port: apiPort, hostname: '127.0.0.1' });
serve({ fetch: fake.dash.fetch, port: dashPort, hostname: '127.0.0.1' });
console.log(`fake-hermes replaying ${fixturesDir}`);
console.log(`  API server http://127.0.0.1:${apiPort}  key ${FAKE_API_KEY}`);
console.log(`  dashboard  http://127.0.0.1:${dashPort} token ${FAKE_DASH_TOKEN}`);
