// State of the session's side panel: open or closed, its tab and width (kept per session), the file previewed in
// it, and the inbox layout told when it takes the room.
import { useCallback, useEffect, useState } from 'react';
import { confirmClose } from '../../components/dirty';
import { useInbox } from '../InboxLayout';
import { readPanel, savePanel, type PanelPrefs, type PanelTab } from '../panelPrefs';

export type SidePanel = ReturnType<typeof useSidePanel>;

export function useSidePanel(sessionId: string) {
  // closed at first: the inbox column takes the room; opening it (or a preview) moves the column aside
  const [panel, setPanel] = useState(false);
  /** the side panel's tab (files, sub-agents, the agent's card: OpenBot-like) and width, kept per session */
  const [panelPrefs, setPanelPrefs] = useState<PanelPrefs>(() => readPanel(sessionId));
  const panelTab = panelPrefs.tab;
  const setPanelTab = useCallback((tab: PanelTab) => setPanelPrefs((p) => {
    const next = { ...p, tab };
    savePanel(sessionId, next);
    return next;
  }), [sessionId]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const inbox = useInbox();
  const sideOpen = panel || previewPath !== null;
  const { setPanelOpen } = inbox;
  useEffect(() => { setPanelOpen(sessionId, sideOpen); }, [sessionId, sideOpen, setPanelOpen]);
  useEffect(() => () => setPanelOpen(sessionId, false), [sessionId, setPanelOpen]);
  const openFiles = () => void confirmClose(() => { setPanel(true); setPanelTab('files'); setPreviewPath(null); });
  const openSubagents = () => void confirmClose(() => { setPanel(true); setPanelTab('subagents'); setPreviewPath(null); });
  return { panel, setPanel, panelPrefs, setPanelPrefs, panelTab, setPanelTab, previewPath, setPreviewPath, sideOpen, openFiles, openSubagents };
}
