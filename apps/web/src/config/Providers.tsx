import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, KeyRound, Plus, Server, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type ConnectPoll, type CustomProvider, type ProviderAccount, type ProviderKey, type ProvidersInfo } from '../api';
import { ask } from '../components/Dialog';
import { Button, copyText, cx, ErrorText, Input, Mark, Panel } from '../components/ui';
import { configKey, ICON, SELECT, type TabProps } from './common';
import { loadConnect, nextPollDelay, resumable, saveConnect, type PendingConnect } from './connect-state';

/**
 * "Fournisseurs": the subscriptions (accounts connected by a device code) and API keys of an agent, kept by Hermes in
 * the profile's auth.json. A provider connected here is offered by the chat's model picker (same rule as before: the
 * providers Hermes reports as authenticated).
 */
export function ConfigProviders({ inst, profile, can, onVariable }: TabProps & { onVariable: (key: string) => void }) {
  const info = useQuery({ queryKey: configKey(inst, profile, 'providers'), queryFn: () => api.configProviders(inst, profile) });
  const refresh = useRefreshProviders(inst, profile);
  const custom = useQuery({ queryKey: configKey(inst, profile, 'custom-providers'), queryFn: () => api.customProviders(inst, profile) });
  if (info.isPending) return <p className="text-sm text-ink-soft">Lecture des fournisseurs…</p>;
  if (info.isError) return <ErrorText error={info.error} />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-soft">
        Un fournisseur connecté ici est proposé dans le chat de cet agent. Les clés et les jetons restent dans Hermes : Intendia ne les affiche jamais.
      </p>
      <Accounts inst={inst} profile={profile} accounts={info.data.accounts} can={can} refresh={refresh} />
      <Keys inst={inst} profile={profile} info={info.data} can={can} refresh={refresh} onVariable={onVariable} endpoints={custom.data?.endpoints ?? []} />
      <CustomEndpoints inst={inst} profile={profile} data={custom.data} error={custom.error} refresh={refresh} />
    </div>
  );
}

/** After a change: the list, the Modèles tab and the chat's model picker are read again. */
function useRefreshProviders(inst: string, profile: string) {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: configKey(inst, profile, 'providers') }),
    qc.invalidateQueries({ queryKey: configKey(inst, profile, 'custom-providers') }),
    qc.invalidateQueries({ queryKey: configKey(inst, profile, 'env') }),
    qc.invalidateQueries({ queryKey: configKey(inst, profile, 'models') }),
    qc.invalidateQueries({ queryKey: ['chat-models', inst, profile] }),
  ]);
}

type Refresh = () => Promise<unknown>;

// ---------------------------------------------------------------- subscriptions

type Ended = { provider: string; status: string; error: string | null; model: string | null };

const ENDED_TEXT: Record<string, string> = {
  denied: 'La connexion a été refusée.',
  expired: 'Le code a expiré ou la session n’existe plus. Recommencez.',
  cancelled: 'Connexion annulée.',
  error: 'La connexion a échoué.',
};

function Accounts({ inst, profile, accounts, can, refresh }: {
  inst: string; profile: string; accounts: ProviderAccount[] | null; can: (op: string) => boolean; refresh: Refresh;
}) {
  const [pending, setPending] = useState<PendingConnect | null>(() => {
    const saved = loadConnect(inst, profile);
    return resumable(saved) ? saved : null;
  });
  const [ended, setEnded] = useState<Ended | null>(null);
  const keep = (p: PendingConnect | null) => { setPending(p); saveConnect(inst, profile, p); };

  const start = useMutation({
    mutationFn: (provider: string) => api.connectProvider(inst, profile, provider),
    onSuccess: (s, provider) => {
      setEnded(null);
      keep({ provider, sessionId: s.sessionId, userCode: s.userCode, verificationUrl: s.verificationUrl, pollInterval: s.pollInterval, expiresIn: s.expiresIn, startedAt: Date.now() });
    },
  });
  const disconnect = useMutation({
    mutationFn: (provider: string) => api.disconnectProvider(inst, profile, provider),
    onSuccess: () => refresh(),
  });

  const finish = (provider: string, r: ConnectPoll) => {
    keep(null);
    setEnded({ provider, ...r });
    if (r.status === 'approved') void refresh();
  };

  if (accounts === null) return <Panel title="Abonnements"><p className="px-5 py-4 text-sm text-ink-soft">Hermes ne donne pas cette information.</p></Panel>;
  return (
    <Panel title="Abonnements" bodyClassName="divide-y divide-line">
      {accounts.length === 0 && <p className="px-5 py-4 text-sm text-ink-soft">Aucun fournisseur à abonnement.</p>}
      {accounts.map((a) => (
        <div key={a.id} className="px-5 py-3" data-account={a.id}>
          <div className="flex flex-wrap items-center gap-3">
            <Mark state={a.connected ? 'full' : 'unavailable'} />
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{a.name}</span>
              <span className="block text-xs text-ink-faint">
                {a.connected ? 'Connecté' : a.flow === 'external' ? 'Non connecté — à faire sur la machine d’Hermes' : 'Non connecté'}
                {a.connected && a.expiresAt && <> · jeton valable jusqu’au {formatDate(a.expiresAt)}</>}
              </span>
            </div>
            {a.docsUrl && (
              <a href={a.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
                Documentation<ExternalLink className="size-3" strokeWidth={1.5} />
              </a>
            )}
            {a.flow === 'device_code' && !a.connected && can('oauthStart') && pending?.provider !== a.id && (
              <Button className="h-8" disabled={pending !== null || start.isPending} onClick={() => start.mutate(a.id)}>
                {start.isPending && start.variables === a.id ? 'Connexion…' : 'Connecter'}
              </Button>
            )}
            {a.connected && a.disconnectable && can('oauthDisconnect') && (
              <Button variant="ghost" className="h-8" disabled={disconnect.isPending}
                onClick={async () => {
                  if (await ask({ title: `Déconnecter ${a.name} ?`, message: 'Le chat ne pourra plus utiliser ses modèles.', confirmLabel: 'Déconnecter', danger: true })) disconnect.mutate(a.id);
                }}>
                Déconnecter
              </Button>
            )}
          </div>
          {a.flow === 'external' && !a.connected && a.cliCommand && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-raised px-2 py-1 font-mono text-[12.5px]">{a.cliCommand}</code>
              <Button variant="ghost" className="h-7 px-2" aria-label="Copier la commande" onClick={() => void copyText(a.cliCommand!, 'Commande')}>
                <Copy className={ICON} strokeWidth={1.5} />
              </Button>
            </div>
          )}
          {a.connected && a.disconnectHint && !a.disconnectable && <p className="mt-1 text-xs text-ink-faint">{a.disconnectHint}</p>}
          {pending?.provider === a.id && (
            <Connecting key={pending.sessionId} inst={inst} profile={profile} pending={pending} name={a.name}
              onEnd={(r) => finish(a.id, r)} canCancel={can('oauthCancel')} />
          )}
          {ended?.provider === a.id && <EndedLine ended={ended} name={a.name} onRetry={can('oauthStart') ? () => start.mutate(a.id) : undefined} />}
          {start.isError && start.variables === a.id && <div className="mt-2"><ErrorText error={start.error} /></div>}
          {disconnect.isError && disconnect.variables === a.id && <div className="mt-2"><ErrorText error={disconnect.error} /></div>}
        </div>
      ))}
    </Panel>
  );
}

/** A login waiting for its validation on the provider's site; polls Intendia until Hermes says how it ended. */
function Connecting({ inst, profile, pending, name, onEnd, canCancel }: {
  inst: string; profile: string; pending: PendingConnect; name: string; onEnd: (r: ConnectPoll) => void; canCancel: boolean;
}) {
  const [problem, setProblem] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!resumable(pending)) { onEndRef.current({ status: 'expired', error: null, model: null }); return; }
      try {
        const r = await api.pollConnect(inst, profile, pending.provider, pending.sessionId);
        if (stop) return;
        setProblem(null);
        if (r.status !== 'pending') { onEndRef.current(r); return; }
      } catch (err) {
        if (stop) return;
        setProblem(err);
      }
      timer = setTimeout(() => void tick(), nextPollDelay(pending.pollInterval));
    };
    timer = setTimeout(() => void tick(), nextPollDelay(pending.pollInterval));
    // leaving the tab only stops the polling: the login goes on in Hermes and is resumed on return
    return () => { stop = true; clearTimeout(timer); };
  }, [inst, profile, pending]);

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancelConnect(inst, profile, pending.sessionId);
      onEndRef.current({ status: 'cancelled', error: null, model: null });
    } catch (err) {
      setProblem(err);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-raised/50 p-4" data-connecting={pending.provider}>
      <p className="text-sm">Ouvrez la page de validation de {name}, connectez-vous et saisissez ce code :</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-line bg-sheet px-3 py-1.5 font-mono text-xl tracking-widest" data-user-code>{pending.userCode}</span>
        <Button variant="ghost" className="h-8 px-2" aria-label="Copier le code" onClick={() => void copyText(pending.userCode, 'Code')}>
          <Copy className={ICON} strokeWidth={1.5} />
        </Button>
        <a href={pending.verificationUrl} target="_blank" rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-strong">
          Ouvrir la page de validation<ExternalLink className={ICON} strokeWidth={1.5} />
        </a>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-faint">En attente de la validation… Vous pouvez quitter cet onglet, la connexion continue.</span>
        {canCancel && <Button variant="ghost" className="h-8" disabled={cancelling} onClick={() => void cancel()}>Annuler</Button>}
      </div>
      {problem !== null && <ErrorText error={problem} />}
    </div>
  );
}

function EndedLine({ ended, name, onRetry }: { ended: Ended; name: string; onRetry?: () => void }) {
  if (ended.status === 'approved') {
    return (
      <p className="mt-2 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok" role="status">
        {name} est connecté : ses modèles sont proposés dans le chat.
        {ended.model && <> Hermes a aussi choisi le modèle principal : <span className="font-mono">{ended.model}</span>.</>}
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="status">
      <span className="flex-1">{ENDED_TEXT[ended.status] ?? `La connexion s’est arrêtée (${ended.status}).`}{ended.error && <> {ended.error}</>}</span>
      {onRetry && <Button className="h-7" onClick={onRetry}>Recommencer</Button>}
    </div>
  );
}

function formatDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------- API keys

function Keys({ inst, profile, info, can, refresh, onVariable, endpoints }: {
  inst: string; profile: string; info: ProvidersInfo; can: (op: string) => boolean; refresh: Refresh; onVariable: (key: string) => void;
  endpoints: CustomProvider[];
}) {
  if (info.keys === null) return <Panel title="Clés d’API"><p className="px-5 py-4 text-sm text-ink-soft">Hermes ne donne pas cette information.</p></Panel>;
  const names = new Map(info.keyProviders.map((p) => [p.slug, p.name]));
  const byProvider = new Map<string, ProviderKey[]>();
  for (const k of info.keys) byProvider.set(k.provider, [...(byProvider.get(k.provider) ?? []), k]);
  return (
    <Panel title="Clés d’API" bodyClassName="divide-y divide-line">
      {byProvider.size === 0 && <p className="px-5 py-4 text-sm text-ink-soft">Aucune clé d’API enregistrée dans Hermes.</p>}
      {[...byProvider.entries()].map(([provider, keys]) => (
        <div key={provider} className="px-5 py-3" data-provider-keys={provider}>
          <h3 className="text-sm font-medium">{names.get(provider) ?? provider} <span className="font-mono text-xs font-normal text-ink-faint">{provider}</span></h3>
          <ul className="mt-1 divide-y divide-line/60">
            {keys.map((k) => (
              <KeyRow key={k.id} inst={inst} profile={profile} k={k} name={names.get(provider) ?? provider} canRemove={can('poolRemove')}
                canDeleteEnv={can('deleteEnv')} endpoints={endpoints} refresh={refresh} onVariable={onVariable} />
            ))}
          </ul>
        </div>
      ))}
      {can('poolAdd') && <div className="px-5 py-4"><AddKey inst={inst} profile={profile} providers={info.keyProviders} refresh={refresh} /></div>}
    </Panel>
  );
}

function KeyRow({ inst, profile, k, name, canRemove, canDeleteEnv, endpoints, refresh, onVariable }: {
  inst: string; profile: string; k: ProviderKey; name: string; canRemove: boolean; canDeleteEnv: boolean; endpoints: CustomProvider[];
  refresh: Refresh; onVariable: (key: string) => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({ mutationFn: () => api.removeProviderKey(inst, profile, k.provider, k.id), onSuccess: () => refresh() });
  const variable = k.source.startsWith('env:') ? k.source.slice(4) : null;
  // the variable is deleted from Hermes's .env; still listed after a reload = set outside Hermes (container env)
  const [tried, setTried] = useState(false);
  const dropEnv = useMutation({
    mutationFn: () => api.deleteEnv(inst, profile, variable!),
    onSettled: async () => { setTried(true); await refresh(); },
  });
  const askDropEnv = async () => {
    if (!variable) return;
    const users = endpoints.filter((e) => e.key?.kind === 'env' && e.key.name === variable).map((e) => e.name);
    const main = qc.getQueryData<{ main: { provider: string } }>(configKey(inst, profile, 'models'))?.main.provider;
    const still = [...users.map((u) => `l’endpoint ${u}`), ...(main === k.provider ? ['le modèle principal'] : [])];
    const ok = await ask({
      title: `Retirer la clé ${k.label} ?`,
      message: `La variable ${variable} sera supprimée du fichier .env d’Hermes. Ce n’est pas annulable : il faudra ressaisir la clé.`
        + (still.length ? ` Elle sert encore à : ${still.join(', ')}.` : ''),
      confirmLabel: 'Retirer', danger: true,
    });
    if (ok) dropEnv.mutate();
  };
  return (
    <li className="py-2" data-key={k.id}>
      <div className="flex flex-wrap items-center gap-3">
        <KeyRound className="size-4 text-ink-faint" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm">{k.label}</span>
          <span className="block text-xs text-ink-faint">
            {variable ? <>Clé de la variable <span className="font-mono">{variable}</span></> : k.source === 'manual' ? 'Ajoutée à la main' : k.source}
            {k.lastStatus && <> · dernier état : {k.lastStatus}</>}
          </span>
        </div>
        {variable && <Button variant="ghost" className="h-8" onClick={() => onVariable(variable)}>Voir la variable</Button>}
        {variable && canDeleteEnv && (
          <Button variant="ghost" className="h-8 px-2" aria-label={`Retirer la clé ${k.label}`} disabled={dropEnv.isPending} onClick={() => void askDropEnv()}>
            <Trash2 className={ICON} strokeWidth={1.5} />
          </Button>
        )}
        {k.source === 'manual' && canRemove && (
          <Button variant="ghost" className="h-8 px-2" aria-label={`Retirer la clé ${k.label}`} disabled={remove.isPending}
            onClick={async () => {
              if (await ask({ title: `Retirer la clé ${k.label} ?`, message: `Hermes ne pourra plus l’utiliser pour ${name}.`, confirmLabel: 'Retirer', danger: true })) remove.mutate();
            }}>
            <Trash2 className={ICON} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {tried && !dropEnv.isError && (
        <p className="mt-1 text-xs text-ink-soft">Cette variable est définie hors d’Hermes (environnement du conteneur) : retirez-la là où elle est posée.</p>
      )}
      <ErrorText error={remove.error ?? dropEnv.error} />
    </li>
  );
}

function AddKey({ inst, profile, providers, refresh }: { inst: string; profile: string; providers: { slug: string; name: string }[]; refresh: Refresh }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const add = useMutation({
    mutationFn: () => api.addProviderKey(inst, profile, { provider, apiKey: key.trim(), label: label.trim() || undefined }),
    // the key field is emptied after a success as after a failure: the value is never kept on screen
    onSettled: () => setKey(''),
    onSuccess: async () => { setLabel(''); setOpen(false); await refresh(); },
  });
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className={ICON} strokeWidth={1.5} />Ajouter une clé d’API</Button>;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (provider && key.trim()) add.mutate(); }}>
      <div className="flex flex-wrap gap-2">
        <select className={cx(SELECT, 'w-56')} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Fournisseur">
          <option value="">Fournisseur…</option>
          {providers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        <Input className="w-48" placeholder="Libellé (facultatif)" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Libellé" />
        <Input type="password" autoComplete="off" className="min-w-64 flex-1 font-mono text-[12.5px]" placeholder="Clé d’API" value={key}
          onChange={(e) => setKey(e.target.value)} aria-label="Clé d’API" />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={!provider || !key.trim() || add.isPending}>{add.isPending ? 'Ajout…' : 'Ajouter'}</Button>
        <Button variant="ghost" type="button" onClick={() => { setOpen(false); setKey(''); add.reset(); }}>Annuler</Button>
      </div>
      <ErrorText error={add.error} />
    </form>
  );
}

// ---------------------------------------------------------------- custom endpoints

/**
 * OpenAI-compatible servers (Ollama, vLLM, LM Studio, a proxy…) written in `providers.<slug>` of the config file,
 * their key in a variable of Hermes. Old `custom_providers` entries are shown, changed in the YAML tab.
 */
function CustomEndpoints({ inst, profile, data, error, refresh }: {
  inst: string; profile: string; data: { endpoints: CustomProvider[]; writable: boolean } | undefined; error: unknown; refresh: Refresh;
}) {
  const [left, setLeft] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (slug: string) => api.removeCustomProvider(inst, profile, slug),
    onSuccess: async (r) => { setLeft(r.keyLeft ?? null); await refresh(); },
  });
  if (error) return <Panel title="Endpoints personnalisés"><div className="px-5 py-4"><ErrorText error={error} /></div></Panel>;
  if (!data) return null;
  return (
    <Panel title="Endpoints personnalisés" bodyClassName="divide-y divide-line">
      <p className="px-5 py-3 text-sm text-ink-soft">Un serveur compatible OpenAI (Ollama, vLLM, LM Studio, un proxy…). Ses modèles sont proposés dans le chat.</p>
      {data.endpoints.length === 0 && <p className="px-5 py-3 text-sm text-ink-soft">Aucun endpoint personnalisé.</p>}
      {data.endpoints.map((e) => (
        <div key={e.slug ?? `old:${e.name}:${e.baseUrl}`} className="flex flex-wrap items-center gap-3 px-5 py-3" data-endpoint={e.slug ?? e.name}>
          <Server className="size-4 text-ink-faint" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{e.name} {e.slug && <span className="font-mono text-xs font-normal text-ink-faint">{e.slug}</span>}</span>
            <span className="block truncate font-mono text-xs text-ink-faint" title={e.baseUrl}>{e.baseUrl}</span>
            <span className="block text-xs text-ink-faint">
              {e.model ? <>Modèle : <span className="font-mono">{e.model}</span> · </> : null}
              {e.key === null ? 'Sans clé' : e.key.kind === 'inline' ? 'Clé écrite dans le fichier' : e.key.set ? <>Clé dans <span className="font-mono">{e.key.name}</span></> : <>Variable <span className="font-mono">{e.key.name}</span> absente</>}
              {e.legacy && ' · ancienne forme, à modifier dans l’onglet YAML'}
            </span>
          </div>
          {e.slug && data.writable && (
            <Button variant="ghost" className="h-8 px-2" aria-label={`Supprimer l’endpoint ${e.name}`} disabled={remove.isPending}
              onClick={async () => {
                const ok = await ask({
                  title: `Supprimer l’endpoint ${e.name} ?`,
                  message: 'Ses modèles ne seront plus proposés dans le chat.'
                    + (e.key?.kind === 'env' && e.key.name.startsWith('INTENDIA_') ? ` Sa clé (${e.key.name}) est supprimée aussi : restaurer la configuration depuis Historique ne la remettra pas.` : ''),
                  confirmLabel: 'Supprimer', danger: true,
                });
                if (ok) remove.mutate(e.slug!);
              }}>
              <Trash2 className={ICON} strokeWidth={1.5} />
            </Button>
          )}
        </div>
      ))}
      {!data.writable && data.endpoints.some((e) => e.slug) && <p className="px-5 py-3 text-xs text-ink-faint">Modification impossible sur cette instance : utilisez l’onglet YAML.</p>}
      {(remove.error || left) && (
        <div className="px-5 py-3">
          <ErrorText error={remove.error} />
          {left && <p className="text-xs text-ink-soft">Endpoint supprimé, mais la variable {left} n’a pas pu l’être : retirez-la dans l’onglet Variables.</p>}
        </div>
      )}
      {data.writable && <div className="px-5 py-4"><AddEndpoint inst={inst} profile={profile} refresh={refresh} /></div>}
    </Panel>
  );
}

function AddEndpoint({ inst, profile, refresh }: { inst: string; profile: string; refresh: Refresh }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const add = useMutation({
    mutationFn: () => api.addCustomProvider(inst, profile, {
      name: name.trim(), baseUrl: baseUrl.trim(), ...(key.trim() ? { apiKey: key.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}),
    }),
    // the key field is emptied after a success as after a failure: the value is never kept on screen
    onSettled: () => setKey(''),
    onSuccess: async () => { setName(''); setBaseUrl(''); setModel(''); setOpen(false); await refresh(); },
  });
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className={ICON} strokeWidth={1.5} />Ajouter un endpoint</Button>;
  const ready = name.trim() && /^https?:\/\/./.test(baseUrl.trim());
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(); }}>
      <div className="flex flex-wrap gap-2">
        <Input className="w-48" placeholder="Nom (ex. Ollama maison)" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom de l’endpoint" />
        <Input className="min-w-64 flex-1 font-mono text-[12.5px]" placeholder="http://127.0.0.1:11434/v1" maxLength={2048} value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)} aria-label="Adresse de l’endpoint" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Input type="password" autoComplete="off" className="min-w-64 flex-1 font-mono text-[12.5px]" placeholder="Clé d’API (facultative)" value={key}
          onChange={(e) => setKey(e.target.value)} aria-label="Clé d’API de l’endpoint" />
        <Input className="w-56 font-mono text-[12.5px]" placeholder="Modèle (facultatif)" maxLength={200} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Modèle" />
      </div>
      <p className="text-xs text-ink-faint">La clé est gardée dans une variable d’Hermes, jamais dans le fichier de configuration.</p>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={!ready || add.isPending}>{add.isPending ? 'Ajout…' : 'Ajouter'}</Button>
        <Button variant="ghost" type="button" onClick={() => { setOpen(false); setKey(''); add.reset(); }}>Annuler</Button>
      </div>
      <ErrorText error={add.error} />
    </form>
  );
}
