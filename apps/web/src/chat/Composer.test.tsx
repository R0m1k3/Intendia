// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press, settle, type, unmountAll } from '../test/dom';
import type { Command } from './commands';
import { Composer } from './Composer';
import { loadDraft, saveDraft } from './draft';

beforeEach(() => localStorage.clear());
afterEach(unmountAll);

const field = (page: HTMLElement) => page.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
const labelled = (page: HTMLElement, label: string) => page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const COMMANDS: Command[] = [
  { name: 'stop', label: 'Arrêter le travail en cours' },
  { name: 'title', args: '[nom]', label: 'Renommer la session' },
  { name: 'retry', label: 'Relancer la dernière demande', disabled: 'Aucune réponse à relancer' },
];

describe('Composer', () => {
  it('sends on Enter, then empties the field', async () => {
    const onSend = vi.fn(async () => true);
    const page = await mount(<Composer onSend={onSend} onStop={() => {}} running={false} />);
    expect(labelled(page, 'Envoyer')!.disabled).toBe(true);
    await type(field(page), '  Bonjour  ');
    expect(labelled(page, 'Envoyer')!.disabled).toBe(false);
    await press(field(page), 'Enter');
    expect(onSend).toHaveBeenCalledWith('Bonjour', undefined);
    expect(field(page).value).toBe('');
  });

  it('keeps the text when the send is refused, and does not send on Shift+Enter', async () => {
    const onSend = vi.fn(async () => false);
    const page = await mount(<Composer onSend={onSend} onStop={() => {}} running={false} />);
    await type(field(page), 'À garder');
    await press(field(page), 'Enter', { shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    await click(labelled(page, 'Envoyer')!);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(field(page).value).toBe('À garder');
  });

  it('while a run goes: Enter queues the message, the button stops the run', async () => {
    const onSend = vi.fn(async () => true);
    const onQueue = vi.fn();
    const onStop = vi.fn();
    const page = await mount(<Composer onSend={onSend} onQueue={onQueue} onStop={onStop} running />);
    expect(labelled(page, 'Envoyer')).toBeNull();
    await type(field(page), 'Ensuite, les tests');
    await press(field(page), 'Enter');
    expect(onQueue).toHaveBeenCalledWith('Ensuite, les tests', undefined);
    expect(onSend).not.toHaveBeenCalled();
    expect(field(page).value).toBe('');
    await click(labelled(page, 'Arrêter')!);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('gives the text to the agent at once with « Réorienter »', async () => {
    const onSteer = vi.fn(async () => true);
    const page = await mount(<Composer onSend={async () => true} onSteer={onSteer} onStop={() => {}} running />);
    expect(labelled(page, 'Réorienter')!.disabled).toBe(true);
    await type(field(page), 'Plutôt en français');
    await click(labelled(page, 'Réorienter')!);
    expect(onSteer).toHaveBeenCalledWith('Plutôt en français', undefined);
    expect(field(page).value).toBe('');
  });

  it('runs a slash command instead of sending it, even during a run', async () => {
    const onSend = vi.fn(async () => true);
    const onQueue = vi.fn();
    const onCommand = vi.fn(async () => true);
    const page = await mount(<Composer onSend={onSend} onQueue={onQueue} onStop={() => {}} running commands={COMMANDS} onCommand={onCommand} />);
    await type(field(page), '/stop');
    expect(page.querySelector('[data-commands]')!.textContent).toContain('/stop');
    await press(field(page), 'Enter');
    expect(onCommand).toHaveBeenCalledWith('stop', '');
    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
    expect(field(page).value).toBe('');
  });

  it('lists the commands while « / » is typed, closes on Escape, and says why one cannot run', async () => {
    const onCommand = vi.fn(async () => true);
    const page = await mount(<Composer onSend={async () => true} onStop={() => {}} running={false} commands={COMMANDS} onCommand={onCommand} />);
    await type(field(page), '/');
    expect(page.querySelectorAll('[data-commands] [role="option"]')).toHaveLength(3);
    // the field names the open list and its highlighted line for a screen reader
    expect(field(page).getAttribute('aria-controls')).toBe(page.querySelector('[data-commands]')!.id);
    expect(field(page).getAttribute('aria-activedescendant')).toBe(page.querySelector('[data-commands] [aria-selected="true"]')!.id);
    await press(field(page), 'ArrowDown');
    expect(field(page).getAttribute('aria-activedescendant')).toBe(page.querySelectorAll('[data-commands] [role="option"]')[1]!.id);
    await press(field(page), 'Escape');
    expect(page.querySelector('[data-commands]')).toBeNull();
    expect(field(page).hasAttribute('aria-controls')).toBe(false);
    expect(field(page).hasAttribute('aria-activedescendant')).toBe(false);
    await type(field(page), '/retry');
    await press(field(page), 'Enter');
    expect(onCommand).not.toHaveBeenCalled();
    expect(page.querySelector('[data-command-note]')!.textContent).toBe('/retry : Aucune réponse à relancer');
    // a command with an argument: its name goes in the text, the user goes on typing
    await type(field(page), '/ti');
    await press(field(page), 'Tab');
    expect(field(page).value).toBe('/title ');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('keeps « /use » skills as pills, sent with the next message', async () => {
    const onSend = vi.fn(async () => true);
    const use: Command[] = [{ name: 'use', args: '<skill>', label: 'Utiliser un skill' }];
    const page = await mount(<Composer onSend={onSend} onStop={() => {}} running={false} commands={use} onCommand={async () => true} skillNames={['pdf', 'seo']} />);
    await type(field(page), '/use pdf');
    await press(field(page), 'Enter');
    expect(page.querySelector('[data-skill-pill="pdf"]')).not.toBeNull();
    expect(field(page).value).toBe('');
    await type(field(page), '/use inconnu');
    await press(field(page), 'Escape');
    await press(field(page), 'Enter');
    expect(page.querySelector('[data-command-note]')!.textContent).toBe('Skill inconnu ou désactivé : inconnu');
    await type(field(page), 'Fais le rapport');
    await press(field(page), 'Enter');
    expect(onSend).toHaveBeenCalledWith('Fais le rapport', ['pdf']);
    expect(page.querySelector('[data-skill-pill]')).toBeNull();
  });

  it('reads its draft on opening, and forgets it once sent', async () => {
    saveDraft('draft:test', 'Brouillon gardé');
    const page = await mount(<Composer onSend={async () => true} onStop={() => {}} running={false} draftKey="draft:test" />);
    expect(field(page).value).toBe('Brouillon gardé');
    await press(field(page), 'Enter');
    expect(field(page).value).toBe('');
    expect(loadDraft('draft:test')).toBe('');
  });

  it('saves what is being written when the composer goes', async () => {
    const page = await mount(<Composer onSend={async () => true} onStop={() => {}} running={false} draftKey="draft:leave" />);
    await type(field(page), 'Pas encore envoyé');
    await unmountAll();
    expect(loadDraft('draft:leave')).toBe('Pas encore envoyé');
  });

  it('shows the messages waiting, with their actions', async () => {
    const onRemove = vi.fn();
    const onResume = vi.fn();
    const onSendNow = vi.fn();
    const queue = {
      items: [{ id: 'a', key: 'ka', text: 'Premier' }, { id: 'b', key: 'kb', text: 'Second' }], paused: 'envoi refusé', onRemove, onResume, onSendNow,
      sendNowBlocked: (it: { id: string }) => (it.id === 'b' ? 'Envoi en cours…' : null),
    };
    const page = await mount(<Composer onSend={async () => true} onStop={() => {}} running={false} queue={queue} />);
    const rows = page.querySelectorAll('[data-queued]');
    expect(rows).toHaveLength(2);
    expect(page.querySelector('[data-queue]')!.textContent).toContain('En pause : envoi refusé');
    const now = page.querySelectorAll<HTMLButtonElement>('[data-send-now]');
    expect(now[1]!.disabled).toBe(true);
    await click(now[0]!);
    expect(onSendNow).toHaveBeenCalledWith('a');
    await click(labelled(page, 'Retirer « Second » de la file')!);
    expect(onRemove).toHaveBeenCalledWith('b');
    await click([...page.querySelectorAll('button')].find((b) => b.textContent === 'Reprendre')!);
    expect(onResume).toHaveBeenCalledTimes(1);
    await settle();
  });

  it('does nothing when disabled', async () => {
    const onSend = vi.fn(async () => true);
    const page = await mount(<Composer onSend={onSend} onStop={() => {}} running={false} disabled />);
    expect(field(page).disabled).toBe(true);
    expect(labelled(page, 'Envoyer')!.disabled).toBe(true);
  });
});
