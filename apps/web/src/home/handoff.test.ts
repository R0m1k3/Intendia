import { describe, expect, it } from 'vitest';
import { setHandoff, takeHandoff } from './handoff';

describe('handoff', () => {
  it('is read once, only by the run it was made for', () => {
    setHandoff({ inst: 'a', sessionId: 's', runId: 'r1', text: 'Bonjour', ts: 1 });
    expect(takeHandoff('a', 's', 'r2')).toBeNull();
    expect(takeHandoff('a', 'other', 'r1')).toBeNull();
    expect(takeHandoff('a', 's', 'r1')?.text).toBe('Bonjour');
    expect(takeHandoff('a', 's', 'r1')).toBeNull();
  });
});
