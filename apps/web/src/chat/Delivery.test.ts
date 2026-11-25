import { describe, expect, it } from 'vitest';
import { deliveryNote } from './Delivery';
import { historyEntries } from './events';
import { subagentsLine, untilText } from './SubagentsBar';
import { activityText } from './Subagents';

describe('deliveryNote (server summary)', () => {
  const s = (p: Partial<{ openTasks: number; capped: boolean; wakePending: boolean }>) => ({ openTasks: 0, since: null, capped: false, wakePending: false, ...p });
  it('capped, waking, others still working, nothing; a session Intendia does not wake keeps the old note', () => {
    expect(deliveryNote(s({ capped: true }))).toMatch(/arrêtée après 5 reprises/);
    expect(deliveryNote(s({ wakePending: true }))).toBe('L’agent reprend son travail.');
    expect(deliveryNote(s({ openTasks: 1 }))).toMatch(/autres sous-agents/);
    expect(deliveryNote(null)).toBeNull();
    expect(deliveryNote(undefined)).toMatch(/prochain message/);
  });
  it('bar line: singular and plural', () => {
    expect(subagentsLine(1)).toBe('1 sous-agent travaille · l’agent reprendra à sa fin');
    expect(subagentsLine(2)).toBe('2 sous-agents travaillent · l’agent reprendra à leur fin');
    const now = new Date(2026, 10, 25, 14, 0).getTime();
    expect(untilText(new Date(2026, 10, 25, 15, 26).getTime() / 1000, now)).toBe('15:26');
    expect(untilText(new Date(2026, 10, 26, 0, 30).getTime() / 1000, now)).toBe('demain 00:30');
    expect(activityText({ lastActive: 100, toolCalls: 7, apiCalls: 12, ended: false }, 220)).toBe('actif il y a 2 min · 12 étapes · 7 outils');
  });
  it('the wake message is an entry marked wake (no bubble of the user)', () => {
    const e = historyEntries([{ id: 1, role: 'user', content: '[Intendia] Reprise automatique : tes sous-agents ont terminé.', toolName: null, toolCalls: [], timestamp: 1 }]);
    expect(e[0]).toMatchObject({ kind: 'user', wake: true });
  });
});
