import { Check, Copy, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { DelegationInfo, ModuleState, RunStat } from '../api';
import { Button, copyText, Mark } from '../components/ui';
import type { Entry } from './events';
import { RunFooter } from './RunFooter';

function markOfDelivery(info: DelegationInfo): ModuleState {
  if (info.failedTask !== null || info.allFailed || (info.tasks !== null && info.tasks > 0 && info.failed === info.tasks)) return 'unavailable';
  return info.failed ? 'readonly' : 'full';
}

/**
 * Result of background sub-agents (Hermes' delivery row): a full-width line, folded, with Hermes' text as is.
 * Not a message of the user: no action on it; the agent reads it with the next message.
 */
export function Delivery({ entry, clock, footers }: { entry: Extract<Entry, { kind: 'delegation' }>; clock: string; footers: RunStat[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-raised/40 px-3 py-2.5" data-turn="delegation" data-key={entry.key}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <GitBranch className="size-3.5 text-ink-faint" strokeWidth={1.5} />
        <Mark state={markOfDelivery(entry.info)} />
        <span className="font-medium" data-delivery-summary>{entry.summary}</span>
        {clock && <span className="text-xs text-ink-faint">{clock}</span>}
        <span className="flex-1" />
        <Button variant="ghost" className="h-7" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Masquer' : 'Voir le résultat'}</Button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sheet p-3 font-mono text-[12px] text-ink-soft" data-delivery-text>{entry.text}</pre>
          <Button variant="ghost" className="h-7" onClick={() => void copyText(entry.text, 'Texte').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
            {copied ? <Check className="size-3.5" strokeWidth={1.5} /> : <Copy className="size-3.5" strokeWidth={1.5} />}Copier le texte
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-ink-faint">L’agent en tiendra compte à votre prochain message.</p>
      {footers.length > 0 && <div className="mt-1">{footers.map((r) => <RunFooter key={r.runId} r={r} />)}</div>}
    </div>
  );
}
