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
