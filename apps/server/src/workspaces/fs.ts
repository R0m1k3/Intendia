/**
 * Workspace folders, kept by the Hermes of their instance and reached through its managed files API
 * (files/hermes-fs.ts). Paths built here come from the slug regex (no "/" nor "..") only; every path chosen
 * by the browser or the agent goes through files/paths.ts.
 */
import type { HermesFs } from '../files/hermes-fs.js';
import { msg } from '../i18n/index.js';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const AGENTS_MD_MAX_BYTES = 65_536;
export const FRAMING_MAX_BYTES = 4_096;

export type WorkspaceFsCode =
  | 'no_root' | 'unreachable' | 'unsupported' | 'exists' | 'too_large' | 'invalid' | 'outside' | 'not_found' | 'not_file' | 'busy';

export const FS_ERROR_STATUS: Record<WorkspaceFsCode, 400 | 403 | 404 | 409 | 413 | 422 | 502> = {
  no_root: 422, unreachable: 502, unsupported: 409, exists: 409, too_large: 413, invalid: 400, outside: 403, not_found: 404, not_file: 400, busy: 409,
};

export class WorkspaceFsError extends Error {
  constructor(readonly code: WorkspaceFsCode, message: string) {
    super(message);
    this.name = 'WorkspaceFsError';
  }
}

export const AGENTS_MD_TEMPLATE = `# Consignes du projet

Décris ici ce que l'agent doit savoir pour ce workspace : le but du projet, les conventions,
ce qu'il peut faire seul et ce qu'il doit demander avant.

## Dossiers

- \`files/\` : fichiers durables du projet
- \`inbox/\` : fichiers déposés depuis Intendia
- \`sessions/<session>/\` : fichiers produits pendant une session
`;

export const WORKSPACE_SUBDIRS = ['files', 'inbox', 'sessions'] as const;

/** Creates <root>/<slug>/ with files/, inbox/, sessions/ and AGENTS.md; leaves nothing behind on failure. */
export async function createWorkspaceDir(fs: HermesFs, slug: string): Promise<void> {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug ${slug}`);
  if (await fs.entry(slug)) throw new WorkspaceFsError('exists', msg('Le dossier {slug} existe déjà chez Hermes', { slug }));
  await fs.mkdir(slug);
  try {
    for (const sub of WORKSPACE_SUBDIRS) await fs.mkdir(`${slug}/${sub}`);
    await fs.create(`${slug}/AGENTS.md`, AGENTS_MD_TEMPLATE, { overwrite: false });
  } catch (err) {
    await fs.remove(slug, true).catch(() => undefined);
    throw err;
  }
}

export async function createSessionDir(fs: HermesFs, slug: string, sessionId: string): Promise<void> {
  await fs.mkdir(`${slug}/sessions/${sessionId}`);
}

export async function readAgentsMd(fs: HermesFs, slug: string): Promise<string> {
  try {
    return await fs.readText(`${slug}/AGENTS.md`, AGENTS_MD_MAX_BYTES * 4);
  } catch (err) {
    if (err instanceof WorkspaceFsError && err.code === 'not_found') return '';
    throw err;
  }
}

export async function writeAgentsMd(fs: HermesFs, slug: string, text: string): Promise<void> {
  if (Buffer.byteLength(text, 'utf8') > AGENTS_MD_MAX_BYTES) {
    throw new WorkspaceFsError('too_large', msg('AGENTS.md dépasse {n} Kio', { n: AGENTS_MD_MAX_BYTES / 1024 }));
  }
  await fs.create(`${slug}/AGENTS.md`, text, { overwrite: true });
}

/** AGENTS.md as copied into the run instructions: at most 4 KiB, cut on a UTF-8 character boundary. */
export function framingAgentsMd(text: string, agentPath: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= FRAMING_MAX_BYTES) return text.trimEnd();
  let end = FRAMING_MAX_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1; // back off continuation bytes
  return `${bytes.subarray(0, end).toString('utf8').trimEnd()}\n(suite tronquée : lis ${agentPath}/AGENTS.md en entier avant de commencer)`;
}
