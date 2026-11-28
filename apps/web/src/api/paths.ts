import type { GitDiffWhich } from './types/files';

export const enc = encodeURIComponent;
export const kanbanPath = (inst: string, sub: string, board?: string, extra: Record<string, string> = {}) =>
  `/i/${encodeURIComponent(inst)}/kanban/${sub}${board || Object.keys(extra).length ? `?${new URLSearchParams({ ...(board ? { board } : {}), ...extra })}` : ''}`;
export const sessionPath = (inst: string, id: string) => `/sessions/${enc(inst)}/${enc(id)}`;
export const cronsPath = (inst: string) => `/i/${enc(inst)}/crons`;
export const cronPath = (inst: string, id: string, profile: string, sub?: string) =>
  `${cronsPath(inst)}/${enc(id)}${sub ? `/${sub}` : ''}?profile=${enc(profile)}`;
/** `?profile=` left out for the default profile. */
export const profileParam = (profile: string) => (profile === 'default' ? undefined : profile);
/** Per-instance console route with ?profile= (skills, agents). */
export const instPath = (inst: string, sub: string, profile?: string, extra?: Record<string, string>) => {
  const q = new URLSearchParams({ ...(profile ? { profile } : {}), ...extra }).toString();
  return `/i/${enc(inst)}/${sub}${q ? `?${q}` : ''}`;
};
export const filesPath = (slug: string) => `/workspaces/${enc(slug)}/files`;
export const gitPath = (slug: string) => `/workspaces/${enc(slug)}/git`;
/** URL of a file's content (preview, download); served with CSP sandbox (scripts allowed for an artefact). */
export const rawUrl = (slug: string, path: string, download = false, artifact = false) =>
  `/x${filesPath(slug)}/raw?path=${enc(path)}${download ? '&download=1' : ''}${artifact ? '&artefact=1' : ''}`;
/** Diff of one file of a repository, as text (read by DiffView). */
export const gitDiffUrl = (slug: string, repo: string, file: string, which: GitDiffWhich) =>
  `/x${gitPath(slug)}/diff?repo=${enc(repo)}&file=${enc(file)}&which=${which}`;
/** A folder as a zip (built while sent; `<folder>.zip`, `<slug>.zip` for the root). */
export const zipUrl = (slug: string, path: string) => `/x${filesPath(slug)}/zip?path=${enc(path)}`;
export const instanceZipUrl = (inst: string, path: string) => `/x/i/${enc(inst)}/files/zip?path=${enc(path)}`;
/** URL of a file of an instance's file root (read only page « Fichiers »). */
export const instanceRawUrl = (inst: string, path: string, download = false) =>
  `/x/i/${enc(inst)}/files/raw?path=${enc(path)}${download ? '&download=1' : ''}`;
/** URL of a run's SSE stream (EventSource). */
/** `lastSeq`: a new EventSource resumes after that event (the server passes it as Last-Event-ID). */
export const runEventsUrl = (inst: string, id: string, runId: string, lastSeq?: number) =>
  `/x${sessionPath(inst, id)}/runs/${enc(runId)}/events${lastSeq !== undefined ? `?lastSeq=${lastSeq}` : ''}`;
