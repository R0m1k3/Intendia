import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { __resetToasts, __toasts, dismissToast, toast, toastError } from './Toast';

describe('toast', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetToasts(); });
  afterEach(() => vi.useRealTimers());
  it('shows a confirmation, then removes it by itself', () => {
    toast('Enregistré');
    expect(__toasts().map((x) => [x.text, x.kind])).toEqual([['Enregistré', 'ok']]);
    vi.advanceTimersByTime(3600);
    expect(__toasts()).toEqual([]);
  });
  it('does not repeat the same text; keeps 3 at most', () => {
    toast('Copié'); toast('Copié');
    expect(__toasts()).toHaveLength(1);
    toast('a'); toast('b'); toast('c');
    expect(__toasts().map((x) => x.text)).toEqual(['a', 'b', 'c']);
  });
  it('explains a failure and leaves it longer', () => {
    const id = toastError(new ApiError(0, 'Serveur Intendia injoignable', { code: 'network' }));
    expect(__toasts()[0]).toMatchObject({ text: 'Intendia ne répond pas', kind: 'bad' });
    expect(__toasts()[0]!.sub).toContain('connexion');
    vi.advanceTimersByTime(5000);
    expect(__toasts()).toHaveLength(1);
    dismissToast(id);
    expect(__toasts()).toEqual([]);
  });
});
