import { useCallback, useEffect, useRef, useState } from 'react';
import { api, runEventsUrl } from '../api';
import { initialRun, isTerminal, reduceEvent, type Entry, type RunEvent, type RunState } from './events';
import { acquireStream } from './streams';

/** Seconds between two status reads of a run followed without a live stream. */
export const POLL_MS = 3000;

interface FollowDeps {
  EventSource: typeof EventSource;
  runStatus: typeof api.runStatus;
  acquire: typeof acquireStream;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

const deps = (d: Partial<FollowDeps> = {}): FollowDeps => ({
  EventSource: d.EventSource ?? window.EventSource,
  runStatus: d.runStatus ?? api.runStatus,
  acquire: d.acquire ?? acquireStream,
  setTimeout: d.setTimeout ?? ((f, ms) => window.setTimeout(f, ms)),
  clearTimeout: d.clearTimeout ?? ((t) => window.clearTimeout(t as number)),
});

/**
 * Follows one run, outside React.
 *
 * Live: through the Intendia SSE proxy. EventSource reconnects by itself after a network cut and sends Last-Event-ID,
 * so Hermes only replays what was missed. The stream is closed here on a terminal event or intendia.error (otherwise
 * EventSource would reconnect forever once Hermes closes it); replay.truncated only sets a flag.
 *
 * Deferred: when this tab already has its live streams (streams.ts), the run's status is read every POLL_MS, and a
 * live place is asked again each time. A place found: the state starts over from the seed, as a new EventSource
 * replays the run from its start. The end of a deferred run is told from its status (status, error, reorientation
 * not delivered); its text comes with the history.
 * Reorientations written meanwhile have no text in that replay (`run.steered` only): each one is put back where the
 * replay reaches a `run.steered`, in the order they were written.
 *
 * `local(ev)` folds an event made by the page into the run (a reorientation: Hermes' `run.steered` has no text), so
 * what the agent streams next comes after it.
 */
export function followRun(o: {
  inst: string;
  sessionId: string;
  run: { id: string; seed: Entry[] };
  onState: (s: RunState, deferred: boolean) => void;
  onEnd: (s: RunState) => void;
  deps?: Partial<FollowDeps>;
}): { local: (ev: RunEvent) => void; stop: () => void } {
  const d = deps(o.deps);
  let current = initialRun(o.run.seed);
  let deferred = false;
  let ended = false;
  let stopped = false;
  let es: EventSource | null = null;
  let release: (() => void) | null = null;
  let timer: unknown = null;
  /** local events of this run, in order (a replay from the start loses their text) */
  const locals: RunEvent[] = [];
  /** those to put back at the next `run.steered` of the replay */
  let replay: RunEvent[] = [];

  const emit = () => o.onState(current, deferred);
  const end = () => {
    if (ended) return;
    ended = true;
    es?.close();
    release?.();
    o.onEnd(current);
  };

  const tryStream = () => {
    if (stopped || ended) return;
    release = d.acquire();
    if (!release) {
      if (!deferred) { deferred = true; emit(); }
      timer = d.setTimeout(poll, POLL_MS);
      return;
    }
    deferred = false;
    current = initialRun(o.run.seed);
    replay = [...locals];
    emit();
    const source = new d.EventSource(runEventsUrl(o.inst, o.sessionId, o.run.id), { withCredentials: true });
    es = source;
    source.onmessage = (msg) => {
      let ev: RunEvent;
      try {
        ev = JSON.parse(msg.data as string) as RunEvent;
      } catch {
        return;
      }
      if (typeof ev?.event !== 'string') return;
      current = reduceEvent(current, ev);
      if (ev.event === 'run.steered' && replay.length) current = reduceEvent(current, replay.shift()!);
      emit();
      if (isTerminal(current.status)) end();
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
        if (s.status !== current.status) { current = { ...current, status: s.status }; emit(); }
        tryStream();
      },
      () => { if (!stopped && !ended) timer = d.setTimeout(poll, POLL_MS); },
    );
  };

  emit();
  tryStream();
  return {
    local: (ev) => {
      if (stopped || isTerminal(current.status)) return;
      locals.push(ev);
      current = reduceEvent(current, ev);
      emit();
    },
    stop: () => {
      stopped = true;
      es?.close();
      if (timer !== null) d.clearTimeout(timer);
      release?.();
    },
  };
}

/**
 * Follows one run of the page (followRun): its state, `local(ev)`, and `deferred` = followed by polling (no live
 * place left in this tab).
 */
export function useRun(
  inst: string,
  sessionId: string,
  run: { id: string; seed: Entry[] } | null,
  onEnd: (state: RunState) => void,
): [RunState | null, (ev: RunEvent) => void, boolean] {
  const [state, setState] = useState<RunState | null>(null);
  const [deferred, setDeferred] = useState(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const fold = useRef<((ev: RunEvent) => void) | null>(null);
  const local = useCallback((ev: RunEvent) => fold.current?.(ev), []);

  useEffect(() => {
    if (!run) {
      setState(null);
      setDeferred(false);
      return;
    }
    const f = followRun({
      inst, sessionId, run,
      onState: (s, d) => { setState(s); setDeferred(d); },
      onEnd: (s) => onEndRef.current(s),
    });
    fold.current = f.local;
    return () => { f.stop(); fold.current = null; };
  }, [inst, sessionId, run]);

  return [state, local, deferred];
}
