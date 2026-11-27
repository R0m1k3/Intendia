// The words of Intendia and Hermes, each explained in one or two plain sentences. Shown by the « ? » bubbles
// (components/Hint.tsx) and listed on the Aide page (pages/Help.tsx). `hermes`: the name Hermes gives it, when it differs.
import { t } from '../i18n';

export interface Term { id: string; term: string; text: string; hermes?: string }

export const GLOSSARY: readonly Term[] = [
  { id: 'instance', term: t('Instance'), text: t('Un serveur Hermes relié à Intendia. Vous pouvez en relier plusieurs et passer de l’un à l’autre par la colonne de gauche.') },
  { id: 'agent', term: t('Agent'), hermes: 'profile', text: t('Un assistant d’Hermes, avec sa mémoire, ses skills, son modèle et ses clés. Une instance peut en avoir plusieurs, chacun pour un métier.') },
  { id: 'session', term: t('Session'), text: t('Une conversation avec un agent. Elle garde tout son historique : vous pouvez la reprendre plus tard.') },
  { id: 'dossier', term: t('Dossier'), hermes: 'workspace', text: t('Un espace de travail : ses fichiers, ses sessions et l’agent qui y travaille. Un dossier par sujet évite de mélanger les fichiers.') },
  { id: 'run', term: t('Run'), text: t('Un tour de travail de l’agent : de votre message jusqu’à sa réponse, avec toutes les étapes entre les deux.') },
  { id: 'approbation', term: t('Approbation'), text: t('Avant une action sensible (une commande, une suppression), l’agent s’arrête et vous demande votre accord. Rien ne part sans votre réponse.') },
  { id: 'sous-agent', term: t('Sous-agent'), hermes: 'delegation', text: t('Un agent peut confier une partie du travail à d’autres agents, qui lui rendent leur résultat. Intendia relance l’agent quand ils ont fini.') },
  { id: 'objectif', term: t('Objectif'), hermes: '/goal', text: t('Un but que l’agent poursuit sur plusieurs tours sans que vous le relanciez, dans la limite d’un budget que vous fixez.') },
  { id: 'planification', term: t('Planification'), hermes: 'cron', text: t('Une consigne envoyée à l’agent à heure fixe ou à intervalle régulier. Le résultat arrive là où vous le demandez (Intendia, Telegram…).') },
  { id: 'tache', term: t('Tâche et mission'), hermes: 'kanban', text: t('Une tâche est un travail confié à un agent sur le tableau des tâches. Une mission est un objectif qu’Hermes découpe en tâches, que vous relisez avant de les lancer.') },
  { id: 'skill', term: t('Skill'), text: t('Un savoir-faire que l’agent charge quand il en a besoin : des instructions, parfois des scripts. Vous pouvez en installer ou en écrire.') },
  { id: 'toolset', term: t('Toolset'), text: t('Un groupe d’outils que l’agent a le droit d’utiliser : le web, le terminal, les fichiers… Décocher un toolset retire ces outils à l’agent.') },
  { id: 'mcp', term: t('MCP'), text: t('Une façon standard de brancher un service extérieur (agenda, base de données, outil métier) sur l’agent, qui y gagne de nouveaux outils.') },
  { id: 'fournisseur', term: t('Fournisseur et modèle'), text: t('Le fournisseur est le service qui fait tourner l’IA (Anthropic, OpenAI, OpenRouter, un serveur local…). Le modèle est l’IA choisie chez lui : plus ou moins rapide, capable et chère.') },
  { id: 'passerelle', term: t('Passerelle'), hermes: 'gateway', text: t('Le programme d’Hermes qui fait vivre un agent : il porte le chat, les planifications et les messageries (Telegram, Discord…). L’arrêter arrête tout cela ; la redémarrer applique certains réglages.') },
  { id: 'api-server', term: t('API server'), text: t('La porte par laquelle Intendia parle à un agent d’Hermes (port 8642). Elle est protégée par une clé, que vous donnez à Intendia.') },
  { id: 'dashboard', term: t('Dashboard d’Hermes'), text: t('La console d’administration d’Hermes (port 9119). Intendia passe par elle pour les réglages, les fichiers, les planifications et les skills.') },
  { id: 'garde-fous', term: t('Garde-fous'), text: t('Des limites qui empêchent un agent de s’emballer : nombre d’étapes, budget de temps, arrêt quand il tourne en rond, actions soumises à votre accord.') },
  { id: 'yaml', term: t('YAML'), text: t('Le fichier de configuration d’Hermes, en texte. Les formulaires d’Intendia l’écrivent pour vous ; l’onglet YAML sert aux réglages qui n’ont pas de formulaire.') },
  { id: 'variables', term: t('Variables'), hermes: '.env', text: t('Les clés et les mots de passe des services qu’utilise l’agent, rangés à part de la configuration. Intendia ne les affiche jamais en clair.') },
  { id: 'compatibilite', term: t('Compatibilité'), text: t('Intendia vérifie ce que votre version d’Hermes sait faire. Une fonction qu’Hermes n’a pas (ou plus) est fermée proprement au lieu de tomber en panne ; la page État dit laquelle et pourquoi.') },
];

const BY_ID = new Map(GLOSSARY.map((g) => [g.id, g]));
export type TermId = 'instance' | 'agent' | 'session' | 'dossier' | 'run' | 'approbation' | 'sous-agent' | 'objectif' | 'planification' | 'tache'
  | 'skill' | 'toolset' | 'mcp' | 'fournisseur' | 'passerelle' | 'api-server' | 'dashboard' | 'garde-fous' | 'yaml' | 'variables' | 'compatibilite';

export function term(id: TermId): Term {
  return BY_ID.get(id)!;
}
