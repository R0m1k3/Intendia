// The home page with no session open: heading, four examples that fill the message box, « Premiers pas » that can be
// closed for good, and no server or schedule status cards.
import { expect, test } from '@playwright/test';

test('empty home: examples, first steps closed for good, no status cards', async ({ page }) => {
  // the first-steps choice lives in localStorage: start from a clean state whatever ran before
  await page.addInitScript(() => { if (!sessionStorage.getItem('e2e-home')) { localStorage.removeItem('intendia-first-steps'); sessionStorage.setItem('e2e-home', '1'); } });
  // the examples show once the instance has a folder: make one (the bench may be empty)
  const n = Date.now() % 100000;
  const made = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug: `e2e-home-${n}`, name: `E2E Accueil ${n}`, instanceId: 'fake' } });
  expect(made.status()).toBe(201);
  await page.goto('/');
  await expect(page.locator('[data-start]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Que voulez-vous faire ?' })).toBeVisible();
  await expect(page.locator('[data-example]')).toHaveCount(4);
  await expect(page.locator('[data-home]')).not.toContainText(/serveur|planifications? en échec/i);

  const box = page.locator('[data-home] textarea').first();
  await page.locator('[data-example="mail"]').click();
  await expect(box).toHaveValue(/^Rédige un e-mail à \[destinataire\]/);
  await expect(box).toBeFocused();

  const steps = page.locator('[data-first-steps]');
  await expect(steps).toBeVisible();
  await expect(page.locator('[data-step]')).toHaveCount(4);
  await expect(page.locator('[data-step="folder"][data-done="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ne plus afficher les premiers pas' }).click();
  await expect(steps).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-start]')).toBeVisible();
  // the list is drawn once the facts are known: wait for the home to settle, then check it stayed closed
  await expect(page.locator('[data-example]')).toHaveCount(4);
  await page.waitForLoadState('networkidle');
  await expect(steps).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('intendia-first-steps'))).toBe('hidden');
});
