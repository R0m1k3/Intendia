import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type EnvVar } from '../api';
import { Button, cx, ErrorText, Input, Mark, Panel } from '../components/ui';
import { configKey, ICON, useInvalidateConfig, type TabProps } from './common';
import { ask } from '../components/Dialog';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Hermes environment variables: names and "set or not" only, values are never read back. */
export function ConfigEnv({ inst, profile, can, onSaved, focusKey }: TabProps & { focusKey?: string }) {
  const env = useQuery({ queryKey: configKey(inst, profile, 'env'), queryFn: () => api.configEnv(inst, profile).then((r) => r.env) });
  const [q, setQ] = useState(focusKey ?? '');
  const [onlySet, setOnlySet] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [editing, setEditing] = useState<string | null>(focusKey ?? null);

  const list = env.data ?? [];
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = list.filter((v) => {
      if (needle) return v.key.toLowerCase().includes(needle) || (v.description ?? '').toLowerCase().includes(needle);
      if (onlySet && !v.isSet) return false;
      if (!advanced && v.advanced && !v.isSet) return false;
      return true;
    });
    const by = new Map<string, EnvVar[]>();
    for (const v of shown) {
      const g = v.custom ? 'Ajoutées' : (v.category ?? 'Autres');
      by.set(g, [...(by.get(g) ?? []), v]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list, q, onlySet, advanced]);

  if (env.isPending) return <p className="text-sm text-ink-soft">Lecture des variables…</p>;
  if (env.isError) return <ErrorText error={env.error} />;
  const writable = can('putEnv');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
          <Input className="pl-8" placeholder="Chercher une variable" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher une variable" />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} />Définies seulement</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />Afficher les avancées</label>
      </div>
      {writable && <AddVar inst={inst} profile={profile} existing={list.map((v) => v.key)} onSaved={() => onSaved(true)} />}
      <p className="text-xs text-ink-faint">Les valeurs ne sont jamais affichées. Une variable change au prochain démarrage de la passerelle.</p>
      {groups.length === 0 && <p className="text-sm text-ink-soft">Aucune variable.</p>}
      {groups.map(([g, vars]) => (
        <Panel key={g} title={g} bodyClassName="divide-y divide-line">
          {vars.map((v) => (
            <EnvRow key={v.key} v={v} inst={inst} profile={profile} writable={writable && !v.channelManaged}
              open={editing === v.key} onOpen={(o) => setEditing(o ? v.key : null)} onSaved={() => onSaved(true)} />
          ))}
        </Panel>
      ))}
    </div>
  );
}

function EnvRow({ v, inst, profile, writable, open, onOpen, onSaved }: {
  v: EnvVar; inst: string; profile: string; writable: boolean; open: boolean; onOpen: (o: boolean) => void; onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const invalidate = useInvalidateConfig(inst, profile);
  const set = useMutation({
    mutationFn: () => api.setEnv(inst, profile, v.key, value),
    onSuccess: async () => { setValue(''); onOpen(false); await invalidate(); onSaved(); },
  });
  const del = useMutation({
    mutationFn: () => api.deleteEnv(inst, profile, v.key),
    onSuccess: async () => { await invalidate(); onSaved(); },
  });
  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Mark state={v.isSet ? 'full' : 'unavailable'} />
        <div className="min-w-0 flex-1">
          <span className="block break-all font-mono text-[12.5px]">{v.key}</span>
          {v.description && <span className="block text-xs text-ink-faint">{v.description}</span>}
          {v.channelManaged && <span className="block text-xs text-ink-faint">Gérée par la plateforme de messagerie.</span>}
        </div>
        <span className="text-xs text-ink-faint">{v.isSet ? 'définie' : 'non définie'}</span>
        {writable && !open && <Button className="h-8" onClick={() => onOpen(true)}>{v.isSet ? 'Remplacer' : 'Définir'}</Button>}
        {writable && v.isSet && (
          <Button variant="ghost" className="h-8 px-2" aria-label={`Supprimer ${v.key}`} disabled={del.isPending}
            onClick={async () => { if (await ask({ title: `Supprimer ${v.key} ?`, confirmLabel: 'Supprimer', danger: true })) del.mutate(); }}>
            <Trash2 className={ICON} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {open && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (value) set.mutate(); }}>
          <Input autoFocus type={v.isPassword ? 'password' : 'text'} autoComplete="off" className="min-w-64 flex-1 font-mono text-[12.5px]"
            placeholder="Nouvelle valeur" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Valeur de ${v.key}`} />
          <Button variant="primary" type="submit" disabled={!value || set.isPending}>{set.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
          <Button variant="ghost" type="button" onClick={() => { setValue(''); onOpen(false); set.reset(); }}>Annuler</Button>
        </form>
      )}
      <ErrorText error={set.error ?? del.error} />
    </div>
  );
}

function AddVar({ inst, profile, existing, onSaved }: { inst: string; profile: string; existing: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const invalidate = useInvalidateConfig(inst, profile);
  const add = useMutation({
    mutationFn: () => api.setEnv(inst, profile, key.trim(), value),
    onSuccess: async () => { setKey(''); setValue(''); setOpen(false); await invalidate(); onSaved(); },
  });
  const k = key.trim();
  const keyError = k && !KEY_RE.test(k) ? 'Lettres, chiffres et _ ; pas de chiffre en premier.' : k && existing.includes(k) ? 'Existe déjà : utilisez « Remplacer ».' : null;
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className={ICON} strokeWidth={1.5} />Ajouter une variable</Button>;
  return (
    <form className="space-y-2 rounded-xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); if (k && !keyError && value) add.mutate(); }}>
      <div className="flex flex-wrap gap-2">
        <Input className={cx('w-64 font-mono text-[12.5px]', keyError && 'border-bad')} placeholder="NOM_DE_VARIABLE" value={key}
          onChange={(e) => setKey(e.target.value)} aria-label="Nom" />
        <Input type="password" autoComplete="off" className="min-w-64 flex-1 font-mono text-[12.5px]" placeholder="Valeur" value={value}
          onChange={(e) => setValue(e.target.value)} aria-label="Valeur" />
        <Button variant="primary" type="submit" disabled={!k || !!keyError || !value || add.isPending}>Ajouter</Button>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Annuler</Button>
      </div>
      {keyError && <p className="text-xs text-bad">{keyError}</p>}
      <ErrorText error={add.error} />
    </form>
  );
}
