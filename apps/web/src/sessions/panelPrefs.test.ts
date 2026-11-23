import { describe, expect, it } from 'vitest';
import { clampWidth, PANEL_KEEP, PANEL_MAX, PANEL_MIN, parseStore, withPrefs } from './panelPrefs';

describe('panelPrefs', () => {
  it('reads only valid entries and bounds the width', () => {
    const s = parseStore(JSON.stringify({ a: { tab: 'agent', width: 2000, at: 1 }, b: { tab: 'nope', width: 400 }, c: null }));
    expect(s).toEqual({ a: { tab: 'agent', width: PANEL_MAX, at: 1 } });
    expect(parseStore('{oops')).toEqual({});
    expect(clampWidth(10)).toBe(PANEL_MIN);
  });
  it('keeps the most recent sessions', () => {
    let s = {};
    for (let i = 0; i < PANEL_KEEP + 5; i += 1) s = withPrefs(s, `s${i}`, { tab: 'files', width: 400 }, i);
    expect(Object.keys(s)).toHaveLength(PANEL_KEEP);
    expect(s).not.toHaveProperty('s0');
    expect(s).toHaveProperty(`s${PANEL_KEEP + 4}`);
  });
});
