import { describe, expect, it } from 'vitest';
import { retourOf } from './retour';

const O = 'https://intendia.example';

describe('retourOf', () => {
  it('keeps a local path with its search and hash', () => {
    expect(retourOf('/w/x/s/y?a=1', O)).toBe('/w/x/s/y?a=1');
    expect(retourOf('/i/fake/crons#top', O)).toBe('/i/fake/crons#top');
    expect(retourOf('/', O)).toBe('/');
  });
  it('refuses other sites, odd characters and the sign-in / setup pages', () => {
    for (const raw of ['//evil.com', '/\\evil.com', 'https://x', 'javascript:alert(1)', '/connexion?retour=/a', '/connexion', '/installation', '/installation/modele', '/a b', '/a\tb', 'a/b', '']) {
      expect(retourOf(raw, O), raw).toBeNull();
    }
    expect(retourOf(null, O)).toBeNull();
  });
  it('accepts a page whose name only starts like a blocked one', () => {
    expect(retourOf('/connexions', O)).toBe('/connexions');
  });
});
