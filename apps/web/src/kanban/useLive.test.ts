import { describe, expect, it } from 'vitest';
import { followKanban } from './useLive';

/** A stand-in EventSource the test drives by hand. */
class FakeSource {
  static all: FakeSource[] = [];
  listeners = new Map<string, ((ev: { data?: string }) => void)[]>();
  closed = false;
  constructor(public url: string) { FakeSource.all.push(this); }
  addEventListener(type: string, fn: (ev: { data?: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  close() { this.closed = true; }
  emit(type: string, data?: object) { for (const fn of this.listeners.get(type) ?? []) fn({ data: data ? JSON.stringify(data) : undefined }); }
}

function harness() {
  FakeSource.all = [];
  const flushes: string[][] = [];
  const polling: boolean[] = [];
  const timers = new Map<number, { f: () => void; ms: number }>();
  let n = 0;
  const stop = followKanban({
    url: '/x/events',
    flush: (t) => flushes.push([...t]),
    polling: (on) => polling.push(on),
    deps: {
      EventSource: FakeSource as unknown as typeof EventSource,
      setTimeout: (f, ms) => { timers.set(++n, { f, ms }); return n; },
      clearTimeout: (id) => { timers.delete(id as number); },
    },
  });
  const run = (ms: number) => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.f(); } };
  return { stop, flushes, polling, timers, run };
}

describe('followKanban', () => {
  it('after a renewal, rereads the board on ready (Hermes subscribed), not on the SSE open', () => {
    const h = harness();
    const first = FakeSource.all[0]!;
    first.emit('open');
    first.emit('ready', {});
    expect(h.flushes).toHaveLength(0);
    first.emit('closed', { code: 'recycle' });
    expect(first.closed).toBe(true);
    const second = FakeSource.all[1]!;
    second.emit('open');
    expect(h.flushes).toHaveLength(0);
    second.emit('ready', {});
    expect(h.flushes).toHaveLength(1);
    second.emit('ready', {});
    expect(h.flushes).toHaveLength(1);
    expect(h.polling).not.toContain(true);
    h.stop();
  });

  it('on a failure, polls until the reopened stream is ready, then rereads once', () => {
    const h = harness();
    const first = FakeSource.all[0]!;
    first.emit('ready', {});
    first.emit('closed', { reason: 'cut' });
    expect(h.polling.at(-1)).toBe(true);
    h.run(60_000);
    const second = FakeSource.all[1]!;
    second.emit('open');
    expect(h.polling.at(-1)).toBe(true);
    expect(h.flushes).toHaveLength(0);
    second.emit('ready', {});
    expect(h.polling.at(-1)).toBe(false);
    expect(h.flushes).toHaveLength(1);
    h.stop();
  });

  it('debounces changes into one flush with the touched task ids', () => {
    const h = harness();
    const src = FakeSource.all[0]!;
    src.emit('ready', {});
    src.emit('change', { taskIds: ['a'] });
    src.emit('change', { taskIds: ['b'] });
    h.run(300);
    expect(h.flushes).toEqual([['a', 'b']]);
    h.stop();
  });
});
