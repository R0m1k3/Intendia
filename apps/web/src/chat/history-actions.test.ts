import { describe, expect, it } from 'vitest';
import type { Entry } from './events';
import { cutFor, lastUser, rowId } from './history-actions';

const u = (id: number | string, text: string, steer = false): Entry => ({ kind: 'user', key: typeof id === 'number' ? `h${id}` : id, text, ts: 1, ...(steer ? { steer: true } : {}) });
const a = (id: number, text: string): Entry => ({ kind: 'assistant', key: `h${id}`, text, ts: 1 });

const thread: Entry[] = [u(1, 'Un'), a(2, 'Réponse 1'), u(3, 'Deux'), a(4, 'Réponse 2'), u(5, 'plutôt court', true), a(6, 'Réponse 2 bis')];

describe('history actions', () => {
  it('reads the row id of history entries only', () => {
    expect(rowId('h42')).toBe(42);
    expect(rowId('a-3')).toBeNull();
    expect(rowId('lost-input')).toBeNull();
  });

  it('edit: before the message itself, never a reorientation', () => {
    expect(cutFor(thread, 'edit', 'h3')).toBe(3);
    expect(cutFor(thread, 'edit', 'h5')).toBeUndefined();
    expect(cutFor(thread, 'edit', 'h2')).toBeUndefined();
  });

  it('retry and undo: before the last user message, reorientations skipped', () => {
    expect(lastUser(thread)?.text).toBe('Deux');
    expect(cutFor(thread, 'retry')).toBe(3);
    expect(cutFor(thread, 'undo')).toBe(3);
    // the last message was not stored (failed run): not possible
    expect(cutFor([...thread, u('lost-input', 'Trois')], 'retry')).toBeUndefined();
  });

  it('branch: before the next user message, everything after the last turn', () => {
    expect(cutFor(thread, 'branch', 'h2')).toBe(3);
    // the turn after "Deux": the reorientation is part of it
    expect(cutFor(thread, 'branch', 'h4')).toBeNull();
    expect(cutFor([...thread, u('u-run', 'en direct')], 'branch', 'h4')).toBeUndefined();
    expect(cutFor(thread, 'branch', 'nope')).toBeUndefined();
  });

  it('clear: nothing kept', () => {
    expect(cutFor(thread, 'clear')).toBe(0);
  });
});
