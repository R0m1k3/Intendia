// What an error means for the user: one clear sentence, what to do next, and the technical text kept apart (folded
// in the interface). The server's own messages are already written for the user; this module rewrites the ones that
// are not (network, Hermes failures, rejected values, internal errors) and adds the next step.
import { ApiError } from '../api';
import { t } from '../i18n';

export interface Explained {
  /** What happened, in plain words. */
  text: string;
  /** What to do next. */
  todo?: string;
  /** A page that helps. */
  link?: { to: '/etat' | '/reglages'; label: string };
  /** Technical text: the original message, the HTTP status, the code. */
  detail?: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const STATUS_LINK = () => ({ to: '/etat' as const, label: t('Ouvrir la page État') });
const SETTINGS_LINK = () => ({ to: '/reglages' as const, label: t('Ouvrir les Réglages') });

/** `champ : raison` of each rejected value (zod issues of a 400). */
function issuesText(issues: unknown): string {
  if (!Array.isArray(issues)) return '';
  return issues.slice(0, 5).map((i) => {
    const path = Array.isArray(obj(i).path) ? (obj(i).path as unknown[]).join('.') : '';
    const message = typeof obj(i).message === 'string' ? (obj(i).message as string) : '';
    return [path, message].filter(Boolean).join(' : ');
  }).filter(Boolean).join(' ; ');
}

export function explain(error: unknown): Explained {
  const message = error instanceof Error && error.message ? error.message : t('Erreur inattendue');
  if (!(error instanceof ApiError)) return { text: message };
  const data = obj(error.data);
  const code = typeof data.code === 'string' ? data.code : null;
  const tech = (extra?: string) => [extra, error.status ? `HTTP ${error.status}` : null, code].filter(Boolean).join(' · ');

  if (code === 'network') {
    return { text: t('Intendia ne répond pas'), todo: t('Vérifiez votre connexion, ou que le serveur Intendia tourne. La page réessaie toute seule.') };
  }
  if (code === 'timeout') return { text: message };
  if ([502, 503, 504].includes(error.status) && error.data == null) {
    return { text: t('Intendia ne répond pas'), todo: t('Le serveur redémarre peut-être : réessayez dans un instant.'), detail: tech() };
  }
  switch (code) {
    case 'hermes_unreachable':
    case 'hermes_timeout':
      return { text: t('Hermes ne répond pas'), todo: t('Vérifiez qu’Hermes est démarré, puis réessayez. La page État montre ce qui répond.'), link: STATUS_LINK(), detail: tech(message) };
    case 'api_key_refused':
    case 'dash_token_refused':
    case 'hermes_unconfigured':
      return { text: message, link: SETTINGS_LINK(), detail: tech() };
    case 'hermes_schema':
      return {
        text: t('Hermes a répondu d’une façon qu’Intendia ne comprend pas'),
        todo: t('Votre version d’Hermes est peut-être trop récente ou trop ancienne pour cette fonction : la page État le dit.'),
        link: STATUS_LINK(), detail: tech(message),
      };
    case 'hermes_error':
      return { text: t('Hermes a renvoyé une erreur'), todo: t('Réessayez. Si cela continue, les journaux d’Hermes (page Coûts et journaux) disent pourquoi.'), detail: tech(message) };
    case 'invalid_body':
      return { text: t('La demande n’a pas pu être lue'), todo: t('Rechargez la page, puis réessayez.'), detail: tech(message) };
    default:
  }
  if (error.status === 400 && Array.isArray(data.issues)) {
    return { text: t('Une valeur envoyée n’est pas acceptée'), todo: t('Corrigez le champ indiqué dans le détail, puis réessayez.'), detail: tech(issuesText(data.issues) || message) };
  }
  if (typeof data.module === 'string' && Array.isArray(data.reasons) && !code) {
    return { text: message, todo: t('Cette fonction dépend de la version d’Hermes : la page État dit ce qui manque.'), link: STATUS_LINK(), detail: tech((data.reasons as unknown[]).filter((r) => typeof r === 'string').join(' ; ')) };
  }
  if (error.status === 500) {
    return { text: t('Intendia a rencontré une erreur'), todo: t('Réessayez. Si cela continue, les journaux du serveur Intendia donnent le détail.'), detail: tech(message) };
  }
  return { text: message, detail: error.status >= 400 && code ? tech() : undefined };
}
