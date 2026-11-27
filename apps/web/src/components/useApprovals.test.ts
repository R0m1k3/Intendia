// @vitest-environment happy-dom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const approvals = vi.fn(async () => ({ approvals: [] }));
vi.mock('../api', () => ({ api: { approvals: () => approvals() } }));

const { APPROVALS_KEY, APPROVALS_VISIBLE_MS, watchApprovals } = await import('./useApprovals');

describe('watchApprovals', () => {
  let qc: QueryClient;
  beforeEach(() => { vi.useFakeTimers(); approvals.mockClear(); qc = new QueryClient(); });
  afterEach(() => { qc.clear(); vi.useRealTimers(); });

  it('polls once per period, however many readers there are', async () => {
    const stops = [watchApprovals(qc), watchApprovals(qc), watchApprovals(qc), watchApprovals(qc)];
    await vi.advanceTimersByTimeAsync(0);
    expect(approvals).toHaveBeenCalledTimes(1); // the first fetch, shared
    await vi.advanceTimersByTimeAsync(APPROVALS_VISIBLE_MS * 4);
    expect(approvals).toHaveBeenCalledTimes(5);
    for (const stop of stops) stop();
  });

  it('keeps polling until the last reader leaves, then stops', async () => {
    const first = watchApprovals(qc);
    const second = watchApprovals(qc);
    await vi.advanceTimersByTimeAsync(0);
    first();
    first(); // released twice (StrictMode cleanup): counted once
    await vi.advanceTimersByTimeAsync(APPROVALS_VISIBLE_MS);
    expect(approvals).toHaveBeenCalledTimes(2);
    second();
    await vi.advanceTimersByTimeAsync(APPROVALS_VISIBLE_MS * 3);
    expect(approvals).toHaveBeenCalledTimes(2);
  });

  it('starts again for a reader that comes back, and fills the shared cache', async () => {
    watchApprovals(qc)();
    await vi.advanceTimersByTimeAsync(0);
    const stop = watchApprovals(qc);
    await vi.advanceTimersByTimeAsync(APPROVALS_VISIBLE_MS);
    expect(approvals.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(qc.getQueryData(APPROVALS_KEY)).toEqual({ approvals: [] });
    stop();
  });
});
