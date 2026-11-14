import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { InstanceForm } from '../components/InstanceForm';
import { Button, ErrorText, Field, Input, Wordmark } from '../components/ui';
import { Shell } from './Login';
import { t } from '../i18n';
import { T } from '../i18n/T';

function PasswordStep() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error(t('Les deux mots de passe diffèrent')));
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
      <h1 className="text-[26px] font-semibold leading-tight">{t('Premier lancement')}</h1>
      <p className="mt-2 text-sm text-ink-soft">
        <T k="Le code d’installation est affiché dans les logs du conteneur ({cmd})." vars={{ cmd: <code className="font-mono text-xs">docker logs intendia</code> }} />
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label={t('Code d’installation')}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus className="font-mono" />
        </Field>
        <Field label={t('Mot de passe')} hint={t('12 caractères minimum')}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required autoComplete="new-password" />
        </Field>
        <Field label={t('Confirmation')}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <ErrorText error={error} />
        <Button variant="primary" className="h-10 w-full">{t('Définir le mot de passe')}</Button>
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
    <div className="min-h-full bg-sheet"><div className="enter mx-auto max-w-3xl p-5 md:p-10">
      <div className="mb-10"><Wordmark size="lg" /></div>
      <h1 className="text-[26px] font-semibold leading-tight">{t('Ajouter une instance Hermes')}</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-soft">
        {t('Intendia teste chaque module contre l’instance avant d’enregistrer. Les clés sont chiffrées dans la base et ne sont jamais renvoyées au navigateur.')}
      </p>
      <div className="mt-8 card p-5 md:p-6">
        {/* then the provider, the model and a workspace, each step can be skipped */}
        <InstanceForm onSaved={async (r) => { await qc.invalidateQueries(); await navigate({ to: '/installation/fournisseur', search: { inst: r.instanceId } }); }} />
      </div>
      <Button variant="ghost" className="mt-4" onClick={() => navigate({ to: '/' })}>{t('Plus tard')}</Button>
    </div></div>
  );
}
