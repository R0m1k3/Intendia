import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Prompt } from '../api';
import { ask, askText } from '../components/Dialog';
import { Popover } from '../components/Menu';
import { Button, cx, ErrorText } from '../components/ui';
import { Sheet, TEXTAREA } from '../kanban/Sheet';

const KEY = ['prompts', 'prompt'] as const;
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Saved prompts (button of the composer, and /prompt [titre]): pick one to insert it, save the text being written
 * as a prompt, or manage them (rename, edit, delete) in a side sheet. Shared by every instance.
 */
export function PromptPicker({ open, onOpenChange, filter, text, onInsert, disabled }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** start of a title typed after /prompt */
  filter: string;
  /** text being written: what « Enregistrer la saisie » saves */
  text: string;
  onInsert: (body: string) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: () => api.prompts('prompt'), enabled: open, staleTime: 0 });
  const [q, setQ] = useState(filter);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(filter); setError(null); } }, [open, filter]);

  const save = async (close: () => void) => {
    const title = await askText({ title: 'Enregistrer comme prompt', label: 'Titre', maxLength: 80, confirmLabel: 'Enregistrer', value: text.trim().split('\n')[0]!.slice(0, 60) });
    if (!title) return;
    try {
      await api.createPrompt({ title, body: text });
      await qc.invalidateQueries({ queryKey: KEY });
      close();
    } catch (err) {
      setError(err);
    }
  };

  const shown = (list.data?.prompts ?? []).filter((p) => !q.trim() || fold(p.title).includes(fold(q.trim())));
  return (
    <>
      <Popover
        title="Prompts" open={open} onOpenChange={onOpenChange} disabled={disabled} width={360}
        triggerClass="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 aria-expanded:bg-raised"
        trigger={<BookText className="size-4" strokeWidth={1.5} />}
      >
        {(close) => (
          <div data-prompts className="space-y-1">
            <PanelFocus target={input} />
            <input
              ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un prompt" aria-label="Chercher un prompt"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onInsert(shown[0].body); close(); }
              }}
              className="h-8 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm focus:border-accent focus:outline-none"
            />
            <div className="max-h-72 overflow-y-auto">
              {list.isPending && <p className="px-2.5 py-2 text-sm text-ink-faint">Chargement…</p>}
              {list.data && shown.length === 0 && (
                <p className="px-2.5 py-2 text-sm text-ink-faint">{list.data.prompts.length ? 'Aucun prompt de ce titre' : 'Aucun prompt enregistré'}</p>
              )}
              {shown.map((p) => (
                <button key={p.id} type="button" role="menuitem" data-prompt={p.title}
                  onClick={() => { onInsert(p.body); close(); }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-raised focus:bg-raised focus:outline-none">
                  <span className="block truncate text-sm">{p.title}</span>
                  <span className="block truncate text-[12px] text-ink-faint">{p.body.slice(0, 120)}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-line pt-1">
              <ErrorText error={error} />
              <button type="button" role="menuitem" disabled={!text.trim()} onClick={() => void save(close)}
                title={text.trim() ? undefined : 'Écrivez d’abord le texte à enregistrer'}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised focus:bg-raised focus:outline-none disabled:opacity-50">
                Enregistrer la saisie comme prompt
              </button>
              <button type="button" role="menuitem" onClick={() => { close(); setManaging(true); }}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised focus:bg-raised focus:outline-none">
                Gérer les prompts…
              </button>
            </div>
          </div>
        )}
      </Popover>
      {managing && <ManagePrompts onClose={() => setManaging(false)} />}
    </>
  );
}

/** The search field takes the focus once the panel has placed itself (the panel focuses its first item first). */
function PanelFocus({ target }: { target: React.RefObject<HTMLInputElement | null> }) {
  useEffect(() => {
    const id = requestAnimationFrame(() => target.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [target]);
  return null;
}

function ManagePrompts({ onClose }: { onClose: () => void }) {
  const list = useQuery({ queryKey: KEY, queryFn: () => api.prompts('prompt') });
  return (
    <Sheet title="Prompts enregistrés" onClose={onClose}>
      {list.isPending && <p className="text-sm text-ink-faint">Chargement…</p>}
      <ErrorText error={list.error} />
      {list.data?.prompts.length === 0 && (
        <p className="text-sm text-ink-soft">Aucun prompt. Écrivez un texte dans la saisie, puis « Prompts » › « Enregistrer la saisie comme prompt ».</p>
      )}
      {list.data?.prompts.map((p) => <PromptEditor key={`${p.id}:${p.updatedAt}`} prompt={p} />)}
    </Sheet>
  );
}

function PromptEditor({ prompt }: { prompt: Prompt }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(prompt.title);
  const [body, setBody] = useState(prompt.body);
  const changed = title.trim() !== prompt.title || body !== prompt.body;
  const save = useMutation({
    mutationFn: () => api.updatePrompt(prompt.id, { title, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePrompt(prompt.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <section data-prompt-editor={prompt.title} className="space-y-2 border-b border-line pb-5 last:border-0">
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Titre du prompt"
        className="h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm font-medium focus:border-accent focus:outline-none" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={20_000} aria-label="Texte du prompt" className={cx(TEXTAREA, 'resize-y')} />
      <ErrorText error={save.error ?? remove.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={remove.isPending}
          onClick={async () => { if (await ask({ title: 'Supprimer ce prompt ?', message: `« ${prompt.title} » sera supprimé.`, confirmLabel: 'Supprimer', danger: true })) remove.mutate(); }}>
          Supprimer
        </Button>
        <Button type="button" variant="primary" disabled={!changed || !title.trim() || !body.trim() || save.isPending} onClick={() => save.mutate()}>Enregistrer</Button>
      </div>
    </section>
  );
}
