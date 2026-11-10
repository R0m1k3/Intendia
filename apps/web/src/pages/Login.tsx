import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { Button, ErrorText, Field, Input, Wordmark } from '../components/ui';

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <div className="enter w-full max-w-sm">
        <div className="mb-10"><Wordmark size="lg" /></div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await qc.invalidateQueries();
      await navigate({ to: '/' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h1 className="text-[28px] font-medium leading-tight">Connexion</h1>
      <p className="mt-2 text-sm text-ink-soft">Console de vos agents Hermes</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Mot de passe">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" required />
        </Field>
        <ErrorText error={error} />
        <Button variant="primary" className="h-10 w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Button>
      </form>
    </Shell>
  );
}
