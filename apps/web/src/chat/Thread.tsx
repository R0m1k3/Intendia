import { thinkingState } from './thinking';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, ChevronRight, Copy, FileText, GitBranch, KeyRound, Loader2, Pencil, RotateCcw, X } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rawUrl, type ApprovalChoice, type RunStat, type SubagentsSummary } from '../api';
import { Button, copyText, cx, Mark } from '../components/ui';
import { useFilePaths } from '../files/FilePaths';
import { baseName, fileKind } from '../files/paths';
import { rehypePaths } from '../files/rehypePaths';
import { splitAttachments } from './attachments';
import type { Approval, Entry } from './events';
import { Artifact } from './Artifact';
import { splitArtifacts } from './artifacts';
import { RunFooter } from './RunFooter';
import { stepsLabel, toTurns, type Part, type ToolEntry, type Turn } from './turns';
import { Delivery } from './Delivery';
import { vaultHint } from './vault-hint';
import { duration, Subagents } from './Subagents';
import type { Stamp } from './timeline';

/** How the user is named in the thread. */
const USER = 'Vous';

export function clock(ts: number | null, seconds = false): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

/** « Afficher les heures »: stamps of the entries by key (chat/timeline.ts); null = normal display. */
const Times = createContext<Map<string, Stamp> | null>(null);
/** Instance and effective profile of the session when the credential vault can be managed (link « Ajouter un accès »). */
const VaultLink = createContext<{ inst: string; profile: string } | null>(null);

/**
 * Links to the "Accès" page for the browser_vault calls that could not ask for a login (one per site), shown under the
 * header of the steps whether the card is open or folded.
 */
function VaultLinks({ tools }: { tools: ToolEntry[] }) {
  const vault = useContext(VaultLink);
  if (!vault) return null;
  const seen = new Set<string>();
  const hints = tools.flatMap((t) => {
    const h = vaultHint(t.tool, t.result);
    if (!h) return [];
    const k = h.origin ?? '';
    if (seen.has(k)) return [];
    seen.add(k);
    return [h];
  });
  if (!hints.length) return null;
  return (
    <div className="flex flex-col gap-1 px-1.5 pb-1 pt-1">
      {hints.map((h) => (
        <Link
          key={h.origin ?? ''} data-vault-link
          to="/i/$inst/acces" params={{ inst: vault.inst }}
          search={{ add: 'login', origin: h.origin ?? undefined, proposed: '1', profile: vault.profile === 'default' ? undefined : vault.profile }}
          className="inline-flex w-fit items-center gap-2 rounded-md px-1.5 py-1 text-[13px] font-medium text-accent-ink hover:bg-raised hover:text-ink"
        >
          <KeyRound className="size-3.5" strokeWidth={1.75} />
          {h.origin ? `Ajouter un accès pour ${new URL(h.origin).host}` : 'Ajouter un accès'}
        </Link>
      ))}
    </div>
  );
}
/** This page re-reads the session while sub-agents work in the background (their result shows up by itself). */
const LiveDeliveries = createContext(false);
/** the server's summary of background sub-agents (undefined: a session Intendia does not wake, as an external one) and the last delivery */
const WakeInfo = createContext<{ summary: SubagentsSummary | null | undefined; lastKey: string | null }>({ summary: undefined, lastKey: null });

/** « 14:03:27 · +12 s » for an entry, or null (times off, entry without a time). */
function useStamp(key: string): string | null {
  const times = useContext(Times);
  const s = times?.get(key);
  if (!s) return null;
  return `${clock(s.ts, true)}${s.gap !== null ? ` · +${duration(s.gap)}` : ''}`;
}

function StampLine({ k }: { k: string }) {
  const text = useStamp(k);
  return text ? <p className="font-mono text-[11px] text-ink-faint" data-stamp>{text}</p> : null;
}

/**
 * Markdown of the assistant. Inside a session, paths of existing workspace files become chips that
 * open the preview (rehypePaths); every other link opens in a new tab.
 */
export function Md({ text }: { text: string }) {
  const paths = useFilePaths();
  const rehype = useMemo(() => (paths?.found.size ? [rehypePaths(paths.found)] : []), [paths?.found]);
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehype}
        components={{
          a: ({ node: _n, ...p }) => {
            const path = (p as { 'data-path'?: string })['data-path'];
            if (path && paths) {
              return (
                <a href="#" className="file-chip" title={p.title} onClick={(e) => { e.preventDefault(); paths.open(path); }}>
                  <FileText className="size-3.5 shrink-0" strokeWidth={1.5} />
                  <span>{path.slice(path.lastIndexOf('/') + 1)}</span>
                </a>
              );
            }
            return <a {...p} target="_blank" rel="noreferrer" />;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

/** Width of the avatar column: the agent's content and its cards line up after it. */
export const AGENT_INDENT = 'pl-10';

function StepIcon({ state }: { state: ToolEntry['state'] }) {
  if (state === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-faint" strokeWidth={1.75} />;
  if (state === 'failed') return <X className="size-3.5 shrink-0 text-bad" strokeWidth={2} />;
  return <Check className="size-3.5 shrink-0 text-ok" strokeWidth={2} />;
}

function Step({ e }: { e: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const hasResult = Boolean(e.result);
  const stamp = useStamp(e.key);
  return (
    <li>
      <button
        type="button"
        onClick={() => hasResult && setOpen(!open)}
        aria-expanded={hasResult ? open : undefined}
        className={cx('flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-[3px] text-left font-mono text-xs', hasResult && 'hover:bg-raised')}
      >
        {stamp && <span className="shrink-0 font-mono text-[11px] text-ink-faint" data-stamp>{stamp}</span>}
        <StepIcon state={e.state} />
        <span className="shrink-0 font-mono text-ink">{e.tool}</span>
        <span className="min-w-0 truncate text-ink-faint">{e.preview}</span>
        <span className="ml-auto shrink-0 font-mono text-ink-faint">
          {e.state === 'running' ? 'en cours' : e.duration !== null ? `${e.duration.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : ''}
        </span>
        {hasResult && <ChevronRight className={cx('size-3.5 shrink-0 text-ink-faint transition-transform duration-150', open && 'rotate-90')} strokeWidth={1.5} />}
      </button>
      {open && e.result && (
        <pre className={cx('mx-1.5 mb-2 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-sheet p-3 font-mono text-xs whitespace-pre-wrap', e.state === 'failed' && 'text-bad')}>
          {e.result}
        </pre>
      )}
    </li>
  );
}

/**
 * Consecutive tool calls of a reply: open at first while one runs or when there are 3 or fewer (or the times are
 * shown: the card is created again when they are turned on), then only by click.
 */
function Steps({ tools }: { tools: ToolEntry[] }) {
  const times = useContext(Times) !== null;
  const [open, setOpen] = useState(() => times || tools.length <= 3 || tools.some((t) => t.state === 'running'));
  return (
    <div className="rounded-lg bg-paper px-1.5 py-1.5 text-ink-soft" data-steps>
      <button
        type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left font-mono text-xs text-ink-faint hover:text-ink"
      >
        <ChevronDown className={cx('size-3.5 shrink-0 transition-transform duration-150', !open && '-rotate-90')} strokeWidth={1.75} />
        {stepsLabel(tools)}
      </button>
      <VaultLinks tools={tools} />
      {open && <ul className="flex flex-col gap-0.5">{tools.map((t) => <Step key={t.key} e={t} />)}</ul>}
    </div>
  );
}

function PartView({ p }: { p: Part }) {
  const times = useContext(Times) !== null;
  if (p.kind === 'steps') return <Steps key={times ? `${p.key}:t` : p.key} tools={p.tools} />;
  return <>{times && <StampLine k={p.key} />}<PartBody p={p} /></>;
}

function PartBody({ p }: { p: Exclude<Part, { kind: 'steps' }> }) {
  switch (p.kind) {
    case 'assistant':
      // while it is typed, the path of an artefact line may be incomplete
      if (p.streaming) return <Md text={p.text} />;
      return <>{splitArtifacts(p.text).map((x, i) => (x.kind === 'md' ? <Md key={i} text={x.text} /> : <Artifact key={i} path={x.path} />))}</>;
    case 'reasoning':
      return (
        <details className="text-[13px] text-ink-faint">
          <summary className="cursor-pointer select-none">Raisonnement</summary>
          <p className="mt-2 whitespace-pre-wrap">{p.text}</p>
        </details>
      );
    case 'note':
      return <p className={cx('text-xs', p.tone === 'bad' ? 'text-bad' : 'text-ink-faint')}>{p.text}</p>;
    case 'subagents':
      return <SubagentsPart p={p} />;
  }
}

function SubagentsPart({ p }: { p: Extract<Part, { kind: 'subagents' }> }) {
  const live = useContext(LiveDeliveries);
  return <Subagents nodes={p.nodes} openSince={p.openSince} live={live} />;
}

function CopyReply({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" title="Copier la réponse" aria-label="Copier la réponse"
      onClick={() => void copyText(text, 'Réponse').then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="flex size-7 items-center justify-center rounded-md text-ink-faint transition-[color,background-color,opacity] hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
    >
      {done ? <Check className="size-3.5" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.5} />}
    </button>
  );
}

/** Round 28 px avatar with an initial: the agent on black with an orange letter, the user on grey. */
export function Avatar({ name, agent }: { name: string; agent: boolean }) {
  return (
    <span aria-hidden className={cx(
      'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase',
      agent ? 'bg-[#0e0e10] text-accent dark:ring-1 dark:ring-line' : 'bg-raised text-ink',
    )}>
      {Array.from(name)[0] ?? 'H'}
    </span>
  );
}

/** Name of a turn and its time (mono), beside the avatar. */
function Who({ name, ts, extra, seconds = false }: { name: string; ts: number | null; extra?: string; seconds?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-[13.5px]">
      <span className="truncate font-semibold">{name}</span>
      {(ts !== null || extra) && <span className="shrink-0 font-mono text-[11.5px] text-ink-faint">{[clock(ts, seconds), extra].filter(Boolean).join(' · ')}</span>}
    </span>
  );
}

/** The agent's header: avatar, name, time of the turn. */
export function AgentHeader({ ts, name = 'Hermes' }: { ts: number | null; name?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} agent />
      <Who name={name} ts={ts} />
    </div>
  );
}

/** One file joined to a user message: thumbnail for an existing image, chip for another file, grey label otherwise. */
function Joined({ written }: { written: string }) {
  const paths = useFilePaths()!;
  const rel = paths.found.get(written);
  const name = baseName(written);
  if (rel && fileKind(name) === 'image') {
    return (
      <button type="button" onClick={() => paths.open(rel)} title={name} className="overflow-hidden rounded-xl border border-line transition-opacity hover:opacity-90">
        <img src={rawUrl(paths.slug, rel)} alt={name} loading="lazy" className="block h-24 w-auto max-w-[16rem] object-cover" />
      </button>
    );
  }
  if (rel) {
    return (
      <a href="#" className="file-chip" title={rel} onClick={(e) => { e.preventDefault(); paths.open(rel); }}>
        <FileText className="size-3.5 shrink-0" strokeWidth={1.5} /><span>{name}</span>
      </a>
    );
  }
  return (
    <span className="file-chip text-ink-faint" title={written}>
      <FileText className="size-3.5 shrink-0" strokeWidth={1.5} /><span>{name}</span>
    </span>
  );
}

/** The user's message: the text in a bubble, the files joined to it below (thumbnails), as the composer showed them. */
function UserMessage({ text }: { text: string }) {
  const paths = useFilePaths();
  const split = useMemo(() => (paths?.mounts ? splitAttachments(text, paths.mounts) : { text, files: [] }), [text, paths?.mounts]);
  return (
    <>
      {split.text && <p data-user-text className="text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{split.text}</p>}
      {split.files.length > 0 && (
        <div className={cx('flex flex-wrap gap-2', split.text && 'mt-2')} data-joined>
          {split.files.map((f) => <Joined key={f} written={f} />)}
        </div>
      )}
    </>
  );
}

/**
 * History actions of the thread (session page); absent while a run goes on or messages wait in the queue. Each
 * replaces the session by a truncated copy, except the branch (a new session next to it).
 */
export interface ThreadActions {
  canEdit: (key: string) => boolean;
  edit: (key: string, text: string) => void;
  /** Agent turn offering "Réessayer" (the last one, after a stored user message), or null. */
  retryTurn: string | null;
  retry: () => void;
  canBranch: (turnKey: string) => boolean;
  branch: (turnKey: string) => void;
  busy: boolean;
}

const TURN_BUTTON = 'flex size-7 items-center justify-center rounded-md text-ink-faint transition-[color,background-color,opacity] hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40 [@media(hover:hover)]:opacity-0';

function TurnButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} className={TURN_BUTTON} onClick={onClick} disabled={disabled}>{children}</button>;
}

/** The text of a user message edited in place; "Envoyer" restarts the conversation from there. */
function EditMessage({ text, onCancel, onSend, busy }: { text: string; onCancel: () => void; onSend: (t: string) => void; busy: boolean }) {
  const [value, setValue] = useState(text);
  const ok = value.trim().length > 0 && value !== text;
  return (
    <div className="min-w-0 flex-1" data-edit-message>
      <textarea
        aria-label="Modifier le message" autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(8, Math.max(2, value.split('\n').length))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !e.shiftKey && ok && !busy) { e.preventDefault(); onSend(value); }
        }}
        className="w-full resize-y rounded-2xl border border-line bg-sheet px-4 py-2.5 text-sm outline-none focus:border-ink"
      />
      <p className="mt-1 text-[11px] text-ink-faint">La suite de la conversation sera retirée (Annuler pendant 10 s ; « Créer une branche » d’abord pour la garder).</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Annuler</Button>
        <Button onClick={() => onSend(value)} disabled={!ok || busy}>Envoyer</Button>
      </div>
    </div>
  );
}

function DeliveryTurn({ t, clock: at }: { t: Extract<Turn, { kind: 'delegation' }>; clock: string }) {
  const wake = useContext(WakeInfo);
  const summary = wake.summary === undefined ? undefined : t.entry.key === wake.lastKey ? wake.summary : null;
  return <Delivery entry={t.entry} clock={at} footers={t.footers} summary={summary} />;
}

function TurnView({ t, agent, actions }: { t: Turn; agent?: string; actions?: ThreadActions }) {
  const [editing, setEditing] = useState(false);
  const times = useContext(Times);
  if (t.kind === 'delegation') return <DeliveryTurn t={t} clock={clock(t.entry.ts, Boolean(times))} />;
  if (t.kind === 'user' && (t.entry.relaunch || t.entry.wake)) {
    // sent by Intendia's server (goal loop, wake after sub-agents), not by the user: a quiet line, no bubble
    const r = t.entry.relaunch;
    return (
      <div className="flex flex-col items-center gap-1" data-turn="user" {...(r ? { 'data-relaunch': `${r.n}/${r.max}` } : { 'data-wake': '' })} data-key={t.key}>
        <div className="flex items-center gap-2 text-[12px] text-ink-faint" title={t.entry.text}>
          <span className="h-px w-8 bg-line" />
          <span>{r ? `Relance automatique ${r.n}/${r.max}` : 'Reprise automatique · sous-agents terminés'}</span>
          <span className="h-px w-8 bg-line" />
        </div>
        {t.footers.length > 0 && <div className="flex flex-col items-center">{t.footers.map((r) => <RunFooter key={r.runId} r={r} />)}</div>}
      </div>
    );
  }
  if (t.kind === 'user') {
    const editable = Boolean(actions?.canEdit(t.key));
    if (editing && actions) {
      return (
        <div className="flex gap-3" data-turn="user" data-key={t.key}>
          <Avatar name={USER} agent={false} />
          <EditMessage text={t.entry.text} busy={actions.busy} onCancel={() => setEditing(false)} onSend={(v) => { setEditing(false); actions.edit(t.key, v); }} />
        </div>
      );
    }
    // the user's turn on the right, in a bubble; the agent's on the left (reading a conversation at a glance)
    return (
      <div className="group flex justify-end" data-turn="user" data-key={t.key}>
        <div className="flex min-w-0 max-w-[85%] flex-col items-end">
          <div className="flex min-w-0 items-center gap-1.5">
            {editable && <TurnButton label="Modifier le message" onClick={() => setEditing(true)} disabled={actions!.busy}><Pencil className="size-3.5" strokeWidth={1.5} /></TurnButton>}
            {t.entry.steer && <span data-steer className="text-[11.5px] font-medium text-accent-ink" title="Donné à l’agent pendant son travail, après ses outils en cours">Réorientation</span>}
            <Who name={USER} ts={t.entry.ts} seconds={Boolean(times)} />
          </div>
          <div className="mt-1 min-w-0 max-w-full rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5"><UserMessage text={t.entry.text} /></div>
          {t.footers.length > 0 && <div className="mt-1 flex flex-col items-end">{t.footers.map((r) => <RunFooter key={r.runId} r={r} />)}</div>}
        </div>
      </div>
    );
  }
  return (
    <div data-turn="agent" data-key={t.key} className="group rounded-lg">
      <AgentHeader ts={t.ts} name={agent} />
      <div className={cx('mt-1.5 space-y-2.5 text-[15px]', AGENT_INDENT)}>
        {t.parts.map((p) => <PartView key={p.key} p={p} />)}
        {(t.footers.length > 0 || (t.text && !t.streaming) || actions) && (
          <div className="space-y-0.5">
            {t.footers.map((r) => <RunFooter key={r.runId} r={r} />)}
            <div className="flex items-center gap-0.5">
              {t.text && !t.streaming && <CopyReply text={t.text} />}
              {actions && actions.retryTurn === t.key && (
                <TurnButton label="Réessayer" onClick={actions.retry} disabled={actions.busy}><RotateCcw className="size-3.5" strokeWidth={1.5} /></TurnButton>
              )}
              {actions?.canBranch(t.key) && (
                <TurnButton label="Créer une branche" onClick={() => actions.branch(t.key)} disabled={actions.busy}><GitBranch className="size-3.5" strokeWidth={1.5} /></TurnButton>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown at the end of the thread while a run is going on: what the agent is doing, with three moving dots. */
export function ThinkingIndicator({ entries, agent }: { entries: Entry[]; agent?: string }) {
  const t = thinkingState(entries);
  const line = (
    <div role="status" aria-live="polite" data-thinking className={cx('flex items-center gap-2.5 text-sm text-ink-soft', t.inTurn ? AGENT_INDENT : cx('mt-2', AGENT_INDENT))}>
      <span aria-hidden className="thinking-dots"><span /><span /><span /></span>
      <span className="thinking-label">{t.label}</span>
    </div>
  );
  if (t.inTurn) return <div className="mt-3">{line}</div>;
  return <div className="mt-6"><AgentHeader ts={null} name={agent} />{line}</div>;
}

/** The conversation as turns (see toTurns); `footers` = run lines keyed by entry (placeRunStats). */
export function Thread({ entries, footers, agent, actions, times, liveDeliveries = false, subagents, vault }: {
  entries: Entry[]; footers?: Map<string, RunStat[]>; agent?: string; actions?: ThreadActions;
  /** instance and effective profile when the vault can be managed: a browser_vault call without login gets a link */
  vault?: { inst: string; profile: string };
  /** the server's summary (route of the messages); absent = a session Intendia does not wake */
  subagents?: SubagentsSummary | null;
  /** the page re-reads the session while sub-agents work in the background */
  liveDeliveries?: boolean;
  /** « Afficher les heures » (chat/timeline.ts); absent = normal display */
  times?: Map<string, Stamp>;
}) {
  const turns = useMemo(() => toTurns(entries, footers), [entries, footers]);
  const lastKey = useMemo(() => entries.filter((e) => e.kind === 'delegation').at(-1)?.key ?? null, [entries]);
  const wake = useMemo(() => ({ summary: subagents, lastKey }), [subagents, lastKey]);
  return (
    <Times.Provider value={times ?? null}>
      <VaultLink.Provider value={vault ?? null}>
      <LiveDeliveries.Provider value={liveDeliveries}>
      <WakeInfo.Provider value={wake}>
        <div className="space-y-7">
          {turns.map((t) => <TurnView key={t.key} t={t} agent={agent} actions={actions} />)}
        </div>
      </WakeInfo.Provider>
      </LiveDeliveries.Provider>
      </VaultLink.Provider>
    </Times.Provider>
  );
}

const CHOICES: Record<string, { label: string; variant: 'primary' | 'secondary' | 'danger' }> = {
  once: { label: 'Autoriser une fois', variant: 'primary' },
  session: { label: 'Pour cette session', variant: 'secondary' },
  always: { label: 'Toujours', variant: 'secondary' },
  deny: { label: 'Refuser', variant: 'danger' },
};

/** `inline`: without the thread's indent (notifications); `footer`: shown under the choices. */
export function ApprovalCard({ approval, onChoose, busy, inline, footer }: {
  approval: Approval; onChoose: (c: ApprovalChoice) => void; busy: boolean; inline?: boolean; footer?: ReactNode;
}) {
  return (
    <div className={inline ? undefined : AGENT_INDENT}>
      <div className="rounded-xl border border-warn/40 bg-warn-soft/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mark state="readonly" />
          Approbation demandée
        </div>
        {approval.description && <p className="mt-2 text-sm text-ink-soft">{approval.description}</p>}
        {approval.command && (
          <pre className="mt-3 overflow-auto rounded-lg border border-line bg-sheet p-3 font-mono text-xs whitespace-pre-wrap">{approval.command}</pre>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {approval.choices.map((c) => (
            <Button key={c} variant={CHOICES[c]?.variant ?? 'secondary'} disabled={busy} onClick={() => onChoose(c as ApprovalChoice)}>
              {CHOICES[c]?.label ?? c}
            </Button>
          ))}
        </div>
        {footer}
      </div>
    </div>
  );
}
