import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Maximize2, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { embedUrl, flushFrame, forgetSideSession, setSideSession, sideSession, TOGGLE, type SideSession } from '../chat/embed';
import { shortcutLabel } from './CommandPalette';
import { Button } from './ui';

interface Ws { slug: string; name: string }

/**
 * Side chat (⌘J): a session of the current instance in an iframe of the app (`?embed=1`), next to the page being
 * read. Shows the last session opened, else a new one in the last workspace used.
 */
export function SideChat({ inst, workspaces, onClose }: { inst: string; workspaces: Ws[]; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [shown, setShown] = useState<SideSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);
  const known = (slug: string) => workspaces.some((w) => w.slug === slug);

  /** Workspace of the session in the frame, else the last one used, else the first. */
  const currentSlug = (): string | null => {
    const m = /^\/w\/([^/]+)\/s\//.exec(frameLocation()?.pathname ?? '');
    const inFrame = m ? decodeURIComponent(m[1]!) : null;
    if (inFrame && known(inFrame)) return inFrame;
    const last = localStorage.getItem('intendia-last-workspace');
    if (last && known(last)) return last;
    return workspaces[0]?.slug ?? null;
  };

  const frameLocation = (): Location | null => {
    try { return frame.current?.contentWindow?.location ?? null; } catch { return null; }
  };

  const startNew = async () => {
    const slug = currentSlug();
    if (!slug || creating.current) return;
    creating.current = true;
    setError(null);
    flushFrame(frame.current);
    try {
      const { session } = await api.createSession(slug);
      const s = { slug, id: session.id };
      setSideSession(inst, s);
      setShown(s);
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      creating.current = false;
    }
  };

  // first opening for this instance (or its stored session's workspace is gone): a new session
  const ready = workspaces.length > 0;
  useEffect(() => {
    if (!ready) return;
    const stored = sideSession(inst);
    if (!stored || !known(stored.slug)) { void startNew(); return; }
    // deleted elsewhere (Sessions page, workspace list): forgotten, a new one instead
    let live = true;
    api.session(inst, stored.id).then(
      () => { if (live) setShown(stored); },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) { forgetSideSession(inst, stored.id); void startNew(); }
        else setShown(stored);
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst, ready]);

  // closed, expanded or another instance: the frame's draft is saved before React removes it (layout cleanup runs
  // before the DOM node goes; the frame's own React tree is never unmounted)
  useLayoutEffect(() => () => flushFrame(frame.current), []);

  // ⌘J pressed inside the frame closes the panel
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: string } | null)?.type === TOGGLE) onClose();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onClose]);

  const expand = () => {
    const path = frameLocation()?.pathname ?? (shown ? embedUrl(shown).split('?')[0]! : null);
    if (path) router.history.push(path); // a session opened full size closes the panel (Layout)
  };

  return (
    <aside aria-label="Chat latéral"
      className="fixed inset-0 z-[60] flex flex-col bg-sheet md:static md:z-auto md:m-2 md:ml-0 md:h-[var(--card-h)] md:w-[420px] md:shrink-0 md:overflow-hidden md:rounded-[14px] md:border md:border-line md:shadow-[var(--shadow-card)]">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-4 pr-2">
        <p className="flex-1 text-sm font-medium">Chat</p>
        <Button variant="ghost" className="size-8 px-0" aria-label="Nouvelle session" title="Nouvelle session" disabled={!ready} onClick={() => void startNew()}>
          <Plus className="size-4" strokeWidth={1.5} />
        </Button>
        <Button variant="ghost" className="size-8 px-0" aria-label="Ouvrir en grand" title="Ouvrir en grand" disabled={!shown} onClick={expand}>
          <Maximize2 className="size-4" strokeWidth={1.5} />
        </Button>
        <Button variant="ghost" className="size-8 px-0" aria-label="Fermer le chat" title={`Fermer (${shortcutLabel().replace('K', 'J')})`} onClick={onClose}>
          <X className="size-4" strokeWidth={1.5} />
        </Button>
      </div>
      {!ready ? (
        <p className="p-6 text-sm text-ink-soft">Créez d’abord un workspace sur cette instance.</p>
      ) : error ? (
        <p className="p-6 text-sm text-bad">{error}</p>
      ) : shown ? (
        <iframe ref={frame} key={shown.id} src={embedUrl(shown)} title="Session du chat latéral"
          className="min-h-0 w-full flex-1 border-0" onLoad={() => frame.current?.contentWindow?.focus()} />
      ) : null}
    </aside>
  );
}
