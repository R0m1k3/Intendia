// @vitest-environment happy-dom
import { act, createElement, useImperativeHandle, forwardRef, type Ref } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ask = vi.fn<(o: unknown) => Promise<boolean>>();
vi.mock('./Dialog', () => ({ ask: (o: unknown) => ask(o) }));

const { _resetDirty, confirmClose, isDirty, useDirtyGuard } = await import('./dirty');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handle = { release(): void };
const Guarded = forwardRef(function Guarded({ dirty }: { dirty: boolean }, ref: Ref<Handle>) {
  const g = useDirtyGuard(dirty);
  useImperativeHandle(ref, () => g);
  return null;
});

function mount(dirty: boolean) {
  const el = document.createElement('div');
  const root = createRoot(el);
  const ref: { current: Handle | null } = { current: null };
  const render = (d: boolean) => act(() => root.render(createElement(Guarded, { dirty: d, ref })));
  render(dirty);
  return { ref, render, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => { _resetDirty(); ask.mockReset(); });
afterEach(() => _resetDirty());

describe('dirty guard', () => {
  it('closes without a question when nothing is modified', async () => {
    const m = mount(false);
    const close = vi.fn();
    expect(await confirmClose(close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(ask).not.toHaveBeenCalled();
    m.unmount();
  });

  it('asks when a screen is modified; Discard clears the registry and closes', async () => {
    const m = mount(true);
    expect(isDirty()).toBe(true);
    ask.mockResolvedValueOnce(true);
    const close = vi.fn();
    expect(await confirmClose(close)).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(isDirty()).toBe(false);
    m.unmount();
  });

  it('Cancel keeps the screen open and still guarded', async () => {
    const m = mount(true);
    ask.mockResolvedValueOnce(false);
    const close = vi.fn();
    expect(await confirmClose(close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(isDirty()).toBe(true);
    m.unmount();
  });

  it('release() removes the guard at once, unmounting or a clean render too', async () => {
    const m = mount(true);
    m.ref.current!.release();
    expect(isDirty()).toBe(false);
    const close = vi.fn();
    await confirmClose(close);
    expect(ask).not.toHaveBeenCalled();
    m.render(false);
    m.render(true);
    expect(isDirty()).toBe(true);
    m.render(false);
    expect(isDirty()).toBe(false);
    m.render(true);
    m.unmount();
    expect(isDirty()).toBe(false);
  });

  it('several modified screens: one question', async () => {
    const a = mount(true);
    const b = mount(true);
    ask.mockResolvedValueOnce(true);
    await confirmClose(() => {});
    expect(ask).toHaveBeenCalledOnce();
    expect(isDirty()).toBe(false);
    a.unmount(); b.unmount();
  });
});
