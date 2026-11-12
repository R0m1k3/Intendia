// Text being written, kept by the browser (localStorage) so a reload, a crash or another page does not lose it.
// Text only: attachments are already in inbox/. Keys `intendia-draft:<inst>:<sessionId>`, home page `intendia-draft:home`.

const PREFIX = 'intendia-draft:';
export const DRAFT_MAX_AGE_MS = 30 * 24 * 3600_000;
export const homeDraftKey = `${PREFIX}home`;
export const sessionDraftKey = (inst: string, sessionId: string) => `${PREFIX}${inst}:${sessionId}`;

interface Saved { text: string; at: number }

function read(key: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null;
    return v && typeof v.text === 'string' && typeof v.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

function draftKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

export function loadDraft(key: string): string {
  return read(key)?.text ?? '';
}

/** An empty text removes the draft. Storage full: the oldest draft goes and the write is tried once more, then dropped. */
export function saveDraft(key: string, text: string, now = Date.now()): void {
  if (!text.trim()) { clearDraft(key); return; }
  const value = JSON.stringify({ text, at: now } satisfies Saved);
  try {
    localStorage.setItem(key, value);
  } catch {
    const oldest = draftKeys().filter((k) => k !== key).sort((a, b) => (read(a)?.at ?? 0) - (read(b)?.at ?? 0))[0];
    if (oldest) localStorage.removeItem(oldest);
    try { localStorage.setItem(key, value); } catch { /* the draft is not kept: nothing else to do */ }
  }
}

// Texts still waiting for their 400 ms save. The side chat's iframe can be removed at any moment (closed, expanded,
// another session) without its React tree being unmounted, so the page around it asks for an immediate save first.
const pending = new Set<() => void>();

/** Registers a save-now function; returns its removal. */
export function onFlush(save: () => void): () => void {
  pending.add(save);
  return () => { pending.delete(save); };
}

/** Saves every draft being written right now. */
export function flushDrafts(): void {
  for (const save of pending) save();
}

export function clearDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage off */ }
}

/** At start: drafts older than 30 days (or unreadable) go. */
export function pruneDrafts(now = Date.now()): void {
  try {
    for (const k of draftKeys()) {
      const v = read(k);
      if (!v || now - v.at > DRAFT_MAX_AGE_MS) localStorage.removeItem(k);
    }
  } catch { /* storage off */ }
}
