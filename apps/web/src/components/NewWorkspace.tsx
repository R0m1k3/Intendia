import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useCurrentInstance } from '../instance/current';
import { Button, ErrorText, Field, Input } from './ui';

export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

/** `instanceId` (first-run step): that instance instead of the sidebar's; `onCreated` replaces the navigation. */
export function NewWorkspace({ onCancel, instanceId, onCreated }: { onCancel?: () => void; instanceId?: string; onCreated?: (slug: string) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // created on the current instance (the sidebar's choice)
  const { id: currentId, instance: currentInst, instances: list } = useCurrentInstance();
  const inst = instanceId ?? currentId ?? '';
  const current = instanceId ? list.find((i) => i.id === instanceId) ?? null : currentInst;
  const root = current?.files?.workspaceRoot ?? null;
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [profile, setProfile] = useState('default');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setProfile('default'), [inst]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.createWorkspace({ slug, name: name.trim(), instanceId: inst, profile });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      if (onCreated) onCreated(workspace.slug);
      else await navigate({ to: '/w/$slug', params: { slug: workspace.slug } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom">
          <Input value={name} required autoFocus maxLength={80} placeholder="Magasins"
            onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />
        </Field>
        <Field label="Identifiant" hint={root ? `Dossier ${root}/${slug || '…'} chez Hermes ; définitif` : 'Définitif'}>
          <Input value={slug} required pattern="[a-z0-9][a-z0-9\-]{0,39}" className="font-mono"
            onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} />
        </Field>
        {list.length > 1 && current && (
          <Field label="Instance" hint="Celle choisie en haut de la barre latérale">
            <p className="flex h-9 items-center text-sm" data-new-workspace-instance="">{current.label}</p>
          </Field>
        )}
        <Field label="Agent" hint="Profil Hermes qui sert ce workspace">
          <select value={profile} onChange={(e) => setProfile(e.target.value)}
            className="h-9 w-full rounded-lg border border-line bg-sheet px-3 text-sm focus:border-ink focus:outline-none">
            <option value="default">default</option>
            {current?.profiles.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      {current && !root && (
        <p className="text-sm text-bad" data-no-files-root="">
          {current.files?.reason ?? 'Fichiers pas encore vérifiés sur cette instance : cliquez « Revérifier » dans Réglages.'}
        </p>
      )}
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy || !inst || !root}>{busy ? 'Création…' : 'Créer le workspace'}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>}
      </div>
    </form>
  );
}
