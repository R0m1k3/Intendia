// The Aide page (first steps, glossary, troubleshooting) and an explained error: the schedules answer 500 with a
// request id, the page says what happened, « Détail technique » gives the reference, « Réessayer » works afterwards.
import { expect, test } from '@playwright/test';

test('help page: first steps, glossary, troubleshooting', async ({ page }) => {
  await page.goto('/aide');
  await expect(page.getByRole('heading', { name: 'Aide', level: 1 })).toBeVisible();
  await expect(page.getByText('Premiers pas', { exact: true })).toBeVisible();
  await expect(page.locator('ol > li')).toHaveCount(5);
  expect(await page.locator('[data-term]').count()).toBeGreaterThanOrEqual(15);
  await expect(page.getByText('Quand quelque chose ne marche pas')).toBeVisible();

  await page.goto('/aide#passerelle');
  await expect(page.locator('#passerelle')).toBeInViewport();
});

test('an error anywhere is explained, and retry works', async ({ page }) => {
  const pattern = /\/x\/.*crons(\?|$)/;
  await page.route(pattern, (route) => route.fulfill({
    status: 500, contentType: 'application/json',
    body: JSON.stringify({ error: 'Erreur interne du serveur Intendia (voir ses journaux)', requestId: 'ab12cd34ef56' }),
  }));
  await page.goto('/i/fake/crons');
  const err = page.locator('main [data-error-text], main [data-error-state]').first();
  await expect(err).toContainText('Intendia a rencontré une erreur');
  await expect(err).not.toContainText('ab12cd34ef56');
  await err.getByRole('button', { name: 'Détail technique' }).click();
  await expect(err.locator('[data-error-detail]')).toContainText('Référence : ab12cd34ef56');

  await page.unroute(pattern);
  await err.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.locator('main [data-error-text], main [data-error-state]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Planning' }).first()).toBeVisible();
});
