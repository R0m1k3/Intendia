// Runs the fake Hermes on two ports. FAKE_FIXTURES defaults to the newest fixtures/hermes-* directory.
import { serve } from '@hono/node-server';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { connectKanbanEvents, createFakeHermes, kanbanWsTokenOk, FAKE_API_KEY, FAKE_DASH_TOKEN } from './index.ts';

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
  // gateway restart (3 steps)
  configStepMs: Number(process.env.FAKE_CONFIG_STEP_MS ?? 500),
  // kanban workers last 5 s so they can be seen (and stopped) on the Activity page
  kanbanStepMs: Number(process.env.FAKE_KANBAN_STEP_MS ?? 5000),
  // FAKE_KANBAN_WS=off: the events WebSocket refuses every connection (Intendia falls back to polling)
  kanbanWs: process.env.FAKE_KANBAN_WS !== 'off',
});
const apiPort = Number(process.env.FAKE_API_PORT ?? 18642);
const dashPort = Number(process.env.FAKE_DASH_PORT ?? 19119);
serve({ fetch: fake.api.fetch, port: apiPort, hostname: '127.0.0.1' });
const dash = serve({ fetch: fake.dash.fetch, port: dashPort, hostname: '127.0.0.1' }) as Server;
// kanban live events on the dashboard port, like Hermes
const wss = new WebSocketServer({ noServer: true });
dash.on('upgrade', (req, socket, head) => {
  if (!kanbanWsTokenOk(req.url ?? '/')) return; // like Hermes: the handshake gets no answer
  wss.handleUpgrade(req, socket, head, (ws) => {
    const stop = connectKanbanEvents(fake, req.url ?? '/', { send: (t) => ws.send(t), close: (code) => ws.close(code) });
    ws.on('close', stop);
  });
});
console.log(`fake-hermes replaying ${fixturesDir}`);
console.log(`  API server http://127.0.0.1:${apiPort}  key ${FAKE_API_KEY}`);
console.log(`  dashboard  http://127.0.0.1:${dashPort} token ${FAKE_DASH_TOKEN}`);
