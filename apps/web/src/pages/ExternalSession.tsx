import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, MessageSquarePlus, Trash2 } from 'lucide-react';
import { askChoice } from '../components/Dialog';
import { newKey, useCopyOps } from '../sessions/copies';
import { SESSION_LIST_KEYS } from '../sessions/UndoBar';
import { useRemoveSession } from '../sessions/remove';
import { api, type RecentSession } from '../api';
import { applyDeliveries, delegationState } from '../chat/deliveries';
import { historyEntries } from '../chat/events';
import { agentName } from '../chat/format';
import { Thread } from '../chat/Thread';
import { Button, cx, ErrorText } from '../components/ui';
import { sourceLabel } from '../home/labels';
import { FullScreen, ICON_BTN, when } from './Session';
import { t } from '../i18n';

/** A Hermes session not started by Intendia (Telegram, CLI, cron, API): read only, in the inbox. */
export function ExternalSessionPage() {
  const { inst, profile, sessionId } = useParams({ strict: false }) as { inst: string; profile: string; sessionId: string };
  const messages = useQuery({ queryKey: ['external', inst, profile, sessionId], queryFn: () => api.externalMessages(inst, sessionId, profile) });
  const list = messages.data?.messages ?? [];
  // no re-reading here: background sub-agents show « rouvrez la session plus tard »
  const entries = applyDeliveries(historyEntries(list), delegationState(list, messages.data?.openUnits), false);
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
  const navigate = useNavigate();
  const { canCopy } = useCopyOps(inst);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  /** Hermes refuses messages to a session born elsewhere: a copy in a workspace of the same agent continues it. */
  const carryOn = useMutation({
    mutationFn: async () => {
      const options = (workspaces.data?.workspaces ?? [])
        .filter((w) => w.instanceId === inst && (w.profile ?? 'default') === profile)
        .map((w) => ({ value: w.slug, label: w.name }));
      if (!options.length) throw new Error(t('Créez d’abord un workspace pour l’agent {agent}', { agent }));
      const slug = await askChoice({
        title: t('Continuer dans Intendia'), label: t('Copier la conversation dans le workspace'), options, confirmLabel: t('Continuer'),
        message: t('Une copie est créée ; la session d’origine ne change pas.'),
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
  // deleted at Hermes after a confirmation (no undo), then back to the home page
  const rm = useRemoveSession();
  const remove = useMutation({
    mutationFn: () => rm.remove({ kind: 'hermes', inst, profile, id: sessionId }),
    onSuccess: async (res) => { if (res) await navigate({ to: '/', replace: true }); },
  });
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line/70 bg-sheet/95 backdrop-blur-sm">
        <div className="flex min-h-16 items-center gap-2 px-4 py-3 md:px-6">
          <Link to="/" aria-label={t('Revenir à la liste')} className={cx(ICON_BTN, 'border-transparent md:hidden')}>
            <ArrowLeft className="size-4" strokeWidth={1.5} />
          </Link>
          <div className="min-w-0 flex-1">
            <h2 data-session-title className="truncate text-lg font-semibold leading-snug">{known?.title ?? t('Session externe')}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">{meta}</p>
          </div>
          <Button variant="ghost" className="shrink-0" onClick={() => remove.mutate()} disabled={remove.isPending}>
            <Trash2 className="size-4" strokeWidth={1.5} />{t('Supprimer')}
          </Button>
          {canCopy && (
            <Button variant="primary" className="shrink-0" onClick={() => carryOn.mutate()} disabled={carryOn.isPending || !messages.isSuccess}>
              <MessageSquarePlus className="size-4" strokeWidth={1.5} />{t('Continuer dans Intendia')}
            </Button>
          )}
          <FullScreen />
        </div>
      </header>
      <div className="mx-auto w-full max-w-[748px] px-4 py-7 md:px-6">
        <p className="mb-7 rounded-lg bg-paper px-3.5 py-2.5 text-[13px] text-ink-soft">{t('Lecture seule : cette session vient de Telegram, du CLI, de l’API, d’un cron ou du kanban')}</p>
        <ErrorText error={messages.error} />
        <ErrorText error={carryOn.error} />
        <ErrorText error={remove.error} />
        {messages.isSuccess && entries.length === 0 && <p className="text-sm text-ink-faint">{t('Aucun message')}</p>}
        <Thread entries={entries} agent={agent} />
      </div>
    </div>
  );
}
