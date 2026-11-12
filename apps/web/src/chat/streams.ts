// Live run streams of this browser tab. A followed run holds one SSE connection, even while it waits for an approval;
// over HTTP/1.1 a browser opens at most 6 connections per origin, so more than 3 live runs would starve the requests.
// Beyond the cap, a run is followed by polling its status (useRun.ts, followRun).

export const MAX_STREAMS = 3;

let used = 0;

/** A release function when a stream may open now, else null. Releasing twice frees one place only. */
export function acquireStream(): (() => void) | null {
  if (used >= MAX_STREAMS) return null;
  used++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    used--;
  };
}

/** Places left (tests). */
export function freeStreams(): number {
  return MAX_STREAMS - used;
}
