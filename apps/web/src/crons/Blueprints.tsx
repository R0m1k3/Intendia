import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, LayoutTemplate, Puzzle, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, type Blueprint, type Cron } from '../api';
import { Button, cx, ErrorText, Field, Input, Tag } from '../components/ui';
import { blueprintDefaults, blueprintValues, controlOf, missingFields, optionLabel } from './blueprint-form';
import { describe } from './schedule';
import { t } from '../i18n';

const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
const ICON = 'size-4';

/** A template's schedule: a 5-field cron expression in plain French, else Hermes' text as is. */
function scheduleText(s: string | null): string | null {
  if (!s) return null;
  return /^\S+(\s+\S+){4}$/.test(s.trim()) ? describe({ kind: 'cron', expr: s.trim(), minutes: null, runAt: null, display: s }) : s;
}

function BlueprintForm({ instanceId, profile, bp, onBack, onCreated }: {
  instanceId: string; profile: string; bp: Blueprint; onBack: () => void; onCreated: (c: Cron, attached: boolean, workspace: string | null) => void;
}) {
  const qc = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const [values, setValues] = useState(() => blueprintDefaults(bp));
  const [workspace, setWorkspace] = useState('');
  // a workspace frames the cron for its own agent only
  const mine = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === instanceId && (w.profile ?? 'default') === profile);
  const missing = missingFields(bp, values);
  const create = useMutation({
    mutationFn: () => api.instantiateBlueprint(instanceId, profile, bp.key, blueprintValues(bp, values), workspace || null),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['crons', instanceId] });
      await qc.invalidateQueries({ queryKey: ['crons-overview'] });
      onCreated(r.cron, r.attached, workspace || null);
    },
  });
  const when = scheduleText(bp.schedule);
  // Hermes' own reason (422 of its form check), kept in `detail` by the server
  const hermesSays = create.error instanceof ApiError ? (create.error.data as { detail?: string } | undefined)?.detail ?? null : null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!missing.length) create.mutate(); }} aria-label={t('Modèle {title}', { title: bp.title })} data-blueprint-form={bp.key}>
      <div className="max-w-[720px] space-y-5 px-4 py-6 md:px-6">
        <div>
          <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
            <ChevronLeft className="size-3.5" strokeWidth={1.5} />{t('Tous les modèles')}
          </button>
          <h3 className="text-[15px] font-semibold">{bp.title}</h3>
          {bp.description && <p className="mt-1 text-sm text-ink-soft">{bp.description}</p>}
          {when && <p className="mt-1 text-xs text-ink-faint">{t('{when} · agent {profile}', { when, profile })}</p>}
        </div>
        {bp.fields.map((f) => {
          const c = controlOf(f);
          const v = values[f.name] ?? '';
          const set = (x: string) => setValues((o) => ({ ...o, [f.name]: x }));
          return (
            <Field key={f.name} label={f.optional ? t('{label} (facultatif)', { label: f.label }) : f.label} hint={f.help ?? undefined}>
              {c === 'time' ? (
                <input type="time" value={v} onChange={(e) => set(e.target.value)} required={!f.optional} className={cx(SELECT, 'w-32')} name={f.name} />
              ) : c === 'select' ? (
                <select value={v} onChange={(e) => set(e.target.value)} className={SELECT} name={f.name}>
                  {f.optional && <option value="">-</option>}
                  {f.options.map((o) => <option key={o.value} value={o.value}>{optionLabel(f, o)}</option>)}
                </select>
              ) : c === 'suggest' ? (
                <>
                  <Input value={v} onChange={(e) => set(e.target.value)} required={!f.optional} maxLength={2000} name={f.name} list={`bp-${f.name}`} className="font-mono" />
                  <datalist id={`bp-${f.name}`}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
                </>
              ) : (
                <Input value={v} onChange={(e) => set(e.target.value)} required={!f.optional} maxLength={2000} name={f.name} />
              )}
            </Field>
          );
        })}
        <Field label={t('Workspace')} hint={mine.length ? t('Facultatif : le prompt reçoit le bloc de cadrage du workspace') : t('Aucun workspace de l’agent {profile} sur cette instance', { profile })}>
          <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} className={SELECT} disabled={!mine.length}>
            <option value="">{t('Aucun')}</option>
            {mine.map((w) => <option key={w.slug} value={w.slug}>{w.name} ({w.slug})</option>)}
          </select>
        </Field>
        <ErrorText error={create.error} />
        {hermesSays && <p className="-mt-3 whitespace-pre-wrap font-mono text-[12px] text-bad">{hermesSays}</p>}
      </div>
      <footer className="flex max-w-[720px] justify-end gap-2 px-4 pb-8 md:px-6">
        <Button type="button" onClick={onBack}>{t('Retour')}</Button>
        <Button type="submit" variant="primary" disabled={create.isPending || missing.length > 0}>{create.isPending ? t('Création…') : t('Créer le cron')}</Button>
      </footer>
    </form>
  );
}

/** "Depuis un modèle": Hermes' cron templates for an agent, then a form generated from the template's fields. */
export function Blueprints({ instanceId, onClose, onCreated }: {
  instanceId: string; onClose: () => void; onCreated: (c: Cron, attached: boolean, workspace: string | null) => void;
}) {
  const profiles = useQuery({ queryKey: ['profiles', instanceId], queryFn: () => api.profiles(instanceId).then((r) => r.profiles) });
  const [profile, setProfile] = useState('default');
  const list = useQuery({ queryKey: ['cron-blueprints', instanceId, profile], queryFn: () => api.blueprints(instanceId, profile).then((r) => r.blueprints) });
  const [picked, setPicked] = useState<string | null>(null);
  const bp = list.data?.find((b) => b.key === picked) ?? null;
  const names = profiles.data ?? ['default'];
  return (
    <section className="flex flex-col" aria-label={t('Depuis un modèle')}>
      <header className="flex min-h-16 flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3 md:px-6">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{t('Depuis un modèle')}</h2>
        {names.length > 1 && (
          <select value={profile} onChange={(e) => { setProfile(e.target.value); setPicked(null); }} aria-label={t('Agent')}
            className="h-[34px] rounded-lg border border-line bg-sheet px-2 font-mono text-[13px] focus:border-ink focus:outline-none">
            {names.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <Button type="button" variant="ghost" className="w-[34px] px-0" onClick={onClose} aria-label={t('Fermer')}><X className={ICON} strokeWidth={1.5} /></Button>
      </header>
      {bp ? (
        <BlueprintForm key={`${profile}:${bp.key}`} instanceId={instanceId} profile={profile} bp={bp} onBack={() => setPicked(null)} onCreated={onCreated} />
      ) : (
        <div className="max-w-[720px] space-y-3 px-4 py-6 md:px-6">
          <ErrorText error={list.error} />
          {list.isPending && <p className="text-sm text-ink-faint">{t('Chargement…')}</p>}
          {list.isSuccess && list.data.length === 0 && <p className="text-sm text-ink-faint">{t('Hermes ne propose aucun modèle pour cet agent')}</p>}
          <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('Modèles|cron')}>
            {list.data?.map((b) => (
              <li key={b.key} data-blueprint={b.key}>
                <button type="button" onClick={() => setPicked(b.key)}
                  className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-line px-4 py-3 text-left transition-colors hover:border-ink-faint/60 hover:bg-raised">
                  <span className="flex items-center gap-2">
                    {b.source === 'plugin' ? <Puzzle className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} /> : <LayoutTemplate className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.title}</span>
                    {b.category && <Tag>{b.category}</Tag>}
                  </span>
                  {b.description && <span className="line-clamp-2 text-[13px] text-ink-soft">{b.description}</span>}
                  <span className="text-xs text-ink-faint">
                    {scheduleText(b.schedule) ?? t('planning à choisir')}{b.source === 'plugin' ? ` · ${t('plugin {name}', { name: b.plugin ?? '?' })}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
