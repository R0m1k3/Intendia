import { describe, expect, it, vi } from 'vitest';
import { ApiError, type RunStatus } from '../api';
import type { RunState } from './events';
import { followRun, POLL_MS, STREAM_RETRY_MS, type RunLink } from './useRun';

/** A stand-in EventSource the test drives by hand. */
class FakeSource {
  static all: FakeSource[] = [];
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  closed = false;
  constructor(public url: string) { FakeSource.all.push(this); }
  close() { this.closed = true; this.readyState = 2; }
  send(ev: object, id = '') { this.onmessage?.({ data: JSON.stringify(ev), lastEventId: id }); }
  /** the browser's error event, in the given state (0 CONNECTING, 2 CLOSED) */
  fail(state: 0 | 2) { this.readyState = state; this.onerror?.(); }
}

const RUNNING: RunStatus = { status: 'running', createdAt: 1, output: null, error: null };
type Answer = RunStatus | Error;

function harness(opts: { places: number; statuses?: Answer[] }) {
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
  const answers = [...(opts.statuses ?? [])];
  let clock = 1_000_000;
  const runStatus = vi.fn(async () => {
    const a = answers.shift() ?? RUNNING;
    if (a instanceof Error) throw a;
    return a;
  });
  const states: [RunState, RunLink][] = [];
  const ends: RunState[] = [];
  const f = followRun({
    inst: 'i', sessionId: 's', run: { id: 'r', seed: [{ kind: 'user', key: 'u', text: 'bonjour', ts: 1 }] },
    onState: (s, l) => states.push([s, l]),
    onEnd: (s) => ends.push(s),
    deps: {
      EventSource: FakeSource as unknown as typeof EventSource,
      runStatus: runStatus as never,
      acquire,
      setTimeout: (fn, ms) => { timers.push({ f: fn, ms }); return timers.length; },
      clearTimeout: () => { timers.length = 0; },
      now: () => clock,
    },
  });
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  /** runs the pending timer (moving the clock by its delay) */
  const tick = async () => { const t = timers.shift(); if (t) { clock += t.ms; t.f(); } await flush(); };
  const link = () => states.at(-1)![1];
  return {
    f, states, ends, timers, tick, runStatus, releases, link, answers,
    free: () => free, setFree: (n: number) => { free = n; }, advance: (ms: number) => { clock += ms; },
  };
}

const polling = (cause: string) => ({ mode: 'polling', cause });

describe('followRun', () => {
  it('streams live with a free place, ends once and gives the place back', () => {
    const h = harness({ places: 1 });
    expect(FakeSource.all).toHaveLength(1);
    const src = FakeSource.all[0]!;
    src.send({ event: 'message.delta', delta: 'Salut' }, '0');
    src.send({ event: 'run.completed', output: 'Salut' }, '1');
    src.send({ event: 'run.completed', output: 'Salut' }, '2');
    expect(h.ends).toHaveLength(1);
    expect(h.ends[0]!.status).toBe('completed');
    expect(src.closed).toBe(true);
    expect(h.free()).toBe(1);
    expect(h.states.every(([, l]) => l.mode === 'live')).toBe(true);
  });

  it('an error while CONNECTING: nothing (the EventSource reconnects by itself)', () => {
    const h = harness({ places: 1 });
    FakeSource.all[0]!.fail(0);
    expect(h.link()).toEqual({ mode: 'live' });
    expect(h.timers).toHaveLength(0);
    expect(FakeSource.all).toHaveLength(1);
  });

  it('CLOSED after events: polling/lost, then live again at the first good read, after the last seq, state kept', async () => {
    const h = harness({ places: 1 });
    const src = FakeSource.all[0]!;
    src.send({ event: 'run.started' }, '0');
    src.send({ event: 'message.delta', delta: 'Début ' }, '1');
    src.fail(2);
    expect(h.link()).toEqual(polling('lost'));
    expect(h.free()).toBe(1);
    expect(h.timers[0]!.ms).toBe(0);
    await h.tick();
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[1]!.url).toBe('/x/sessions/i/s/runs/r/events?lastSeq=1');
    expect(h.link()).toEqual({ mode: 'live' });
    FakeSource.all[1]!.send({ event: 'message.delta', delta: 'suite' }, '2');
    const texts = h.states.at(-1)![0].entries.map((e) => ('text' in e ? e.text : e.kind));
    expect(texts).toEqual(['bonjour', 'Début suite']);
    expect(h.ends).toHaveLength(0);
  });

  it('CLOSED without any event: the next stream comes STREAM_RETRY_MS later, not before', async () => {
    const h = harness({ places: 1 });
    FakeSource.all[0]!.fail(2);
    await h.tick(); // read at once: still running
    expect(FakeSource.all).toHaveLength(1);
    expect(h.link()).toEqual(polling('lost'));
    for (let waited = POLL_MS; waited <= STREAM_RETRY_MS; waited += POLL_MS) {
      expect(h.timers[0]!.ms).toBe(POLL_MS);
      await h.tick();
      expect(FakeSource.all).toHaveLength(waited >= STREAM_RETRY_MS ? 2 : 1);
    }
    expect(FakeSource.all).toHaveLength(2);
    // still nothing received: the URL starts from the beginning
    expect(FakeSource.all[1]!.url).toBe('/x/sessions/i/s/runs/r/events');
  });

  it('run_gone: never a stream again, polled until completed, one end', async () => {
    const h = harness({ places: 1, statuses: [RUNNING, RUNNING, { status: 'completed', createdAt: 1, output: 'fini', error: null }] });
    const src = FakeSource.all[0]!;
    src.send({ event: 'run.started' }, '0');
    src.send({ event: 'intendia.error', status: 404, code: 'run_gone', message: 'Run introuvable chez Hermes' });
    expect(src.closed).toBe(true);
    expect(h.link()).toEqual(polling('lost'));
    await h.tick();
    await h.tick();
    expect(FakeSource.all).toHaveLength(1);
    await h.tick();
    expect(FakeSource.all).toHaveLength(1);
    expect(h.ends).toHaveLength(1);
    expect(h.ends[0]!.status).toBe('completed');
    expect(h.timers).toHaveLength(0);
  });

  it('other intendia.error frames are a lost stream too, never an end', async () => {
    const h = harness({ places: 1 });
    FakeSource.all[0]!.send({ event: 'intendia.error', status: 0, code: 'hermes_unreachable', message: 'x' });
    expect(h.ends).toHaveLength(0);
    expect(h.link()).toEqual(polling('lost'));
    expect(h.states.every(([s]) => s.status !== 'error')).toBe(true);
  });

  it('failing reads: polling/offline, waits 3, 6, 12, 24, 30, 30 s; the first success goes back to the cause', async () => {
    const down = new Error('network');
    const h = harness({ places: 1, statuses: [down, down, down, down, down, down, RUNNING] });
    const src = FakeSource.all[0]!;
    src.send({ event: 'run.started' }, '0');
    src.fail(2);
    await h.tick(); // the read at once fails
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      expect(h.link()).toEqual(polling('offline'));
      waits.push(h.timers[0]!.ms);
      await h.tick();
    }
    expect(waits).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
    // back: the lost stream had events, so a stream at once
    expect(h.link()).toEqual({ mode: 'live' });
    expect(FakeSource.all).toHaveLength(2);
    expect(h.ends).toHaveLength(0);
  });

  it('without a place: polling/cap, live when a place frees, starting over from the seed', async () => {
    const h = harness({ places: 0 });
    h.f.local({ event: 'intendia.steer', text: 'plus vite' } as never);
    expect(h.link()).toEqual(polling('cap'));
    expect(h.timers[0]!.ms).toBe(POLL_MS);
    await h.tick();
    expect(FakeSource.all).toHaveLength(0);
    expect(h.link()).toEqual(polling('cap'));
    h.setFree(1);
    await h.tick();
    expect(FakeSource.all).toHaveLength(1);
    const [last, link] = h.states.at(-1)!;
    expect(link).toEqual({ mode: 'live' });
    expect(last.entries).toHaveLength(1);
    expect(last.status).toBe('queued');
  });

  it('404 run_unknown: ends as unknown', async () => {
    const h = harness({ places: 0, statuses: [new ApiError(404, 'Run inconnu pour cette session', { code: 'run_unknown' })] });
    await h.tick();
    expect(h.ends).toHaveLength(1);
    expect(h.ends[0]!.status).toBe('unknown');
  });

  it('a 404 without run_unknown is only a failed read', async () => {
    const h = harness({ places: 0, statuses: [new ApiError(404, 'HTTP 404')] });
    await h.tick();
    expect(h.ends).toHaveLength(0);
    expect(h.link()).toEqual(polling('offline'));
  });

  it('401: polling/auth, no more reads, never an end', async () => {
    const h = harness({ places: 0, statuses: [new ApiError(401, 'Non connecté')] });
    await h.tick();
    expect(h.link()).toEqual(polling('auth'));
    expect(h.timers).toHaveLength(0);
    expect(h.runStatus).toHaveBeenCalledTimes(1);
    expect(h.ends).toHaveLength(0);
  });

  it('ends from a terminal status read (status, error, reorientation copied)', async () => {
    const h = harness({
      places: 0,
      statuses: [RUNNING, { status: 'failed', createdAt: 1, output: null, error: 'boom', pendingSteer: 'plus court' }],
    });
    await h.tick();
    expect(h.ends).toHaveLength(0);
    await h.tick();
    expect(h.ends).toHaveLength(1);
    expect(h.ends[0]).toMatchObject({ status: 'failed', error: 'boom', pendingSteer: 'plus court' });
    expect(h.timers).toHaveLength(0);
  });

  it('never ends without a terminal status, whatever the stream does', async () => {
    const down = new Error('down');
    const h = harness({ places: 1, statuses: [RUNNING, down, RUNNING, down, RUNNING] });
    for (let i = 0; i < 4; i++) {
      const src = FakeSource.all.at(-1)!;
      src.send({ event: 'intendia.error', code: i % 2 ? 'hermes_http' : 'hermes_unreachable', message: 'x' });
      src.fail(2);
      await h.tick();
      await h.tick();
    }
    expect(h.ends).toHaveLength(0);
    // at most one EventSource open at a time
    expect(FakeSource.all.filter((s) => !s.closed).length).toBeLessThanOrEqual(1);
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

  it('stop cancels the timer and holds no place, live or polling', async () => {
    const h = harness({ places: 0 });
    h.f.stop();
    expect(h.timers).toHaveLength(0);
    expect(h.runStatus).not.toHaveBeenCalled();
    const live = harness({ places: 1 });
    FakeSource.all[0]!.fail(2);
    live.f.stop();
    expect(live.timers).toHaveLength(0);
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(live.free()).toBe(1);
  });
});
