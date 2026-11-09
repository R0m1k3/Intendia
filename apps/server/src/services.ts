import type { AppConfig } from './config.js';
import type { Db } from './db/index.js';
import { FileService } from './files/service.js';
import type { InstanceStore } from './instances/store.js';
import { LinkService } from './links/service.js';
import { WorkspaceService } from './workspaces/service.js';

export interface Services {
  workspaces: WorkspaceService;
  links: LinkService;
  files: FileService;
}

/** Built once and shared by the web app (port 3000) and the MCP app (port 3001). */
export function createServices(deps: { config: AppConfig; db: Db; store: InstanceStore }): Services {
  const workspaces = new WorkspaceService(deps.db, deps.store);
  const links = new LinkService(deps.db, deps.store, deps.config);
  const files = new FileService(deps.db, workspaces, links, deps.config.uploadMaxBytes);
  return { workspaces, links, files };
}
