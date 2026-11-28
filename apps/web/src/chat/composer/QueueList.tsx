// The messages waiting in the composer for the end of the run: reorder, edit, send now, remove, resume.
import { ArrowDown, ArrowUp, Pencil, X } from 'lucide-react';
import { askText } from '../../components/Dialog';
import { t } from '../../i18n';
import type { Composer } from '../Composer';

export function QueueList({ queue, running }: { queue: NonNullable<Parameters<typeof Composer>[0]['queue']>; running: boolean }) {
  return (
      <div className="px-1 pb-1.5 pt-1" data-queue>
        <ul className="flex flex-col gap-1" aria-label={t('Messages en attente')}>
          {queue.items.map((q, i) => {
            const short = q.text.slice(0, 40);
            const blocked = queue.sendNowBlocked?.(q) ?? null;
            const small = 'flex size-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-sheet hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';
            return (
              <li key={q.id} data-queued className="group flex min-w-0 items-center gap-1 rounded-lg border border-line bg-raised py-0.5 pl-2.5 pr-1 text-xs">
                <span className="font-mono text-ink-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={q.text}>{q.text}</span>
                {queue.onMove && (
                  <>
                    <button type="button" disabled={i === 0} onClick={() => queue.onMove!(q.id, -1)} aria-label={t('Monter « {text} »', { text: short })} className={small}>
                      <ArrowUp className="size-3.5" strokeWidth={1.75} />
                    </button>
                    <button type="button" disabled={i === queue.items.length - 1} onClick={() => queue.onMove!(q.id, 1)} aria-label={t('Descendre « {text} »', { text: short })} className={small}>
                      <ArrowDown className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </>
                )}
                {queue.onEdit && (
                  <button type="button" aria-label={t('Modifier « {text} »', { text: short })} className={small}
                    onClick={() => void askText({ title: t('Modifier le message en attente'), value: q.text, confirmLabel: t('Enregistrer'), multiline: true }).then((v) => { if (v !== null) queue.onEdit!(q.id, v); })}>
                    <Pencil className="size-3.5" strokeWidth={1.5} />
                  </button>
                )}
                {queue.onSendNow && (
                  <button type="button" disabled={blocked !== null} title={blocked ?? undefined} onClick={() => queue.onSendNow!(q.id)} data-send-now
                    className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent-ink hover:bg-sheet disabled:text-ink-faint disabled:hover:bg-transparent">
                    {t('Envoyer maintenant')}
                  </button>
                )}
                <button type="button" onClick={() => queue.onRemove(q.id)} aria-label={t('Retirer « {text} » de la file', { text: short })} className={small}>
                  <X className="size-3" strokeWidth={2} />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-[11px] text-ink-faint">
          {queue.paused ? (
            <>
              {t('En pause : {why}', { why: queue.paused })} ·{' '}
              <button type="button" onClick={queue.onResume} className="font-medium text-accent-ink hover:underline">{t('Reprendre')}</button>
            </>
          ) : running ? t('Envoyé à la fin du travail en cours, un message à la fois') : (
            <button type="button" onClick={queue.onResume} className="font-medium text-accent-ink hover:underline">{t('Envoyer le suivant')}</button>
          )}
        </p>
      </div>
  );
}
