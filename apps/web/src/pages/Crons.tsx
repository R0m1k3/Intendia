import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { CalendarClock, FolderOpen, LayoutTemplate, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api, type Cron } from '../api';
import { CronEditor } from '../components/CronEditor';
import { CronFollower, CronRuns, type FollowResult } from '../components/CronRuns';
import { ask } from '../components/Dialog';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { DetailBody, DetailHeader, Empty, Facts, ListItemBody, ListLink, ListPane, SplitView } from '../components/Panes';
import { cronKey, pickSelected } from '../components/selection';
import { Button, cx, ErrorText, Tag } from '../components/ui';
import { Blueprints } from '../crons/Blueprints';
import { snapshot, statusLabel, type FollowSnapshot } from '../crons/follow';
import { describe, hermesDayDiff, hermesParts, offsetOf, whenFr } from '../crons/schedule';
import { locale, plural, t } from '../i18n';
import type { CronsSearch } from '../main';

const REQUIRED: OpRef[] = [['crons', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['crons', 'create', t('Créer')], ['crons', 'update', t('Modifier')], ['crons', 'pause', t('Mettre en pause')],
  ['crons', 'resume', t('Mettre en pause')], ['crons', 'trigger', t('Lancer')], ['crons', 'cancel', t('Annuler un run')],
  ['crons', 'runs', t('Historique')], ['crons', 'remove', t('Supprimer')], ['crons', 'blueprints', t('Depuis un modèle')],
  ['crons', 'instantiate', t('Depuis un modèle')],
];

const ICON = 'size-4';

/** Next run in the list: the hour today ("13:15"), else the date ("12 nov."), in Hermes's wall clock. */
function nextShort(iso: string | null): string {
  if (!iso) return '';
  const p = hermesParts(iso);
  if (!p) return '';
  const diff = hermesDayDiff(iso)?.diff;
  if (diff === 0) return p.time;
  if (diff === 1) return t('demain {time}', { time: p.time });
  return new Date(Date.UTC(p.y, p.mo - 1, p.d)).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The schedule as Hermes holds it, for the mono line of the detail. */
function expression(c: Cron): string {
  const s = c.schedule;
  if (s.expr) return s.expr;
  if (s.kind === 'interval' && s.minutes) return s.minutes % 60 === 0 ? `every ${s.minutes / 60}h` : `every ${s.minutes}m`;
  if (s.runAt) return s.runAt;
  return s.display ?? s.kind;
}

/** State tag of a list item: en cours, en pause, échec(s), ok, jamais lancé. */
function StateTag({ cron, running, selected }: { cron: Cron; running: boolean; selected: boolean }) {
  const last = statusLabel(cron.lastStatus);
  const ground = selected ? 'bg-sheet' : undefined;
  if (running) return <Tag className={cx('text-accent-ink', ground)}>{t('en cours')}</Tag>;
  if (!cron.enabled) return <Tag className={ground}>{t('en pause')}</Tag>;
  if (last.ok === false) {
    const n = Math.max(1, cron.failureStreak);
    return <Tag className={cx('text-bad', ground)} title={cron.lastError ?? undefined}>{plural(n, '{n} échec', '{n} échecs', { n })}</Tag>;
  }
  if (last.ok === true) return <Tag className={cx('text-ok', ground)}>ok</Tag>;
  return <Tag className={ground}>{cron.lastStatus === null ? t('jamais lancé') : last.label}</Tag>;
}

/** The advanced options set on a cron, for the detail facts (context crons by name when known). */
function advancedFacts(cron: Cron, all: Cron[]): { label: string; value: string; mono?: boolean }[] {
  const out: { label: string; value: string; mono?: boolean }[] = [];
  if (cron.repeat) out.push({ label: t('Répétition'), value: t('{done} / {total} runs', { done: cron.repeatCompleted, total: cron.repeat }) });
  if (cron.timezone) out.push({ label: t('Fuseau horaire'), value: cron.timezone, mono: true });
  if (cron.enabledToolsets?.length) out.push({ label: t('Outils permis'), value: cron.enabledToolsets.join(', '), mono: true });
  if (cron.catchUp !== null || cron.graceMinutes !== null) {
    const what = cron.catchUp === null ? t('par défaut') : cron.catchUp ? t('oui') : t('non');
    out.push({ label: t('Rattrapage'), value: cron.graceMinutes !== null ? t('{what} · grâce {n} min', { what, n: cron.graceMinutes }) : what });
  }
  if (cron.contextFrom.length) {
    out.push({ label: t('Contexte de'), value: cron.contextFrom.map((id) => all.find((c) => c.id === id && c.profile === cron.profile)?.name || id).join(', ') });
  }
  return out;
}

function CronDetail({ cron, all, instanceLabel, can, follow, result, onFollow, onEdit, onRemoved }: {
  cron: Cron; all: Cron[]; instanceLabel: string; can: (op: string) => boolean; follow: FollowSnapshot | null; result: FollowResult | null;
  onFollow: (s: FollowSnapshot) => void; onEdit: () => void; onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['crons', cron.instanceId] });
    await qc.invalidateQueries({ queryKey: ['crons-overview'] });
  };
  const toggle = useMutation({
    mutationFn: () => api.cronAction(cron.instanceId, cron.id, cron.profile, cron.enabled ? 'pause' : 'resume'),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCron(cron.instanceId, cron.id, cron.profile),
    onSuccess: async () => { onRemoved(); await refresh(); },
  });
  const trigger = useMutation({
    mutationFn: async () => {
      // snapshot before the click, from a fresh read: the list may predate a scheduled run, whose newer
      // last_run_at would then end the follow-up at once. The run is over when Hermes writes a new last_run_at
      const [fresh, runs] = await Promise.all([
        api.cron(cron.instanceId, cron.id, cron.profile).then((r) => r.cron),
        can('runs') ? api.cronRuns(cron.instanceId, cron.id, cron.profile).then((r) => r.runs) : Promise.resolve([]),
      ]);
      const snap = snapshot(fresh, runs);
      await api.cronAction(cron.instanceId, cron.id, cron.profile, 'trigger');
      return snap;
    },
    onSuccess: (snap) => onFollow(snap),
  });
  const last = statusLabel(cron.lastStatus);
  const running = follow !== null;

  return (
    <article aria-label={cron.name || t('(sans nom)')} data-cron={cronKey(cron)}>
      <DetailHeader
        title={cron.name || t('(sans nom)')}
        meta={t('{expr} · {instance} · agent {profile}', { expr: expression(cron), instance: instanceLabel, profile: cron.profile })}
        back={{ to: '/i/$inst/crons', params: { inst: cron.instanceId } }}
        actions={(
          <>
            {can(cron.enabled ? 'pause' : 'resume') && (
              <Button onClick={() => toggle.mutate()} disabled={toggle.isPending} aria-label={cron.enabled ? t('Mettre en pause') : t('Reprendre')}>
                {cron.enabled ? t('Mettre en pause') : t('Reprendre')}
              </Button>
            )}
            {can('trigger') && (
              <Button variant="dark" onClick={() => trigger.mutate()} disabled={trigger.isPending || running}>
                {running ? t('En cours…') : t('Lancer maintenant')}
              </Button>
            )}
            {can('update') && (
              <Button variant="ghost" className="w-[34px] px-0" onClick={onEdit} title={t('Modifier')} aria-label={t('Modifier')}>
                <Pencil className={ICON} strokeWidth={1.5} />
              </Button>
            )}
            {can('remove') && (
              <Button variant="ghost" className="w-[34px] px-0 hover:text-bad" title={t('Supprimer')} aria-label={t('Supprimer')} disabled={remove.isPending}
                onClick={async () => { if (await ask({ title: t('Supprimer le cron « {name} » ?', { name: cron.name }), message: t('Hermes l’oublie définitivement ; les fichiers déjà produits restent.'), confirmLabel: t('Supprimer'), danger: true })) remove.mutate(); }}>
                <Trash2 className={ICON} strokeWidth={1.5} />
              </Button>
            )}
          </>
        )}
      />
      <DetailBody>
        <div className="empty:hidden"><ErrorText error={toggle.error ?? remove.error ?? trigger.error} /></div>
        <Facts items={[
          { label: t('Fréquence'), value: describe(cron.schedule) },
          { label: t('Prochaine exécution'), value: cron.enabled ? whenFr(cron.nextRunAt) : t('en pause') },
          {
            label: t('Dernière exécution'),
            value: running ? t('en cours…') : <>{last.label}{cron.lastRunAt ? ` · ${whenFr(cron.lastRunAt)}` : ''}</>,
            className: cx(!running && last.ok === false && 'text-bad', !running && last.ok === true && 'text-ok'),
          },
          { label: t('Livraison'), value: cron.deliver ?? 'local', mono: true },
          ...(cron.model ? [{ label: t('Modèle'), value: cron.model, mono: true }] : []),
          ...(cron.skills.length ? [{ label: t('Skills'), value: cron.skills.join(', '), mono: true }] : []),
          ...advancedFacts(cron, all),
          ...(cron.workspace ? [{
            label: t('Workspace'),
            value: cron.workspace.missing
              ? <span className="text-warn">{t('workspace supprimé ({slug})', { slug: cron.workspace.slug })}</span>
              : (
                <Link to="/w/$slug/fichiers" params={{ slug: cron.workspace.slug }} search={{ path: `crons/${cron.workspace.folder}`, f: undefined }}
                  className="inline-flex items-center gap-1 font-mono text-[13px] underline-offset-2 hover:underline">
                  <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.5} />{cron.workspace.name}/crons/{cron.workspace.folder}
                </Link>
              ),
          }] : []),
        ]} />
        {cron.lastError && !running && (
          <p className="break-words rounded-[10px] bg-bad-soft px-4 py-3 font-mono text-xs text-bad">{cron.lastError}</p>
        )}
        <section aria-labelledby={`prompt-${cron.id}`}>
          <h3 id={`prompt-${cron.id}`} className="text-[15px] font-semibold">{t('Consigne envoyée à l’agent')}</h3>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-[10px] bg-paper px-4 py-3.5 text-sm">{cron.prompt || t('(vide)')}</p>
        </section>
        <CronRuns cron={cron} follow={follow} result={result} canRuns={can('runs')} canCancel={can('cancel')} />
      </DetailBody>
    </article>
  );
}

export function CronsPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as CronsSearch;
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'crons', REQUIRED, OPTIONAL);
  const crons = useQuery({ queryKey: ['crons', inst], queryFn: () => api.crons(inst).then((r) => r.crons), enabled: a.available });
  const [editing, setEditing] = useState<Cron | 'new' | 'blueprint' | null>(null);
  // a template cron whose workspace framing failed: said above its detail
  const [unattached, setUnattached] = useState<{ key: string; workspace: string } | null>(null);
  // another instance chosen while editing: the form belonged to the previous one, close it
  const [editingInst, setEditingInst] = useState(inst);
  if (editingInst !== inst) { setEditingInst(inst); setEditing(null); }
  const [text, setText] = useState('');
  // follow-ups and their outcome live here, above the list and the detail: changing the selection keeps them
  const [follows, setFollows] = useState<Record<string, { cron: Cron; snap: FollowSnapshot }>>({});
  const [results, setResults] = useState<Record<string, FollowResult>>({});

  const current = (instances.data?.instances ?? []).find((i) => i.id === inst);
  const items = crons.data ?? [];
  const offset = offsetOf(items.find((c) => c.nextRunAt)?.nextRunAt);
  const can = (op: string) => a.has('crons', op);
  const needle = text.trim().toLowerCase();
  const shown = needle ? items.filter((c) => `${c.name} ${c.prompt}`.toLowerCase().includes(needle)) : items;
  const selected = pickSelected(items, search.cron, cronKey);
  const canBlueprints = can('blueprints') && can('instantiate');
  const select = (c: Cron | null) => void navigate({ to: '/i/$inst/crons', params: { inst }, search: c ? { cron: cronKey(c) } : {}, replace: true });

  const list = (
    <ListPane
      title={t('Crons')}
      action={a.available && (can('create') || canBlueprints) ? (
        <span className="flex gap-1.5">
          {canBlueprints && (
            <Button onClick={() => setEditing('blueprint')} title={t('Depuis un modèle')} aria-label={t('Depuis un modèle')} className="w-[34px] px-0">
              <LayoutTemplate className={ICON} strokeWidth={1.5} />
            </Button>
          )}
          {can('create') && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className={ICON} strokeWidth={1.5} />{t('Nouveau')}
            </Button>
          )}
        </span>
      ) : undefined}
      head={items.length > 0 ? (
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 text-ink-faint focus-within:border-ink">
          <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="sr-only">{t('Rechercher un cron')}</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Rechercher')}
            className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint" />
        </label>
      ) : undefined}
    >
      <ErrorText error={crons.error} />
      {a.available && crons.isPending && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Chargement…')}</p>}
      {crons.isSuccess && items.length === 0 && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Aucun cron sur cette instance')}</p>}
      {needle && items.length > 0 && shown.length === 0 && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Aucun cron ne correspond')}</p>}
      <ul className="flex flex-col gap-0.5" aria-label={t('Tâches planifiées')}>
        {shown.map((c) => {
          const k = cronKey(c);
          const on = editing === null && selected !== null && cronKey(selected) === k;
          return (
            <li key={k} data-cron-item={k}>
              <ListLink link={{ to: '/i/$inst/crons', params: { inst }, search: { cron: k } }} selected={on} onClick={() => setEditing(null)}>
                <ListItemBody
                  title={<span className={cx(!c.enabled && 'text-ink-soft')}>{c.name || t('(sans nom)')}</span>}
                  meta={c.enabled ? nextShort(c.nextRunAt) : ''}
                  sub={describe(c.schedule)}
                  tag={<StateTag cron={c} running={Boolean(follows[k])} selected={on} />}
                />
              </ListLink>
            </li>
          );
        })}
      </ul>
    </ListPane>
  );

  const notice = (
    <div className="px-4 pt-5 empty:hidden md:px-6">
      <ModuleNotice instanceId={inst} module="crons" title={t('La console des crons')} required={REQUIRED} optional={OPTIONAL} explainMissing />
    </div>
  );

  return (
    <SplitView label={t('Crons')} list={list} selected={Boolean(search.cron) || editing !== null}>
      {Object.entries(follows).map(([k, f]) => (
        <CronFollower key={k} cron={f.cron} follow={f.snap} canRuns={can('runs')}
          onEnd={(r) => {
            setFollows(({ [k]: _, ...rest }) => rest);
            setResults((x) => ({ ...x, [k]: r }));
          }} />
      ))}
      {editing === 'blueprint' ? (
        <Blueprints key={inst} instanceId={inst} onClose={() => setEditing(null)} onCreated={(c, attached, workspace) => {
          setEditing(null);
          setUnattached(workspace && !attached ? { key: cronKey(c), workspace } : null);
          select(c);
        }} />
      ) : editing ? (
        <CronEditor key={`${inst}:${editing === 'new' ? 'new' : cronKey(editing)}`} instanceId={inst} cron={editing === 'new' ? null : editing} offset={offset}
          onClose={() => setEditing(null)} onSaved={(c) => { if (c && editing === 'new') select(c); }} />
      ) : (
        <>
          {notice}
          {selected && unattached?.key === cronKey(selected) && (
            <div className="px-4 pt-4 md:px-6">
              <p role="alert" className="flex items-start gap-3 rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
                <span className="flex-1">{t('Cron créé, mais pas rattaché au workspace « {workspace} » : modifiez-le pour le rattacher.', { workspace: unattached.workspace })}</span>
                <button type="button" aria-label={t('Masquer')} onClick={() => setUnattached(null)}><X className="size-3.5" strokeWidth={1.5} /></button>
              </p>
            </div>
          )}
          {selected ? (
            <CronDetail all={items}
              key={cronKey(selected)} cron={selected} instanceLabel={current?.label ?? inst} can={can}
              follow={follows[cronKey(selected)]?.snap ?? null} result={results[cronKey(selected)] ?? null}
              onFollow={(snap) => {
                const k = cronKey(selected);
                setResults(({ [k]: _, ...rest }) => rest);
                setFollows((f) => ({ ...f, [k]: { cron: selected, snap } }));
              }}
              onEdit={() => setEditing(selected)}
              onRemoved={() => select(null)}
            />
          ) : crons.isSuccess && items.length === 0 ? (
            <Empty
              icon={<CalendarClock strokeWidth={1.5} />}
              title={t('Aucun cron pour l’instant')}
              actions={can('create') || canBlueprints ? (
                <>
                  {can('create') && <Button variant="primary" onClick={() => setEditing('new')}><Plus className={ICON} strokeWidth={1.5} />{t('Créer un cron')}</Button>}
                  {canBlueprints && <Button onClick={() => setEditing('blueprint')}><LayoutTemplate className={ICON} strokeWidth={1.5} />{t('Depuis un modèle')}</Button>}
                </>
              ) : undefined}
            >
              {offset ? t('Une tâche planifiée envoie une consigne à l’agent à heure fixe (heure d’Hermes, {offset}), et livre le résultat où vous voulez.', { offset }) : t('Une tâche planifiée envoie une consigne à l’agent à heure fixe, et livre le résultat où vous voulez.')}
            </Empty>
          ) : null}
        </>
      )}
    </SplitView>
  );
}
