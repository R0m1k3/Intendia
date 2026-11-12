import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Folder } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, rawUrl, type Workspace } from '../api';
import { Composer, type ComposerHandle, type ExtractArchive, type Upload } from '../chat/Composer';
import { homeDraftKey } from '../chat/draft';
import { useChatAvailability } from '../components/ChatNotice';
import { Picker } from '../components/Menu';
import { ErrorText } from '../components/ui';
import { uploadFiles } from '../files/upload';
import { invalidateSessionLists } from '../sessions/UndoBar';
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
      void invalidateSessionLists(qc);
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      const res = await api.send(ws.instanceId, session.id, text);
      setHandoff({ inst: ws.instanceId, sessionId: session.id, runId: res.runId, text, ts: Date.now() / 1000 });
      localStorage.setItem(LAST, ws.slug);
      void qc.invalidateQueries({ queryKey: ['sessions-recent'] });
      void qc.invalidateQueries({ queryKey: ['sessions-list'] });
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug: ws.slug, sessionId: session.id } });
      return true;
    } catch (err) {
      // the text stays in the box; an empty session may remain (listed like any session)
      setError(err);
      return false;
    }
  };

  const upload = useCallback<Upload>(async (file) => {
    const [done] = await uploadFiles(slug, 'inbox', [file]);
    return { agentPath: done!.agentPath, url: rawUrl(slug, done!.path), path: done!.path };
  }, [slug]);
  const extract = useCallback<ExtractArchive>((path) => api.extractArchive(slug, path), [slug]);
  // the files are already in this workspace's inbox/: the workspace stays while there are attachments
  const [attached, setAttached] = useState(0);

  return (
    <div className="space-y-2">
      <Composer
        ref={composer}
        onSend={send}
        onStop={() => {}}
        running={false}
        disabled={!chat.available}
        upload={upload}
        extract={extract}
        prompts
        draftKey={homeDraftKey}
        onAttachmentsChange={setAttached}
        placeholder="Demander quelque chose à Hermes…"
        hint="Entrée pour envoyer · une nouvelle session est créée"
        leading={(
          <Picker
            title="Workspace de la nouvelle session" placement="below" value={ws.slug} disabled={attached > 0}
            items={workspaces.map((w) => ({ value: w.slug, label: w.name, hint: w.profile && w.profile !== 'default' ? `agent ${w.profile}` : undefined }))}
            onPick={(v) => v && setSlug(v)}
            triggerClass="flex h-7 max-w-[12rem] min-w-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper hover:text-ink aria-expanded:bg-paper"
            label={<span className="flex min-w-0 items-center gap-1.5"><Folder className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} /><span className="truncate">{ws.name}</span></span>}
          />
        )}
      />
      {attached > 0 && workspaces.length > 1 && <p className="text-xs text-ink-faint">Retirez les pièces jointes pour changer de workspace</p>}
      {!chat.available && <p className="text-xs text-ink-faint">Le chat n’est pas disponible sur l’instance de ce workspace</p>}
      <ErrorText error={error} />
    </div>
  );
}
