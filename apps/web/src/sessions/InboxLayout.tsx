import { Outlet, useParams } from '@tanstack/react-router';
import { createContext, useContext, useMemo, useState } from 'react';
import { EMBEDDED } from '../chat/embed';
import { SplitView } from '../components/Panes';
import { useStoredFlag } from '../components/useStoredFlag';
import { SessionsPane } from './SessionsPane';

interface Inbox {
  /** The session page has its files panel or a preview open: the list column steps aside. */
  setPanelOpen: (open: boolean) => void;
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
  const params = useParams({ strict: false }) as { sessionId?: string };
  const inSession = Boolean(params.sessionId);
  const [panelOpen, setPanelOpen] = useState(false);
  const [full, setFull] = useStoredFlag('intendia-inbox-full');
  const value = useMemo(() => ({ setPanelOpen, full, setFull }), [full, setFull]);
  // the side chat's iframe (?embed=1) shows the session alone
  if (EMBEDDED) return <InboxContext.Provider value={value}><Outlet /></InboxContext.Provider>;
  return (
    <InboxContext.Provider value={value}>
      <SplitView
        label="Sessions"
        selected={inSession}
        phoneBoth={!inSession}
        listHidden={inSession ? (full || panelOpen ? true : 'narrow') : false}
        list={<SessionsPane openId={params.sessionId ?? null} />}
      >
        <Outlet />
      </SplitView>
    </InboxContext.Provider>
  );
}
