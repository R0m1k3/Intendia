// Does the thread follow its end while it grows? Judged from the scroll position itself, which is always current, and
// not from the distance seen by a `scroll` event: that event arrives one frame late, after content may have grown, so
// a distance measured then would take a growth for a reader who scrolled up.

/** Distance to the bottom under which the reader is "at the end" and the thread follows again. */
export const FOLLOW_GAP = 120;
/** Upward movement ignored (sub-pixel rounding). */
export const UP_TOLERANCE = 1;
/** Distance to the bottom that still counts as the bottom (a shrunk page clamps the position to its new end). */
export const BOTTOM_EPS = 2;

export interface FollowState {
  pinned: boolean;
  /** Scroll position at the previous measure. */
  lastTop: number;
  /** Content height at the previous measure. */
  lastHeight: number;
}

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const startFollow = (box: ScrollBox): FollowState => ({ pinned: true, lastTop: box.scrollTop, lastHeight: box.scrollHeight });

/**
 * One measure, on each `scroll` event and before each automatic scroll: content growth never moves the position up, so
 * only the reader can unpin; coming back near the bottom as it was at the previous measure pins again (a burst of text
 * since then does not count against the reader).
 */
export function measure(prev: FollowState, box: ScrollBox): FollowState {
  const top = box.scrollTop;
  const gap = box.scrollHeight - top - box.clientHeight;
  let pinned = prev.pinned;
  if (top < prev.lastTop - UP_TOLERANCE && gap > BOTTOM_EPS) pinned = false;
  else if (top + box.clientHeight >= Math.min(prev.lastHeight, box.scrollHeight) - FOLLOW_GAP) pinned = true;
  return { pinned, lastTop: top, lastHeight: box.scrollHeight };
}
