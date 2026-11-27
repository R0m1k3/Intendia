import { describe, expect, it } from 'vitest';
import { GLOSSARY, term } from './glossary';

describe('glossary', () => {
  it('has one entry per id, each with a term and a text', () => {
    expect(new Set(GLOSSARY.map((g) => g.id)).size).toBe(GLOSSARY.length);
    for (const g of GLOSSARY) {
      expect(g.term.length).toBeGreaterThan(1);
      expect(g.text.length).toBeGreaterThan(40);
      expect(g.id).toMatch(/^[a-z-]+$/);
    }
  });
  it('finds a term by its id', () => {
    expect(term('passerelle').hermes).toBe('gateway');
  });
});
