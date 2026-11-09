import type { Skill } from '../api';

export type StateFilter = 'all' | 'on' | 'off';
export interface SkillFilter { text: string; category: string; state: StateFilter }

export const PROVENANCE_LABEL: Record<string, string> = {
  bundled: 'fourni',
  hub: 'hub',
  external: 'externe',
  agent: "créé par l'agent",
};

export const provenanceLabel = (p: string | null) => (p ? PROVENANCE_LABEL[p] ?? p : 'origine inconnue');

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function filterSkills(skills: Skill[], f: SkillFilter): Skill[] {
  const words = fold(f.text).split(/\s+/).filter(Boolean);
  return skills.filter((s) => {
    if (f.category && (s.category ?? '') !== f.category) return false;
    if (f.state === 'on' && s.enabled === false) return false;
    if (f.state === 'off' && s.enabled !== false) return false;
    const hay = fold(`${s.name} ${s.description ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Categories sorted by name (uncategorised last), skills by name inside each. */
export function groupByCategory(skills: Skill[]): { category: string; skills: Skill[] }[] {
  const groups = new Map<string, Skill[]>();
  for (const s of skills) {
    const c = s.category ?? '';
    groups.set(c, [...(groups.get(c) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([category, list]) => ({ category, skills: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export const categories = (skills: Skill[]) => [...new Set(skills.map((s) => s.category).filter((c): c is string => Boolean(c)))].sort();
