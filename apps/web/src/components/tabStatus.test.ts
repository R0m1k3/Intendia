import { describe, expect, it } from 'vitest';
import { BADGES, badgeKind, tabTitle } from './tabStatus';

describe('tabTitle', () => {
  it('counts what waits', () => expect(tabTitle({ base: 'Crons', waiting: 2, running: false })).toBe('(2) Crons · Intendia'));
  it('marks a run going on', () => expect(tabTitle({ base: 'Rapport', waiting: 0, running: true })).toBe('• Rapport · Intendia'));
  it('a wait wins over a run', () => expect(tabTitle({ base: 'Rapport', waiting: 1, running: true })).toBe('(1) Rapport · Intendia'));
  it('Intendia alone without base', () => {
    expect(tabTitle({ base: null, waiting: 0, running: false })).toBe('Intendia');
    expect(tabTitle({ base: '', waiting: 0, running: true })).toBe('• Intendia');
  });
});

describe('badgeKind', () => {
  it('nothing: the plain icon', () => expect(badgeKind({ waiting: 0, running: false })).toBeNull());
  it('waiting', () => expect(badgeKind({ waiting: 1, running: false })).toBe('waiting'));
  it('working', () => expect(badgeKind({ waiting: 0, running: true })).toBe('running'));
  it('both: waiting wins', () => expect(badgeKind({ waiting: 3, running: true })).toBe('waiting'));
  it('the two dots differ in colour and place', () => {
    expect(BADGES.waiting.color).not.toBe(BADGES.running.color);
    expect([BADGES.waiting.x, BADGES.waiting.y]).not.toEqual([BADGES.running.x, BADGES.running.y]);
  });
});
