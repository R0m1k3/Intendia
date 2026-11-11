import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Pencil, Plug, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, type McpState, type McpTest, type ModuleId, type ModuleState } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { Narrow, PageHeader } from '../components/Layout';
import { useModuleAvailability } from '../components/ModuleNotice';
import { Button, copyText, cx, ErrorText, Mark, Section, worst } from '../components/ui';
import { RESTART_CONFIRM, RestartStrip, useRestart } from '../config/restart';
import { ask, askText } from '../components/Dialog';

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
      <SmallBtn disabled={restart.running} onClick={async () => { if (await ask(RESTART_CONFIRM)) restart.start(); }}>
        <RefreshCw className={cx('size-3.5', restart.running && 'animate-spin')} strokeWidth={1.5} />
        {restart.running ? 'Redémarrage…' : `Redémarrer ${label}`}
      </SmallBtn>
      <RestartStrip state={restart} />
    </div>
  );
}

/** Operations Intendia needs to put share_file into Hermes itself (same list as MCP_AUTO_OPS, apps/server/src/mcp/connect.ts). */
const MCP_AUTO_OPS: [ModuleId, string][] = [['config', 'raw'], ['config', 'mcpServers'], ['config', 'addMcp'], ['config', 'removeMcp'], ['config', 'putEnv'], ['config', 'putRaw'], ['config', 'testMcp']];

const MCP_STATE: Record<McpState, { mark: ModuleState | null; label: string; help: string }> = {
  connected: { mark: 'full', label: 'Branché', help: 'Hermes connaît l’adresse et le jeton d’Intendia.' },
  stale: { mark: 'readonly', label: 'Jeton à envoyer à Hermes', help: 'Le jeton a changé depuis le dernier envoi.' },
  manual: { mark: 'readonly', label: 'Ancienne configuration manuelle', help: 'Hermes a un bloc collé à la main (jeton en clair) : Intendia le remplace.' },
  other_url: { mark: 'readonly', label: 'Une autre entrée « intendia » existe', help: 'Hermes a déjà un serveur MCP nommé « intendia » qui pointe ailleurs.' },
  plugin: { mark: 'unavailable', label: 'Entrée fournie par un plugin', help: 'Un plugin d’Hermes fournit déjà un serveur MCP « intendia » : Intendia ne peut pas le remplacer.' },
  missing: { mark: null, label: 'Pas branché', help: 'L’agent ne peut pas encore partager de fichiers.' },
  unknown: { mark: 'unavailable', label: 'État inconnu', help: 'Hermes ne répond pas, ou ne permet pas de brancher un serveur MCP depuis Intendia.' },
};

/** The share_file tool of one instance: Intendia writes it into Hermes, Hermes tests it, then the restart. */
function ShareFileTool({ instanceId, label, many }: { instanceId: string; label: string; many: boolean }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['mcp', instanceId], queryFn: () => api.mcp(instanceId) });
  const ops = useModuleAvailability(instanceId, 'config', MCP_AUTO_OPS, []);
  const [result, setResult] = useState<{ test?: McpTest; error?: string } | null>(null);
  const done = (d: { state: McpState; test?: McpTest; error?: string }) => {
    setResult({ test: d.test, error: d.error });
    void qc.invalidateQueries({ queryKey: ['mcp', instanceId] });
  };
  const connect = useMutation({
    mutationFn: (replaceOther: boolean) => api.connectMcp(instanceId, replaceOther),
    onMutate: () => setResult(null),
    onSuccess: done,
  });
  const rotate = useMutation({ mutationFn: () => api.rotateMcp(instanceId), onMutate: () => setResult(null), onSuccess: done });
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const d = info.data;
  if (!d) return <ErrorText error={info.error} />;
  const auto = ops.available;
  const st = MCP_STATE[d.state];
  const block = mcpBlock(d.url, d.token);
  const copy = async () => {
    await copyText(block, 'Bloc mcp_servers');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const start = async () => {
    if (d.state === 'other_url') {
      const yes = await ask({
        title: 'Remplacer l’entrée « intendia » ?',
        message: `Hermes a déjà un serveur MCP nommé « intendia » qui pointe vers une autre adresse. Il sera remplacé par celui d’Intendia (${d.url}).`,
        confirmLabel: 'Remplacer', danger: true,
      });
      if (!yes) return;
    }
    connect.mutate(d.state === 'other_url');
  };
  const busy = connect.isPending || rotate.isPending;
  const canConnect = auto && d.state !== 'plugin' && d.state !== 'unknown';
  const written = result !== null && !result.error;
  /** Managed entry: the rotation also reaches Hermes; otherwise the manual section keeps its own rotation. */
  const managed = auto && (d.state === 'connected' || d.state === 'stale');
  return (
    <div data-share={instanceId} data-mcp-state={d.state} className="space-y-4 card p-5">
      {many && <p className="text-sm font-semibold">{label}</p>}
      {!d.publicUrlSet && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft/40 p-3 text-[13px]">
          <code className="font-mono text-xs">INTENDIA_PUBLIC_URL</code> n’est pas configurée : les liens donnés par l’agent ne marcheront que dans Intendia, pas dans Telegram.
        </p>
      )}
      {auto && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium"><Mark state={st.mark} />{st.label}</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">{st.help}</p>
          </div>
          {canConnect && (
            <SmallBtn variant={d.state === 'connected' ? 'ghost' : undefined} disabled={busy} onClick={() => void start()}>
              <Plug className="size-3.5" strokeWidth={1.5} />
              {connect.isPending ? 'Test par Hermes…' : d.state === 'connected' ? 'Rebrancher' : `Brancher Intendia à ${label}`}
            </SmallBtn>
          )}
        </div>
      )}
      <ErrorText error={connect.error ?? rotate.error} />
      {result && (
        <div className="space-y-1 rounded-lg border border-line bg-raised/60 p-3 text-[13px]" data-mcp-result={result.test?.ok ? 'ok' : 'error'}>
          {result.error && <p className="text-bad">Jeton changé dans Intendia, mais Hermes n’a pas été mis à jour : {result.error}</p>}
          {result.test?.ok && <p className="flex items-center gap-2"><Check className="size-3.5 text-ok" strokeWidth={2} />Hermes voit l’outil share_file.</p>}
          {result.test && !result.test.ok && (
            <p className="text-bad">
              Entrée écrite, mais Hermes ne joint pas Intendia : {result.test.error ?? 'erreur inconnue'}. Vérifiez qu’Hermes et Intendia partagent un réseau Docker, ou réglez <code className="font-mono text-xs">INTENDIA_MCP_URL</code>.
            </p>
          )}
          {written && <p className="text-ink-soft">Pris en compte au prochain redémarrage d’Hermes.</p>}
        </div>
      )}
      {auto && (written || d.state === 'stale' || d.state === 'connected') && (
        <div className={cx('space-y-2', written && 'rounded-lg border border-accent/30 p-3')}>
          {written && <p className="text-sm font-medium">Redémarrez Hermes pour que l’agent ait l’outil</p>}
          <RestartInstance instanceId={instanceId} label={label} />
        </div>
      )}
      {managed && (
        <SmallBtn variant="ghost" disabled={busy}
          onClick={async () => { if (await ask({ title: 'Régénérer le jeton ?', message: 'L’ancien ne marchera plus. Hermes est mis à jour automatiquement ; redémarrez-le ensuite.', confirmLabel: 'Régénérer', danger: true })) rotate.mutate(); }}>
          {rotate.isPending ? 'Régénération…' : 'Régénérer le jeton'}
        </SmallBtn>
      )}
      <details open={!auto} className="group text-[13px]">
        <summary className="cursor-pointer select-none text-ink-soft hover:text-ink">Configuration manuelle</summary>
        <div className="mt-3 space-y-4">
          {!auto && <p className="text-ink-soft">Cette instance ne permet pas à Intendia de brancher l’outil lui-même : ajoutez ce bloc à la configuration d’Hermes, puis redémarrez-le.</p>}
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
            {!managed && (
              <SmallBtn variant="ghost" disabled={busy}
                onClick={async () => { if (await ask({ title: 'Régénérer le jeton ?', message: 'L’ancien ne marchera plus : il faudra mettre à jour la configuration d’Hermes.', confirmLabel: 'Régénérer', danger: true })) rotate.mutate(); }}>
                Régénérer le jeton
              </SmallBtn>
            )}
          </div>
          {!auto && <RestartInstance instanceId={instanceId} label={label} />}
        </div>
      </details>
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
  const rename = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => api.renameInstance(id, label),
    onSuccess: () => qc.invalidateQueries(),
  });
  const askRename = async (i: { id: string; label: string }) => {
    const label = await askText({
      title: 'Renommer l’instance', label: 'Nom affiché', value: i.label, maxLength: 80,
      message: `L’identifiant ${i.id} ne change pas.`, confirmLabel: 'Renommer',
    });
    if (label && label.trim() && label.trim() !== i.label) rename.mutate({ id: i.id, label: label.trim() });
  };
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
            <ErrorText error={remove.error ?? rename.error} />
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
                    <div className="mt-1.5 truncate font-mono text-xs text-ink-faint">{i.api}{i.dashboard ? ` · ${i.dashboard}` : ' · sans dashboard'}{i.files?.workspaceRoot ? ` · ${i.files.workspaceRoot}` : ''}</div>
                    {i.files && !i.files.workspaceRoot && (
                      <div className="mt-1.5 max-w-prose text-xs text-bad" data-files-reason="">{i.files.reason}</div>
                    )}
                  </div>
                  {!declarative && (
                    <div className="flex items-center gap-2">
                      <SmallBtn onClick={() => void askRename(i)} disabled={rename.isPending}>
                        <Pencil className="size-3.5" strokeWidth={1.5} />Renommer
                      </SmallBtn>
                      <SmallBtn
                        variant="danger"
                        onClick={async () => { if (await ask({ title: `Retirer l’instance « ${i.label} » d’Intendia ?`, message: 'Hermes n’est pas modifié.', confirmLabel: 'Retirer', danger: true })) remove.mutate(i.id); }}
                      >
                        Retirer
                      </SmallBtn>
                    </div>
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
