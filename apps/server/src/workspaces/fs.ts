/**
 * Workspace folders on the volume shared with the agent. The slug regex (no "/" nor "..") and the
 * administrator-set mount are the only path inputs in phase 2; user-chosen paths come in phase 3.
 */
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const AGENTS_MD_MAX_BYTES = 65_536;
export const FRAMING_MAX_BYTES = 4_096;
const DIR_MODE = 0o775;
const FILE_MODE = 0o664;

export class WorkspaceFsError extends Error {
  constructor(readonly code: 'mount' | 'exists' | 'too_large', message: string) {
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

function mkdirShared(path: string): void {
  mkdirSync(path);
  chmodSync(path, DIR_MODE); // mkdir applies the umask; force group write for the agent
}

function writeShared(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, FILE_MODE);
}

/** Creates {mount}/{slug}/ with files/, inbox/, sessions/ and AGENTS.md; leaves nothing behind on failure. */
export function createWorkspaceDir(mount: string, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug ${slug}`);
  try {
    if (!statSync(mount).isDirectory()) throw new Error('not a directory');
    accessSync(mount, constants.W_OK);
  } catch {
    throw new WorkspaceFsError('mount', `Dossier ${mount} introuvable ou non inscriptible`);
  }
  const dir = join(mount, slug);
  try {
    mkdirShared(dir); // not recursive: fails if the name exists, symbolic links included
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceFsError('exists', `Le dossier ${dir} existe déjà`);
    throw new WorkspaceFsError('mount', `Impossible de créer ${dir} : ${(err as Error).message}`);
  }
  try {
    for (const sub of ['files', 'inbox', 'sessions']) mkdirShared(join(dir, sub));
    writeShared(join(dir, 'AGENTS.md'), AGENTS_MD_TEMPLATE);
  } catch (err) {
    removeWorkspaceDir(dir);
    throw new WorkspaceFsError('mount', `Impossible de préparer ${dir} : ${(err as Error).message}`);
  }
  return dir;
}

export function removeWorkspaceDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function createSessionDir(wsDir: string, sessionId: string): void {
  try {
    mkdirShared(join(wsDir, 'sessions', sessionId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

export function readAgentsMd(wsDir: string): string {
  try {
    return readFileSync(join(wsDir, 'AGENTS.md'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

export function writeAgentsMd(wsDir: string, text: string): void {
  if (Buffer.byteLength(text, 'utf8') > AGENTS_MD_MAX_BYTES) {
    throw new WorkspaceFsError('too_large', `AGENTS.md dépasse ${AGENTS_MD_MAX_BYTES / 1024} Kio`);
  }
  writeShared(join(wsDir, 'AGENTS.md'), text);
}

/** AGENTS.md as copied into the run instructions: at most 4 KiB, cut on a UTF-8 character boundary. */
export function framingAgentsMd(text: string, agentPath: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= FRAMING_MAX_BYTES) return text.trimEnd();
  let end = FRAMING_MAX_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1; // back off continuation bytes
  return `${bytes.subarray(0, end).toString('utf8').trimEnd()}\n(suite tronquée : lis ${agentPath}/AGENTS.md en entier avant de commencer)`;
}
