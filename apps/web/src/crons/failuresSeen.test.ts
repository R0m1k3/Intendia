import { expect, it } from 'vitest';
import { markFailuresSeen, readFailuresSeen, unseenFailures } from './failuresSeen';

const ok = { id: 'a', lastRunAt: '2026-11-28T07:00:00Z', lastStatus: 'ok' };
const bad = { id: 'b', lastRunAt: '2026-11-28T07:00:00Z', lastStatus: 'error' };
const late = { id: 'c', lastRunAt: '2026-11-28T08:00:00Z', lastStatus: 'delivery_failed' };

it('counts only failures not seen yet, per instance', () => {
  expect(unseenFailures({}, 'x', [ok, bad, late])).toBe(2);
  const seen = markFailuresSeen({}, 'x', [ok, bad, late])!;
  expect(unseenFailures(seen, 'x', [ok, bad, late])).toBe(0);
  expect(unseenFailures(seen, 'y', [bad])).toBe(1);
});

it('shows the badge again on a new failed run of the same cron', () => {
  const seen = markFailuresSeen({}, 'x', [bad])!;
  expect(unseenFailures(seen, 'x', [{ ...bad, lastRunAt: '2026-11-28T09:00:00Z' }])).toBe(1);
});

it('keeps only failing crons and changes nothing when all is already seen', () => {
  const seen = markFailuresSeen({}, 'x', [ok, bad])!;
  expect(seen.x).toEqual({ b: bad.lastRunAt });
  expect(markFailuresSeen(seen, 'x', [ok, bad])).toBeNull();
  // the cron works again: its entry goes
  expect(markFailuresSeen(seen, 'x', [{ ...bad, lastStatus: 'ok' }])).toEqual({ x: {} });
});

it('reads a broken value as nothing seen', () => {
  expect(readFailuresSeen('{oops')).toEqual({});
  expect(readFailuresSeen('[1]')).toEqual({});
  expect(readFailuresSeen(null)).toEqual({});
});
