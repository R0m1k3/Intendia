import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, runEventsUrl } from '../api';
import { initialRun, isTerminal, reduceEvent, type Entry, type RunEvent, type RunState } from './events';
import { acquireStream } from './streams';

/** Seconds between two status reads of a run followed without a live stream. */
export const POLL_MS = 3000;
/** Longest wait between two status reads while Intendia does not answer (3, 6, 12, 24, then 30 s). */
export const POLL_MAX_MS = 30_000;
/** A stream lost before any event is tried again after this long (a stream that fails at once never loops). */
export const STREAM_RETRY_MS = 30_000;

/**
 * How a run is followed: live (its SSE stream), or by reading its status, because the tab has no live place left
 * (`cap`), the stream was lost (`lost`), Intendia does not answer (`offline`) or the sign-in expired (`auth`).
 */
export type RunLink = { mode: 'live' } | { mode: 'polling'; cause: 'cap' | 'lost' | 'offline' | 'auth' };

interface FollowDeps {
  EventSource: typeof EventSource;
  runStatus: typeof api.runStatus;
  acquire: typeof acquireStream;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
  now: () => number;
}

const deps = (d: Partial<FollowDeps> = {}): FollowDeps => ({
  EventSource: d.EventSource ?? window.EventSource,
  runStatus: d.runStatus ?? api.runStatus,
  acquire: d.acquire ?? acquireStream,
  setTimeout: d.setTimeout ?? ((f, ms) => window.setTimeout(f, ms)),
  clearTimeout: d.clearTimeout ?? ((t) => window.clearTimeout(t as number)),
  now: d.now ?? (() => Date.now()),
});

const CLOSED = 2;

/**
 * Follows one run, outside React. A lost stream is never a lost run: the run ends only on a terminal status (a
 * terminal event of the stream, or the status read by `GET …/runs/:runId`, or `run_unknown`).
 *
 * Live: through the Intendia SSE proxy. EventSource reconnects by itself after a network cut (state CONNECTING) and
 * sends Last-Event-ID, so Hermes only replays what was missed. Closed for good (CLOSED: a non-SSE answer, as a 502 of
 * a proxy or a 401) or told `intendia.error` by the server, the stream is lost: the run is followed by its status
 * from then on, and a new stream resumes after the last event seen (`?lastSeq=`), at the first status read when the
 * lost stream had brought events, else STREAM_RETRY_MS later. After `run_gone` (Hermes swept the run's events: more
 * than 300 s without a listener) no stream is opened again; the text comes with the history at the end.
 *
 * Capped: when this tab already has its live streams (streams.ts), the run's status is read every POLL_MS, and a
 * live place is asked again each time. A place found without any event seen: the state starts over from the seed, as
 * a new EventSource replays the run from its start. Reorientations written meanwhile have no text in that replay
 * (`run.steered` only): each one is put back where the replay reaches a `run.steered`, in the order they were written.
 *
 * Status reads that fail: `offline`, read again after 3, 6, 12, 24 then 30 s; a 401 stops everything (`auth`, until a
 * reload after signing in), never an end.
 *
 * `local(ev)` folds an event made by the page into the run (a reorientation: Hermes' `run.steered` has no text), so
 * what the agent streams next comes after it.
 */
export function followRun(o: {
  inst: string;
  sessionId: string;
  run: { id: string; seed: Entry[] };
  onState: (s: RunState, link: RunLink) => void;
  onEnd: (s: RunState) => void;
  deps?: Partial<FollowDeps>;
}): { local: (ev: RunEvent) => void; stop: () => void } {
  const d = deps(o.deps);
  let current = initialRun(o.run.seed);
  let link: RunLink = { mode: 'live' };
  /** what to go back to after `offline` */
  let lostCause: 'cap' | 'lost' = 'cap';
  /** seq of the last event received: a new stream resumes after it */
  let lastSeq: number | null = null;
  /** Hermes forgot the run's events: never a stream again */
  let swept = false;
  let nextStreamAt = 0;
  /** the stream being followed brought at least one event */
  let gotEvent = false;
  let pollFailures = 0;
  let ended = false;
  let stopped = false;
  let es: EventSource | null = null;
  let release: (() => void) | null = null;
  let timer: unknown = null;
  /** local events of this run, in order (a replay from the start loses their text) */
  const locals: RunEvent[] = [];
  /** those to put back at the next `run.steered` of the replay */
  let replay: RunEvent[] = [];

  const emit = () => o.onState(current, link);
  const clearTimer = () => {
    if (timer !== null) d.clearTimeout(timer);
    timer = null;
  };
  const schedulePoll = (ms: number) => {
    clearTimer();
    timer = d.setTimeout(poll, ms);
  };
  const closeStream = () => {
    es?.close();
    es = null;
    release?.();
    release = null;
  };
  /** the only way out: called on a terminal status only */
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimer();
    closeStream();
    o.onEnd(current);
  };

  const lose = (isSwept: boolean) => {
    if (stopped || ended) return;
    closeStream();
    swept ||= isSwept;
    nextStreamAt = gotEvent ? 0 : d.now() + STREAM_RETRY_MS;
    link = { mode: 'polling', cause: 'lost' };
    lostCause = 'lost';
    emit();
    schedulePoll(0);
  };

  const openStream = () => {
    if (stopped || ended) return;
    release = d.acquire();
    if (!release) {
      link = { mode: 'polling', cause: 'cap' };
      lostCause = 'cap';
      emit();
      schedulePoll(POLL_MS);
      return;
    }
    link = { mode: 'live' };
    gotEvent = false;
    if (lastSeq === null) {
      // nothing received yet: the new stream replays the run from its start
      current = initialRun(o.run.seed);
      replay = [...locals];
    }
    emit();
    const source = new d.EventSource(runEventsUrl(o.inst, o.sessionId, o.run.id, lastSeq ?? undefined), { withCredentials: true });
    es = source;
    source.onmessage = (msg) => {
      if (es !== source) return;
      let ev: RunEvent;
      try {
        ev = JSON.parse(msg.data as string) as RunEvent;
      } catch {
        return;
      }
      if (typeof ev?.event !== 'string') return;
      // the server could not serve the stream: lost, never the end of the run
      if (ev.event === 'intendia.error') {
        lose(ev.code === 'run_gone');
        return;
      }
      const id = (msg as MessageEvent).lastEventId;
      if (typeof id === 'string' && /^\d+$/.test(id)) lastSeq = Number(id);
      gotEvent = true;
      current = reduceEvent(current, ev);
      if (ev.event === 'run.steered' && replay.length) current = reduceEvent(current, replay.shift()!);
      emit();
      if (isTerminal(current.status)) end();
    };
    // CONNECTING: the EventSource reconnects by itself; CLOSED: it gave up (an answer that is not SSE)
    source.onerror = () => {
      if (es === source && source.readyState === CLOSED) lose(false);
    };
  };

  const poll = () => {
    timer = null;
    if (stopped || ended) return;
    d.runStatus(o.inst, o.sessionId, o.run.id).then(
      (s) => {
        if (stopped || ended) return;
        if (isTerminal(s.status)) {
          current = { ...current, status: s.status, error: s.error, pendingSteer: s.pendingSteer ?? null };
          emit();
          end();
          return;
        }
        pollFailures = 0;
        if (s.status !== current.status) current = { ...current, status: s.status };
        if (lostCause === 'cap' || (!swept && d.now() >= nextStreamAt)) {
          openStream();
          return;
        }
        link = { mode: 'polling', cause: 'lost' };
        emit();
        schedulePoll(POLL_MS);
      },
      (err: unknown) => {
        if (stopped || ended) return;
        if (err instanceof ApiError && err.status === 401) {
          // signed out: nothing more until a reload after signing in, and never an end
          clearTimer();
          link = { mode: 'polling', cause: 'auth' };
          emit();
          return;
        }
        if (err instanceof ApiError && err.status === 404 && (err.data as { code?: string } | undefined)?.code === 'run_unknown') {
          current = { ...current, status: 'unknown' };
          emit();
          end();
          return;
        }
        pollFailures += 1;
        link = { mode: 'polling', cause: 'offline' };
        emit();
        schedulePoll(Math.min(POLL_MS * 2 ** (pollFailures - 1), POLL_MAX_MS));
      },
    );
  };

  openStream();
  return {
    local: (ev) => {
      if (stopped || isTerminal(current.status)) return;
      locals.push(ev);
      current = reduceEvent(current, ev);
      emit();
    },
    stop: () => {
      stopped = true;
      clearTimer();
      closeStream();
    },
  };
}

const LIVE: RunLink = { mode: 'live' };

/** Follows one run of the page (followRun): its state, `local(ev)`, and how it is followed (`link`). */
export function useRun(
  inst: string,
  sessionId: string,
  run: { id: string; seed: Entry[] } | null,
  onEnd: (state: RunState) => void,
): [RunState | null, (ev: RunEvent) => void, RunLink] {
  const [state, setState] = useState<RunState | null>(null);
  const [link, setLink] = useState<RunLink>(LIVE);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const fold = useRef<((ev: RunEvent) => void) | null>(null);
  const local = useCallback((ev: RunEvent) => fold.current?.(ev), []);

  useEffect(() => {
    if (!run) {
      setState(null);
      setLink(LIVE);
      return;
    }
    const f = followRun({
      inst, sessionId, run,
      onState: (s, l) => { setState(s); setLink(l); },
      onEnd: (s) => onEndRef.current(s),
    });
    fold.current = f.local;
    return () => { f.stop(); fold.current = null; };
  }, [inst, sessionId, run]);

  return [state, local, link];
}
