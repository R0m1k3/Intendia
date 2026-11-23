// « Question annexe » tab of the session's side panel (OpenBot-like side question): a second session with the same
// agent, in the same folder, shown in a frame (`?embed=1`) so a quick question does not go into the main thread.
// The side session of each main session is kept in this browser (`intendia-aside:<id>`).

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Maximize2, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { Button } from '../components/ui';
import { t } from '../i18n';
import { invalidateSessionLists } from '../sessions/UndoBar';
import { embedUrl, flushFrame, type SideSession } from './embed';

const key = (id: string) => `intendia-aside:${id}`;

function stored(id: string): SideSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) ?? 'null') as Partial<SideSession> | null;
    return v && typeof v.slug === 'string' && typeof v.id === 'string' ? { slug: v.slug, id: v.id } : null;
  } catch { return null; }
}

export function AsideQuestion({ inst, slug, parentId, profile }: { inst: string; slug: string; parentId: string; profile: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [shown, setShown] = useState<SideSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);

  const startNew = async () => {
    if (creating.current) return;
    creating.current = true;
    setError(null);
    flushFrame(frame.current);
    try {
      const { session } = await api.createSession(slug);
      // the same agent as the main session, even in another agent's folder
      await api.updateSession(inst, session.id, { profile });
      const s = { slug, id: session.id };
      localStorage.setItem(key(parentId), JSON.stringify(s));
      setShown(s);
      void invalidateSessionLists(qc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      creating.current = false;
    }
  };

  useEffect(() => {
    const s = stored(parentId);
    if (!s) { void startNew(); return; }
    let live = true;
    api.session(inst, s.id).then(
      () => { if (live) setShown(s); },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) { localStorage.removeItem(key(parentId)); void startNew(); } else setShown(s);
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst, parentId]);

  useLayoutEffect(() => () => flushFrame(frame.current), []);

  return (
    <div data-aside-question className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 pl-4 pr-2">
        <p className="flex-1 text-[12.5px] text-ink-faint">{t('À côté du fil, avec le même agent')}</p>
        <Button variant="ghost" className="size-8 px-0" aria-label={t('Nouvelle question')} title={t('Nouvelle question')} onClick={() => void startNew()}>
          <Plus className="size-4" strokeWidth={1.5} />
        </Button>
        <Button variant="ghost" className="size-8 px-0" aria-label={t('Ouvrir en grand')} title={t('Ouvrir en grand')} disabled={!shown}
          onClick={() => { if (shown) router.history.push(embedUrl(shown).split('?')[0]!); }}>
          <Maximize2 className="size-4" strokeWidth={1.5} />
        </Button>
      </div>
      {error ? <p className="p-6 text-sm text-bad">{error}</p> : shown ? (
        <iframe ref={frame} key={shown.id} src={embedUrl(shown)} title={t('Question annexe')} className="min-h-0 w-full flex-1 border-0" />
      ) : null}
    </div>
  );
}
