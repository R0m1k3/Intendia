import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { PageHeader } from '../components/Layout';
import { Button, ErrorText, Panel } from '../components/ui';

type Theme = 'system' | 'light' | 'dark';
function applyTheme(t: Theme) {
  document.documentElement.classList.remove('light', 'dark');
  if (t !== 'system') document.documentElement.classList.add(t);
  localStorage.setItem('intendia-theme', t);
}

export function SettingsPage() {
  const qc = useQueryClient();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const [adding, setAdding] = useState(false);
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('intendia-theme') as Theme) ?? 'system');
  const remove = useMutation({
    mutationFn: api.removeInstance,
    onSuccess: () => qc.invalidateQueries(),
  });
  const declarative = instances.data?.declarative;

  return (
    <>
      <PageHeader title="Réglages" subtitle="Instances Hermes et préférences d’affichage." />
      <div className="space-y-4 px-5 pb-10 md:px-8">
        <Panel
          title="Instances"
          action={!declarative && !adding && <Button onClick={() => setAdding(true)}>Ajouter</Button>}
        >
          {declarative && (
            <p className="mb-3 text-sm text-ink-soft">
              Instances déclarées par <code className="font-mono text-xs">INTENDIA_INSTANCES</code> : modifiez la configuration du conteneur pour les changer.
            </p>
          )}
          <ErrorText error={remove.error} />
          <ul className="divide-y divide-line">
            {instances.data?.instances.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{i.label} <span className="ml-1 font-mono text-xs font-normal text-ink-faint">{i.id}</span></div>
                  <div className="truncate font-mono text-xs text-ink-soft">{i.api}{i.dashboard ? ` · ${i.dashboard}` : ' · sans dashboard'} · {i.mount}</div>
                </div>
                {!declarative && (
                  <Button
                    variant="danger"
                    onClick={() => { if (confirm(`Retirer l’instance « ${i.label} » d’Intendia ? Hermes n’est pas modifié.`)) remove.mutate(i.id); }}
                  >
                    Retirer
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {adding && (
            <div className="mt-4 border-t border-line pt-4">
              <InstanceForm onSaved={async () => { setAdding(false); await qc.invalidateQueries(); }} />
              <Button variant="ghost" className="mt-2" onClick={() => setAdding(false)}>Annuler</Button>
            </div>
          )}
        </Panel>
        <Panel title="Thème">
          <div className="flex gap-2">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Button key={t} variant={theme === t ? 'primary' : 'secondary'} onClick={() => { setTheme(t); applyTheme(t); }}>
                {t === 'system' ? 'Système' : t === 'light' ? 'Clair' : 'Sombre'}
              </Button>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
