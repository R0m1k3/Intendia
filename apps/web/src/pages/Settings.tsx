import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Pencil, Plug, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, type McpState, type McpTest, type ModuleId, type ModuleState } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { Narrow, PageHeader } from '../components/Layout';
import { useModuleAvailability } from '../components/ModuleNotice';
import { Button, Chips, copyText, cx, ErrorText, Mark, worst } from '../components/ui';
import { RESTART_CONFIRM, RestartStrip, useRestart } from '../config/restart';
import { ask, askText } from '../components/Dialog';
import { langSetting, setLangSetting, t, type LangSetting } from '../i18n';
import { T } from '../i18n/T';

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
  const a = useModuleAvailability(instanceId, 'config', [['config', 'get']], [['config', 'restartGateway', t('Redémarrer la passerelle')]]);
  const restart = useRestart(instanceId, 'default', () => {});
  if (!a.available || !a.has('config', 'restartGateway')) {
    return <p className="text-xs text-ink-faint">{t('Redémarrez Hermes vous-même : cette instance ne permet pas de le faire depuis Intendia.')}</p>;
  }
  return (
    <div className="space-y-2">
      <SmallBtn disabled={restart.running} onClick={async () => { if (await ask(RESTART_CONFIRM)) restart.start(); }}>
        <RefreshCw className={cx('size-3.5', restart.running && 'animate-spin')} strokeWidth={1.5} />
        {restart.running ? t('Redémarrage…') : t('Redémarrer {label}', { label })}
      </SmallBtn>
      <RestartStrip state={restart} />
    </div>
  );
}

/** Operations Intendia needs to put share_file into Hermes itself (same list as MCP_AUTO_OPS, apps/server/src/mcp/connect.ts). */
const MCP_AUTO_OPS: [ModuleId, string][] = [['config', 'raw'], ['config', 'mcpServers'], ['config', 'addMcp'], ['config', 'removeMcp'], ['config', 'putEnv'], ['config', 'putRaw'], ['config', 'testMcp']];

const MCP_STATE: Record<McpState, { mark: ModuleState | null; label: string; help: string }> = {
  connected: { mark: 'full', label: t('Branché'), help: t('Hermes connaît l’adresse et le jeton d’Intendia.') },
  stale: { mark: 'readonly', label: t('Jeton à envoyer à Hermes'), help: t('Le jeton a changé depuis le dernier envoi.') },
  manual: { mark: 'readonly', label: t('Ancienne configuration manuelle'), help: t('Hermes a un bloc collé à la main (jeton en clair) : Intendia le remplace.') },
  other_url: { mark: 'readonly', label: t('Une autre entrée « intendia » existe'), help: t('Hermes a déjà un serveur MCP nommé « intendia » qui pointe ailleurs.') },
  plugin: { mark: 'unavailable', label: t('Entrée fournie par un plugin'), help: t('Un plugin d’Hermes fournit déjà un serveur MCP « intendia » : Intendia ne peut pas le remplacer.') },
  missing: { mark: null, label: t('Pas branché'), help: t('L’agent ne peut pas encore partager de fichiers.') },
  unknown: { mark: 'unavailable', label: t('État inconnu'), help: t('Hermes ne répond pas, ou ne permet pas de brancher un serveur MCP depuis Intendia.') },
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
    await copyText(block, t('Bloc mcp_servers'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const start = async () => {
    if (d.state === 'other_url') {
      const yes = await ask({
        title: t('Remplacer l’entrée « intendia » ?'),
        message: t('Hermes a déjà un serveur MCP nommé « intendia » qui pointe vers une autre adresse. Il sera remplacé par celui d’Intendia ({url}).', { url: d.url }),
        confirmLabel: t('Remplacer'), danger: true,
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
    <div data-share={instanceId} data-mcp-state={d.state} className="space-y-3.5">
      {many && <p className="text-sm font-semibold">{label}</p>}
      {!d.publicUrlSet && (
        <p className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn">
          <strong className="font-semibold">{t('Adresse publique manquante.')}</strong>{' '}
          <T k="Sans {var}, les liens donnés par l’agent ne s’ouvrent que dans Intendia, pas dans Telegram." vars={{ var: <code className="font-mono text-xs">INTENDIA_PUBLIC_URL</code> }} />
        </p>
      )}
      {auto && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium"><Mark state={st.mark} />{st.label}</p>
            <p className="mt-0.5 text-[13px] text-ink-faint">{st.help}</p>
          </div>
          {canConnect && (
            <SmallBtn variant={d.state === 'connected' ? 'secondary' : 'dark'} disabled={busy} onClick={() => void start()}>
              <Plug className="size-3.5" strokeWidth={1.5} />
              {connect.isPending ? t('Test par Hermes…') : d.state === 'connected' ? t('Rebrancher') : t('Brancher Intendia à {label}', { label })}
            </SmallBtn>
          )}
        </div>
      )}
      <ErrorText error={connect.error ?? rotate.error} />
      {result && (
        <div className="space-y-1 rounded-[10px] bg-paper px-3.5 py-3 text-[13px]" data-mcp-result={result.test?.ok ? 'ok' : 'error'}>
          {result.error && <p className="text-bad">{t('Jeton changé dans Intendia, mais Hermes n’a pas été mis à jour : {error}', { error: result.error })}</p>}
          {result.test?.ok && <p className="flex items-center gap-2"><Check className="size-3.5 text-ok" strokeWidth={2} />{t('Hermes voit l’outil share_file.')}</p>}
          {result.test && !result.test.ok && (
            <p className="text-bad">
              <T k="Entrée écrite, mais Hermes ne joint pas Intendia : {error}. Vérifiez qu’Hermes et Intendia partagent un réseau Docker, ou réglez {var}." vars={{ error: result.test.error ?? t('erreur inconnue'), var: <code className="font-mono text-xs">INTENDIA_MCP_URL</code> }} />
            </p>
          )}
          {written && <p className="text-ink-soft">{t('Pris en compte au prochain redémarrage d’Hermes.')}</p>}
        </div>
      )}
      {auto && (written || d.state === 'stale' || d.state === 'connected') && (
        <div className={cx('space-y-2', written && 'rounded-lg border border-ink/30 p-3')}>
          {written && <p className="text-sm font-medium">{t('Redémarrez Hermes pour que l’agent ait l’outil')}</p>}
          <RestartInstance instanceId={instanceId} label={label} />
        </div>
      )}
      {managed && (
        <SmallBtn disabled={busy}
          onClick={async () => { if (await ask({ title: t('Régénérer le jeton ?'), message: t('L’ancien ne marchera plus. Hermes est mis à jour automatiquement ; redémarrez-le ensuite.'), confirmLabel: t('Régénérer'), danger: true })) rotate.mutate(); }}>
          {rotate.isPending ? t('Régénération…') : t('Régénérer le jeton')}
        </SmallBtn>
      )}
      <details open={!auto} className="group text-[13px]">
        <summary className="cursor-pointer select-none text-ink-soft hover:text-ink">{t('Configuration manuelle')}</summary>
        <div className="mt-3 space-y-4">
          {!auto && <p className="text-ink-soft">{t('Cette instance ne permet pas à Intendia de brancher l’outil lui-même : ajoutez ce bloc à la configuration d’Hermes, puis redémarrez-le.')}</p>}
          <div className="relative">
            <pre className="overflow-x-auto rounded-[10px] bg-paper px-4 py-3.5 pr-24 font-mono text-[12.5px] leading-[1.65]">
              {shown ? block : mcpBlock(d.url, '•'.repeat(12))}
            </pre>
            <Button className="absolute right-2 top-2 h-8 px-3 text-[13px]" onClick={() => void copy()} aria-label={t('Copier le bloc mcp_servers')}>
              <Copy className="size-3.5" strokeWidth={1.5} />{copied ? t('Copié') : t('Copier')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <SmallBtn onClick={() => setShown(!shown)}>{shown ? t('Masquer le jeton') : t('Afficher le jeton')}</SmallBtn>
            {!managed && (
              <SmallBtn disabled={busy}
                onClick={async () => { if (await ask({ title: t('Régénérer le jeton ?'), message: t('L’ancien ne marchera plus : il faudra mettre à jour la configuration d’Hermes.'), confirmLabel: t('Régénérer'), danger: true })) rotate.mutate(); }}>
                {t('Régénérer le jeton')}
              </SmallBtn>
            )}
          </div>
          {!auto && <RestartInstance instanceId={instanceId} label={label} />}
        </div>
      </details>
      <p className="text-xs text-ink-faint">
        {t('Ne publiez jamais le port {port} : Hermes doit le joindre par le réseau Docker.', { port: d.url.split(':')[2]?.split('/')[0] ?? '3001' })}
      </p>
    </div>
  );
}

function applyTheme(th: Theme) {
  document.documentElement.classList.remove('light', 'dark');
  if (th !== 'system') document.documentElement.classList.add(th);
  localStorage.setItem('intendia-theme', th);
}

export function SettingsPage() {
  const qc = useQueryClient();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const [adding, setAdding] = useState(false);
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('intendia-theme') as Theme) ?? 'system');
  const [lang, setLang] = useState<LangSetting>(langSetting);
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
      title: t('Renommer l’instance'), label: t('Nom affiché'), value: i.label, maxLength: 80,
      message: t('L’identifiant {id} ne change pas.', { id: i.id }), confirmLabel: t('Renommer'),
    });
    if (label && label.trim() && label.trim() !== i.label) rename.mutate({ id: i.id, label: label.trim() });
  };
  const declarative = instances.data?.declarative;

  const list = instances.data?.instances ?? [];
  const reports = compat.data?.reports ?? [];

  const BOX_HEAD = 'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3';
  return (
    <Narrow>
      <PageHeader title={t('Réglages')} subtitle={t('Instances reliées à Intendia, partage de fichiers et affichage')} />
      <div className="max-w-[960px] space-y-5 px-4 pb-14 md:px-8">
        <section className="card overflow-hidden" aria-labelledby="rg-i">
          <div className={BOX_HEAD}>
            <div className="min-w-0 flex-1">
              <h2 id="rg-i" className="text-[15px] font-semibold">{t('Instances')}</h2>
              <p className="mt-0.5 text-[13px] text-ink-faint">
                {declarative
                  ? <T k="Déclarées par {var} : modifiez la configuration du conteneur pour les changer." vars={{ var: <code className="font-mono text-xs">INTENDIA_INSTANCES</code> }} />
                  : t('Les instances Hermes que pilote Intendia. Retirer une instance ne modifie pas Hermes.')}
              </p>
            </div>
            {!declarative && !adding && (
              <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" strokeWidth={1.5} />{t('Ajouter une instance')}</Button>
            )}
          </div>
          {(remove.error || rename.error) && <div className="px-4 pb-3"><ErrorText error={remove.error ?? rename.error} /></div>}
          {list.map((i) => {
            const r = reports.find((x) => x.instanceId === i.id);
            const state = r ? worst(r.modules.map((m) => m.state)) : null;
            return (
              <div key={i.id} data-instance={i.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line/70 px-4 py-3">
                <Mark state={state} className="size-2" />
                <div className="min-w-0 flex-[1_1_260px]">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{i.label}</span>
                    <span className="font-mono text-xs text-ink-faint">{i.id}{r?.hermesVersion ? ` · Hermes ${r.hermesVersion}` : ''}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-ink-faint">{i.api}{i.dashboard ? ` · ${i.dashboard}` : ` · ${t('sans dashboard')}`}{i.files?.workspaceRoot ? ` · ${i.files.workspaceRoot}` : ''}</div>
                  {i.files && !i.files.workspaceRoot && (
                    <div className="mt-1 max-w-prose text-xs text-bad" data-files-reason="">{i.files.reason}</div>
                  )}
                </div>
                {!declarative && (
                  <div className="flex items-center gap-2">
                    <Button onClick={() => void askRename(i)} disabled={rename.isPending}>
                      <Pencil className="size-3.5" strokeWidth={1.5} />{t('Renommer')}
                    </Button>
                    <Button
                      variant="ghost" className="text-bad hover:text-bad"
                      onClick={async () => { if (await ask({ title: t('Retirer l’instance « {label} » d’Intendia ?', { label: i.label }), message: t('Hermes n’est pas modifié.'), confirmLabel: t('Retirer'), danger: true })) remove.mutate(i.id); }}
                    >
                      {t('Retirer')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {!declarative && adding && (
            <div className="border-t border-line/70 p-4">
              <InstanceForm onSaved={async () => { setAdding(false); await qc.invalidateQueries(); }} />
              <Button variant="ghost" className="mt-2" onClick={() => setAdding(false)}>{t('Annuler')}</Button>
            </div>
          )}
        </section>
        {list.length > 0 && (
          <section className="card overflow-hidden" aria-labelledby="rg-s">
            <div className={BOX_HEAD}>
              <div className="min-w-0">
                <h2 id="rg-s" className="text-[15px] font-semibold">{t('Partage de fichiers')}</h2>
                <p className="mt-0.5 text-[13px] text-ink-faint"><T k="L’outil {tool} donne un lien privé vers chaque fichier livré, y compris depuis Telegram et les crons" vars={{ tool: <code className="font-mono text-xs">share_file</code> }} /></p>
              </div>
            </div>
            {list.map((i) => (
              <div key={i.id} className={cx('px-4 pb-4', list.length > 1 && 'border-t border-line/70 pt-4')}>
                <ShareFileTool instanceId={i.id} label={i.label} many={list.length > 1} />
              </div>
            ))}
          </section>
        )}
        <section className="card overflow-hidden" aria-labelledby="rg-t">
          <div className={BOX_HEAD}>
            <div className="min-w-0">
              <h2 id="rg-t" className="text-[15px] font-semibold">{t('Affichage')}</h2>
              <p className="mt-0.5 text-[13px] text-ink-faint">{t('Sur ce navigateur')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line/70 px-4 py-3" data-setting="theme">
            <span className="min-w-0 flex-1 text-sm font-medium">{t('Thème')}</span>
            <Chips
              label={t('Thème')} value={theme}
              items={[{ key: 'system', label: t('Système') }, { key: 'light', label: t('Clair') }, { key: 'dark', label: t('Sombre') }] as const}
              onChange={(th) => { setTheme(th); applyTheme(th); }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line/70 px-4 py-3" data-setting="language">
            <span className="min-w-0 flex-1 text-sm font-medium">{t('Langue')}</span>
            <Chips
              label={t('Langue')} value={lang}
              items={[{ key: 'auto', label: t('Automatique (navigateur)') }, { key: 'fr', label: 'Français' }, { key: 'en', label: 'English' }] as const}
              onChange={(l: LangSetting) => { setLang(l); setLangSetting(l); }}
            />
          </div>
        </section>
      </div>
    </Narrow>
  );
}
