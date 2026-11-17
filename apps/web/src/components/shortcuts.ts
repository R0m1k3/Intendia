// One-key shortcuts of the layout, outside fields and without a window or a menu open. `e.key` is the character
// typed, so the layout does not matter: on AZERTY, « ? » and « / » need Shift and are still recognised.

export type Shortcut = 'help' | 'new' | 'focus';

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented' | 'isComposing'>;

/** « ? » → the shortcuts sheet, « n » → a new session, « / » → the message field (else the palette); null otherwise. */
export function shortcutOf(e: KeyLike, ctx: { editable: boolean; overlay: boolean }): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.isComposing || ctx.editable || ctx.overlay) return null;
  if (e.key === '?') return 'help';
  if (e.key === '/') return 'focus';
  if (e.key === 'n' && !e.shiftKey) return 'new';
  return null;
}

/** A field taking text: input, textarea, select or contenteditable. */
export function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** A window, a sheet or a menu is open (they carry `data-overlay`). */
export const overlayOpen = (): boolean => Boolean(document.querySelector('[data-overlay]'));
