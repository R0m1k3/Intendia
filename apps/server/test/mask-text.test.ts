import { describe, expect, it } from 'vitest';
import { hostPaths, Masker, SecretError } from '../src/hermes-config/mask.js';

const m = new Masker('test-secret-for-mask-text-0000000000');

describe('hostPaths', () => {
  it('shortens absolute host paths', () => {
    expect(hostPaths('already exists at /opt/data/skills/x/SKILL.md')).toBe('already exists at …/SKILL.md');
    expect(hostPaths('path=/root/a/b')).toBe('path=…/b');
    expect(hostPaths('(/opt/data/x)')).toBe('(…/x)');
    expect(hostPaths('"/opt/data/x"')).toBe('"…/x"');
    expect(hostPaths('/var/log/a.log: bad')).toBe('…/a.log: bad');
  });
  it('leaves URLs, single segments and relative paths', () => {
    expect(hostPaths('see https://h.example/a/b')).toBe('see https://h.example/a/b');
    expect(hostPaths('in /tmp now')).toBe('in /tmp now');
    expect(hostPaths('file a/b/c and ~/x/y')).toBe('file a/b/c and ~/x/y');
  });
});

describe('Masker.text found / restoreText / known', () => {
  const current = 'Tu es un agent.\napi_key: sk-abcdefghijkl123\nFin.';
  it('reports masked fragments', () => {
    const seen: string[] = [];
    m.text(current, (_, f) => seen.push(f));
    expect(seen).toEqual(['sk-abcdefghijkl123']);
  });
  it('restores a secret after an edit around it', () => {
    const masked = m.text(current);
    expect(masked).not.toContain('sk-abc');
    const draft = masked.replace('Tu es un agent.', 'Tu es un agent poli.');
    expect(m.restoreText(draft, current)).toBe('Tu es un agent poli.\napi_key: sk-abcdefghijkl123\nFin.');
  });
  it('restores a moved line (id by value, not position)', () => {
    const masked = m.text(current).split('\n');
    const draft = [masked[1], masked[0], masked[2]].join('\n');
    expect(m.restoreText(draft, current)).toContain('api_key: sk-abcdefghijkl123\nTu es');
  });
  it('refuses an unknown placeholder', () => {
    expect(() => m.restoreText('x «secret:00000000»', current)).toThrow(SecretError);
  });
  it('refuses a secret moved out of its context', () => {
    const custom = 'password: chaton-tres-secret';
    const masked = m.text(custom);
    const id = /«secret:[0-9a-f]{8}»/.exec(masked)![0];
    try {
      m.restoreText(`mon mot de passe ${id}`, custom);
      expect.unreachable();
    } catch (err) {
      expect((err as SecretError).code).toBe('secret_moved');
    }
  });
  it('keeps a draft without placeholder as is', () => {
    expect(m.restoreText('nouveau texte', current)).toBe('nouveau texte');
  });
  it('masks known values, longest first, ignores short ones', () => {
    const out = m.known('connect abcdefgh123 and abcdefgh and short', ['abcdefgh', 'abcdefgh123', 'short']);
    expect(out).not.toContain('abcdefgh');
    expect(out).toContain('short');
    expect(out.match(/«secret:/g)).toHaveLength(2);
  });
});
