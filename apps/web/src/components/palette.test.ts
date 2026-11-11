import { describe, expect, it } from 'vitest';
import type { OverviewCron, RecentSession } from '../api';
import { flatItems, moveIndex, paletteGroups, type PaletteSources } from './palette';

const nav = [{ to: '/', label: 'Accueil' }, { to: '/sessions', label: 'Sessions' }, { to: '/crons', label: 'Crons' }, { to: '/config', label: 'Configuration' }];
const session = (id: string, title: string): RecentSession => ({
  kind: 'hermes', instanceId: 'a', profile: 'default', id, source: 'telegram', title, sub: 'Hermes', workspace: null, at: 0, snippet: null,
});
const cron = (id: string, name: string): OverviewCron => ({
  instanceId: 'a', instanceLabel: 'Hermes', id, profile: 'default', name, nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null,
  timezone: null, schedule: { kind: 'interval', minutes: 5, expr: null, runAt: null, display: 'every 5m' },
});
const src = (over: Partial<PaletteSources> = {}): PaletteSources => ({
  nav,
  workspaces: [{ slug: 'maison', name: 'Électricité maison' }],
  crons: [cron('1', 'Rapport croissance'), cron('2', 'Sauvegarde')],
  recent: Array.from({ length: 8 }, (_, i) => session(`s${i}`, `Session ${i}`)),
  found: null,
  ...over,
});

describe('paletteGroups', () => {
  it('without text: actions, pages and 5 sessions', () => {
    const g = paletteGroups('', src());
    expect(g.map((x) => x.id)).toEqual(['actions', 'pages', 'sessions']);
    expect(g[2]!.items).toHaveLength(5);
  });
  it('"cro" finds the Crons page and a cron', () => {
    const g = paletteGroups('cro', src());
    expect(g.find((x) => x.id === 'pages')!.items.map((i) => i.label)).toEqual(['Crons']);
    expect(g.find((x) => x.id === 'crons')!.items.map((i) => i.label)).toEqual(['Rapport croissance']);
    expect(g.find((x) => x.id === 'crons')!.items[0]!.target).toEqual({ to: '/i/$inst/crons', params: { inst: 'a' } });
  });
  it('folds case and accents', () => {
    expect(paletteGroups('electricite', src()).find((x) => x.id === 'workspaces')!.items[0]!.label).toBe('Électricité maison');
  });
  it('5 results at most per group; sessions from the search once it answered', () => {
    const many = src({ crons: Array.from({ length: 9 }, (_, i) => cron(String(i), `Cron ${i}`)) });
    expect(paletteGroups('cron', many).find((x) => x.id === 'crons')!.items).toHaveLength(5);
    expect(paletteGroups('zz', src()).find((x) => x.id === 'sessions')).toBeUndefined();
    const g = paletteGroups('zz', src({ found: [session('x', 'Trouvée')] }));
    expect(flatItems(g).map((i) => i.label)).toEqual(['Trouvée']);
  });
});

describe('moveIndex', () => {
  it('wraps around both ways', () => {
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(-1, 1, 0)).toBe(-1);
  });
});
