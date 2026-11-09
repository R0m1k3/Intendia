import type { CompatService } from './compat/service.js';
import type { AppConfig } from './config.js';
import { CronService } from './crons/service.js';
import type { Db } from './db/index.js';
import { FileService } from './files/service.js';
import type { InstanceStore } from './instances/store.js';
import { LinkService } from './links/service.js';
import { WorkspaceService } from './workspaces/service.js';

export interface Services {
  workspaces: WorkspaceService;
  links: LinkService;
  files: FileService;
  crons: CronService;
}

/** Built once and shared by the web app (port 3000) and the MCP app (port 3001). */
export function createServices(deps: { config: AppConfig; db: Db; store: InstanceStore; compat: CompatService }): Services {
  const workspaces = new WorkspaceService(deps.db, deps.store);
  const links = new LinkService(deps.db, deps.store, deps.config);
  const files = new FileService(deps.db, workspaces, links, deps.config.uploadMaxBytes);
  const crons = new CronService(deps.compat, workspaces, deps.store);
  return { workspaces, links, files, crons };
}
