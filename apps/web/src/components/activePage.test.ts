// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActivePage, subscribeActivePage, useActivePage, type ActivePage } from './activePage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = (title: string): ActivePage => ({ title, actions: [] });
function Pub({ p }: { p: ActivePage | null }) {
  useActivePage(p);
  return null;
}
const roots: Root[] = [];
function mount(p: ActivePage | null): Root {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  act(() => root.render(createElement(Pub, { p })));
  return root;
}
afterEach(() => { for (const r of roots.splice(0)) act(() => r.unmount()); });

describe('active page registry', () => {
  it('the last one published wins', () => {
    const a = page('A');
    const b = page('B');
    mount(a);
    mount(b);
    expect(getActivePage()).toBe(b);
  });

  it('unmounting the first one keeps the second', () => {
    const a = page('A');
    const b = page('B');
    const ra = mount(a);
    mount(b);
    act(() => ra.unmount());
    expect(getActivePage()).toBe(b);
  });

  it('unmounting the last one empties the registry', () => {
    const r = mount(page('A'));
    act(() => r.unmount());
    expect(getActivePage()).toBeNull();
  });

  it('a new page of the same component replaces the old one; null publishes nothing', () => {
    const r = mount(page('A'));
    const b = page('B');
    act(() => r.render(createElement(Pub, { p: b })));
    expect(getActivePage()).toBe(b);
    act(() => r.render(createElement(Pub, { p: null })));
    expect(getActivePage()).toBeNull();
  });

  it('a subscriber hears each change', () => {
    const heard = vi.fn();
    const off = subscribeActivePage(heard);
    const r = mount(page('A'));
    act(() => r.unmount());
    off();
    mount(page('B'));
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
