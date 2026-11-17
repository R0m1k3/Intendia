// One status pill at the top of the page (portal, above sheets z-55, under dialogs z-70): offline, Intendia server
// unreachable, then the current instance's Hermes outage (lot B's `report.outage`). One case at a time.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ServerOff, Unplug, WifiOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import { api, type CompatReport } from '../api';
import { useConnection } from '../connection/connection';
import { useCurrentInstance } from '../instance/current';
import { locale, t } from '../i18n';
import { cx } from './ui';

export type StatusBar = 'offline' | 'server' | 'hermes' | 'dashboard';

/** The bar to show, by priority; Hermes is never shown while Intendia itself is out of reach (stale report). */
export function pickStatusBar(s: { offline: boolean; serverDown: boolean; outage: CompatReport['outage'] | undefined }): StatusBar | null {
  if (s.offline) return 'offline';
  if (s.serverDown) return 'server';
  if (s.outage?.api) return 'hermes';
  if (s.outage?.dash) return 'dashboard';
  return null;
}

/** "14:05", or "3 nov. 14:05" when not today. */
export function sinceLabel(since: number, now = new Date()): string {
  const d = new Date(since);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${time}`;
}

export function StatusBars() {
  const { offline, serverDown } = useConnection();
  const { id, instance } = useCurrentInstance();
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 30_000 });
  const report = id ? compat.data?.reports.find((r) => r.instanceId === id) : undefined;
  const bar = pickStatusBar({ offline, serverDown, outage: report?.outage });
  if (!bar) return null;
  const label = instance?.label ?? id ?? '';
  const time = report?.outage ? sinceLabel(report.outage.since) : '';
  const Icon = bar === 'offline' ? WifiOff : bar === 'server' ? ServerOff : Unplug;
  const text = bar === 'offline'
    ? t('Hors ligne : les changements partiront au retour de la connexion')
    : bar === 'server'
      ? t('Serveur Intendia injoignable, nouvel essai toutes les 5 s')
      : bar === 'hermes'
        ? t('Hermes ({instance}) injoignable depuis {time}', { instance: label, time })
        : t("Dashboard d'Hermes ({instance}) injoignable depuis {time} : fichiers, crons, skills et configuration en pause", { instance: label, time });
  const hard = bar === 'offline' || bar === 'server';
  return createPortal(
    <div
      role="status" data-status-bar={bar}
      className={cx(
        'fixed inset-x-0 top-2 z-[65] mx-auto flex w-fit max-w-[calc(100%-6rem)] items-center gap-2 rounded-2xl px-4 py-1.5 text-[13px] shadow md:rounded-full',
        hard ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn',
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0">{text}</span>
      {!hard && <Link to="/etat" hash={id ?? undefined} className="shrink-0 font-medium underline-offset-2 hover:underline">{t('Page État')}</Link>}
    </div>,
    document.body,
  );
}
