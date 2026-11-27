// A session beyond chat.spec.ts: the thread stays at its end while it grows, the line under an answer, editing the last
// message, « Réessayer » on the last answer only, the clarifying question, and a failed run (« panne »; « echec » only fails a tool call).
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1360, height: 560 } }); // short window: a few turns overflow it

async function newSession(page: Page, label: string) {
  const n = Date.now() % 100000;
  const slug = `e2e-${label}-${n}`;
  const r = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug, name: `E2E ${label} ${n}`, instanceId: 'fake' } });
  expect(r.status()).toBe(201);
  await page.goto(`/w/${slug}`);
  await page.click('main button:has-text("Nouvelle session ici")');
  await page.waitForURL(/\/s\//);
  const box = page.locator('textarea[aria-label="Message"]');
  const send = async (text: string) => { await box.fill(text); await box.press('Enter'); };
  const idle = () => expect(page.locator('[aria-label="Envoyer"]')).toBeVisible({ timeout: 30_000 });
  return { send, idle };
}

const gap = (page: Page) => page.evaluate(() => {
  const m = document.querySelector('[data-turn]')!.closest('[data-scroll-root]')!;
  return Math.round(m.scrollHeight - m.scrollTop - m.clientHeight);
});

test('long thread, run line, edit, retry', async ({ page }) => {
  const { send, idle } = await newSession(page, 'fil');
  for (let n = 1; n <= 4; n++) {
    await send(`Message ${n}, regarde le dossier`);
    await expect(page.locator('[data-turn="agent"]')).toHaveCount(n, { timeout: 30_000 });
    await idle();
    await expect.poll(() => gap(page)).toBeLessThan(40);
  }
  expect(await page.evaluate(() => { const m = document.querySelector('[data-turn]')!.closest('[data-scroll-root]')!; return m.scrollHeight > m.clientHeight; })).toBe(true);

  // duration and cost under the answer (the cost is written a little later by Hermes)
  await expect(page.locator('[data-run-footer]').last()).toHaveText(/\d.*s.*\$|\$.*\d.*s/, { timeout: 15_000 });

  const last = page.locator('[data-turn="user"]').last();
  await last.hover();
  await last.getByRole('button', { name: 'Modifier le message' }).click();
  await expect(last.locator('textarea')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(last.locator('textarea')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(1);
});

test('clarifying question and failed run', async ({ page }) => {
  const { send, idle } = await newSession(page, 'question');
  await send('Une question pour toi (question)');
  await expect(page.getByText('Hermes vous pose une question')).toBeVisible();
  await page.getByRole('button', { name: 'Houdemont' }).click();
  await expect(page.getByText('Vous avez choisi : Houdemont')).toBeVisible({ timeout: 20_000 });
  await idle();

  await send('Une panne (panne)');
  const err = page.getByText(/Le run a échoué/);
  await expect(err).toBeVisible({ timeout: 20_000 });
  await expect(err).not.toContainText(/\bat \S+\.(ts|js|py):\d+|Traceback|node_modules/);
  await idle();
});
