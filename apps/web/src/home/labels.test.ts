import { describe, expect, it } from 'vitest';
import type { RecentSession, ShareLink } from '../api';
import { sessionLinks } from '../components/SessionFiles';
import { filterRecent, sourceLabel } from './labels';

const rs = (id: string, source: string | null): RecentSession => ({ kind: 'hermes', instanceId: 'a', profile: 'default', id, source, title: id, sub: '', workspace: null, at: 0 });

describe('recent sessions', () => {
  it('labels sources', () => {
    expect([sourceLabel('intendia'), sourceLabel('telegram'), sourceLabel('cron'), sourceLabel('api_server'), sourceLabel('discord'), sourceLabel(null)])
      .toEqual(['Intendia', 'Telegram', 'Cron', 'API', 'Discord', 'Hermes']);
  });
  it('filters by source and keeps 7 lines', () => {
    const list = [rs('a', 'intendia'), rs('b', 'telegram'), rs('c', 'cron'), ...Array.from({ length: 8 }, (_, i) => rs(`t${i}`, 'telegram'))];
    expect(filterRecent(list, 'all')).toHaveLength(7);
    expect(filterRecent(list, 'cron').map((s) => s.id)).toEqual(['c']);
    expect(filterRecent(list, 'telegram')[0]!.id).toBe('b');
  });
});

describe('sessionLinks', () => {
  const l = (path: string, extra: Partial<ShareLink> = {}): ShareLink => ({
    token: path, instanceId: 'a', path, agentPath: '', workspace: 'dev', url: '', publicUntil: null, revoked: false, createdAt: 0, exists: true, ...extra,
  });
  it('keeps live links to a file of this session on this instance', () => {
    const links = [l('dev/sessions/s1/a.md'), l('dev/sessions/s10/b.md'), l('dev/sessions/s1/c.md', { revoked: true }), l('dev/sessions/s1/d.md', { instanceId: 'b' }), l('dev/inbox/e.md')];
    expect(sessionLinks(links, 'a', 'dev', 's1').map((x) => x.path)).toEqual(['dev/sessions/s1/a.md']);
  });
});
