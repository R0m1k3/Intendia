// What scripts/release.mjs decides, without touching git nor GitHub (tested in apps/server/test/release.test.ts).

/** The package.json files that carry the released version. apps/e2e stays 0.0.0: it is never published. */
export const VERSIONED = ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'apps/fake-hermes/package.json'];

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** [major, minor, patch] of `1.2.3` or `v1.2.3`; null for anything else (pre-releases are not used here). */
export function parseVersion(text) {
  const m = VERSION_RE.exec(String(text).trim().replace(/^v/, ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The highest released version among tag names (`v0.1.17`…); null when there is none. */
export function latestTag(tags) {
  const versions = tags.map((t) => String(t).trim()).filter((t) => t.startsWith('v') && parseVersion(t)).map((t) => t.slice(1));
  return versions.length ? versions.sort(compareVersions).at(-1) : null;
}

/** The next free version: the current one when it was bumped but never released, else patch + 1 above every tag. */
export function nextVersion(current, tags) {
  if (!parseVersion(current)) throw new Error(`not a version: ${current}`);
  const taken = new Set(tags.map((t) => String(t).trim()));
  const last = latestTag(tags);
  if (last !== null && !taken.has(`v${current}`) && compareVersions(current, last) > 0) return current;
  // a tag may be above the package.json (a release made from another clone)
  let [major, minor, patch] = parseVersion(last !== null && compareVersions(last, current) > 0 ? last : current);
  do { patch += 1; } while (taken.has(`v${major}.${minor}.${patch}`));
  return `${major}.${minor}.${patch}`;
}

/**
 * Why a version cannot be released, or null. 1.0.0 and above are refused unless asked for in so many words: the
 * application has not been tried in real conditions yet.
 */
export function refusal(version, tags, { allowMajor = false } = {}) {
  const v = parseVersion(version);
  if (!v) return `"${version}" is not a version (expected X.Y.Z)`;
  if (tags.map((t) => String(t).trim()).includes(`v${version}`)) return `v${version} is already released`;
  const last = latestTag(tags);
  if (last && compareVersions(version, last) < 0) return `${version} is below the last release (${last})`;
  if (v[0] >= 1 && !allowMajor) return `${version}: no 1.0.0 or above without --allow-major`;
  return null;
}

/** The text of a package.json with its version replaced, everything else untouched (no reformatting). */
export function setVersion(text, version) {
  let done = 0;
  const out = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, (_all, before, after) => { done += 1; return `${before}${version}${after}`; });
  if (done !== 1) throw new Error('no "version" line found');
  return out;
}

export function versionOf(text) {
  const v = JSON.parse(text).version;
  if (typeof v !== 'string') throw new Error('no version');
  return v;
}

/** Release notes always end with the image to pull. */
export function withImage(notes, version, image = 'ghcr.io/r0m1k3/intendia') {
  const line = `Image : \`${image}:${version}\``;
  const body = String(notes).trim();
  if (body.includes(`${image}:${version}`)) return `${body}\n`;
  return `${body}${body ? '\n\n' : ''}${line}\n`;
}
