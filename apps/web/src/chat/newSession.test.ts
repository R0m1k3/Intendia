import { describe, expect, it } from 'vitest';
import { EMPTY, type Chat } from './columns';
import { pickWorkspace } from './newSession';

const workspaces = [
  { slug: 'autre', instanceId: 'j' },
  { slug: 'perso', instanceId: 'i' },
  { slug: 'magasin', instanceId: 'i' },
];
const chat = (slug: string): Chat => ({ ...EMPTY, open: [{ slug, id: 's1' }], active: 's1' });

describe('pickWorkspace', () => {
  it('takes the active chat’s workspace first', () => {
    expect(pickWorkspace({ workspaces, inst: 'i', chat: chat('magasin'), last: 'perso' })).toBe('magasin');
  });
  it('ignores an active chat or a last workspace of another instance', () => {
    expect(pickWorkspace({ workspaces, inst: 'i', chat: chat('autre'), last: 'magasin' })).toBe('magasin');
    expect(pickWorkspace({ workspaces, inst: 'i', chat: EMPTY, last: 'autre' })).toBe('perso');
  });
  it('falls back on the instance’s first workspace, null without one', () => {
    expect(pickWorkspace({ workspaces, inst: 'i', chat: EMPTY, last: null })).toBe('perso');
    expect(pickWorkspace({ workspaces, inst: 'z', chat: EMPTY, last: 'perso' })).toBeNull();
  });
});
