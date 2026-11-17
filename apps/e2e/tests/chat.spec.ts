// Ported from shots/phase2.mjs: a workspace and its instructions, a session, a message and its answer, an approval,
// the resume of a run after a reload.
import { expect, test } from '@playwright/test';

test('workspace, session, answer, approval, resume after reload', async ({ page }) => {
  const n = Date.now() % 100000;
  const slug = `e2e-chat-${n}`;
  await page.goto('/w');
  const add = page.getByRole('button', { name: 'Nouveau workspace' });
  if (await add.isVisible()) await add.click();
  await page.fill('input[placeholder="Magasins"]', `E2E Chat ${n}`);
  await page.click('text=Créer le workspace');
  await page.waitForURL(new RegExp(`/w/${slug}$`));

  const agents = page.locator('textarea[aria-label="Consignes du projet"]:not([disabled])');
  await agents.fill('# E2E\n\nRéponds en français, en phrases courtes.');
  await page.click('form >> text=Enregistrer');
  await expect(page.locator('form >> text=Enregistrer')).toHaveCount(0);

  await page.click('main button:has-text("Nouvelle session ici")');
  await page.waitForURL(/\/s\//);
  const box = page.locator('textarea[aria-label="Message"]');
  const send = async (text: string) => {
    await box.fill(text);
    await box.press('Enter');
  };

  await send('Peux-tu regarder ce qu’il y a dans le dossier du workspace ?');
  await expect(page.getByText('Il contient')).toBeVisible();

  await send('Nettoie le dossier build (approval)');
  await expect(page.getByText('Approbation demandée')).toBeVisible();
  await page.click('text=Autoriser une fois');
  await expect(page.locator('[aria-label="Arrêter"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[aria-label="Envoyer"]')).toBeVisible();

  // resume: reload during a slow run
  await send('Fais-le lentement (lent)');
  await expect(page.locator('[aria-label="Arrêter"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[aria-label="Arrêter"]')).toBeVisible();
  await expect(page.locator('[aria-label="Envoyer"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('p[data-user-text]')).toHaveCount(3);
});
