// Cron lifecycle on the Crons page: create (as in shots/admin-crons.mjs), run now, pause, delete.
import { expect, test } from '@playwright/test';
import { autoConfirm } from '../confirm.js';

test('create, run now, pause, delete a cron', async ({ page }) => {
  const name = `e2e-cron-${Date.now() % 100000}`;
  await autoConfirm(page);
  await page.goto('/i/fake/crons');
  await page.click('button:has-text("Nouveau")');
  const form = page.locator('form[aria-label="Nouveau cron"]');
  await form.locator('input').first().fill(name);
  await form.locator('textarea').fill('Résume la journée');
  await form.getByRole('button', { name: 'Créer le cron' }).click();

  const card = page.locator(`article[aria-label="${name}"]`);
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Lancer maintenant' }).click();
  await expect(card.getByRole('button', { name: 'En cours…' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Lancer maintenant' })).toBeVisible({ timeout: 20_000 });

  await card.getByRole('button', { name: 'Mettre en pause' }).click();
  await expect(card.getByRole('button', { name: 'Reprendre' })).toBeVisible();

  await card.locator('[aria-label="Supprimer"]').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(`ul[aria-label="Tâches planifiées"] >> text=${name}`)).toHaveCount(0);
});
