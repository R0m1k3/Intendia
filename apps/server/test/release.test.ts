import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript shared with scripts/release.mjs
import { compareVersions, latestTag, nextVersion, parseVersion, refusal, setVersion, withImage } from '../../../scripts/release-lib.mjs';

const TAGS = ['v0.0.1', 'v0.1.9', 'v0.1.10', 'v0.1.17', 'not-a-version', 'v0.1.2-rc1'];

describe('release versions', () => {
  it('reads X.Y.Z, with or without the v', () => {
    expect(parseVersion('v0.1.17')).toEqual([0, 1, 17]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3-rc1')).toBeNull();
  });

  it('orders by number, not by text', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(latestTag(TAGS)).toBe('0.1.17');
    expect(latestTag([])).toBeNull();
  });

  it('gives the next free patch, above the tags and the current version', () => {
    expect(nextVersion('0.1.17', TAGS)).toBe('0.1.18');
    // the bump of a previous pull request was never released: its number is still free
    expect(nextVersion('0.1.18', TAGS)).toBe('0.1.18');
    // a tag exists above the package.json (a release made from another clone)
    expect(nextVersion('0.1.15', TAGS)).toBe('0.1.18');
    expect(nextVersion('0.0.1', [])).toBe('0.0.2');
  });

  it('refuses a released, lower, malformed or 1.0.0 version', () => {
    expect(refusal('0.1.18', TAGS)).toBeNull();
    expect(refusal('0.1.17', TAGS)).toContain('already released');
    expect(refusal('0.1.3', TAGS)).toContain('below the last release');
    expect(refusal('0.1', TAGS)).toContain('not a version');
    expect(refusal('1.0.0', TAGS)).toContain('--allow-major');
    expect(refusal('1.0.0', TAGS, { allowMajor: true })).toBeNull();
  });

  it('changes the version line of a package.json and nothing else', () => {
    const text = '{\n  "name": "@intendia/server",\n  "version": "0.1.17",\n  "dependencies": { "x": "0.1.17" }\n}\n';
    expect(setVersion(text, '0.1.18')).toBe('{\n  "name": "@intendia/server",\n  "version": "0.1.18",\n  "dependencies": { "x": "0.1.17" }\n}\n');
    expect(() => setVersion('{ "name": "x" }', '0.1.18')).toThrow();
  });

  it('ends the notes with the image, once', () => {
    expect(withImage('## Titre\n\n- un point\n', '0.1.18')).toBe('## Titre\n\n- un point\n\nImage : `ghcr.io/r0m1k3/intendia:0.1.18`\n');
    const already = '- un point\n\nImage : `ghcr.io/r0m1k3/intendia:0.1.18`';
    expect(withImage(already, '0.1.18')).toBe(`${already}\n`);
  });
});
