// What the agent is doing while a run is going on (label of the thinking indicator). No React: thinking.test.ts.
import type { Entry } from './events';

export interface Thinking {
  label: string;
  /** the agent's turn has already started: no new header above the indicator */
  inTurn: boolean;
}

export function thinkingState(entries: Entry[]): Thinking {
  let start = entries.length;
  while (start > 0 && entries[start - 1]!.kind !== 'user') start--;
  const own = entries.slice(start);
  const last = own.at(-1);
  const tool = [...own].reverse().find((e) => e.kind === 'tool' && e.state === 'running');
  let label = 'Réfléchit';
  if (tool && tool.kind === 'tool') label = `Utilise ${tool.tool}`;
  else if (own.some((e) => e.kind === 'subagents' && e.nodes.some((n) => n.status === 'running'))) label = 'Délègue à des sous-agents';
  else if (last?.kind === 'assistant' && last.streaming) label = 'Écrit';
  return { label: `${label}…`, inTurn: own.length > 0 };
}
