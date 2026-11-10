import { describe, expect, it } from 'vitest';
import { kanbanEventsUrl, openKanbanEvents, type WsLike } from '../src/hermes/events.js';
import { fakeInstance, testApp } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;
const K = '/x/i/fake/kanban';
const listeners = (t: T) => (t.fake.kanban as unknown as { listeners: Set<unknown> }).listeners.size;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads an SSE response until `until(text)` is true, the stream ends, or `ms` pass. */
async function read(res: Response, until: (text: string) => boolean, ms = 2000, act?: () => Promise<unknown>) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  let ended = false;
  const deadline = Date.now() + ms;
  const acting = act ? sleep(30).then(act) : null;
  while (Date.now() < deadline && !until(text)) {
    const chunk = await Promise.race([
      reader.read(),
      sleep(Math.max(1, deadline - Date.now())).then(() => ({ done: false, value: undefined, timeout: true })),
    ]);
    if ('timeout' in chunk) break;
    if (chunk.done) { ended = true; break; }
    text += dec.decode(chunk.value, { stream: true });
  }
  await acting;
  return { text, ended, reader };
}

describe('kanban live events', () => {
  it('relays a write as a change with the task id, and closes the WebSocket with the stream', async () => {
    const t = await testApp();
    const res = await t.raw('GET', `${K}/events?board=default`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    let id = '';
    const { text, reader } = await read(res, (s) => s.includes('event: change'), 2000, async () => {
      id = (await t.request('POST', `${K}/tasks?board=default`, { title: 'Direct', start: 'ready' })).json.task.id;
    });
    expect(text).toContain('event: change');
    expect(text).toContain(id);
    expect(text).not.toContain('fake-dashboard-token');
    expect(listeners(t)).toBe(1);
    await reader.cancel();
    await sleep(20);
    expect(listeners(t)).toBe(0);
  });

  it('ignores the events of another board', async () => {
    const t = await testApp();
    await t.request('POST', `${K}/boards`, { slug: 'autre' });
    const res = await t.raw('GET', `${K}/events?board=default`);
    const { text, reader } = await read(res, (s) => s.includes('event: change'), 300, () =>
      t.request('POST', `${K}/tasks?board=autre`, { title: 'Ailleurs', start: 'ready' }));
    expect(text).not.toContain('event: change');
    await reader.cancel();
  });

  it('closes the stream when the WebSocket is refused or never answers (kanbanWs off, wrong token, unknown board)', async () => {
    const off = await testApp({ kanbanWs: false });
    const a = await read(await off.raw('GET', `${K}/events?board=default`), () => false);
    expect(a.ended).toBe(true);
    expect(a.text).toContain('event: closed');
    expect(a.text).not.toContain('fake-dashboard-token');

    const bad = await testApp({ instance: { dashboardToken: 'mauvais-jeton-0000000000000000' } });
    const b = await read(await bad.raw('GET', `${K}/events?board=default`), () => false);
    expect(b.ended).toBe(true);
    expect(b.text).not.toContain('mauvais-jeton');

    const t = await testApp();
    const c = await read(await t.raw('GET', `${K}/events?board=inconnu`), () => false);
    expect(c.ended).toBe(true);
  });

  it('gives up a handshake Hermes never answers (wrong token on 0.23.0) and closes the socket', async () => {
    let closedWith: number | undefined;
    const silent = (): WsLike => ({ addEventListener: () => {}, close: (code) => { closedWith = code; } });
    const reasons: string[] = [];
    openKanbanEvents(fakeInstance(), 'default', { onEvents: () => {}, onClose: (r) => reasons.push(r) }, silent, 50);
    await sleep(120);
    expect(reasons).toEqual(['Flux du kanban sans réponse']);
    expect(closedWith).toBe(1000);
  });

  it('builds the WebSocket URL from the dashboard URL, base path kept', () => {
    expect(kanbanEventsUrl(fakeInstance({ dashboard: 'https://h.example/hermes/' }), 'b1'))
      .toBe('wss://h.example/hermes/api/plugins/kanban/events?board=b1&token=fake-dashboard-token');
    expect(kanbanEventsUrl(fakeInstance(), 'default')).toMatch(/^ws:\/\/fake-dash\/api\/plugins\/kanban\/events\?board=default&token=/);
  });
});
