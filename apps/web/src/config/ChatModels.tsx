import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, type ConfigModels } from '../api';
import { Button, ErrorText, Input, Section } from '../components/ui';
import { candidates, move, offered } from './chat-models-edit';
import { ICON } from './common';

const NO_KEY = 'Intendia n’a pas de clé pour cet agent : pas de chat, pas de liste.';

/**
 * "Modèles du chat": the models offered in the chat's picker for this agent, kept by Intendia (Hermes has no list of
 * favourites). The saved list is read without calling Hermes; the catalogue is the one the tab already loaded.
 */
export function ChatModels({ inst, profile, providers }: { inst: string; profile: string; providers: ConfigModels['providers'] }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['chat-models-saved', inst, profile], queryFn: () => api.savedChatModels(inst, profile), retry: false });
  const [q, setQ] = useState('');
  const save = useMutation({
    mutationFn: (models: string[]) => api.setChatModels(inst, profile, models),
    onSuccess: (res) => {
      qc.setQueryData(['chat-models-saved', inst, profile], res);
      void qc.invalidateQueries({ queryKey: ['chat-models', inst, profile] });
    },
  });
  const catalog = offered(providers);
  const available = new Set(catalog);

  const body = () => {
    if (saved.isPending) return <p className="text-sm text-ink-soft">Lecture de la liste…</p>;
    if (saved.isError) return saved.error instanceof ApiError && saved.error.status === 400
      ? <p className="text-sm text-ink-soft">{NO_KEY}</p>
      : <ErrorText error={saved.error} />;
    const list = save.isPending && save.variables ? save.variables : saved.data.models;
    const busy = save.isPending;
    const found = q.trim() ? candidates(catalog, list, q) : [];
    return (
      <div className="card p-5">
        {list.length === 0
          ? <p className="text-sm text-ink-soft">Aucun modèle : le chat propose seulement « Auto », le modèle de l’agent.</p>
          : (
            <ul className="divide-y divide-line" data-chat-models>
              {list.map((m, i) => (
                <li key={m} className="flex items-center gap-2 py-1.5" data-chat-model={m}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{m}</span>
                  {!available.has(m) && <span className="text-xs text-warn">indisponible</span>}
                  <Button variant="ghost" className="h-7 px-1.5" disabled={busy || i === 0} aria-label={`Monter ${m}`} title="Monter" onClick={() => save.mutate(move(list, i, -1))}>
                    <ArrowUp className={ICON} strokeWidth={1.5} />
                  </Button>
                  <Button variant="ghost" className="h-7 px-1.5" disabled={busy || i === list.length - 1} aria-label={`Descendre ${m}`} title="Descendre" onClick={() => save.mutate(move(list, i, 1))}>
                    <ArrowDown className={ICON} strokeWidth={1.5} />
                  </Button>
                  <Button variant="ghost" className="h-7 px-1.5" disabled={busy} aria-label={`Retirer ${m}`} title="Retirer" onClick={() => save.mutate(list.filter((x) => x !== m))}>
                    <X className={ICON} strokeWidth={1.5} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
          <Input className="pl-8" placeholder={catalog.length ? 'Ajouter un modèle (chercher)' : 'Aucun modèle proposé : ajoutez la clé d’un fournisseur'}
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ajouter un modèle" disabled={busy || !catalog.length || list.length >= 50} />
        </div>
        {found.length > 0 && (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line" data-chat-model-candidates>
            {found.map((m) => (
              <li key={m}>
                <button type="button" disabled={busy} onClick={() => { save.mutate([...list, m]); setQ(''); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12.5px] hover:bg-raised focus:bg-raised focus:outline-none disabled:opacity-50">
                  <Plus className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />{m}
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim() && found.length === 0 && <p className="mt-2 text-xs text-ink-faint">Aucun modèle proposé ne correspond.</p>}
        {save.isError && <p className="mt-3 text-sm text-bad"><ErrorText error={save.error} /></p>}
      </div>
    );
  };

  return (
    <Section title="Modèles du chat" description="Les modèles proposés dans le chat pour cet agent, dans cet ordre. « Auto » (le modèle principal) est toujours proposé. Liste gardée par Intendia.">
      {body()}
    </Section>
  );
}
