// Finds the translation keys used in source files: first argument of t(…) / msg(…), 2nd and 3rd of plural(…),
// k of <T k=…>. Used by the completeness tests of the web and the server (and by i18n-leftovers.mjs).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function listSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dist') listSources(p, out); continue; }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Skips a string or template literal starting at i (quote char), returns the index after it. */
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (q === '`' && ch === '$' && src[j + 1] === '{') { j = skipBalanced(src, j + 1); continue; }
    if (ch === q) return j + 1;
    j++;
  }
  return j;
}

/** From an opening bracket at i, returns the index after its matching closing bracket. */
function skipBalanced(src, i) {
  const open = src[i];
  const close = { '(': ')', '{': '}', '[': ']' }[open];
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === '`') { j = skipString(src, j); continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return j;
}

/** Top-level arguments (raw text) of the call whose "(" is at i. */
function args(src, i) {
  const end = skipBalanced(src, i) - 1;
  const out = [];
  let start = i + 1;
  let j = i + 1;
  while (j < end) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === '`') { j = skipString(src, j); continue; }
    if (ch === '(' || ch === '{' || ch === '[') { j = skipBalanced(src, j); continue; }
    if (ch === ',') { out.push(src.slice(start, j)); start = j + 1; }
    j++;
  }
  const last = src.slice(start, end);
  if (last.trim()) out.push(last);
  return out;
}

/** Value of a literal argument, or null when it is not a plain literal. */
export function literal(raw) {
  const s = raw.trim();
  if (/^'(?:[^'\\\n]|\\.)*'$/s.test(s) || /^"(?:[^"\\\n]|\\.)*"$/s.test(s) || (/^`[\s\S]*`$/.test(s) && !s.includes('${'))) {
    return new Function(`return ${s}`)();
  }
  return null;
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/**
 * Keys of one source: `{ keys: [{ key, line }], bad: [{ line, text }] }` (bad = non-literal argument).
 * `fns` = names of the one-key functions (`t` on the web, `msg` on the server).
 */
export function scanSource(src, fns) {
  const keys = [];
  const bad = [];
  const re = new RegExp(`(?<![\\w.$])(${[...fns, 'plural'].join('|')})\\(|<T\\s+k=`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const at = m.index;
    // ignore comments: the line up to the match contains //
    const lineStart = src.lastIndexOf('\n', at) + 1;
    const before = src.slice(lineStart, at);
    // a comment starts with // not escaped (regex literal /^https:\/\//) and not part of a URL (https://)
    if (/(^|[^\\:/])\/\//.test(before.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')) || /^\s*\*/.test(before)) continue;
    if (m[0].startsWith('<T')) {
      const after = src.slice(at + m[0].length);
      const lit = /^("[^"]*"|\{\s*(['"`])[\s\S]*?\2\s*\})/.exec(after);
      const raw = lit ? (lit[0].startsWith('{') ? lit[0].slice(1, -1) : lit[0]) : null;
      const v = raw !== null ? literal(raw) : null;
      if (v === null) bad.push({ line: lineOf(src, at), text: after.slice(0, 60) });
      else keys.push({ key: v, line: lineOf(src, at) });
      continue;
    }
    const open = at + m[0].length - 1;
    // a declaration `function t(` or `export function plural(` is not a call
    if (/function\s*$/.test(src.slice(Math.max(0, at - 12), at))) continue;
    const a = args(src, open);
    const idx = m[1] === 'plural' ? [1, 2] : [0];
    for (const k of idx) {
      const v = a[k] !== undefined ? literal(a[k]) : null;
      if (v === null) bad.push({ line: lineOf(src, at), text: src.slice(at, at + 80).replace(/\s+/g, ' ') });
      else keys.push({ key: v, line: lineOf(src, at) });
    }
  }
  return { keys, bad };
}

export function scanFiles(files, fns) {
  return files.map((file) => {
    const src = readFileSync(file, 'utf8');
    // only files that use the i18n module (a local variable named t elsewhere is not a translation call)
    if (!/from ['"][^'"]*i18n(?:\/index(?:\.js)?|\/T)?['"]/.test(src) && !/from ['"]\.\/index['"]/.test(src)) return { file, keys: [], bad: [] };
    return { file, ...scanSource(src, fns) };
  });
}

export const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
