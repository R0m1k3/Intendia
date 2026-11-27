// Signing in, in a context with no cookie: any address goes to /connexion, a wrong password gives a readable error
// and stays there, the right one reaches the home, « Se déconnecter » closes only this context's session.
// Sign-ins are limited to 5 a minute: two attempts here, no more.
import { expect, test } from '@playwright/test';
import { PASSWORD } from '../ports.js';

test.use({ storageState: { cookies: [], origins: [] } });

test('redirect, wrong password, right password, sign out', async ({ page }) => {
  for (const path of ['/', '/i/fake/crons', '/reglages']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/connexion/);
  }
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  const field = page.locator('input[type=password]');
  const submit = page.getByRole('button', { name: /Se connecter|Connexion|Entrer|Valider/ }).first();

  await field.fill('pas-le-bon-mot-de-passe');
  await submit.click();
  await expect(page.locator('[data-error-text], [role=alert]').first()).toContainText(/mot de passe|incorrect|refusé/i);
  await expect(page).toHaveURL(/\/connexion/);

  await field.fill(PASSWORD);
  await submit.click();
  await expect(page).not.toHaveURL(/\/connexion/);
  await expect(page.locator('nav[aria-label="Navigation principale"]')).toBeVisible();

  await page.locator('aside[aria-label="Barre latérale"]').getByRole('button', { name: 'Plus' }).click();
  await page.getByRole('menu', { name: 'Plus' }).getByRole('menuitem', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/connexion/);
});
