import { describe, expect, it } from 'vitest';
import { handlesFor, mentions, turnInput } from '../src/channels/text.js';

describe('channel text', () => {
  it('names members by profile, with the instance when shared', () => {
    expect(handlesFor([{ instanceId: 'fake', profile: 'default' }, { instanceId: 'maison', profile: 'default' }, { instanceId: 'fake', profile: 'Veille Prix' }]))
      .toEqual(['default-fake', 'default-maison', 'veille-prix']);
  });
  it('finds the members named, @tous for all, never the author', () => {
    const h = ['ada', 'linus', 'grace'];
    expect(mentions('Merci @Linus et @grace.', h)).toEqual(['linus', 'grace']);
    expect(mentions('@tous au rapport', h, 'ada')).toEqual(['linus', 'grace']);
    expect(mentions('écrire à ada@exemple.fr', h)).toEqual([]);
    expect(mentions('@linus', h, 'linus')).toEqual([]);
  });
  it('frames the turn with the unseen messages', () => {
    const text = turnInput({
      channel: { name: 'Noël', instructions: 'Soyez brefs', lead: 'ada' },
      members: [{ handle: 'ada', profile: 'ada', instanceLabel: 'A' }, { handle: 'linus', profile: 'linus', instanceLabel: 'A' }],
      me: 'linus',
      messages: [{ seq: 1, author: 'user', text: 'Le catalogue ?' }, { seq: 2, author: 'ada', text: '@linus à toi' }],
    });
    expect(text).toContain('Vous y êtes @linus. Autres membres : @ada (chef).');
    expect(text).toContain('Consignes du canal : Soyez brefs');
    expect(text).toContain('— Utilisateur : Le catalogue ?\n— @ada : @linus à toi');
  });
});
