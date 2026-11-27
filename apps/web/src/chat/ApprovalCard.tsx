import type { ReactNode } from 'react';
import type { ApprovalChoice } from '../api';
import { Button, Mark } from '../components/ui';
import { t } from '../i18n';
import type { Approval } from './events';

/** Width of the avatar column: the agent's content and its cards line up after it. */
export const AGENT_INDENT = 'pl-10';

const CHOICES: Record<string, { label: string; variant: 'primary' | 'secondary' | 'danger' }> = {
  once: { label: t('Autoriser une fois'), variant: 'primary' },
  session: { label: t('Pour cette session'), variant: 'secondary' },
  always: { label: t('Toujours'), variant: 'secondary' },
  deny: { label: t('Refuser'), variant: 'danger' },
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
          {t('Approbation demandée')}
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
