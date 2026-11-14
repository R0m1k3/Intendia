import { locale, t } from '../i18n';

/**
 * File paths written in the chat. Candidates are only shown as chips once the server confirms
 * they exist (POST …/files/exists), so a loose match costs nothing but one lookup.
 */

const CHARS = "[^\\s`'\"<>()\\[\\]{}|*]";
const TRAILING = /[.,;:!?]+$/;
const RELATIVE = new RegExp(`(?<![\\w/.:~-])(?:(?:files|inbox|sessions)/${CHARS}+|AGENTS\\.md)`, 'g');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface MountInfo {
  /** Root of the workspaces of the instance, as the agent sees it; null when the instance has none. */
  root: string | null;
}

/** Absolute paths under the workspace root, and paths relative to the workspace (files/, inbox/, sessions/, AGENTS.md). */
export function findPathCandidates(text: string, m: MountInfo): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    const p = raw.replace(TRAILING, '').replace(/\/+$/, '');
    if (p && !/^(files|inbox|sessions)$/.test(p)) found.add(p);
  };
  const bases = m.root ? [m.root.replace(/\/+$/, '')] : [];
  for (const base of bases) {
    const re = new RegExp(`(?<![\\w/.:~-])${escapeRe(base)}/${CHARS}+`, 'g');
    for (const match of text.matchAll(re)) add(match[0]);
  }
  for (const match of text.matchAll(RELATIVE)) add(match[0]);
  return [...found];
}

export type FileKind =
  | 'image' | 'pdf' | 'markdown' | 'html' | 'svg' | 'audio' | 'video'
  | 'csv' | 'diff' | 'docx' | 'xlsx' | 'pptx' | 'excalidraw' | 'text' | 'other';

const KINDS: [FileKind, RegExp][] = [
  ['svg', /\.svg$/i],
  ['image', /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i],
  ['pdf', /\.pdf$/i],
  ['markdown', /\.(md|markdown)$/i],
  ['html', /\.html?$/i],
  ['audio', /\.(mp3|wav|ogg|m4a|flac)$/i],
  ['video', /\.(mp4|webm|mov)$/i],
  ['csv', /\.(csv|tsv)$/i],
  ['diff', /\.(diff|patch)$/i],
  ['docx', /\.docx$/i],
  ['xlsx', /\.xlsx$/i],
  ['pptx', /\.pptx$/i],
  ['excalidraw', /\.excalidraw$/i],
  ['text', /(\.(txt|log|json|jsonl|ya?ml|toml|ini|xml|css|m?[jt]sx?|cjs|py|sh|rs|go|java|c|h|cpp|rb|php|sql|env)$)|(^|\/)(readme|license|makefile|dockerfile)$/i],
];

export function fileKind(name: string): FileKind {
  return KINDS.find(([, re]) => re.test(name))?.[0] ?? 'other';
}

/** Read as text (preview and « Modifier »). */
export const isText = (kind: FileKind) => kind === 'text' || kind === 'markdown' || kind === 'csv' || kind === 'diff';

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function formatSize(n: number): string {
  if (n < 1024) return t('{n} o', { n });
  if (n < 1024 * 1024) return t('{n} Ko', { n: (n / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 }) });
  return t('{n} Mo', { n: (n / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 }) });
}
