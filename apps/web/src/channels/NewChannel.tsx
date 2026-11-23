// « Nouveau canal »: a name, its members (agents of every instance), its lead and its instructions.
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { AgentAvatar, useAgentLooks } from '../agents/look';
import { confirmClose } from '../components/dirty';
import { Button, cx, ErrorText, Field, Input } from '../components/ui';
import { Sheet } from '../kanban/Sheet';
import { t } from '../i18n';

const TEXTAREA = 'w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none';
const keyOf = (m: { instanceId: string; profile: string }) => `${m.instanceId}\n${m.profile}`;

function Face({ inst, name }: { inst: string; name: string }) {
  const looks = useAgentLooks(inst);
  return <AgentAvatar name={name} color={looks.color(name)} size={24} />;
}

export function NewChannel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const list = instances.data?.instances ?? [];
  const agents = useQueries({
    queries: list.map((i) => ({ queryKey: ['agents', i.id], queryFn: () => api.agents(i.id).then((r) => r.agents), staleTime: 60_000, retry: false })),
  });
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [picked, setPicked] = useState<{ instanceId: string; profile: string }[]>([]);
  const [lead, setLead] = useState<string | null>(null);
  const toggle = (m: { instanceId: string; profile: string }) => {
    const k = keyOf(m);
    setPicked((p) => (p.some((x) => keyOf(x) === k) ? p.filter((x) => keyOf(x) !== k) : [...p, m]));
    setLead((l) => (l === k ? null : l));
  };
  const leadKey = lead && picked.some((x) => keyOf(x) === lead) ? lead : picked[0] ? keyOf(picked[0]) : null;
  const create = useMutation({
    mutationFn: () => api.createChannel({ name: name.trim(), instructions, lead: Math.max(0, picked.findIndex((x) => keyOf(x) === leadKey)), members: picked }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['channels'] }); onCreated(r.channel.id); },
  });
  const ok = name.trim().length > 0 && picked.length > 0;
  return (
    <Sheet
      title={t('Nouveau canal')} width="md:w-[520px]" onClose={onClose} onSubmit={() => { if (ok) create.mutate(); }}
      footer={<>
        <Button type="button" onClick={() => void confirmClose(onClose)}>{t('Annuler')}</Button>
        <Button type="submit" variant="primary" disabled={!ok || create.isPending}>{create.isPending ? t('Création…') : t('Créer le canal')}</Button>
      </>}
    >
      <Field label={t('Nom')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('Catalogue de Noël')} autoFocus />
      </Field>
      <Field label={t('Membres')} hint={t('Des agents d’une ou de plusieurs instances ; chacun travaille dans une session cachée de ce canal')}>
        <div className="flex flex-col gap-3" data-channel-members>
          {list.map((i, n) => (
            <div key={i.id}>
              {list.length > 1 && <p className="mb-1 text-xs text-ink-faint">{i.label}</p>}
              <ul className="flex flex-col gap-0.5">
                {(agents[n]?.data ?? []).map((a) => {
                  const m = { instanceId: i.id, profile: a.name };
                  const on = picked.some((x) => keyOf(x) === keyOf(m));
                  return (
                    <li key={a.name}>
                      <label className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-paper', on && 'bg-paper')}>
                        <input type="checkbox" checked={on} onChange={() => toggle(m)} className="accent-[var(--color-accent)]" />
                        <Face inst={i.id} name={a.name} />
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        {on && (
                          <button type="button" onClick={(e) => { e.preventDefault(); setLead(keyOf(m)); }} aria-pressed={leadKey === keyOf(m)}
                            className={cx('rounded-md px-1.5 py-0.5 text-xs', leadKey === keyOf(m) ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-faint hover:text-ink')}>
                            {leadKey === keyOf(m) ? t('Chef') : t('Nommer chef')}
                          </button>
                        )}
                      </label>
                    </li>
                  );
                })}
                {agents[n]?.isPending && <li className="px-2 py-1 text-xs text-ink-faint">{t('Chargement…')}</li>}
              </ul>
            </div>
          ))}
        </div>
      </Field>
      <Field label={t('Consignes')} hint={t('Données à chaque membre avec les messages du canal')}>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={4} className={TEXTAREA}
          placeholder={t('Le chef répartit le travail ; chacun répond court.')} />
      </Field>
      <ErrorText error={create.error} />
    </Sheet>
  );
}
