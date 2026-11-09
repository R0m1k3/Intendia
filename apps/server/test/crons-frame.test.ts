import { describe, expect, it } from 'vitest';
import { folderKey, frame, unframe } from '../src/crons/service.js';

const LINES = [
  '[Intendia] Workspace : Ventes (ventes) ; dossier : crons/rapport-du-lundi',
  'Dossier de travail : /workspace/ventes/',
  'Lis /workspace/ventes/AGENTS.md avant de commencer.',
  'Range chaque fichier que tu produis dans /workspace/ventes/crons/rapport-du-lundi/.',
  "Si l'outil share_file est disponible, appelle-le.",
];

describe('cron framing block', () => {
  it('round-trips: frame then unframe gives the prompt, the slug and the folder', () => {
    const framed = frame('Fais le rapport.\nAvec deux lignes.', LINES);
    expect(framed.startsWith('[Intendia] Workspace : Ventes')).toBe(true);
    expect(framed).toContain('\n[/Intendia]\n\nFais le rapport.');
    expect(unframe(framed)).toEqual({ prompt: 'Fais le rapport.\nAvec deux lignes.', slug: 'ventes', folder: 'rapport-du-lundi' });
  });

  it('leaves a prompt without a block untouched', () => {
    expect(unframe('Dis bonjour')).toEqual({ prompt: 'Dis bonjour', slug: null, folder: null });
  });

  it('ignores a block without its closing marker', () => {
    const broken = `${LINES.join('\n')}\n\nFais le rapport.`;
    expect(unframe(broken)).toEqual({ prompt: broken, slug: null, folder: null });
  });

  it('ignores a block that does not start on the first line', () => {
    const late = `Bonjour\n${frame('x', LINES)}`;
    expect(unframe(late).slug).toBeNull();
  });

  it('re-framing an unframed prompt never stacks two blocks', () => {
    const once = frame('Fais le rapport.', LINES);
    const twice = frame(unframe(once).prompt, LINES);
    expect(twice).toBe(once);
    expect(twice.match(/\[Intendia\]/g)).toHaveLength(1);
  });

  it('keeps the bare prompt when the block is followed by nothing', () => {
    expect(unframe(frame('', LINES))).toMatchObject({ prompt: '', slug: 'ventes' });
  });
});

describe('folderKey', () => {
  it('slugs the name: accents, spaces, punctuation', () => {
    expect(folderKey('Rapport du lundi : ventes éte', [])).toBe('rapport-du-lundi-ventes-ete');
    expect(folderKey('  ¡¿  ', [])).toBe('cron');
  });

  it('keeps at most 40 characters, without a trailing dash', () => {
    const k = folderKey('a'.repeat(39) + ' b', []);
    expect(k.length).toBeLessThanOrEqual(40);
    expect(k.endsWith('-')).toBe(false);
  });

  it('suffixes -2, -3 when taken, still within 40 characters', () => {
    expect(folderKey('Rapport', ['rapport'])).toBe('rapport-2');
    expect(folderKey('Rapport', ['rapport', 'rapport-2'])).toBe('rapport-3');
    const long = 'x'.repeat(40);
    expect(folderKey(long, [long])).toBe(`${'x'.repeat(38)}-2`);
  });
});

describe('recorded Hermes 0.23.0 responses', () => {
  it('parse with the connector schemas and lose internal fields once public', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { JobListSchema, normaliseJobs, TargetListSchema } = await import('../src/connectors/crons/index.js');
    const { toPublic } = await import('../src/crons/service.js');
    const { FIXTURES } = await import('./helpers.js');
    const read = (f: string) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')).body;
    for (const f of ['dash/GET_api_cron_jobs.json', 'api/GET_api_jobs.json']) {
      const jobs = normaliseJobs(JobListSchema.parse(read(f)));
      expect(jobs.length).toBeGreaterThan(0);
      const pub = toPublic('ref', jobs[0]!, () => undefined);
      expect(pub).toMatchObject({ name: 'Rapport du lundi', schedule: { kind: 'cron', expr: '30 8 * * 1' }, enabled: true });
      expect(JSON.stringify(pub)).not.toContain('hermes_home');
    }
    expect(TargetListSchema.parse(read('dash/GET_api_cron_delivery_targets.json')).targets[0]).toMatchObject({ id: 'local' });
  });
});
