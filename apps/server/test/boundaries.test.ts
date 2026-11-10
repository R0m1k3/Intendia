import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureName as fakeName } from 'fake-hermes';
import { fixtureName } from '../src/cli/fixtures.js';

const SRC = resolve(import.meta.dirname, '../src');
const ALLOWED = ['hermes/', 'connectors/', 'compat/', 'cli/', 'app.ts'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architecture rules', () => {
  it('only connectors, compat and the CLI talk to Hermes (hermes/http.ts)', () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !ALLOWED.some((a) => f.startsWith(a)))
      .filter((f) => /from ['"][./]*(\.\.\/)*hermes\/http\.js['"]/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no module reads Hermes files or imports its code', () => {
    const offenders = files(SRC).filter((f) => /config\.yaml|state\.db|gateway_state\.json|hermes_cli/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('probe and fake-hermes name fixtures the same way', () => {
    for (const [m, p] of [['GET', '/v1/capabilities'], ['GET', '/api/plugins/kanban/board'], ['POST', '/api/skills/hub/search']]) {
      expect(fakeName(m!, p!)).toBe(fixtureName(m!, p!));
    }
  });
});
