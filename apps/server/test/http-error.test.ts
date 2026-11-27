import { describe, expect, it } from 'vitest';
import { AuthError } from '../src/auth/auth.js';
import { BodyError } from '../src/routes/body.js';
import { CronInputError } from '../src/crons/service.js';
import { ActionBusyError, ScanRefusedError } from '../src/skills/service.js';
import { KanbanError } from '../src/kanban/service.js';
import { AgentConflictError } from '../src/agents/service.js';
import { ConfigConflictError, ConfigInputError, ConfigNotAppliedError, ConfirmRequiredError, PartialWriteError } from '../src/hermes-config/service.js';
import { DeclarativeError, InstanceEditError } from '../src/instances/store.js';
import { NotFoundError, ValidationError } from '../src/workspaces/service.js';
import { CopyError } from '../src/sessions/copy.js';
import { TitleError } from '../src/sessions/title-ai.js';
import { GitError } from '../src/git/service.js';
import { SecretError } from '../src/hermes-config/mask.js';
import { AdminError } from '../src/admin-error.js';
import { ArchiveError } from '../src/files/archive.js';
import { WorkspaceFsError } from '../src/workspaces/fs.js';
import { HttpError } from '../src/http-error.js';
import { fakeInstance, testApp } from './helpers.js';

// The expected answers are written by hand from the `app.onError` of before the refactoring.
const answer = (e: HttpError) => ({ status: e.status, json: { ...e.body(), error: e.message } });
const scan = { verdict: 'block' } as never;

describe('HttpError: the answer of each error class', () => {
  const cases: [string, HttpError, number, Record<string, unknown>][] = [
    ['AuthError', new AuthError(429, 'm'), 429, { error: 'm' }],
    ['BodyError', new BodyError(), 400, { error: 'Corps illisible', code: 'invalid_body' }],
    ['CronInputError', new CronInputError('m', 'schedule', 'd'), 400, { error: 'm', field: 'schedule', detail: 'd' }],
    ['CronInputError null', new CronInputError('m', null, 'd'), 400, { error: 'm', field: null, detail: 'd' }],
    ['ScanRefusedError', new ScanRefusedError('m', scan), 409, { error: 'm', code: 'scan_refused', scan }],
    ['ActionBusyError', new ActionBusyError('act'), 409, { error: 'Une action identique est en cours', code: 'busy', action: 'act' }],
    ['KanbanError', new KanbanError('board_exists', 'm'), 409, { error: 'm', code: 'board_exists' }],
    ['KanbanError 422', new KanbanError('mission_state', 'm', 422), 422, { error: 'm', code: 'mission_state' }],
    ['AgentConflictError', new AgentConflictError('m'), 409, { error: 'm', code: 'agent_exists' }],
    ['ConfigInputError', new ConfigInputError('c', 'm'), 400, { error: 'm', code: 'c' }],
    ['ConfigInputError extra', new ConfigInputError('c', 'm', { a: 1, error: 'x', code: 'y' }), 400, { a: 1, error: 'm', code: 'c' }],
    ['ConfigConflictError', new ConfigConflictError('exists', 'm'), 409, { error: 'm', code: 'exists' }],
    ['ConfigNotAppliedError', new ConfigNotAppliedError(), 409, { error: 'Hermes a répondu OK mais n’a pas appliqué ce changement. Causes possibles : Hermes installé par un gestionnaire de paquets (Nix), réglage fixé par un administrateur, ou valeur égale à la valeur par défaut (Hermes la retire du fichier).', code: 'not_applied' }],
    ['ConfigNotAppliedError paths', new ConfigNotAppliedError(['a.b']), 409, { error: 'Hermes a répondu OK mais n’a pas appliqué ce changement. Causes possibles : Hermes installé par un gestionnaire de paquets (Nix), réglage fixé par un administrateur, ou valeur égale à la valeur par défaut (Hermes la retire du fichier).', code: 'not_applied', paths: ['a.b'] }],
    ['ConfirmRequiredError', new ConfirmRequiredError('p'), 409, { error: 'Confirmation demandée par Hermes', code: 'confirm_required', message: 'p' }],
    ['ConfirmRequiredError task', new ConfirmRequiredError('p', 't'), 409, { error: 'Confirmation demandée par Hermes', code: 'confirm_required', message: 'p', task: 't' }],
    ['PartialWriteError', new PartialWriteError('m'), 502, { error: 'm', code: 'partial_write' }],
    ['DeclarativeError', new DeclarativeError(), 409, { error: 'Instances déclarées par INTENDIA_INSTANCES : modifiez-les dans la configuration du conteneur', code: 'declarative' }],
    ['InstanceEditError', new InstanceEditError('m', 'apiKey'), 400, { error: 'm', code: 'secret_required', field: 'apiKey' }],
    ['ValidationError', new ValidationError('m'), 400, { error: 'm' }],
    ['NotFoundError', new NotFoundError('m'), 404, { error: 'm' }],
    ['CopyError', new CopyError('busy', 'm', 503), 503, { error: 'm', code: 'busy' }],
    ['TitleError', new TitleError('no_model', 'm', 502), 502, { error: 'm', code: 'no_model' }],
    ['GitError sensitive', new GitError('sensitive', 'm'), 403, { error: 'm', code: 'sensitive' }],
    ['GitError empty', new GitError('empty', 'm'), 502, { error: 'm', code: 'empty' }],
    ['GitError no_model', new GitError('no_model', 'm'), 503, { error: 'm', code: 'no_model' }],
    ['GitError busy', new GitError('busy', 'm'), 409, { error: 'm', code: 'busy' }],
    ['SecretError', new SecretError('invalid_yaml', 'm'), 400, { error: 'm', code: 'invalid_yaml' }],
    ['SecretError extra', new SecretError('secret_moved', 'm', { ids: ['a'], code: 'z' }), 400, { ids: ['a'], error: 'm', code: 'secret_moved' }],
    ['AdminError 409', new AdminError('busy', 'm', { k: 1 }), 409, { k: 1, error: 'm', code: 'busy' }],
    ['AdminError 400', new AdminError('over_budget', 'm'), 400, { error: 'm', code: 'over_budget' }],
    ['AdminError extra wins not', new AdminError('refused', 'm', { error: 'x', code: 'y' }), 409, { error: 'm', code: 'refused' }],
    ['ArchiveError invalid', new ArchiveError('invalid', 'm'), 400, { error: 'm', code: 'invalid_archive' }],
    ['ArchiveError too_big', new ArchiveError('too_big', 'm'), 413, { error: 'm', code: 'too_big' }],
    ['ArchiveError busy', new ArchiveError('busy', 'm'), 409, { error: 'm', code: 'busy' }],
    ['WorkspaceFsError no_root', new WorkspaceFsError('no_root', 'm'), 422, { error: 'm', code: 'no_root' }],
    ['WorkspaceFsError unreachable', new WorkspaceFsError('unreachable', 'm'), 502, { error: 'm', code: 'unreachable' }],
    ['WorkspaceFsError too_large', new WorkspaceFsError('too_large', 'm'), 413, { error: 'm', code: 'too_large' }],
    ['WorkspaceFsError outside', new WorkspaceFsError('outside', 'm'), 403, { error: 'm', code: 'outside' }],
    ['WorkspaceFsError not_found', new WorkspaceFsError('not_found', 'm'), 404, { error: 'm', code: 'not_found' }],
    ['WorkspaceFsError exists', new WorkspaceFsError('exists', 'm'), 409, { error: 'm', code: 'exists' }],
  ];
  it.each(cases)('%s', (_name, err, status, json) => {
    expect(err).toBeInstanceOf(HttpError);
    expect(answer(err)).toEqual({ status, json });
  });
});

describe('HttpError: through the app', () => {
  it('a declared instance cannot be created: 409 declarative', async () => {
    const t = await testApp();
    const r = await t.request('POST', '/x/instances', fakeInstance({ id: 'other', label: 'Other' }));
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'Instances déclarées par INTENDIA_INSTANCES : modifiez-les dans la configuration du conteneur', code: 'declarative' });
  });

  it('a body that is not JSON: 400 invalid_body', async () => {
    const t = await testApp();
    const res = await t.rawRequest('POST', '/x/instances/test', { body: '{nope', headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Corps illisible', code: 'invalid_body' });
  });
});
