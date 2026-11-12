import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { api, type McpOauthMode } from '../api';
import { Button, ErrorText } from '../components/ui';
import { errorCode, ICON } from './common';

const POLL_MS = 2000;
/** Hermes forgets a flow after 15 min. */
const FLOW_MAX_MS = 15 * 60_000;
export const flowDone = (status: string | undefined) => status === 'approved' || status === 'error';

const MODE_NOTE: Record<McpOauthMode, string | null> = {
  relay: null,
  hermes: 'Retour par l’adresse publique du dashboard Hermes (dashboard.public_url).',
  custom: 'URL de retour personnalisée (oauth.redirect_uri) : Intendia ne relaie rien.',
};

/**
 * OAuth connection of an MCP server: Hermes gives an authorization page, opened in a new tab; the flow is then
 * followed until the provider sends the browser back (through Intendia's public return route, or Hermes').
 */
export function McpConnect({ inst, profile, name, onApproved }: { inst: string; profile: string; name: string; onApproved: () => void }) {
  const [started, setStarted] = useState<{ id: string; at: number; mode: McpOauthMode; url: string | null } | null>(null);
  const connect = useMutation({
    mutationFn: () => api.connectMcpOauth(inst, profile, name),
    onSuccess: (r) => setStarted({ id: r.flow.id, at: Date.now(), mode: r.mode, url: r.flow.authorizationUrl }),
  });
  const flow = useQuery({
    queryKey: ['mcp-flow', inst, profile, started?.id], enabled: started !== null, retry: false,
    queryFn: async () => {
      const f = await api.mcpFlow(inst, profile, started!.id);
      if (f.status === 'approved') onApproved();
      return f;
    },
    refetchInterval: (q) => (flowDone(q.state.data?.status) || (started && Date.now() - started.at > FLOW_MAX_MS) ? false : POLL_MS),
  });
  const cancel = useMutation({ mutationFn: () => api.cancelMcpFlow(inst, profile, started!.id), onSuccess: () => setStarted(null) });
  const status = flow.data?.status ?? (started ? 'authorization_required' : undefined);
  const waiting = started !== null && !flowDone(status);
  // Hermes may give the authorization URL only at a later poll
  const authUrl = flow.data?.authorizationUrl ?? started?.url ?? null;
  const expired = started !== null && Date.now() - started.at > FLOW_MAX_MS && waiting;

  return (
    <div className="space-y-1.5" data-mcp-connect={name} data-flow={status ?? 'none'}>
      {!waiting && (
        <Button className="h-8" disabled={connect.isPending} onClick={() => { setStarted(null); connect.mutate(); }}>
          <KeyRound className={ICON} strokeWidth={1.5} />{connect.isPending ? 'Préparation…' : status === 'approved' ? 'Reconnecter' : 'Connecter'}
        </Button>
      )}
      {waiting && started && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {authUrl ? (
            <a href={authUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent-strong bg-accent px-3 font-medium text-on-accent hover:bg-accent-strong" data-authorize>
              <ExternalLink className={ICON} strokeWidth={1.5} />Ouvrir la page d’autorisation
            </a>
          ) : <span className="text-ink-soft">Hermes prépare la page d’autorisation…</span>}
          <span className="text-ink-faint">{expired ? 'Délai dépassé : recommencez.' : 'En attente de votre accord chez le fournisseur…'}</span>
          <Button className="h-8" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Annuler</Button>
        </div>
      )}
      {started && MODE_NOTE[started.mode] && <p className="text-xs text-ink-faint">{MODE_NOTE[started.mode]}</p>}
      {status === 'approved' && (
        <p className="text-xs text-ok" role="status">
          Connecté{flow.data?.tools.length ? ` : ${flow.data.tools.length} outil${flow.data.tools.length > 1 ? 's' : ''}` : ''}. Les nouvelles sessions s’en servent ; redémarrez la passerelle pour les chats ouverts.
        </p>
      )}
      {status === 'error' && <p className="text-xs text-bad" role="alert">Échec : {flow.data?.error ?? 'erreur inconnue'}</p>}
      {errorCode(connect.error) === 'no_public_url'
        ? <p className="text-xs text-warn">Intendia doit être joignable depuis votre navigateur par une adresse publique : définissez INTENDIA_PUBLIC_URL (voir la documentation d’installation), ou dashboard.public_url dans la configuration d’Hermes.</p>
        : <ErrorText error={connect.error ?? flow.error ?? cancel.error} />}
    </div>
  );
}
