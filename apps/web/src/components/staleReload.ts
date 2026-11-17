import { errorCode } from '../config/common';
import { t } from '../i18n';
import { ask } from './Dialog';
import { copyText } from './ui';

/** 409 `stale`: the text changed in Hermes (agent, CLI, another tab) since the editor opened it. */
export function isStale(err: unknown): boolean {
  return errorCode(err) === 'stale';
}

/**
 * Asks whether to reload the current version; on yes the draft is copied first (or shown to be copied when the
 * clipboard is refused, plain http). True = the caller reloads and drops its draft.
 */
export async function askReload(draft: string | null): Promise<boolean> {
  const yes = await ask({
    title: t('Modifié ailleurs'),
    message: t('Ce texte a changé dans Hermes depuis que vous l’avez ouvert. Recharger la version actuelle ? Votre brouillon sera copié dans le presse-papiers, ou affiché pour que vous le copiiez.'),
    confirmLabel: t('Recharger'),
  });
  if (!yes) return false;
  if (draft !== null) await copyText(draft, t('Votre brouillon'));
  return true;
}
