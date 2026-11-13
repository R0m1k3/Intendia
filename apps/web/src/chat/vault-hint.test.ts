import { describe, expect, it } from 'vitest';
import { vaultHint } from './vault-hint';

// Hermes 0.23, tools/browser_vault_tool.py browser_vault_save_login in an API server session
const result = (origin: string) => JSON.stringify({
  success: false, error_type: 'prompt_unavailable',
  error: `This session cannot ask the user for a login (headless/cron/API). Tell them to run \`hermes vault add\` or use Desktop → Settings → Passwords & Logins for ${origin}.`,
});

describe('vaultHint', () => {
  it('reads the site of a prompt_unavailable result', () => {
    expect(vaultHint('browser_vault', result('https://exemple.fr'))).toEqual({ origin: 'https://exemple.fr' });
    expect(vaultHint('browser_vault', result('https://app.exemple.fr:8443'))).toEqual({ origin: 'https://app.exemple.fr:8443' });
  });

  it('a link without site when the site is missing or cut off', () => {
    const full = result('https://exemple.fr');
    expect(vaultHint('browser_vault', full.slice(0, 120))).toEqual({ origin: null });
    expect(vaultHint('browser_vault', full.slice(0, full.indexOf('exemple.fr') + 4))).toEqual({ origin: null });
    expect(vaultHint('browser_vault', JSON.stringify({ success: false, error_type: 'prompt_unavailable', error: 'x' }))).toEqual({ origin: null });
  });

  it('nothing for other results or other tools', () => {
    expect(vaultHint('terminal', result('https://exemple.fr'))).toBeNull();
    expect(vaultHint('browser_vault', JSON.stringify({ success: true, items: [], hint: 'No saved logins.' }))).toBeNull();
    expect(vaultHint('browser_vault', JSON.stringify({ success: true, filled: true }))).toBeNull();
    expect(vaultHint('browser_vault', null)).toBeNull();
  });

  it('never a site other than http(s)', () => {
    expect(vaultHint('browser_vault', result('javascript:alert(1)'))).toEqual({ origin: null });
  });
});
