export interface Skill {
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean | null;
  provenance: string | null;
  usage: number;
  locked: boolean;
}
export type MemorySource = 'memory' | 'profile';
export interface MemoryEntry {
  id: string;
  /** memory = MEMORY.md (notes of the agent), profile = USER.md (what it knows of the user) */
  source: MemorySource;
  title: string;
  excerpt: string;
  timestamp: number | null;
  skills: string[];
}
export interface LearnedSkill {
  name: string; category: string | null; useCount: number; state: string | null; pinned: boolean; createdBy: string | null;
  related: string[]; memories: string[];
}
export interface MemoryUsage { bytes: number; limit: number }
export interface MemoryOverview {
  active: string | null;
  usage: { memory: MemoryUsage | null; user: MemoryUsage | null };
  entries: MemoryEntry[];
  skills: LearnedSkill[];
  stats: { skills: number; links: number; isolatedPct: number | null };
}
export interface Toolset {
  name: string;
  label: string;
  description: string | null;
  enabled: boolean | null;
  configured: boolean | null;
  tools: string[];
}
export interface HubResult {
  name: string;
  identifier: string;
  description: string | null;
  source: string | null;
  trust: string | null;
  repo: string | null;
  tags: string[];
  installed: boolean;
}
export interface Scan {
  verdict: string;
  policy: string;
  reason: string | null;
  summary: string | null;
  trust: string | null;
  findings: Record<string, unknown>[];
  counts: Record<string, number>;
}
export interface ActionStatus {
  running: boolean;
  exitCode: number | null;
  lines: string[];
  truncated: boolean;
}
