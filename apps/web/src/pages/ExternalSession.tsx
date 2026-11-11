import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { api, type RecentSession } from '../api';
import { historyEntries } from '../chat/events';
import { agentName } from '../chat/format';
import { Thread } from '../chat/Thread';
import { cx, ErrorText } from '../components/ui';
import { sourceLabel } from '../home/labels';
import { FullScreen, ICON_BTN, when } from './Session';

/** A Hermes session not started by Intendia (Telegram, CLI, cron, API): read only, in the inbox. */
export function ExternalSessionPage() {
  const { inst, profile, sessionId } = useParams({ strict: false }) as { inst: string; profile: string; sessionId: string };
  const messages = useQuery({ queryKey: ['external', inst, profile, sessionId], queryFn: () => api.externalMessages(inst, sessionId, profile) });
  const entries = historyEntries(messages.data?.messages ?? []);
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const label = instances.data?.instances.find((i) => i.id === inst)?.label;
  const agent = agentName(profile, label);
  // title, source and date as the inbox column read them (no extra request)
  // (same key as the column's default view: shared; another filter there costs one more read)
  const recent = useQuery({ queryKey: ['sessions-list', inst, 'all', 50], queryFn: () => api.recentSessions(inst, 50, 'all'), refetchOnWindowFocus: false });
  const qc = useQueryClient();
  const known = [...(recent.data?.sessions ?? []), ...qc.getQueriesData<{ sessions: RecentSession[] }>({ queryKey: ['sessions-list'] }).flatMap(([, d]) => d?.sessions ?? [])]
    .find((s) => s.id === sessionId && s.instanceId === inst);
  const meta = [label, known ? sourceLabel(known.source) : null, profile, known?.at ? when(known.at) : sessionId].filter(Boolean).join(' · ');
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line/70 bg-sheet/95 backdrop-blur-sm">
        <div className="flex min-h-16 items-center gap-2 px-4 py-3 md:px-6">
          <Link to="/" aria-label="Revenir à la liste" className={cx(ICON_BTN, 'border-transparent md:hidden')}>
            <ArrowLeft className="size-4" strokeWidth={1.5} />
          </Link>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-snug">{known?.title ?? 'Session externe'}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">{meta}</p>
          </div>
          <FullScreen />
        </div>
      </header>
      <div className="mx-auto w-full max-w-[748px] px-4 py-7 md:px-6">
        <p className="mb-7 rounded-lg bg-paper px-3.5 py-2.5 text-[13px] text-ink-soft">Lecture seule : cette session vient de Telegram, du CLI, de l’API ou d’un cron</p>
        <ErrorText error={messages.error} />
        {messages.isSuccess && entries.length === 0 && <p className="text-sm text-ink-faint">Aucun message</p>}
        <Thread entries={entries} agent={agent} />
      </div>
    </div>
  );
}
