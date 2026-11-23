// A channel with several agents (lot 7): its thread, who works now, the stopped turn to decide, the message field
// (@nom names members, else the lead answers). The server plays the turns (channels/runner.ts): this page reads.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, ArrowUp, Ellipsis, Hash, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type ChannelMember, type ChannelTurn } from '../api';
import { AgentAvatar, useAgentLooks } from '../agents/look';
import { ask, askText } from '../components/Dialog';
import { Menu, Picker, PICKER_BTN } from '../components/Menu';
import { Button, cx, ErrorText } from '../components/ui';
import { locale, plural, t } from '../i18n';

function Face({ m, size = 28 }: { m: ChannelMember; size?: number }) {
  const looks = useAgentLooks(m.instanceId);
  return <AgentAvatar name={m.profile} color={looks.color(m.profile)} size={size} />;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

export function ChannelPage() {
  const { channelId } = useParams({ strict: false }) as { channelId: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ['channel', channelId];
  const q = useQuery({
    queryKey: key, queryFn: () => api.channel(channelId),
    // every 2 s while a turn is queued or running, else every 15 s
    refetchInterval: (query) => (query.state.data?.turns.some((x) => x.status === 'queued' || x.status === 'running') ? 2_000 : 15_000),
  });
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['channels'] }); };
  const send = useMutation({
    mutationFn: (s: string) => api.postChannel(channelId, s),
    onSuccess: () => { setText(''); refresh(); },
  });
  const decide = useMutation({
    mutationFn: (a: { turn: number; body: Parameters<typeof api.decideTurn>[2] }) => api.decideTurn(channelId, a.turn, a.body),
    onSuccess: refresh,
  });
  const count = q.data?.messages.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [count]);
  // the column's channel row (« en cours », « arrêté ») follows the turns of this page
  const states = (q.data?.turns ?? []).map((x) => `${x.id}:${x.status}`).join(',');
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['channels'] }); }, [states, qc]);

  const d = q.data;
  if (!d) return <div className="p-6"><ErrorText error={q.error} />{q.isPending && <Loader2 className="size-5 animate-spin text-ink-faint" />}</div>;
  const by = new Map(d.members.map((m) => [m.handle, m]));
  const running = d.turns.find((x) => x.status === 'running');
  const queued = d.turns.filter((x) => x.status === 'queued');
  const stopped = d.turns.find((x) => x.status === 'stopped');
  const insert = (h: string) => { setText((s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}@${h} `); box.current?.focus(); };
  const submit = () => { const s = text.trim(); if (s && !send.isPending) send.mutate(s); };

  return (
    <div className="flex min-h-full flex-col" data-channel={d.channel.id}>
      <header className="sticky top-0 z-10 border-b border-line/70 bg-sheet/95 backdrop-blur-sm">
        <div className="flex min-h-16 items-center gap-3 px-4 py-3 md:px-6">
          <button type="button" onClick={() => void navigate({ to: '/' })} aria-label={t('Revenir à la liste')} className="flex size-8 items-center justify-center rounded-lg text-ink-faint hover:bg-raised md:hidden">
            <ArrowLeft className="size-4" strokeWidth={1.5} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 truncate text-lg font-semibold leading-snug"><Hash className="size-4 text-ink-faint" strokeWidth={2} />{d.channel.name}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">
              {[plural(d.members.length, '{n} agent', '{n} agents'), t('chef @{lead}', { lead: d.channel.lead }),
                d.cost.usd > 0 ? `${d.cost.usd.toLocaleString(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })}` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex -space-x-1.5">{d.members.map((m) => <span key={m.handle} title={`@${m.handle} · ${m.instanceLabel}`} className="rounded-[9px] ring-2 ring-sheet"><Face m={m} size={26} /></span>)}</div>
          <Menu title={t('Actions du canal')} align="end"
            triggerClass="flex size-8 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-raised"
            trigger={<><Ellipsis className="size-4" strokeWidth={1.5} /><span className="sr-only">{t('Actions du canal')}</span></>}
            items={[
              { label: t('Modifier les consignes…'), onSelect: () => void askText({ title: t('Consignes du canal'), value: d.channel.instructions, maxLength: 4000, confirmLabel: t('Enregistrer'), multiline: true }).then(async (v) => { if (v !== null) { await api.updateChannel(channelId, { instructions: v }); refresh(); } }) },
              ...d.members.filter((m) => m.handle !== d.channel.lead).map((m) => ({ label: t('Nommer @{handle} chef', { handle: m.handle }), onSelect: () => void api.updateChannel(channelId, { lead: m.handle }).then(refresh) })),
              { label: t('Archiver le canal…'), danger: true, onSelect: () => void ask({ title: t('Archiver « {name} » ?', { name: d.channel.name }), message: t('Ses tours en attente sont annulés. Les sessions cachées des agents restent dans les archives.'), danger: true, confirmLabel: t('Archiver') }).then(async (yes) => { if (yes) { await api.archiveChannel(channelId); refresh(); void navigate({ to: '/' }); } }) },
            ]} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[748px] flex-1 flex-col gap-5 px-4 py-7 md:px-6">
        {d.channel.instructions && <p className="rounded-lg bg-paper px-3.5 py-2.5 text-[13px] text-ink-soft"><span className="font-medium text-ink">{t('Consignes')} · </span>{d.channel.instructions}</p>}
        {d.messages.length === 0 && (
          <p className="text-sm text-ink-faint">{t('Écrivez au canal : nommez un membre avec @nom, ou laissez le chef @{lead} répondre et répartir le travail.', { lead: d.channel.lead })}</p>
        )}
        {d.messages.map((m) => {
          if (m.author === 'system') return <p key={m.seq} data-channel-system className="text-center text-xs text-ink-faint">{m.text}</p>;
          if (m.author === 'user') {
            return (
              <div key={m.seq} className="flex flex-col items-end" data-channel-user>
                <p className="mb-1 text-[13px] font-semibold">{t('Vous')} <span className="font-mono text-xs font-normal text-ink-faint">{time(m.at)}</span></p>
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent-soft px-4 py-2.5 text-[15px]">{m.text}</div>
              </div>
            );
          }
          const mem = by.get(m.author);
          return (
            <div key={m.seq} className="flex gap-3" data-channel-agent={m.author}>
              {mem ? <Face m={mem} /> : <span className="size-7" />}
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[13px] font-semibold">@{m.author} <span className="font-normal text-ink-faint">{mem && mem.instanceLabel}</span> <span className="font-mono text-xs font-normal text-ink-faint">{time(m.at)}</span></p>
                <div className="md text-[15px]"><Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown></div>
              </div>
            </div>
          );
        })}
        {running && (
          <p className="flex items-center gap-2 text-[13px] text-ink-soft" data-channel-running>
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />{t('@{handle} travaille…', { handle: running.handle })}
          </p>
        )}
        {stopped && <Stopped turn={stopped} members={d.members} pending={decide.isPending} onDecide={(body) => decide.mutate({ turn: stopped.id, body })} />}
        {queued.length > 0 && <p className="text-xs text-ink-faint">{t('Ensuite : {list}', { list: queued.map((x) => `@${x.handle}`).join(', ') })}</p>}
        <ErrorText error={decide.error} />
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-sheet via-sheet to-sheet/0 px-4 pb-4 pt-6 md:px-6">
        <div className="card mx-auto max-w-[748px] p-2 pl-2.5">
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {d.members.map((m) => (
              <button key={m.handle} type="button" onClick={() => insert(m.handle)} className="rounded-md px-1.5 py-0.5 font-mono text-xs text-ink-faint hover:bg-raised hover:text-ink">@{m.handle}</button>
            ))}
            <button type="button" onClick={() => insert('tous')} className="rounded-md px-1.5 py-0.5 font-mono text-xs text-ink-faint hover:bg-raised hover:text-ink">@tous</button>
          </div>
          <div className="flex items-end gap-2">
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label={t('Message')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              placeholder={t('Message au canal ; sans @nom, @{lead} répond', { lead: d.channel.lead })}
              className="block max-h-60 min-h-9 w-full resize-none bg-transparent px-1.5 py-1.5 text-[15px] placeholder:text-ink-faint focus:outline-none" />
            <button type="button" onClick={submit} disabled={!text.trim() || send.isPending} aria-label={t('Envoyer')}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors disabled:opacity-40">
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          </div>
          <ErrorText error={send.error} />
        </div>
      </div>
    </div>
  );
}

/** A turn whose run failed or stopped: the channel waits for the user's decision. */
function Stopped({ turn, members, pending, onDecide }: {
  turn: ChannelTurn; members: ChannelMember[]; pending: boolean;
  onDecide: (body: { action: 'continue' | 'cancel' } | { action: 'reassign'; handle: string }) => void;
}) {
  const others = members.filter((m) => m.handle !== turn.handle);
  return (
    <div className="card border-warn/40 px-4 py-3" data-channel-stopped>
      <p className="text-sm font-medium">{t('Le tour de @{handle} s’est arrêté', { handle: turn.handle })}</p>
      {turn.detail && <p className="mt-0.5 text-[13px] text-ink-soft">{turn.detail}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending} onClick={() => onDecide({ action: 'continue' })}>{t('Continuer')}</Button>
        {others.length > 0 && (
          <Picker title={t('Réattribuer à')} placement="below" value={null} disabled={pending}
            items={others.map((m) => ({ value: m.handle, label: `@${m.handle}` }))}
            onPick={(h) => { if (h) onDecide({ action: 'reassign', handle: h }); }}
            label={t('Réattribuer…')} triggerClass={cx(PICKER_BTN, 'h-9 px-3')} />
        )}
        <Button variant="ghost" disabled={pending} onClick={() => onDecide({ action: 'cancel' })}>{t('Annuler')}</Button>
      </div>
    </div>
  );
}
