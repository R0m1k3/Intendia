// Aide: where to start, what each page is for, the words explained (help/glossary.ts) and what to do when something
// fails. Plain text, no call to the server: the page works even when Hermes does not answer.
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { shortcutLabel } from '../components/CommandPalette';
import { Narrow, PageHeader } from '../components/Layout';
import { Panel } from '../components/ui';
import { GLOSSARY } from '../help/glossary';
import { t } from '../i18n';
import { T } from '../i18n/T';

interface Step { title: string; text: string; to: string; link: string }

const STEPS = (): Step[] => [
  { title: t('Choisissez l’IA'), text: t('Indiquez le fournisseur (Anthropic, OpenAI, OpenRouter, un serveur local…) et le modèle que l’agent utilise.'), to: '/config', link: t('Ouvrir la Configuration') },
  { title: t('Créez un dossier'), text: t('Un dossier par sujet : l’agent y range ses fichiers et vous y retrouvez vos sessions.'), to: '/w', link: t('Ouvrir les Dossiers') },
  { title: t('Écrivez votre première demande'), text: t('Dites ce que vous voulez obtenir, comme à un collègue. L’agent travaille, vous voyez chaque étape.'), to: '/chat/nouvelle', link: t('Nouvelle session') },
  { title: t('Répondez quand l’agent vous attend'), text: t('Avant une action sensible, l’agent demande votre accord. Ces demandes sont regroupées sous « Vous attend ».'), to: '/activite', link: t('Ouvrir l’Activité') },
  { title: t('Automatisez ce qui revient'), text: t('Une planification envoie la même consigne à heure fixe : un rapport chaque lundi, une veille chaque matin.'), to: '/crons', link: t('Ouvrir le Planning') },
];

const PAGES = (): [string, string][] => [
  [t('Sessions'), t('Vos conversations avec les agents, rangées par agent et par dossier.')],
  [t('Tâches'), t('Le tableau des travaux confiés aux agents, et les missions découpées en tâches.')],
  [t('Planning'), t('Ce qui part tout seul à heure fixe, et le résultat de chaque passage.')],
  [t('Fichiers'), t('Les fichiers des dossiers et les liens que l’agent vous a remis.')],
  [t('Coûts et journaux'), t('Ce que l’IA a consommé, et les journaux d’Hermes quand il faut comprendre une panne.')],
  [t('Activité'), t('Ce qui vous attend, ce qui tourne et ce qui vient de finir.')],
  [t('Plus'), t('Le reste : vue en colonnes, dossiers, skills, mémoire, accès aux sites, agents, configuration, état et réglages.')],
];

const H2 = 'text-[15px] font-semibold';

export function HelpPage() {
  // /aide#mot: the browser does not scroll to an anchor of a page drawn after loading
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <Narrow>
      <PageHeader title={t('Aide')} subtitle={t('Par où commencer, à quoi sert chaque page et ce que veulent dire les mots d’Intendia et d’Hermes.')} />
      <div className="max-w-[960px] space-y-5 px-4 pb-14 md:px-8">
        <Panel title={<span className={H2}>{t('Premiers pas')}</span>} bodyClassName="border-t border-line/70">
          <ol className="divide-y divide-line/70">
            {STEPS().map((s, i) => (
              <li key={s.to} className="flex gap-3 px-4 py-3">
                <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-xs font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{s.text}</p>
                </div>
                <Link {...({ to: s.to } as { to: string })} preload={false} className="shrink-0 self-center text-sm font-medium underline underline-offset-2">{s.link}</Link>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title={<span className={H2}>{t('Se repérer')}</span>} bodyClassName="border-t border-line/70">
          <dl className="divide-y divide-line/70">
            {PAGES().map(([name, text]) => (
              <div key={name} className="gap-4 px-4 py-2.5 sm:flex">
                <dt className="w-44 shrink-0 font-medium">{name}</dt>
                <dd className="text-sm text-ink-soft">{text}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line/70 px-4 py-3 text-sm text-ink-soft">
            <T k="Pour aller vite : {key} cherche une page, une session ou un fichier ; la touche {help} montre tous les raccourcis." vars={{ key: <kbd className="font-mono text-[13px] text-ink">{shortcutLabel()}</kbd>, help: <kbd className="font-mono text-[13px] text-ink">?</kbd> }} />
          </p>
        </Panel>

        <Panel title={<span className={H2}>{t('Les mots expliqués')}</span>} bodyClassName="border-t border-line/70">
          <dl className="divide-y divide-line/70">
            {GLOSSARY.map((g) => (
              <div key={g.id} id={g.id} className="scroll-mt-4 px-4 py-3 target:bg-accent-soft/60" data-term={g.id}>
                <dt className="font-medium">
                  {g.term}
                  {g.hermes && <span className="ml-2 font-mono text-xs font-normal text-ink-faint">{t('dans Hermes : {name}', { name: g.hermes })}</span>}
                </dt>
                <dd className="mt-0.5 text-sm text-ink-soft">{g.text}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title={<span className={H2}>{t('Quand quelque chose ne marche pas')}</span>} bodyClassName="border-t border-line/70">
          <ul className="divide-y divide-line/70 text-sm text-ink-soft">
            <li className="px-4 py-3">
              <T k="La page {status} teste chaque fonction contre votre Hermes et dit ce qui répond, ce qui manque et pourquoi." vars={{ status: <Link to="/etat" className="font-medium text-ink underline underline-offset-2">{t('État')}</Link> }} />
            </li>
            <li className="px-4 py-3">{t('Un message d’erreur dit ce qui s’est passé et quoi faire. « Détail technique » montre le texte exact, utile pour chercher ou demander de l’aide.')}</li>
            <li className="px-4 py-3">
              <T k="Les journaux d’Hermes se lisent dans {logs}, onglet Journaux." vars={{ logs: <Link {...({ to: '/suivi' } as { to: string })} className="font-medium text-ink underline underline-offset-2">{t('Coûts et journaux')}</Link> }} />
            </li>
            <li className="px-4 py-3">{t('Un agent qui ne répond plus : vérifiez sa passerelle (page de l’agent), puis redémarrez-la.')}</li>
          </ul>
        </Panel>
      </div>
    </Narrow>
  );
}
