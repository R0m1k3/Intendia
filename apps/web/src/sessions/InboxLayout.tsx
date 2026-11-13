import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { EMBEDDED } from '../chat/embed';
import { SplitView } from '../components/Panes';
import { useStoredFlag } from '../components/useStoredFlag';
import { openBeside, updateChat, useChat, withPanel } from '../chat/columns';
import { SessionsPane } from './SessionsPane';

interface Inbox {
  /** A session (page or column) has its files panel or a preview open: the list column steps aside while one has. */
  setPanelOpen: (id: string, open: boolean) => void;
  /** "Plein écran": the list column hidden by hand on session pages (kept in this browser). */
  full: boolean;
  setFull: (v: boolean) => void;
}

const InboxContext = createContext<Inbox>({ setPanelOpen: () => {}, full: false, setFull: () => {} });

export function useInbox(): Inbox {
  return useContext(InboxContext);
}

/**
 * The inbox (route without a path): the sessions column, then the home page or the open session. The column stays
 * mounted from one session to the next, so its search, filter, length and scroll are kept.
 */
export function InboxLayout() {
  const params = useParams({ strict: false }) as { sessionId?: string; slug?: string };
  const inSession = Boolean(params.sessionId);
  // an Intendia session = the Chat page (chat/ChatPage.tsx): the list stays beside it unless folded
  const inChat = inSession && Boolean(params.slug);
  const navigate = useNavigate();
  const onBeside = useCallback((slug: string, id: string) => {
    updateChat((c) => openBeside(c, { slug, id }));
    void navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: id } });
  }, [navigate]);
  const [panels, setPanels] = useState<ReadonlySet<string>>(() => new Set());
  const setPanelOpen = useCallback((id: string, open: boolean) => setPanels((p) => withPanel(p, id, open)), []);
  const panelOpen = panels.size > 0;
  const [folded, setFolded] = useStoredFlag('intendia-inbox-full');
  // several chats side by side need the width: the list folds by itself, and shows only when asked (its own flag)
  const chat = useChat(inChat);
  const multi = inChat && chat.layout !== 'one' && chat.open.length > 1;
  const [listInMulti, setListInMulti] = useStoredFlag('intendia-chat-list');
  const full = multi ? !listInMulti : folded;
  const setFull = useCallback((v: boolean) => (multi ? setListInMulti(!v) : setFolded(v)), [multi, setListInMulti, setFolded]);
  const value = useMemo(() => ({ setPanelOpen, full, setFull }), [setPanelOpen, full, setFull]);
  // the side chat's iframe (?embed=1) shows the session alone
  if (EMBEDDED) return <InboxContext.Provider value={value}><Outlet /></InboxContext.Provider>;
  return (
    <InboxContext.Provider value={value}>
      <SplitView
        label="Sessions"
        selected={inSession}
        phoneBoth={!inSession}
        listHidden={inSession ? (full || panelOpen ? true : inChat ? false : 'narrow') : false}
        list={<SessionsPane openId={params.sessionId ?? null} onBeside={inChat ? onBeside : undefined} />}
      >
        <Outlet />
      </SplitView>
    </InboxContext.Provider>
  );
}
