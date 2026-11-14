import { t } from '../i18n';

/** French names of Hermes's auxiliary tasks (0.23.0); an unknown task keeps Hermes's label, else its code. */
export const AUX_LABELS: Record<string, string> = {
  vision: t('Vision'),
  compression: t('Compression du contexte'),
  approval: t('Validation des actions'),
  mcp: t('Outils MCP'),
  title_generation: t('Titres de session'),
  review: t('Relecture'),
  voice_chat: t('Chat vocal'),
  triage_specifier: t('Tri des demandes'),
  kanban_decomposer: t('Découpage Kanban'),
  profile_describer: t('Description de profil'),
  curator: t('Curateur'),
};

export const auxLabel = (task: string, hermes: string | null): string => AUX_LABELS[task] ?? hermes ?? task;
