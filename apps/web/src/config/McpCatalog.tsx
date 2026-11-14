import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Search, X } from 'lucide-react';
import { useState } from 'react';
import { api, type McpCatalogEntry } from '../api';
import { Button, ErrorText, Input, Panel, Tag } from '../components/ui';
import { configKey, ICON, useInvalidateConfig } from './common';
import { McpConnect } from './McpConnect';
import { t } from '../i18n';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** "Depuis le catalogue": the approved MCP servers shipped with Hermes, installed with their variables, then connected. */
export function McpCatalog({ inst, profile, can, onClose, onSaved }: {
  inst: string; profile: string; can: (op: string) => boolean; onClose: () => void; onSaved: () => void;
}) {
  const catalog = useQuery({ queryKey: configKey(inst, profile, 'mcp-catalog'), queryFn: () => api.mcpCatalog(inst, profile) });
  const [q, setQ] = useState('');
  const words = fold(q).split(/\s+/).filter(Boolean);
  const list = (catalog.data?.entries ?? []).filter((e) => words.every((w) => fold(`${e.name} ${e.description}`).includes(w)));
  return (
    <Panel
      title={t('Catalogue MCP d’Hermes')}
      action={<Button variant="ghost" className="h-8 w-8 px-0" aria-label={t('Fermer le catalogue')} onClick={onClose}><X className={ICON} strokeWidth={1.5} /></Button>}
      bodyClassName="border-t border-line/70"
    >
      <div className="space-y-2 px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" strokeWidth={1.5} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Chercher un serveur (notion, linear…)')} aria-label={t('Chercher dans le catalogue MCP')} className="pl-8" />
        </div>
        {catalog.data && !catalog.data.relay && (
          <p className="text-xs text-ink-faint">{t('Les serveurs OAuth se connectent depuis Intendia si INTENDIA_PUBLIC_URL est défini (ou dashboard.public_url chez Hermes).')}</p>
        )}
      </div>
      {catalog.isPending && <p className="px-4 pb-4 text-sm text-ink-soft">{t('Lecture du catalogue…')}</p>}
      <div className="px-4 empty:hidden"><ErrorText error={catalog.error} /></div>
      <ul className="max-h-[560px] divide-y divide-line/70 overflow-y-auto border-t border-line/70" aria-label={t('Serveurs du catalogue')}>
        {list.map((e) => <CatalogEntry key={e.name} e={e} inst={inst} profile={profile} can={can} onSaved={onSaved} />)}
      </ul>
      {catalog.data && list.length === 0 && <p className="px-4 py-4 text-sm text-ink-soft">{t('Aucun serveur ne correspond.')}</p>}
      {catalog.data && catalog.data.diagnostics.length > 0 && (
        <details className="border-t border-line/70 px-4 py-3 text-xs text-ink-faint">
          <summary className="cursor-pointer">{t('Entrées illisibles pour Hermes ({n})', { n: catalog.data.diagnostics.length })}</summary>
          <ul className="mt-1.5 space-y-0.5 font-mono">{catalog.data.diagnostics.map((d) => <li key={d}>{d}</li>)}</ul>
        </details>
      )}
    </Panel>
  );
}

function CatalogEntry({ e, inst, profile, can, onSaved }: { e: McpCatalogEntry; inst: string; profile: string; can: (op: string) => boolean; onSaved: () => void }) {
  const invalidate = useInvalidateConfig(inst, profile);
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<Record<string, string>>({});
  const install = useMutation({
    mutationFn: () => api.installMcpCatalog(inst, profile, e.name, env),
    onSuccess: async () => { setOpen(false); setEnv({}); await invalidate(); onSaved(); },
  });
  const missing = e.requiredEnv.filter((r) => r.required && !env[r.name]?.trim());
  const where = e.url ?? [e.command, ...e.args].filter(Boolean).join(' ');
  return (
    <li className="space-y-2 px-4 py-3" data-mcp-catalog={e.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-medium">{e.name}</span>
        <Tag>{e.auth === 'oauth' ? 'OAuth' : e.auth === 'none' ? t('sans compte') : e.auth}</Tag>
        {e.installed && <Tag className="bg-ok-soft text-ok">{e.enabled ? t('installé') : t('installé, désactivé')}</Tag>}
        <span className="flex-1" />
        {e.docsUrl && (
          <a href={e.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
            <ExternalLink className="size-3.5" strokeWidth={1.5} />{t('Documentation')}
          </a>
        )}
        {!e.installed && can('mcpInstall') && !open && (
          <Button className="h-8" onClick={() => (e.requiredEnv.length ? setOpen(true) : install.mutate())} disabled={install.isPending} aria-label={t('Installer {name}', { name: e.name })}>
            <Download className={ICON} strokeWidth={1.5} />{install.isPending ? t('Installation…') : t('Installer')}
          </Button>
        )}
      </div>
      {e.description && <p className="text-[13px] text-ink-soft">{e.description}</p>}
      {where && <p className="break-all font-mono text-[11.5px] text-ink-faint">{where}{e.needsInstall ? ` · ${t('dépôt cloné et construit par Hermes')}` : ''}</p>}
      {open && (
        <form className="space-y-2.5 rounded-xl border border-line p-3" onSubmit={(ev) => { ev.preventDefault(); if (!missing.length) install.mutate(); }}>
          {e.requiredEnv.map((r) => (
            <label key={r.name} className="block space-y-1">
              <span className="block text-xs text-ink-soft"><span className="font-mono">{r.name}</span>{r.required ? '' : ` ${t('(facultatif)')}`}{r.prompt ? ` : ${r.prompt}` : ''}</span>
              <Input type="password" autoComplete="off" className="font-mono text-[12.5px]" value={env[r.name] ?? ''} aria-label={r.name}
                onChange={(ev) => setEnv((o) => ({ ...o, [r.name]: ev.target.value }))} />
            </label>
          ))}
          <p className="text-xs text-ink-faint">{t('Les valeurs vont directement à Hermes (fichier .env de l’agent pour les secrets) ; Intendia ne les garde pas.')}</p>
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={missing.length > 0 || install.isPending}>{install.isPending ? t('Installation…') : t('Installer')}</Button>
            <Button type="button" onClick={() => setOpen(false)}>{t('Annuler')}</Button>
          </div>
        </form>
      )}
      <ErrorText error={install.error} />
      {install.data?.background && <p className="text-xs text-ink-faint">{t('Hermes installe ce serveur en fond (dépôt à cloner) : il apparaîtra dans la liste à la fin.')}</p>}
      {(e.installed || install.isSuccess) && e.postInstall && <p className="whitespace-pre-line text-xs text-ink-faint">{e.postInstall}</p>}
      {e.installed && e.auth === 'oauth' && can('mcpAuth') && <McpConnect inst={inst} profile={profile} name={e.name} onApproved={onSaved} />}
    </li>
  );
}
