import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { api, type ModelProvider } from '../api';
import { Button, ErrorText, Input } from '../components/ui';
import { ConfigBox } from './Box';
import { addChoices } from './chat-models-edit';
import { configKey, ICON } from './common';
import { plural, t } from '../i18n';
import { T } from '../i18n/T';

/**
 * "Modèles du chat": for each provider with a key, the models declared in Hermes for it (`providers.<slug>.models`
 * of its config file). The chat offers those, or the provider's whole catalogue when none is declared. Each add or
 * remove is written into Hermes at once.
 */
export function ChatModels({ inst, profile, providers, writable, onYaml, onProviders }: {
  inst: string; profile: string; providers: ModelProvider[]; writable: boolean; onYaml?: () => void; onProviders?: () => void;
}) {
  const withKey = providers.filter((p) => p.authenticated);
  return (
    <ConfigBox id="cf-c" title={t('Modèles du chat')} description={t('Les modèles proposés dans le chat, par fournisseur. Sans modèle choisi, le chat propose tout le catalogue du fournisseur. La liste est écrite dans la configuration d’Hermes.')}>
      {withKey.length === 0
        ? (
          <p className="text-sm text-ink-soft">
            <T k="Aucun fournisseur n’est connecté : le chat propose seulement « Auto ». Ajoutez un abonnement ou une clé dans l’onglet {tab}." vars={{
              tab: onProviders ? <button type="button" className="text-accent-ink underline-offset-2 hover:underline" onClick={onProviders}>{t('Fournisseurs')}</button> : t('Fournisseurs'),
            }} />
          </p>
        )
        : <div className="space-y-3">{withKey.map((p) => <ProviderBlock key={p.slug} inst={inst} profile={profile} p={p} writable={writable} onYaml={onYaml} />)}</div>}
    </ConfigBox>
  );
}

function ProviderBlock({ inst, profile, p, writable, onYaml }: { inst: string; profile: string; p: ModelProvider; writable: boolean; onYaml?: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const change = useMutation({
    mutationFn: (body: { add: string } | { remove: string }) => api.changeProviderModels(inst, profile, { provider: p.slug, ...body }),
    onSuccess: async () => {
      setQ('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: configKey(inst, profile, 'models') }),
        qc.invalidateQueries({ queryKey: ['chat-models', inst, profile] }),
      ]);
    },
  });
  const busy = change.isPending;
  const editable = writable && p.editable;
  const found = q.trim() ? addChoices(p.models, p.declared, q) : [];

  return (
    <div className="rounded-[10px] border border-line p-4" data-provider-models={p.slug}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{p.name}</h3>
        <span className="font-mono text-xs text-ink-faint">{p.slug}</span>
      </div>
      {p.declared.length === 0
        ? <p className="mt-2 text-sm text-ink-soft" data-catalogue>{plural(p.models.length, 'Aucun modèle choisi : le chat propose tout le catalogue ({n} modèle).', 'Aucun modèle choisi : le chat propose tout le catalogue ({n} modèles).')}</p>
        : (
          <ul className="mt-2 divide-y divide-line" data-declared>
            {p.declared.map((m) => (
              <li key={m} className="flex items-center gap-2 py-1.5" data-declared-model={m}>
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{m}</span>
                {editable && (
                  <Button variant="ghost" className="h-7 px-1.5" disabled={busy} aria-label={t('Retirer {name}', { name: m })} title={t('Retirer')} onClick={() => change.mutate({ remove: m })}>
                    <X className={ICON} strokeWidth={1.5} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      {editable ? (
        <>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
            <Input className="pl-8" placeholder={t('Ajouter un modèle (chercher ou taper son nom)')} value={q} disabled={busy}
              onChange={(e) => setQ(e.target.value)} aria-label={t('Ajouter un modèle {provider}', { provider: p.name })} />
          </div>
          {found.length > 0 && (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line" data-add-choices>
              {found.map((c) => (
                <li key={`${c.typed ? 'typed:' : ''}${c.model}`}>
                  <button type="button" disabled={busy} onClick={() => change.mutate({ add: c.model })}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12.5px] hover:bg-raised focus:bg-raised focus:outline-none disabled:opacity-50">
                    <Plus className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
                    <span className="min-w-0 truncate">{c.model}</span>
                    {c.typed && <span className="ml-auto shrink-0 font-sans text-xs text-ink-faint">{t('nom tapé')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim() && found.length === 0 && <p className="mt-2 text-xs text-ink-faint">{t('Aucun modèle ne correspond (nom sans espace).')}</p>}
        </>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">
          {!writable ? t('Écriture impossible : Hermes ne donne pas le fichier de configuration.') : (
            <T k="Liste propre à ce fournisseur : {link}." vars={{
              link: onYaml ? <button type="button" className="underline hover:text-ink" onClick={onYaml}>{t('modifiable dans l’onglet YAML')}</button> : t('modifiable dans l’onglet YAML'),
            }} />
          )}
        </p>
      )}
      {change.isError && <p className="mt-2 text-sm text-bad"><ErrorText error={change.error} /></p>}
    </div>
  );
}
