import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { explain } from './explain';

describe('explain', () => {
  it('keeps a message already written for the user', () => {
    expect(explain(new ApiError(409, 'Un run est déjà en cours', { error: 'Un run est déjà en cours', code: 'run_active' })))
      .toEqual({ text: 'Un run est déjà en cours', detail: 'HTTP 409 · run_active' });
    expect(explain(new Error('Fichier trop gros'))).toEqual({ text: 'Fichier trop gros' });
    expect(explain(null).text).toBe('Erreur inattendue');
  });
  it('says what to do when Intendia or Hermes does not answer', () => {
    const net = explain(new ApiError(0, 'Serveur Intendia injoignable', { code: 'network' }));
    expect(net.text).toBe('Intendia ne répond pas');
    expect(net.todo).toContain('réessaie toute seule');
    expect(explain(new ApiError(502, 'Réponse inattendue du serveur Intendia (HTTP 502)', null)).detail).toBe('HTTP 502');
    const h = explain(new ApiError(504, 'Hermes ne répond pas (dashboard) : réessayez dans un instant', { code: 'hermes_unreachable' }));
    expect(h).toMatchObject({ text: 'Hermes ne répond pas', link: { to: '/etat' } });
    expect(h.detail).toBe('Hermes ne répond pas (dashboard) : réessayez dans un instant · HTTP 504 · hermes_unreachable');
  });
  it('sends to the settings when the key or the token is refused', () => {
    const e = explain(new ApiError(502, 'L’API server d’Hermes refuse la clé de cette instance', { code: 'api_key_refused' }));
    expect(e.text).toBe('L’API server d’Hermes refuse la clé de cette instance');
    expect(e.link?.to).toBe('/reglages');
  });
  it('folds the raw text of Hermes and of internal errors', () => {
    const h = explain(new ApiError(502, 'Erreur d’Hermes (HTTP 500) : {"detail":"boom"}', { code: 'hermes_error', hermesStatus: 500 }));
    expect(h.text).toBe('Hermes a renvoyé une erreur');
    expect(h.detail).toContain('{"detail":"boom"}');
    const i = explain(new ApiError(500, 'Erreur interne du serveur Intendia (voir ses journaux)', { error: 'x' }));
    expect(i.text).toBe('Intendia a rencontré une erreur');
    expect(i.detail).not.toContain('Référence');
    const r = explain(new ApiError(500, 'Erreur interne du serveur Intendia (voir ses journaux)', { error: 'x', requestId: 'ab12cd34ef56' }));
    expect(r.detail).toContain('Référence : ab12cd34ef56');
    expect(r.todo).toContain('cherchez la référence');
    // only an identifier of ours is shown, never a text that came in its place
    expect(explain(new ApiError(500, 'x', { requestId: '<b>not an id</b>' })).detail).not.toContain('Référence');
  });
  it('names the rejected field of an invalid request', () => {
    const e = explain(new ApiError(400, 'Requête invalide', { error: 'Requête invalide', issues: [{ path: ['name'], message: 'Too small' }, { path: ['schedule', 'minutes'], message: 'Expected number' }] }));
    expect(e.text).toBe('Une valeur envoyée n’est pas acceptée');
    expect(e.detail).toBe('name : Too small ; schedule.minutes : Expected number · HTTP 400');
  });
  it('points to the status page when a function is closed for this Hermes', () => {
    const e = explain(new ApiError(409, 'Tâches indisponibles sur cette instance', { module: 'kanban', op: 'list', reasons: ['dashboard GET /api/kanban : absente'] }));
    expect(e).toMatchObject({ text: 'Tâches indisponibles sur cette instance', link: { to: '/etat' } });
    expect(e.detail).toBe('dashboard GET /api/kanban : absente · HTTP 409');
  });
});
