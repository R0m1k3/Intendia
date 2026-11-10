import { ChevronRight, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ApprovalChoice } from '../api';
import { Button, cx, Mark } from '../components/ui';
import { useFilePaths } from '../files/FilePaths';
import { rehypePaths } from '../files/rehypePaths';
import type { Approval, Entry } from './events';
import { Subagents } from './Subagents';

export function clock(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** One register line: time in the margin, content on the right. */
function Row({ ts, children, className }: { ts: number | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-[44px_minmax(0,1fr)] gap-3 md:grid-cols-[56px_minmax(0,1fr)] md:gap-4', className)}>
      <div className="pt-0.5 text-right font-mono text-[11px] text-ink-faint">{clock(ts)}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
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

function ToolEntry({ e }: { e: Extract<Entry, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const hasResult = Boolean(e.result);
  return (
    <Row ts={e.ts}>
      <button
        type="button"
        onClick={() => hasResult && setOpen(!open)}
        aria-expanded={hasResult ? open : undefined}
        className={cx('flex w-full min-w-0 items-center gap-2.5 rounded-md py-0.5 text-left font-mono text-xs', hasResult && 'hover:text-ink')}
      >
        <Mark state={e.state === 'ok' ? 'full' : e.state === 'failed' ? 'unavailable' : null} />
        <span className="shrink-0 text-ink">{e.tool}</span>
        <span className="min-w-0 truncate text-ink-faint">{e.preview}</span>
        <span className="ml-auto shrink-0 text-ink-faint">
          {e.state === 'running' ? 'en cours' : e.duration !== null ? `${e.duration.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : ''}
        </span>
        {hasResult && <ChevronRight className={cx('size-3.5 shrink-0 text-ink-faint transition-transform duration-150', open && 'rotate-90')} strokeWidth={1.5} />}
      </button>
      {open && e.result && (
        <pre className={cx('mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-sheet p-3 font-mono text-xs whitespace-pre-wrap', e.state === 'failed' && 'text-bad')}>
          {e.result}
        </pre>
      )}
    </Row>
  );
}

function EntryView({ e }: { e: Entry }) {
  switch (e.kind) {
    case 'user':
      return (
        <Row ts={e.ts}>
          <div className="rounded-xl border border-line bg-sheet px-4 py-3 text-sm whitespace-pre-wrap">{e.text}</div>
        </Row>
      );
    case 'assistant':
      return (
        <Row ts={e.ts}>
          <Md text={e.text} />
        </Row>
      );
    case 'reasoning':
      return (
        <Row ts={e.ts}>
          <details className="text-[13px] text-ink-faint">
            <summary className="cursor-pointer select-none">Raisonnement</summary>
            <p className="mt-2 whitespace-pre-wrap">{e.text}</p>
          </details>
        </Row>
      );
    case 'tool':
      return <ToolEntry e={e} />;
    case 'note':
      return (
        <Row ts={e.ts}>
          <p className={cx('text-xs', e.tone === 'bad' ? 'text-bad' : 'text-ink-faint')}>{e.text}</p>
        </Row>
      );
    case 'subagents':
      return (
        <Row ts={e.ts}>
          <Subagents nodes={e.nodes} />
        </Row>
      );
  }
}

/** Groups consecutive tool lines so the register reads as blocks. */
export function Thread({ entries }: { entries: Entry[] }) {
  const blocks: Entry[][] = [];
  for (const e of entries) {
    const last = blocks.at(-1);
    if (last && e.kind === 'tool' && last[0]!.kind === 'tool') last.push(e);
    else blocks.push([e]);
  }
  return (
    <div className="space-y-5">
      {blocks.map((b) => (
        <div key={b[0]!.key} className={b[0]!.kind === 'tool' ? 'space-y-1' : undefined}>
          {b.map((e) => <EntryView key={e.key} e={e} />)}
        </div>
      ))}
    </div>
  );
}

const CHOICES: Record<string, { label: string; variant: 'primary' | 'secondary' | 'danger' }> = {
  once: { label: 'Autoriser une fois', variant: 'primary' },
  session: { label: 'Pour cette session', variant: 'secondary' },
  always: { label: 'Toujours', variant: 'secondary' },
  deny: { label: 'Refuser', variant: 'danger' },
};

export function ApprovalCard({ approval, onChoose, busy }: { approval: Approval; onChoose: (c: ApprovalChoice) => void; busy: boolean }) {
  return (
    <Row ts={null}>
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
      </div>
    </Row>
  );
}
