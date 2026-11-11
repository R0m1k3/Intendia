/** French names of Hermes's auxiliary tasks (0.23.0); an unknown task keeps Hermes's label, else its code. */
export const AUX_LABELS: Record<string, string> = {
  vision: 'Vision',
  compression: 'Compression du contexte',
  approval: 'Validation des actions',
  mcp: 'Outils MCP',
  title_generation: 'Titres de session',
  review: 'Relecture',
  voice_chat: 'Chat vocal',
  triage_specifier: 'Tri des demandes',
  kanban_decomposer: 'Découpage Kanban',
  profile_describer: 'Description de profil',
  curator: 'Curateur',
};

export const auxLabel = (task: string, hermes: string | null): string => AUX_LABELS[task] ?? hermes ?? task;
