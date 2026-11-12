// Centre: texts of the finished runs.
import { formatDuration } from '../chat/format';

export type FinishedTone = 'good' | 'bad' | 'neutral';

const FINISHED: Record<string, { text: string; tone: FinishedTone }> = {
  completed: { text: 'terminé', tone: 'good' },
  failed: { text: 'échoué', tone: 'bad' },
  error: { text: 'échoué', tone: 'bad' },
  cancelled: { text: 'arrêté', tone: 'neutral' },
  interrupted: { text: 'arrêté', tone: 'neutral' },
  unknown: { text: 'inconnu', tone: 'neutral' },
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
export const STEER_REFUSED = 'Le run n’accepte pas de consigne maintenant';
