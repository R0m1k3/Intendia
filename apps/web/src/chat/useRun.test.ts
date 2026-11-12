import { describe, expect, it, vi } from 'vitest';
import type { RunStatus } from '../api';
import type { RunState } from './events';
import { followRun, POLL_MS } from './useRun';

/** A stand-in EventSource the test drives by hand. */
class FakeSource {
  static all: FakeSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeSource.all.push(this); }
  close() { this.closed = true; }
  send(ev: object) { this.onmessage?.({ data: JSON.stringify(ev) }); }
}

function harness(opts: { places: number; statuses?: RunStatus[] }) {
  FakeSource.all = [];
  let free = opts.places;
  const releases = { count: 0 };
  const acquire = () => {
    if (free <= 0) return null;
    free--;
    let held = true;
    return () => { if (held) { held = false; free++; releases.count++; } };
  };
  const timers: { f: () => void; ms: number }[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const runStatus = vi.fn(async () => statuses.shift() ?? { status: 'running', createdAt: 1, output: null, error: null });
  const states: [RunState, boolean][] = [];
  const ends: RunState[] = [];
  const f = followRun({
    inst: 'i', sessionId: 's', run: { id: 'r', seed: [{ kind: 'user', key: 'u', text: 'bonjour', ts: 1 }] },
    onState: (s, d) => states.push([s, d]),
    onEnd: (s) => ends.push(s),
    deps: {
      EventSource: FakeSource as unknown as typeof EventSource,
      runStatus: runStatus as never,
      acquire,
      setTimeout: (fn, ms) => { timers.push({ f: fn, ms }); return timers.length; },
      clearTimeout: () => { timers.length = 0; },
    },
  });
  const tick = async () => { const t = timers.shift(); t?.f(); await Promise.resolve(); await Promise.resolve(); };
  return { f, states, ends, timers, tick, runStatus, releases, free: () => free, setFree: (n: number) => { free = n; } };
}

describe('followRun', () => {
  it('streams live with a free place, ends once and gives the place back', () => {
    const h = harness({ places: 1 });
    expect(FakeSource.all).toHaveLength(1);
    const src = FakeSource.all[0]!;
    src.send({ event: 'message.delta', delta: 'Salut' });
    src.send({ event: 'run.completed', output: 'Salut' });
    src.send({ event: 'run.completed', output: 'Salut' });
    expect(h.ends).toHaveLength(1);
    expect(h.ends[0]!.status).toBe('completed');
    expect(src.closed).toBe(true);
    expect(h.free()).toBe(1);
    expect(h.states.every(([, d]) => !d)).toBe(true);
  });

  it('without a place, polls the status and ends from it (status, error, reorientation)', async () => {
    const h = harness({
      places: 0,
      statuses: [
        { status: 'running', createdAt: 1, output: null, error: null },
        { status: 'failed', createdAt: 1, output: null, error: 'boom', pendingSteer: 'plus court' },
      ],
    });
    expect(FakeSource.all).toHaveLength(0);
    expect(h.states.at(-1)![1]).toBe(true);
    expect(h.timers[0]!.ms).toBe(POLL_MS);
    await h.tick();
    expect(h.ends).toHaveLength(0);
    await h.tick();
    expect(h.ends).toHaveLength(1);
    expect(h.ends[0]).toMatchObject({ status: 'failed', error: 'boom', pendingSteer: 'plus court' });
    expect(h.timers).toHaveLength(0);
  });

  it('switches to a live stream when a place frees, starting over from the seed', async () => {
    const h = harness({ places: 0 });
    h.f.local({ event: 'intendia.steer', text: 'plus vite' } as never);
    h.setFree(1);
    await h.tick();
    expect(FakeSource.all).toHaveLength(1);
    const [last, deferred] = h.states.at(-1)!;
    expect(deferred).toBe(false);
    expect(last.entries).toHaveLength(1);
    expect(last.status).toBe('queued');
  });

  it('puts the reorientations written while polling back where the replay acknowledges them', async () => {
    const h = harness({ places: 0 });
    h.f.local({ event: 'intendia.steer', seq: 1, text: 'plus vite' } as never);
    h.f.local({ event: 'intendia.steer', seq: 2, text: 'en français' } as never);
    h.setFree(1);
    await h.tick();
    const src = FakeSource.all[0]!;
    src.send({ event: 'message.delta', delta: 'Avant. ' });
    src.send({ event: 'run.steered' });
    src.send({ event: 'message.delta', delta: 'Après.' });
    src.send({ event: 'run.steered' });
    src.send({ event: 'run.steered' });
    const texts = h.states.at(-1)![0].entries.map((e) => ('text' in e ? e.text : e.kind));
    expect(texts).toEqual(['bonjour', 'Avant. ', 'plus vite', 'Après.', 'en français']);
  });

  it('stop while polling cancels the timer and holds no place', async () => {
    const h = harness({ places: 0 });
    h.f.stop();
    expect(h.timers).toHaveLength(0);
    expect(h.runStatus).not.toHaveBeenCalled();
    const live = harness({ places: 1 });
    live.f.stop();
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(live.free()).toBe(1);
  });
});
