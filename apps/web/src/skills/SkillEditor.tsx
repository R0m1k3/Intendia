import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, X } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Skill } from '../api';
import { Button, cx, ErrorText, Field, Input } from '../components/ui';

const CodeView = lazy(() => import('../files/CodeView'));
const ICON = 'size-4';
/** Hermes' rules for a new skill (`POST /api/skills`), checked again by the server. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const DESCRIPTION_MAX = 60;
const AREA = 'w-full rounded-lg border border-line bg-sheet px-3 py-2 font-mono text-[13px] transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none';

/** "Nouveau skill": Intendia writes the SKILL.md front matter from the name and the description. */
export function NewSkill({ inst, profile, onClose, onCreated }: {
  inst: string; profile: string; onClose: () => void; onCreated: (skill: Skill) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => api.createSkill(inst, profile, {
      name: name.trim(), ...(category.trim() ? { category: category.trim() } : {}), description: description.trim(), body,
    }),
    onSuccess: async ({ skill }) => { await qc.invalidateQueries({ queryKey: ['skills', inst, profile] }); onCreated(skill); },
  });
  const nameOk = SKILL_NAME_RE.test(name.trim());
  const categoryOk = !category.trim() || SKILL_NAME_RE.test(category.trim());
  const left = DESCRIPTION_MAX - description.trim().length;
  const ok = nameOk && categoryOk && left >= 0 && description.trim().length > 0 && body.trim().length > 0;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (ok) create.mutate(); }}
        className="enter flex h-full w-full flex-col bg-sheet shadow-xl md:w-[560px] md:border-l md:border-line" aria-label="Nouveau skill">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-lg font-semibold">Nouveau skill <span className="ml-1 font-mono text-sm font-normal text-ink-faint">{profile}</span></h2>
          <Button type="button" variant="ghost" className="size-8 px-0" onClick={onClose} aria-label="Fermer"><X className={ICON} strokeWidth={1.5} /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Field label="Nom" hint={name && !nameOk ? <span className="text-bad">Minuscules, chiffres, . _ - ; 64 caractères au plus</span> : 'Minuscules, chiffres, . _ - ; c’est le dossier du skill'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder="rapport-hebdo" autoFocus className="font-mono" />
          </Field>
          <Field label="Catégorie" hint={category && !categoryOk ? <span className="text-bad">Même règle que le nom</span> : 'Facultatif ; un sous-dossier de skills/'}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={64} placeholder="notes" className="font-mono" />
          </Field>
          <Field label="Description" hint={<span className={cx(left < 0 && 'text-bad')} data-counter>{description.trim().length} / {DESCRIPTION_MAX} : l’agent la lit pour choisir le skill</span>}>
            <Input value={description} onChange={(e) => setDescription(e.target.value.replace(/[\r\n]+/g, ' '))} required placeholder="Rédige le rapport de la semaine" />
          </Field>
          <Field label="Instructions" hint="Le corps du SKILL.md, en Markdown : la méthode que l’agent doit suivre">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} required className={AREA} placeholder={'# Rapport\n\n1. Relire les notes de la semaine\n2. …'} />
          </Field>
          <ErrorText error={create.error} />
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={!ok || create.isPending}>{create.isPending ? 'Création…' : 'Créer le skill'}</Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

/**
 * The SKILL.md of a skill: read, and for a skill of the user or the agent, edited whole. Secrets are masked
 * («secret:…»); the server puts their value back when saving.
 */
export function SkillContent({ inst, profile, name, editable }: { inst: string; profile: string; name: string; editable: boolean }) {
  const qc = useQueryClient();
  const content = useQuery({ queryKey: ['skill-content', inst, profile, name], queryFn: () => api.skillContent(inst, profile, name) });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (d: string) => api.putSkillContent(inst, profile, name, d),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['skill-content', inst, profile, name] });
      await qc.invalidateQueries({ queryKey: ['skills', inst, profile] });
    },
  });
  const data = content.data;
  // a cut text is never edited: saving it would lose the end
  const canEdit = editable && data && !data.truncated;
  return (
    <section className="card overflow-hidden" aria-label="SKILL.md">
      <div className="flex items-center gap-3 border-b border-line/70 px-4 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-faint">skills/{name}/SKILL.md</span>
        {canEdit && draft === null && (
          <Button className="h-7" onClick={() => setDraft(data.content)}><Pencil className="size-3.5" strokeWidth={1.5} />Modifier</Button>
        )}
      </div>
      {data ? (
        draft !== null ? (
          <>
            <Suspense fallback={<p className="p-4 text-sm text-ink-faint">Chargement…</p>}>
              {/* starting text only: CodeView is rebuilt on every value */}
              <CodeView key="edit" name="SKILL.md" value={data.content} editable onChange={setDraft} />
            </Suspense>
            <div className="space-y-2 border-t border-line/70 px-4 py-3">
              <p className="text-xs text-ink-faint">Gardez l’en-tête entre les deux lignes --- ; laissez les «secret:…» tels quels, Intendia remet leur valeur.</p>
              <ErrorText error={save.error} />
              <div className="flex justify-end gap-2">
                <Button onClick={() => { setDraft(null); save.reset(); }}>Annuler</Button>
                <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-[1.7]">{data.content}</pre>
            {data.truncated && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">Contenu tronqué à 200 000 caractères.</p>}
          </>
        )
      ) : content.error ? <div className="p-4"><ErrorText error={content.error} /></div> : <p className="p-4 text-sm text-ink-faint">Chargement…</p>}
    </section>
  );
}
