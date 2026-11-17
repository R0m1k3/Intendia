import { describe, expect, it } from 'vitest';
import { isEditable, shortcutOf } from './shortcuts';

const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, ...over,
});
const free = { editable: false, overlay: false };

describe('shortcutOf', () => {
  it('?, n and /', () => {
    expect(shortcutOf(key('?'), free)).toBe('help');
    expect(shortcutOf(key('n'), free)).toBe('new');
    expect(shortcutOf(key('/'), free)).toBe('focus');
  });
  it('AZERTY: ? and / come with Shift; Shift+N is not n', () => {
    expect(shortcutOf(key('/', { shiftKey: true }), free)).toBe('focus');
    expect(shortcutOf(key('?', { shiftKey: true }), free)).toBe('help');
    expect(shortcutOf(key('N', { shiftKey: true }), free)).toBeNull();
    expect(shortcutOf(key('n', { shiftKey: true }), free)).toBeNull();
  });
  it('nothing with Ctrl, Meta or Alt', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(shortcutOf(key('n', { [mod]: true }), free)).toBeNull();
      expect(shortcutOf(key('/', { [mod]: true }), free)).toBeNull();
    }
  });
  it('nothing in a field, with a window open, when handled already or while composing', () => {
    expect(shortcutOf(key('?'), { editable: true, overlay: false })).toBeNull();
    expect(shortcutOf(key('n'), { editable: false, overlay: true })).toBeNull();
    expect(shortcutOf(key('/', { defaultPrevented: true }), free)).toBeNull();
    expect(shortcutOf(key('n', { isComposing: true }), free)).toBeNull();
  });
  it('Escape and other keys: nothing', () => {
    expect(shortcutOf(key('Escape'), free)).toBeNull();
    expect(shortcutOf(key('k'), free)).toBeNull();
  });
});

describe('isEditable', () => {
  it('fields and contenteditable', () => {
    expect(isEditable({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
