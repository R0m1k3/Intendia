import { describe, expect, it } from 'vitest';
import { EMPTY, type Chat } from '../chat/columns';
import { afterRemoveRoute, type RemoveTarget } from './remove';

const own: RemoveTarget = { kind: 'intendia', inst: 'i', profile: 'default', id: 'iw-dev-1', slug: 'dev' };
const ext: RemoveTarget = { kind: 'hermes', inst: 'i', profile: 'default', id: 'tg_1' };
const two: Chat = { ...EMPTY, open: [{ slug: 'pro', id: 'iw-pro-2' }], active: 'iw-pro-2', layout: 'cols' };

describe('afterRemoveRoute', () => {
  it('sends a session born elsewhere home, columns or not', () => {
    expect(afterRemoveRoute(null, ext)).toEqual({ to: '/' });
    expect(afterRemoveRoute(two, ext)).toEqual({ to: '/' });
  });

  it('goes to the active column left', () => {
    expect(afterRemoveRoute(two, own)).toEqual({ to: '/w/$slug/s/$sessionId', params: { slug: 'pro', sessionId: 'iw-pro-2' } });
  });

  it('goes to the workspace when no column is left', () => {
    expect(afterRemoveRoute(EMPTY, own)).toEqual({ to: '/w/$slug', params: { slug: 'dev' } });
    // the deleted one itself is never a destination
    expect(afterRemoveRoute({ ...EMPTY, open: [{ slug: 'dev', id: own.id }], active: own.id }, own)).toEqual({ to: '/w/$slug', params: { slug: 'dev' } });
  });
});
