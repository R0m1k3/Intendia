import { describe, expect, it } from 'vitest';
import { BADGE_RUNNING, BADGE_WAITING, badgeColor, tabTitle } from './tabStatus';

describe('tabTitle', () => {
  it('counts what waits', () => expect(tabTitle({ base: 'Crons', waiting: 2, running: false })).toBe('(2) Crons · Intendia'));
  it('marks a run going on', () => expect(tabTitle({ base: 'Rapport', waiting: 0, running: true })).toBe('• Rapport · Intendia'));
  it('a wait wins over a run', () => expect(tabTitle({ base: 'Rapport', waiting: 1, running: true })).toBe('(1) Rapport · Intendia'));
  it('Intendia alone without base', () => {
    expect(tabTitle({ base: null, waiting: 0, running: false })).toBe('Intendia');
    expect(tabTitle({ base: '', waiting: 0, running: true })).toBe('• Intendia');
  });
});

describe('badgeColor', () => {
  it('nothing: the plain icon', () => expect(badgeColor({ waiting: 0, running: false })).toBeNull());
  it('waiting: red', () => expect(badgeColor({ waiting: 1, running: false })).toBe(BADGE_WAITING));
  it('working: dark orange', () => expect(badgeColor({ waiting: 0, running: true })).toBe(BADGE_RUNNING));
  it('both: red', () => expect(badgeColor({ waiting: 3, running: true })).toBe('#b42318'));
});
