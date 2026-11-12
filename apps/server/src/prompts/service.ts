// Prompts saved by the user (kind 'prompt': inserted in the composer) and personalities written in Intendia
// (kind 'personality'). Shared by every instance: a text, not a Hermes setting.
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { prompts } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';

export const PROMPT_KINDS = ['prompt', 'personality'] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];
export const PROMPT_TITLE_MAX = 80;
export const PROMPT_BODY_MAX = 20_000;
export const PROMPTS_MAX = 500;

export interface Prompt {
  id: string;
  kind: PromptKind;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

const clean = (title: string) => {
  const t = title.trim();
  if (!t) throw new ValidationError('Titre vide');
  if (t.length > PROMPT_TITLE_MAX) throw new ValidationError(`Titre de plus de ${PROMPT_TITLE_MAX} caractères`);
  return t;
};
const checkBody = (body: string) => {
  if (!body.trim()) throw new ValidationError('Texte vide');
  if (body.length > PROMPT_BODY_MAX) throw new ValidationError(`Texte de plus de ${PROMPT_BODY_MAX} caractères`);
  return body;
};

export class PromptService {
  constructor(private readonly db: Db) {}

  list(kind?: PromptKind): Prompt[] {
    const q = this.db.select().from(prompts);
    const rows = kind ? q.where(eq(prompts.kind, kind)).orderBy(asc(prompts.title)).all() : q.orderBy(asc(prompts.title)).all();
    return rows as Prompt[];
  }

  get(id: string, kind?: PromptKind): Prompt {
    const row = this.db.select().from(prompts).where(kind ? and(eq(prompts.id, id), eq(prompts.kind, kind)) : eq(prompts.id, id)).get();
    if (!row) throw new NotFoundError('Prompt introuvable');
    return row as Prompt;
  }

  create(input: { kind: PromptKind; title: string; body: string }): Prompt {
    if (this.list().length >= PROMPTS_MAX) throw new ValidationError(`Plus de ${PROMPTS_MAX} prompts enregistrés`);
    const now = Date.now();
    const row: Prompt = { id: randomUUID(), kind: input.kind, title: clean(input.title), body: checkBody(input.body), createdAt: now, updatedAt: now };
    this.db.insert(prompts).values(row).run();
    return row;
  }

  update(id: string, patch: { title?: string; body?: string }): Prompt {
    const cur = this.get(id);
    const next = {
      title: patch.title === undefined ? cur.title : clean(patch.title),
      body: patch.body === undefined ? cur.body : checkBody(patch.body),
      updatedAt: Date.now(),
    };
    this.db.update(prompts).set(next).where(eq(prompts.id, id)).run();
    return { ...cur, ...next };
  }

  remove(id: string): void {
    this.get(id);
    this.db.delete(prompts).where(eq(prompts.id, id)).run();
  }
}
