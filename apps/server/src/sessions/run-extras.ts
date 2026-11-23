// What a run adds to the session's instructions for this message only: skills asked by `/use` (option 8).
import { msg } from '../i18n/index.js';
import type { SkillService } from '../skills/service.js';
import { NotFoundError, type SessionContext } from '../workspaces/service.js';

export const SKILLS_MAX = 3;
/** characters of a skill put in the instructions; beyond, the start and a pointer to skill_view */
export const SKILL_CHARS = 12_000;

export class RunExtrasError extends Error {
  readonly status = 400;
  constructor(readonly code: 'skill_not_found', message: string) {
    super(message);
  }
}

export async function skillBlocks(skills: SkillService, ctx: SessionContext, names: string[]): Promise<string[]> {
  return Promise.all(names.map(async (name) => {
    let s: { content: string; truncated: boolean };
    try {
      s = await skills.content(ctx.instance.id, ctx.profile, name);
    } catch (err) {
      if (err instanceof NotFoundError) throw new RunExtrasError('skill_not_found', msg('Skill introuvable chez l’agent : {name}', { name }));
      throw err;
    }
    const cut = s.truncated || s.content.length > SKILL_CHARS;
    return [
      `[Intendia] Skill demandé pour ce message : ${name}`,
      cut ? s.content.slice(0, SKILL_CHARS) : s.content,
      ...(cut ? [`(Début du skill seulement. Lis la suite du skill ${name} avec l'outil skill_view avant de répondre.)`] : []),
    ].join('\n');
  }));
}
