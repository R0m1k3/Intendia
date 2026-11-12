import { describe, expect, it } from 'vitest';
import type { Entry } from './events';
import { stamps } from './timeline';

const u = (key: string, ts: number | null): Entry => ({ kind: 'user', key, text: key, ts });
const t = (key: string, ts: number | null): Entry => ({ kind: 'tool', key, callId: null, tool: 'terminal', preview: '', result: null, duration: null, state: 'ok', ts });

describe('stamps', () => {
  it('time of each dated entry, gap with the previous dated one', () => {
    const m = stamps([u('a', 100), t('b', 112), t('c', null), t('d', 112.4), t('e', 200)]);
    expect(m.get('a')).toEqual({ ts: 100, gap: null });
    expect(m.get('b')).toEqual({ ts: 112, gap: 12 });
    expect(m.has('c')).toBe(false);
    expect(m.get('d')).toEqual({ ts: 112.4, gap: null }); // under 1 s
    expect(m.get('e')!.gap).toBeCloseTo(87.6);
  });
  it('first dated entry after undated ones has no gap', () => {
    expect(stamps([u('a', null), u('b', 50)]).get('b')).toEqual({ ts: 50, gap: null });
  });
});
