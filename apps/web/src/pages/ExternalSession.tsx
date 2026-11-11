import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, MessageSquarePlus } from 'lucide-react';
import { askChoice } from '../components/Dialog';
import { Button } from '../components/ui';
import { newKey, useCopyOps } from '../sessions/copies';
import { SESSION_LIST_KEYS } from '../sessions/UndoBar';
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
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canCopy } = useCopyOps(inst);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  /** Hermes refuses messages to a session born elsewhere: a copy in a workspace of the same agent continues it. */
  const carryOn = useMutation({
    mutationFn: async () => {
      const options = (workspaces.data?.workspaces ?? [])
        .filter((w) => w.instanceId === inst && (w.profile ?? 'default') === profile)
        .map((w) => ({ value: w.slug, label: w.name }));
      if (!options.length) throw new Error(`Créez d’abord un workspace pour l’agent ${agent}`);
      const slug = await askChoice({
        title: 'Continuer dans Intendia', label: 'Copier la conversation dans le workspace', options, confirmLabel: 'Continuer',
        message: 'Une copie est créée ; la session d’origine ne change pas.',
      });
      if (!slug) return null;
      const { session } = await api.continueExternal(inst, sessionId, profile, slug, newKey());
      return { slug, id: session.id };
    },
    onSuccess: async (res) => {
      if (!res) return;
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug: res.slug, sessionId: res.id } });
    },
  });
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
          {canCopy && (
            <Button variant="primary" className="ml-auto shrink-0" onClick={() => carryOn.mutate()} disabled={carryOn.isPending || !messages.isSuccess}>
              <MessageSquarePlus className="size-4" strokeWidth={1.5} />Continuer dans Intendia
            </Button>
          )}
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8">
        <p className="mb-6 text-xs text-ink-faint">Lecture seule : cette session vient de Telegram, du CLI, d’un cron ou du kanban</p>
        <ErrorText error={messages.error} />
        <ErrorText error={carryOn.error} />
        {messages.isSuccess && entries.length === 0 && <p className="text-sm text-ink-soft">Aucun message</p>}
        <Thread entries={entries} agent={agent} />
      </div>
    </div>
  );
}
