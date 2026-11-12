import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Power, PowerOff, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Plugin, type PluginCatalogEntry, type PluginJob } from '../api';
import { ask } from '../components/Dialog';
import { Button, Chips, cx, ErrorText, Input, Panel, Tag } from '../components/ui';
import { capabilityLines, filterCatalog, SHOWN, TIER_LABEL, type TierFilter } from './plugin-catalog';
import { errorCode, ICON } from './common';

const POLL_MS = 2000;
const STATUS_LABEL: Record<string, string> = { enabled: 'activé', active: 'activé', inactive: 'inactif', disabled: 'désactivé' };
const isOn = (p: Plugin) => p.status === 'enabled' || p.status === 'active';

/**
 * Agent plugins of the instance (lot 8 E): installed ones (enable, disable, uninstall) and Hermes' curated catalog
 * (install only from there, pinned commit). Plugins are shared by every agent of the instance.
 */
export function ConfigPlugins({ inst, can, onVariable, onRestart }: {
  inst: string; can: (op: string) => boolean; onVariable: (key: string) => void; onRestart: () => void;
}) {
  const qc = useQueryClient();
  const installed = useQuery({ queryKey: ['plugins', inst], queryFn: () => api.plugins(inst).then((r) => r.plugins) });
  const catalog = useQuery({ queryKey: ['plugin-catalog', inst], queryFn: () => api.pluginCatalog(inst), enabled: can('catalog'), staleTime: 60_000 });
  // after a page reload, the install still running on the server is found again
  const [jobId, setJobId] = useState<string | null>(null);
  const current = useQuery({ queryKey: ['plugin-jobs', inst], queryFn: () => api.pluginJobs(inst).then((r) => r.job), enabled: jobId === null });
  useEffect(() => { if (jobId === null && current.data) setJobId(current.data.id); }, [current.data, jobId]);
  const job = useQuery({
    queryKey: ['plugin-job', inst, jobId], queryFn: () => api.pluginJob(inst, jobId!), enabled: jobId !== null, retry: false,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? POLL_MS : false),
  });
  const finished = job.data && job.data.state !== 'running' ? job.data.id : null;
  useEffect(() => {
    if (!finished) return;
    void qc.invalidateQueries({ queryKey: ['plugins', inst] });
    void qc.invalidateQueries({ queryKey: ['plugin-catalog', inst] });
    if (job.data?.result?.restartRequired) onRestart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
  const running = job.data?.state === 'running';
  const install = useMutation({
    mutationFn: (name: string) => api.installPlugin(inst, name),
    onSuccess: (r) => { qc.setQueryData(['plugin-job', inst, r.job.id], r.job); setJobId(r.job.id); },
  });

  const updates = new Set((catalog.data?.entries ?? []).filter((e) => e.updateAvailable).map((e) => e.name));
  const list = installed.data ?? [];
  // Hermes ships dozens of plugins: the ones added on this instance come first, the bundled ones are folded
  const own = list.filter((p) => p.source !== 'bundled');
  const bundled = list.filter((p) => p.source === 'bundled');
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-soft">
        Les plugins sont communs à tous les agents de l’instance : chacun est du code Python chargé dans Hermes.
      </p>
      {jobId && <JobStrip job={job.data ?? null} error={job.error} onVariable={onVariable} onClose={running ? undefined : () => { setJobId(null); qc.setQueryData(['plugin-jobs', inst], null); }} />}
      <Panel title="Installés" bodyClassName="divide-y divide-line/70 border-t border-line/70">
        {installed.isPending && <p className="p-5 text-sm text-ink-soft">Lecture des plugins…</p>}
        <div className="empty:hidden"><ErrorText error={installed.error} /></div>
        {installed.isSuccess && own.length === 0 && <p className="p-5 text-sm text-ink-soft">Aucun plugin ajouté : ceux du catalogue s’installent plus bas.</p>}
        {own.map((p) => <PluginRow key={p.name} p={p} inst={inst} can={can} update={updates.has(p.name)} onRestart={onRestart} />)}
        {bundled.length > 0 && (
          <details className="group" data-bundled>
            <summary className="cursor-pointer px-5 py-3 text-[13px] text-ink-soft hover:text-ink">
              Fournis avec Hermes ({bundled.length}, {bundled.filter(isOn).length} activés)
            </summary>
            <div className="divide-y divide-line/70 border-t border-line/70">
              {bundled.map((p) => <PluginRow key={p.name} p={p} inst={inst} can={can} update={updates.has(p.name)} onRestart={onRestart} />)}
            </div>
          </details>
        )}
      </Panel>
      {can('catalog') && (
        <Catalog inst={inst} data={catalog.data} error={catalog.error} pending={catalog.isPending} canInstall={can('install')}
          busy={running || install.isPending} installError={install.error} onInstall={(name) => install.mutate(name)} />
      )}
    </div>
  );
}

function JobStrip({ job, error, onVariable, onClose }: { job: PluginJob | null; error: unknown; onVariable: (k: string) => void; onClose?: () => void }) {
  if (error) return <div className="rounded-[10px] bg-paper px-3.5 py-2.5"><ErrorText error={error} /></div>;
  if (!job) return null;
  const r = job.result;
  const tone = job.state === 'failed' || r?.state === 'consent' ? 'bg-warn-soft text-warn' : job.state === 'running' ? 'bg-paper text-ink-soft' : 'bg-ok-soft text-ok';
  return (
    <div role="status" data-plugin-job={job.state} className={cx('space-y-1.5 rounded-[10px] px-3.5 py-2.5 text-[13.5px]', tone)}>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1">
          {job.state === 'running' && <>Installation de <span className="font-mono">{job.name}</span>… Hermes clone le dépôt et installe ses dépendances : cela peut durer plusieurs minutes.</>}
          {job.state === 'failed' && <>Installation de <span className="font-mono">{job.name}</span> refusée ou échouée : {job.error}</>}
          {job.state === 'done' && r?.state === 'consent' && (
            <>Hermes demande votre accord avant d’installer <span className="font-mono">{job.name}</span>{r.message ? ` : ${r.message}` : ''}. Intendia ne donne pas cet accord : installez-le depuis le dashboard officiel d’Hermes si vous l’acceptez.</>
          )}
          {job.state === 'done' && r?.state === 'installed' && (
            <><span className="font-mono">{r.plugin ?? job.name}</span> est installé{r.enabled ? ' et activé' : ''}.{r.restartRequired && !r.gatewayReloaded ? ' Il ne sert qu’après un redémarrage de la passerelle.' : ''}</>
          )}
        </p>
        {onClose && <button type="button" onClick={onClose} className="shrink-0 text-xs underline underline-offset-2 opacity-80 hover:opacity-100">Fermer</button>}
      </div>
      {r && r.missingEnv.length > 0 && (
        <p>Variables à définir :{' '}
          {r.missingEnv.map((k, i) => (
            <span key={k}>{i > 0 && ', '}<button type="button" className="font-mono underline underline-offset-2" onClick={() => onVariable(k)}>{k}</button></span>
          ))}
        </p>
      )}
      {r && [...r.warnings, ...r.knownIssues].map((w) => <p key={w} className="text-[12.5px] opacity-90">{w}</p>)}
    </div>
  );
}

function PluginRow({ p, inst, can, update, onRestart }: { p: Plugin; inst: string; can: (op: string) => boolean; update: boolean; onRestart: () => void }) {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['plugins', inst] });
    await qc.invalidateQueries({ queryKey: ['plugin-catalog', inst] });
    onRestart();
  };
  const toggle = useMutation({ mutationFn: () => api.setPluginEnabled(inst, p.name, !isOn(p)), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.removePlugin(inst, p.name), onSuccess: done });
  const busy = toggle.isPending || remove.isPending;
  return (
    <div className="space-y-1.5 px-5 py-3.5" data-plugin={p.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13.5px] font-medium">{p.name}</span>
        {p.version && <span className="font-mono text-xs text-ink-faint">{p.version}</span>}
        {p.source && <Tag>{p.source === 'bundled' ? 'fourni' : p.source}</Tag>}
        <span className={cx('text-xs', isOn(p) ? 'text-ok' : 'text-ink-faint')} data-status>{STATUS_LABEL[p.status ?? ''] ?? p.status ?? '?'}</span>
        {update && <Tag className="bg-accent-soft text-accent-ink" title="Désinstallez puis réinstallez depuis le catalogue pour avoir la version vérifiée">mise à jour disponible</Tag>}
        <span className="flex-1" />
        {can(isOn(p) ? 'disable' : 'enable') && (
          <Button disabled={busy} onClick={() => toggle.mutate()}>
            {isOn(p) ? <PowerOff className={ICON} strokeWidth={1.5} /> : <Power className={ICON} strokeWidth={1.5} />}{isOn(p) ? 'Désactiver' : 'Activer'}
          </Button>
        )}
        {p.canRemove && can('remove') && (
          <Button variant="danger" disabled={busy} aria-label={`Désinstaller ${p.name}`}
            onClick={async () => {
              if (await ask({
                title: `Désinstaller ${p.name} ?`, danger: true, confirmLabel: 'Désinstaller',
                message: 'Hermes retire ses fichiers du serveur, pour tous les agents de l’instance. Pour le retrouver, il faudra le réinstaller.',
              })) remove.mutate();
            }}>
            <Trash2 className={ICON} strokeWidth={1.5} />Désinstaller
          </Button>
        )}
      </div>
      {p.description && <p className="text-[13px] text-ink-soft">{p.description}</p>}
      {update && <p className="text-xs text-ink-faint">Une version plus récente est dans le catalogue : désinstallez puis réinstallez-le depuis le catalogue.</p>}
      {p.authRequired && p.authCommand && (
        <p className="text-xs text-ink-faint">Connexion à faire sur le serveur : <code className="font-mono text-ink-soft">{p.authCommand}</code></p>
      )}
      {p.removedReason && <p className="text-xs text-warn">Retiré du catalogue : {p.removedReason}</p>}
      <div className="empty:hidden"><ErrorText error={toggle.error ?? remove.error} /></div>
    </div>
  );
}

function Catalog({ data, error, pending, canInstall, busy, installError, onInstall }: {
  inst: string; data: { entries: PluginCatalogEntry[]; removed: { name: string; reason: string | null }[] } | undefined; error: unknown; pending: boolean;
  canInstall: boolean; busy: boolean; installError: unknown; onInstall: (name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<TierFilter>('tous');
  const entries = data?.entries ?? [];
  const found = filterCatalog(entries, q, tier);
  const code = errorCode(installError);
  return (
    <Panel title="Catalogue d’Hermes" bodyClassName="border-t border-line/70">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" strokeWidth={1.5} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un plugin" aria-label="Chercher dans le catalogue" className="pl-8" />
        </div>
        <Chips label="Niveau" value={tier} onChange={setTier} items={[
          { key: 'tous', label: 'Tous' }, { key: 'official', label: 'Officiels' }, { key: 'verified', label: 'Vérifiés' }, { key: 'community', label: 'Communauté' },
        ]} />
      </div>
      {pending && <p className="px-5 pb-4 text-sm text-ink-soft">Lecture du catalogue…</p>}
      <div className="px-5 empty:hidden"><ErrorText error={error} /></div>
      {installError != null && code !== 'busy' && <div className="px-5 pb-2"><ErrorText error={installError} /></div>}
      {code === 'busy' && <p className="px-5 pb-2 text-sm text-warn">Une installation est déjà en cours sur cette instance.</p>}
      {data && found.length === 0 && <p className="px-5 pb-4 text-sm text-ink-soft">Aucun plugin ne correspond.</p>}
      <ul className="divide-y divide-line/70 border-t border-line/70" aria-label="Plugins du catalogue">
        {found.slice(0, SHOWN).map((e) => <CatalogRow key={e.name} e={e} canInstall={canInstall} busy={busy} onInstall={onInstall} />)}
      </ul>
      {found.length > SHOWN && <p className="border-t border-line/70 px-5 py-3 text-xs text-ink-faint">{found.length - SHOWN} autres : affinez la recherche.</p>}
      {data && data.removed.length > 0 && (
        <details className="border-t border-line/70 px-5 py-3 text-[13px] text-ink-soft" data-removed>
          <summary className="cursor-pointer text-xs text-ink-faint">Retirés du catalogue ({data.removed.length})</summary>
          <ul className="mt-2 space-y-1">{data.removed.map((r) => <li key={r.name}><span className="font-mono">{r.name}</span>{r.reason ? ` : ${r.reason}` : ''}</li>)}</ul>
        </details>
      )}
    </Panel>
  );
}

function CatalogRow({ e, canInstall, busy, onInstall }: { e: PluginCatalogEntry; canInstall: boolean; busy: boolean; onInstall: (name: string) => void }) {
  const caps = capabilityLines(e);
  return (
    <li className="space-y-1.5 px-5 py-3.5" data-catalog={e.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-medium">{e.title}</span>
        {e.title !== e.name && <span className="font-mono text-xs text-ink-faint">{e.name}</span>}
        {e.tier && <Tag className={e.tier === 'official' ? 'bg-accent-soft text-accent-ink' : undefined}>{TIER_LABEL[e.tier] ?? e.tier}</Tag>}
        {e.maintainer && <span className="text-xs text-ink-faint">par {e.maintainer}</span>}
        <span className="flex-1" />
        {e.docsUrl && (
          <a href={e.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
            <ExternalLink className="size-3.5" strokeWidth={1.5} />Dépôt
          </a>
        )}
        {e.installed ? <Tag>installé</Tag> : canInstall && (
          <Button disabled={busy} aria-label={`Installer ${e.name}`}
            onClick={async () => {
              if (await ask({
                title: `Installer ${e.title} ?`, danger: true, confirmLabel: 'Installer',
                message: (
                  <div className="space-y-2">
                    <p>Un plugin est du code Python chargé dans Hermes, avec accès aux clés de tous les agents de cette instance. L’installation peut durer plusieurs minutes.</p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {caps.length ? caps.map((c) => <li key={c}>{c}</li>) : <li>Aucune capacité déclarée</li>}
                      <li>Version vérifiée : <span className="font-mono">{e.shaShort}</span>{e.maintainer ? `, maintenue par ${e.maintainer}` : ''}</li>
                    </ul>
                    {e.knownIssues.length > 0 && <p>Problèmes connus : {e.knownIssues.join(' ')}</p>}
                  </div>
                ),
              })) onInstall(e.name);
            }}>
            <Download className={ICON} strokeWidth={1.5} />Installer
          </Button>
        )}
      </div>
      {e.description && <p className="text-[13px] text-ink-soft">{e.description}</p>}
      {(caps.length > 0 || e.requiresHermes) && (
        <p className="text-xs text-ink-faint">{[...caps, e.requiresHermes ? `Hermes ${e.requiresHermes}` : null].filter(Boolean).join(' · ')}</p>
      )}
      {e.knownIssues.length > 0 && <p className="text-xs text-warn">Problèmes connus : {e.knownIssues.join(' ')}</p>}
    </li>
  );
}
