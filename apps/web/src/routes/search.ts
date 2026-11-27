// Values the router needs to check the search of an address (tabs, periods, log files). They live here, apart from
// the pages, so the pages themselves can be loaded on demand: importing a constant from a page module would pull
// the whole page into the first download.
export const CONFIG_TABS = ['modeles', 'fournisseurs', 'reglages', 'garde-fous', 'yaml', 'variables', 'mcp', 'plugins', 'plateformes', 'historique'] as const;
export type ConfigTab = (typeof CONFIG_TABS)[number];

export const MEMORY_TABS = ['memoire', 'appris'] as const;
export type MemoryTab = (typeof MEMORY_TABS)[number];

export const ACCESS_KINDS = ['login', 'payment', 'address'] as const;

export const MONITOR_TABS = ['usage', 'logs', 'server'] as const;
export type MonitorTab = (typeof MONITOR_TABS)[number];

export const LOG_FILES = ['agent', 'errors', 'gateway', 'gui', 'desktop', 'update', 'handoff', 'mcp'] as const;

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
