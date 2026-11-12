// Slash commands of the composer: typed at the start of an empty message, run by the session page instead of being
// sent to the agent. Only the commands the page can run now are offered (`disabled` gives the reason otherwise); any
// other text starting with « / » is an ordinary message.

export type CommandName = 'new' | 'clear' | 'undo' | 'retry' | 'branch' | 'title' | 'usage' | 'stop' | 'prompt' | 'use' | 'goal';

export interface Command {
  name: CommandName;
  /** shown after the name in the menu, e.g. « [nom] » */
  args?: string;
  label: string;
  /** why it cannot run now; undefined = it can */
  disabled?: string;
}

export const COMMANDS: { name: CommandName; args?: string; label: string }[] = [
  { name: 'new', label: 'Nouvelle session dans ce workspace' },
  { name: 'clear', label: 'Vider la conversation' },
  { name: 'undo', label: 'Annuler le dernier échange' },
  { name: 'retry', label: 'Réessayer la dernière réponse' },
  { name: 'branch', label: 'Créer une branche à partir d’ici' },
  { name: 'title', args: '[nom]', label: 'Renommer (sans nom : titre par l’IA)' },
  { name: 'usage', label: 'Contexte et forfait utilisés' },
  { name: 'stop', label: 'Arrêter l’agent' },
  { name: 'prompt', args: '[titre]', label: 'Insérer un prompt enregistré' },
  { name: 'use', args: '<skill>', label: 'Utiliser un skill pour ce message' },
  { name: 'goal', args: '[objectif]', label: 'Fixer un objectif (relances automatiques)' },
];

/** Commands offered while the name is typed: text = « / » then letters only (no space yet). Null = no menu. */
export function matchCommands(text: string, list: Command[]): Command[] | null {
  const m = /^\/([a-z]*)$/i.exec(text);
  if (!m) return null;
  const typed = m[1]!.toLowerCase();
  const found = list.filter((c) => c.name.startsWith(typed));
  return found.length ? found : null;
}

/** The command a message runs, with its argument; null = an ordinary message. */
export function parseCommand(text: string, list: Command[]): { command: Command; arg: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const command = list.find((c) => c.name === m[1]!.toLowerCase());
  if (!command) return null;
  const arg = (m[2] ?? '').trim();
  // only the commands with `args` take one: « /stop maintenant » is a message
  if (arg && !command.args) return null;
  return { command, arg };
}

/** Skills offered after « /use » (second level of the menu), filtered by the start of the name; null = no menu. */
export function matchSkills(text: string, names: string[], max = 8): string[] | null {
  const m = /^\/use\s+(\S*)$/i.exec(text);
  if (!m) return null;
  const typed = m[1]!.toLowerCase();
  const found = names.filter((n) => n.toLowerCase().startsWith(typed)).slice(0, max);
  return found.length ? found : null;
}
