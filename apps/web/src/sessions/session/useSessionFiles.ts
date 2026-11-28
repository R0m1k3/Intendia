// Files around the thread: paths cited by the agent and its tools (checked by the server, opened in the side
// panel), files written by the agent, and the uploads / archives joined to a message.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, type RefObject } from 'react';
import { api, rawUrl, type ChatMessage } from '../../api';
import { artifactPaths } from '../../chat/artifacts';
import { splitAttachments } from '../../chat/attachments';
import type { ComposerHandle, ExtractArchive, Upload } from '../../chat/Composer';
import { historyEntries, type Entry } from '../../chat/events';
import { writtenPaths } from '../../chat/written';
import { confirmClose } from '../../components/dirty';
import type { FilePathsValue } from '../../files/FilePaths';
import { findPathCandidates } from '../../files/paths';
import { uploadFiles } from '../../files/upload';
import type { useSessionData } from './useSessionData';
import type { SidePanel } from './useSidePanel';

export type SessionFilesState = ReturnType<typeof useSessionFiles>;

export function useSessionFiles({ slug, entries, messages, mounts, runCount, side, composer }: {
  slug: string;
  entries: Entry[];
  messages: ChatMessage[];
  /** the session's instance as listed (its files' root) */
  mounts: ReturnType<typeof useSessionData>['mounts'];
  /** runs ended on this page: the paths are checked again after each */
  runCount: number;
  side: Pick<SidePanel, 'setPanel' | 'setPreviewPath'>;
  composer: RefObject<ComposerHandle | null>;
}) {
  const qc = useQueryClient();
  const { setPanel, setPreviewPath } = side;
  // files written by the agent (stored write_file / patch calls), most recent first; from the whole stored history
  // (during a run, the merged entries hide its stored messages behind the live ones)
  const written = useMemo(() => writtenPaths(historyEntries(messages)), [messages]);
  // Paths cited by the assistant and the tools; the server says which exist (one lookup per new set).
  const candidates = useMemo(() => {
    if (!mounts) return [];
    const text = entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind === 'tool' ? `${e.preview ?? ''}\n${e.result ?? ''}` : e.kind === 'subagents' ? e.nodes.map((n) => n.summary ?? '').join('\n') : '')).join('\n');
    const m = { root: mounts.files?.workspaceRoot ?? null };
    // artefacts first: never cut by the 200 checked
    const pages = entries.flatMap((e) => (e.kind === 'assistant' ? artifactPaths(e.text) : []));
    const cited = findPathCandidates(text, m).sort();
    // files joined to the user's messages come after, so they never push the agent's out of the 200 checked
    const joined = entries.flatMap((e) => (e.kind === 'user' ? splitAttachments(e.text, m).files : []));
    return [...new Set([...pages, ...written.map((w) => w.path), ...cited, ...joined])];
  }, [entries, mounts, written]);
  const exists = useQuery({
    queryKey: ['exists', slug, candidates.join('\n'), runCount],
    queryFn: () => api.filesExist(slug, candidates.slice(0, 200)),
    enabled: candidates.length > 0,
    staleTime: 60_000,
    // the chips and artefacts already found stay while a new set of paths is checked
    placeholderData: keepPreviousData,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setPanel` and `setPreviewPath` (state setters) from the page, stable: same dependencies as when this code was in pages/Session.tsx
  const filePaths = useMemo<FilePathsValue>(() => {
    const found = new Map<string, string>();
    for (const [written, hit] of Object.entries(exists.data?.results ?? {})) if (hit?.kind === 'file') found.set(written, hit.path);
    return {
      found, open: (path) => void confirmClose(() => { setPreviewPath(path); setPanel(true); }), slug,
      pending: exists.isFetching && !exists.data,
      mounts: mounts ? { root: mounts.files?.workspaceRoot ?? null } : null,
    };
  }, [exists.data, exists.isFetching, slug, mounts]);
  const cited = useMemo(() => [...new Set(filePaths.found.values())], [filePaths]);
  const modified = useMemo(() => written.map((w) => ({ ...w, rel: w.op === 'delete' ? null : filePaths.found.get(w.path) ?? null })), [written, filePaths]);
  const agentRoot = mounts?.files?.workspaceRoot ? `${mounts.files.workspaceRoot.replace(/\/+$/, '')}/${slug}` : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `composer` (a ref) from the page, stable: same dependencies as when this code was in pages/Session.tsx
  const insert = useCallback((path: string) => composer.current?.insert(path), []);

  const upload = useCallback<Upload>(async (file) => {
    const [done] = await uploadFiles(slug, 'inbox', [file]);
    void qc.invalidateQueries({ queryKey: ['tree', slug] });
    return { agentPath: done!.agentPath, url: rawUrl(slug, done!.path), path: done!.path };
  }, [slug, qc]);
  const extract = useCallback<ExtractArchive>(async (path) => {
    const r = await api.extractArchive(slug, path);
    void qc.invalidateQueries({ queryKey: ['tree', slug] });
    return r;
  }, [slug, qc]);
  const addFiles = (f: File[]) => composer.current?.addFiles(f);

  return { filePaths, cited, modified, agentRoot, insert, upload, extract, addFiles };
}
