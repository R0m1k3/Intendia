import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Save, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type ConfigField } from '../api';
import { Button, cx, ErrorText, Input, Panel } from '../components/ui';
import { CHANGED_TEXT, configKey, errorCode, errorData, ICON, SELECT, useInvalidateConfig, type TabProps } from './common';
import { changeList, display, editorKind, fromText, isMasked, reapply, toText, type EditorKind } from './fields';

const LABEL: Record<string, string> = {};

/** Schema-generated form: one category at a time, only changed paths are sent. */
export function ConfigForm({ inst, profile, can, onSaved }: TabProps) {
  const form = useQuery({ queryKey: configKey(inst, profile, 'form'), queryFn: () => api.config(inst, profile) });
  const invalidate = useInvalidateConfig(inst, profile);
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<Record<string, unknown>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  /** Version the pending edits started from: a background refetch must not move it (that would skip the 409). */
  const [baseVersion, setBaseVersion] = useState<string | null>(null);

  const data = form.data;
  const changes = useMemo(() => (data ? changeList(data.values, pending) : []), [data, pending]);
  const save = useMutation({
    mutationFn: () => api.saveConfig(inst, profile, Object.fromEntries(changes.map((c) => [c.path, c.after])), (baseVersion ?? data!.version)!),
    onSuccess: async () => {
      setPending({}); setTexts({}); setReview(false); setConflict(false); setBaseVersion(null);
      await invalidate();
      onSaved(true);
    },
    onError: (err) => { if (errorCode(err) === 'config_changed') setConflict(true); },
  });

  if (form.isPending) return <p className="text-sm text-ink-soft">Lecture de la configuration…</p>;
  if (form.isError || !data) return <ErrorText error={form.error} />;

  const cat = category ?? data.categories[0] ?? 'general';
  const needle = q.trim().toLowerCase();
  const paths = Object.keys(data.values).filter((p) => {
    const f = data.schema[p];
    if (!f) return false;
    if (needle) return p.toLowerCase().includes(needle) || (f.description ?? '').toLowerCase().includes(needle);
    return (f.category ?? 'general') === cat;
  }).sort();
  const writable = can('put') && data.version !== null;

  const started = () => { if (baseVersion === null) setBaseVersion(data.version); };
  const edit = (path: string, kind: EditorKind, text: string, original: unknown) => {
    started();
    setTexts((t) => ({ ...t, [path]: text }));
    const parsed = fromText(kind, text, original);
    if (!parsed.ok) { setBad((b) => ({ ...b, [path]: parsed.error })); return; }
    setBad(({ [path]: _, ...rest }) => rest);
    setPending((p) => ({ ...p, [path]: parsed.value }));
  };
  const setValue = (path: string, value: unknown) => { started(); setPending((p) => ({ ...p, [path]: value })); };

  const reload = async () => {
    const fresh = await form.refetch();
    if (fresh.data) {
      const r = reapply(pending, fresh.data.schema);
      setPending(r.kept);
      setDropped(r.dropped);
      setBaseVersion(fresh.data.version);
    }
    setConflict(false);
    save.reset();
  };

  return (
    <div className="space-y-4">
      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 p-4 text-sm">
          <span>{CHANGED_TEXT}</span>
          <Button onClick={() => void reload()}><RefreshCw className={ICON} strokeWidth={1.5} />Recharger en gardant mes changements</Button>
        </div>
      )}
      {dropped.length > 0 && <p className="text-sm text-warn">Changements abandonnés (réglages disparus) : {dropped.join(', ')}</p>}
      {!writable && (
        <p className="text-sm text-ink-soft">
          {data.version === null ? 'Écriture impossible : Hermes ne donne pas le fichier de configuration.' : 'Enregistrement indisponible sur cette instance.'}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <nav className="space-y-0.5 md:sticky md:top-4 md:self-start" aria-label="Catégories">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
            <Input className="pl-8" placeholder="Chercher un réglage" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un réglage" />
          </div>
          <select className={cx(SELECT, 'w-full md:hidden')} value={cat} onChange={(e) => { setCategory(e.target.value); setQ(''); }} aria-label="Catégorie">
            {data.categories.map((c) => <option key={c} value={c}>{LABEL[c] ?? c}</option>)}
          </select>
          <div className="hidden max-h-[70vh] overflow-auto md:block">
            {data.categories.map((c) => {
              const n = changes.filter((ch) => (data.schema[ch.path]?.category ?? 'general') === c).length;
              return (
                <button key={c} type="button" onClick={() => { setCategory(c); setQ(''); }}
                  className={cx('flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-left text-sm transition-colors',
                    !needle && c === cat ? 'bg-raised text-ink' : 'text-ink-soft hover:bg-raised hover:text-ink')}>
                  <span className="truncate font-mono text-[12.5px]">{c}</span>
                  {n > 0 && <span className="text-xs text-accent">{n}</span>}
                </button>
              );
            })}
          </div>
        </nav>
        <Panel title={needle ? `Résultats pour « ${q.trim()} »` : <span className="font-mono">{cat}</span>} bodyClassName="divide-y divide-line">
          {paths.length === 0 && <p className="p-5 text-sm text-ink-soft">Aucun réglage.</p>}
          {paths.map((path) => (
            <FieldRow key={path} path={path} field={data.schema[path]!} original={data.values[path]}
              value={path in pending ? pending[path] : data.values[path]} text={texts[path]} error={bad[path]} disabled={!writable}
              onText={edit} onValue={setValue} />
          ))}
        </Panel>
      </div>
      {(changes.length > 0 || Object.keys(bad).length > 0) && (
        <div className="sticky bottom-3 z-10 rounded-xl border border-line bg-sheet p-4 shadow-lg">
          {review ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{changes.length} changement{changes.length > 1 ? 's' : ''} à enregistrer</h3>
              <ul className="max-h-60 space-y-1 overflow-auto font-mono text-[12.5px]">
                {changes.map((c) => (
                  <li key={c.path}><span className="text-ink">{c.path}</span> : <span className="text-ink-faint line-through">{display(c.before)}</span> → <span className="text-accent">{display(c.after)}</span></li>
                ))}
              </ul>
              <ErrorText error={save.error && errorCode(save.error) !== 'config_changed' ? save.error : null} />
              {save.error && Array.isArray(errorData(save.error).paths) && <p className="text-xs text-bad">À corriger : {(errorData(save.error).paths as string[]).join(', ')}</p>}
              <div className="flex gap-2">
                <Button variant="primary" disabled={save.isPending || Object.keys(bad).length > 0} onClick={() => save.mutate()}>
                  <Save className={ICON} strokeWidth={1.5} />{save.isPending ? 'Enregistrement…' : 'Confirmer'}
                </Button>
                <Button variant="ghost" onClick={() => setReview(false)}>Retour</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm">
                {changes.length} changement{changes.length > 1 ? 's' : ''} en attente
                {Object.keys(bad).length > 0 && <span className="text-bad"> · {Object.keys(bad).length} valeur{Object.keys(bad).length > 1 ? 's' : ''} à corriger</span>}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { setPending({}); setTexts({}); setBad({}); setBaseVersion(null); }}>Annuler</Button>
                <Button variant="primary" disabled={!writable || changes.length === 0 || Object.keys(bad).length > 0} onClick={() => setReview(true)}>Voir et enregistrer</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldRow({ path, field, original, value, text, error, disabled, onText, onValue }: {
  path: string; field: ConfigField; original: unknown; value: unknown; text: string | undefined; error: string | undefined; disabled: boolean;
  onText: (path: string, kind: EditorKind, text: string, original: unknown) => void; onValue: (path: string, value: unknown) => void;
}) {
  const kind = editorKind(field, original);
  const changed = JSON.stringify(value) !== JSON.stringify(original);
  const id = `f-${path}`;
  const description = field.description && !field.description.includes('→') ? field.description : null;
  return (
    <div className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_minmax(0,320px)] md:items-center">
      <label htmlFor={id} className="min-w-0">
        <span className={cx('block break-all font-mono text-[12.5px]', changed ? 'text-accent' : 'text-ink')}>{path}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-faint">{description}</span>}
      </label>
      <div className="min-w-0">
        {kind === 'boolean' && (
          <input id={id} type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={value === true} disabled={disabled}
            onChange={(e) => onValue(path, e.target.checked)} />
        )}
        {kind === 'select' && (
          <select id={id} className={cx(SELECT, 'w-full')} value={String(value ?? '')} disabled={disabled} onChange={(e) => onValue(path, e.target.value)}>
            {field.clearable && <option value="">(aucun)</option>}
            {(field.options ?? []).filter((o) => o !== '' || !field.clearable).map((o) => <option key={String(o)} value={String(o)}>{String(o) || '(vide)'}</option>)}
            {!(field.options ?? []).includes(value) && value !== '' && value != null && <option value={String(value)}>{String(value)}</option>}
          </select>
        )}
        {(kind === 'number' || kind === 'text') && (
          <Input id={id} type={kind === 'number' ? 'text' : 'text'} inputMode={kind === 'number' ? 'decimal' : undefined} disabled={disabled}
            className="font-mono text-[12.5px]" value={text ?? toText(kind, value)} placeholder={original == null ? '(non défini)' : undefined}
            onChange={(e) => onText(path, kind, e.target.value, original)} />
        )}
        {kind === 'lines' && (
          <textarea id={id} rows={Math.min(6, Math.max(2, (text ?? toText(kind, value)).split('\n').length))} disabled={disabled}
            className="w-full rounded-lg border border-line bg-sheet px-3 py-2 font-mono text-[12.5px] focus:border-accent focus:outline-none"
            value={text ?? toText(kind, value)} placeholder="une valeur par ligne" onChange={(e) => onText(path, kind, e.target.value, original)} />
        )}
        {kind === 'readonly' && (
          <div>
            <code className="block truncate text-[12.5px] text-ink-soft" title={toText(kind, value)}>{toText(kind, value) || '(vide)'}</code>
            <span className="text-xs text-ink-faint">{isMasked(value) ? 'Valeur masquée : à changer dans l’onglet YAML ou Variables' : 'Modifier dans l’onglet YAML'}</span>
          </div>
        )}
        {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
      </div>
    </div>
  );
}
