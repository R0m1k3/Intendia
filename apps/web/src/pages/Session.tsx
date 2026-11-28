// The session page: the composition of its units (sessions/session/): what is read from the server, the run,
// the actions on the session and its history, the thread's scroll, the header, the side panel and the composer.
import { useAgentLooks } from '../agents/look';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type RunStat } from '../api';
import { historyEntries } from '../chat/events';
import { EMBEDDED, setSideSession } from '../chat/embed';
import { Composer, type ComposerHandle } from '../chat/Composer';
import { sessionDraftKey } from '../chat/draft';
import { InstancePick } from '../chat/InstancePick';
import { ContextGauge } from '../chat/ContextGauge';
import { estimateTokens } from '../chat/estimate';
import { placeRunStats } from '../chat/format';
import { RunOptions } from '../chat/RunOptions';
import { AGENT_INDENT, ApprovalCard } from '../chat/ApprovalCard';
import { AgentFace, OpenSubagents, ThinkingIndicator, Thread } from '../chat/Thread';
import { stamps } from '../chat/timeline';
import { Todos } from '../chat/Todos';
import { OUTLINE_MIN, TurnJump } from '../chat/TurnNav';
import { useStoredFlag } from '../components/useStoredFlag';
import { ClarifyCard } from '../chat/ClarifyCard';
import { useColumn, useOpenSession } from '../chat/column-context';
import { ChatNotice } from '../components/ChatNotice';
import { DropZone } from '../files/DropZone';
import { FilePaths } from '../files/FilePaths';
import { cutFor } from '../chat/history-actions';
import { COMMANDS, type Command, type CommandName } from '../chat/commands';
import { formatTokens } from '../chat/format';
import { Picker } from '../components/Menu';
import { cx, ErrorText, SkeletonThread } from '../components/ui';
import { GoalBar, goalKey } from '../chat/GoalBar';
import { SubagentsBar } from '../chat/SubagentsBar';
import { GoalDialog } from '../chat/GoalDialog';
import { SESSION_LIST_KEYS } from '../sessions/UndoBar';
import { SessionHeader } from '../sessions/session/SessionHeader';
import { SessionSidePanel } from '../sessions/session/SessionSidePanel';
import { useHistoryActions } from '../sessions/session/useHistoryActions';
import { usePalettePage } from '../sessions/session/usePalettePage';
import { OUTCOME, useRunControl, type ActiveRun } from '../sessions/session/useRunControl';
import { useSessionActions } from '../sessions/session/useSessionActions';
import { useSessionData } from '../sessions/session/useSessionData';
import { useSessionFiles } from '../sessions/session/useSessionFiles';
import { useSessionGoal } from '../sessions/session/useSessionGoal';
import { useSessionMove } from '../sessions/session/useSessionMove';
import { useSidePanel } from '../sessions/session/useSidePanel';
import { useThreadEntries } from '../sessions/session/useThreadEntries';
import { useThreadScroll } from '../sessions/session/useThreadScroll';
import { locale, t } from '../i18n';
import { T } from '../i18n/T';

// moved to sessions/session/SessionHeader.tsx; still imported from here (pages/ExternalSession.tsx)
export { FullScreen, ICON_BTN, when } from '../sessions/session/SessionHeader';

/** In a column of the Chat page, the thread scrolls in its own element (its panel stays beside it, outside). */
function Scroller({ inColumn, children }: { inColumn: boolean; children: ReactNode }) {
  return inColumn ? <div data-scroll-root className="min-w-0 flex-1 overflow-y-auto">{children}</div> : <>{children}</>;
}

/**
 * The route reuses the page when another session is opened from the sidebar: a key remounts it so the
 * run state (active run, outcome, draft) never leaks from one session to the next.
 */
export function SessionPage() {
  const { slug, sessionId } = useParams({ strict: false }) as { slug: string; sessionId: string };
  return <SessionView key={`${slug}/${sessionId}`} slug={slug} sessionId={sessionId} />;
}

export function SessionView({ slug, sessionId }: { slug: string; sessionId: string }) {
  const qc = useQueryClient();
  const col = useColumn();
  const goTo = useOpenSession();
  // the run followed by the page: its reading of the history depends on it (sessions/session/useRunControl.ts)
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = useSessionData({ slug, sessionId, running: Boolean(active), setError });
  const { ws, inst, sess, agentProfile, vaultOn, skillNames, history, runStatsQ, lastRunId, lastRun, chat, mounts, agent, messages } = data;
  const [attached, setAttached] = useState(0);
  const looks = useAgentLooks(inst ?? null);
  const faceProfile = sess.data?.profile ?? 'default';
  const faceColor = looks.color(faceProfile);
  const face = useMemo(() => ({ profile: faceProfile, color: faceColor }), [faceProfile, faceColor]);
  const side = useSidePanel(sessionId);
  const { panel, openFiles, openSubagents } = side;
  const composer = useRef<ComposerHandle>(null);

  // the last workspace used is the home page's starting choice
  // (in the Chat page, only the active column: the others are not « the session opened last »)
  const leading = !col || col.active;
  useEffect(() => { if (leading) localStorage.setItem('intendia-last-workspace', slug); }, [slug, leading]);
  // the last session opened is the one the side chat (⌘J) shows
  const found = Boolean(sess.data);
  useEffect(() => { if (inst && found && leading) setSideSession(inst, { slug, id: sessionId }); }, [inst, found, slug, sessionId, leading]);
  // in the side chat, the cursor goes to the message field
  useEffect(() => { if (EMBEDDED) composer.current?.focus(); }, [found]);

  const run = useRunControl({ inst, sessionId, active, setActive, lastRun: lastRun.data, lastRunId, knownId: data.knownId, forgetOlder: data.older.forget, chat, setError });
  const { live, link, approval, clarify, outcome, sending, busy, runCount, queued, stop } = run;
  const actions = useSessionActions({ inst, slug, sessionId, sess: sess.data, agentProfile, setError });
  const { rename, setOptions, titleAi, canTitleAi, setAutoApprove } = actions;
  const { entries, todos, subagents, stopWaiting } = useThreadEntries({ inst, sessionId, history, messages, active, live, trees: run.trees, setError });
  const lastStatus = lastRun.data;
  // an empty session (« Nouvelle session », or one never used): the cursor goes to its message box, once
  const focusedEmpty = useRef<string | null>(null);
  const emptyReady = leading && history.isSuccess && entries.length === 0 && !active;
  const endNote = !active && (outcome ?? (lastStatus && OUTCOME[lastStatus.status] ? { status: lastStatus.status, error: lastStatus.error ?? lastStatus.output, input: null } : null));
  // Hermes does not keep the message of a run that failed before starting: keep it on screen.
  const lostInput = endNote && endNote.input && !messages.some((m) => m.role === 'user' && m.content === endNote.input) ? endNote.input : null;
  if (lostInput) entries.push({ kind: 'user', key: 'lost-input', text: lostInput, ts: null });
  const running = Boolean(active);
  /** The session exists at Hermes (sent once, or a copy): it has something to copy and export. */
  const sentOnce = Boolean(sess.data?.session.lastRunId || sess.data?.session.copiedFrom);
  const hist = useHistoryActions({
    inst, slug, sessionId, entries, running, queued, sentOnce, canCopy: actions.canCopy, forgetOlder: data.older.forget, setError, composer,
  });
  const { last, lastTurn, runRewrite, threadActions, rewriteWhy } = hist;
  useEffect(() => {
    if (!emptyReady || focusedEmpty.current === sessionId) return;
    focusedEmpty.current = sessionId;
    composer.current?.focus();
  }, [emptyReady, sessionId]);
  const move = useSessionMove({ inst, slug, sessionId, sess: sess.data, instances: data.instances.data, setError });
  const { switching, siblings, neverSent, pickable } = move;
  // run lines go under the history entries; the run of a message Hermes did not keep goes under it
  // the fresher of the two readings (a run that ended since the last cost read is in the history's)
  const runs = (runStatsQ.data && runStatsQ.dataUpdatedAt >= history.dataUpdatedAt ? runStatsQ.data.runs : history.data?.runs) ?? [];
  const footers = useMemo(() => {
    const m = placeRunStats(historyEntries(messages), runs);
    if (lostInput && runs.length) {
      const last: RunStat = runs[runs.length - 1]!;
      for (const [k, list] of m) {
        const rest = list.filter((r) => r.runId !== last.runId);
        if (rest.length) m.set(k, rest); else m.delete(k);
      }
      m.set('lost-input', [last]);
    }
    return m;
  }, [messages, runs, lostInput]);
  // context gauge: read on opening and after each run
  const usage = useQuery({
    queryKey: ['usage', inst, sessionId, runCount], queryFn: () => api.sessionUsage(inst!, sessionId),
    enabled: Boolean(inst), staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const estimate = estimateTokens(entries);
  // « /usage »: a line under the composer, closed by × or the next message
  const [usageOpen, setUsageOpen] = useState(false);
  const { goalQ, goalDialog, setGoalDialog, saveGoal } = useSessionGoal({ inst, sessionId, knownId: data.knownId, setActive });

  // slash commands of the composer: the same actions as the menu and the thread, with the reason when not possible
  const branchKey = lastTurn ?? undefined;
  const commands: Command[] = COMMANDS.map((c) => {
    const disabled = ({
      new: undefined,
      clear: rewriteWhy,
      undo: rewriteWhy ?? (last ? undefined : t('Le dernier message n’est pas enregistré')),
      retry: rewriteWhy ?? (last && lastTurn ? undefined : t('Aucune réponse à relancer')),
      branch: rewriteWhy ?? (branchKey && cutFor(entries, 'branch', branchKey) !== undefined ? undefined : t('Aucune réponse pour la branche')),
      title: undefined,
      usage: undefined,
      stop: running ? undefined : t('Aucun travail en cours'),
      prompt: undefined,
      use: skillNames.length ? undefined : t('Aucun skill activé pour cet agent'),
      goal: undefined,
    } satisfies Record<CommandName, string | undefined>)[c.name];
    return disabled ? { ...c, disabled } : c;
  });
  const onCommand = async (name: CommandName, arg: string): Promise<boolean> => {
    setError(null);
    try {
      switch (name) {
        case 'new': {
          const { session } = await api.createSession(slug);
          await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
          goTo.open(slug, session.id);
          return true;
        }
        case 'clear': runRewrite('clear'); return true;
        case 'undo': runRewrite('undo', undefined, last?.text); return true;
        case 'retry': runRewrite('retry', undefined, last?.text); return true;
        case 'branch': runRewrite('branch', branchKey); return true;
        case 'title':
          if (arg) await rename.mutateAsync(arg);
          else if (!canTitleAi) { setError(new Error(t('Titre par l’IA indisponible sur cette instance : /title suivi du nom renomme la session'))); return false; }
          else if (!sentOnce) { setError(new Error(t('La conversation est vide : rien pour faire un titre'))); return false; }
          else await titleAi.mutateAsync();
          return true;
        case 'usage': setUsageOpen(true); void usage.refetch(); return true;
        case 'stop': await stop(); return true;
        case 'prompt': composer.current?.openPrompts(arg); return true;
        case 'use': return true; // handled by the composer (a pill)
        case 'goal': {
          const g = goalQ.data;
          // « /goal » alone on a goal not finished: edit it; else a new goal (the text after /goal prefilled)
          if (!arg && g && g.status !== 'done') setGoalDialog({ editing: true, initial: g });
          else setGoalDialog({ editing: false, initial: { text: arg } });
          return true;
        }
      }
    } catch (err) {
      setError(err);
      return false;
    }
  };

  const { bottom, header, box, toEnd, items, jumpTo, jump } = useThreadScroll({ entries, approval, clarify, inactive: Boolean(col && !col.active) });
  // « Afficher les heures » (time of each step) and « Plan » / ↑ ↓ (jump between the user's questions)
  const [times, setTimes] = useStoredFlag('intendia-thread-times');
  const timeMap = useMemo(() => (times ? stamps(entries) : undefined), [times, entries]);

  const title = sess.data?.session.title || t('Nouvelle session');
  // the reading width, unless the column is one of several on screen
  const narrow = !col || col.wide;
  // the Chat page's tabs show what the column is doing
  const waiting = Boolean(approval || clarify);
  const report = col?.report;
  useEffect(() => { report?.({ running, waiting, title }); }, [report, running, waiting, title]);

  // « /goal » can be typed when the message field can
  const goalOk = Boolean(inst) && chat.available && !switching;
  const { modelOpen, setModelOpen } = usePalettePage({
    inst, agentProfile, found: Boolean(sess.data), optionsDisabled: running || setOptions.isPending || !chat.available, leading, title, running, goalOk,
    handlers: { stop, onCommand, renameSession: actions.renameSession, copyLink: actions.copyLink, openFiles }, composer,
  });

  const files = useSessionFiles({ slug, entries, messages, mounts, runCount, side, composer });
  const { filePaths, upload, extract, addFiles } = files;

  return (
    <FilePaths.Provider value={filePaths}>
    <div className={col ? 'flex h-full' : 'flex min-h-full'}>
    <Scroller inColumn={Boolean(col)}>
    <DropZone onFiles={addFiles} label={t('Déposer dans inbox/ et joindre au message')} className={cx('flex min-w-0 flex-1 flex-col', col ? 'min-h-full' : EMBEDDED ? 'min-h-dvh' : 'min-h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom))] md:min-h-[var(--content-h)]')}>
      <SessionHeader
        headerRef={header} title={title} slug={slug} inst={inst} sessionId={sessionId} sess={sess.data}
        instanceLabel={mounts?.label} workspaceName={ws.data?.workspace.name} looks={looks} side={side} items={items} onJump={jumpTo}
        running={running} sentOnce={sentOnce} times={times} setTimes={setTimes} actions={actions} history={hist} col={col}
      />

      <div className={cx('mx-auto w-full flex-1 px-4 py-7 md:px-6', narrow && 'max-w-[748px]')}>
        <div className="mb-6 empty:hidden"><ChatNotice instanceId={inst} /></div>
        {history.isSuccess && entries.length === 0 && !running && !endNote && (
          <div className="py-16 text-center">
            {neverSent && !EMBEDDED && inst && pickable.length > 1 && (
              <div className="mb-5">
                <InstancePick value={inst} instances={pickable} disabled={switching || sending || attached > 0}
                  onPick={(id) => void move.switchInstance(id)} />
              </div>
            )}
            <p className="text-base font-semibold">{t('Nouvelle session dans {name}', { name: ws.data?.workspace.name ?? '' })}</p>
            {neverSent && siblings.length > 1 && (
              <div className="mt-2 flex justify-center" data-move-empty>
                <Picker
                  title={t('Dossier de cette session')} placement="below" value={slug}
                  items={siblings.map((w) => ({ value: w.slug, label: w.name }))}
                  onPick={(v) => void move.moveTo(v)}
                  label={<>{t('Changer de dossier')}</>}
                />
              </div>
            )}
            <p className="mt-1.5 text-sm text-ink-faint">{t('L’agent travaille dans le dossier et range ses fichiers dans celui de la session')}</p>
          </div>
        )}
        {live?.truncated && (
          <p className="mb-4 text-xs text-ink-faint">{t('Le début de ce run n’est plus disponible en direct : il apparaîtra à la fin')}</p>
        )}
        <AgentFace.Provider value={face}><OpenSubagents.Provider value={openSubagents}>
        {history.isPending && entries.length === 0 ? <SkeletonThread /> : (
          <Thread
            entries={entries} footers={footers} agent={agent} actions={threadActions} times={timeMap} liveDeliveries subagents={subagents}
            vault={vaultOn && inst ? { inst, profile: agentProfile } : undefined}
            hasOlder={data.older.hasOlder} loadingOlder={data.older.loadingOlder} onLoadOlder={() => void data.older.loadOlder()}
          />
        )}
        {running && !approval && !clarify && <ThinkingIndicator entries={entries} agent={agent} />}
        </OpenSubagents.Provider></AgentFace.Provider>
        {running && link.mode === 'polling' && (
          <p data-deferred={link.cause} className={cx('mt-2 text-xs text-ink-faint', AGENT_INDENT)}>
            {link.cause === 'cap' ? t('Suivi en différé : trois suivis en direct sont déjà ouverts. La réponse s’affichera à la fin.')
              : link.cause === 'lost' ? t('Suivi en direct interrompu : la réponse s’affichera à la fin.')
              : link.cause === 'offline' ? t('Connexion perdue avec Intendia : nouvel essai en cours…')
              : <>{t('Connexion à Intendia expirée : reconnectez-vous pour suivre ce travail.')} <Link to="/connexion" className="underline">{t('Se connecter')}</Link></>}
          </p>
        )}
        {approval && (
          <div className="mt-5"><ApprovalCard approval={approval} onChoose={run.approve} busy={busy} /></div>
        )}
        {clarify && (
          <div className="mt-5"><ClarifyCard key={clarify.requestId ?? ''} clarify={clarify} onAnswer={(text) => void run.answer(text)} busy={busy} /></div>
        )}
        {endNote && (
          <div className={cx('mt-5', AGENT_INDENT)}>
            <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {endNote.error
                ? <T k="{outcome} : {error}" vars={{ outcome: <span className="font-medium">{OUTCOME[endNote.status]}</span>, error: endNote.error }} />
                : <span className="font-medium">{OUTCOME[endNote.status]}</span>}
            </div>
          </div>
        )}
        <div ref={bottom} className="h-4" />
      </div>

      <div className="sticky bottom-0 bg-linear-to-t from-sheet from-70% to-transparent pt-4">
        <div className={cx('relative mx-auto px-4 pb-4 md:px-6 md:pb-5', narrow && 'max-w-[796px]')}>
          {items.length >= OUTLINE_MIN && (
            <div className="absolute bottom-full right-4 mb-1 md:right-6"><TurnJump onPrev={() => jump(-1)} onNext={() => jump(1)} /></div>
          )}
          {todos && todos.length > 0 && <Todos todos={todos} />}
          {subagents && subagents.openTasks > 0 && !active && <SubagentsBar summary={subagents} onStop={() => void stopWaiting()} />}
          {inst && goalQ.data && (
            <GoalBar
              inst={inst} sessionId={sessionId} sessionLastRunId={lastRunId} goal={goalQ.data}
              onEdit={() => setGoalDialog({ editing: true, initial: goalQ.data! })}
            />
          )}
          {goalDialog && (
            <GoalDialog
              initial={goalDialog.initial} editing={goalDialog.editing} autoApprove={Boolean(sess.data?.session.autoApprove)}
              onSubmit={saveGoal} onClose={() => setGoalDialog(null)}
            />
          )}
          <div className="mb-2 empty:hidden"><ErrorText error={error} /></div>
          <Composer
            ref={composer}
            upload={upload}
            extract={extract}
            prompts
            draftKey={inst ? sessionDraftKey(inst, sessionId) : undefined}
            onAttachmentsChange={setAttached}
            onSend={(text, sk) => {
              setUsageOpen(false);
              // sending is going back to the end of the thread, wherever the reader was
              const main = box();
              if (main) toEnd(main);
              return run.send(text, sk);
            }}
            skillNames={skillNames}
            autoApprove={sess.data?.session.autoApprove ? { onOff: () => void setAutoApprove(false) } : null}
            onStop={stop}
            commands={commands}
            onCommand={onCommand}
            running={running}
            // changing instance: nothing typed or sent here any more (the draft is being carried over)
            disabled={!chat.available || !inst || switching}
            onQueue={(text, sk) => {
              run.enqueueMessage(text, sk);
              // a message waiting is the user writing: an active goal pauses before the loop relaunches
              if (inst && goalQ.data?.status === 'active') {
                void api.pauseGoal(inst, sessionId, 'user').then(() => qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) }), () => {});
              }
            }}
            onSteer={run.steer}
            steerDisabled={run.steerDisabled}
            queue={run.queueProps}
            options={inst && sess.data && (
              <RunOptions
                inst={inst} profile={sess.data.profile ?? 'default'}
                model={sess.data.session.model} provider={sess.data.session.modelProvider} effort={sess.data.session.effort}
                onProfile={(p) => void actions.changeProfile(p)}
                hasRuns={Boolean(lastRunId)} disabled={running || setOptions.isPending || !chat.available}
                modelOpen={modelOpen} onModelOpenChange={setModelOpen}
                onChange={(patch) => setOptions.mutate(patch)}
              />
            )}
            placeholder={running ? (live?.status === 'waiting_for_approval' ? t('En attente de votre approbation') : live?.status === 'waiting_for_clarify' ? t('Hermes vous pose une question') : t('L’agent travaille… Entrée met votre message en file')) : t('Message à {agent}…', { agent })}
            hint={entries.length ? <ContextGauge usage={usage.data} estimate={estimate} />
              : running ? t('Entrée : mettre en file · Réorienter : donner le texte tout de suite') : t('Entrée : envoyer · Maj+Entrée : à la ligne · / : commandes')}
          />
          {usageOpen && (
            <div data-usage-line className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12px] text-ink-soft">
              <p className="min-w-0 flex-1">{usageText(usage.data, estimate, usage.isFetching)}</p>
              <button type="button" onClick={() => setUsageOpen(false)} aria-label={t('Fermer')} className="text-ink-faint hover:text-ink">
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </div>
    </DropZone>
    </Scroller>
    {panel && (
      <SessionSidePanel
        inst={inst} slug={slug} sessionId={sessionId} profile={sess.data?.profile ?? 'default'} autoApprove={Boolean(sess.data?.session.autoApprove)}
        onAutoApprove={(on) => void setAutoApprove(on)} entries={entries} runCount={runCount} files={files} side={side} col={col}
      />
    )}
    </div>
    </FilePaths.Provider>
  );
}

/** Text of « /usage »: the context (counted by Hermes or estimated) and the plan quota when the gateway gives it. */
function usageText(usage: Awaited<ReturnType<typeof api.sessionUsage>> | undefined, estimate: number, fetching: boolean): string {
  if (!usage && fetching) return t('Lecture de l’utilisation…');
  const exact = usage?.exact ?? null;
  const max = exact?.max ?? usage?.max ?? null;
  const used = formatTokens(exact?.used ?? estimate);
  const pct = max ? Math.round(((exact?.used ?? estimate) / max) * 100) : 0;
  const context = max
    ? (exact
      ? t('Contexte : {used} sur {max} jetons ({pct} %), compté par Hermes', { used, max: formatTokens(max), pct })
      : t('Contexte : ≈ {used} sur {max} jetons ({pct} %), estimé à partir du fil', { used, max: formatTokens(max), pct }))
    : (exact
      ? t('Contexte : {used} jetons (taille du modèle inconnue), compté par Hermes', { used })
      : t('Contexte : ≈ {used} jetons (taille du modèle inconnue), estimé à partir du fil', { used }));
  const q = usage?.quota;
  if (!q) return context;
  const label = q.label ?? t('Forfait');
  const usedPct = Math.round(q.usedPercent);
  const quota = q.resetsAt
    ? t('{label} : {pct} % utilisés, remise à zéro {when}', { label, pct: usedPct, when: new Date(q.resetsAt).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })
    : t('{label} : {pct} % utilisés', { label, pct: usedPct });
  return `${context} · ${quota}`;
}
