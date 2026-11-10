import { useMutation, useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { Button, cx, ErrorText, Panel, timeAgo } from '../components/ui';
import { CHANGED_TEXT, configKey, errorCode, ICON, useInvalidateConfig, type TabProps } from './common';
import { DiffView } from './DiffView';

const SOURCE: Record<string, string> = {
  form: 'Formulaire', yaml: 'Éditeur YAML', restore: 'Restauration', model: 'Modèle', env: 'Variable', mcp: 'Serveur MCP',
};

/** Copies taken by Intendia before each write; restoring sends the whole copied file. */
export function ConfigHistory({ inst, profile, can, onSaved }: TabProps) {
  const versions = useQuery({ queryKey: configKey(inst, profile, 'versions'), queryFn: () => api.configVersions(inst, profile).then((r) => r.versions) });
  const current = useQuery({ queryKey: configKey(inst, profile, 'raw'), queryFn: () => api.configRaw(inst, profile) });
  const [selected, setSelected] = useState<number | null>(null);
  const copy = useQuery({
    queryKey: [...configKey(inst, profile, 'version'), selected],
    queryFn: () => api.configVersion(inst, profile, selected!), enabled: selected !== null,
  });
  const invalidate = useInvalidateConfig(inst, profile);
  const restore = useMutation({
    mutationFn: () => api.restoreConfig(inst, profile, selected!, current.data!.version),
    onSuccess: async () => { setSelected(null); await invalidate(); onSaved(true); },
    onError: async (err) => { if (errorCode(err) === 'config_changed') await current.refetch(); },
  });

  if (versions.isPending) return <p className="text-sm text-ink-soft">Lecture de l’historique…</p>;
  if (versions.isError) return <ErrorText error={versions.error} />;
  const list = versions.data ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Panel title="Copies" bodyClassName="divide-y divide-line">
        {list.length === 0 && <p className="p-5 text-sm text-ink-soft">Aucune copie : Intendia en garde une avant chaque enregistrement (dix au plus).</p>}
        {list.map((v) => (
          <button key={v.id} type="button" disabled={!v.readable} onClick={() => { setSelected(v.id); restore.reset(); }}
            className={cx('flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm transition-colors disabled:opacity-50',
              selected === v.id ? 'bg-raised' : 'hover:bg-raised/60')}>
            <span>
              <span className="block">{new Date(v.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}</span>
              <span className="block text-xs text-ink-faint">{v.readable ? `avant : ${SOURCE[v.source] ?? v.source}` : 'illisible (secret d’Intendia changé)'}</span>
            </span>
            <span className="text-xs text-ink-faint">{timeAgo(v.createdAt)}</span>
          </button>
        ))}
      </Panel>
      <div className="space-y-3">
        {selected === null && <p className="text-sm text-ink-soft">Choisissez une copie pour voir ce que sa restauration changerait.</p>}
        {selected !== null && (copy.isPending || current.isPending) && <p className="text-sm text-ink-soft">Lecture…</p>}
        {selected !== null && copy.data && current.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">Lignes retirées (−) et remises (+) par la restauration :</p>
              <Button variant="primary" disabled={!can('putRaw') || restore.isPending}
                onClick={() => { if (confirm('Restaurer cette copie ? Le fichier actuel sera copié dans l’historique avant.')) restore.mutate(); }}>
                <RotateCcw className={ICON} strokeWidth={1.5} />{restore.isPending ? 'Restauration…' : 'Restaurer'}
              </Button>
            </div>
            {restore.error && <p className="text-sm text-bad">{errorCode(restore.error) === 'config_changed' ? `${CHANGED_TEXT} La différence est à jour : relancez la restauration.` : <ErrorText error={restore.error} />}</p>}
            <DiffView before={current.data.yaml} after={copy.data.yaml} empty="Cette copie est identique au fichier actuel." />
          </>
        )}
        {copy.isError && <ErrorText error={copy.error} />}
      </div>
    </div>
  );
}
