import { ActivityService } from './agents/activity.js';
import { AgentService } from './agents/service.js';
import type { CompatService } from './compat/service.js';
import type { AppConfig } from './config.js';
import { CronService } from './crons/service.js';
import type { Db } from './db/index.js';
import { FileRoots } from './files/hermes-fs.js';
import { InstanceFileService } from './files/instance-files.js';
import { FileService, type FileServiceOpts } from './files/service.js';
import { GitService } from './git/service.js';
import { MemoryService } from './memory/service.js';
import { PluginService } from './plugins/service.js';
import { McpCatalogService } from './hermes-config/mcp-catalog.js';
import { MonitorService } from './monitor/service.js';
import { ProvidersService } from './hermes-config/providers.js';
import { ConfigService } from './hermes-config/service.js';
import { McpLink } from './mcp/connect.js';
import type { InstanceStore } from './instances/store.js';
import { MissionService } from './kanban/missions.js';
import { KanbanService } from './kanban/service.js';
import { LinkService } from './links/service.js';
import { RecentService } from './sessions/recent.js';
import { SessionPurger } from './sessions/purge.js';
import { AutoApprover } from './sessions/auto-approve.js';
import { SkillService } from './skills/service.js';
import { WorkspaceService } from './workspaces/service.js';
import { GoalStore } from './chat/goal.js';
import { DelegationWatcher, WakeStore } from './chat/wake.js';
import { GoalRunner } from './chat/goal-runner.js';
import type { StartRunDeps } from './chat/start-run.js';
import { PromptService } from './prompts/service.js';

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
  missions: MissionService;
  activity: ActivityService;
  recent: RecentService;
  config: ConfigService;
  providers: ProvidersService;
  mcpLink: McpLink;
  purger: SessionPurger;
  autoApprover: AutoApprover;
  git: GitService;
  monitor: MonitorService;
  memory: MemoryService;
  plugins: PluginService;
  mcpCatalog: McpCatalogService;
  goals: GoalStore;
  /** what starting a run needs (send route, goal routes, goal loop) */
  runDeps: StartRunDeps;
  goalRunner: GoalRunner;
  /** wakes of the agent after its background sub-agents (chat/wake.ts) */
  wakes: WakeStore;
  watcher: DelegationWatcher;
}

/** Built once and shared by the web app (port 3000) and the MCP app (port 3001). */
export function createServices(deps: {
  config: AppConfig; db: Db; store: InstanceStore; compat: CompatService; uploadTimeoutMs?: number;
  /** Tests only. */
  fileOpts?: FileServiceOpts;
}): Services {
  const roots = new FileRoots(deps.compat, { uploadTimeoutMs: deps.uploadTimeoutMs });
  const workspaces = new WorkspaceService(deps.db, deps.store, roots);
  const links = new LinkService(deps.db, deps.store, deps.config, roots);
  const files = new FileService(workspaces, links, roots, deps.config.uploadMaxBytes, deps.fileOpts);
  const instanceFiles = new InstanceFileService(deps.store, roots, workspaces);
  const crons = new CronService(deps.compat, workspaces, deps.store, roots);
  const skills = new SkillService(deps.compat, deps.store, deps.config.secret);
  const kanban = new KanbanService(deps.compat, deps.store, workspaces, deps.config.secret);
  const agents = new AgentService(deps.compat, deps.store, deps.config.secret, kanban, workspaces, deps.db);
  const recent = new RecentService(deps.compat, deps.store, workspaces);
  const config = new ConfigService(deps.compat, deps.store, deps.db, deps.config.secret);
  const providers = new ProvidersService(deps.compat, deps.store, deps.config.secret, config);
  const mcpLink = new McpLink(config, deps.db, deps.config);
  const goals = new GoalStore(deps.db);
  const runDeps: StartRunDeps = { compat: deps.compat, workspaces, skills, config, prompts: new PromptService(deps.db), goals };
  const wakes = new WakeStore(deps.db);
  const watcher = new DelegationWatcher({ ...runDeps, wakes });
  const activity = new ActivityService(deps.compat, deps.store, workspaces, kanban, (inst?: string) => watcher.working(inst));
  return { goals, runDeps, goalRunner: new GoalRunner(runDeps), wakes, watcher, roots, workspaces, links, files, instanceFiles, crons, skills, agents, kanban, missions: new MissionService(deps.db, kanban), activity, recent, config, providers, mcpLink, purger: new SessionPurger(workspaces, deps.compat), autoApprover: new AutoApprover(workspaces, activity, deps.compat), git: new GitService(workspaces, roots, deps.compat), monitor: new MonitorService(deps.compat, deps.store, deps.config.secret, config), memory: new MemoryService(deps.compat, deps.store, deps.config.secret), plugins: new PluginService(deps.compat, deps.store, deps.config.secret), mcpCatalog: new McpCatalogService(config, deps.compat, deps.config.publicUrl) };
}
