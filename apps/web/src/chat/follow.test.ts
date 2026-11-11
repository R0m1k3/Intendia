import { describe, expect, it } from 'vitest';
import { measure, startFollow, type FollowState } from './follow';

const CLIENT = 800;
const at = (scrollTop: number, scrollHeight: number) => ({ scrollTop, scrollHeight, clientHeight: CLIENT });
// pinned at the bottom of a 3 000 px thread
const bottom: FollowState = { pinned: true, lastTop: 2200, lastHeight: 3000 };

describe('measure', () => {
  it('starts pinned on the current position', () => {
    expect(startFollow(at(500, 3000))).toEqual({ pinned: true, lastTop: 500, lastHeight: 3000 });
  });

  it('stays pinned when content grew under a still position (the bug: a late scroll event)', () => {
    expect(measure(bottom, at(2200, 3000 + 1235)).pinned).toBe(true);
  });

  it('unpins when the position went up', () => {
    expect(measure(bottom, at(1900, 3000)).pinned).toBe(false);
  });

  it('ignores a one-pixel move up', () => {
    expect(measure(bottom, at(2199, 3000)).pinned).toBe(true);
  });

  it('stays pinned when shrunk content clamps the position to its new end', () => {
    expect(measure(bottom, at(1700, 2500)).pinned).toBe(true);
  });

  it('pins again near the bottom seen at the previous measure, even after a burst', () => {
    const up: FollowState = { pinned: false, lastTop: 1000, lastHeight: 3000 };
    // reader back 50 px from the old bottom while 1 000 px arrived
    expect(measure(up, at(2150, 4000)).pinned).toBe(true);
  });

  it('stays unpinned while the reader is still far from the bottom', () => {
    const up: FollowState = { pinned: false, lastTop: 1000, lastHeight: 3000 };
    expect(measure(up, at(1800, 3000)).pinned).toBe(false);
  });

  it('always records the position and the height', () => {
    expect(measure(bottom, at(1900, 3100))).toMatchObject({ lastTop: 1900, lastHeight: 3100 });
  });
});
