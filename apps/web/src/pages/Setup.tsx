import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { Button, ErrorText, Field, Input, Wordmark } from '../components/ui';
import { Shell } from './Login';

function PasswordStep() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error('Les deux mots de passe diffèrent'));
    setError(null);
    try {
      await api.setPassword(code, password);
      await qc.invalidateQueries({ queryKey: ['setup'] });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Shell>
      <h1 className="text-[28px] font-medium leading-tight">Premier lancement</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Le code d’installation est affiché dans les logs du conteneur (<code className="font-mono text-xs">docker logs intendia</code>).
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Code d’installation">
          <Input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus className="font-mono" />
        </Field>
        <Field label="Mot de passe" hint="12 caractères minimum">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required autoComplete="new-password" />
        </Field>
        <Field label="Confirmation">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <ErrorText error={error} />
        <Button variant="primary" className="h-10 w-full">Définir le mot de passe</Button>
      </form>
    </Shell>
  );
}

export function SetupPage() {
  const setup = useQuery({ queryKey: ['setup'], queryFn: api.setup });
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!setup.data) return null;
  if (setup.data.needsPassword) return <PasswordStep />;
  return (
    <div className="enter mx-auto max-w-3xl p-5 md:p-10">
      <div className="mb-10"><Wordmark size="lg" /></div>
      <h1 className="text-[28px] font-medium leading-tight">Ajouter une instance Hermes</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-soft">
        Intendia teste chaque module contre l’instance avant d’enregistrer. Les clés sont chiffrées dans la base et ne
        sont jamais renvoyées au navigateur.
      </p>
      <div className="mt-8 rounded-xl border border-line bg-sheet p-5 md:p-6">
        <InstanceForm onSaved={async () => { await qc.invalidateQueries(); await navigate({ to: '/' }); }} />
      </div>
      <Button variant="ghost" className="mt-4" onClick={() => navigate({ to: '/' })}>Plus tard</Button>
    </div>
  );
}
