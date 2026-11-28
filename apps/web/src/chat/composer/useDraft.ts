// The composer's draft (chat/draft.ts): read when its key comes, written 400 ms after the last key stroke, when the
// composer goes and when the side chat's iframe is about to go.
import { useEffect, useRef } from 'react';
import { loadDraft, onFlush, saveDraft } from '../draft';

/** `latest`: the key and text of the last render (read by the cleanups and by a send that ends). */
export function useDraft(draftKey: string | undefined, text: string, setText: (text: string) => void) {
  // draft: read when the key comes (the session page may give another text just after: it wins), written 400 ms
  // after the last key stroke and when the composer goes
  const latest = useRef({ key: draftKey, text });
  latest.current = { key: draftKey, text };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setText` (a state setter) from the composer, stable: same dependencies as when this code was in chat/Composer.tsx
  useEffect(() => {
    if (draftKey) setText(loadDraft(draftKey));
    // only a text is saved here: before the loaded draft is rendered (StrictMode runs this twice), the text is still
    // empty and must not erase it; clearing goes through the timer below and the send
    return () => { const l = latest.current; if (l.key && l.text.trim()) saveDraft(l.key, l.text); };
  }, [draftKey]);
  // saved at once when the side chat's iframe is about to go (same rule as the cleanup above)
  useEffect(() => onFlush(() => { const l = latest.current; if (l.key && l.text.trim()) saveDraft(l.key, l.text); }), []);
  useEffect(() => {
    if (!draftKey) return;
    const id = setTimeout(() => saveDraft(draftKey, text), 400);
    return () => clearTimeout(id);
  }, [draftKey, text]);
  return latest;
}
