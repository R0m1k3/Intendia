import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Workspace } from '../api';
import { Composer, type ComposerHandle } from '../chat/Composer';
import { useChatAvailability } from '../components/ChatNotice';
import { Picker } from '../components/Menu';
import { ErrorText } from '../components/ui';
import { uploadFiles } from '../files/upload';
import { setHandoff } from './handoff';

const LAST = 'intendia-last-workspace';

/**
 * "Demander quelque chose à Hermes…": creates a session in the chosen workspace, sends the message and opens the
 * session page, which follows the run (it plugs into a run in progress; the message is handed over to show at once).
 * The session starts from the workspace's last model choice. `focus` puts the cursor in it ("Nouvelle session").
 */
export function Ask({ workspaces, focus, onFocused }: { workspaces: Workspace[]; focus?: boolean; onFocused?: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const composer = useRef<ComposerHandle>(null);
  const [slug, setSlug] = useState(() => {
    const last = localStorage.getItem(LAST);
    return workspaces.some((w) => w.slug === last) ? last! : workspaces[0]!.slug;
  });
  const ws = workspaces.find((w) => w.slug === slug) ?? workspaces[0]!;
  const chat = useChatAvailability(ws.instanceId);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!focus) return;
    composer.current?.focus();
    onFocused?.();
  }, [focus, onFocused]);

  const send = async (text: string): Promise<boolean> => {
    setError(null);
    try {
      const { session } = await api.createSession(ws.slug);
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      const res = await api.send(ws.instanceId, session.id, text);
      setHandoff({ inst: ws.instanceId, sessionId: session.id, runId: res.runId, text, ts: Date.now() / 1000 });
      localStorage.setItem(LAST, ws.slug);
      void qc.invalidateQueries({ queryKey: ['sessions-recent'] });
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug: ws.slug, sessionId: session.id } });
      return true;
    } catch (err) {
      // the text stays in the box; an empty session may remain (listed like any session)
      setError(err);
      return false;
    }
  };

  const attach = async (files: File[]) => {
    setError(null);
    try {
      const done = await uploadFiles(ws.slug, 'inbox', files);
      composer.current?.append(done.map((d) => d.agentPath));
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-2">
      <Composer
        ref={composer}
        onSend={send}
        onStop={() => {}}
        running={false}
        disabled={!chat.available}
        onAttach={(f) => void attach(f)}
        placeholder="Demander quelque chose à Hermes…"
        hint="Entrée pour envoyer · une nouvelle session est créée"
        leading={(
          <Picker
            title="Workspace de la nouvelle session" placement="below" value={ws.slug}
            items={workspaces.map((w) => ({ value: w.slug, label: w.name, hint: w.profile && w.profile !== 'default' ? `agent ${w.profile}` : undefined }))}
            onPick={(v) => v && setSlug(v)}
            triggerClass="flex h-8 max-w-[12rem] min-w-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-ink transition-colors hover:bg-raised aria-expanded:bg-raised"
            label={<span className="flex min-w-0 items-center gap-1.5"><Folder className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} /><span className="truncate">{ws.name}</span></span>}
          />
        )}
      />
      {!chat.available && <p className="text-xs text-ink-faint">Le chat n’est pas disponible sur l’instance de ce workspace</p>}
      <ErrorText error={error} />
    </div>
  );
}
