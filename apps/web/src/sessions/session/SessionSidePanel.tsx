// The session's side panel (beside the thread, or over it in a narrow column): tabs for the files (or a file's
// preview), the sub-agents, a side question and the agent's card; its left edge resizes it.
import { X } from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { AgentPanel } from '../../agents/AgentPanel';
import { AsideQuestion } from '../../chat/AsideQuestion';
import type { Column } from '../../chat/column-context';
import { EMBEDDED } from '../../chat/embed';
import type { Entry } from '../../chat/events';
import { Subagents } from '../../chat/Subagents';
import { confirmClose } from '../../components/dirty';
import { SessionFiles } from '../../components/SessionFiles';
import { cx } from '../../components/ui';
import { Preview } from '../../files/Preview';
import { workspaceScope } from '../../files/scope';
import { t } from '../../i18n';
import { clampWidth, savePanel, type PanelTab } from '../panelPrefs';
import type { SessionFilesState } from './useSessionFiles';
import type { SidePanel } from './useSidePanel';

export function SessionSidePanel({ inst, slug, sessionId, profile, autoApprove, onAutoApprove, entries, runCount, files: f, side, col }: {
  inst: string | undefined;
  slug: string;
  sessionId: string;
  /** the session's agent */
  profile: string;
  autoApprove: boolean;
  onAutoApprove: (on: boolean) => void;
  entries: Entry[];
  runCount: number;
  files: Pick<SessionFilesState, 'addFiles' | 'cited' | 'agentRoot' | 'insert' | 'modified'>;
  side: SidePanel;
  col: Column | null;
}) {
  const { setPanel, panelPrefs, setPanelPrefs, panelTab, setPanelTab, previewPath, setPreviewPath } = side;
  const { addFiles, cited, agentRoot, insert, modified } = f;
  const files = previewPath ? (
    <Preview scope={workspaceScope(slug)} path={previewPath} onClose={() => setPreviewPath(null)} onInsert={insert} />
  ) : (
    <SessionFiles inst={inst ?? ''} slug={slug} sessionId={sessionId} onDrop={addFiles} cited={cited} runKey={runCount} onOpen={(p) => void confirmClose(() => setPreviewPath(p))} onClose={() => setPanel(false)}
      agentRoot={agentRoot} onInsert={insert} modified={modified} />
  );
  const subCards = entries.filter((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents');
  const tabs: [PanelTab, string][] = [['files', t('Fichiers')], ...(subCards.length ? [['subagents', t('Sous-agents')] as [PanelTab, string]] : []),
    // not inside a frame: no side question of a side question
    ...(EMBEDDED ? [] : [['aside', t('Question annexe')] as [PanelTab, string]]), ['agent', t('Agent')]];
  const sideTab: PanelTab = previewPath || (panelTab === 'subagents' && !subCards.length) || (panelTab === 'aside' && EMBEDDED) ? 'files' : panelTab;
  const content = (
    <div className="flex h-full flex-col">
      {!previewPath && (
        <div role="tablist" aria-label={t('Panneau latéral')} className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line/70 px-2.5 pt-2">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={sideTab === k} onClick={() => setPanelTab(k)}
              className={cx('-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 pb-2 pt-1 text-[13px] transition-colors', sideTab === k ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-faint hover:text-ink')}>
              {label}
              {k === 'subagents' && <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{subCards.reduce((n, c) => n + c.nodes.length, 0)}</span>}
            </button>
          ))}
          {/* the files and the agent's card have their own close button; these tabs get one here (the panel covers
              the page on small screens) */}
          {(sideTab === 'subagents' || sideTab === 'aside') && (
            <button type="button" onClick={() => setPanel(false)} aria-label={t('Fermer le panneau')}
              className="mb-1 ml-auto flex size-8 shrink-0 items-center justify-center self-center rounded-lg text-ink-faint hover:bg-raised hover:text-ink">
              <X className="size-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {sideTab === 'agent' && inst ? (
          <AgentPanel inst={inst} profile={profile} autoApprove={autoApprove}
            onAutoApprove={onAutoApprove} onClose={() => setPanel(false)} />
        ) : sideTab === 'aside' && inst ? (
          <AsideQuestion inst={inst} slug={slug} parentId={sessionId} profile={profile} />
        ) : sideTab === 'subagents' ? (
          <div data-subagents-panel className="flex h-full flex-col gap-3 overflow-y-auto p-3">
            {[...subCards].reverse().map((c) => <Subagents key={c.key} nodes={c.nodes} openSince={c.openSince} live />)}
          </div>
        ) : files}
      </div>
    </div>
  );

  return (
      <aside className={cx(
        // a column beside others is too narrow to share: the panel covers it (its close button stays in the panel)
        col && !col.wide
          ? 'absolute inset-y-0 right-0 z-20 w-full max-w-full border-l border-line/70 bg-sheet shadow-xl'
          : 'fixed inset-0 z-30 bg-sheet lg:z-auto lg:shrink-0 lg:border-l lg:border-line/70',
        col ? (col.wide && 'lg:static lg:h-full') : 'lg:sticky lg:top-0 lg:h-[var(--content-h)]',
        !(col && !col.wide) && (previewPath ? 'lg:w-[min(46vw,640px)]' : 'lg:w-[var(--panel-w)]'),
      )} style={{ '--panel-w': `${panelPrefs.width}px` } as CSSProperties}>
        {!previewPath && !(col && !col.wide) && <PanelResizer width={panelPrefs.width} onResize={(w, keep) => setPanelPrefs((p) => {
          const next = { ...p, width: clampWidth(w) };
          if (keep) savePanel(sessionId, next);
          return next;
        })} />}
        {content}
      </aside>
  );
}

/** Left edge of the side panel (wide screens): drag to resize it, arrows by 20 px; the width is kept on release. */
function PanelResizer({ width, onResize }: { width: number; onResize: (width: number, keep: boolean) => void }) {
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => onResize(width + (x0 - ev.clientX), false);
    const up = (ev: PointerEvent) => {
      onResize(width + (x0 - ev.clientX), true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={t('Largeur du panneau')} aria-valuenow={width} tabIndex={0} data-panel-resizer
      onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onResize(width + 20, true); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onResize(width - 20, true); }
      }}
      className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize transition-colors hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none lg:block" />
  );
}
