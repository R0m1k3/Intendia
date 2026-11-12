import { describe, expect, it } from 'vitest';
import { acquireStream, freeStreams, MAX_STREAMS } from './streams';

describe('acquireStream', () => {
  it('gives at most MAX_STREAMS places, then null; a released place is given again once', () => {
    const held = Array.from({ length: MAX_STREAMS }, () => acquireStream());
    expect(held.every(Boolean)).toBe(true);
    expect(acquireStream()).toBeNull();
    held[0]!();
    held[0]!();
    expect(freeStreams()).toBe(1);
    const again = acquireStream();
    expect(again).not.toBeNull();
    expect(acquireStream()).toBeNull();
    again!();
    held.slice(1).forEach((r) => r!());
    expect(freeStreams()).toBe(MAX_STREAMS);
  });
});
