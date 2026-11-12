import { describe, expect, it } from 'vitest';
import { cronKey, parseCronKey, pickSelected } from './selection';

const items = [{ k: 'a' }, { k: 'b' }];
const keyOf = (t: { k: string }) => t.k;

describe('pickSelected', () => {
  it('the named item', () => expect(pickSelected(items, 'b', keyOf)).toEqual({ k: 'b' }));
  it('no key: the first', () => expect(pickSelected(items, undefined, keyOf)).toEqual({ k: 'a' }));
  it('unknown key (deleted item): the first', () => expect(pickSelected(items, 'zz', keyOf)).toEqual({ k: 'a' }));
  it('empty list: null', () => expect(pickSelected([], 'a', keyOf)).toBeNull());
});

describe('cron keys', () => {
  it('round trip', () => expect(parseCronKey(cronKey({ profile: 'default', id: 'j/1' }))).toEqual({ profile: 'default', id: 'j/1' }));
  it('rejects malformed keys', () => {
    expect(parseCronKey(undefined)).toBeNull();
    expect(parseCronKey('nokey')).toBeNull();
    expect(parseCronKey('/x')).toBeNull();
    expect(parseCronKey('p/')).toBeNull();
  });
});
