import { isMap, isPair, isScalar, isSeq, parseDocument, visit, type Document, type Scalar } from 'yaml';
import { sign } from '../crypto.js';

/**
 * Secret masking for everything Intendia sends to the browser about an instance's configuration.
 * Hermes' dashboard returns its config without masking (`${VAR}` references even come back resolved), so
 * the Intendia server replaces each secret by `«secret:<id>»`, where <id> is a short HMAC of the value:
 * the same secret always gets the same id, which lets the YAML editor put secrets back (by id, not by
 * position) and lets a diff show that a secret changed, without the value ever leaving the server.
 *
 * The rules are patterns (key names, sections, token prefixes, URLs): a secret written in clear under an
 * innocuous key, without a known prefix, is not detected. Numbers and booleans are never masked.
 */

export const PLACEHOLDER_RE = /«secret:([0-9a-f]{8})»/g;
export const PLACEHOLDER_START = '«secret:';

const SECRET_KEY_RE = /(api[_-]?key|apikey|access[_-]?key|token|secret|passw(?:or)?d|authorization|credential|cookie|private[_-]?key|bearer)/i;
/** Keys that name a secret but hold something else: an env variable name, a store kind, a token count... */
const NOT_SECRET_KEY_RE = /(_env|_env_var|_source|_store|_tokens|_mode|_type|_file|_path)$/i;
const TOKEN_PREFIX = '(?:sk-|sk_|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abprs]-|AKIA|AIza|hf_|glpat-|pk_live_|rk_live_)';
const TOKEN_WHOLE_RE = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_\\-]{6,}`);
const TOKEN_ANY_RE = new RegExp(`${TOKEN_PREFIX}[A-Za-z0-9_\\-]{6,}`, 'g');
const TELEGRAM_WHOLE_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
const TELEGRAM_ANY_RE = /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g;
const ENV_REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const URL_RE = /^https?:\/\//i;
/** Known secret values shorter than this are not replaced (too many false hits). */
export const KNOWN_MIN = 8;
/** Absolute host paths of two segments or more, not inside a URL or a relative path. */
const HOST_PATH_RE = /(?<![\w.:/~-])\/(?:[\w.@+-]+\/)+([\w.@+-]+)/g;

/** Shortens absolute host paths to their last segment: `/opt/data/skills/x/SKILL.md` → `…/SKILL.md`. */
export function hostPaths(text: string): string {
  return text.replace(HOST_PATH_RE, (_, last: string) => `…/${last}`);
}
const URL_ANY_RE = /https?:\/\/[^\s"'<>`]+/gi;
/** Webhook URLs whose path is the credential. */
const WEBHOOK_PATH_RE = /^(https?:\/\/(?:hooks\.slack\.com\/services\/|(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot))([^?#\s]+)/i;

export type PathKey = string | number;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) && !NOT_SECRET_KEY_RE.test(key);
}

export function looksLikeToken(value: string): boolean {
  return TOKEN_WHOLE_RE.test(value) || TELEGRAM_WHOLE_RE.test(value);
}

/** Nearest mapping key of a path (list indices skipped). */
function nearestKey(path: PathKey[]): string | undefined {
  for (let i = path.length - 1; i >= 0; i--) if (typeof path[i] === 'string') return path[i] as string;
  return undefined;
}

/** Is a string at this path a secret as a whole (key rule, section rule or token shape)? */
export function isSecretPosition(path: PathKey[], value: string): boolean {
  if (value === '' || ENV_REF_RE.test(value)) return false;
  if (looksLikeToken(value)) return true;
  const key = nearestKey(path);
  if (key !== undefined && isSecretKey(key)) return true;
  if (path[0] === 'mcp_servers' && (path[2] === 'headers' || path[2] === 'env') && path.length > 3) return true;
  return path.slice(0, -1).includes('extra_headers');
}

export function pathString(path: PathKey[]): string {
  return path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i === 0 ? k : `.${k}`)).join('');
}

export class SecretError extends Error {
  constructor(readonly code: 'secret_placeholder' | 'secret_moved' | 'invalid_yaml', message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SecretError';
  }
}

type Found = (id: string, fragment: string) => void;

interface ScalarEdit { start: number; end: number; text: string }

export class Masker {
  constructor(private readonly secret: string) {}

  id(value: string): string {
    return sign(this.secret, value, { purpose: 'config-secret-id-v1', encoding: 'hex' }).slice(0, 8);
  }

  private token(fragment: string, found?: Found): string {
    const id = this.id(fragment);
    found?.(id, fragment);
    return `«secret:${id}»`;
  }

  /** Masks the credential parts of a URL: password, query values, webhook paths. */
  url(url: string, found?: Found): string {
    let out = url;
    const hook = WEBHOOK_PATH_RE.exec(out);
    if (hook) out = hook[1] + this.token(hook[2]!, found) + out.slice(hook[0].length);
    out = out.replace(/^(https?:\/\/[^/@\s:]+:)([^@/\s]+)@/i, (_, a: string, pw: string) => `${a}${this.token(pw, found)}@`);
    const q = out.indexOf('?');
    if (q >= 0) {
      const hash = out.indexOf('#', q);
      const query = out.slice(q + 1, hash >= 0 ? hash : undefined);
      const masked = query.split('&').map((part) => {
        const eq = part.indexOf('=');
        if (eq < 0 || eq === part.length - 1 || part.slice(eq + 1).startsWith(PLACEHOLDER_START)) return part;
        return part.slice(0, eq + 1) + this.token(part.slice(eq + 1), found);
      }).join('&');
      out = out.slice(0, q + 1) + masked + (hash >= 0 ? out.slice(hash) : '');
    }
    return out;
  }

  /** Masks one string value found at `path` of the configuration. */
  string(path: PathKey[], value: string, found?: Found): string {
    if (value.includes(PLACEHOLDER_START)) return value;
    if (isSecretPosition(path, value)) return this.token(value, found);
    if (URL_RE.test(value)) return this.url(value, found);
    return value;
  }

  /** Deep copy of a configuration object with every secret string masked. */
  config<T>(value: T, path: PathKey[] = []): T {
    if (typeof value === 'string') return this.string(path, value) as T;
    if (Array.isArray(value)) return value.map((v, i) => this.config(v, [...path, i])) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.config(v, [...path, k])])) as T;
    }
    return value;
  }

  /** Masks free text coming from Hermes (error messages, logs, notices). `found` gets every masked fragment. */
  text(text: string, found?: Found): string {
    let out = text.replace(URL_ANY_RE, (u) => this.url(u, found));
    out = out.replace(/\b(Bearer|Basic|Token)(\s+)([A-Za-z0-9._~+/=-]{6,})/g, (m, a: string, sp: string, v: string) =>
      (v.startsWith(PLACEHOLDER_START) ? m : `${a}${sp}${this.token(v, found)}`));
    // command-line flags: `--token abc`, `--api-key=abc` (auth commands of plugins, MCP servers)
    out = out.replace(/(?<![\w-])(--?[A-Za-z][A-Za-z0-9_-]*)(\s+|=)(["']?)([^\s"'«-][^\s"']*)/g, (m, flag: string, sep: string, q: string, v: string) =>
      (isSecretKey(flag.replace(/^-+/, '').replace(/-/g, '_')) && !/^\d+$/.test(v) ? `${flag}${sep}${q}${this.token(v, found)}` : m));
    // (?<!«): the «secret:<id>» placeholders written above are not a `secret: value` pair
    out = out.replace(/(?<![«A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(["']?)([^\s"',;&)]+)/g, (m, key: string, sep: string, q: string, v: string) => {
      if (!isSecretKey(key.split('.').pop()!) || /^\d+(\.\d+)?$/.test(v) || v.includes('«') || /^(Bearer|Basic|Token)$/.test(v)) return m;
      return `${key}${sep}${q}${this.token(v, found)}`;
    });
    out = out.replace(TOKEN_ANY_RE, (t) => this.token(t, found));
    return out.replace(TELEGRAM_ANY_RE, (t) => this.token(t, found));
  }

  /** Replaces every exact occurrence of a known secret value (longest first) by its placeholder. */
  known(text: string, values: readonly string[]): string {
    let out = text;
    for (const v of [...values].sort((a, b) => b.length - a.length)) {
      if (v.length >= KNOWN_MIN && out.includes(v)) out = out.split(v).join(this.token(v));
    }
    return out;
  }

  /**
   * Puts the secrets of `current` (free text, masked with `text()`) back into a draft that holds `«secret:<id>»`
   * placeholders. Ids are HMACs of the fragment, so a moved secret is found again. A restored secret must still be
   * hidden by `text()`: moved out of its context (`password: …` → plain prose), it would be shown in clear later.
   */
  restoreText(draft: string, current: string): string {
    if (!draft.includes(PLACEHOLDER_START)) return draft;
    const sources = new Map<string, string>();
    this.text(current, (id, fragment) => sources.set(id, fragment));
    const restored: string[] = [];
    const out = draft.replace(PLACEHOLDER_RE, (_, id: string) => {
      const fragment = sources.get(id);
      if (fragment === undefined) throw new SecretError('secret_placeholder', 'Valeur masquée inconnue : rechargez le texte', {});
      restored.push(fragment);
      return fragment;
    });
    const remasked = this.text(out);
    if (restored.some((f) => remasked.includes(f))) {
      throw new SecretError('secret_moved', 'Un secret masqué a été déplacé à un endroit affiché en clair', {});
    }
    return out;
  }

  /** Masks the secret scalars of a YAML text in place, keeping comments and layout. */
  yaml(text: string): string {
    const doc = parse(text);
    if (doc.errors.length) return text.split('\n').map((l) => this.text(l)).join('\n');
    const edits: ScalarEdit[] = [];
    eachValue(doc, (node, path) => {
      if (typeof node.value !== 'string' || !node.range) return;
      const masked = this.string(path, node.value);
      if (masked !== node.value) edits.push({ start: node.range[0], end: node.range[1], text: JSON.stringify(masked) });
    });
    return splice(text, edits);
  }

  /** id → secret fragment of every masked value of a YAML text (the current file, unmasked). */
  sources(text: string): Map<string, string> {
    const map = new Map<string, string>();
    const doc = parse(text);
    if (doc.errors.length) return map;
    eachValue(doc, (node, path) => {
      if (typeof node.value === 'string') this.string(path, node.value, (id, fragment) => map.set(id, fragment));
    });
    return map;
  }

  /**
   * Puts the secrets of `current` back into a draft that holds `«secret:<id>»` placeholders. Matching is by id,
   * so a moved line or a reordered list keeps its value. A restored secret must land where the masking rules
   * hide it again: a secret cannot be moved under a key shown in clear.
   */
  restore(draft: string, current: string): string {
    const doc = parse(draft);
    if (doc.errors.length) {
      const pos = doc.errors[0]!.linePos?.[0];
      throw new SecretError('invalid_yaml', 'YAML invalide', { line: pos?.line ?? null, column: pos?.col ?? null });
    }
    if (doc.contents !== null && !isMap(doc.contents)) {
      throw new SecretError('invalid_yaml', 'Le document doit être une table', { line: 1, column: 1 });
    }
    const sources = this.sources(current);
    const edits: ScalarEdit[] = [];
    eachValue(doc, (node, path) => {
      if (typeof node.value !== 'string' || !node.value.includes(PLACEHOLDER_START) || !node.range) return;
      const restored: string[] = [];
      const value = node.value.replace(PLACEHOLDER_RE, (_, id: string) => {
        const fragment = sources.get(id);
        if (fragment === undefined) {
          throw new SecretError('secret_placeholder', `Valeur masquée inconnue à ${pathString(path)}`, { path: pathString(path) });
        }
        restored.push(fragment);
        return fragment;
      });
      const remasked = this.string(path, value);
      if (restored.some((f) => remasked.includes(f))) {
        throw new SecretError('secret_moved', `Un secret ne peut pas être placé à ${pathString(path)}, qui est affiché en clair`, { path: pathString(path) });
      }
      edits.push({ start: node.range[0], end: node.range[1], text: JSON.stringify(value) });
    });
    return splice(draft, edits);
  }
}

// PyYAML's float resolver needs a digit (the `yaml` library reads `.` as NaN and `e5` as a number)
const PY_FLOAT = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*|\.[0-9][0-9_]*)$/;
const PY_FLOAT_EXP = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*|\.[0-9][0-9_]*)[eE][-+][0-9]+$/;
type Tag = { tag: string; format?: string; test?: RegExp };
export const pyTags = <T extends Tag>(tags: T[]): T[] => tags.map((t) => {
  if (t.tag !== 'tag:yaml.org,2002:float' || !t.test || t.format === 'NAN' || t.test.test('.nan')) return t;
  return { ...t, test: t.format === 'EXP' ? PY_FLOAT_EXP : PY_FLOAT };
});

/** YAML 1.1, like Hermes' `yaml.safe_load` (`yes`/`on` are booleans, `.` is a string). */
export function parse(text: string): Document.Parsed {
  return parseDocument(text, { version: '1.1', uniqueKeys: false, customTags: pyTags as never });
}

/** Calls `fn` for every value scalar (not mapping keys) with its path of keys and list indices. */
function eachValue(doc: Document.Parsed, fn: (node: Scalar, path: PathKey[]) => void): void {
  visit(doc, {
    Scalar(key, node, ancestors) {
      if (key === 'key') return;
      const path: PathKey[] = [];
      const chain = [...ancestors, node];
      for (let i = 0; i < ancestors.length; i++) {
        const a = ancestors[i];
        if (isPair(a)) path.push(isScalar(a.key) ? String(a.key.value) : '?');
        else if (isSeq(a)) path.push(a.items.indexOf(chain[i + 1] as never));
      }
      fn(node, path);
    },
  });
}

function splice(text: string, edits: ScalarEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    // a block scalar's range ends after its last line break: keep that break
    let end = e.end;
    while (end > e.start && (out[end - 1] === '\n' || out[end - 1] === '\r')) end--;
    out = out.slice(0, e.start) + e.text + out.slice(end);
  }
  return out;
}
