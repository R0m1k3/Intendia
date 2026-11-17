// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
function open(title: string, onClose: () => void) {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  act(() => root.render(createElement(Sheet, { title, onClose, children: 'x' })));
  return root;
}
const escape = () => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  act(() => { window.dispatchEvent(e); });
  return e;
};
const flush = () => act(async () => { await Promise.resolve(); });

afterEach(() => { for (const r of roots.splice(0)) act(() => r.unmount()); });

describe('Sheet', () => {
  it('Escape closes the top sheet only, and marks the event handled', async () => {
    const below = vi.fn();
    const top = vi.fn();
    open('A', below);
    const r = open('B', top);
    const e = escape();
    await flush();
    expect(top).toHaveBeenCalledOnce();
    expect(below).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    act(() => r.unmount());
    roots.splice(roots.indexOf(r), 1);
    escape();
    await flush();
    expect(below).toHaveBeenCalledOnce();
  });

  it('ignores an Escape already handled (a menu inside)', async () => {
    const close = vi.fn();
    open('A', close);
    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    e.preventDefault();
    act(() => { window.dispatchEvent(e); });
    await flush();
    expect(close).not.toHaveBeenCalled();
  });

  it('a mouse down on the backdrop closes, one inside the panel does not', async () => {
    const close = vi.fn();
    open('A', close);
    const overlay = document.querySelector<HTMLElement>('[data-overlay]')!;
    act(() => { overlay.querySelector('[role="dialog"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await flush();
    expect(close).not.toHaveBeenCalled();
    act(() => { overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await flush();
    expect(close).toHaveBeenCalledOnce();
  });
});
