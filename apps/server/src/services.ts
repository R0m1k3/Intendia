import { ActivityService } from './agents/activity.js';
import { AgentService } from './agents/service.js';
import type { CompatService } from './compat/service.js';
import type { AppConfig } from './config.js';
import { CronService } from './crons/service.js';
import type { Db } from './db/index.js';
import { FileRoots } from './files/hermes-fs.js';
import { InstanceFileService } from './files/instance-files.js';
import { FileService } from './files/service.js';
import { ProvidersService } from './hermes-config/providers.js';
import { ConfigService } from './hermes-config/service.js';
import { McpLink } from './mcp/connect.js';
import type { InstanceStore } from './instances/store.js';
import { KanbanService } from './kanban/service.js';
import { LinkService } from './links/service.js';
import { RecentService } from './sessions/recent.js';
import { SkillService } from './skills/service.js';
import { WorkspaceService } from './workspaces/service.js';

export interface Services {
  roots: FileRoots;
  workspaces: WorkspaceService;
  links: LinkService;
  files: FileService;
  instanceFiles: InstanceFileService;
  crons: CronService;
  skills: SkillService;
  agents: AgentService;
  kanban: KanbanService;
  activity: ActivityService;
  recent: RecentService;
  config: ConfigService;
  providers: ProvidersService;
  mcpLink: McpLink;
}

/** Built once and shared by the web app (port 3000) and the MCP app (port 3001). */
export function createServices(deps: {
  config: AppConfig; db: Db; store: InstanceStore; compat: CompatService; uploadTimeoutMs?: number;
}): Services {
  const roots = new FileRoots(deps.compat, { uploadTimeoutMs: deps.uploadTimeoutMs });
  const workspaces = new WorkspaceService(deps.db, deps.store, roots);
  const links = new LinkService(deps.db, deps.store, deps.config, roots);
  const files = new FileService(workspaces, links, roots, deps.config.uploadMaxBytes);
  const instanceFiles = new InstanceFileService(deps.store, roots, workspaces);
  const crons = new CronService(deps.compat, workspaces, deps.store, roots);
  const skills = new SkillService(deps.compat, deps.store);
  const kanban = new KanbanService(deps.compat, deps.store, workspaces, deps.config.secret);
  const agents = new AgentService(deps.compat, deps.store, deps.config.secret, kanban);
  const activity = new ActivityService(deps.compat, deps.store, workspaces, kanban);
  const recent = new RecentService(deps.compat, deps.store, workspaces);
  const config = new ConfigService(deps.compat, deps.store, deps.db, deps.config.secret);
  const providers = new ProvidersService(deps.compat, deps.store, deps.config.secret, config);
  const mcpLink = new McpLink(config, deps.db, deps.config);
  return { roots, workspaces, links, files, instanceFiles, crons, skills, agents, kanban, activity, recent, config, providers, mcpLink };
}
