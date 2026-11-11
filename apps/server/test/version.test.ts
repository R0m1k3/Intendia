import { describe, expect, it } from 'vitest';
import { appVersion, readPkgVersion } from '../src/version.js';

describe('appVersion', () => {
  it('keeps a release tag without its v', () => {
    expect(appVersion('v0.0.3', '0.0.3')).toBe('0.0.3');
    expect(appVersion('0.0.4-rc1', '0.0.3')).toBe('0.0.4-rc1');
  });
  it('appends a build label to the package version', () => {
    expect(appVersion('git', '0.0.3')).toBe('0.0.3-git');
    expect(appVersion(undefined, '0.0.3')).toBe('0.0.3-dev');
    expect(appVersion('  ', '0.0.3')).toBe('0.0.3-dev');
  });
  it('reads the server package.json', () => {
    expect(readPkgVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
