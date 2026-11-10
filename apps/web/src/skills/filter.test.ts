import { describe, expect, it } from 'vitest';
import type { Skill } from '../api';
import { categories, filterSkills, groupByCategory, provenanceLabel } from './filter';

const sk = (name: string, over: Partial<Skill> = {}): Skill => ({
  name, description: null, category: null, enabled: true, provenance: 'bundled', usage: 0, locked: false, ...over,
});
const list = [
  sk('pdf', { description: 'Lire des PDF', category: 'media' }),
  sk('claude-code', { description: 'Délègue le code', category: 'dev', enabled: false }),
  sk('notes', { category: 'media', provenance: 'hub' }),
  sk('loose'),
];

describe('skills filter', () => {
  it('filters by text (accents folded), category and state', () => {
    expect(filterSkills(list, { text: 'delegue', category: '', state: 'all' }).map((s) => s.name)).toEqual(['claude-code']);
    expect(filterSkills(list, { text: '', category: 'media', state: 'all' }).map((s) => s.name)).toEqual(['pdf', 'notes']);
    expect(filterSkills(list, { text: '', category: '', state: 'off' }).map((s) => s.name)).toEqual(['claude-code']);
    expect(filterSkills(list, { text: '', category: '', state: 'on' })).toHaveLength(3);
  });

  it('groups by category, uncategorised last, names sorted', () => {
    expect(groupByCategory(list).map((g) => [g.category, g.skills.map((s) => s.name)])).toEqual([
      ['dev', ['claude-code']], ['media', ['notes', 'pdf']], ['', ['loose']],
    ]);
    expect(categories(list)).toEqual(['dev', 'media']);
  });

  it('labels provenance in French', () => {
    expect(provenanceLabel('agent')).toBe("créé par l'agent");
    expect(provenanceLabel('new-kind')).toBe('new-kind');
    expect(provenanceLabel(null)).toBe('origine inconnue');
  });
});
