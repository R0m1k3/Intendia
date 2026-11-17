// From shots/dialogs.mjs: in-app windows (askText to rename a workspace, ask to confirm), never the browser's;
// a deleted session comes back through « Annuler » of the undo bar.
import { expect, test } from '@playwright/test';

test('rename by askText, cancel an ask, delete a session and undo', async ({ page }) => {
  let native = 0;
  page.on('dialog', (d) => { native++; void d.dismiss(); });
  const n = Date.now() % 100000;
  const slug = `e2e-dialogs-${n}`;
  const r = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug, name: 'Essai', instanceId: 'fake' } });
  expect(r.status()).toBe(201);
  await page.goto(`/w/${slug}`);

  const dlg = page.locator('[role=dialog]');
  const title = page.locator('[data-detail-pane] h2');
  await page.click('main button:has-text("Renommer")');
  await expect(dlg.locator('input')).toHaveValue('Essai');
  await dlg.locator('input').fill(`Magasins ${n}`);
  await page.keyboard.press('Enter');
  await expect(dlg).toHaveCount(0);
  await expect(title).toHaveText(`Magasins ${n}`);
  await expect(page.locator(`aside >> text=Magasins ${n}`).first()).toBeVisible();
  // Escape cancels
  await page.click('main button:has-text("Renommer")');
  await dlg.locator('input').fill('Ne pas garder');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(title).toHaveText(`Magasins ${n}`);

  // a session with one message, so that it is listed in its workspace
  await page.click('main button:has-text("Nouvelle session ici")');
  await page.waitForURL(/\/s\//);
  const box = page.locator('textarea[aria-label="Message"]');
  await box.fill(`Bonjour e2e ${n}`);
  await box.press('Enter');
  await expect(page.locator('[aria-label="Envoyer"]')).toBeVisible({ timeout: 20_000 });

  // ask(): « Annuler » leaves the setting as it was
  const menu = () => page.click('button[title="Actions de la session"]');
  await menu();
  await page.click('[role=menu] >> text=Sans confirmation…');
  const alert = page.locator('[role=alertdialog]');
  await expect(alert).toBeVisible();
  await alert.locator('button:has-text("Annuler")').click();
  await expect(alert).toHaveCount(0);
  await menu();
  await expect(page.locator('[role=menu] >> text=Sans confirmation…')).toBeVisible();

  // delete, then « Annuler » in the undo bar: the session is back in the workspace
  await page.click('[role=menu] >> text=Supprimer');
  await page.waitForURL(new RegExp(`/w/${slug}$`));
  const session = page.locator('main').getByText(`Bonjour e2e ${n}`);
  await expect(session).toHaveCount(0);
  await page.locator('[data-undo] button:has-text("Annuler")').click();
  await expect(session.first()).toBeVisible();
  expect(native).toBe(0);
});
