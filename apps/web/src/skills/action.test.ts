import { describe, expect, it } from 'vitest';
import { ACTION_MAX_MS, actionState, failureLine, loadActions, saveActions } from './action';

const st = (running: boolean, exitCode: number | null) => ({ running, exitCode, lines: [], truncated: false });

describe('skills action follow-up', () => {
  it('derives the state from the status, a 404 and the 5-minute cap', () => {
    expect(actionState(undefined, 0, 10)).toBe('running');
    expect(actionState(st(true, null), 0, 10)).toBe('running');
    expect(actionState(st(false, 0), 0, 10)).toBe('done');
    expect(actionState(st(false, 1), 0, 10)).toBe('failed');
    expect(actionState('gone', 0, 10)).toBe('lost');
    expect(actionState(st(true, null), 0, ACTION_MAX_MS + 1)).toBe('stale');
  });

  it("picks Hermes' error line", () => {
    expect(failureLine(['Fetching: x', "Error: Could not download 'x'.", 'Check the name'])).toBe("Error: Could not download 'x'.");
    expect(failureLine(['Scan: DANGEROUS', 'Installation blocked: bad'])).toBe('Installation blocked: bad');
    expect(failureLine(['only line', ''])).toBe('only line');
    expect(failureLine([])).toBe('échec sans message');
  });

  it('stores pending actions per instance and profile, ignoring junk', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const a = { action: 'skills-update', label: 'Mise à jour', target: '*', startedAt: 1 };
    saveActions('ref', 'default', [a], store);
    expect(loadActions('ref', 'default', store)).toEqual([a]);
    expect(loadActions('ref', 'other', store)).toEqual([]);
    mem.set('intendia:skill-actions:ref:x', '{bad');
    expect(loadActions('ref', 'x', store)).toEqual([]);
    saveActions('ref', 'default', [], store);
    expect(mem.size).toBe(1);
  });
});
