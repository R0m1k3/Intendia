import { describe, expect, it } from 'vitest';
import { finishedStatus, runLength } from './format';

describe('centre format', () => {
  it('names the final statuses', () => {
    expect(finishedStatus('completed')).toEqual({ text: 'terminé', tone: 'good' });
    expect(finishedStatus('failed').tone).toBe('bad');
    expect(finishedStatus('interrupted').text).toBe('arrêté');
    expect(finishedStatus('unknown').text).toBe('inconnu');
    expect(finishedStatus('bizarre')).toEqual({ text: 'bizarre', tone: 'neutral' });
  });
  it('gives the length of a run', () => {
    expect(runLength(1000, 63_000)).toBe('1 min 2 s');
    expect(runLength(5000, 1000)).toBe('');
    expect(runLength(0, 1000)).toBe('');
  });
});
