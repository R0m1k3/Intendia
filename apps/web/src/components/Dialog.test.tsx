// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { click, mount, press, settle, type, unmountAll } from '../test/dom';
import { ask, askText, DialogHost } from './Dialog';

afterEach(unmountAll);

const dialog = () => document.querySelector<HTMLFormElement>('[role="dialog"], [role="alertdialog"]');
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

describe('ask()', () => {
  it('answers false when no host is mounted', async () => {
    expect(await ask({ title: 'Supprimer ?' })).toBe(false);
    expect(await askText({ title: 'Nom' })).toBeNull();
  });

  it('shows the question and resolves true on its confirm button', async () => {
    await mount(<DialogHost />);
    const answer = ask({ title: 'Supprimer la session ?', message: 'Elle ne pourra pas être rétablie.', confirmLabel: 'Supprimer', danger: true });
    await settle();
    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    expect(dialog()?.getAttribute('aria-label')).toBe('Supprimer la session ?');
    expect(dialog()?.textContent).toContain('Elle ne pourra pas être rétablie.');
    await click(button('Supprimer'));
    expect(await answer).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('resolves false on Escape and on a click outside', async () => {
    await mount(<DialogHost />);
    const first = ask({ title: 'Un' });
    await settle();
    await press(window, 'Escape');
    expect(await first).toBe(false);
    const second = ask({ title: 'Deux' });
    await settle();
    document.querySelector('[data-overlay]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle();
    expect(await second).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('makes the page behind inert while open, and frees it after', async () => {
    const page = await mount(<DialogHost />);
    const answer = ask({ title: 'Continuer ?' });
    await settle();
    expect(page.hasAttribute('inert')).toBe(true);
    await press(window, 'Escape');
    await answer;
    expect(page.hasAttribute('inert')).toBe(false);
  });

  it('asks one question at a time, in order', async () => {
    await mount(<DialogHost />);
    const a = ask({ title: 'Première' });
    const b = ask({ title: 'Seconde' });
    await settle();
    expect(dialog()?.getAttribute('aria-label')).toBe('Première');
    await press(window, 'Escape');
    expect(await a).toBe(false);
    expect(dialog()?.getAttribute('aria-label')).toBe('Seconde');
    await click(button('Confirmer'));
    expect(await b).toBe(true);
  });
});

describe('askText()', () => {
  it('starts from the given value and resolves the trimmed text', async () => {
    await mount(<DialogHost />);
    const answer = askText({ title: 'Renommer', label: 'Nouveau titre', value: 'Ancien', confirmLabel: 'Renommer' });
    await settle();
    const field = dialog()!.querySelector('input')!;
    expect(field.value).toBe('Ancien');
    expect(field.getAttribute('aria-label')).toBe('Nouveau titre');
    await type(field, '  Nouveau nom  ');
    await click(button('Renommer'));
    expect(await answer).toBe('Nouveau nom');
  });

  it('cannot confirm an empty text, and resolves null on a cancel', async () => {
    await mount(<DialogHost />);
    const empty = askText({ title: 'Nom' });
    await settle();
    await type(dialog()!.querySelector('input')!, '   ');
    expect(button('Confirmer').disabled).toBe(true);
    await click(button('Annuler'));
    expect(await empty).toBeNull();
    const cancelled = askText({ title: 'Nom', value: 'gardé' });
    await settle();
    await press(window, 'Escape');
    expect(await cancelled).toBeNull();
  });

  it('keeps a password as typed, and offers a text area for several lines', async () => {
    await mount(<DialogHost />);
    const secret = askText({ title: 'Mot de passe', password: true });
    await settle();
    const field = dialog()!.querySelector('input')!;
    expect(field.type).toBe('password');
    await type(field, ' avec espaces ');
    await click(button('Confirmer'));
    expect(await secret).toBe(' avec espaces ');
    const long = askText({ title: 'Message', multiline: true, value: 'ligne 1\nligne 2' });
    await settle();
    expect(dialog()!.querySelector('textarea')!.value).toBe('ligne 1\nligne 2');
    await click(button('Confirmer'));
    expect(await long).toBe('ligne 1\nligne 2');
  });
});
