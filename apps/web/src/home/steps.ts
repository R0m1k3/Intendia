// « Premiers pas » on the home page: four steps ticked from what already exists on the instance. Not a status card
// (Michael, 2026-11-12: no server or schedule cards on the home page): it only says what is left to try, and goes
// away for good once everything is done or the user closes it.
import { t } from '../i18n';

export interface StepFacts {
  /** the agent has a main model (null: not known yet) */
  model: boolean | null;
  /** folders of the instance */
  folders: number;
  /** sessions in these folders */
  sessions: number;
  /** schedules of the instance (null: not known) */
  schedules: number | null;
}

export interface FirstStep { key: 'model' | 'folder' | 'request' | 'schedule'; title: string; text: string; to: string; done: boolean }

export function firstSteps(f: StepFacts): FirstStep[] {
  return [
    { key: 'model', title: t('Choisir l’IA'), text: t('Le fournisseur et le modèle que l’agent utilise'), to: '/config', done: f.model === true },
    { key: 'folder', title: t('Créer un dossier'), text: t('Un par sujet, pour ranger fichiers et sessions'), to: '/w', done: f.folders > 0 },
    { key: 'request', title: t('Envoyer une première demande'), text: t('Dans le champ en bas de cette page'), to: '/', done: f.sessions > 0 },
    { key: 'schedule', title: t('Planifier une demande régulière'), text: t('Un rapport chaque lundi, une veille chaque matin'), to: '/crons', done: (f.schedules ?? 0) > 0 },
  ];
}

const KEY = 'intendia-first-steps';
export const stepsHidden = (): boolean => {
  try { return localStorage.getItem(KEY) === 'hidden'; } catch { return false; }
};
export const hideSteps = (): void => {
  try { localStorage.setItem(KEY, 'hidden'); } catch { /* private mode */ }
};

/** Shown while something is left to do, the facts are known and the user did not close it. */
export function showSteps(f: StepFacts, hidden: boolean): boolean {
  if (hidden || f.model === null || f.schedules === null) return false;
  return firstSteps(f).some((s) => !s.done);
}
