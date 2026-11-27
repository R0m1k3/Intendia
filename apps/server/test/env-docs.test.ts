import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_KEYS } from '../src/config.js';

const root = resolve(import.meta.dirname, '../../..');
const doc = readFileSync(join(root, 'docs/install.md'), 'utf8');
const table = doc.slice(doc.indexOf('## 5. Environment variables'));
const documented = [...table.matchAll(/^\| `(INTENDIA_[A-Z0-9_]+)` \|/gm)].map((m) => m[1]!);

/** Variables read straight from the environment, outside the configuration schema. */
function readInCode(dir: string, found = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) readInCode(path, found);
    else if (name.endsWith('.ts')) for (const m of readFileSync(path, 'utf8').matchAll(/process\.env\.(INTENDIA_[A-Z0-9_]+)/g)) found.add(m[1]!);
  }
  return found;
}

describe('docs/install.md lists the environment variables', () => {
  const read = new Set([...ENV_KEYS, ...readInCode(resolve(import.meta.dirname, '../src'))]);

  it('documents every variable the server reads', () => {
    expect([...read].filter((k) => !documented.includes(k)).sort()).toEqual([]);
  });

  it('documents no variable the server ignores, and each one once', () => {
    expect(documented.filter((k) => !read.has(k)).sort()).toEqual([]);
    expect(documented.length).toBe(new Set(documented).size);
  });

  it('.env.example names only variables the server reads', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    const named = [...example.matchAll(/^#? ?(INTENDIA_[A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((k) => !read.has(k))).toEqual([]);
  });
});
