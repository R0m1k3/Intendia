import { agentsModule } from './agents/index.js';
import { chatModule } from './chat/index.js';
import { configModule } from './config/index.js';
import { cronsModule } from './crons/index.js';
import { filesModule } from './files/index.js';
import { gitModule } from './git/index.js';
import { healthModule } from './health/index.js';
import { kanbanModule } from './kanban/index.js';
import { monitorModule } from './monitor/index.js';
import { sessionsModule } from './sessions/index.js';
import { skillsModule } from './skills/index.js';
import type { ModuleDef } from './types.js';

export const MODULES: readonly ModuleDef[] = [
  healthModule, chatModule, sessionsModule, cronsModule, skillsModule, configModule, agentsModule, kanbanModule, filesModule, gitModule, monitorModule,
];
