// Skills page: the list from the fake, a skill opened shows its SKILL.md, the filter narrows the list, and a filter
// that matches nothing says so instead of leaving a blank page.
import { expect, test } from '@playwright/test';

test('list, open one, filter, empty result', async ({ page }) => {
  await page.goto('/i/fake/skills');
  const items = page.locator('main a[href*="skills?skill="]');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(10);

  await page.locator('main a[href$="skill=codex"]').click();
  await expect(page).toHaveURL(/skill=codex/);
  await expect(page.locator('section[aria-label="SKILL.md"]')).toContainText(/codex/i);

  const filter = page.getByRole('searchbox', { name: 'Filtrer les skills' });
  await filter.fill('himalaya');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('himalaya');

  await filter.fill('zzz-rien-ne-correspond');
  await expect(items).toHaveCount(0);
  await expect(page.locator('main')).toContainText(/Aucun skill ne correspond au filtre/);
  await filter.fill('');
  await expect(items.first()).toBeVisible();
});
