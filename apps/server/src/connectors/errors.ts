/**
 * Answer of the web API for a HermesError that no service translated (onError of app.ts): a stable `code`, a French
 * message for the user (translated on the way out like every `msg()`), Hermes' status and its masked `detail`.
 * Never 401: in the web, 401 means the Intendia session expired.
 */
import type { HermesError } from '../hermes/http.js';
import { msg } from '../i18n/index.js';
import { hermesDetail } from './runtime.js';
import type { OpCode } from './types.js';

export type HermesErrorStatus = 409 | 422 | 502 | 503 | 504;

/** Messages of the codes an op of the report can carry (ModuleUnavailableError.code). */
export const CODE_MESSAGE: Record<OpCode, string> = {
  hermes_unreachable: msg('Hermes ne répond pas : réessayez dans un instant'),
  dash_token_refused: msg('Le dashboard d’Hermes refuse le jeton de cette instance : mettez-le à jour dans Réglages › Instances › Modifier'),
  api_key_refused: msg('L’API server d’Hermes refuse la clé de cette instance : mettez-la à jour dans Réglages › Instances › Modifier'),
};

const DETAIL_MAX = 300;
const DEFAULT_RETRY_S = 5;

/** Seconds of a Retry-After header (seconds or an HTTP date), else the default. */
function retrySeconds(value: string | undefined): number {
  if (!value) return DEFAULT_RETRY_S;
  if (/^\d+$/.test(value.trim())) return Math.max(1, Number(value.trim()));
  const at = Date.parse(value);
  return Number.isNaN(at) ? DEFAULT_RETRY_S : Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

/** Codes whose message says what to do: they replace the message of a service's own HermesError too. */
const ACTION_CODES = new Set(['dash_token_refused', 'api_key_refused', 'hermes_busy']);

/**
 * A raw error (made by HermesHttp / callOp) gets the message of the table and Hermes' masked detail; the HermesError
 * of a service keeps its own message (already written, and masked, for the user) with the code and status of the table.
 */
export function hermesErrorResponse(err: HermesError, mask: (text: string) => string): {
  status: HermesErrorStatus; body: Record<string, unknown>; headers?: Record<string, string>;
} {
  const status = err.detail.status;
  const source = err.raw && err.kind === 'http' ? hermesDetail(err).trim() : '';
  const detail = source ? mask(source).slice(0, DETAIL_MAX) : '';
  const via = err.detail.via === 'dash' ? 'dashboard' : 'API server';
  const shown = detail || msg('sans détail');
  const out = (code: string, error: string, http: HermesErrorStatus, headers?: Record<string, string>) => ({
    status: http,
    body: {
      error: err.raw || ACTION_CODES.has(code) ? error : err.message,
      code, hermesStatus: status ?? null, ...(detail ? { hermesDetail: detail } : {}),
    },
    ...(headers ? { headers } : {}),
  });
  switch (err.kind) {
    case 'unconfigured': return out('hermes_unconfigured', err.message, 422);
    case 'network': return out('hermes_unreachable', msg('Hermes ne répond pas ({via}) : réessayez dans un instant', { via }), 504);
    case 'timeout': return out('hermes_timeout', msg('Hermes n’a pas répondu à temps ({via})', { via }), 504);
    case 'schema': return out('hermes_schema', msg('Réponse inattendue d’Hermes'), 502);
    case 'http':
      // 401 only: Hermes 0.23 answers a wrong key or token with 401; its 403s are about the request (path outside the
      // files root, profile mismatch...)
      if (status === 401) {
        return err.detail.via === 'dash'
          ? out('dash_token_refused', CODE_MESSAGE.dash_token_refused, 502)
          : out('api_key_refused', CODE_MESSAGE.api_key_refused, 502);
      }
      if (status === 409) return out('hermes_conflict', msg('Hermes refuse pour l’instant : {detail}', { detail: shown }), 409);
      if (status === 429) {
        const seconds = retrySeconds(err.detail.retryAfter);
        return out('hermes_busy', msg('Hermes est occupé : réessayez dans {seconds} s', { seconds }), 503, { 'Retry-After': String(seconds) });
      }
      return out('hermes_error', msg('Erreur d’Hermes (HTTP {status}) : {detail}', { status: status ?? '?', detail: shown }), 502);
  }
}
