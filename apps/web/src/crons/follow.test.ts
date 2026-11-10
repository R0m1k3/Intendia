import { describe, expect, it } from 'vitest';
import type { Cron, CronRun } from '../api';
import { FOLLOW_MAX_MS, followState, snapshot, statusLabel } from './follow';

const cron = (over: Partial<Cron> = {}) => ({ lastRunAt: '2026-11-09T08:00:00+01:00', lastStatus: 'ok', ...over } as Cron);
const run = (id: string): CronRun => ({ id, startedAt: 1, endedAt: null, endReason: null, messageCount: 0, toolCallCount: 0, costUsd: null, model: null });

describe('follow a triggered run', () => {
  const snap = snapshot(cron(), [run('old')], 1_000);

  it('runs until last_run_at changes, showing the new run', () => {
    expect(followState(snap, cron(), [run('old')], 2_000)).toEqual({ state: 'running', run: null });
    expect(followState(snap, cron(), [run('new'), run('old')], 3_000)).toEqual({ state: 'running', run: run('new') });
    // an earlier last_status (e.g. blocked_config) does not end the follow-up
    expect(followState(snap, cron({ lastStatus: 'blocked_config' }), [run('old')], 3_000).state).toBe('running');
    expect(followState(snap, cron({ lastRunAt: '2026-11-09T21:00:00+01:00' }), [run('new'), run('old')], 4_000).state).toBe('done');
  });

  it('a first run ever ends when last_run_at appears', () => {
    const s = snapshot(cron({ lastRunAt: null }), [], 0);
    expect(followState(s, cron({ lastRunAt: null }), [], 10).state).toBe('running');
    expect(followState(s, cron({ lastRunAt: '2026-11-09T21:00:00+01:00' }), [], 20).state).toBe('done');
  });

  it('stops after 10 minutes', () => {
    expect(followState(snap, cron(), [], 1_000 + FOLLOW_MAX_MS + 1).state).toBe('timeout');
  });

  it('labels statuses', () => {
    expect(statusLabel('ok')).toEqual({ label: 'Réussi', ok: true });
    expect(statusLabel('blocked_config').ok).toBe(false);
    expect(statusLabel(null).ok).toBeNull();
  });
});
