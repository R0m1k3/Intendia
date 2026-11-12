import { serve } from '@hono/node-server';
import { accessSync, constants } from 'node:fs';
import { createApp } from './app.js';
import { Auth } from './auth/auth.js';
import { WebhookNotifier } from './compat/notify.js';
import { CompatService } from './compat/service.js';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { InstanceStore } from './instances/store.js';
import { createMcpApp } from './mcp/server.js';
import { createServices } from './services.js';
import { appVersion, readPkgVersion } from './version.js';

const VERSION = appVersion(process.env.INTENDIA_VERSION, readPkgVersion());

function checkWritable(dir: string, what: string): void {
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
    const gid = typeof process.getgid === 'function' ? process.getgid() : '?';
    throw new Error(`${what} ${dir} is not writable by uid ${uid} / gid ${gid}. Fix with: chown -R ${uid}:${gid} <volume> (or set PUID/PGID).`);
  }
}

function main() {
  const config = loadConfig();
  const db = openDb(config.dataDir);
  checkWritable(config.dataDir, 'Data directory');

  const store = new InstanceStore(db, config);
  store.list(); // warns once about legacy mount/agentMount keys

  const auth = new Auth(db, config);
  const compat = new CompatService(db, store, new WebhookNotifier(config.webhookUrl, config.publicUrl));
  const services = createServices({ config, db, store, compat });
  // deletions whose undo window passed while the server was stopped go first
  services.purger.start();
  services.autoApprover.start();
  const app = createApp({ config, db, auth, store, compat, services, version: VERSION });
  const mcpApp = createMcpApp({ db, store, links: services.links, roots: services.roots, config, version: VERSION });

  if (auth.setupCode) {
    console.log('');
    console.log(`  Intendia: first start. Installation code: ${auth.setupCode}`);
    console.log('  Open the web UI and enter it to choose a password.');
    console.log('');
  }

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`[intendia] ${VERSION} listening on :${info.port}${config.publicUrl ? ` (${config.publicUrl})` : ''}`);
  });
  // MCP for the agents: reachable on the Docker network only, never published
  const mcpServer = serve({ fetch: mcpApp.fetch, port: config.mcpPort, hostname: '0.0.0.0' }, (info) => {
    console.log(`[intendia] MCP (share_file) on :${info.port}`);
  });
  compat.start(config.versionCheckMinutes);

  const shutdown = () => {
    compat.stop();
    services.purger.stop();
    services.autoApprover.stop();
    const closed = (s: { close: (cb: () => void) => unknown }) => new Promise<void>((r) => { s.close(() => r()); });
    void Promise.all([closed(server), closed(mcpServer)]).then(() => {
      db.$client.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  main();
} catch (err) {
  console.error(`[intendia] ${(err as Error).message}`);
  process.exit(1);
}
