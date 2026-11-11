import { readFileSync } from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Version shown in the UI. A release tag (`v0.0.3`, passed by the image build) gives `0.0.3`; any other build
 * label (`git` from the Portainer stack, nothing in development) is appended to the package version: `0.0.3-git`.
 */
export function appVersion(env: string | undefined, pkgVersion: string): string {
  const label = (env ?? '').trim();
  const bare = label.replace(/^v/, '');
  if (SEMVER.test(bare)) return bare;
  return `${pkgVersion}-${label || 'dev'}`;
}

/** Version of the server's package.json, next to `dist/` (`/app/package.json` in the image). */
export function readPkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
