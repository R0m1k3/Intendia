// From shots/phase7k.mjs: a new task, its panel, a move through the card's menu (no drag and drop, unsteady in CI).
import { expect, test } from '@playwright/test';

test('new task, open its panel, move it', async ({ page }) => {
  const title = `Tâche e2e ${Date.now() % 100000}`;
  const col = (label: string) => page.locator(`[aria-label="Colonnes"] section[aria-label="${label}"]:visible`);
  await page.goto('/i/fake/kanban?board=default');
  await expect(col('À faire')).toBeVisible();

  await page.click('button:has-text("Nouvelle tâche")');
  await page.fill('input[placeholder="Comparer les ventes de mars"]', title);
  await page.fill('[role=dialog] textarea', 'Un tableau par magasin.');
  await expect(page.locator('[role=dialog] >> text=Elle attend que vous la passiez')).toBeVisible();
  await page.click('button:has-text("Créer la tâche")');
  await page.waitForURL(/task=t_/);
  const panel = page.locator('[role=dialog]');
  await expect(panel.getByText('Un tableau par magasin.')).toBeVisible();
  await expect(panel.locator('span.font-mono', { hasText: /^t_/ }).first()).toBeVisible();
  await page.click('[aria-label="Fermer"]');
  await expect(panel).toHaveCount(0);

  await expect(col('Planifiée').getByText(title)).toBeVisible();
  await col('Planifiée').locator(`select[aria-label="Déplacer « ${title} » vers…"]`).selectOption({ label: 'Prête à lancer' });
  await expect(col('Prête à lancer').getByText(title)).toBeVisible();
  await expect(col('Planifiée').getByText(title)).toHaveCount(0);
});
