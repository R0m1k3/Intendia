import { describe, expect, it } from 'vitest';
import { instancePath, navTarget, resolveCurrent, switchTarget } from './current';

describe('resolveCurrent', () => {
  const ids = ['maison', 'bureau'];
  it('address first, then the tab, then the first instance', () => {
    expect(resolveCurrent({ ids, fromUrl: 'bureau', tab: 'maison' })).toBe('bureau');
    expect(resolveCurrent({ ids, tab: 'bureau' })).toBe('bureau');
    expect(resolveCurrent({ ids, fromUrl: 'inconnue', tab: 'bureau' })).toBe('bureau');
    expect(resolveCurrent({ ids, tab: 'supprimee' })).toBe('maison');
    expect(resolveCurrent({ ids: [], tab: 'maison' })).toBeNull();
  });
});

describe('switchTarget', () => {
  it('keeps the instance page, without its search', () => {
    expect(switchTarget('/i/maison/crons', 'bureau')).toEqual({ to: '/i/$inst/crons', params: { inst: 'bureau' } });
    expect(switchTarget('/i/maison/agents/x', 'bureau')).toEqual({ to: '/i/$inst/agents', params: { inst: 'bureau' } });
    expect(switchTarget('/i/maison/config', 'bureau')).toEqual({ to: '/i/$inst/config', params: { inst: 'bureau' } });
  });
  it('a session or a workspace of the other instance → home', () => {
    expect(switchTarget('/i/maison/p/default/s/1', 'bureau')).toEqual({ to: '/' });
    expect(switchTarget('/w/slug/s/1', 'bureau')).toEqual({ to: '/' });
    expect(switchTarget('/w/slug', 'bureau')).toEqual({ to: '/' });
  });
  it('other pages stay, replaced in the history', () => {
    expect(switchTarget('/w', 'bureau')).toEqual({ to: '/w', replace: true });
    expect(switchTarget('/sessions', 'bureau')).toEqual({ to: '/sessions', replace: true });
    expect(switchTarget('/etat', 'bureau')).toEqual({ to: '/etat', replace: true });
    expect(switchTarget('/', 'bureau')).toEqual({ to: '/', replace: true });
  });
});

describe('links', () => {
  it('instance pages need an instance', () => {
    expect(instancePath('crons', 'a')).toEqual({ to: '/i/$inst/crons', params: { inst: 'a' } });
    expect(navTarget({ to: '/crons', page: 'crons' }, 'a')).toEqual({ to: '/i/$inst/crons', params: { inst: 'a' } });
    expect(navTarget({ to: '/crons', page: 'crons' }, null)).toEqual({ to: '/crons' });
    expect(navTarget({ to: '/sessions' }, 'a')).toEqual({ to: '/sessions' });
  });
});
