// One word per notion in the interface (audit of 2026-11-27): the texts shown to the user say « planification »,
// « tâche », « dossier » and « agent », never the technical names below. Used by the i18n tests of the web and the
// server; the technical names stay fine in code, routes, comments and the palette's search words.
const BANNED = [
  // « Expression cron » is the name of the syntax; crons/… is a real folder of the workspace
  { word: 'cron', re: /\bcrons?\b(?!\/)/i, allow: /expression cron/i, say: 'planification' },
  { word: 'kanban', re: /\bkanban\b(?!\/)/i, say: 'tâches' },
  { word: 'tâche planifiée', re: /\btâches? planifiées?\b/i, say: 'planification' },
  { word: 'workspace', re: /(?<!\{)\bworkspaces?\b(?!\})/i, say: 'dossier' },
  // Hermes calls an agent a profile: said once where the name is chosen; the user profile is a memory file
  { word: 'profil', re: /\bprofils?\b/i, allow: /profil Hermes|profil utilisateur/i, say: 'agent' },
];

/** The banned words found in a French key (its context after `|` is not shown, so not checked). */
export function bannedWords(key) {
  const text = key.split('|')[0];
  return BANNED.filter((b) => b.re.test(text) && !(b.allow && b.allow.test(text))).map((b) => `« ${b.word} » → « ${b.say} »`);
}
