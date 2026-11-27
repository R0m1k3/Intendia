// Pages are loaded on demand: the Configuration chunk is requested only when that page opens, a slow chunk shows
// the waiting skeleton while the rail stays, and a chunk gone after an update (404 once) reloads the tab and shows.
import { expect, test } from '@playwright/test';

test('on-demand pages: lazy chunk, waiting skeleton, 404 reload', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => { const m = /\/assets\/([A-Za-z]+)-[^/]*\.js$/.exec(new URL(r.url()).pathname); if (m) chunks.push(m[1]!); });
  await page.goto('/');
  await expect(page.locator('nav[aria-label="Navigation principale"]')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(chunks).not.toContain('Config');

  // slow chunk: the skeleton shows, the rail stays
  await page.route(/\/assets\/Crons-.*\.js$/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  const rail = page.locator('nav[aria-label="Navigation principale"]');
  await rail.getByRole('link', { name: 'Planning' }).click();
  await expect(page.locator('[data-page-pending]')).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Planning' }).first()).toBeVisible();
  await page.unroute(/\/assets\/Crons-.*\.js$/);

  // Configuration: requested only now
  await page.locator('aside[aria-label="Barre latérale"]').getByRole('button', { name: 'Plus' }).click();
  await page.getByRole('menuitem', { name: 'Configuration' }).click();
  await expect(page.locator('[data-config-tabs]')).toBeVisible();
  expect(chunks).toContain('Config');

  // a chunk that is gone once (tab opened before an update): the tab reloads itself and the page shows
  await page.goto('/');
  await expect(rail).toBeVisible();
  let calls = 0;
  await page.route(/\/assets\/Kanban-.*\.js$/, (route) => (++calls === 1 ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }) : route.continue()));
  await rail.getByRole('link', { name: 'Tâches' }).click();
  await expect(page.getByRole('heading', { name: 'Tâches' }).first()).toBeVisible({ timeout: 15_000 });
  expect(calls).toBeGreaterThanOrEqual(2);
  await page.unroute(/\/assets\/Kanban-.*\.js$/);
});
