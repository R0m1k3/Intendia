import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type Cron } from '../api';
import { cx, Field, Input } from '../components/ui';
import { advancedCount, type AdvancedForm } from './advanced';

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
    <section className="rounded-xl border border-line" aria-label="Options avancées">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium">
        <span>Options avancées{count > 0 && <span className="ml-2 font-normal text-ink-faint">{count} réglée{count > 1 ? 's' : ''}</span>}</span>
        <ChevronDown className={cx('size-4 text-ink-faint transition-transform', open && 'rotate-180')} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-line/70 px-4 py-4">
          <Field label="Répétition" hint={cron?.repeat ? `Déjà ${cron.repeatCompleted} sur ${cron.repeat} ; Hermes supprime le cron après le dernier run` : 'Vide : toujours ; un nombre : Hermes supprime le cron après autant de runs'}>
            <span className="flex items-center gap-2 text-sm">
              <Input type="number" min={1} max={100000} value={form.repeat} onChange={(e) => set({ repeat: e.target.value })} className="w-28" placeholder="toujours" aria-label="Nombre de runs" />
              fois
            </span>
          </Field>

          <Field label="Fuseau horaire" hint="Vide : celui d’Hermes ; les heures du planning sont lues dans ce fuseau">
            <Input value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} list="cron-zones" className="font-mono" placeholder="Europe/Paris" spellCheck={false} />
            <datalist id="cron-zones">{tz.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Rattrapage des runs manqués</span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={form.catchUp} onChange={(e) => set({ catchUp: e.target.value as AdvancedForm['catchUp'] })} className={SELECT} aria-label="Rattrapage">
                <option value="default">Par défaut d’Hermes</option>
                <option value="yes">Oui, lancer au retour</option>
                <option value="no">Non, sauter</option>
              </select>
              délai de grâce
              <Input type="number" min={0} max={10080} value={form.grace} onChange={(e) => set({ grace: e.target.value })} className="w-24" placeholder="défaut" aria-label="Délai de grâce" />
              minutes
            </div>
            <span className="mt-1 block text-xs text-ink-faint">Quand Hermes était arrêté à l’heure prévue ; le délai dit jusqu’à quand un retard compte encore</span>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Outils permis</span>
            {toolsets.data ? (
              <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Outils permis">
                {toolsets.data.map((t) => (
                  <li key={t.name}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className={CHECK} checked={form.toolsets.includes(t.name)} onChange={() => set({ toolsets: toggleIn(form.toolsets, t.name) })} />
                      <span>{t.label}<span className="ml-1.5 font-mono text-[11px] text-ink-faint">{t.name}</span></span>
                    </label>
                  </li>
                ))}
                {form.toolsets.filter((n) => !toolsets.data.some((t) => t.name === n)).map((n) => (
                  <li key={n}>
                    <label className="flex items-start gap-2 text-sm text-ink-soft">
                      <input type="checkbox" className={CHECK} checked onChange={() => set({ toolsets: toggleIn(form.toolsets, n) })} />
                      <span className="font-mono text-[12px]">{n}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : toolsets.isError ? (
              <Input value={form.toolsets.join(', ')} className="font-mono" placeholder="web, terminal" spellCheck={false} aria-label="Outils permis"
                onChange={(e) => set({ toolsets: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
            ) : <p className="text-sm text-ink-faint">Chargement…</p>}
            <span className="mt-1 block text-xs text-ink-faint">Aucun coché : tous les outils de l’agent {profile}</span>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Contexte d’autres crons</span>
            {others.length || unknown.length ? (
              <ul className="space-y-1.5" aria-label="Contexte d’autres crons">
                {others.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className={CHECK} checked={form.contextFrom.includes(c.id)} onChange={() => set({ contextFrom: toggleIn(form.contextFrom, c.id) })} />
                      <span>{c.name || '(sans nom)'}<span className="ml-1.5 font-mono text-[11px] text-ink-faint">{c.id}</span></span>
                    </label>
                  </li>
                ))}
                {unknown.map((id) => (
                  <li key={id}>
                    <label className="flex items-start gap-2 text-sm text-warn">
                      <input type="checkbox" className={CHECK} checked onChange={() => set({ contextFrom: toggleIn(form.contextFrom, id) })} />
                      <span className="font-mono text-[12px]">{id} (introuvable pour cet agent)</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-faint">{crons.isPending ? 'Chargement…' : `Aucun autre cron de l’agent ${profile}`}</p>}
            <span className="mt-1 block text-xs text-ink-faint">Le dernier résultat des crons cochés est donné à l’agent avant la consigne</span>
          </div>

          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
      )}
    </section>
  );
}
