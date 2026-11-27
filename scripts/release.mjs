#!/usr/bin/env node
// One release, in two commands instead of six manual steps.
//
//   node scripts/release.mjs bump [X.Y.Z]      on the branch of the pull request: writes the next free version (or
//                                              the one given) into the four package.json. Commit it with the work.
//   node scripts/release.mjs publish [notes]   once the pull request is merged: checks what origin/main holds, puts
//                                              the tag vX.Y.Z on it, pushes the tag (which builds the image) and
//                                              creates the GitHub release. `notes` is a Markdown file; without it
//                                              the notes are read on standard input.
//   node scripts/release.mjs check             the four package.json agree (run by CI).
//   node scripts/release.mjs next              prints the next free version.
//
// A tag is signed by whoever runs the command: without a git identity on the machine, set GIT_COMMITTER_NAME and
// GIT_COMMITTER_EMAIL. Needs `gh` signed in for `publish`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { latestTag, nextVersion, refusal, setVersion, VERSIONED, versionOf, withImage } from './release-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
const git = (...args) => run('git', args);
const fail = (message) => { console.error(`release: ${message}`); process.exit(1); };

const localVersions = () => VERSIONED.map((file) => ({ file, version: versionOf(readFileSync(join(root, file), 'utf8')) }));
function remoteTags() {
  // the tags of the remote, not the local ones: another clone may have released since
  return git('ls-remote', '--tags', '--refs', 'origin').split('\n').filter(Boolean).map((l) => l.split('refs/tags/')[1]);
}
function agreed(versions) {
  const distinct = [...new Set(versions.map((v) => v.version))];
  if (distinct.length !== 1) fail(`the package.json files disagree:\n${versions.map((v) => `  ${v.file}: ${v.version}`).join('\n')}`);
  return distinct[0];
}

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
const allowMajor = flags.has('--allow-major');

if (command === 'check') {
  const version = agreed(localVersions());
  const e2e = versionOf(readFileSync(join(root, 'apps/e2e/package.json'), 'utf8'));
  if (e2e !== '0.0.0') fail(`apps/e2e/package.json must stay 0.0.0 (found ${e2e})`);
  console.log(`release: ${VERSIONED.length} package.json at ${version}`);
} else if (command === 'next') {
  console.log(nextVersion(agreed(localVersions()), remoteTags()));
} else if (command === 'bump') {
  const tags = remoteTags();
  const version = args[0] ?? nextVersion(agreed(localVersions()), tags);
  const why = refusal(version, tags, { allowMajor });
  if (why) fail(why);
  for (const file of VERSIONED) {
    const path = join(root, file);
    writeFileSync(path, setVersion(readFileSync(path, 'utf8'), version));
  }
  console.log(`release: ${VERSIONED.length} package.json set to ${version} (last release: ${latestTag(tags) ?? 'none'})`);
  console.log('         commit them on the pull request, then after the merge: node scripts/release.mjs publish');
} else if (command === 'publish') {
  const notes = args[0] ? readFileSync(resolve(args[0]), 'utf8') : readFileSync(0, 'utf8');
  if (!notes.trim()) fail('empty release notes (give a Markdown file, or write them on standard input)');
  git('fetch', '--quiet', 'origin', 'main');
  // what was really merged: a merge can succeed although GitHub answered an error
  const versions = VERSIONED.map((file) => ({ file, version: versionOf(git('show', `origin/main:${file}`)) }));
  const version = agreed(versions);
  const tags = remoteTags();
  const why = refusal(version, tags, { allowMajor });
  if (why) fail(`origin/main is at ${version}: ${why}. Was the pull request with the bump merged?`);
  const tag = `v${version}`;
  const head = git('rev-parse', 'origin/main');
  console.log(`release: ${tag} on origin/main ${head.slice(0, 7)} (${git('log', '-1', '--format=%s', head)})`);
  if (flags.has('--dry-run')) { console.log(withImage(notes, version)); process.exit(0); }
  try { git('tag', '-a', tag, head, '-m', tag); } catch (err) { fail(`tag not created: ${err.stderr || err.message}`); }
  try { git('push', '--quiet', 'origin', tag); } catch (err) { fail(`tag not pushed (it exists locally: git push origin ${tag}): ${err.stderr || err.message}`); }
  // the tag must be on the remote before the release, or GitHub creates one of its own on the default branch
  if (!remoteTags().includes(tag)) fail(`${tag} is not on the remote after the push: push it again, then create the release by hand`);
  run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', '-', '--verify-tag'], { input: withImage(notes, version) });
  // a release may come back as a draft (a tag pushed twice): make it public and the latest
  const state = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'isDraft,url']));
  if (state.isDraft) run('gh', ['release', 'edit', tag, '--draft=false', '--latest']);
  console.log(`release: ${state.url}`);
  console.log(`         the image ghcr.io/r0m1k3/intendia:${version} is built by the tag (workflow build.yml)`);
} else {
  console.error('usage: node scripts/release.mjs bump [X.Y.Z] | publish [notes.md] [--dry-run] | check | next   (--allow-major for 1.0.0 and above)');
  process.exit(command ? 1 : 0);
}
