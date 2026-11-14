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
import { plural, t } from '../i18n';
import { T } from '../i18n/T';

const REQUIRED: OpRef[] = [['skills', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['skills', 'toggle', t('Activer ou désactiver')], ['skills', 'content', t('Lire le SKILL.md')], ['skills', 'hubOfficial', t('Catalogue officiel')],
  ['skills', 'hubSearch', t('Rechercher dans le hub')], ['skills', 'hubScan', t('Installer')], ['skills', 'install', t('Installer')],
  ['skills', 'uninstall', t('Désinstaller')], ['skills', 'update', t('Mettre à jour')], ['skills', 'actionStatus', t('Installer, désinstaller, mettre à jour')],
  ['skills', 'toolsets', t("Outils de l'agent")], ['skills', 'create', t('Nouveau skill')], ['skills', 'putContent', t('Modifier un skill')],
  ['skills', 'lock', t('Verrouiller')], ['skills', 'archive', t('Archiver')],
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
            ? t('{label} : échec, {line}', { label: p.label, line: failureLine(status.lines) })
            : t('{label} : {state}', { label: p.label, state: STATE_TEXT[state as Exclude<ActionState, 'failed'>] }),
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
    <ul className="space-y-1.5 rounded-[10px] bg-paper px-4 py-3" aria-label={t('Actions')} role="status">
      {actions.pending.map((p) => (
        <li key={p.action} className="flex items-center gap-2 font-mono text-[12px] text-ink-soft">
          <Mark state="readonly" className="animate-pulse" />{t('{label} : en cours…', { label: p.label })}
        </li>
      ))}
      {done.map(([target, o]) => (
        <li key={target} className={cx('flex items-center gap-2 font-mono text-[12px]', o.state === 'failed' ? 'text-bad' : 'text-ink-soft')}>
          <Mark state={o.state === 'done' ? 'full' : o.state === 'failed' ? 'unavailable' : 'readonly'} />
          <span className="min-w-0 flex-1">{o.text}</span>
          <button type="button" className="text-ink-faint hover:text-ink" aria-label={t('Masquer')} onClick={() => actions.dismiss(target)}>
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}

const VERDICT: Record<string, { text: string; icon: typeof ShieldCheck; cls: string }> = {
  allow: { text: t('Scan sans alerte'), icon: ShieldCheck, cls: 'text-ok' },
  ask: { text: t('Le scan demande de la prudence'), icon: ShieldAlert, cls: 'text-warn' },
  block: { text: t('Installation refusée par le scan'), icon: ShieldX, cls: 'text-bad' },
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
    onSuccess: ({ action }) => { actions.track(action, t('Installation de {name}', { name: result.name }), result.identifier); onClose(); },
  });
  const s = scanOf(install.error) ?? scan.data;
  const v = s ? VERDICT[s.policy] ?? { text: t('Résultat inconnu : {policy}', { policy: s.policy }), icon: ShieldX, cls: 'text-bad' } : null;
  const counts = s ? Object.entries(s.counts).filter(([, n]) => n > 0) : [];

  return (
    <div className="card p-4 text-sm">
      {scan.isPending && !s ? <p className="text-ink-faint">{t('Scan de sécurité en cours…')}</p> : scan.error && !s ? <ErrorText error={scan.error} /> : s && v && (
        <div className="space-y-3">
          <p className={cx('flex items-center gap-2 font-medium', v.cls)}><v.icon className={ICON} strokeWidth={1.5} />{v.text}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-faint">{t('Source')}</dt><dd>{result.source ?? '-'}{result.repo ? ` · ${result.repo}` : ''}</dd>
            <dt className="text-ink-faint">{t('Confiance')}</dt><dd>{s.trust ?? result.trust ?? '-'}</dd>
            <dt className="text-ink-faint">{t('Verdict')}</dt><dd>{s.verdict}{counts.length ? ` (${counts.map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}</dd>
            {s.reason && <><dt className="text-ink-faint">{t('Raison')}</dt><dd>{s.reason}</dd></>}
          </dl>
          {s.findings.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto font-mono text-[12px] text-ink-soft">
              {s.findings.map((f, i) => <li key={i}>{String(f.severity ?? '')} {String(f.message ?? f.description ?? f.rule ?? JSON.stringify(f))}</li>)}
            </ul>
          )}
          {s.policy === 'ask' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
              {t('J’ai lu les constats')}
            </label>
          )}
          <ErrorText error={scanOf(install.error) ? null : install.error} />
          <div className="flex gap-2">
            {(s.policy === 'allow' || s.policy === 'ask') && (
              <Button variant="primary" disabled={install.isPending || (s.policy === 'ask' && !ack)} onClick={() => install.mutate()}>
                <Download className={ICON} strokeWidth={1.5} />
                {install.isPending ? t('Analyse et lancement…') : s.policy === 'ask' ? t('Installer quand même') : t('Installer')}
              </Button>
            )}
            <Button onClick={onClose}>{t('Fermer')}</Button>
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
    onSuccess: ({ action }) => actions.track(action, t('Désinstallation de {name}', { name: skill.name }), skill.name),
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
  const facts = [provenanceLabel(skill.provenance), skill.category, skill.usage ? plural(skill.usage, '{n} usage', '{n} usages', { n: skill.usage }) : null, skill.enabled === false ? t('inactif') : null, skill.locked ? t('verrouillé') : null]
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
                ? <Button variant="ghost" className="!text-bad hover:!bg-bad-soft" disabled={toggle.isPending || busy} onClick={() => toggle.mutate()}>{t('Désactiver')}</Button>
                : <Button disabled={toggle.isPending || busy} onClick={() => toggle.mutate()}>{t('Activer')}</Button>
            )}
            {can('lock') && (
              <Button disabled={lock.isPending || busy} onClick={() => lock.mutate()}
                title={skill.locked ? t('L’agent pourra de nouveau le modifier') : t('L’agent et le curateur ne pourront plus le modifier ; vous, si')}>
                {skill.locked ? <><LockOpen className={ICON} strokeWidth={1.5} />{t('Déverrouiller')}</> : <><Lock className={ICON} strokeWidth={1.5} />{t('Verrouiller')}</>}
              </Button>
            )}
            {own && can('archive') && (
              <Button variant="danger" disabled={busy || archive.isPending} aria-label={t('Archiver {name}', { name: skill.name })}
                onClick={async () => {
                  if (await ask({
                    title: t('Archiver {name} ?', { name: skill.name }), confirmLabel: t('Archiver'), danger: true,
                    message: t('Il sera retiré de l’agent. Hermes le garde dans skills/.archive (restauration par hermes curator restore).'),
                  })) archive.mutate();
                }}>
                <Archive className={ICON} strokeWidth={1.5} />{t('Archiver')}
              </Button>
            )}
            {skill.provenance === 'hub' && can('uninstall') && can('actionStatus') && (
              <Button variant="danger" disabled={busy || uninstall.isPending} aria-label={t('Désinstaller {name}', { name: skill.name })}
                onClick={async () => { if (await ask({ title: t('Désinstaller {name} de cet agent ?', { name: skill.name }), confirmLabel: t('Désinstaller'), danger: true })) uninstall.mutate(); }}>
                <Trash2 className={ICON} strokeWidth={1.5} />{t('Désinstaller')}
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
        ) : <p className="text-sm text-ink-faint">{t('Lecture du SKILL.md indisponible sur cette instance')}</p>}
      </DetailBody>
    </article>
  );
}

function Toolsets({ inst, profile, onClose }: { inst: string; profile: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['toolsets', inst, profile], queryFn: () => api.toolsets(inst, profile).then((r) => r.toolsets) });
  const on = q.data?.filter((ts) => ts.enabled).length;
  return (
    <section aria-label={t('Outils de l’agent')}>
      <DetailHeader
        title={t('Outils de l’agent')}
        meta={q.data ? t('{on}/{total} actifs · agent {profile}', { on: on ?? 0, total: q.data.length, profile }) : t('agent {profile}', { profile })}
        actions={<Button variant="ghost" className="w-[34px] px-0" onClick={onClose} aria-label={t('Fermer')}><X className={ICON} strokeWidth={1.5} /></Button>}
      />
      <DetailBody>
        {q.data ? (
          <ul className="card overflow-hidden">
            {q.data.map((ts, i) => (
              <li key={ts.name} className={cx('flex items-start gap-3.5 px-4 py-3', i > 0 && 'border-t border-line/70')}>
                <Mark state={ts.enabled ? 'full' : null} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-sm"><span className={ts.enabled ? 'font-medium text-ink' : 'text-ink-soft'}>{ts.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">{ts.name}{ts.configured === false ? ` · ${t('non configuré')}` : ''}</span></p>
                  {ts.tools.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{ts.tools.join(' · ')}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : q.error ? <ErrorText error={q.error} /> : <p className="text-sm text-ink-faint">{t('Chargement…')}</p>}
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
                <Download className={ICON} strokeWidth={1.5} />{t('Installer')}
              </Button>
            )}
            {result.installed && <Tag className="text-ok">{t('installé')}</Tag>}
            <Button variant="ghost" className="w-[34px] px-0 md:hidden" onClick={onClose} aria-label={t('Fermer')}><X className={ICON} strokeWidth={1.5} /></Button>
          </>
        )}
      />
      <DetailBody>
        {result.description && <p className="text-[15px]">{result.description}</p>}
        <Facts items={[
          { label: t('Source'), value: result.source ?? '-' },
          { label: t('Confiance'), value: result.trust ?? '-' },
          ...(result.repo ? [{ label: t('Dépôt'), value: result.repo, mono: true }] : []),
          ...(result.tags.length ? [{ label: t('Étiquettes'), value: result.tags.join(', ') }] : []),
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
    onSuccess: ({ action }) => actions.track(action, t('Mise à jour des skills du hub'), '*'),
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
    { key: 'installed' as const, label: t('Installés'), count: skills.data ? all.length : undefined },
    ...(can('hubOfficial') || can('hubSearch') ? [{ key: 'hub' as const, label: t('Hub') }] : []),
  ];

  const list = (
    <ListPane
      title={t('Skills')}
      action={options.length > 1 ? (
        <select className={cx(SELECT, 'h-[34px] flex-none font-mono')} value={profile} aria-label={t('Agent')}
          onChange={(e) => void navigate({ to: '/i/$inst/skills', params: { inst }, search: { profile: e.target.value === 'default' ? undefined : e.target.value } })}>
          {options.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : undefined}
      head={a.available ? (
        <>
          {tabs.length > 1 && <Chips role="tab" label={t('Skills')} items={tabs} value={tab} onChange={(k) => { setTab(k); setTools(false); }} />}
          {tab === 'installed' ? (
            <>
              <label className={SEARCH_BOX}>
                <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <input type="search" placeholder={t('Filtrer')} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label={t('Filtrer les skills')} className={SEARCH_INPUT} />
              </label>
              <div className="flex gap-1.5">
                <select className={SELECT} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label={t('Catégorie')}>
                  <option value="">{t('Toutes les catégories')}</option>
                  {categories(all).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className={SELECT} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as StateFilter })} aria-label={t('État')}>
                  <option value="all">{t('Actifs et inactifs')}</option>
                  <option value="on">{t('Actifs')}</option>
                  <option value="off">{t('Inactifs')}</option>
                </select>
              </div>
            </>
          ) : can('hubSearch') ? (
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); setQ(hubText.trim()); setHubSel(null); }}>
              <label className={cx(SEARCH_BOX, 'min-w-0 flex-1')}>
                <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <input type="search" placeholder={t('pdf, notion, git…')} value={hubText} onChange={(e) => setHubText(e.target.value)} aria-label={t('Recherche dans le hub')} maxLength={200} className={SEARCH_INPUT} />
              </label>
              <Button type="submit" disabled={!hubText.trim() || hubSearch.isFetching}>{t('Chercher')}</Button>
            </form>
          ) : null}
        </>
      ) : undefined}
      footer={a.available && tab === 'installed' && (can('toolsets') || canUpdate || can('create')) ? (
        <div className="sticky bottom-0 flex flex-col gap-0.5 border-t border-line/70 bg-sheet px-2 py-2">
          {can('create') && (
            <button type="button" onClick={() => setCreating(true)}
              className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink">
              <Plus className={ICON} strokeWidth={1.5} />{t('Nouveau skill')}
            </button>
          )}
          {can('toolsets') && (
            <button type="button" onClick={() => setTools(true)} aria-pressed={tools}
              className={cx('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink', tools && 'bg-raised text-ink')}>
              <Wrench className={ICON} strokeWidth={1.5} />{t('Outils de l’agent')}
            </button>
          )}
          {canUpdate && (
            <button type="button" disabled={actions.busy('*') || update.isPending} onClick={() => update.mutate()}
              className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
              <RefreshCw className={ICON} strokeWidth={1.5} />{t('Mettre à jour les skills du hub')}
            </button>
          )}
        </div>
      ) : undefined}
    >
      {tab === 'installed' ? (
        <>
          <div className="empty:hidden"><ErrorText error={update.error ?? skills.error} /></div>
          {skills.isPending && a.available && <p className={note}>{t('Chargement…')}</p>}
          {skills.isSuccess && all.length === 0 && <p className={note}>{t('Aucun skill pour cet agent')}</p>}
          {skills.isSuccess && all.length > 0 && count === 0 && <p className={note}>{t('Aucun skill ne correspond au filtre')}</p>}
          {shown.map((g) => (
            <section key={g.category || '-'} aria-label={g.category || t('sans catégorie')}>
              <ListLabel>{g.category || t('sans catégorie')}</ListLabel>
              <ul className="flex flex-col gap-0.5">
                {g.skills.map((s) => {
                  const on = !tools && selected?.name === s.name;
                  return (
                    <li key={s.name} data-skill-item={s.name}>
                      <ListLink link={{ to: '/i/$inst/skills', params: { inst }, search: { profile: profileSearch, skill: s.name } }} selected={on} onClick={() => setTools(false)}>
                        <ListItemBody
                          mono
                          title={<span className={cx(s.enabled === false && 'text-ink-faint')}>{s.name}</span>}
                          meta={<Tag className={cx(on && 'bg-sheet', s.enabled === false && 'text-ink-faint')}>{s.enabled === false ? t('inactif') : provenanceLabel(s.provenance)}</Tag>}
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
          {q && <ListLabel><T k="Résultats pour {q} · {official}" vars={{ q: <span className="font-mono">{q}</span>, official: <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => { setQ(''); setHubText(''); setHubSel(null); }}>{t('catalogue officiel')}</button> }} /></ListLabel>}
          {!q && can('hubOfficial') && <ListLabel>{t('Catalogue officiel')}</ListLabel>}
          <ErrorText error={hub.error} />
          {hub.data?.timedOut.length ? <p className="px-3.5 py-2 text-[13px] text-warn">{t('Sources sans réponse : {list}', { list: hub.data.timedOut.join(', ') })}</p> : null}
          {hub.isFetching && !hub.data && <p className={note}>{q ? t('Recherche dans le hub… (environ 10 secondes)') : t('Chargement…')}</p>}
          {hub.isSuccess && results.length === 0 && <p className={note}>{t('Aucun résultat')}</p>}
          <ul className="flex flex-col gap-0.5" aria-label={t('Hub')}>
            {results.map((r) => {
              const on = hubPicked?.identifier === r.identifier;
              return (
                <li key={r.identifier} data-hub-item={r.identifier}>
                  <button type="button" className={listItemClass(on)} aria-current={on ? 'true' : undefined} onClick={() => setHubSel(r.identifier)}>
                    <ListItemBody
                      mono title={r.name}
                      meta={<Tag className={cx(on && 'bg-sheet', r.installed && 'text-ok')}>{r.installed ? t('installé') : r.trust ?? r.source ?? 'hub'}</Tag>}
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
      : <Empty icon={<Download strokeWidth={1.5} />} title={t('Le hub des skills')}>{t('Choisissez un skill dans la liste pour lire sa fiche et l’installer ; un scan de sécurité passe avant chaque installation.')}</Empty>
  ) : selected ? (
    <SkillDetail key={selected.name} skill={selected} inst={inst} profile={profile} can={can} actions={actions} />
  ) : skills.isSuccess && all.length === 0 ? (
    <Empty icon={<Layers strokeWidth={1.5} />} title={t('Aucun skill pour cet agent')}
      actions={can('hubOfficial') ? <Button variant="primary" onClick={() => setTab('hub')}><Search className={ICON} strokeWidth={1.5} />{t('Chercher dans le hub')}</Button> : undefined}>
      {can('create') ? t('Un skill apprend une méthode à l’agent : installez-en depuis le hub, ou écrivez le vôtre.') : t('Un skill apprend une méthode à l’agent : installez-en depuis le hub.')}
    </Empty>
  ) : null;

  return (
    <SplitView label={t('Skills')} list={list} selected={Boolean(picked) || tools || (tab === 'hub' && hubPicked !== null)}>
      <div className="px-4 pt-5 empty:hidden md:px-6">
        <ModuleNotice instanceId={inst} module="skills" title={t('La console des skills')} required={REQUIRED} optional={OPTIONAL} explainMissing />
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
