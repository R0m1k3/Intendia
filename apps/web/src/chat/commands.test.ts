import { describe, expect, it } from 'vitest';
import { COMMANDS, matchCommands, matchSkills, parseCommand, type Command } from './commands';

const list: Command[] = COMMANDS.map((c) => (c.name === 'stop' ? { ...c, disabled: 'Aucun travail en cours' } : c));

describe('slash commands', () => {
  it('menu while the name is typed, filtered by prefix', () => {
    expect(matchCommands('/', list)?.map((c) => c.name)).toEqual(['new', 'clear', 'undo', 'retry', 'branch', 'title', 'usage', 'stop', 'prompt', 'use', 'goal']);
    expect(matchCommands('/U', list)?.map((c) => c.name)).toEqual(['undo', 'usage', 'use']);
    expect(matchCommands('/title ', list)).toBeNull();
    expect(matchCommands('/xyz', list)).toBeNull();
    expect(matchCommands('bonjour /', list)).toBeNull();
    expect(matchCommands('', list)).toBeNull();
  });

  it('runs a known command, its argument for /title only', () => {
    expect(parseCommand('/clear', list)?.command.name).toBe('clear');
    expect(parseCommand(' /title  Ventes de Noël ', list)).toMatchObject({ command: { name: 'title' }, arg: 'Ventes de Noël' });
    expect(parseCommand('/title', list)?.arg).toBe('');
    expect(parseCommand('/stop', list)?.command.disabled).toBe('Aucun travail en cours');
  });

  it('/use: second level lists the skills by prefix; the name is its argument', () => {
    const names = ['claude-code', 'codex', 'computer-use', 'hermes-agent'];
    expect(matchSkills('/use ', names)).toEqual(names);
    expect(matchSkills('/use co', names)).toEqual(['codex', 'computer-use']);
    expect(matchSkills('/use zz', names)).toBeNull();
    expect(matchSkills('/use', names)).toBeNull();
    expect(matchSkills('/use codex plus', names)).toBeNull();
    expect(parseCommand('/use codex', list)).toMatchObject({ command: { name: 'use' }, arg: 'codex' });
  });

  it('anything else is a message', () => {
    expect(parseCommand('/plan finir le rapport', list)).toBeNull();
    expect(parseCommand('/goal finir le rapport', list)).toMatchObject({ command: { name: 'goal' }, arg: 'finir le rapport' });
    expect(parseCommand('/stop maintenant', list)).toBeNull();
    expect(parseCommand('/usr/bin/env', list)).toBeNull();
    expect(parseCommand('Bonjour', list)).toBeNull();
  });
});
