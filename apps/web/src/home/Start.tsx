// The empty home page: example requests that fill the message box, and « Premiers pas » while something is left
// to try (home/steps.ts). No status, server or schedule card here.
import { Link } from '@tanstack/react-router';
import { Check, FileText, FolderTree, Globe, Mail, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { firstSteps, hideSteps, showSteps, stepsHidden, type StepFacts } from './steps';

interface Example { key: string; icon: ReactNode; title: string; text: string }

/** The text put in the message box: a request to complete, with [the parts to replace] in brackets. */
const EXAMPLES = (): Example[] => [
  { key: 'summary', icon: <FileText strokeWidth={1.5} />, title: t('Résumer un document'), text: t('Résume le document que je joins en dix points, puis liste les actions à mener.') },
  { key: 'mail', icon: <Mail strokeWidth={1.5} />, title: t('Préparer un e-mail'), text: t('Rédige un e-mail à [destinataire] au sujet de [sujet]. Ton courtois et direct, moins de 150 mots.') },
  { key: 'search', icon: <Globe strokeWidth={1.5} />, title: t('Faire une recherche'), text: t('Cherche sur le web ce qui s’est dit récemment sur [sujet] et fais-m’en une synthèse, avec les sources.') },
  { key: 'files', icon: <FolderTree strokeWidth={1.5} />, title: t('Ranger des fichiers'), text: t('Regarde les fichiers de ce dossier et propose-moi un classement. Ne déplace rien avant mon accord.') },
];

export function Examples({ onPick }: { onPick: (text: string) => void }) {
  return (
    <ul className="mt-5 grid gap-2 text-left sm:grid-cols-2" aria-label={t('Exemples de demandes')} data-examples>
      {EXAMPLES().map((e) => (
        <li key={e.key}>
          <button type="button" onClick={() => onPick(e.text)} data-example={e.key}
            className="flex h-full w-full items-start gap-3 rounded-xl border border-line bg-sheet px-3.5 py-3 text-left transition-colors hover:border-ink/25 hover:bg-paper">
            <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-ink [&>svg]:size-4">{e.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{e.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-faint">{e.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FirstSteps({ facts }: { facts: StepFacts }) {
  const [hidden, setHidden] = useState(stepsHidden);
  if (!showSteps(facts, hidden)) return null;
  const steps = firstSteps(facts);
  const left = steps.filter((s) => !s.done).length;
  return (
    <section className="mt-6 rounded-xl border border-line text-left" aria-labelledby="first-steps" data-first-steps>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <h2 id="first-steps" className="min-w-0 flex-1 text-sm font-semibold">
          {t('Premiers pas')}
          <span className="ml-2 font-normal text-ink-faint">{t('{done} sur {total}', { done: steps.length - left, total: steps.length })}</span>
        </h2>
        <Link to="/aide" className="text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink">{t('Aide')}</Link>
        <button type="button" onClick={() => { hideSteps(); setHidden(true); }} aria-label={t('Ne plus afficher les premiers pas')} title={t('Ne plus afficher')}
          className="grid size-7 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink">
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <ol className="divide-y divide-line/70 border-t border-line/70">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-3 px-3.5 py-2" data-step={s.key} data-done={s.done}>
            <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${s.done ? 'border-ok bg-ok text-sheet' : 'border-line'}`}>
              {s.done && <Check className="size-3" strokeWidth={2.5} aria-label={t('Fait')} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm ${s.done ? 'text-ink-faint line-through decoration-ink-faint/50' : 'font-medium'}`}>{s.title}</span>
              {!s.done && <span className="block text-[13px] text-ink-faint">{s.text}</span>}
            </span>
            {!s.done && s.key !== 'request' && (
              <Link {...({ to: s.to } as { to: string })} preload={false} className="shrink-0 text-[13px] font-medium underline underline-offset-2">{t('Ouvrir')}</Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
