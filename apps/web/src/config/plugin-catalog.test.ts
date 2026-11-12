import { describe, expect, it } from 'vitest';
import type { PluginCatalogEntry } from '../api';
import { capabilityLines, filterCatalog } from './plugin-catalog';

const e = (name: string, over: Partial<PluginCatalogEntry> = {}): PluginCatalogEntry => ({
  name, title: name, description: '', maintainer: null, tier: 'community', category: null, version: null, shaShort: 'abcdef0',
  docsUrl: null, requiresHermes: null, platforms: [], tools: [], hooks: [], middleware: [], requiresEnv: [], knownIssues: [],
  installed: false, updateAvailable: false, ...over,
});

describe('filterCatalog', () => {
  const list = [e('zeta', { tier: 'official' }), e('alpha', { description: 'Météo locale' }), e('beta', { tier: 'verified', maintainer: 'Acme' })];
  it('sorts official, verified, then the others by name', () => {
    expect(filterCatalog(list, '', 'tous').map((x) => x.name)).toEqual(['zeta', 'beta', 'alpha']);
  });
  it('matches every word, accents ignored, and the tier', () => {
    expect(filterCatalog(list, 'meteo', 'tous').map((x) => x.name)).toEqual(['alpha']);
    expect(filterCatalog(list, 'acme beta', 'tous').map((x) => x.name)).toEqual(['beta']);
    expect(filterCatalog(list, 'acme zeta', 'tous')).toEqual([]);
    expect(filterCatalog(list, '', 'official').map((x) => x.name)).toEqual(['zeta']);
  });
});

describe('capabilityLines', () => {
  it('says what the plugin adds', () => {
    expect(capabilityLines(e('x', { tools: ['a', 'b'], hooks: ['h'], requiresEnv: ['K'] }))).toEqual([
      '2 outils : a, b', '1 hook (appelé à chaque message ou outil) : h', '1 variable requise : K',
    ]);
    expect(capabilityLines(e('x'))).toEqual([]);
  });
});
