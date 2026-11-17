import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { askReload, isStale } from '../components/staleReload';
import { api, type Skill } from '../api';
import { confirmClose, useDirtyGuard } from '../components/dirty';
import { Sheet } from '../kanban/Sheet';
import { Button, cx, ErrorText, Field, Input, SkeletonLines } from '../components/ui';
import { t } from '../i18n';

const CodeView = lazy(() => import('../files/CodeView'));
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
    onSuccess: async ({ skill }) => { guard.release(); await qc.invalidateQueries({ queryKey: ['skills', inst, profile] }); onCreated(skill); },
  });
  const guard = useDirtyGuard(Boolean(name || category || description || body));
  const nameOk = SKILL_NAME_RE.test(name.trim());
  const categoryOk = !category.trim() || SKILL_NAME_RE.test(category.trim());
  const left = DESCRIPTION_MAX - description.trim().length;
  const ok = nameOk && categoryOk && left >= 0 && description.trim().length > 0 && body.trim().length > 0;
  return (
    <Sheet
      title={t('Nouveau skill')} width="md:w-[560px]" onClose={onClose} onSubmit={() => { if (ok) create.mutate(); }}
      footer={<>
        <Button type="button" onClick={() => void confirmClose(onClose)}>{t('Annuler')}</Button>
        <Button type="submit" variant="primary" disabled={!ok || create.isPending}>{create.isPending ? t('Création…') : t('Créer le skill')}</Button>
      </>}
    >
          <p className="text-xs text-ink-faint">{t('Profil')} <span className="ml-1 font-mono">{profile}</span></p>
          <Field label={t('Nom')} hint={name && !nameOk ? <span className="text-bad">{t('Minuscules, chiffres, . _ - ; 64 caractères au plus')}</span> : t('Minuscules, chiffres, . _ - ; c’est le dossier du skill')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder={t('rapport-hebdo')} autoFocus className="font-mono" />
          </Field>
          <Field label={t('Catégorie')} hint={category && !categoryOk ? <span className="text-bad">{t('Même règle que le nom')}</span> : t('Facultatif ; un sous-dossier de skills/')}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={64} placeholder={t('notes')} className="font-mono" />
          </Field>
          <Field label={t('Description')} hint={<span className={cx(left < 0 && 'text-bad')} data-counter>{t('{n} / {max} : l’agent la lit pour choisir le skill', { n: description.trim().length, max: DESCRIPTION_MAX })}</span>}>
            <Input value={description} onChange={(e) => setDescription(e.target.value.replace(/[\r\n]+/g, ' '))} required placeholder={t('Rédige le rapport de la semaine')} />
          </Field>
          <Field label={t('Instructions')} hint={t('Le corps du SKILL.md, en Markdown : la méthode que l’agent doit suivre')}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} required className={AREA} placeholder={t('# Rapport\n\n1. Relire les notes de la semaine\n2. …')} />
          </Field>
          <ErrorText error={create.error} />
    </Sheet>
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
  /** Revision of the text the edit started from: a newer one in Hermes gives 409 `stale`. */
  const [base, setBase] = useState('');
  const save = useMutation({
    mutationFn: (d: string) => api.putSkillContent(inst, profile, name, d, base),
    onError: async (err) => {
      if (!isStale(err) || !(await askReload(draft))) return;
      setDraft(null);
      save.reset();
      await content.refetch();
    },
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['skill-content', inst, profile, name] });
      await qc.invalidateQueries({ queryKey: ['skills', inst, profile] });
    },
  });
  const data = content.data;
  useDirtyGuard(draft !== null && data !== undefined && draft !== data.content);
  // a cut text is never edited: saving it would lose the end
  const canEdit = editable && data && !data.truncated;
  return (
    <section className="card overflow-hidden" aria-label="SKILL.md">
      <div className="flex items-center gap-3 border-b border-line/70 px-4 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-faint">skills/{name}/SKILL.md</span>
        {canEdit && draft === null && (
          <Button className="h-7" onClick={() => { setBase(data.revision); setDraft(data.content); }}><Pencil className="size-3.5" strokeWidth={1.5} />{t('Modifier')}</Button>
        )}
      </div>
      {data ? (
        draft !== null ? (
          <>
            <Suspense fallback={<SkeletonLines rows={8} className="p-4" />}>
              {/* starting text only: CodeView is rebuilt on every value */}
              <CodeView key="edit" name="SKILL.md" value={data.content} editable onChange={setDraft} />
            </Suspense>
            <div className="space-y-2 border-t border-line/70 px-4 py-3">
              <p className="text-xs text-ink-faint">{t('Gardez l’en-tête entre les deux lignes --- ; laissez les «secret:…» tels quels, Intendia remet leur valeur.')}</p>
              <ErrorText error={save.error} />
              <div className="flex justify-end gap-2">
                <Button onClick={() => { setDraft(null); save.reset(); }}>{t('Annuler')}</Button>
                <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? t('Enregistrement…') : t('Enregistrer')}</Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-[1.7]">{data.content}</pre>
            {data.truncated && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">{t('Contenu tronqué à 200 000 caractères.')}</p>}
          </>
        )
      ) : content.error ? <div className="p-4"><ErrorText error={content.error} /></div> : <SkeletonLines rows={4} className="p-4" />}
    </section>
  );
}
