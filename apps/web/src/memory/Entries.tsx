import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type MemoryEntry, type MemoryOverview, type MemorySource } from '../api';
import { ask } from '../components/Dialog';
import { DetailBody, DetailHeader, Facts, ListItemBody, ListLink } from '../components/Panes';
import { Button, cx, ErrorText, Tag } from '../components/ui';
import { usageLabel, usagePercent } from './usage';
import { locale, t } from '../i18n';

const ICON = 'size-4';
export const SOURCE_LABEL: Record<MemorySource, string> = { memory: t('Notes de l’agent'), profile: t('Profil utilisateur') };
const SOURCE_FILE: Record<MemorySource, string> = { memory: 'MEMORY.md', profile: 'USER.md' };

const codeOf = (e: unknown) => (e instanceof ApiError ? (e.data as { code?: string } | undefined)?.code : undefined);
const dateFr = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : null);
/** `memory:<source>:<index>` of an id: an edited entry keeps it, its fingerprint changes. */
export const slotOf = (id: string) => id.split(':').slice(0, 3).join(':');

export type EntryLink = (id: string) => { to: '/i/$inst/memoire'; params: { inst: string }; search: Record<string, string | undefined> };

function Gauge({ source, overview }: { source: MemorySource; overview: MemoryOverview }) {
  const u = source === 'memory' ? overview.usage.memory : overview.usage.user;
  const pct = usagePercent(u);
  return (
    <div className="px-3.5 pb-1.5 pt-4" data-usage={source}>
      <p className="truncate text-xs text-ink-faint">{SOURCE_LABEL[source]} <span className="font-mono">· {SOURCE_FILE[source]}</span></p>
      {pct !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-label={t('{source} : {usage}', { source: SOURCE_LABEL[source], usage: usageLabel(u) })}>
          <div className={cx('h-full rounded-full', pct >= 90 ? 'bg-warn' : 'bg-ink-faint/60')} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
      <p className={cx('mt-1 text-[11px] tabular-nums', pct !== null && pct >= 90 ? 'text-warn' : 'text-ink-faint')}>{usageLabel(u)}</p>
    </div>
  );
}

/** The two files' entries, each under its fill gauge. */
export function EntryList({ overview, selected, link }: { overview: MemoryOverview; selected: string | undefined; link: EntryLink }) {
  return (
    <>
      {(['memory', 'profile'] as MemorySource[]).map((source) => {
        const list = overview.entries.filter((e) => e.source === source);
        return (
          <section key={source} aria-label={SOURCE_LABEL[source]}>
            <Gauge source={source} overview={overview} />
            {list.length === 0 && <p className="px-3.5 py-3 text-sm text-ink-faint">{t('Aucune entrée')}</p>}
            <ul className="flex flex-col gap-0.5">
              {list.map((e) => (
                <li key={e.id} data-entry={e.id}>
                  <ListLink link={link(e.id)} selected={selected === e.id}>
                    <ListItemBody title={e.title || t('(sans titre)')} sub={e.excerpt.split('\n').slice(1).join(' ').trim() || undefined} />
                  </ListLink>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** One entry: its full text (masked), edit as plain text, delete. A changed entry ("stale") reloads the list. */
export function EntryDetail({ inst, profile, entry, canEdit, canDelete, onSaved, onDeleted, onSkill, back }: {
  inst: string; profile: string; entry: MemoryEntry; canEdit: boolean; canDelete: boolean;
  /** The new id of the edited entry, when the list read again still has its slot. */
  onSaved: (id: string | null) => void; onDeleted: () => void; onSkill: (name: string) => void;
  back: { to: '/i/$inst/memoire'; params: { inst: string }; search: Record<string, string | undefined> };
}) {
  const qc = useQueryClient();
  const content = useQuery({ queryKey: ['memory-entry', inst, profile, entry.id], queryFn: () => api.memoryEntry(inst, profile, entry.id), retry: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => {
    const fresh = await qc.fetchQuery({ queryKey: ['memory', inst, profile], queryFn: () => api.memory(inst, profile), staleTime: 0 });
    return fresh;
  };
  const onError = async (e: unknown) => {
    if (codeOf(e) !== 'stale') return;
    setDraft(null);
    setNotice(t('L’entrée a changé depuis la lecture de la liste (l’agent l’a peut-être modifiée) : la liste est rechargée.'));
    await reload();
  };
  const save = useMutation({
    mutationFn: (d: string) => api.putMemoryEntry(inst, profile, entry.id, d),
    onSuccess: async () => {
      setDraft(null);
      const fresh = await reload();
      onSaved(fresh.entries.find((e) => slotOf(e.id) === slotOf(entry.id))?.id ?? null);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteMemoryEntry(inst, profile, entry.id),
    onSuccess: async () => { await reload(); onDeleted(); },
    onError,
  });
  const stale = codeOf(content.error) === 'stale';
  // the entry changed between the list and its opening: read the list again, its new id replaces the old one
  useEffect(() => {
    if (!stale) return;
    void reload().then((fresh) => {
      const id = fresh.entries.find((e) => slotOf(e.id) === slotOf(entry.id))?.id;
      if (id && id !== entry.id) onSaved(id);
    }, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, entry.id]);
  const busy = save.isPending || remove.isPending;

  return (
    <article aria-label={entry.title || t('Entrée')} data-entry-detail={entry.id}>
      <DetailHeader
        title={entry.title || t('(sans titre)')} sub={`${SOURCE_LABEL[entry.source]} · ${SOURCE_FILE[entry.source]}`} back={back}
        actions={(
          <>
            {canEdit && draft === null && content.data && (
              <Button onClick={() => { setNotice(null); setDraft(content.data.content); }} disabled={busy}><Pencil className={ICON} strokeWidth={1.5} />{t('Modifier')}</Button>
            )}
            {canDelete && (
              <Button variant="danger" disabled={busy || stale} aria-label={t('Supprimer l’entrée')}
                onClick={async () => {
                  setNotice(null);
                  if (await ask({
                    title: t('Supprimer cette entrée ?'), danger: true, confirmLabel: t('Supprimer'),
                    message: t('Elle est retirée de {file} ; l’agent ne s’en souviendra plus. Hermes n’en garde pas de copie.', { file: SOURCE_FILE[entry.source] }),
                  })) remove.mutate();
                }}>
                <Trash2 className={ICON} strokeWidth={1.5} />{t('Supprimer')}
              </Button>
            )}
          </>
        )}
      />
      <DetailBody className="gap-4">
        {notice && <p role="alert" className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{notice}</p>}
        {!notice && stale && (
          <p role="alert" className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{t('Cette entrée a changé depuis la lecture de la liste : la liste est rechargée, choisissez-la de nouveau si elle ne s’ouvre pas.')}</p>
        )}
        <div className="empty:hidden">{!stale && <ErrorText error={content.error ?? (codeOf(save.error ?? remove.error) === 'stale' ? null : save.error ?? remove.error)} />}</div>
        {draft !== null ? (
          <section className="space-y-2" aria-label={t('Modifier l’entrée')}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(18, Math.max(6, draft.split('\n').length + 2))} maxLength={20_000}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 font-mono text-[13px] leading-[1.6] focus:border-ink focus:outline-none" aria-label={t('Texte de l’entrée')} />
            <p className="text-xs text-ink-faint">{t('Laissez les «secret:…» tels quels : Intendia remet leur valeur à l’enregistrement. Hermes refuse un texte qui dépasse la limite du fichier.')}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setDraft(null); save.reset(); }}>{t('Annuler')}</Button>
              <Button variant="primary" disabled={save.isPending || !draft.trim()} onClick={() => save.mutate(draft)}>{save.isPending ? t('Enregistrement…') : t('Enregistrer')}</Button>
            </div>
          </section>
        ) : content.data ? (
          <pre className="whitespace-pre-wrap break-words rounded-[10px] bg-paper px-4 py-3.5 font-mono text-[13px] leading-[1.7]">{content.data.content}</pre>
        ) : content.isPending ? <p className="text-sm text-ink-faint">{t('Chargement…')}</p> : null}
        <Facts items={[
          ...(dateFr(entry.timestamp) ? [{ label: t('Fichier modifié'), value: dateFr(entry.timestamp)! }] : []),
          ...(entry.skills.length ? [{
            label: t('Skills proches'),
            value: (
              <span className="flex flex-wrap gap-1.5">
                {entry.skills.map((s) => (
                  <button key={s} type="button" onClick={() => onSkill(s)} className="rounded-md transition-opacity hover:opacity-70"><Tag className="font-mono">{s}</Tag></button>
                ))}
              </span>
            ),
          }] : []),
        ]} />
      </DetailBody>
    </article>
  );
}
