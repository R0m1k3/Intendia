import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FolderOpen, History, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type Cron } from '../api';
import { CronEditor } from '../components/CronEditor';
import { CronRuns } from '../components/CronRuns';
import { PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Mark, Panel } from '../components/ui';
import { snapshot, statusLabel, type FollowSnapshot } from '../crons/follow';
import { describe, offsetOf, whenFr } from '../crons/schedule';

const REQUIRED: OpRef[] = [['crons', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['crons', 'create', 'Créer'], ['crons', 'update', 'Modifier'], ['crons', 'pause', 'Mettre en pause'],
  ['crons', 'resume', 'Mettre en pause'], ['crons', 'trigger', 'Lancer'], ['crons', 'cancel', 'Annuler un run'],
  ['crons', 'runs', 'Historique'], ['crons', 'remove', 'Supprimer'],
];

const ICON = 'size-4';

function CronRow({ cron, can, open, follow, onOpen, onEdit, onFollow, onFollowEnd }: {
  cron: Cron; can: (op: string) => boolean; open: boolean; follow: FollowSnapshot | null;
  onOpen: () => void; onEdit: () => void; onFollow: (s: FollowSnapshot) => void; onFollowEnd: () => void;
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
  const remove = useMutation({ mutationFn: () => api.deleteCron(cron.instanceId, cron.id, cron.profile), onSuccess: refresh });
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
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-2.5">
            <Mark state={cron.enabled ? 'full' : null} />
            <span className={cx('truncate text-sm font-medium', !cron.enabled && 'text-ink-soft')}>{cron.name || '(sans nom)'}</span>
            {!cron.enabled && <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[11px] text-ink-soft">en pause</span>}
          </div>
          <p className="mt-1 pl-5 text-[13px] text-ink-soft">{describe(cron.schedule)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-5 font-mono text-[11px] text-ink-faint">
            <span>{cron.profile}</span>
            {cron.deliver && <span>→ {cron.deliver}</span>}
            {cron.model && <span>{cron.model}</span>}
            {cron.workspace && (
              cron.workspace.missing
                ? <span className="text-warn">workspace supprimé ({cron.workspace.slug})</span>
                : (
                  <Link to="/w/$slug/fichiers" params={{ slug: cron.workspace.slug }} search={{ path: `crons/${cron.workspace.folder}`, f: undefined }}
                    className="inline-flex items-center gap-1 text-ink-soft hover:text-ink">
                    <FolderOpen className="size-3" strokeWidth={1.5} />{cron.workspace.name}/crons/{cron.workspace.folder}
                  </Link>
                )
            )}
          </p>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 text-[13px] sm:w-80">
          <div>
            <dt className="text-[11px] text-ink-faint">Prochaine</dt>
            <dd>{cron.enabled ? whenFr(cron.nextRunAt) : '-'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-ink-faint">Dernière</dt>
            <dd className={cx('truncate', last.ok === false && 'text-bad', last.ok === true && 'text-ok')} title={cron.lastError ?? undefined}>
              {running ? 'en cours…' : last.label}
              {cron.lastRunAt && !running && <span className="block text-[11px] text-ink-faint">{whenFr(cron.lastRunAt)}</span>}
            </dd>
          </div>
        </dl>
        <div className="flex shrink-0 items-center gap-1">
          {can('trigger') && (
            <Button variant="secondary" className="h-8 px-2.5" onClick={() => trigger.mutate()} disabled={trigger.isPending || running}>
              <Play className={ICON} strokeWidth={1.5} /><span className="text-[13px]">Lancer</span>
            </Button>
          )}
          {can(cron.enabled ? 'pause' : 'resume') && (
            <Button variant="ghost" className="size-8 px-0" onClick={() => toggle.mutate()} disabled={toggle.isPending}
              title={cron.enabled ? 'Mettre en pause' : 'Reprendre'} aria-label={cron.enabled ? 'Mettre en pause' : 'Reprendre'}>
              {cron.enabled ? <Pause className={ICON} strokeWidth={1.5} /> : <Play className={ICON} strokeWidth={1.5} />}
            </Button>
          )}
          <Button variant="ghost" className={cx('size-8 px-0', open && 'bg-raised text-ink')} onClick={onOpen} title="Historique" aria-label="Historique" aria-expanded={open}>
            <History className={ICON} strokeWidth={1.5} />
          </Button>
          {can('update') && (
            <Button variant="ghost" className="size-8 px-0" onClick={onEdit} title="Modifier" aria-label="Modifier">
              <Pencil className={ICON} strokeWidth={1.5} />
            </Button>
          )}
          {can('remove') && (
            <Button variant="ghost" className="size-8 px-0 hover:text-bad" title="Supprimer" aria-label="Supprimer" disabled={remove.isPending}
              onClick={() => { if (confirm(`Supprimer le cron « ${cron.name} » ? Hermes l’oublie définitivement ; les fichiers déjà produits restent.`)) remove.mutate(); }}>
              <Trash2 className={ICON} strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>
      {cron.lastError && !running && !open && (
        <p className="mt-2 line-clamp-2 break-words pl-5 font-mono text-[11px] text-bad">{cron.lastError}</p>
      )}
      <div className="pl-5 empty:hidden"><ErrorText error={toggle.error ?? remove.error ?? trigger.error} /></div>
      {(open || running) && (
        <div className="pl-5">
          <CronRuns cron={cron} follow={follow} canRuns={can('runs')} canCancel={can('cancel')} onFollowEnd={onFollowEnd} />
        </div>
      )}
    </li>
  );
}

export function CronsPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'crons', REQUIRED, OPTIONAL);
  const crons = useQuery({ queryKey: ['crons', inst], queryFn: () => api.crons(inst).then((r) => r.crons), enabled: a.available });
  const [editing, setEditing] = useState<Cron | 'new' | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [follows, setFollows] = useState<Record<string, FollowSnapshot>>({});

  const list = instances.data?.instances ?? [];
  const current = list.find((i) => i.id === inst);
  const items = crons.data ?? [];
  const offset = offsetOf(items.find((c) => c.nextRunAt)?.nextRunAt);
  const can = (op: string) => a.has('crons', op);
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <PageHeader
        title="Crons"
        subtitle={<>Les tâches planifiées de {current ? <span className="text-ink">{current.label}</span> : 'l’instance'}. Les heures sont celles d’Hermes{offset ? ` (${offset})` : ''}.</>}
        action={can('create') && a.available ? (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className={ICON} strokeWidth={1.5} />Créer un cron
          </Button>
        ) : undefined}
      />
      <div className="space-y-6 px-5 pb-10 md:px-8">
        {list.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Instance">
            {list.map((i) => (
              <Link key={i.id} to="/i/$inst/crons" params={{ inst: i.id }}
                className={cx('h-8 rounded-lg border px-3 text-[13px] leading-8 transition-colors', i.id === inst ? 'border-accent text-ink' : 'border-line text-ink-soft hover:text-ink')}>
                {i.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="empty:hidden">
          <ModuleNotice instanceId={inst} module="crons" title="La console des crons" required={REQUIRED} optional={OPTIONAL} explainMissing />
        </div>
        <ErrorText error={crons.error} />
        {a.available && (
          <Panel bodyClassName="p-0" title="Tâches planifiées" action={<span className="font-mono text-[11px] text-ink-faint">{items.length}</span>}>
            {items.length ? (
              <ul className="divide-y divide-line">
                {items.map((c) => (
                  <CronRow key={c.id} cron={c} can={can} open={open.has(c.id)} follow={follows[c.id] ?? null}
                    onOpen={() => toggleOpen(c.id)} onEdit={() => setEditing(c)}
                    onFollow={(s) => { setFollows((f) => ({ ...f, [c.id]: s })); setOpen((o) => new Set(o).add(c.id)); }}
                    onFollowEnd={() => setFollows((f) => { const { [c.id]: _, ...rest } = f; return rest; })} />
                ))}
              </ul>
            ) : crons.isSuccess ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-ink-soft">Aucun cron sur cette instance</p>
                {can('create') && (
                  <Button variant="primary" className="mt-4" onClick={() => setEditing('new')}>
                    <Plus className={ICON} strokeWidth={1.5} />Créer un cron
                  </Button>
                )}
              </div>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-ink-faint">Chargement…</p>
            )}
          </Panel>
        )}
      </div>
      {editing && (
        <CronEditor key={editing === 'new' ? 'new' : editing.id} instanceId={inst} cron={editing === 'new' ? null : editing} offset={offset}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
