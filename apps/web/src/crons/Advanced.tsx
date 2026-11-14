import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type Cron } from '../api';
import { cx, Field, Input } from '../components/ui';
import { advancedCount, type AdvancedForm } from './advanced';
import { plural, t } from '../i18n';

const SELECT = 'h-9 rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
const CHECK = 'mt-0.5 size-4 shrink-0 accent-[var(--color-ink)]';

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

/**
 * Folded "Options avancées" of the cron form: repeat, time zone, allowed toolsets, catch-up of missed runs and
 * the context of other crons of the same agent.
 */
export function Advanced({ instanceId, profile, cron, form, onChange, error }: {
  instanceId: string; profile: string; cron: Cron | null; form: AdvancedForm; onChange: (f: AdvancedForm) => void; error: string | null;
}) {
  const count = advancedCount(form);
  const [open, setOpen] = useState(count > 0);
  const toolsets = useQuery({ queryKey: ['toolsets', instanceId, profile], queryFn: () => api.toolsets(instanceId, profile).then((r) => r.toolsets), enabled: open, retry: false });
  const crons = useQuery({ queryKey: ['crons', instanceId], queryFn: () => api.crons(instanceId).then((r) => r.crons), enabled: open });
  const tz = useMemo(zones, []);
  const others = (crons.data ?? []).filter((c) => c.profile === profile && c.id !== cron?.id);
  // a cron of another agent, or gone, still listed: shown so it can be unchecked
  const unknown = form.contextFrom.filter((id) => !others.some((c) => c.id === id));
  const set = (patch: Partial<AdvancedForm>) => onChange({ ...form, ...patch });
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <section className="rounded-xl border border-line" aria-label={t('Options avancées')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium">
        <span>{t('Options avancées')}{count > 0 && <span className="ml-2 font-normal text-ink-faint">{plural(count, '{n} réglée', '{n} réglées', { n: count })}</span>}</span>
        <ChevronDown className={cx('size-4 text-ink-faint transition-transform', open && 'rotate-180')} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-line/70 px-4 py-4">
          <Field label={t('Répétition')} hint={cron?.repeat ? t('Déjà {done} sur {total} ; Hermes supprime le cron après le dernier run', { done: cron.repeatCompleted, total: cron.repeat }) : t('Vide : toujours ; un nombre : Hermes supprime le cron après autant de runs')}>
            <span className="flex items-center gap-2 text-sm">
              <Input type="number" min={1} max={100000} value={form.repeat} onChange={(e) => set({ repeat: e.target.value })} className="w-28" placeholder={t('toujours')} aria-label={t('Nombre de runs')} />
              {t('fois')}
            </span>
          </Field>

          <Field label={t('Fuseau horaire')} hint={t('Vide : celui d’Hermes ; les heures du planning sont lues dans ce fuseau')}>
            <Input value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} list="cron-zones" className="font-mono" placeholder="Europe/Paris" spellCheck={false} />
            <datalist id="cron-zones">{tz.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">{t('Rattrapage des runs manqués')}</span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={form.catchUp} onChange={(e) => set({ catchUp: e.target.value as AdvancedForm['catchUp'] })} className={SELECT} aria-label={t('Rattrapage')}>
                <option value="default">{t('Par défaut d’Hermes')}</option>
                <option value="yes">{t('Oui, lancer au retour')}</option>
                <option value="no">{t('Non, sauter')}</option>
              </select>
              {t('délai de grâce')}
              <Input type="number" min={0} max={10080} value={form.grace} onChange={(e) => set({ grace: e.target.value })} className="w-24" placeholder={t('défaut')} aria-label={t('Délai de grâce')} />
              {t('minutes')}
            </div>
            <span className="mt-1 block text-xs text-ink-faint">{t('Quand Hermes était arrêté à l’heure prévue ; le délai dit jusqu’à quand un retard compte encore')}</span>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">{t('Outils permis')}</span>
            {toolsets.data ? (
              <ul className="grid gap-1.5 sm:grid-cols-2" aria-label={t('Outils permis')}>
                {toolsets.data.map((ts) => (
                  <li key={ts.name}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className={CHECK} checked={form.toolsets.includes(ts.name)} onChange={() => set({ toolsets: toggleIn(form.toolsets, ts.name) })} />
                      <span>{ts.label}<span className="ml-1.5 font-mono text-[11px] text-ink-faint">{ts.name}</span></span>
                    </label>
                  </li>
                ))}
                {form.toolsets.filter((n) => !toolsets.data.some((ts) => ts.name === n)).map((n) => (
                  <li key={n}>
                    <label className="flex items-start gap-2 text-sm text-ink-soft">
                      <input type="checkbox" className={CHECK} checked onChange={() => set({ toolsets: toggleIn(form.toolsets, n) })} />
                      <span className="font-mono text-[12px]">{n}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : toolsets.isError ? (
              <Input value={form.toolsets.join(', ')} className="font-mono" placeholder="web, terminal" spellCheck={false} aria-label={t('Outils permis')}
                onChange={(e) => set({ toolsets: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
            ) : <p className="text-sm text-ink-faint">{t('Chargement…')}</p>}
            <span className="mt-1 block text-xs text-ink-faint">{t('Aucun coché : tous les outils de l’agent {profile}', { profile })}</span>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">{t('Contexte d’autres crons')}</span>
            {others.length || unknown.length ? (
              <ul className="space-y-1.5" aria-label={t('Contexte d’autres crons')}>
                {others.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className={CHECK} checked={form.contextFrom.includes(c.id)} onChange={() => set({ contextFrom: toggleIn(form.contextFrom, c.id) })} />
                      <span>{c.name || t('(sans nom)')}<span className="ml-1.5 font-mono text-[11px] text-ink-faint">{c.id}</span></span>
                    </label>
                  </li>
                ))}
                {unknown.map((id) => (
                  <li key={id}>
                    <label className="flex items-start gap-2 text-sm text-warn">
                      <input type="checkbox" className={CHECK} checked onChange={() => set({ contextFrom: toggleIn(form.contextFrom, id) })} />
                      <span className="font-mono text-[12px]">{t('{id} (introuvable pour cet agent)', { id })}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-faint">{crons.isPending ? t('Chargement…') : t('Aucun autre cron de l’agent {profile}', { profile })}</p>}
            <span className="mt-1 block text-xs text-ink-faint">{t('Le dernier résultat des crons cochés est donné à l’agent avant la consigne')}</span>
          </div>

          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
      )}
    </section>
  );
}
