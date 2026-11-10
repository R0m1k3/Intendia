import { describe, expect, it } from 'vitest';
import type { Entry } from './events';
import { thinkingState } from './thinking';

const user: Entry = { kind: 'user', key: 'u', text: 'Bonjour', ts: null };
const tool = (state: 'running' | 'ok', name = 'terminal'): Entry => ({ kind: 'tool', key: `t${state}`, callId: null, tool: name, preview: '', result: null, duration: null, state, ts: null });

describe('thinkingState', () => {
  it('right after the message: thinking, new turn', () => {
    expect(thinkingState([user])).toEqual({ label: 'Réfléchit…', inTurn: false });
    expect(thinkingState([])).toEqual({ label: 'Réfléchit…', inTurn: false });
  });
  it('a tool running wins', () => {
    expect(thinkingState([user, tool('running', 'web_search')])).toEqual({ label: 'Utilise web_search…', inTurn: true });
  });
  it('tools of an earlier turn are ignored', () => {
    expect(thinkingState([tool('running'), user]).label).toBe('Réfléchit…');
  });
  it('writing while text streams; thinking again after a finished tool', () => {
    expect(thinkingState([user, { kind: 'assistant', key: 'a', text: 'Je', ts: null, streaming: true }]).label).toBe('Écrit…');
    expect(thinkingState([user, tool('ok')]).label).toBe('Réfléchit…');
  });
});
