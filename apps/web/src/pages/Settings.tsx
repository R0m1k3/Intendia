import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, Panel } from '../components/ui';

type Theme = 'system' | 'light' | 'dark';

/** Block for Hermes' configuration (mcp_servers), built here: the server never names Hermes files. */
function mcpBlock(url: string, token: string): string {
  return `mcp_servers:\n  intendia:\n    url: ${url}\n    headers:\n      Authorization: "Bearer ${token}"\n`;
}

function ShareFileTool({ instanceId }: { instanceId: string }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['mcp', instanceId], queryFn: () => api.mcp(instanceId) });
  const rotate = useMutation({ mutationFn: () => api.rotateMcp(instanceId), onSuccess: (d) => qc.setQueryData(['mcp', instanceId], d) });
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const d = info.data;
  if (!d) return <ErrorText error={info.error} />;
  const block = mcpBlock(d.url, d.token);
  const copy = async () => {
    await navigator.clipboard.writeText(block).catch(() => prompt('Bloc mcp_servers', block));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-3 rounded-lg border border-line bg-paper/60 p-3 text-sm">
      <p className="font-medium">Outil share_file</p>
      <p className="mt-1 text-xs text-ink-soft">
        À ajouter dans la configuration de cette instance Hermes (section <code className="font-mono">mcp_servers</code>), puis redémarrer Hermes.
        L’agent pourra alors donner un lien privé vers chaque fichier qu’il livre, aussi depuis Telegram et les crons.
      </p>
      <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-sheet p-2.5 font-mono text-[11.5px] leading-relaxed">
        {shown ? block : mcpBlock(d.url, '•'.repeat(12))}
      </pre>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="h-8 px-3 text-[13px]" onClick={() => void copy()}>{copied ? 'Copié' : 'Copier le bloc mcp_servers'}</Button>
        <Button variant="ghost" className="h-8 px-3 text-[13px]" onClick={() => setShown(!shown)}>{shown ? 'Masquer le jeton' : 'Afficher le jeton'}</Button>
        <Button variant="ghost" className="h-8 px-3 text-[13px]" disabled={rotate.isPending}
          onClick={() => { if (confirm('Régénérer le jeton ? L’ancien ne marchera plus : il faudra mettre à jour la configuration d’Hermes.')) rotate.mutate(); }}>
          Régénérer le jeton
        </Button>
      </div>
      <ul className="mt-2 space-y-1 text-xs text-ink-faint">
        <li>Ne publiez jamais le port {d.url.split(':')[2]?.split('/')[0] ?? '3001'} : Hermes doit le joindre par le réseau Docker.</li>
        {!d.publicUrlSet && <li className="text-warn">INTENDIA_PUBLIC_URL n’est pas configurée : les liens donnés par l’agent ne marcheront que dans Intendia, pas dans Telegram.</li>}
      </ul>
      <ErrorText error={rotate.error} />
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
  const [adding, setAdding] = useState(false);
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('intendia-theme') as Theme) ?? 'system');
  const remove = useMutation({
    mutationFn: api.removeInstance,
    onSuccess: () => qc.invalidateQueries(),
  });
  const declarative = instances.data?.declarative;

  return (
    <>
      <PageHeader title="Réglages" subtitle="Instances Hermes reliées à Intendia et affichage" />
      <div className="space-y-6 px-5 pb-12 md:px-8">
        <Panel
          title="Instances"
          action={!declarative && !adding && <Button onClick={() => setAdding(true)}>Ajouter</Button>}
        >
          {declarative && (
            <p className="mb-3 text-sm text-ink-soft">
              Instances déclarées par <code className="font-mono text-xs">INTENDIA_INSTANCES</code> : modifiez la configuration du conteneur pour les changer.
            </p>
          )}
          <ErrorText error={remove.error} />
          <ul className="divide-y divide-line">
            {instances.data?.instances.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{i.label} <span className="ml-2 font-mono text-xs font-normal text-ink-faint">{i.id}</span></div>
                  <div className="mt-1 truncate font-mono text-xs text-ink-faint">{i.api}{i.dashboard ? ` · ${i.dashboard}` : ' · sans dashboard'} · {i.mount}</div>
                </div>
                {!declarative && (
                  <Button
                    variant="danger"
                    onClick={() => { if (confirm(`Retirer l’instance « ${i.label} » d’Intendia ? Hermes n’est pas modifié.`)) remove.mutate(i.id); }}
                  >
                    Retirer
                  </Button>
                )}
                </div>
                <ShareFileTool instanceId={i.id} />
              </li>
            ))}
          </ul>
          {adding && (
            <div className="mt-4 border-t border-line pt-4">
              <InstanceForm onSaved={async () => { setAdding(false); await qc.invalidateQueries(); }} />
              <Button variant="ghost" className="mt-2" onClick={() => setAdding(false)}>Annuler</Button>
            </div>
          )}
        </Panel>
        <Panel title="Thème">
          <div role="radiogroup" aria-label="Thème" className="inline-flex gap-0.5 rounded-[9px] bg-raised p-[3px]">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button
                key={t}
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
        </Panel>
      </div>
    </>
  );
}
