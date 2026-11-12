import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, DRAFT_MAX_AGE_MS, loadDraft, pruneDrafts, saveDraft, sessionDraftKey } from './draft';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

afterEach(() => { storage.clear(); vi.restoreAllMocks(); });

describe('drafts', () => {
  it('saved, read, cleared; an empty text removes it', () => {
    const k = sessionDraftKey('i', 's');
    saveDraft(k, 'Bonjour');
    expect(loadDraft(k)).toBe('Bonjour');
    saveDraft(k, '  ');
    expect(loadDraft(k)).toBe('');
    saveDraft(k, 'x');
    clearDraft(k);
    expect(localStorage.getItem(k)).toBeNull();
  });

  it('drafts older than 30 days and unreadable ones are pruned, other keys kept', () => {
    const now = Date.now();
    saveDraft('intendia-draft:a', 'vieux', now - DRAFT_MAX_AGE_MS - 1);
    saveDraft('intendia-draft:b', 'récent', now - 1000);
    localStorage.setItem('intendia-draft:c', '{pas du json');
    localStorage.setItem('autre', 'x');
    pruneDrafts(now);
    expect(loadDraft('intendia-draft:a')).toBe('');
    expect(loadDraft('intendia-draft:b')).toBe('récent');
    expect(localStorage.getItem('intendia-draft:c')).toBeNull();
    expect(localStorage.getItem('autre')).toBe('x');
  });

  it('storage full: the oldest draft goes and the write is tried once more', () => {
    saveDraft('intendia-draft:old', 'a', 1);
    saveDraft('intendia-draft:new', 'b', 2);
    const real = storage.setItem.bind(storage);
    let fail = 1;
    vi.spyOn(storage, 'setItem').mockImplementation((k: string, v: string) => {
      if (fail-- > 0) throw new Error('QuotaExceededError');
      real(k, v);
    });
    saveDraft('intendia-draft:x', 'c', 3);
    expect(loadDraft('intendia-draft:x')).toBe('c');
    expect(loadDraft('intendia-draft:old')).toBe('');
    expect(loadDraft('intendia-draft:new')).toBe('b');
    fail = 5;
    expect(() => saveDraft('intendia-draft:y', 'd', 4)).not.toThrow();
  });
});
