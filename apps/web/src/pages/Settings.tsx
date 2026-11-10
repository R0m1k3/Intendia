import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { Narrow, PageHeader } from '../components/Layout';
import { useModuleAvailability } from '../components/ModuleNotice';
import { Button, copyText, cx, ErrorText, Mark, Section, worst } from '../components/ui';
import { RESTART_CONFIRM, RestartStrip, useRestart } from '../config/restart';

type Theme = 'system' | 'light' | 'dark';

/** Block for Hermes' configuration (mcp_servers), built here: the server never names Hermes files. */
function mcpBlock(url: string, token: string): string {
  return `mcp_servers:\n  intendia:\n    url: ${url}\n    headers:\n      Authorization: "Bearer ${token}"\n`;
}

function SmallBtn(p: React.ComponentProps<typeof Button>) {
  return <Button {...p} className={cx('h-8 px-3 text-[13px]', p.className)} />;
}

/** Restart of the instance's gateway, offered only when the compatibility check says the instance can. */
function RestartInstance({ instanceId, label }: { instanceId: string; label: string }) {
  const a = useModuleAvailability(instanceId, 'config', [['config', 'get']], [['config', 'restartGateway', 'Redémarrer la passerelle']]);
  const restart = useRestart(instanceId, 'default', () => {});
  if (!a.available || !a.has('config', 'restartGateway')) {
    return <p className="text-xs text-ink-faint">Redémarrez Hermes vous-même : cette instance ne permet pas de le faire depuis Intendia.</p>;
  }
  return (
    <div className="space-y-2">
      <SmallBtn disabled={restart.running} onClick={() => { if (confirm(RESTART_CONFIRM)) restart.start(); }}>
        <RefreshCw className={cx('size-3.5', restart.running && 'animate-spin')} strokeWidth={1.5} />
        {restart.running ? 'Redémarrage…' : `Redémarrer ${label}`}
      </SmallBtn>
      <RestartStrip state={restart} />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-xs text-ink-soft">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** The share_file tool of one instance: the mcp_servers block to add to Hermes, then the restart. */
function ShareFileTool({ instanceId, label, many }: { instanceId: string; label: string; many: boolean }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['mcp', instanceId], queryFn: () => api.mcp(instanceId) });
  const rotate = useMutation({ mutationFn: () => api.rotateMcp(instanceId), onSuccess: (d) => qc.setQueryData(['mcp', instanceId], d) });
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const d = info.data;
  if (!d) return <ErrorText error={info.error} />;
  const block = mcpBlock(d.url, d.token);
  const copy = async () => {
    await copyText(block, 'Bloc mcp_servers');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div data-share={instanceId} className="space-y-4 card p-5">
      {many && <p className="text-sm font-semibold">{label}</p>}
      {!d.publicUrlSet && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft/40 p-3 text-[13px]">
          <code className="font-mono text-xs">INTENDIA_PUBLIC_URL</code> n’est pas configurée : les liens donnés par l’agent ne marcheront que dans Intendia, pas dans Telegram.
        </p>
      )}
      <Step n={1} title="Ajoutez ce bloc à la configuration d’Hermes">
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-line bg-raised/60 p-3 pr-20 font-mono text-[11.5px] leading-relaxed">
            {shown ? block : mcpBlock(d.url, '•'.repeat(12))}
          </pre>
          <Button variant="ghost" className="absolute right-1.5 top-1.5 h-7 px-2 text-xs" onClick={() => void copy()} aria-label="Copier le bloc mcp_servers">
            <Copy className="size-3.5" strokeWidth={1.5} />{copied ? 'Copié' : 'Copier'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallBtn variant="ghost" onClick={() => setShown(!shown)}>{shown ? 'Masquer le jeton' : 'Afficher le jeton'}</SmallBtn>
          <SmallBtn variant="ghost" disabled={rotate.isPending}
            onClick={() => { if (confirm('Régénérer le jeton ? L’ancien ne marchera plus : il faudra mettre à jour la configuration d’Hermes.')) rotate.mutate(); }}>
            Régénérer le jeton
          </SmallBtn>
        </div>
        <ErrorText error={rotate.error} />
      </Step>
      <Step n={2} title="Redémarrez Hermes">
        <RestartInstance instanceId={instanceId} label={label} />
      </Step>
      <p className="text-xs text-ink-faint">
        Ne publiez jamais le port {d.url.split(':')[2]?.split('/')[0] ?? '3001'} : Hermes doit le joindre par le réseau Docker.
      </p>
    </div>
  );
}

function applyTheme(t: Theme) {
  document.documentElement.classList.remove('light', 'dark');
  if (t !== 'system') document.documentElement.classList.add(t);
  localStorage.setItem('intendia-theme', t);
}

export function SettingsPage() {
  const qc = useQueryClient();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const [adding, setAdding] = useState(false);
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('intendia-theme') as Theme) ?? 'system');
  const remove = useMutation({
    mutationFn: api.removeInstance,
    onSuccess: () => qc.invalidateQueries(),
  });
  const declarative = instances.data?.declarative;

  const list = instances.data?.instances ?? [];
  const reports = compat.data?.reports ?? [];

  return (
    <Narrow>
      <PageHeader title="Réglages" subtitle="Instances Hermes reliées à Intendia, partage de fichiers et affichage" />
      <div className="px-5 pb-12 md:px-8">
        <Section
          title="Instances"
          description={declarative
            ? <>Déclarées par <code className="font-mono text-xs">INTENDIA_INSTANCES</code> : modifiez la configuration du conteneur pour les changer.</>
            : 'Les instances Hermes que pilote Intendia. Retirer une instance ne modifie pas Hermes.'}
        >
          <div className="space-y-3">
            <ErrorText error={remove.error} />
            {list.map((i) => {
              const r = reports.find((x) => x.instanceId === i.id);
              return (
                <div key={i.id} data-instance={i.id} className="flex flex-wrap items-start justify-between gap-3 card p-4">
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2">
                      <Mark state={r ? worst(r.modules.map((m) => m.state)) : null} />
                      <span className="font-medium">{i.label}</span>
                      <span className="font-mono text-xs text-ink-faint">{i.id}</span>
                      {r?.hermesVersion && <span className="font-mono text-xs text-ink-faint">· Hermes {r.hermesVersion}</span>}
                    </div>
                    <div className="mt-1.5 truncate font-mono text-xs text-ink-faint">{i.api}{i.dashboard ? ` · ${i.dashboard}` : ' · sans dashboard'} · {i.mount}</div>
                  </div>
                  {!declarative && (
                    <SmallBtn
                      variant="danger"
                      onClick={() => { if (confirm(`Retirer l’instance « ${i.label} » d’Intendia ? Hermes n’est pas modifié.`)) remove.mutate(i.id); }}
                    >
                      Retirer
                    </SmallBtn>
                  )}
                </div>
              );
            })}
            {!declarative && (adding ? (
              <div className="card p-4">
                <InstanceForm onSaved={async () => { setAdding(false); await qc.invalidateQueries(); }} />
                <Button variant="ghost" className="mt-2" onClick={() => setAdding(false)}>Annuler</Button>
              </div>
            ) : (
              <SmallBtn onClick={() => setAdding(true)}><Plus className="size-3.5" strokeWidth={1.5} />Ajouter une instance</SmallBtn>
            ))}
          </div>
        </Section>
        {list.length > 0 && (
          <Section
            title="Partage de fichiers"
            description={<>L’outil <code className="font-mono text-xs">share_file</code> permet à l’agent de donner un lien privé vers chaque fichier qu’il livre, aussi depuis Telegram et les crons.</>}
          >
            <div className="space-y-3">
              {list.map((i) => <ShareFileTool key={i.id} instanceId={i.id} label={i.label} many={list.length > 1} />)}
            </div>
          </Section>
        )}
        <Section title="Apparence" description="Le thème de l’interface, sur ce navigateur.">
          <div role="radiogroup" aria-label="Thème" className="inline-flex gap-0.5 rounded-[9px] bg-raised p-[3px]">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => { setTheme(t); applyTheme(t); }}
                className={cx(
                  'h-[26px] rounded-md px-2.5 text-xs font-medium transition-colors',
                  theme === t ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(22_24_27/0.08)]' : 'text-ink-soft hover:text-ink',
                )}
              >
                {t === 'system' ? 'Système' : t === 'light' ? 'Clair' : 'Sombre'}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </Narrow>
  );
}
