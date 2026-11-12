import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Archive, Download, Layers, Lock, LockOpen, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldX, Trash2, Wrench, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type ActionStatus, type HubResult, type Scan, type Skill } from '../api';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { DetailBody, DetailHeader, Empty, Facts, ListItemBody, ListLabel, ListLink, ListPane, listItemClass, SplitView } from '../components/Panes';
import { pickSelected } from '../components/selection';
import { Button, Chips, cx, ErrorText, Mark, Tag } from '../components/ui';
import {
  ACTION_POLL_MS, actionState, failureLine, loadActions, saveActions, STATE_TEXT, type ActionState, type PendingAction,
} from '../skills/action';
import { categories, filterSkills, groupByCategory, provenanceLabel, type SkillFilter, type StateFilter } from '../skills/filter';
import { ask } from '../components/Dialog';
import { NewSkill, SkillContent } from '../skills/SkillEditor';

const REQUIRED: OpRef[] = [['skills', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['skills', 'toggle', 'Activer ou désactiver'], ['skills', 'content', 'Lire le SKILL.md'], ['skills', 'hubOfficial', 'Catalogue officiel'],
  ['skills', 'hubSearch', 'Rechercher dans le hub'], ['skills', 'hubScan', 'Installer'], ['skills', 'install', 'Installer'],
  ['skills', 'uninstall', 'Désinstaller'], ['skills', 'update', 'Mettre à jour'], ['skills', 'actionStatus', 'Installer, désinstaller, mettre à jour'],
  ['skills', 'toolsets', "Outils de l'agent"], ['skills', 'create', 'Nouveau skill'], ['skills', 'putContent', 'Modifier un skill'],
  ['skills', 'lock', 'Verrouiller'], ['skills', 'archive', 'Archiver'],
];
/** Hermes' provenance of the skills written by the user or by the agent: the only ones edited and archived here. */
const OWN = 'agent';
const ICON = 'size-4';
const SELECT = 'h-8 min-w-0 flex-1 rounded-lg border border-line bg-sheet px-2 text-[13px] transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';

export interface SkillsSearch { profile?: string; skill?: string }

// ---------------------------------------------------------------- actions

interface Outcome { state: ActionState; text: string }

/**
 * Pending hub actions of (instance, profile), polled until Hermes reports the end; survives a reload.
 * The page remounts its view per (instance, profile), so this state never mixes two contexts.
 */
function useSkillActions(inst: string, profile: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingAction[]>(() => loadActions(inst, profile));
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  useEffect(() => saveActions(inst, profile, pending), [inst, profile, pending]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!pending.length) return;
    let cancelled = false;
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
      // a status that arrives after the cleanup belongs to a context that is gone
      if (cancelled || !targets.length) return;
      setPending((list) => list.filter((p) => !targets.includes(p.target)));
      setOutcomes((o) => ({ ...o, ...finished }));
      await qc.invalidateQueries({ queryKey: ['skills', inst, profile] });
      await qc.invalidateQueries({ queryKey: ['hub', inst, profile] });
    };
    const timer = setInterval(() => void tick(), ACTION_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
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
    <ul className="space-y-1.5 rounded-[10px] bg-paper px-4 py-3" aria-label="Actions" role="status">
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
    <div className="card p-4 text-sm">
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
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
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
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------- detail views

const SEARCH_BOX = 'flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 text-ink-faint focus-within:border-ink';
const SEARCH_INPUT = 'w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint';

function SkillDetail({ skill, inst, profile, can, actions }: {
  skill: Skill; inst: string; profile: string; can: (op: string) => boolean; actions: Actions;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toggle = useMutation({
    mutationFn: () => api.setSkillEnabled(inst, profile, skill.name, !skill.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', inst, profile] }),
  });
  const uninstall = useMutation({
    mutationFn: () => api.uninstallSkill(inst, profile, skill.name),
    onSuccess: ({ action }) => actions.track(action, `Désinstallation de ${skill.name}`, skill.name),
  });
  const lock = useMutation({
    mutationFn: () => api.lockSkill(inst, profile, skill.name, !skill.locked),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', inst, profile] }),
  });
  const archive = useMutation({
    mutationFn: () => api.archiveSkill(inst, profile, skill.name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['skills', inst, profile] });
      void navigate({ to: '/i/$inst/skills', params: { inst }, search: { profile: profile === 'default' ? undefined : profile } });
    },
  });
  const own = skill.provenance === OWN;
  const busy = actions.busy(skill.name);
  const canToggle = can('toggle') && skill.enabled !== null;
  const facts = [provenanceLabel(skill.provenance), skill.category, skill.usage ? `${skill.usage} usage${skill.usage > 1 ? 's' : ''}` : null, skill.enabled === false ? 'inactif' : null, skill.locked ? 'verrouillé' : null]
    .filter(Boolean).join(' · ');

  return (
    <article aria-label={skill.name} data-skill={skill.name}>
      <DetailHeader
        mono title={skill.name} sub={facts}
        back={{ to: '/i/$inst/skills', params: { inst }, search: { profile: profile === 'default' ? undefined : profile } }}
        actions={(
          <>
            {canToggle && (
              skill.enabled
                ? <Button variant="ghost" className="!text-bad hover:!bg-bad-soft" disabled={toggle.isPending || busy} onClick={() => toggle.mutate()}>Désactiver</Button>
                : <Button disabled={toggle.isPending || busy} onClick={() => toggle.mutate()}>Activer</Button>
            )}
            {can('lock') && (
              <Button disabled={lock.isPending || busy} onClick={() => lock.mutate()}
                title={skill.locked ? 'L’agent pourra de nouveau le modifier' : 'L’agent et le curateur ne pourront plus le modifier ; vous, si'}>
                {skill.locked ? <><LockOpen className={ICON} strokeWidth={1.5} />Déverrouiller</> : <><Lock className={ICON} strokeWidth={1.5} />Verrouiller</>}
              </Button>
            )}
            {own && can('archive') && (
              <Button variant="danger" disabled={busy || archive.isPending} aria-label={`Archiver ${skill.name}`}
                onClick={async () => {
                  if (await ask({
                    title: `Archiver ${skill.name} ?`, confirmLabel: 'Archiver', danger: true,
                    message: 'Il sera retiré de l’agent. Hermes le garde dans skills/.archive (restauration par hermes curator restore).',
                  })) archive.mutate();
                }}>
                <Archive className={ICON} strokeWidth={1.5} />Archiver
              </Button>
            )}
            {skill.provenance === 'hub' && can('uninstall') && can('actionStatus') && (
              <Button variant="danger" disabled={busy || uninstall.isPending} aria-label={`Désinstaller ${skill.name}`}
                onClick={async () => { if (await ask({ title: `Désinstaller ${skill.name} de cet agent ?`, confirmLabel: 'Désinstaller', danger: true })) uninstall.mutate(); }}>
                <Trash2 className={ICON} strokeWidth={1.5} />Désinstaller
              </Button>
            )}
          </>
        )}
      />
      <DetailBody className="gap-4">
        <div className="empty:hidden"><ErrorText error={toggle.error ?? uninstall.error ?? lock.error ?? archive.error} /></div>
        {skill.description && <p className="text-[15px]">{skill.description}</p>}
        {can('content') ? (
          <SkillContent inst={inst} profile={profile} name={skill.name} editable={own && can('putContent')} />
        ) : <p className="text-sm text-ink-faint">Lecture du SKILL.md indisponible sur cette instance</p>}
      </DetailBody>
    </article>
  );
}

function Toolsets({ inst, profile, onClose }: { inst: string; profile: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['toolsets', inst, profile], queryFn: () => api.toolsets(inst, profile).then((r) => r.toolsets) });
  const on = q.data?.filter((t) => t.enabled).length;
  return (
    <section aria-label="Outils de l’agent">
      <DetailHeader
        title="Outils de l’agent"
        meta={q.data ? `${on}/${q.data.length} actifs · agent ${profile}` : `agent ${profile}`}
        actions={<Button variant="ghost" className="w-[34px] px-0" onClick={onClose} aria-label="Fermer"><X className={ICON} strokeWidth={1.5} /></Button>}
      />
      <DetailBody>
        {q.data ? (
          <ul className="card overflow-hidden">
            {q.data.map((t, i) => (
              <li key={t.name} className={cx('flex items-start gap-3.5 px-4 py-3', i > 0 && 'border-t border-line/70')}>
                <Mark state={t.enabled ? 'full' : null} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-sm"><span className={t.enabled ? 'font-medium text-ink' : 'text-ink-soft'}>{t.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">{t.name}{t.configured === false ? ' · non configuré' : ''}</span></p>
                  {t.tools.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{t.tools.join(' · ')}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : q.error ? <ErrorText error={q.error} /> : <p className="text-sm text-ink-faint">Chargement…</p>}
      </DetailBody>
    </section>
  );
}

function HubDetail({ result, inst, profile, canInstall, actions, onClose }: {
  result: HubResult; inst: string; profile: string; canInstall: boolean; actions: Actions; onClose: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const busy = actions.busy(result.identifier);
  return (
    <article aria-label={result.name} data-hub={result.identifier}>
      <DetailHeader
        mono title={result.name} meta={result.identifier}
        actions={(
          <>
            {canInstall && !result.installed && !installing && (
              <Button variant="primary" disabled={busy} onClick={() => setInstalling(true)}>
                <Download className={ICON} strokeWidth={1.5} />Installer
              </Button>
            )}
            {result.installed && <Tag className="text-ok">installé</Tag>}
            <Button variant="ghost" className="w-[34px] px-0 md:hidden" onClick={onClose} aria-label="Fermer"><X className={ICON} strokeWidth={1.5} /></Button>
          </>
        )}
      />
      <DetailBody>
        {result.description && <p className="text-[15px]">{result.description}</p>}
        <Facts items={[
          { label: 'Source', value: result.source ?? '-' },
          { label: 'Confiance', value: result.trust ?? '-' },
          ...(result.repo ? [{ label: 'Dépôt', value: result.repo, mono: true }] : []),
          ...(result.tags.length ? [{ label: 'Étiquettes', value: result.tags.join(', ') }] : []),
        ]} />
        {installing && <InstallPanel result={result} inst={inst} profile={profile} actions={actions} onClose={() => setInstalling(false)} />}
      </DetailBody>
    </article>
  );
}

// ---------------------------------------------------------------- page

export function SkillsPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as SkillsSearch;
  const profile = search.profile ?? 'default';
  return <SkillsView key={`${inst}:${profile}`} inst={inst} profile={profile} picked={search.skill} />;
}

function SkillsView({ inst, profile, picked }: { inst: string; profile: string; picked: string | undefined }) {
  const navigate = useNavigate();
  const profiles = useQuery({ queryKey: ['profiles', inst], queryFn: () => api.profiles(inst).then((r) => r.profiles) });
  const a = useModuleAvailability(inst, 'skills', REQUIRED, OPTIONAL);
  const can = (op: string) => a.has('skills', op);
  const actions = useSkillActions(inst, profile);
  const [tab, setTab] = useState<'installed' | 'hub'>('installed');
  const [tools, setTools] = useState(false);
  const [creating, setCreating] = useState(false);
  const names = profiles.data ?? ['default'];
  const options = names.includes(profile) ? names : [...names, profile];
  const profileSearch = profile === 'default' ? undefined : profile;

  // installed
  const skills = useQuery({ queryKey: ['skills', inst, profile], queryFn: () => api.skills(inst, profile).then((r) => r.skills), enabled: a.available });
  const [f, setF] = useState<SkillFilter>({ text: '', category: '', state: 'all' });
  const update = useMutation({
    mutationFn: () => api.updateSkills(inst, profile),
    onSuccess: ({ action }) => actions.track(action, 'Mise à jour des skills du hub', '*'),
  });
  const all = skills.data ?? [];
  const shown = useMemo(() => groupByCategory(filterSkills(all, f)), [all, f]);
  const count = shown.reduce((n, g) => n + g.skills.length, 0);
  const canUpdate = can('update') && can('actionStatus') && all.some((s) => s.provenance === 'hub');
  const selected = pickSelected(all, picked, (s) => s.name);

  // hub
  const [hubText, setHubText] = useState('');
  const [q, setQ] = useState('');
  const [hubSel, setHubSel] = useState<string | null>(null);
  const official = useQuery({ queryKey: ['hub', inst, profile, 'official'], queryFn: () => api.hubOfficial(inst, profile), enabled: tab === 'hub' && !q && can('hubOfficial') });
  const hubSearch = useQuery({ queryKey: ['hub', inst, profile, 'search', q], queryFn: () => api.hubSearch(inst, profile, q), enabled: tab === 'hub' && Boolean(q), staleTime: 60_000 });
  const hub = q ? hubSearch : official;
  const results = hub.data?.results ?? [];
  const canInstall = can('install') && can('hubScan') && can('actionStatus');
  const hubPicked = results.find((r) => r.identifier === hubSel) ?? null;

  const note = 'px-3.5 py-6 text-sm text-ink-faint';
  const tabs = [
    { key: 'installed' as const, label: 'Installés', count: skills.data ? all.length : undefined },
    ...(can('hubOfficial') || can('hubSearch') ? [{ key: 'hub' as const, label: 'Hub' }] : []),
  ];

  const list = (
    <ListPane
      title="Skills"
      action={options.length > 1 ? (
        <select className={cx(SELECT, 'h-[34px] flex-none font-mono')} value={profile} aria-label="Agent"
          onChange={(e) => void navigate({ to: '/i/$inst/skills', params: { inst }, search: { profile: e.target.value === 'default' ? undefined : e.target.value } })}>
          {options.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : undefined}
      head={a.available ? (
        <>
          {tabs.length > 1 && <Chips role="tab" label="Skills" items={tabs} value={tab} onChange={(k) => { setTab(k); setTools(false); }} />}
          {tab === 'installed' ? (
            <>
              <label className={SEARCH_BOX}>
                <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <input type="search" placeholder="Filtrer" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label="Filtrer les skills" className={SEARCH_INPUT} />
              </label>
              <div className="flex gap-1.5">
                <select className={SELECT} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Catégorie">
                  <option value="">Toutes les catégories</option>
                  {categories(all).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className={SELECT} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as StateFilter })} aria-label="État">
                  <option value="all">Actifs et inactifs</option>
                  <option value="on">Actifs</option>
                  <option value="off">Inactifs</option>
                </select>
              </div>
            </>
          ) : can('hubSearch') ? (
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); setQ(hubText.trim()); setHubSel(null); }}>
              <label className={cx(SEARCH_BOX, 'min-w-0 flex-1')}>
                <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <input type="search" placeholder="pdf, notion, git…" value={hubText} onChange={(e) => setHubText(e.target.value)} aria-label="Recherche dans le hub" maxLength={200} className={SEARCH_INPUT} />
              </label>
              <Button type="submit" disabled={!hubText.trim() || hubSearch.isFetching}>Chercher</Button>
            </form>
          ) : null}
        </>
      ) : undefined}
      footer={a.available && tab === 'installed' && (can('toolsets') || canUpdate || can('create')) ? (
        <div className="sticky bottom-0 flex flex-col gap-0.5 border-t border-line/70 bg-sheet px-2 py-2">
          {can('create') && (
            <button type="button" onClick={() => setCreating(true)}
              className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink">
              <Plus className={ICON} strokeWidth={1.5} />Nouveau skill
            </button>
          )}
          {can('toolsets') && (
            <button type="button" onClick={() => setTools(true)} aria-pressed={tools}
              className={cx('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink', tools && 'bg-raised text-ink')}>
              <Wrench className={ICON} strokeWidth={1.5} />Outils de l’agent
            </button>
          )}
          {canUpdate && (
            <button type="button" disabled={actions.busy('*') || update.isPending} onClick={() => update.mutate()}
              className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
              <RefreshCw className={ICON} strokeWidth={1.5} />Mettre à jour les skills du hub
            </button>
          )}
        </div>
      ) : undefined}
    >
      {tab === 'installed' ? (
        <>
          <div className="empty:hidden"><ErrorText error={update.error ?? skills.error} /></div>
          {skills.isPending && a.available && <p className={note}>Chargement…</p>}
          {skills.isSuccess && all.length === 0 && <p className={note}>Aucun skill pour cet agent</p>}
          {skills.isSuccess && all.length > 0 && count === 0 && <p className={note}>Aucun skill ne correspond au filtre</p>}
          {shown.map((g) => (
            <section key={g.category || '-'} aria-label={g.category || 'sans catégorie'}>
              <ListLabel>{g.category || 'sans catégorie'}</ListLabel>
              <ul className="flex flex-col gap-0.5">
                {g.skills.map((s) => {
                  const on = !tools && selected?.name === s.name;
                  return (
                    <li key={s.name} data-skill-item={s.name}>
                      <ListLink link={{ to: '/i/$inst/skills', params: { inst }, search: { profile: profileSearch, skill: s.name } }} selected={on} onClick={() => setTools(false)}>
                        <ListItemBody
                          mono
                          title={<span className={cx(s.enabled === false && 'text-ink-faint')}>{s.name}</span>}
                          meta={<Tag className={cx(on && 'bg-sheet', s.enabled === false && 'text-ink-faint')}>{s.enabled === false ? 'inactif' : provenanceLabel(s.provenance)}</Tag>}
                          sub={s.description}
                        />
                      </ListLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <>
          {q && <ListLabel>Résultats pour <span className="font-mono">{q}</span> · <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => { setQ(''); setHubText(''); setHubSel(null); }}>catalogue officiel</button></ListLabel>}
          {!q && can('hubOfficial') && <ListLabel>Catalogue officiel</ListLabel>}
          <ErrorText error={hub.error} />
          {hub.data?.timedOut.length ? <p className="px-3.5 py-2 text-[13px] text-warn">Sources sans réponse : {hub.data.timedOut.join(', ')}</p> : null}
          {hub.isFetching && !hub.data && <p className={note}>{q ? 'Recherche dans le hub… (environ 10 secondes)' : 'Chargement…'}</p>}
          {hub.isSuccess && results.length === 0 && <p className={note}>Aucun résultat</p>}
          <ul className="flex flex-col gap-0.5" aria-label="Hub">
            {results.map((r) => {
              const on = hubPicked?.identifier === r.identifier;
              return (
                <li key={r.identifier} data-hub-item={r.identifier}>
                  <button type="button" className={listItemClass(on)} aria-current={on ? 'true' : undefined} onClick={() => setHubSel(r.identifier)}>
                    <ListItemBody
                      mono title={r.name}
                      meta={<Tag className={cx(on && 'bg-sheet', r.installed && 'text-ok')}>{r.installed ? 'installé' : r.trust ?? r.source ?? 'hub'}</Tag>}
                      sub={r.description}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ListPane>
  );

  const detail = tools ? (
    <Toolsets inst={inst} profile={profile} onClose={() => setTools(false)} />
  ) : tab === 'hub' ? (
    hubPicked
      ? <HubDetail key={hubPicked.identifier} result={hubPicked} inst={inst} profile={profile} canInstall={canInstall} actions={actions} onClose={() => setHubSel(null)} />
      : <Empty icon={<Download strokeWidth={1.5} />} title="Le hub des skills">Choisissez un skill dans la liste pour lire sa fiche et l’installer ; un scan de sécurité passe avant chaque installation.</Empty>
  ) : selected ? (
    <SkillDetail key={selected.name} skill={selected} inst={inst} profile={profile} can={can} actions={actions} />
  ) : skills.isSuccess && all.length === 0 ? (
    <Empty icon={<Layers strokeWidth={1.5} />} title="Aucun skill pour cet agent"
      actions={can('hubOfficial') ? <Button variant="primary" onClick={() => setTab('hub')}><Search className={ICON} strokeWidth={1.5} />Chercher dans le hub</Button> : undefined}>
      Un skill apprend une méthode à l’agent : installez-en depuis le hub{can('create') ? ', ou écrivez le vôtre' : ''}.
    </Empty>
  ) : null;

  return (
    <SplitView label="Skills" list={list} selected={Boolean(picked) || tools || (tab === 'hub' && hubPicked !== null)}>
      <div className="px-4 pt-5 empty:hidden md:px-6">
        <ModuleNotice instanceId={inst} module="skills" title="La console des skills" required={REQUIRED} optional={OPTIONAL} explainMissing />
      </div>
      <div className="px-4 pt-4 empty:hidden md:px-6"><ActionsStrip actions={actions} /></div>
      {a.available && detail}
      {creating && (
        <NewSkill inst={inst} profile={profile} onClose={() => setCreating(false)} onCreated={(sk) => {
          setCreating(false); setTab('installed'); setTools(false);
          void navigate({ to: '/i/$inst/skills', params: { inst }, search: { profile: profileSearch, skill: sk.name } });
        }} />
      )}
    </SplitView>
  );
}
