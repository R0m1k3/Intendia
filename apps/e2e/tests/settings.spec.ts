// Réglages: its sections, the « Détails techniques » option that persists after a reload (put back at the end),
// the language choice, and the interface in English from an en-US browser context.
import { expect, test } from '@playwright/test';

test('sections, technical details persist, language choice', async ({ page }) => {
  await page.goto('/reglages');
  await expect(page.getByRole('heading', { name: 'Réglages' }).first()).toBeVisible();
  for (const name of ['Instances', 'Affichage']) await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.locator('[data-setting="language"]')).toContainText('Français');
  await expect(page.locator('[data-setting="language"]')).toContainText('English');

  const details = page.locator('[data-setting="run-details"] input');
  const was = await details.isChecked();
  try {
    await details.setChecked(!was);
    await page.reload();
    await expect(details).toBeChecked({ checked: !was });
  } finally {
    await page.goto('/reglages');
    await details.setChecked(was);
    await page.reload();
    await expect(details).toBeChecked({ checked: was });
  }
});

test.describe('English', () => {
  test.use({ locale: 'en-US' }); // its own browser context: the language is chosen from the browser, nothing is stored

  test('interface in English', async ({ page }) => {
    const n = Date.now() % 100000; // the heading shows once the instance has a folder
    const made = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug: `e2e-en-${n}`, name: `E2E English ${n}`, instanceId: 'fake' } });
    expect(made.status()).toBe(201);
    await page.goto('/');
    const rail = page.locator('nav[aria-label="Main navigation"]');
    await expect(rail.getByRole('link', { name: 'Tasks' })).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Schedule' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What do you want to do?' })).toBeVisible();
  });
});
