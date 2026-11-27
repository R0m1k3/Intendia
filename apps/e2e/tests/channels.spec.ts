// A channel with the default agent (the fake has one profile, so one member): created from « Créer » of the sessions
// pane, a message answered by the member, and the channel listed in the pane.
import { expect, test } from '@playwright/test';

test('create a channel, send a message, get the answer, find it in the list', async ({ page }) => {
  const n = Date.now() % 100000;
  const name = `E2E canal ${n}`;
  // a channel's hidden sessions live in a folder of the instance: make one (the bench may have none)
  const made = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug: `e2e-canal-${n}`, name: `E2E Canal dossier ${n}`, instanceId: 'fake' } });
  expect(made.status()).toBe(201);
  await page.goto('/');
  const pane = page.getByRole('complementary', { name: 'Agents' });
  await pane.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('menuitem', { name: 'Nouveau canal…' }).click();

  const sheet = page.getByRole('dialog').last();
  await sheet.getByLabel('Nom').fill(name);
  await sheet.locator('[data-channel-members] input[type=checkbox]').first().check();
  await sheet.getByRole('button', { name: 'Créer le canal' }).click();
  await expect(page).toHaveURL(/\/canaux\//);

  const box = page.locator('textarea[aria-label="Message"]');
  await box.fill('Regarde le dossier, merci');
  await box.press('Enter');
  await expect(page.locator('[data-channel-user]')).toHaveCount(1);
  await expect(page.locator('[data-channel-agent="default"]')).toContainText('Il contient', { timeout: 40_000 });
  await expect(page.locator('[data-channel-running]')).toHaveCount(0);

  await page.goto('/');
  await expect(pane.getByText(name)).toBeVisible();
});
