import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api';
import { historyEntries } from '../chat/events';
import { agentName } from '../chat/format';
import { Thread } from '../chat/Thread';
import { ErrorText } from '../components/ui';

export function ExternalSessionPage() {
  const { inst, profile, sessionId } = useParams({ strict: false }) as { inst: string; profile: string; sessionId: string };
  const messages = useQuery({ queryKey: ['external', inst, profile, sessionId], queryFn: () => api.externalMessages(inst, sessionId, profile) });
  const entries = historyEntries(messages.data?.messages ?? []);
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const agent = agentName(profile, instances.data?.instances.find((i) => i.id === inst)?.label);
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-sheet/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 md:px-8">
          <Link to="/w" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink" aria-label="Retour">
            <ArrowLeft className="size-4" strokeWidth={1.5} />
          </Link>
          <div className="min-w-0">
            <h1 className="text-[15px] font-medium">Session externe</h1>
            <p className="truncate font-mono text-[11px] text-ink-faint">{sessionId} · {profile}</p>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8">
        <p className="mb-6 text-xs text-ink-faint">Lecture seule : cette session vient de Telegram, du CLI ou d’un cron</p>
        <ErrorText error={messages.error} />
        {messages.isSuccess && entries.length === 0 && <p className="text-sm text-ink-soft">Aucun message</p>}
        <Thread entries={entries} agent={agent} />
      </div>
    </div>
  );
}
