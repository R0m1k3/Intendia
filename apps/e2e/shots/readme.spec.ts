// The screenshots of the README, in English: a folder, a session with two answers (one produces a file), three
// schedules and four tasks, then one capture per page. Not a test of the product: run on demand (`pnpm shots`)
// before a release that changes what the screens look like, and commit the images.
import { expect, test } from '@playwright/test';
import { SHOTS_DIR } from '../playwright.shots.config.js';

test('README screenshots', async ({ page }) => {
  test.skip(process.env.FAKE_LANG !== 'en', 'run through `pnpm shots` (the fake must answer in English)');
  const n = Date.now() % 100000;
  const slug = `nancy-stores-${n}`;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`/x${path}`, { data, headers: { 'X-Intendia': '1' } });
    expect(r.ok(), `${path}: ${r.status()}`).toBe(true);
  };
  await post('/workspaces', { slug, name: 'Nancy stores', instanceId: 'fake' });
  for (const [name, schedule, prompt] of [['Monday report', '30 8 * * 1', 'Summarise the sales of the week'], ['Price watch', '0 7 * * *', 'Collect competitor prices'], ['Backup check', 'every 6h', 'Check the backups']]) {
    await post('/i/fake/crons', { name, schedule, prompt, deliver: 'local', workspace: slug });
  }
  for (const [title, start] of [['Prepare the Christmas catalogue', 'triage'], ['Proofread the product pages', 'ready'], ['Order the labels', 'scheduled'], ['Toy aisle inventory', 'ready']]) {
    await post('/i/fake/kanban/tasks?board=default', { title, start });
  }

  await page.goto(`/w/${slug}`);
  await page.click('main button:has-text("New session")');
  await page.waitForURL(/\/s\//);
  const box = page.locator('textarea[aria-label="Message"]');
  // with FAKE_LANG=en the fake answers in English and "file" starts the scene that writes a file
  for (const [i, message] of ['Can you look at what is in the folder?', 'Write a report.md file'].entries()) {
    await box.fill(message);
    await box.press('Enter');
    await expect(page.locator('[data-turn="agent"]')).toHaveCount(i + 1, { timeout: 30_000 });
    await expect(page.locator('[aria-label="Send"]')).toBeVisible({ timeout: 30_000 });
  }
  const shot = async (name: string) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400); // entry animations
    await page.screenshot({ path: `${SHOTS_DIR}/${name}.png` });
  };
  await shot('chat');
  await page.click('[data-agent-button]');
  await expect(page.locator('[data-agent-panel]')).toBeVisible();
  await shot('agent');
  await page.click('[data-agent-button]');

  for (const [name, path] of [['home', '/'], ['session-files', `/w/${slug}/fichiers`], ['kanban', '/i/fake/kanban'], ['crons', '/i/fake/crons'], ['skills', '/i/fake/skills'], ['settings', '/i/fake/config'], ['state', '/etat']] as const) {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
    await shot(name);
  }
  // a French text left on an English screen would show on the captures
  expect(await page.evaluate(() => [...((window as unknown as { __i18nMissing?: Set<string> }).__i18nMissing ?? [])])).toEqual([]);
});
