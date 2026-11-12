// Garde-fous (option 61): the spending and loop limits of Hermes 0.23, gathered with French labels and when each one
// applies (hermes_cli/config_defaults.py, agent/tool_guardrails.py; see docs/hermes-api-notes.md). Only the paths of
// the instance's schema are shown: another Hermes version may rename them.
import { fromText, type EditorKind, type Parsed } from './fields';

export type Applies = 'now' | 'sessions' | 'dispatcher';

export interface PresetItem {
  path: string;
  label: string;
  help: string;
  applies: Applies;
  /** A number is expected (Hermes types some of them `string`: their default is None). */
  numeric?: boolean;
  /** Empty = Hermes' default, sent as null (no limit). */
  nullable?: boolean;
}

export interface Preset {
  intro: string;
  items: PresetItem[];
}

export const APPLIES_TEXT: Record<Applies, string> = {
  now: 'S’applique tout de suite.',
  sessions: 'S’applique aux nouvelles sessions, et aux autres après 1 h sans activité.',
  dispatcher: 'S’applique au prochain passage du kanban (toutes les 60 s par défaut).',
};

export const GUARDRAILS: Preset = {
  intro: 'Hermes ne peut pas mettre un run en pause ni le limiter en jetons ou en dollars. Le budget de temps demande '
    + 'à l’agent de conclure, il ne l’arrête pas. L’arrêt après des échecs répétés est coupé par défaut pour les chats '
    + 'd’Intendia (Hermes les compte comme surveillés) et actif pour les crons et le kanban.',
  items: [
    { path: 'agent.run_budget_seconds', label: 'Budget de temps par run (secondes)', applies: 'sessions', numeric: true, nullable: true,
      help: 'À 80 % du temps, Hermes demande à l’agent de conclure. Vide : pas de budget.' },
    { path: 'agent.max_turns', label: 'Tours d’outils au plus par run', applies: 'sessions', numeric: true, nullable: true,
      help: 'Au-delà, l’agent s’arrête. Vide : pas de limite.' },
    { path: 'agent.budget_warning_ratio', label: 'Alerte avant la limite de tours (0 à 1)', applies: 'sessions', numeric: true, nullable: true,
      help: 'Part des tours après laquelle l’agent est prévenu, par exemple 0,8. Vide : pas d’alerte.' },
    { path: 'tool_loop_guardrails.warnings_enabled', label: 'Prévenir l’agent quand il tourne en rond', applies: 'sessions',
      help: 'Un avertissement est ajouté au résultat de l’outil après des échecs ou des appels sans progrès.' },
    { path: 'tool_loop_guardrails.hard_stop_enabled', label: 'Arrêter les boucles dans les chats', applies: 'sessions',
      help: 'Bloque l’outil, puis le tour, après les seuils ci-dessous, aussi pour les sessions surveillées (chats d’Intendia).' },
    { path: 'tool_loop_guardrails.non_interactive_hard_stop_enabled', label: 'Arrêter les boucles des crons et du kanban', applies: 'sessions',
      help: 'Même arrêt pour les sessions sans personne derrière (actif par défaut).' },
    { path: 'tool_loop_guardrails.hard_stop_after.exact_failure', label: 'Arrêt après N échecs identiques', applies: 'sessions',
      help: 'Même outil, mêmes arguments, même erreur.' },
    { path: 'tool_loop_guardrails.hard_stop_after.same_tool_failure', label: 'Arrêt après N échecs du même outil', applies: 'sessions',
      help: 'Même outil, arguments différents.' },
    { path: 'tool_loop_guardrails.hard_stop_after.idempotent_no_progress', label: 'Arrêt après N lectures sans progrès', applies: 'sessions',
      help: 'Le même appel en lecture seule qui rend le même résultat.' },
    { path: 'tool_loop_guardrails.loop_caps.max_web_searches', label: 'Recherches web au plus par tour', applies: 'sessions',
      help: 'Toujours actif. 0 : pas de limite.' },
    { path: 'tool_loop_guardrails.loop_caps.max_subagents', label: 'Sous-agents au plus par tour', applies: 'sessions',
      help: 'Toujours actif. 0 : pas de limite.' },
    { path: 'delegation.max_concurrent_children', label: 'Sous-agents en même temps', applies: 'now',
      help: 'Un lot plus grand est refusé ; une délégation en fond au-delà se fait en attendant.' },
    { path: 'delegation.max_spawn_depth', label: 'Profondeur de délégation', applies: 'now',
      help: '1 : un sous-agent ne peut pas déléguer à son tour.' },
    { path: 'kanban.max_in_progress', label: 'Tâches kanban en cours au plus', applies: 'dispatcher', numeric: true, nullable: true,
      help: 'Pour toute l’instance. Vide : Hermes choisit selon la mémoire du serveur (2 à 8).' },
    { path: 'kanban.max_in_progress_per_profile', label: 'Tâches kanban en cours au plus par agent', applies: 'dispatcher', numeric: true, nullable: true,
      help: 'Vide : pas de limite par agent.' },
  ],
};

/** Value to send for the text typed in a preset field. */
export function parsePreset(item: PresetItem | undefined, kind: EditorKind, text: string, original: unknown): Parsed {
  if (item?.nullable && text.trim() === '') return { ok: true, value: null };
  if (item?.numeric) return fromText('number', text.replace(',', '.'), original);
  return fromText(kind, text, original);
}
