import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, type Cron, type CronInput } from '../api';
import {
  DAYS, defaultForm, describeForm, FORM_KINDS, fromSchedule, toSchedule, validate, type ScheduleForm,
} from '../crons/schedule';
import { Button, cx, ErrorText, Field, Input } from './ui';

const SELECT = 'h-9 rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-accent focus:outline-none';

function ScheduleFields({ form, onChange }: { form: ScheduleForm; onChange: (f: ScheduleForm) => void }) {
  const time = 'time' in form && (
    <input type="time" value={form.time} onChange={(e) => onChange({ ...form, time: e.target.value } as ScheduleForm)}
      className={cx(SELECT, 'w-28')} aria-label="Heure" required />
  );
  switch (form.kind) {
    case 'minutes':
    case 'hours':
      return (
        <span className="inline-flex items-center gap-2 text-sm">
          toutes les
          <Input type="number" min={1} max={form.kind === 'minutes' ? 1440 : 168} value={Number.isNaN(form.n) ? '' : form.n} className="w-20"
            onChange={(e) => onChange({ ...form, n: e.target.valueAsNumber })} aria-label="Intervalle" />
          {form.kind === 'minutes' ? 'minutes' : 'heures'}
        </span>
      );
    case 'weekly':
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          le
          <select value={form.day} onChange={(e) => onChange({ ...form, day: Number(e.target.value) })} className={SELECT} aria-label="Jour">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
          </select>
          à {time}
        </span>
      );
    case 'monthly':
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          le
          <Input type="number" min={1} max={31} value={Number.isNaN(form.day) ? '' : form.day} className="w-20"
            onChange={(e) => onChange({ ...form, day: e.target.valueAsNumber })} aria-label="Jour du mois" />
          à {time}
        </span>
      );
    case 'once':
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          le
          <input type="date" value={form.date} onChange={(e) => onChange({ ...form, date: e.target.value })} className={SELECT} aria-label="Date" />
          à {time}
        </span>
      );
    case 'cron':
      return (
        <Input value={form.expr} onChange={(e) => onChange({ ...form, expr: e.target.value })} className="font-mono"
          placeholder="minute heure jour mois jour-de-semaine" aria-label="Expression cron" spellCheck={false} />
      );
    default:
      return <span className="inline-flex items-center gap-2 text-sm">à {time}</span>;
  }
}

function Row({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

/** Create or edit a cron: side panel on desktop, full screen on mobile. */
export function CronEditor({ instanceId, cron, offset, onClose }: {
  instanceId: string; cron: Cron | null; offset: string | null; onClose: () => void;
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

  const mine = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === instanceId);
  const ws = mine.find((w) => w.slug === workspace);
  const scheduleError = validate(form);

  const save = useMutation({
    mutationFn: () => {
      const schedule = toSchedule(form);
      const input: CronInput = {
        name: name.trim(), prompt, deliver: deliver.trim() || 'local', model: model.trim() || null, workspace: workspace || null,
        skills: skills.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      };
      if (!cron) return api.createCron(instanceId, { ...input, schedule, paused });
      // unchanged schedule: not sent, so Hermes keeps its next run
      const changed = !(initialForm.kind === 'cron' && !initialForm.expr) && schedule !== toSchedule(initialForm);
      return api.updateCron(instanceId, cron.id, cron.profile, changed ? { ...input, schedule } : input);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['crons', instanceId] });
      await qc.invalidateQueries({ queryKey: ['upcoming-crons'] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error.data as { field?: string; detail?: string } | undefined : undefined;
  const fieldError = err?.field === 'schedule' ? err.detail : null;

  // portal: the page wrapper is animated (transform), which would make `fixed` relative to it
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (!scheduleError) save.mutate(); }}
        className="enter flex h-full w-full flex-col bg-sheet shadow-xl md:w-[520px] md:border-l md:border-line"
        aria-label={cron ? 'Modifier le cron' : 'Nouveau cron'}
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[15px] font-medium">{cron ? 'Modifier le cron' : 'Nouveau cron'}</h2>
          <Button type="button" variant="ghost" className="size-8 px-0" onClick={onClose} aria-label="Fermer">
            <X className="size-4" strokeWidth={1.5} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Field label="Nom">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Rapport du lundi" autoFocus />
          </Field>

          <Field label="Prompt" hint="Ce que l’agent doit faire à chaque exécution">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} required maxLength={20_000} rows={6}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-accent focus:outline-none"
              placeholder="Fais le point des ventes de la semaine et range le tableau dans le workspace." />
          </Field>

          <Row>
            <span className="block text-sm font-medium">Planning</span>
            <div className="flex flex-wrap items-center gap-2">
              <select value={form.kind} onChange={(e) => setForm(defaultForm(e.target.value as ScheduleForm['kind']))} className={SELECT} aria-label="Type de planning">
                {FORM_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <ScheduleFields form={form} onChange={setForm} />
            </div>
            <p className={cx('text-xs', scheduleError || fieldError ? 'text-bad' : 'text-ink-soft')}>
              {scheduleError ?? (form.kind === 'cron' ? `Envoyé tel quel à Hermes : ${toSchedule(form)}` : describeForm(form))}
              {!scheduleError && form.kind !== 'minutes' && form.kind !== 'hours' && (
                <span className="text-ink-faint"> · heure d’Hermes{offset ? ` (${offset})` : ''}</span>
              )}
            </p>
            {fieldError && <pre className="whitespace-pre-wrap rounded-lg bg-bad-soft/50 p-3 font-mono text-[11px] text-bad">{fieldError}</pre>}
            {form.kind === 'monthly' && form.day > 28 && <p className="text-xs text-ink-faint">Les mois sans ce jour sont sautés</p>}
          </Row>

          <Field label="Workspace" hint={ws
            ? `Le prompt reçoit le bloc de cadrage : l’agent lit AGENTS.md et range ses fichiers dans crons/${cron?.workspace?.folder ?? 'nom-du-cron'}/ ; profil ${ws.profile ?? 'default'}`
            : 'Facultatif : rattache le cron au dossier d’un workspace'}>
            <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} className={cx(SELECT, 'w-full')}>
              <option value="">Aucun</option>
              {mine.map((w) => <option key={w.slug} value={w.slug}>{w.name} ({w.slug})</option>)}
            </select>
          </Field>
          {cron?.workspace?.missing && (
            <p className="-mt-3 text-xs text-warn">Le workspace « {cron.workspace.slug} » n’existe plus : enregistrer sans workspace retire le cadrage du prompt</p>
          )}

          <Field label="Destination du résultat">
            {targets.isSuccess ? (
              <select value={deliver} onChange={(e) => setDeliver(e.target.value)} className={cx(SELECT, 'w-full')}>
                {[...targets.data.targets, ...(targets.data.targets.some((t) => t.id === deliver) ? [] : [{ id: deliver, name: deliver }])]
                  .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <Input value={deliver} onChange={(e) => setDeliver(e.target.value)} placeholder="local" className="font-mono" />
            )}
          </Field>

          <Field label="Skills" hint="Noms séparés par des virgules ; vide = aucun skill imposé">
            <Input value={skills} onChange={(e) => setSkills(e.target.value)} className="font-mono" placeholder="web-search, pdf" spellCheck={false} />
          </Field>

          <Field label="Modèle" hint="Vide : le modèle par défaut d’Hermes">
            <Input value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" placeholder={ws?.model ?? 'modèle par défaut'} spellCheck={false} />
          </Field>

          {!cron && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              Créer en pause
            </label>
          )}

          {save.error && !fieldError ? <ErrorText error={save.error} /> : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={save.isPending || Boolean(scheduleError) || !name.trim() || !prompt.trim()}>
            {save.isPending ? 'Enregistrement…' : cron ? 'Enregistrer' : 'Créer le cron'}
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
