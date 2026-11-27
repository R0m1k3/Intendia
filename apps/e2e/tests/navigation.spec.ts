// The rail and the palette: each main entry opens its page, « Plus » lists the other pages, Ctrl+K finds a page by
// its name and by an older name, and a page never visited opens without a route error or a script error.
import { expect, test } from '@playwright/test';

test('rail, « Plus » menu and palette', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  const rail = page.locator('nav[aria-label="Navigation principale"]');
  await expect(rail.getByRole('link')).toHaveCount(6);

  for (const [link, heading] of [['Tâches', 'Tâches'], ['Planning', 'Planning'], ['Fichiers', 'Fichiers'], ['Coûts', 'Coûts et journaux'], ['Activité', 'Activité'], ['Sessions', null]] as const) {
    await rail.getByRole('link', { name: link }).click();
    if (heading) await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await expect(page.locator('[data-error-state]')).toHaveCount(0);
  }
  await expect(page).toHaveURL(/\/$|\/s\//);

  const aside = page.locator('aside[aria-label="Barre latérale"]');
  await expect(aside.getByRole('button', { name: 'Rechercher' })).toBeVisible();
  const plus = aside.getByRole('button', { name: 'Plus' });
  await plus.click();
  const menu = page.getByRole('menu', { name: 'Plus' });
  for (const name of ['Vue en colonnes', 'Dossiers', 'Skills', 'Mémoire', 'Accès aux sites', 'Agents', 'Configuration', 'État', 'Réglages', 'Aide', 'Raccourcis clavier', 'Se déconnecter']) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
  await menu.getByRole('menuitem', { name: 'Skills' }).click();
  await expect(page).toHaveURL(/\/i\/fake\/skills/);
  await expect(page.getByRole('heading', { name: 'Skills' }).first()).toBeVisible();

  // the palette: by the new name, then by an older one
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog').last();
  await expect(dialog.getByPlaceholder(/Rechercher un agent/)).toBeVisible();
  await page.keyboard.type('planning');
  await expect(dialog.getByText('Planning').first()).toBeVisible();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('cron');
  await expect(dialog.getByText('Planning').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/i\/fake\/crons/);
  await expect(page.getByRole('heading', { name: 'Planning' }).first()).toBeVisible();

  // a page not visited yet in this tab
  await page.goto('/etat');
  await expect(page.getByRole('heading', { name: 'État' }).first()).toBeVisible();
  await expect(page.locator('[data-error-state]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
