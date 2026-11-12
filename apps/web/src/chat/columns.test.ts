import { beforeEach, describe, expect, it } from 'vitest';
import {
  activate, close, EMPTY, fromAvec, loadChat, MAX, move, openBeside, openHere, replaceIn, resetChatCache, setLayout,
  setWidth, toAvec, updateChat, withPanel, type Chat, type Col,
} from './columns';

const c = (id: string, slug = 'perso'): Col => ({ slug, id });
const chat = (ids: string[], active: string | null = ids[0] ?? null, more: Partial<Chat> = {}): Chat =>
  ({ ...EMPTY, open: ids.map((id) => c(id)), active, ...more });
const ids = (x: Chat) => x.open.map((y) => y.id);

describe('openHere', () => {
  it('opens the first chat, then replaces the active one in place, its width carried over', () => {
    const a = openHere(EMPTY, c('a'));
    expect(ids(a)).toEqual(['a']);
    expect(a.active).toBe('a');
    const b = openHere(chat(['a', 'b'], 'b', { widths: { b: 500 } }), c('x'));
    expect(ids(b)).toEqual(['a', 'x']);
    expect(b.active).toBe('x');
    expect(b.widths).toEqual({ x: 500 });
  });
  it('makes an open session active, without a second column', () => {
    const x = openHere(chat(['a', 'b'], 'a'), c('b'));
    expect(ids(x)).toEqual(['a', 'b']);
    expect(x.active).toBe('b');
  });
});

describe('openBeside', () => {
  it('adds right of the active one and leaves « Une » for « Colonnes »', () => {
    const x = openBeside(chat(['a', 'b'], 'a'), c('n'));
    expect(ids(x)).toEqual(['a', 'n', 'b']);
    expect(x.active).toBe('n');
    expect(x.layout).toBe('cols');
    expect(openBeside(chat(['a'], 'a', { layout: 'grid' }), c('n')).layout).toBe('grid');
  });
  it('a fifth replaces the active one; an open one is only made active', () => {
    const full = chat(['a', 'b', 'c', 'd'], 'c');
    expect(full.open).toHaveLength(MAX);
    const x = openBeside(full, c('e'));
    expect(ids(x)).toEqual(['a', 'b', 'e', 'd']);
    expect(openBeside(full, c('a'))).toMatchObject({ active: 'a', open: full.open });
  });
});

describe('replaceIn', () => {
  it('keeps the place and width; follows the active mark', () => {
    const x = replaceIn(chat(['a', 'b'], 'b', { widths: { b: 420 } }), 'b', c('b2'))!;
    expect(ids(x)).toEqual(['a', 'b2']);
    expect(x.active).toBe('b2');
    expect(x.widths).toEqual({ b2: 420 });
    expect(replaceIn(chat(['a', 'b'], 'a'), 'b', c('b2'))!.active).toBe('a');
  });
  it('follows a session moved to another workspace, in place', () => {
    const x = replaceIn(chat(['a', 'b'], 'a', { widths: { b: 420 } }), 'b', c('b', 'pro'))!;
    expect(x.open).toEqual([c('a'), c('b', 'pro')]);
    expect(x.active).toBe('a');
    expect(x.widths).toEqual({ b: 420 });
    const same = chat(['a']);
    expect(replaceIn(same, 'a', c('a'))).toBe(same);
  });
  it('null when the column is gone; an already open target is made active, the column kept', () => {
    expect(replaceIn(chat(['a']), 'z', c('n'))).toBeNull();
    const x = replaceIn(chat(['a', 'b'], 'a'), 'a', c('b'))!;
    expect(ids(x)).toEqual(['a', 'b']);
    expect(x.active).toBe('b');
  });
});

describe('close, move, layout, width', () => {
  it('hands the active mark to the right neighbour, else the left one', () => {
    expect(close(chat(['a', 'b', 'c'], 'b'), 'b').active).toBe('c');
    expect(close(chat(['a', 'b', 'c'], 'c'), 'c').active).toBe('b');
    expect(close(chat(['a', 'b'], 'a'), 'b').active).toBe('a');
    expect(close(chat(['a'], 'a', { widths: { a: 400 } }), 'a')).toMatchObject({ open: [], active: null, widths: {} });
  });
  it('moves within bounds only', () => {
    const x = chat(['a', 'b', 'c']);
    expect(ids(move(x, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(move(x, 'a', -1)).toBe(x);
    expect(move(x, 'c', 1)).toBe(x);
  });
  it('activate, setLayout and setWidth leave the state as is when nothing changes', () => {
    const x = chat(['a', 'b']);
    expect(activate(x, 'a')).toBe(x);
    expect(activate(x, 'z')).toBe(x);
    expect(setLayout(x, 'one')).toBe(x);
    expect(setWidth(x, 'a', 401.6).widths).toEqual({ a: 402 });
    expect(setWidth(setWidth(x, 'a', 400), 'a', null).widths).toEqual({});
  });
});

describe('avec', () => {
  it('round-trips any characters', () => {
    const cols = [c('iw-a:b,c~d%e', 'mon:ws,1'), c('x y', 'ws')];
    expect(fromAvec(toAvec(cols))).toEqual(cols);
  });
  it('skips malformed and repeated entries and keeps MAX - 1', () => {
    expect(fromAvec('a:1,,b,:2,c:,a:1,%E0%A4%A:3,d:4,e:5,f:6')).toEqual([c('1', 'a'), c('4', 'd'), c('5', 'e')]);
  });
});

describe('withPanel', () => {
  it('counts open panels by session, same set when unchanged', () => {
    let s: ReadonlySet<string> = new Set();
    s = withPanel(s, 'a', true);
    s = withPanel(s, 'b', true);
    s = withPanel(s, 'a', false);
    expect([...s]).toEqual(['b']);
    expect(withPanel(s, 'b', true)).toBe(s);
    expect(withPanel(s, 'z', false)).toBe(s);
  });
});

describe('store', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } as unknown as Storage & { m: Map<string, string> };
  };
  const g = globalThis as { sessionStorage?: Storage; localStorage?: Storage };
  beforeEach(() => { g.sessionStorage = mem(); g.localStorage = mem(); resetChatCache(); });

  it('reads the tab first, then the copy; writes both; per instance', () => {
    g.localStorage!.setItem('intendia-chat:i', JSON.stringify(chat(['l'])));
    expect(ids(loadChat('i'))).toEqual(['l']);
    resetChatCache();
    g.sessionStorage!.setItem('intendia-chat:i', JSON.stringify(chat(['s'])));
    expect(ids(loadChat('i'))).toEqual(['s']);
    updateChat('i', (x) => openBeside(x, c('n')));
    expect(JSON.parse(g.sessionStorage!.getItem('intendia-chat:i')!).open).toHaveLength(2);
    expect(JSON.parse(g.localStorage!.getItem('intendia-chat:i')!).open).toHaveLength(2);
    expect(loadChat('j')).toEqual(EMPTY);
  });
  it('invalid JSON or shape gives EMPTY; bad entries are dropped', () => {
    g.sessionStorage!.setItem('intendia-chat:i', '{oops');
    expect(loadChat('i')).toEqual(EMPTY);
    resetChatCache();
    g.sessionStorage!.setItem('intendia-chat:i', JSON.stringify({ open: [{ slug: 'p', id: 'a' }, { id: 3 }, { slug: 'p', id: 'a' }], active: 'zz', layout: 'odd', widths: { a: 'x' } }));
    expect(loadChat('i')).toEqual({ open: [c('a', 'p')], active: 'a', layout: 'one', widths: {} });
  });
});
