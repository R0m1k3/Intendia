import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type VaultInput, type VaultItem, type VaultKind } from '../api';
import { Button, Chips, cx, Field, host, Input } from '../components/ui';
import { FIELDS, KIND_LABEL, missing, toInput, type VaultField } from './fields';
import { t } from '../i18n';

const ID_TYPES = [
  { value: 'email', label: t('E-mail') },
  { value: 'username', label: t('Nom d’utilisateur') },
  { value: 'phone', label: t('Téléphone') },
] as const;

/** Props that keep password managers of the browser away from the fields (never fill them with the user's own data). */
const NO_MANAGER = { 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' } as const;

function SecretInput({ field, value, onChange, invalid }: { field: VaultField; value: string; onChange: (v: string) => void; invalid: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        name={`intendia-${field.name}`} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={field.autoComplete} inputMode={field.inputMode} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        required={field.required} aria-invalid={invalid || undefined} className="pr-10 font-mono" {...NO_MANAGER}
      />
      <button
        type="button" onClick={() => setShown(!shown)} aria-label={shown ? t('Masquer') : t('Afficher')}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center text-ink-faint hover:text-ink"
      >
        {shown ? <EyeOff className="size-4" strokeWidth={1.5} /> : <Eye className="size-4" strokeWidth={1.5} />}
      </button>
    </div>
  );
}

/**
 * Add (or replace) an item of the vault. The values live in this component's state only: sent by a direct call (no
 * useMutation, which would keep them in TanStack's cache), cleared after success; nothing is ever stored as a draft.
 */
export function AccessForm({ inst, profile, replacing, initial, proposed = false, onDone, onCancel }: {
  inst: string; profile: string;
  /** the item to replace: its kind is fixed, its metadata prefilled, its secrets typed again */
  replacing?: VaultItem;
  initial?: { kind?: VaultKind; origin?: string };
  /** the site comes from a page the agent opened (chat link): it could be an imitation */
  proposed?: boolean;
  onDone: (res: { id: string; oldKept: boolean }) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<VaultKind>(replacing?.kind ?? initial?.kind ?? 'login');
  const [values, setValues] = useState<Record<string, string>>(() => ({
    label: replacing?.label ?? (initial?.origin ? host(initial.origin) : ''),
    origin: replacing?.origin ?? initial?.origin ?? '',
    identifierType: replacing?.identifierType ?? 'email',
    identifier: replacing?.identifier ?? '',
  }));
  const [errors, setErrors] = useState<{ field?: string; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const set = (name: string, v: string) => setValues((x) => ({ ...x, [name]: v }));
  const empty = missing(kind, values);
  let proposedHost: string | null = null;
  if (proposed && values.origin) {
    try { proposedHost = new URL(values.origin).host; } catch { proposedHost = null; }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (empty.length || sending) return;
    setSending(true);
    setErrors(null);
    try {
      const input = toInput(kind, values) as VaultInput;
      const res = replacing
        ? await api.vaultReplace(inst, profile, replacing.id, input)
        : { ...(await api.vaultAdd(inst, profile, input)), oldKept: false };
      setValues({ label: '', origin: '', identifierType: 'email', identifier: '' });
      void qc.invalidateQueries({ queryKey: ['vault', inst, profile] });
      onDone(res);
    } catch (err) {
      const data = err instanceof ApiError ? (err.data as { field?: unknown } | undefined) : undefined;
      setErrors({ field: typeof data?.field === 'string' ? data.field : undefined, message: err instanceof Error ? err.message : t('Erreur') });
    } finally {
      setSending(false);
    }
  };

  const fieldError = (name: string) => (errors?.field === name ? errors.message : null);
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" autoComplete="off" data-access-form>
      {proposedHost && (
        <div className="rounded-[10px] bg-warn-soft px-3.5 py-3 text-[13.5px] text-warn" data-proposed>
          <p className="font-mono text-base font-semibold text-ink">{proposedHost}</p>
          <p className="mt-1 flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            {t('Site proposé par l’agent : vérifiez que c’est bien l’adresse officielle avant de saisir votre mot de passe.')}
          </p>
        </div>
      )}
      {!replacing && (
        <Chips label={t('Type')} value={kind} onChange={(k) => { setKind(k); setErrors(null); }}
          items={(['login', 'payment', 'address'] as const).map((k) => ({ key: k, label: KIND_LABEL[k] }))} />
      )}
      {replacing && (
        <p className="rounded-[10px] bg-raised px-3.5 py-2.5 text-[13px] text-ink-soft">
          {kind === 'login'
            ? t('Le mot de passe actuel ne peut pas être affiché : saisissez-le à nouveau.')
            : t('Les valeurs actuelles ne peuvent pas être affichées : saisissez-les à nouveau.')}
        </p>
      )}
      {FIELDS[kind].map((f) => (
        <div key={f.name} className="flex flex-col gap-4">
          <Field label={f.required ? f.label : t('{label} (facultatif)', { label: f.label })} hint={fieldError(f.name) ? <span className="text-bad">{fieldError(f.name)}</span> : f.hint}>
            {f.secret ? (
              <SecretInput field={f} value={values[f.name] ?? ''} onChange={(v) => set(f.name, v)} invalid={Boolean(fieldError(f.name))} />
            ) : (
              <Input
                name={`intendia-${f.name}`} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)}
                autoComplete={f.autoComplete} inputMode={f.inputMode} placeholder={f.placeholder} spellCheck={false}
                required={f.required} aria-invalid={Boolean(fieldError(f.name)) || undefined}
                className={cx(f.name === 'origin' && 'font-mono')} {...NO_MANAGER}
              />
            )}
          </Field>
          {kind === 'login' && f.name === 'origin' && (
            <Field label={t('Type d’identifiant')} hint={fieldError('identifierType') ? <span className="text-bad">{fieldError('identifierType')}</span> : undefined}>
              <Chips label={t('Type d’identifiant')} value={values.identifierType ?? 'email'} onChange={(v) => set('identifierType', v)}
                items={ID_TYPES.map((it) => ({ key: it.value, label: it.label }))} />
            </Field>
          )}
        </div>
      ))}
      {errors && !FIELDS[kind].some((f) => f.name === errors.field) && errors.field !== 'identifierType' && (
        <p className="text-[13px] text-bad" role="alert">{errors.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={empty.length > 0 || sending}>
          {sending ? t('Enregistrement…') : replacing ? t('Remplacer') : t('Enregistrer')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t('Annuler')}</Button>
      </div>
      <p className="text-xs text-ink-faint">
        {t('Les valeurs sont envoyées au coffre chiffré d’Hermes et ne sont gardées ni par Intendia ni par votre navigateur. L’agent remplit les champs sans jamais les voir.')}
      </p>
    </form>
  );
}
