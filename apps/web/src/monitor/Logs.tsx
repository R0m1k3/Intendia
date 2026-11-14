import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type LogQuery } from '../api';
import { Button, cx, ErrorText } from '../components/ui';
import { t } from '../i18n';

export const LOG_FILES = ['agent', 'errors', 'gateway', 'gui', 'desktop', 'update', 'handoff', 'mcp'] as const;
const FILE_LABEL: Record<string, string> = {
  agent: t('Agent'), errors: t('Erreurs'), gateway: t('Passerelle'), gui: t('Interface'), desktop: t('Appli de bureau'), update: t('Mises à jour'),
  handoff: t('Passage de mise à jour'), mcp: t('Serveurs MCP'),
};
const LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR'] as const;
const LEVEL_LABEL: Record<string, string> = { ALL: t('Tous les niveaux'), DEBUG: t('Débogage et plus'), INFO: t('Info et plus'), WARNING: t('Avertissements et plus'), ERROR: t('Erreurs seulement') };
const COMPONENTS = ['', 'gateway', 'agent', 'tools', 'cli', 'cron', 'gui'] as const;
const LINES = [100, 200, 500] as const;
const FOLLOW_MS = 5000;
const SELECT = 'h-[34px] rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';

/** Page visibility, to stop following while the tab is hidden. */
function useVisible(): boolean {
  const [v, setV] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setV(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

export function Logs({ inst, profile, file, onFile }: { inst: string; profile: string; file: string; onFile: (f: string) => void }) {
  const [level, setLevel] = useState<string>('ALL');
  const [component, setComponent] = useState('');
  const [lines, setLines] = useState<number>(200);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(false);
  const visible = useVisible();
  const query: LogQuery = { file, lines, level: level === 'ALL' ? undefined : level, component: component || undefined, search: search || undefined };
  const q = useQuery({
    queryKey: ['monitor', inst, profile, 'logs', query],
    queryFn: () => api.monitorLogs(inst, profile, query),
    refetchInterval: follow && visible ? FOLLOW_MS : false,
  });
  const box = useRef<HTMLPreElement>(null);
  const atBottom = useRef(true);
  // keep the reader at the bottom when they were there (new lines), else leave the scroll alone
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [q.data]);
  const data = q.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={SELECT} aria-label={t('Journal')} value={file} onChange={(e) => onFile(e.target.value)}>
          {LOG_FILES.map((f) => <option key={f} value={f}>{FILE_LABEL[f]}</option>)}
        </select>
        <select className={SELECT} aria-label={t('Niveau')} value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
        </select>
        <select className={SELECT} aria-label={t('Composant')} value={component} onChange={(e) => setComponent(e.target.value)}>
          {COMPONENTS.map((c) => <option key={c} value={c}>{c || t('Tous les composants')}</option>)}
        </select>
        <select className={SELECT} aria-label={t('Lignes')} value={lines} onChange={(e) => setLines(Number(e.target.value))}>
          {LINES.map((n) => <option key={n} value={n}>{t('{n} lignes', { n })}</option>)}
        </select>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(draft.trim()); }}>
          <input className={cx(SELECT, 'w-48')} placeholder={t('Rechercher')} aria-label={t('Rechercher dans le journal')} maxLength={200}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />{t('Suivre')}
        </label>
        <Button onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cx('size-4', q.isFetching && 'animate-spin')} strokeWidth={1.5} />{t('Actualiser')}
        </Button>
      </div>
      {data?.unredacted && (
        <p className="text-xs text-ink-faint">{t('Journal non filtré par Hermes : Intendia masque ce qui ressemble à un secret, sans garantie pour un secret de forme inconnue.')}</p>
      )}
      <ErrorText error={q.error} />
      <pre ref={box} data-log-lines
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        className="max-h-[calc(var(--content-h)-14rem)] min-h-48 overflow-auto rounded-xl border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink-soft">
        {data ? (data.lines.length ? data.lines.join('\n') : t('Journal vide')) : q.isPending ? t('Chargement…') : ''}
      </pre>
    </div>
  );
}
