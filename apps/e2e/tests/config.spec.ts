// Configuration: tabs in three groups, ?tab= follows the tab, the help sentence under it, the settings search from
// another tab, a « ? » bubble, the agent picker as a menu, and one harmless setting changed and saved.
import { expect, test } from '@playwright/test';

test('configuration tabs, search, bubble, picker', async ({ page }) => {
  await page.goto('/i/fake/config');
  await expect(page.locator('[data-config-tabs]')).toBeVisible();
  const groups = await page.locator('[data-config-group]').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.configGroup}=${[...e.querySelectorAll('[role=tab]')].map((x) => x.textContent!.trim()).join(',')}`));
  expect(groups).toEqual(['ia=Modèles,Fournisseurs', 'comportement=Réglages,Garde-fous,MCP,Plugins,Messageries', 'avance=YAML,Variables,Historique']);

  await page.getByRole('tab', { name: 'YAML' }).click();
  await expect(page).toHaveURL(/tab=yaml/);
  await expect(page.locator('[data-tab-help]')).toContainText('fichier de configuration');
  await page.getByRole('tab', { name: 'Variables' }).click();
  await expect(page).toHaveURL(/tab=variables|tab=env/);
  await expect(page.locator('[data-tab-help]')).toBeVisible();

  // the settings search works from any tab
  await page.getByRole('textbox', { name: 'Chercher un réglage' }).fill('timeout');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=reglages/);
  await expect(page.getByText('Résultats pour « timeout »')).toBeVisible();

  // « ? » bubble
  const hint = page.getByRole('button', { name: 'Que veut dire « Passerelle » ?' });
  await hint.click();
  await expect(page.locator('[data-hint="passerelle"]')).toContainText('L’arrêter arrête tout cela');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-hint="passerelle"]')).toHaveCount(0);

  // the agent picker is Intendia's menu
  await expect(page.locator('[data-profile-select] select')).toHaveCount(0);
  await page.locator('[data-profile-select] button[aria-haspopup]').click();
  await expect(page.getByRole('menu').or(page.getByRole('listbox')).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // one harmless setting: changed and saved (the toast says so), then put back
  const input = page.locator('main input.font-mono').first();
  const before = await input.inputValue();
  const save = async (value: string) => {
    await input.fill(value);
    await expect(page.locator('[data-unsaved]')).toBeVisible();
    await page.getByRole('button', { name: 'Voir et enregistrer' }).click();
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.locator('[data-toasts]')).toContainText('Enregistré');
    await expect(page.locator('[data-unsaved]')).toHaveCount(0);
  };
  await save(String(Number(before) + 1));
  await save(before);
});
