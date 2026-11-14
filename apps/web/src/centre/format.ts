// Centre: texts of the finished runs.
import { formatDuration } from '../chat/format';
import { t } from '../i18n';

export type FinishedTone = 'good' | 'bad' | 'neutral';

const FINISHED: Record<string, { text: string; tone: FinishedTone }> = {
  completed: { text: t('terminé'), tone: 'good' },
  failed: { text: t('échoué'), tone: 'bad' },
  error: { text: t('échoué'), tone: 'bad' },
  cancelled: { text: t('arrêté'), tone: 'neutral' },
  interrupted: { text: t('arrêté'), tone: 'neutral' },
  unknown: { text: t('inconnu'), tone: 'neutral' },
};

/** Hermes' final status of a run → French word and colour; an unknown word is shown as is. */
export function finishedStatus(status: string): { text: string; tone: FinishedTone } {
  return FINISHED[status] ?? { text: status, tone: 'neutral' };
}

/** Run length, empty when the times are missing or reversed. */
export function runLength(startedAt: number, endedAt: number): string {
  return endedAt >= startedAt && startedAt > 0 ? formatDuration(endedAt - startedAt) : '';
}

/** Message of a steer Hermes refused (409): the run is not running any more, or waits for an answer. */
export const STEER_REFUSED = t('Le run n’accepte pas de consigne maintenant');
