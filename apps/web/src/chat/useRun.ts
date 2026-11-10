import { useEffect, useRef, useState } from 'react';
import { runEventsUrl } from '../api';
import { initialRun, isTerminal, reduceEvent, type Entry, type RunEvent, type RunState } from './events';

/**
 * Follows one run through the Intendia SSE proxy. EventSource reconnects by itself after a network cut
 * and sends Last-Event-ID, so Hermes only replays what was missed. The stream is closed here on a
 * terminal event or intendia.error (otherwise EventSource would reconnect forever once Hermes closes it);
 * replay.truncated only sets a flag.
 */
export function useRun(
  inst: string,
  sessionId: string,
  run: { id: string; seed: Entry[] } | null,
  onEnd: (state: RunState) => void,
): RunState | null {
  const [state, setState] = useState<RunState | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    if (!run) {
      setState(null);
      return;
    }
    let current = initialRun(run.seed);
    setState(current);
    const es = new EventSource(runEventsUrl(inst, sessionId, run.id), { withCredentials: true });
    let ended = false;
    es.onmessage = (msg) => {
      let ev: RunEvent;
      try {
        ev = JSON.parse(msg.data) as RunEvent;
      } catch {
        return;
      }
      if (typeof ev?.event !== 'string') return;
      current = reduceEvent(current, ev);
      setState(current);
      if (!ended && isTerminal(current.status)) {
        ended = true;
        es.close();
        onEndRef.current(current);
      }
    };
    return () => es.close();
  }, [inst, sessionId, run]);

  return state;
}
