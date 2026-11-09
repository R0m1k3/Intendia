import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Save } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { api } from '../api';
import { Button, ErrorText, Panel } from '../components/ui';
import { CHANGED_TEXT, configKey, errorCode, errorData, ICON, useInvalidateConfig, type TabProps } from './common';
import { DiffView } from './DiffView';

const CodeView = lazy(() => import('../files/CodeView'));

/** Whole config file, secrets shown as «secret:<id>» and put back by the server on save. */
export function ConfigYaml({ inst, profile, can, onSaved }: TabProps) {
  const raw = useQuery({ queryKey: configKey(inst, profile, 'raw'), queryFn: () => api.configRaw(inst, profile) });
  const invalidate = useInvalidateConfig(inst, profile);
  // the editor gets the text it started from (it is recreated on every new value), never the draft
  const [start, setStart] = useState<{ yaml: string; version: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /** Text and version the draft is compared with and saved against (fresh after a 409 reload). */
  const [base, setBase] = useState<{ yaml: string; version: string } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const shown = start ?? raw.data ?? null;
  const against = base ?? shown;
  const save = useMutation({
    mutationFn: () => api.saveConfigRaw(inst, profile, draft!, against!.version),
    onSuccess: async () => {
      setDraft(null); setStart(null); setBase(null); setShowDiff(false); setConflict(false); setSaved(true);
      await invalidate();
      onSaved(true);
    },
    onError: (err) => { if (errorCode(err) === 'config_changed') setConflict(true); },
  });

  if (raw.isPending) return <p className="text-sm text-ink-soft">Lecture du fichier…</p>;
  if (raw.isError || !shown) return <ErrorText error={raw.error} />;

  const dirty = draft !== null && draft !== against!.yaml;
  const writable = can('putRaw');
  const reload = async () => {
    const fresh = await raw.refetch();
    if (fresh.data) setBase(fresh.data);
    setConflict(false);
    setShowDiff(true);
    save.reset();
  };
  const err = save.error ? errorData(save.error) : {};

  return (
    <div className="space-y-4">
      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 p-4 text-sm">
          <span>{CHANGED_TEXT} Votre brouillon est gardé.</span>
          <Button onClick={() => void reload()}><RefreshCw className={ICON} strokeWidth={1.5} />Recharger en gardant mes changements</Button>
        </div>
      )}
      {saved && !dirty && <p className="text-sm text-ok">Enregistré. Le texte affiché est celui qu’Hermes a réécrit.</p>}
      <Panel
        title="Fichier de configuration"
        action={(
          <div className="flex gap-2">
            {dirty && <Button variant="ghost" onClick={() => { setDraft(null); setStart(null); setBase(null); setShowDiff(false); save.reset(); }}>Annuler</Button>}
            <Button disabled={!dirty} onClick={() => setShowDiff((v) => !v)}>{showDiff ? 'Masquer la différence' : 'Voir la différence'}</Button>
            <Button variant="primary" disabled={!dirty || !writable || save.isPending} onClick={() => { setShowDiff(true); save.mutate(); }}>
              <Save className={ICON} strokeWidth={1.5} />{save.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        )}
        bodyClassName="p-0"
      >
        <div className="h-[60vh] min-h-80 overflow-hidden">
          <Suspense fallback={<p className="p-5 text-sm text-ink-soft">Chargement de l’éditeur…</p>}>
            <CodeView key={`${shown.version}`} name="config.yaml" value={shown.yaml} editable={writable}
              onChange={(v) => { if (!start) setStart(shown); setDraft(v); setSaved(false); }} />
          </Suspense>
        </div>
        <p className="border-t border-line px-5 py-2.5 text-xs text-ink-faint">
          Les secrets sont affichés « «secret:…» » : laissez-les tels quels pour garder la valeur, ou remplacez-les. Hermes réécrit le fichier : les commentaires ajoutés ici ne sont pas gardés.
        </p>
      </Panel>
      {save.error && errorCode(save.error) !== 'config_changed' && (
        <div className="text-sm text-bad">
          <ErrorText error={save.error} />
          {typeof err.line === 'number' && <p>Ligne {err.line}{typeof err.column === 'number' ? `, colonne ${err.column}` : ''}</p>}
          {Array.isArray(err.paths) && <p>À corriger : {(err.paths as string[]).join(', ')}</p>}
          {typeof err.path === 'string' && <p>Chemin : {err.path}</p>}
        </div>
      )}
      {showDiff && dirty && <DiffView before={against!.yaml} after={draft!} />}
    </div>
  );
}
