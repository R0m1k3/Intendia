// Header of the session page: title and subtitle (instance, folder, agent, model, date), link, agent's card and
// files buttons, plan of the questions, the session's menu and, in a column, its close button.
import { Link } from '@tanstack/react-router';
import { Archive, ArchiveRestore, ArrowLeft, Check, Clock, Copy, Download, Ellipsis, Eraser, Link2, Maximize2, Minimize2, Pencil, PanelRight, Pin, PinOff, ShieldCheck, ShieldOff, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { RefObject } from 'react';
import { AgentAvatar, type useAgentLooks } from '../../agents/look';
import { api } from '../../api';
import type { Column } from '../../chat/column-context';
import { EMBEDDED } from '../../chat/embed';
import { shortModel } from '../../chat/format';
import { OUTLINE_MIN, TurnPlan } from '../../chat/TurnNav';
import type { outline } from '../../chat/turns';
import { confirmClose } from '../../components/dirty';
import { Menu } from '../../components/Menu';
import { cx } from '../../components/ui';
import { locale, t } from '../../i18n';
import { download, newKey } from '../copies';
import { useInbox } from '../InboxLayout';
import type { useHistoryActions } from './useHistoryActions';
import type { SessionActions } from './useSessionActions';
import type { SidePanel } from './useSidePanel';

/** Bordered 34 px icon button of the session header (the mockup's `.btn.ib`). */
export const ICON_BTN = 'grid size-[34px] shrink-0 place-items-center rounded-lg border border-line bg-sheet text-ink transition-colors hover:bg-paper';

/** Session date in the header: "16:21" today, else "2 nov. 16:21" (ms). */
export function when(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} ${time}`;
}

/** "Plein écran": hides the inbox column (kept in this browser); only from 1280 px, where the column shows. */
export function FullScreen() {
  const { full, setFull } = useInbox();
  return (
    <button
      type="button" onClick={() => setFull(!full)} aria-pressed={full}
      className={cx(
        'hidden h-[34px] items-center gap-2 rounded-lg border px-3.5 text-[13.5px] font-medium transition-colors xl:inline-flex',
        full ? 'border-line bg-sheet text-ink hover:bg-paper' : 'border-accent-strong bg-accent text-on-accent hover:bg-accent-strong',
      )}
    >
      {full ? <Minimize2 className="size-4" strokeWidth={1.5} /> : <Maximize2 className="size-4" strokeWidth={1.5} />}
      {full ? t('Afficher la liste') : t('Plein écran')}
    </button>
  );
}

export function SessionHeader({
  headerRef, title, slug, inst, sessionId, sess, instanceLabel, workspaceName, looks, side, items, onJump, running, sentOnce,
  times, setTimes, actions, history, col,
}: {
  headerRef: RefObject<HTMLElement | null>;
  title: string;
  slug: string;
  inst: string | undefined;
  sessionId: string;
  /** the session as read (`sess.data` of the page) */
  sess: Awaited<ReturnType<typeof api.session>> | undefined;
  instanceLabel: string | undefined;
  workspaceName: string | undefined;
  looks: ReturnType<typeof useAgentLooks>;
  side: SidePanel;
  items: ReturnType<typeof outline>;
  onJump: (key: string) => void;
  running: boolean;
  sentOnce: boolean;
  times: boolean;
  setTimes: (v: boolean) => void;
  actions: SessionActions;
  history: Pick<ReturnType<typeof useHistoryActions>, 'canRewrite' | 'last' | 'runRewrite'>;
  col: Column | null;
}) {
  const { panel, setPanel, panelTab, setPanelTab, previewPath, setPreviewPath, sideOpen } = side;
  const { renameSession, copyLink, linkCopied, pin, archive, duplicate, titleAi, remove, setAutoApprove, canCopy, canExportJson, canTitleAi } = actions;
  const { canRewrite, last, runRewrite } = history;
  return (
      <header ref={headerRef} className="sticky top-0 z-10 border-b border-line/70 bg-sheet/95 backdrop-blur-sm">
        <div className="flex min-h-16 items-center gap-2 px-4 py-3 md:px-6">
          {!EMBEDDED && (
            <Link to="/" aria-label={t('Revenir à la liste')} className={cx(ICON_BTN, 'border-transparent md:hidden')}>
              <ArrowLeft className="size-4" strokeWidth={1.5} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h2 data-session-title className="truncate text-lg font-semibold leading-snug">{title}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">
              {[instanceLabel, null, sess?.profile ?? 'default', sess?.session.model ? shortModel(sess.session.model) : null, sess ? when(sess.session.createdAt) : null]
                .map((part, i) => (i === 1
                  ? <span key="ws">{i > 0 && instanceLabel ? ' · ' : ''}<Link to="/w/$slug" params={{ slug }} className="transition-colors hover:text-ink">{workspaceName ?? slug}</Link></span>
                  : part ? <span key={i}>{i > 0 ? ' · ' : ''}{part}</span> : null))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={ICON_BTN} aria-label={t('Copier le lien de la session')} title={t('Copier le lien de la session')}
              onClick={copyLink}>
              {linkCopied ? <Check className="size-4" strokeWidth={2} /> : <Link2 className="size-4" strokeWidth={1.5} />}
            </button>
            {inst && (
              <button type="button" className={cx('flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-line bg-sheet px-1.5 text-ink transition-colors hover:bg-paper lg:pr-2.5', panel && panelTab === 'agent' && !previewPath && 'bg-raised')} data-agent-button=""
                aria-label={t('Fiche de l’agent {name}', { name: sess?.profile ?? 'default' })} title={t('Fiche de l’agent {name}', { name: sess?.profile ?? 'default' })}
                onClick={() => void confirmClose(() => { const open = panel && panelTab === 'agent' && !previewPath; setPanel(!open); setPanelTab('agent'); setPreviewPath(null); })}>
                <AgentAvatar name={sess?.profile ?? 'default'} color={looks.color(sess?.profile ?? 'default')} size={22} />
                <span className="hidden max-w-[9rem] truncate text-[13px] font-medium lg:inline">{sess?.profile ?? 'default'}</span>
              </button>
            )}
            <button type="button" className={cx(ICON_BTN, panel && panelTab === 'files' && 'bg-raised')} aria-label={t('Fichiers de la session')} title={t('Fichiers de la session')}
              aria-expanded={panel && panelTab === 'files'} onClick={() => void confirmClose(() => { const open = panel && panelTab === 'files'; setPanel(!open); setPanelTab('files'); setPreviewPath(null); })}>
              <PanelRight className="size-4" strokeWidth={1.5} />
            </button>
            {items.length >= OUTLINE_MIN && <TurnPlan items={items} onJump={onJump} triggerClass={ICON_BTN} />}
            <Menu
              title={t('Actions de la session')}
              trigger={<Ellipsis className="size-4" strokeWidth={1.5} />}
              triggerClass={cx(ICON_BTN, 'aria-expanded:bg-raised')}
              items={[
                { label: t('Renommer'), icon: <Pencil className="size-4" strokeWidth={1.5} />,
                  onSelect: () => void renameSession() },
                sess?.session.pinned
                  ? { label: t('Désépingler'), icon: <PinOff className="size-4" strokeWidth={1.5} />, onSelect: () => pin.mutate(false) }
                  : { label: t('Épingler'), icon: <Pin className="size-4" strokeWidth={1.5} />, onSelect: () => pin.mutate(true) },
                sess?.session.archived
                  ? { label: t('Désarchiver'), icon: <ArchiveRestore className="size-4" strokeWidth={1.5} />, onSelect: () => archive.mutate(false) }
                  : { label: t('Archiver'), icon: <Archive className="size-4" strokeWidth={1.5} />, disabled: running, onSelect: () => archive.mutate(true) },
                ...(sentOnce && !canCopy ? [] : [{ label: t('Dupliquer'), icon: <Copy className="size-4" strokeWidth={1.5} />, disabled: running || duplicate.isPending, onSelect: () => duplicate.mutate(newKey()) }]),
                times
                  ? { label: t('Masquer les heures'), icon: <Clock className="size-4" strokeWidth={1.5} />, onSelect: () => setTimes(false) }
                  : { label: t('Afficher les heures'), icon: <Clock className="size-4" strokeWidth={1.5} />, onSelect: () => setTimes(true) },
                ...(sentOnce ? [
                  { label: t('Exporter en Markdown'), icon: <Download className="size-4" strokeWidth={1.5} />, onSelect: () => download(api.exportUrl(inst!, sessionId, 'md')) },
                  { label: t('Exporter en HTML'), icon: <Download className="size-4" strokeWidth={1.5} />, onSelect: () => download(api.exportUrl(inst!, sessionId, 'html')) },
                  ...(canExportJson ? [{ label: t('Exporter en JSON'), icon: <Download className="size-4" strokeWidth={1.5} />, onSelect: () => download(api.exportUrl(inst!, sessionId, 'json')) }] : []),
                ] : []),
                ...(sentOnce && canCopy ? [{ label: t('Annuler le dernier échange'), icon: <Undo2 className="size-4" strokeWidth={1.5} />, disabled: !canRewrite || !last, onSelect: () => runRewrite('undo', undefined, last?.text) }] : []),
                ...(sentOnce && canCopy ? [{ label: t('Vider la conversation'), icon: <Eraser className="size-4" strokeWidth={1.5} />, disabled: !canRewrite, onSelect: () => runRewrite('clear') }] : []),
                ...(sentOnce && canTitleAi ? [{ label: t('Titre par l’IA'), icon: <Sparkles className="size-4" strokeWidth={1.5} />, disabled: titleAi.isPending, onSelect: () => titleAi.mutate() }] : []),
                sess?.session.autoApprove
                  ? { label: t('Redemander les accords'), icon: <ShieldCheck className="size-4" strokeWidth={1.5} />, onSelect: () => void setAutoApprove(false) }
                  : { label: t('Sans confirmation…'), icon: <ShieldOff className="size-4" strokeWidth={1.5} />, onSelect: () => void setAutoApprove(true) },
                { label: t('Supprimer'), icon: <Trash2 className="size-4" strokeWidth={1.5} />, disabled: running, danger: true, onSelect: () => remove.mutate() },
              ]}
            />
            {col && (
              <button type="button" className={ICON_BTN} aria-label={t('Fermer ce chat')} title={t('Fermer ce chat (le travail continue)')} onClick={col.hide}>
                <X className="size-4" strokeWidth={1.5} />
              </button>
            )}
            {!sideOpen && !EMBEDDED && !col && <FullScreen />}
          </div>
        </div>
      </header>
  );
}
