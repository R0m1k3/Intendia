// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { click, mount, unmountAll } from '../test/dom';
import { ErrorText } from './ui';

afterEach(unmountAll);

describe('ErrorText', () => {
  it('draws nothing without an error', async () => {
    const page = await mount(<ErrorText error={null} />);
    expect(page.innerHTML).toBe('');
  });

  it('announces an ordinary error with its message', async () => {
    const page = await mount(<ErrorText error={new Error('Le fichier est trop gros')} />);
    const alert = page.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Le fichier est trop gros');
    expect(alert.querySelector('button')).toBeNull();
  });

  it('says what to do when Intendia does not answer, without the technical message', async () => {
    const page = await mount(<ErrorText error={new ApiError(0, 'Failed to fetch', { code: 'network' })} />);
    const alert = page.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Intendia ne répond pas');
    expect(alert.textContent).toContain('Vérifiez votre connexion');
    expect(alert.textContent).not.toContain('Failed to fetch');
  });

  it('offers « Réessayer » when the caller can retry', async () => {
    const retry = vi.fn();
    const page = await mount(<ErrorText error={new Error('Échec')} onRetry={retry} />);
    await click(page.querySelector('button')!);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
