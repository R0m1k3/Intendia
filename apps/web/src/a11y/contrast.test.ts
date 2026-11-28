// The palette of styles.css, light and dark: every pair used for a text reaches 4.5:1 (WCAG AA). The bright orange
// `accent` does not on white (2.6:1): it is a background, never a text colour; orange text is `accent-ink`.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_COLORS } from '../sessions/agentTree';

const SRC = join(import.meta.dirname, '..');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8');

/** `--color-x: #rrggbb` of one block of the stylesheet. */
function colors(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!]));
}
const light = colors(css.slice(css.indexOf('@theme {'), css.indexOf('}', css.indexOf('@theme {'))));
const darkAt = css.indexOf(':root.dark {');
const dark = { ...light, ...colors(css.slice(darkAt, css.indexOf('}', darkAt))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** text colour, then the backgrounds it is written on */
const PAIRS: [string, string[]][] = [
  ['ink', ['sheet', 'paper', 'raised', 'accent-soft']],
  ['ink-soft', ['sheet', 'paper', 'raised']],
  ['ink-faint', ['sheet', 'paper', 'raised']],
  ['accent-ink', ['sheet', 'paper', 'raised', 'accent-soft']],
  ['on-accent', ['accent', 'accent-strong']],
  ['ok', ['sheet', 'ok-soft']],
  ['warn', ['sheet', 'warn-soft']],
  ['bad', ['sheet', 'bad-soft']],
];

describe.each([['light', light], ['dark', dark]] as const)('%s palette', (_name, palette) => {
  it.each(PAIRS.flatMap(([text, grounds]) => grounds.map((g) => [text, g] as const)))('%s on %s reaches 4.5:1', (text, ground) => {
    expect(palette[text], `--color-${text}`).toBeDefined();
    expect(palette[ground], `--color-${ground}`).toBeDefined();
    expect(contrast(palette[text]!, palette[ground]!)).toBeGreaterThanOrEqual(4.5);
  });
});

it('knows why: the bright orange on white is far from 4.5:1', () => {
  expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
  expect(contrast(light.accent!, light.sheet!)).toBeLessThan(3);
});

// the initials of an agent on its colour: a drawing beside the agent's name (aria-hidden), held to the 3:1 of graphics
it.each(AGENT_COLORS)('white initials on the agent colour %s reach 3:1', (color) => {
  expect(contrast('#ffffff', color)).toBeGreaterThanOrEqual(3);
});

it('never writes a text in the bright orange', () => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(tsx|ts|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
          // `text-accent` and `text-accent-strong` (with any variant before), not `text-accent-ink`
          if (/(?<![\w-])text-accent(-strong)?(?![\w-])/.test(line)) found.push(`${relative(SRC, path)}:${i + 1}`);
        });
      }
    }
  };
  walk(SRC);
  expect(found).toEqual([]);
});

it('writes white only on the agent colours: on a palette colour, the text is `sheet` or `on-accent` (dark theme)', () => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') && relative(SRC, path) !== join('agents', 'look.tsx')) {
        readFileSync(path, 'utf8').split('\n').forEach((line, i) => { if (/(?<![\w-])text-white(?![\w-])/.test(line)) found.push(`${relative(SRC, path)}:${i + 1}`); });
      }
    }
  };
  walk(SRC);
  expect(found).toEqual([]);
});
