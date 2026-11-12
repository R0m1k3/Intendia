import { describe, expect, it } from 'vitest';
import { formatBytes, formatTokens, formatUptime, formatUsd, niceScale } from './format';

const sp = (s: string) => s.replace(/\s/g, ' ');

describe('monitor formats', () => {
  it('tokens', () => {
    expect(sp(formatTokens(1234))).toBe('1 234');
    expect(sp(formatTokens(1_250_000))).toBe('1,3 M');
    expect(formatTokens(null)).toBe('—');
  });
  it('usd', () => {
    expect(sp(formatUsd(1.5))).toBe('1,50 $');
    expect(sp(formatUsd(0.0042))).toBe('0,0042 $');
    expect(sp(formatUsd(0))).toBe('0,00 $');
  });
  it('bytes and uptime', () => {
    expect(sp(formatBytes(1536))).toBe('1,5 Ko');
    expect(sp(formatBytes(16 * 2 ** 30))).toBe('16 Go');
    expect(formatUptime(3 * 86400 + 4 * 3600 + 120)).toBe('3 j 4 h');
    expect(formatUptime(125 * 60)).toBe('2 h 5 min');
    expect(formatUptime(45 * 60)).toBe('45 min');
  });
  it('scale: never 0, rounded top', () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 0.5, 1] });
    expect(niceScale(0.137).top).toBeCloseTo(0.2);
    expect(niceScale(7).top).toBe(10);
    expect(niceScale(10).top).toBe(10);
    expect(niceScale(240).top).toBe(250);
  });
});
