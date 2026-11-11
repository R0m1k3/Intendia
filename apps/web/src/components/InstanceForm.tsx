import { useState } from 'react';
import { api, type CompatReport, type InstanceInput } from '../api';
import { Button, ErrorText, Field, Input, StateMark } from './ui';

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

/** Instance form with a "test" step: the report is shown before anything is saved. */
export function InstanceForm({ onSaved }: { onSaved: (r: CompatReport) => void }) {
  const [v, setV] = useState<InstanceInput>(EMPTY);
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
      if (kind === 'test') setReport(await api.testInstance(clean(v)));
      else onSaved((await api.saveInstance(clean(v))).report);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void run(report ? 'save' : 'test'); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Identifiant" hint="a-z, 0-9 et tiret, par exemple hermes-dev">
          <Input value={v.id} onChange={set('id')} required pattern="[a-z0-9][a-z0-9-]{0,39}" placeholder="hermes" />
        </Field>
        <Field label="Nom affiché">
          <Input value={v.label} onChange={set('label')} required placeholder="Hermes principal" />
        </Field>
        <Field label="URL de l’API server" hint="Port 8642, dans le réseau Docker">
          <Input value={v.api} onChange={set('api')} required type="url" />
        </Field>
        <Field label="Clé de l’API server" hint="API_SERVER_KEY, 16 caractères minimum">
          <Input value={v.apiKey} onChange={set('apiKey')} required minLength={16} type="password" autoComplete="off" />
        </Field>
        <Field label="URL du dashboard" hint="Port 9119 ; requis pour les fichiers des workspaces">
          <Input value={v.dashboard} onChange={set('dashboard')} type="url" placeholder="http://hermes:9119" />
        </Field>
        <Field label="Jeton du dashboard" hint="HERMES_DASHBOARD_SESSION_TOKEN">
          <Input value={v.dashboardToken} onChange={set('dashboardToken')} type="password" autoComplete="off" />
        </Field>
        <Field label="Lien public du dashboard" hint="Facultatif : pour les liens « ouvrir dans le dashboard »">
          <Input value={v.dashboardLink} onChange={set('dashboardLink')} type="url" />
        </Field>
      </div>

      <ErrorText error={error} />

      {report && (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm">
            <span className="font-medium">Hermes {report.hermesVersion ?? 'version inconnue'}</span>
            <span className="text-ink-faint">
              API {report.api.reachable ? 'joignable' : 'injoignable'} · dashboard {!report.dash.configured ? 'non configuré' : report.dash.reachable ? 'joignable' : 'injoignable'}
            </span>
          </div>
          {report.files && (
            <div className="border-b border-line px-4 py-3 text-sm">
              {report.files.workspaceRoot
                ? <>Racine des workspaces : <span className="font-mono text-xs">{report.files.workspaceRoot}</span></>
                : <span className="text-bad">{report.files.reason}</span>}
            </div>
          )}
          <ul className="divide-y divide-line">
            {report.modules.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div>{m.label}</div>
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
          {busy === 'test' ? 'Test en cours…' : 'Tester la connexion'}
        </Button>
        <Button type="button" variant="primary" onClick={() => void run('save')} disabled={busy !== null || !report?.api.reachable}>
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}
