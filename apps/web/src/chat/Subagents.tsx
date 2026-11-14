import { ChevronRight, GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ModuleState } from '../api';
import { cx, Mark } from '../components/ui';
import { locale, plural, t } from '../i18n';
import { STALE_AFTER_S } from './deliveries';
import { subagentTree, type SubagentNode } from './events';
import { formatDuration } from './format';

const FAILED = ['failed', 'error', 'interrupted', 'cancelled', 'timeout', 'stalled', 'unknown', 'lost'];

/** completed → full box, running / background / incomplete → half, failed / stopped → empty. */
export function markOf(status: string): ModuleState {
  if (status === 'running' || status === 'background' || status === 'truncated') return 'readonly';
  return FAILED.includes(status) ? 'unavailable' : 'full';
}

export const STATUS_TEXT: Record<string, string> = {
  running: t('en cours'), completed: t('terminé'), failed: t('échec'), error: t('erreur'), interrupted: t('interrompu'), cancelled: t('annulé'), timeout: t('délai dépassé'),
  background: t('en fond'), truncated: t('incomplet'), stalled: t('bloqué'), unknown: t('inconnu'), lost: t('non livré'),
};

/** Seconds now, re-read every 30 s while `on` (« En fond depuis », activity of a child). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now() / 1000);
    const timer = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** « actif il y a 20 s · 7 outils », or « fini · résultat en route » (live tracking of a background node). */
export function activityText(a: NonNullable<SubagentNode['activity']>, nowSec: number): string {
  if (a.ended) return t('fini · résultat en route');
  const age = a.lastActive === null ? null : Math.max(0, nowSec - a.lastActive);
  const when = age === null ? t('actif') : age < 10 ? t('actif à l’instant') : t('actif il y a {time}', { time: formatDuration(age * 1000) });
  return a.toolCalls ? `${when} · ${plural(a.toolCalls, '{n} outil', '{n} outils')}` : when;
}

export function duration(s: number): string {
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/** Seconds since `startedAt` (event time, seconds), ticking every second while `on`. */
function useElapsed(startedAt: number | null, on: boolean): number | null {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return startedAt === null ? null : Math.max(0, now - startedAt);
}

function NodeRow({ node, level, now }: { node: SubagentNode; level: number; now: number }) {
  const [open, setOpen] = useState(false);
  const running = node.status === 'running';
  const elapsed = useElapsed(node.startedAt, running);
  const time = node.duration ?? (running ? elapsed : null);
  const tokens = node.inputTokens !== null || node.outputTokens !== null ? (node.inputTokens ?? 0) + (node.outputTokens ?? 0) : null;
  const details = [
    node.model,
    node.toolCount !== null ? plural(node.toolCount, '{n} outil', '{n} outils') : null,
    tokens !== null ? t('{n} jetons', { n: tokens.toLocaleString(locale()) }) : null,
  ].filter(Boolean).join(' · ');
  const canOpen = Boolean(node.summary || details);
  return (
    <li style={{ paddingLeft: `${level * 20}px` }}>
      <button type="button" disabled={!canOpen} onClick={() => setOpen((o) => !o)} aria-expanded={canOpen ? open : undefined}
        className={cx('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left font-mono text-[12px]', canOpen && 'hover:bg-raised')}>
        <ChevronRight className={cx('size-3.5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90', !canOpen && 'invisible')} strokeWidth={1.5} />
        <Mark state={markOf(node.status)} className={running ? 'animate-pulse' : undefined} />
        <span className="min-w-0 flex-1 truncate text-ink-soft" title={node.goal}>{node.goal || t('Sous-agent')}</span>
        <span className={cx('shrink-0', FAILED.includes(node.status) ? 'text-bad' : 'text-ink-faint')}>{STATUS_TEXT[node.status] ?? node.status}</span>
        {time !== null && <span className="w-16 shrink-0 whitespace-nowrap text-right text-ink-faint">{duration(time)}</span>}
        {node.cost !== null && <span className="w-16 shrink-0 whitespace-nowrap text-right text-ink-faint">{t('{n} $', { n: node.cost.toFixed(node.cost < 0.01 ? 4 : 2) })}</span>}
      </button>
      {node.status === 'background' && node.activity && (
        <p className="ml-[46px] pb-0.5 font-mono text-[11.5px] text-ink-faint" data-activity>{activityText(node.activity, now)}</p>
      )}
      {open && (
        <div className="mb-1 ml-[46px] space-y-1 text-[12px]">
          {details && <p className="font-mono text-ink-faint">{details}</p>}
          {node.summary && <p className="whitespace-pre-wrap text-ink-soft">{node.summary}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Sub-agents delegated during a run, as a tree indented by parent. `openSince` (seconds): some still work in the
 * background after the run; `live`: this page re-reads the session, so the result will show up by itself.
 */
export function Subagents({ nodes, openSince, live = false }: { nodes: SubagentNode[]; openSince?: number; live?: boolean }) {
  const rows = subagentTree(nodes);
  const running = nodes.filter((n) => n.status === 'running').length;
  const background = nodes.filter((n) => n.status === 'background').length;
  const now = useNow(background > 0);
  const age = openSince === undefined ? null : Math.max(0, now - openSince);
  return (
    <div className="card px-2 py-2">
      <p className="flex items-center gap-2 px-1.5 pb-1 text-xs text-ink-faint">
        <GitBranch className="size-3.5" strokeWidth={1.5} />
        {[plural(nodes.length, '{n} sous-agent', '{n} sous-agents'), running ? t('{n} en cours', { n: running }) : null, background ? t('{n} en fond', { n: background }) : null].filter(Boolean).join(', ')}
      </p>
      <ul aria-label={t('Sous-agents')}>
        {rows.map(({ node, level }) => <NodeRow key={node.id} node={node} level={level} now={now} />)}
      </ul>
      {age !== null && (
        <p className="px-1.5 pt-1 text-xs text-ink-faint" data-background-since>
          {age > STALE_AFTER_S ? t('Sans nouvelles depuis plus de 24 h')
            : live ? t('En fond depuis {time} · le résultat arrivera ici', { time: formatDuration(age * 1000) })
              : t('En fond depuis {time} · rouvrez la session plus tard', { time: formatDuration(age * 1000) })}
        </p>
      )}
    </div>
  );
}
