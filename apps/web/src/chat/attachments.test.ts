import { describe, expect, it } from 'vitest';
import { splitAttachments } from './attachments';

const m = { agentMount: '/opt/data/workspace/ws', mount: '/data/ws' };

describe('splitAttachments', () => {
  it('a lone path becomes an attachment', () => {
    expect(splitAttachments('/opt/data/workspace/ws/inbox/a.png', m)).toEqual({ text: '', files: ['/opt/data/workspace/ws/inbox/a.png'] });
  });
  it('text then two paths, with a blank line between', () => {
    expect(splitAttachments('Regarde ça\n\n/opt/data/workspace/ws/inbox/a.png\ninbox/b.pdf', m))
      .toEqual({ text: 'Regarde ça', files: ['/opt/data/workspace/ws/inbox/a.png', 'inbox/b.pdf'] });
  });
  it('a path in the middle of the text stays', () => {
    const t = 'Avant\ninbox/a.png\nAprès';
    expect(splitAttachments(t, m)).toEqual({ text: t, files: [] });
  });
  it('a line with text and a path stays', () => {
    const t = 'voir /opt/data/workspace/ws/inbox/a.png';
    expect(splitAttachments(t, m)).toEqual({ text: t, files: [] });
  });
  it('trailing spaces are ignored', () => {
    expect(splitAttachments('Salut\n/data/ws/inbox/a.png   ', m)).toEqual({ text: 'Salut', files: ['/data/ws/inbox/a.png'] });
  });
  it('a path outside the workspace stays', () => {
    const t = 'Salut\n/etc/x.png';
    expect(splitAttachments(t, m)).toEqual({ text: t, files: [] });
  });
  it('text without a path is unchanged', () => {
    expect(splitAttachments('Bonjour\nça va ?', m)).toEqual({ text: 'Bonjour\nça va ?', files: [] });
  });
  it('names with spaces, quotes and (2) pass', () => {
    expect(splitAttachments('inbox/facture (2).pdf\n/opt/data/workspace/ws/inbox/Capture d’écran.png', m).files)
      .toEqual(['inbox/facture (2).pdf', '/opt/data/workspace/ws/inbox/Capture d’écran.png']);
  });
  it('the workspace folder alone is not a file', () => {
    expect(splitAttachments('Salut\n/opt/data/workspace/ws/', m).files).toEqual([]);
  });
});
