import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LibraryBig, Plug, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type McpInput, type McpServer } from '../api';
import { Button, ErrorText, Input, Mark, Panel } from '../components/ui';
import { configKey, ICON, SELECT, useInvalidateConfig, type TabProps } from './common';
import { ask } from '../components/Dialog';
import { McpCatalog } from './McpCatalog';
import { McpConnect } from './McpConnect';
import { plural, t } from '../i18n';

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** MCP servers Hermes connects to (not Intendia's own share_file server, see the instance page). */
export function ConfigMcp({ inst, profile, can, onSaved }: TabProps) {
  const servers = useQuery({ queryKey: configKey(inst, profile, 'mcp'), queryFn: () => api.mcpServers(inst, profile).then((r) => r.servers) });
  const [left, setLeft] = useState<string | null>(null);
  const [catalog, setCatalog] = useState(false);
  if (servers.isPending) return <p className="text-sm text-ink-soft">{t('Lecture des serveurs MCP…')}</p>;
  if (servers.isError) return <ErrorText error={servers.error} />;
  const list = servers.data ?? [];
  return (
    <div className="space-y-4">
      {left && <p className="text-sm text-warn">{t('La variable {name} garde encore le jeton : supprimez-la dans l’onglet Variables si elle ne sert plus.', { name: left })}</p>}
      <div className="flex flex-wrap items-start gap-2">
        {can('addMcp') && <AddMcp inst={inst} profile={profile} existing={list.map((s) => s.name)} onSaved={() => onSaved(true)} />}
        {can('mcpCatalog') && !catalog && <Button onClick={() => setCatalog(true)}><LibraryBig className={ICON} strokeWidth={1.5} />{t('Depuis le catalogue')}</Button>}
        <span className="flex-1" />
        <Link to="/i/$inst/suivi" params={{ inst }} search={{ tab: 'logs', file: 'mcp', profile: profile === 'default' ? undefined : profile }}
          className="inline-flex h-9 items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink">
          <ScrollText className={ICON} strokeWidth={1.5} />{t('Journal MCP')}
        </Link>
      </div>
      {catalog && <McpCatalog inst={inst} profile={profile} can={can} onClose={() => setCatalog(false)} onSaved={() => onSaved(true)} />}
      <Panel title={t('Serveurs')} bodyClassName="divide-y divide-line/70 border-t border-line/70">
        {list.length === 0 && <p className="p-5 text-sm text-ink-soft">{t('Aucun serveur MCP.')}</p>}
        {list.map((s) => <McpRow key={s.name} s={s} inst={inst} profile={profile} can={can} onSaved={() => onSaved(true)} onTokenLeft={setLeft} />)}
      </Panel>
    </div>
  );
}

function McpRow({ s, inst, profile, can, onSaved, onTokenLeft }: {
  s: McpServer; inst: string; profile: string; can: TabProps['can']; onSaved: () => void; onTokenLeft: (k: string | null) => void;
}) {
  const invalidate = useInvalidateConfig(inst, profile);
  const test = useMutation({ mutationFn: () => api.testMcp(inst, profile, s.name) });
  const toggle = useMutation({
    mutationFn: () => api.enableMcp(inst, profile, s.name, !s.enabled),
    onSuccess: async () => { await invalidate(); onSaved(); },
  });
  const remove = useMutation({
    mutationFn: () => api.removeMcp(inst, profile, s.name),
    onSuccess: async (res) => { onTokenLeft(res.tokenLeft ?? null); await invalidate(); onSaved(); },
  });
  const managed = !!s.plugin;
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Mark state={s.enabled ? 'full' : 'unavailable'} />
        <div className="min-w-0 flex-1">
          <span className="block font-mono text-[12.5px]">{s.name}</span>
          <span className="block break-all text-xs text-ink-faint">
            {s.url ?? [s.command, ...s.args].filter(Boolean).join(' ')}{s.transport ? ` · ${s.transport}` : ''}{s.auth ? ` · ${t('auth {mode}', { mode: s.auth })}` : ''}
            {managed ? ` · ${t('fourni par le plugin {plugin}', { plugin: s.plugin ?? '' })}` : ''}
          </span>
        </div>
        {can('testMcp') && <Button className="h-8" disabled={test.isPending} onClick={() => test.mutate()}><Plug className={ICON} strokeWidth={1.5} />{test.isPending ? t('Test…') : t('Tester')}</Button>}
        {!managed && can('enableMcp') && <Button className="h-8" disabled={toggle.isPending} onClick={() => toggle.mutate()}>{s.enabled ? t('Désactiver') : t('Activer')}</Button>}
        {!managed && can('removeMcp') && (
          <Button variant="ghost" className="h-8 px-2" aria-label={t('Supprimer {name}', { name: s.name })} disabled={remove.isPending}
            onClick={async () => { if (await ask({ title: t('Supprimer le serveur MCP {name} ?', { name: s.name }), confirmLabel: t('Supprimer'), danger: true })) remove.mutate(); }}>
            <Trash2 className={ICON} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {!managed && s.auth === 'oauth' && s.url && can('mcpAuth') && <McpConnect inst={inst} profile={profile} name={s.name} onApproved={onSaved} />}
      {s.env.length > 0 && <p className="text-xs text-ink-faint">{t('Variables : {list}', { list: s.env.map((e) => (e.isSet ? e.key : t('{name} (vide)', { name: e.key }))).join(', ') })}</p>}
      {test.data && (test.data.ok
        ? <p className="text-xs text-ok">{plural(test.data.tools.length, 'Connexion réussie : {n} outil{list}.', 'Connexion réussie : {n} outils{list}.', {
          list: test.data.tools.length ? ` (${test.data.tools.slice(0, 8).join(', ')}${test.data.tools.length > 8 ? '…' : ''})` : '',
        })}</p>
        : <p className="text-xs text-bad">{t('Échec : {error}', { error: test.data.error ?? t('erreur inconnue') })}</p>)}
      <ErrorText error={test.error ?? toggle.error ?? remove.error} />
    </div>
  );
}

function AddMcp({ inst, profile, existing, onSaved }: { inst: string; profile: string; existing: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'url' | 'command'>('url');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const invalidate = useInvalidateConfig(inst, profile);
  const add = useMutation({
    mutationFn: () => {
      const input: McpInput = kind === 'url'
        ? { name: name.trim(), url: url.trim(), ...(token ? { token } : {}) }
        : { name: name.trim(), command: command.trim(), args: args.split('\n').map((a) => a.trim()).filter(Boolean) };
      return api.addMcp(inst, profile, input);
    },
    onSuccess: async () => { setOpen(false); setName(''); setUrl(''); setToken(''); setCommand(''); setArgs(''); await invalidate(); onSaved(); },
  });
  const n = name.trim();
  const nameError = n && !NAME_RE.test(n) ? t('Lettres, chiffres, - et _ (64 au plus).') : n && existing.includes(n) ? t('Ce nom existe déjà.') : null;
  const ready = n && !nameError && (kind === 'url' ? /^https?:\/\//.test(url.trim()) : !!command.trim());
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className={ICON} strokeWidth={1.5} />{t('Ajouter un serveur')}</Button>;
  return (
    <form className="space-y-3 rounded-xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(); }}>
      <div className="flex flex-wrap gap-2">
        <Input className="w-56 font-mono text-[12.5px]" placeholder={t('nom')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Nom du serveur')} />
        <select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as 'url' | 'command')} aria-label={t('Type')}>
          <option value="url">{t('Par URL (HTTP)')}</option>
          <option value="command">{t('Par commande (stdio)')}</option>
        </select>
      </div>
      {nameError && <p className="text-xs text-bad">{nameError}</p>}
      {kind === 'url' ? (
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-72 flex-1 font-mono text-[12.5px]" placeholder="https://…/mcp" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL" />
          <Input type="password" autoComplete="off" className="w-64 font-mono text-[12.5px]" placeholder={t('Jeton (facultatif)')} value={token}
            onChange={(e) => setToken(e.target.value)} aria-label={t('Jeton')} />
        </div>
      ) : (
        <div className="space-y-2">
          <Input className="font-mono text-[12.5px]" placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} aria-label={t('Commande')} />
          <textarea rows={3} className="w-full rounded-lg border border-line bg-sheet px-3 py-2 font-mono text-[12.5px] focus:border-ink focus:outline-none"
            placeholder={t('un argument par ligne')} value={args} onChange={(e) => setArgs(e.target.value)} aria-label={t('Arguments')} />
        </div>
      )}
      {kind === 'url' && token && <p className="text-xs text-ink-faint">{t('Hermes range le jeton dans sa variable {name}.', { name: `MCP_${n.toUpperCase().replace(/-/g, '_') || t('NOM')}_API_KEY` })}</p>}
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={!ready || add.isPending}>{add.isPending ? t('Ajout…') : t('Ajouter')}</Button>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>{t('Annuler')}</Button>
      </div>
      <ErrorText error={add.error} />
    </form>
  );
}
