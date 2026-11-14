import { Check, Copy, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { DelegationInfo, ModuleState, RunStat, SubagentsSummary } from '../api';
import { Button, copyText, Mark } from '../components/ui';
import { t } from '../i18n';
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
/**
 * What happens next, from the server's summary (route of the messages), on the last delivery only. Undefined: a
 * session Intendia does not wake (external): the agent reads it with the next message.
 */
export function deliveryNote(summary: SubagentsSummary | null | undefined): string | null {
  if (summary === undefined) return t('L’agent en tiendra compte à votre prochain message.');
  if (!summary) return null;
  if (summary.capped) return t('Reprise automatique arrêtée après 5 reprises : écrivez pour continuer.');
  if (summary.wakePending) return t('L’agent reprend son travail.');
  if (summary.openTasks > 0) return t('L’agent reprendra quand les autres sous-agents auront fini.');
  return null;
}

export function Delivery({ entry, clock, footers, summary }: {
  entry: Extract<Entry, { kind: 'delegation' }>; clock: string; footers: RunStat[]; summary?: SubagentsSummary | null;
}) {
  const note = deliveryNote(summary);
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
        <Button variant="ghost" className="h-7" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t('Masquer') : t('Voir le résultat')}</Button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sheet p-3 font-mono text-[12px] text-ink-soft" data-delivery-text>{entry.text}</pre>
          <Button variant="ghost" className="h-7" onClick={() => void copyText(entry.text, t('Texte')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
            {copied ? <Check className="size-3.5" strokeWidth={1.5} /> : <Copy className="size-3.5" strokeWidth={1.5} />}{t('Copier le texte')}
          </Button>
        </div>
      )}
      {note && <p className="mt-1 text-xs text-ink-faint" data-delivery-note>{note}</p>}
      {footers.length > 0 && <div className="mt-1">{footers.map((r) => <RunFooter key={r.runId} r={r} />)}</div>}
    </div>
  );
}
