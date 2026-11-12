import { describe, expect, it } from 'vitest';
import { usageLabel, usagePercent } from './usage';

describe('memory usage', () => {
  it('says "environ" with French numbers, and unknown without a size', () => {
    expect(usageLabel({ bytes: 1234, limit: 2200 }).replace(/\s/g, ' ')).toBe('environ 1 234 / 2 200 caractères');
    expect(usageLabel(null)).toBe('taille inconnue');
  });
  it('gives a percent, over 100 past the limit', () => {
    expect(usagePercent({ bytes: 1100, limit: 2200 })).toBe(50);
    expect(usagePercent({ bytes: 2500, limit: 2200 })).toBe(114);
    expect(usagePercent(null)).toBeNull();
  });
});
