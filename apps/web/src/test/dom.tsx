// Helpers of the component tests (happy-dom): mount a component for real, type in a field, press a key.
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement }[] = [];

/** Renders into a new `#root` of the document (the dialogs make that element inert); `unmountAll()` after each test. */
export async function mount(node: ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(node); });
  mounted.push({ root, host });
  return host;
}

export async function unmountAll(): Promise<void> {
  for (const { root, host } of mounted) {
    await act(async () => { root.unmount(); });
    host.remove();
  }
  mounted = [];
}

/** Lets promises and effects settle. */
export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Types as a user does: React only sees a value set through the element's own setter, followed by `input`. */
export async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function press(el: Element | Window, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
}
