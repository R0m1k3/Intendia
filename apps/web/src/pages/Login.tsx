import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
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

/** `?suite=` after login: only a share link (/f/<10 base62>), so this can never redirect elsewhere. */
function followUp(): string | null {
  const s = new URLSearchParams(window.location.search).get('suite');
  return s && /^\/f\/[0-9A-Za-z]{10}$/.test(s) ? s : null;
}

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // A share link opened from another site (Telegram) arrives without the SameSite=Strict cookie:
  // if this same-site request says we are logged in, go straight back to the file, once per link.
  useEffect(() => {
    const next = followUp();
    if (!next) return;
    const mark = `intendia-suite:${next}`;
    // a redirect less than 10 s ago that came back here means the cookie is blocked: stop, no loop
    if (Date.now() - Number(sessionStorage.getItem(mark) ?? 0) < 10_000) return;
    void api.setup().then((s) => {
      if (!s.authenticated) return;
      sessionStorage.setItem(mark, String(Date.now()));
      window.location.assign(next);
    }).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await qc.invalidateQueries();
      const next = followUp();
      if (next) return window.location.assign(next); // full load: /f/* is served by the server, not the app
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
