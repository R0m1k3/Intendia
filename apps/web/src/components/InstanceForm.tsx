import { useState } from 'react';
import { api, type CompatReport, type InstanceInput, type InstancePatch, type PublicInstance } from '../api';
import { Button, ErrorText, Field, Input, moduleLabel, StateMark } from './ui';
import { t } from '../i18n';
import { T } from '../i18n/T';

const EMPTY: InstanceInput = { id: '', label: '', api: 'http://hermes:8642', apiKey: '', dashboard: '', dashboardToken: '', dashboardLink: '' };

function clean(i: InstanceInput): InstanceInput {
  const out: InstanceInput = { ...i, id: i.id.trim(), label: i.label.trim(), api: i.api.trim() };
  for (const k of ['dashboard', 'dashboardToken', 'dashboardLink'] as const) {
    const v = out[k]?.trim();
    if (v) out[k] = v;
    else delete out[k];
  }
  return out;
}

/**
 * Edit mode: only what changed is sent. Secrets are never sent back by the server, so an empty key or token keeps the
 * saved one; a cleared address sends null (removed).
 */
function patchOf(v: InstanceInput, edit: PublicInstance): InstancePatch {
  const p: InstancePatch = {};
  const label = v.label.trim();
  if (label !== edit.label) p.label = label;
  const apiUrl = v.api.trim();
  if (apiUrl && apiUrl !== edit.api) p.api = apiUrl;
  if (v.apiKey.trim()) p.apiKey = v.apiKey.trim();
  for (const k of ['dashboard', 'dashboardLink'] as const) {
    const now = v[k]?.trim() ?? '';
    if (!now && edit[k]) p[k] = null;
    else if (now && now !== edit[k]) p[k] = now;
  }
  if (v.dashboardToken?.trim() && p.dashboard !== null) p.dashboardToken = v.dashboardToken.trim();
  return p;
}

/** Instance form with a "test" step: the report is shown before anything is saved. `edit`: changes a saved instance. */
export function InstanceForm({ onSaved, edit }: { onSaved: (r: CompatReport) => void; edit?: PublicInstance }) {
  const [v, setV] = useState<InstanceInput>(() => edit
    ? { id: edit.id, label: edit.label, api: edit.api, apiKey: '', dashboard: edit.dashboard ?? '', dashboardToken: '', dashboardLink: edit.dashboardLink ?? '' }
    : EMPTY);
  const [report, setReport] = useState<CompatReport | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof InstanceInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.value });
    setReport(null);
  };

  const run = async (kind: 'test' | 'save') => {
    setBusy(kind);
    setError(null);
    try {
      if (edit) {
        const patch = patchOf(v, edit);
        if (kind === 'test') setReport(await api.testInstanceEdit(edit.id, patch));
        else {
          const res = await api.updateInstance(edit.id, patch);
          // name only: no new check, the tested report stands
          onSaved(res.report ?? report!);
        }
      } else if (kind === 'test') setReport(await api.testInstance(clean(v)));
      else onSaved((await api.saveInstance(clean(v))).report);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const keyHelp = t('Laisser vide pour garder la valeur actuelle (obligatoire si l’adresse change)');
  // the server refuses (422) a key Hermes refuses or cannot check; in edit mode only when the API side changes
  const apiChanged = !edit || v.api.trim() !== edit.api || v.apiKey.trim() !== '';
  const canSave = report !== null && (!apiChanged || (report.api.reachable && report.api.auth !== 'refused'));

  return (
    <form className="space-y-6" data-instance-form={edit ? 'edit' : 'add'} onSubmit={(e) => { e.preventDefault(); void run(report ? 'save' : 'test'); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Identifiant')} hint={t('a-z, 0-9 et tiret, par exemple hermes-dev')}>
          <Input value={v.id} onChange={set('id')} required pattern="[a-z0-9][a-z0-9-]{0,39}" placeholder="hermes" readOnly={Boolean(edit)} disabled={Boolean(edit)} />
        </Field>
        <Field label={t('Nom affiché')}>
          <Input value={v.label} onChange={set('label')} required placeholder={t('Hermes principal')} />
        </Field>
        <Field label={t('URL de l’API server')} hint={t('Port 8642, dans le réseau Docker')}>
          <Input value={v.api} onChange={set('api')} required type="url" />
        </Field>
        <Field label={t('Clé de l’API server')} hint={edit ? keyHelp : t('API_SERVER_KEY, 16 caractères minimum')}>
          <Input value={v.apiKey} onChange={set('apiKey')} required={!edit} minLength={16} type="password" autoComplete="off" name="apiKey" />
        </Field>
        <Field label={t('URL du dashboard')} hint={t('Port 9119 ; requis pour les fichiers des workspaces')}>
          <Input value={v.dashboard} onChange={set('dashboard')} type="url" placeholder="http://hermes:9119" />
        </Field>
        <Field label={t('Jeton du dashboard')} hint={edit ? keyHelp : 'HERMES_DASHBOARD_SESSION_TOKEN'}>
          <Input value={v.dashboardToken} onChange={set('dashboardToken')} type="password" autoComplete="off" name="dashboardToken" />
        </Field>
        <Field label={t('Lien public du dashboard')} hint={t('Facultatif : pour les liens « ouvrir dans le dashboard »')}>
          <Input value={v.dashboardLink} onChange={set('dashboardLink')} type="url" />
        </Field>
      </div>

      <ErrorText error={error} />

      {report && (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm">
            <span className="font-medium">Hermes {report.hermesVersion ?? t('version inconnue')}</span>
            <span className="text-ink-faint">
              {t('API {api} · dashboard {dash}', {
                api: report.api.reachable ? t('joignable') : t('injoignable'),
                dash: !report.dash.configured ? t('non configuré') : report.dash.reachable ? t('joignable') : t('injoignable'),
              })}
            </span>
          </div>
          {report.api.auth === 'refused' && (
            <div className="border-b border-line px-4 py-3 text-sm text-bad" data-report-refused="api">{t('Clé de l’API server refusée par Hermes')}</div>
          )}
          {report.dash.auth === 'refused' && (
            <div className="border-b border-line px-4 py-3 text-sm text-bad" data-report-refused="dash">{t('Jeton du dashboard refusé par Hermes')}</div>
          )}
          {report.files && (
            <div className="border-b border-line px-4 py-3 text-sm">
              {report.files.workspaceRoot
                ? <T k="Racine des workspaces : {root}" vars={{ root: <span className="font-mono text-xs">{report.files.workspaceRoot}</span> }} />
                : <span className="text-bad">{report.files.reason}</span>}
            </div>
          )}
          <ul className="divide-y divide-line">
            {report.modules.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div>{moduleLabel(m)}</div>
                  {m.reasons[0] && <div className="truncate text-xs text-ink-faint">{m.reasons[0]}</div>}
                </div>
                <StateMark state={m.state} quiet />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={() => void run('test')} disabled={busy !== null}>
          {busy === 'test' ? t('Test en cours…') : t('Tester la connexion')}
        </Button>
        <Button type="button" variant="primary" onClick={() => void run('save')} disabled={busy !== null || !canSave}>
          {busy === 'save' ? t('Enregistrement…') : t('Enregistrer')}
        </Button>
      </div>
    </form>
  );
}
