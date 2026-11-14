import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, ApiError, type Cron, type CronInput } from '../api';
import {
  DAYS, defaultForm, describeForm, FORM_KINDS, fromSchedule, toSchedule, validate, type ScheduleForm,
} from '../crons/schedule';
import { Advanced } from '../crons/Advanced';
import { advancedError, advancedInput, advancedOf, type AdvancedForm } from '../crons/advanced';
import { Button, cx, ErrorText, Field, Input } from './ui';
import { t } from '../i18n';
import { T } from '../i18n/T';

const SELECT = 'h-9 rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';

function ScheduleFields({ form, onChange }: { form: ScheduleForm; onChange: (f: ScheduleForm) => void }) {
  const time = 'time' in form && (
    <input type="time" value={form.time} onChange={(e) => onChange({ ...form, time: e.target.value } as ScheduleForm)}
      className={cx(SELECT, 'w-28')} aria-label={t('Heure')} required />
  );
  switch (form.kind) {
    case 'minutes':
    case 'hours':
      return (
        <span className="inline-flex items-center gap-2 text-sm">
          {(() => {
            const n = (
              <Input type="number" min={1} max={form.kind === 'minutes' ? 1440 : 168} value={Number.isNaN(form.n) ? '' : form.n} className="w-20"
                onChange={(e) => onChange({ ...form, n: e.target.valueAsNumber })} aria-label={t('Intervalle')} />
            );
            return form.kind === 'minutes' ? <T k="toutes les {n} minutes" vars={{ n }} /> : <T k="toutes les {n} heures" vars={{ n }} />;
          })()}
        </span>
      );
    case 'weekly':
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          <T k="le {weekday} à {time}" vars={{
            weekday: (
              <select value={form.day} onChange={(e) => onChange({ ...form, day: Number(e.target.value) })} className={SELECT} aria-label={t('Jour')}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
              </select>
            ),
            time,
          }} />
        </span>
      );
    case 'monthly':
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          <T k="le {day} à {time}" vars={{
            day: (
              <Input type="number" min={1} max={31} value={Number.isNaN(form.day) ? '' : form.day} className="w-20"
                onChange={(e) => onChange({ ...form, day: e.target.valueAsNumber })} aria-label={t('Jour du mois')} />
            ),
            time,
          }} />
        </span>
      );
    case 'once':
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          <T k="le {date} à {time}" vars={{
            date: <input type="date" value={form.date} onChange={(e) => onChange({ ...form, date: e.target.value })} className={SELECT} aria-label={t('Date')} />,
            time,
          }} />
        </span>
      );
    case 'cron':
      return (
        <Input value={form.expr} onChange={(e) => onChange({ ...form, expr: e.target.value })} className="font-mono"
          placeholder={t('minute heure jour mois jour-de-semaine')} aria-label={t('Expression cron')} spellCheck={false} />
      );
    default:
      return <span className="inline-flex items-center gap-2 text-sm"><T k="à {time}" vars={{ time }} /></span>;
  }
}

function Row({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

/** Create or edit a cron, in the detail pane of the Crons page. */
export function CronEditor({ instanceId, cron, offset, onClose, onSaved }: {
  instanceId: string; cron: Cron | null; offset: string | null; onClose: () => void;
  /** The saved cron, when Hermes returns it (a new cron becomes the selection). */
  onSaved?: (c: Cron | null) => void;
}) {
  const qc = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const targets = useQuery({ queryKey: ['cron-targets', instanceId], queryFn: () => api.cronTargets(instanceId), retry: false });
  const initialForm = cron ? fromSchedule(cron.schedule) : defaultForm();
  const [name, setName] = useState(cron?.name ?? '');
  const [prompt, setPrompt] = useState(cron?.prompt ?? '');
  const [form, setForm] = useState<ScheduleForm>(initialForm);
  const [workspace, setWorkspace] = useState<string>(cron?.workspace && !cron.workspace.missing ? cron.workspace.slug : '');
  const [deliver, setDeliver] = useState(cron?.deliver ?? 'local');
  const [skills, setSkills] = useState((cron?.skills ?? []).join(', '));
  const [model, setModel] = useState(cron?.model ?? '');
  const [paused, setPaused] = useState(false);
  const [initialAdvanced] = useState(() => advancedOf(cron));
  const [advanced, setAdvanced] = useState<AdvancedForm>(initialAdvanced);

  const mine = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === instanceId);
  const ws = mine.find((w) => w.slug === workspace);
  const scheduleError = validate(form);
  const optionsError = advancedError(advanced);
  // a new cron belongs to its workspace's agent (default without workspace)
  const profile = cron?.profile ?? ws?.profile ?? 'default';

  const save = useMutation({
    mutationFn: () => {
      const schedule = toSchedule(form);
      const input: CronInput = {
        name: name.trim(), prompt, deliver: deliver.trim() || 'local', model: model.trim() || null, workspace: workspace || null,
        skills: skills.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        ...advancedInput(advanced, cron ? initialAdvanced : null),
      };
      if (!cron) return api.createCron(instanceId, { ...input, schedule, paused });
      // unchanged schedule: not sent, so Hermes keeps its next run
      const changed = !(initialForm.kind === 'cron' && !initialForm.expr) && schedule !== toSchedule(initialForm);
      return api.updateCron(instanceId, cron.id, cron.profile, changed ? { ...input, schedule } : input);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['crons', instanceId] });
      await qc.invalidateQueries({ queryKey: ['crons-overview'] });
      onSaved?.(r.cron ?? null);
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error.data as { field?: string; detail?: string } | undefined : undefined;
  const fieldError = err?.field === 'schedule' ? err.detail : null;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!scheduleError && !optionsError) save.mutate(); }}
      className="flex flex-col"
      aria-label={cron ? t('Modifier le cron') : t('Nouveau cron')}
    >
        <header className="flex min-h-16 flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{cron ? t('Modifier le cron') : t('Nouveau cron')}</h2>
            {cron && <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">{cron.name}</p>}
          </div>
          <Button type="button" variant="ghost" className="w-[34px] px-0" onClick={onClose} aria-label={t('Fermer')}>
            <X className="size-4" strokeWidth={1.5} />
          </Button>
        </header>

        <div className="max-w-[720px] space-y-5 px-4 py-6 md:px-6">
          <Field label={t('Nom')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder={t('Rapport du lundi')} autoFocus />
          </Field>

          <Field label={t('Prompt')} hint={t('Ce que l’agent doit faire à chaque exécution')}>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} required maxLength={20_000} rows={6}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none"
              placeholder={t('Fais le point des ventes de la semaine et range le tableau dans le workspace.')} />
          </Field>

          <Row>
            <span className="block text-[13px] font-medium">{t('Planning')}</span>
            <div className="flex flex-wrap items-center gap-2">
              <select value={form.kind} onChange={(e) => setForm(defaultForm(e.target.value as ScheduleForm['kind']))} className={SELECT} aria-label={t('Type de planning')}>
                {FORM_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <ScheduleFields form={form} onChange={setForm} />
            </div>
            <p className={cx('text-xs', scheduleError || fieldError ? 'text-bad' : 'text-ink-soft')}>
              {scheduleError ?? (form.kind === 'cron' ? t('Envoyé tel quel à Hermes : {schedule}', { schedule: toSchedule(form) }) : describeForm(form))}
              {!scheduleError && form.kind !== 'minutes' && form.kind !== 'hours' && (
                <span className="text-ink-faint"> · {offset ? t('heure d’Hermes ({offset})', { offset }) : t('heure d’Hermes')}</span>
              )}
            </p>
            {fieldError && <pre className="whitespace-pre-wrap rounded-lg bg-bad-soft/50 p-3 font-mono text-[11px] text-bad">{fieldError}</pre>}
            {form.kind === 'monthly' && form.day > 28 && <p className="text-xs text-ink-faint">{t('Les mois sans ce jour sont sautés')}</p>}
          </Row>

          <Field label={t('Workspace')} hint={ws
            ? t('Le prompt reçoit le bloc de cadrage : l’agent lit AGENTS.md et range ses fichiers dans crons/{folder}/ ; profil {profile}', { folder: cron?.workspace?.folder ?? t('nom-du-cron'), profile: ws.profile ?? 'default' })
            : t('Facultatif : rattache le cron au dossier d’un workspace')}>
            <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} className={cx(SELECT, 'w-full')}>
              <option value="">{t('Aucun')}</option>
              {mine.map((w) => <option key={w.slug} value={w.slug}>{w.name} ({w.slug})</option>)}
            </select>
          </Field>
          {cron?.workspace?.missing && (
            <p className="-mt-3 text-xs text-warn">{t('Le workspace « {slug} » n’existe plus : enregistrer sans workspace retire le cadrage du prompt', { slug: cron.workspace.slug })}</p>
          )}

          <Field label={t('Destination du résultat')}>
            {targets.isSuccess ? (
              <select value={deliver} onChange={(e) => setDeliver(e.target.value)} className={cx(SELECT, 'w-full')}>
                {[...targets.data.targets, ...(targets.data.targets.some((tg) => tg.id === deliver) ? [] : [{ id: deliver, name: deliver }])]
                  .map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
              </select>
            ) : (
              <Input value={deliver} onChange={(e) => setDeliver(e.target.value)} placeholder="local" className="font-mono" />
            )}
          </Field>

          <Field label={t('Skills')} hint={t('Noms séparés par des virgules ; vide = aucun skill imposé')}>
            <Input value={skills} onChange={(e) => setSkills(e.target.value)} className="font-mono" placeholder="web-search, pdf" spellCheck={false} />
          </Field>

          <Field label={t('Modèle')} hint={t('Vide : le modèle par défaut d’Hermes')}>
            <Input value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" placeholder={ws?.model ?? t('modèle par défaut')} spellCheck={false} />
          </Field>

          <Advanced key={profile} instanceId={instanceId} profile={profile} cron={cron} form={advanced} onChange={setAdvanced} error={optionsError} />

          {!cron && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
              {t('Créer en pause')}
            </label>
          )}

          {save.error && !fieldError ? <ErrorText error={save.error} /> : null}
        </div>

        <footer className="flex max-w-[720px] justify-end gap-2 px-4 pb-8 md:px-6">
          <Button type="button" onClick={onClose}>{t('Annuler')}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending || Boolean(scheduleError) || Boolean(optionsError) || !name.trim() || !prompt.trim()}>
            {save.isPending ? t('Enregistrement…') : cron ? t('Enregistrer') : t('Créer le cron')}
          </Button>
        </footer>
    </form>
  );
}
