import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { embedUrl, isSideChatKey } from '../chat/embed';
import { syncSessions } from './sync';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('side chat sync', () => {
  it('a sessions refresh in one copy of the app refreshes the other, once, and nothing else', async () => {
    const page = new QueryClient();
    const frame = new QueryClient();
    const stopPage = syncSessions(page);
    const stopFrame = syncSessions(frame);
    let fetches = 0;
    let other = 0;
    await frame.prefetchQuery({ queryKey: ['sessions-recent', 'ref'], queryFn: () => ++fetches });
    await frame.prefetchQuery({ queryKey: ['skills', 'ref'], queryFn: () => ++other });
    // an observed (active) query is refetched on invalidation
    const un = new QueryObserver(frame, { queryKey: ['sessions-recent', 'ref'], queryFn: () => ++fetches, staleTime: Infinity }).subscribe(() => {});
    await page.invalidateQueries({ queryKey: ['sessions'] });
    await page.invalidateQueries({ queryKey: ['workspaces'] });
    await page.invalidateQueries({ queryKey: ['skills'] }); // not a sessions list: not sent
    await wait(500);
    expect(fetches).toBe(2);
    expect(other).toBe(1);
    un();
    stopPage();
    stopFrame();
  });

  it('address and shortcut', () => {
    expect(embedUrl({ slug: 'mon ws', id: 'a/b' })).toBe('/w/mon%20ws/s/a%2Fb?embed=1');
    const key = (o: Partial<KeyboardEvent>) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'j', ...o }) as KeyboardEvent;
    expect(isSideChatKey(key({ ctrlKey: true }))).toBe(true);
    expect(isSideChatKey(key({ metaKey: true, key: 'J' }))).toBe(true);
    expect(isSideChatKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSideChatKey(key({}))).toBe(false);
  });
});
