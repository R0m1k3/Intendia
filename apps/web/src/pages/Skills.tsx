import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronDown, Download, FileText, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldX, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type ActionStatus, type HubResult, type Scan, type Skill } from '../api';
import { PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Input, Mark, Panel } from '../components/ui';
import {
  ACTION_POLL_MS, actionState, failureLine, loadActions, saveActions, STATE_TEXT, type ActionState, type PendingAction,
} from '../skills/action';
import { categories, filterSkills, groupByCategory, provenanceLabel, type SkillFilter, type StateFilter } from '../skills/filter';

const REQUIRED: OpRef[] = [['skills', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['skills', 'toggle', 'Activer ou désactiver'], ['skills', 'content', 'Lire le SKILL.md'], ['skills', 'hubOfficial', 'Catalogue officiel'],
  ['skills', 'hubSearch', 'Rechercher dans le hub'], ['skills', 'hubScan', 'Installer'], ['skills', 'install', 'Installer'],
  ['skills', 'uninstall', 'Désinstaller'], ['skills', 'update', 'Mettre à jour'], ['skills', 'actionStatus', 'Installer, désinstaller, mettre à jour'],
  ['skills', 'toolsets', "Outils de l'agent"],
];
const ICON = 'size-4';
const SELECT = 'h-9 rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-accent focus:outline-none';

export interface SkillsSearch { profile?: string }

// ---------------------------------------------------------------- actions

interface Outcome { state: ActionState; text: string }

/** Pending hub actions of (instance, profile), polled until Hermes reports the end; survives a reload. */
function useSkillActions(inst: string, profile: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingAction[]>(() => loadActions(inst, profile));
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  useEffect(() => { setPending(loadActions(inst, profile)); setOutcomes({}); }, [inst, profile]);
  useEffect(() => saveActions(inst, profile, pending), [inst, profile, pending]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!pending.length) return;
    const tick = async () => {
      const finished: Record<string, Outcome> = {};
      for (const p of pendingRef.current) {
        let status: ActionStatus | 'gone' | undefined;
        try {
          status = await api.skillAction(inst, p.action);
        } catch (e) {
          status = e instanceof ApiError && e.status === 404 ? 'gone' : undefined;
        }
        const state = actionState(status, p.startedAt);
        if (state === 'running') continue;
        finished[p.target] = {
          state,
          text: state === 'failed' && status && status !== 'gone'
            ? `${p.label} : échec, ${failureLine(status.lines)}` : `${p.label} : ${STATE_TEXT[state as Exclude<ActionState, 'failed'>]}`,
        };
      }
      const targets = Object.keys(finished);
      if (!targets.length) return;
      setPending((list) => list.filter((p) => !targets.includes(p.target)));
      setOutcomes((o) => ({ ...o, ...finished }));
      await qc.invalidateQueries({ queryKey: ['skills', inst, profile] });
      await qc.invalidateQueries({ queryKey: ['hub', inst, profile] });
    };
    const timer = setInterval(() => void tick(), ACTION_POLL_MS);
    return () => clearInterval(timer);
  }, [pending.length, inst, profile, qc]);

  const track = useCallback((action: string, label: string, target: string) => {
    setOutcomes(({ [target]: _, ...rest }) => rest);
    setPending((list) => [...list.filter((p) => p.target !== target), { action, label, target, startedAt: Date.now() }]);
  }, []);
  const busy = (target: string) => pending.some((p) => p.target === target || p.target === '*');
  const dismiss = (target: string) => setOutcomes(({ [target]: _, ...rest }) => rest);
  return { pending, outcomes, track, busy, dismiss };
}
type Actions = ReturnType<typeof useSkillActions>;

/** Pending and finished hub actions of this agent, above both tabs (an uninstalled skill leaves the list). */
function ActionsStrip({ actions }: { actions: Actions }) {
  const done = Object.entries(actions.outcomes);
  if (!actions.pending.length && !done.length) return null;
  return (
    <ul className="space-y-1.5 rounded-xl border border-line bg-sheet px-5 py-3" aria-label="Actions" role="status">
      {actions.pending.map((p) => (
        <li key={p.action} className="flex items-center gap-2 font-mono text-[12px] text-ink-soft">
          <Mark state="readonly" className="animate-pulse" />{p.label} : en cours…
        </li>
      ))}
      {done.map(([target, o]) => (
        <li key={target} className={cx('flex items-center gap-2 font-mono text-[12px]', o.state === 'failed' ? 'text-bad' : 'text-ink-soft')}>
          <Mark state={o.state === 'done' ? 'full' : o.state === 'failed' ? 'unavailable' : 'readonly'} />
          <span className="min-w-0 flex-1">{o.text}</span>
          <button type="button" className="text-ink-faint hover:text-ink" aria-label="Masquer" onClick={() => actions.dismiss(target)}>
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- installed

function SkillRow({ skill, inst, profile, can, actions }: {
  skill: Skill; inst: string; profile: string; can: (op: string) => boolean; actions: Actions;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const content = useQuery({
    queryKey: ['skill-content', inst, profile, skill.name], queryFn: () => api.skillContent(inst, profile, skill.name), enabled: open && can('content'),
  });
  const toggle = useMutation({
    mutationFn: () => api.setSkillEnabled(inst, profile, skill.name, !skill.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', inst, profile] }),
  });
  const uninstall = useMutation({
    mutationFn: () => api.uninstallSkill(inst, profile, skill.name),
    onSuccess: ({ action }) => actions.track(action, `Désinstallation de ${skill.name}`, skill.name),
  });
  const busy = actions.busy(skill.name);
  const canToggle = can('toggle') && skill.enabled !== null;

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <Mark state={skill.enabled === false ? null : 'full'} className="mt-1.5" />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => can('content') && setOpen((o) => !o)} aria-expanded={open}
          title={can('content') ? 'Lire le SKILL.md' : undefined}>
          <span className={cx('font-mono text-[13px]', skill.enabled === false ? 'text-ink-soft' : 'text-ink')}>{skill.name}</span>
          <span className="ml-2 text-[12px] text-ink-faint">{provenanceLabel(skill.provenance)}{skill.usage ? ` · ${skill.usage} usage${skill.usage > 1 ? 's' : ''}` : ''}</span>
          {skill.description && <span className="mt-0.5 block text-sm text-ink-soft">{skill.description}</span>}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {skill.provenance === 'hub' && can('uninstall') && can('actionStatus') && (
            <Button variant="ghost" className="px-2.5" disabled={busy || uninstall.isPending} aria-label={`Désinstaller ${skill.name}`} title="Désinstaller"
              onClick={() => { if (confirm(`Désinstaller ${skill.name} de cet agent ?`)) uninstall.mutate(); }}>
              <Trash2 className={ICON} strokeWidth={1.5} />
            </Button>
          )}
          {canToggle && (
            <Button className="w-28" disabled={toggle.isPending || busy} onClick={() => toggle.mutate()}>
              {skill.enabled ? 'Désactiver' : 'Activer'}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-2 pl-5 empty:hidden">
        <ErrorText error={toggle.error ?? uninstall.error} />
        {open && (
          content.data ? (
            <div>
              <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-raised/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-soft">{content.data.content}</pre>
              {content.data.truncated && <p className="mt-1 text-xs text-ink-faint">Contenu tronqué à 200 000 caractères.</p>}
            </div>
          ) : content.error ? <ErrorText error={content.error} /> : <p className="text-sm text-ink-faint">Chargement…</p>
        )}
      </div>
    </li>
  );
}

function Toolsets({ inst, profile }: { inst: string; profile: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['toolsets', inst, profile], queryFn: () => api.toolsets(inst, profile).then((r) => r.toolsets), enabled: open });
  const on = q.data?.filter((t) => t.enabled).length;
  return (
    <Panel bodyClassName="p-0" title={
      <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown className={cx(ICON, 'transition-transform', !open && '-rotate-90')} strokeWidth={1.5} />
        Outils de l’agent
      </button>
    } action={q.data ? <span className="font-mono text-[11px] text-ink-faint">{on}/{q.data.length} actifs</span> : undefined}>
      {open && (
        q.data ? (
          <ul className="divide-y divide-line">
            {q.data.map((t) => (
              <li key={t.name} className="flex items-start gap-3 px-5 py-3">
                <Mark state={t.enabled ? 'full' : null} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-sm"><span className={t.enabled ? 'text-ink' : 'text-ink-soft'}>{t.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">{t.name}{t.configured === false ? ' · non configuré' : ''}</span></p>
                  {t.tools.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{t.tools.join(' · ')}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="px-5 py-4 empty:hidden">{q.error ? <ErrorText error={q.error} /> : <p className="text-sm text-ink-faint">Chargement…</p>}</div>
      )}
    </Panel>
  );
}

function Installed({ inst, profile, can, actions, onHub }: {
  inst: string; profile: string; can: (op: string) => boolean; actions: Actions; onHub: () => void;
}) {
  const skills = useQuery({ queryKey: ['skills', inst, profile], queryFn: () => api.skills(inst, profile).then((r) => r.skills) });
  const [f, setF] = useState<SkillFilter>({ text: '', category: '', state: 'all' });
  const update = useMutation({
    mutationFn: () => api.updateSkills(inst, profile),
    onSuccess: ({ action }) => actions.track(action, 'Mise à jour des skills du hub', '*'),
  });
  const all = skills.data ?? [];
  const shown = useMemo(() => groupByCategory(filterSkills(all, f)), [all, f]);
  const count = shown.reduce((n, g) => n + g.skills.length, 0);
  const canUpdate = can('update') && can('actionStatus') && all.some((s) => s.provenance === 'hub');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-56"><Input placeholder="Filtrer" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label="Filtrer les skills" /></div>
        <select className={SELECT} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {categories(all).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={SELECT} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as StateFilter })} aria-label="État">
          <option value="all">Actifs et inactifs</option>
          <option value="on">Actifs</option>
          <option value="off">Inactifs</option>
        </select>
        {canUpdate && (
          <Button className="ml-auto" disabled={actions.busy('*') || update.isPending} onClick={() => update.mutate()}>
            <RefreshCw className={ICON} strokeWidth={1.5} />Mettre à jour les skills du hub
          </Button>
        )}
      </div>
      <div className="empty:hidden"><ErrorText error={update.error ?? skills.error} /></div>
      <Panel bodyClassName="p-0" title="Skills de l’agent" action={<span className="font-mono text-[11px] text-ink-faint">{count === all.length ? all.length : `${count}/${all.length}`}</span>}>
        {skills.isSuccess && all.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-ink-soft">Aucun skill pour cet agent</p>
            {can('hubOfficial') && <Button variant="primary" className="mt-4" onClick={onHub}><Search className={ICON} strokeWidth={1.5} />Chercher dans le hub</Button>}
          </div>
        ) : skills.isSuccess ? (
          count ? shown.map((g) => (
            <section key={g.category || '-'}>
              <h3 className="border-b border-line bg-raised/30 px-5 py-1.5 font-mono text-[11px] text-ink-faint">{g.category || 'sans catégorie'}</h3>
              <ul className="divide-y divide-line">
                {g.skills.map((s) => <SkillRow key={s.name} skill={s} inst={inst} profile={profile} can={can} actions={actions} />)}
              </ul>
            </section>
          )) : <p className="px-5 py-10 text-center text-sm text-ink-faint">Aucun skill ne correspond au filtre</p>
        ) : <p className="px-5 py-10 text-center text-sm text-ink-faint">Chargement…</p>}
      </Panel>
      {can('toolsets') && <Toolsets inst={inst} profile={profile} />}
    </div>
  );
}

// ---------------------------------------------------------------- hub

const VERDICT: Record<string, { text: string; icon: typeof ShieldCheck; cls: string }> = {
  allow: { text: 'Scan sans alerte', icon: ShieldCheck, cls: 'text-ok' },
  ask: { text: 'Le scan demande de la prudence', icon: ShieldAlert, cls: 'text-warn' },
  block: { text: 'Installation refusée par le scan', icon: ShieldX, cls: 'text-bad' },
};

function scanOf(err: unknown): Scan | null {
  if (err instanceof ApiError && err.status === 409 && err.data && typeof err.data === 'object' && 'scan' in err.data) return (err.data as { scan: Scan }).scan;
  return null;
}

function InstallPanel({ result, inst, profile, actions, onClose }: {
  result: HubResult; inst: string; profile: string; actions: Actions; onClose: () => void;
}) {
  const scan = useQuery({ queryKey: ['scan', inst, profile, result.identifier], queryFn: () => api.hubScan(inst, profile, result.identifier).then((r) => r.scan), staleTime: 0 });
  const [ack, setAck] = useState(false);
  const install = useMutation({
    mutationFn: () => api.installSkill(inst, profile, result.identifier, ack),
    onSuccess: ({ action }) => { actions.track(action, `Installation de ${result.name}`, result.identifier); onClose(); },
  });
  const s = scanOf(install.error) ?? scan.data;
  const v = s ? VERDICT[s.policy] ?? { text: `Résultat inconnu : ${s.policy}`, icon: ShieldX, cls: 'text-bad' } : null;
  const counts = s ? Object.entries(s.counts).filter(([, n]) => n > 0) : [];

  return (
    <div className="mt-3 rounded-lg border border-line bg-raised/30 p-4 text-sm">
      {scan.isPending && !s ? <p className="text-ink-faint">Scan de sécurité en cours…</p> : scan.error && !s ? <ErrorText error={scan.error} /> : s && v && (
        <div className="space-y-3">
          <p className={cx('flex items-center gap-2 font-medium', v.cls)}><v.icon className={ICON} strokeWidth={1.5} />{v.text}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-faint">Source</dt><dd>{result.source ?? '-'}{result.repo ? ` · ${result.repo}` : ''}</dd>
            <dt className="text-ink-faint">Confiance</dt><dd>{s.trust ?? result.trust ?? '-'}</dd>
            <dt className="text-ink-faint">Verdict</dt><dd>{s.verdict}{counts.length ? ` (${counts.map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}</dd>
            {s.reason && <><dt className="text-ink-faint">Raison</dt><dd>{s.reason}</dd></>}
          </dl>
          {s.findings.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto font-mono text-[12px] text-ink-soft">
              {s.findings.map((f, i) => <li key={i}>{String(f.severity ?? '')} {String(f.message ?? f.description ?? f.rule ?? JSON.stringify(f))}</li>)}
            </ul>
          )}
          {s.policy === 'ask' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              J’ai lu les constats
            </label>
          )}
          <ErrorText error={scanOf(install.error) ? null : install.error} />
          <div className="flex gap-2">
            {(s.policy === 'allow' || s.policy === 'ask') && (
              <Button variant="primary" disabled={install.isPending || (s.policy === 'ask' && !ack)} onClick={() => install.mutate()}>
                <Download className={ICON} strokeWidth={1.5} />
                {install.isPending ? 'Analyse et lancement…' : s.policy === 'ask' ? 'Installer quand même' : 'Installer'}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HubRow({ result, inst, profile, canInstall, actions, open, onOpen }: {
  result: HubResult; inst: string; profile: string; canInstall: boolean; actions: Actions; open: boolean; onOpen: (o: boolean) => void;
}) {
  const busy = actions.busy(result.identifier);
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <Mark state={result.installed ? 'full' : null} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p><span className="font-mono text-[13px]">{result.name}</span>
            <span className="ml-2 text-[12px] text-ink-faint">{result.source ?? ''}{result.trust ? ` · ${result.trust}` : ''}{result.installed ? ' · installé' : ''}</span></p>
          {result.description && <p className="mt-0.5 text-sm text-ink-soft">{result.description}</p>}
          <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{result.identifier}</p>
        </div>
        {canInstall && !result.installed && (
          <Button className="shrink-0" disabled={busy} onClick={() => onOpen(!open)}>
            {open ? <X className={ICON} strokeWidth={1.5} /> : <Download className={ICON} strokeWidth={1.5} />}{open ? 'Annuler' : 'Installer'}
          </Button>
        )}
      </div>
      {open && <div className="pl-5"><InstallPanel result={result} inst={inst} profile={profile} actions={actions} onClose={() => onOpen(false)} /></div>}
    </li>
  );
}

function Hub({ inst, profile, can, actions }: { inst: string; profile: string; can: (op: string) => boolean; actions: Actions }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const official = useQuery({ queryKey: ['hub', inst, profile, 'official'], queryFn: () => api.hubOfficial(inst, profile), enabled: !q && can('hubOfficial') });
  const search = useQuery({ queryKey: ['hub', inst, profile, 'search', q], queryFn: () => api.hubSearch(inst, profile, q), enabled: Boolean(q), staleTime: 60_000 });
  const data = q ? search : official;
  const canInstall = can('install') && can('hubScan') && can('actionStatus');
  const results = data.data?.results ?? [];

  return (
    <div className="space-y-6">
      {can('hubSearch') && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); }}>
          <div className="w-full sm:w-80"><Input placeholder="Chercher un skill (pdf, notion, git…)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Recherche dans le hub" maxLength={200} /></div>
          <Button type="submit" disabled={!text.trim() || search.isFetching}><Search className={ICON} strokeWidth={1.5} />Chercher</Button>
          {q && <Button type="button" variant="ghost" onClick={() => { setQ(''); setText(''); }}>Catalogue officiel</Button>}
        </form>
      )}
      <ErrorText error={data.error} />
      {(q || can('hubOfficial')) && (
        <Panel bodyClassName="p-0" title={q ? <>Résultats pour <span className="font-mono">{q}</span></> : 'Catalogue officiel'}
          action={data.data ? <span className="font-mono text-[11px] text-ink-faint">{results.length}</span> : undefined}>
          {data.data?.timedOut.length ? <p className="border-b border-line px-5 py-2 text-[13px] text-warn">Sources sans réponse : {data.data.timedOut.join(', ')}</p> : null}
          {data.isFetching && !data.data ? (
            <p className="px-5 py-10 text-center text-sm text-ink-faint">{q ? 'Recherche dans le hub… (environ 10 secondes)' : 'Chargement…'}</p>
          ) : results.length ? (
            <ul className="divide-y divide-line">
              {results.map((r) => (
                <HubRow key={r.identifier} result={r} inst={inst} profile={profile} canInstall={canInstall} actions={actions}
                  open={open === r.identifier} onOpen={(o) => setOpen(o ? r.identifier : null)} />
              ))}
            </ul>
          ) : data.isSuccess ? <p className="px-5 py-10 text-center text-sm text-ink-faint">Aucun résultat</p> : null}
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page

export function SkillsPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as SkillsSearch;
  const profile = search.profile ?? 'default';
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const profiles = useQuery({ queryKey: ['profiles', inst], queryFn: () => api.profiles(inst).then((r) => r.profiles) });
  const a = useModuleAvailability(inst, 'skills', REQUIRED, OPTIONAL);
  const actions = useSkillActions(inst, profile);
  const [tab, setTab] = useState<'installed' | 'hub'>('installed');
  const list = instances.data?.instances ?? [];
  const current = list.find((i) => i.id === inst);
  const can = (op: string) => a.has('skills', op);
  const names = profiles.data ?? ['default'];
  const options = names.includes(profile) ? names : [...names, profile];

  return (
    <div>
      <PageHeader
        title="Skills"
        subtitle={<>Les skills de l’agent <span className="font-mono text-ink">{profile}</span> sur {current ? <span className="text-ink">{current.label}</span> : 'l’instance'}, et le hub pour en installer.</>}
        action={options.length > 1 ? (
          <select className={SELECT} value={profile} aria-label="Agent"
            onChange={(e) => void navigate({ to: '/i/$inst/skills', params: { inst }, search: { profile: e.target.value === 'default' ? undefined : e.target.value } })}>
            {options.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : undefined}
      />
      <div className="space-y-6 px-5 pb-10 md:px-8">
        {list.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Instance">
            {list.map((i) => (
              <Link key={i.id} to="/i/$inst/skills" params={{ inst: i.id }}
                className={cx('h-8 rounded-lg border px-3 text-[13px] leading-8 transition-colors', i.id === inst ? 'border-accent text-ink' : 'border-line text-ink-soft hover:text-ink')}>
                {i.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="empty:hidden">
          <ModuleNotice instanceId={inst} module="skills" title="La console des skills" required={REQUIRED} optional={OPTIONAL} explainMissing />
        </div>
        {a.available && (
          <>
            <ActionsStrip actions={actions} />
            <div className="flex gap-1 border-b border-line" role="tablist">
              {([['installed', 'Installés', FileText], ['hub', 'Hub', Search]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cx('-mb-px flex h-9 items-center gap-2 border-b-2 px-3 text-sm transition-colors', tab === id ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>
                  <Icon className={ICON} strokeWidth={1.5} />{label}
                </button>
              ))}
            </div>
            {tab === 'installed'
              ? <Installed inst={inst} profile={profile} can={can} actions={actions} onHub={() => setTab('hub')} />
              : <Hub inst={inst} profile={profile} can={can} actions={actions} />}
          </>
        )}
      </div>
    </div>
  );
}
