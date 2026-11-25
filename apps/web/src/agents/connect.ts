import type { QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { ask } from '../components/Dialog';
import { t } from '../i18n';

/**
 * "Connecter à Intendia": the server writes a new API server key in the agent's profile and keeps it. When the
 * profile already has its own key, asks before replacing it. Resolves false when the user cancels.
 */
export async function connectAgent(qc: QueryClient, inst: string, name: string): Promise<{ verified: boolean } | null> {
  let res;
  try {
    res = await api.connectAgent(inst, name);
  } catch (err) {
    if (!(err instanceof ApiError && (err.data as { code?: string } | undefined)?.code === 'key_exists')) throw err;
    const ok = await ask({
      title: t('Remplacer la clé de {name} ?', { name }),
      message: t('Cet agent a déjà sa propre clé API server. Intendia la remplace par une nouvelle : les autres clients qui utilisent l’ancienne ne pourront plus lui parler.'),
      confirmLabel: t('Remplacer la clé'), danger: true,
    });
    if (!ok) return null;
    res = await api.connectAgent(inst, name, true);
  }
  await Promise.all([['agents', inst], ['agent', inst, name], ['profiles', inst], ['instances']].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return { verified: res.verified };
}
