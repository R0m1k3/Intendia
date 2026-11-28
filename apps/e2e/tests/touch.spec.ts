// A phone (touch screen, `pointer: coarse`): every control answers on at least 44 × 44 px (styles.css: the min-size
// of the base layer, or `tap-area` for a control drawn small on purpose), on the main screens, in a session, in the
// « Plus » menu, in a menu and in a dialog.
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** The controls on screen whose touch area is under 44 px (their drawing, or the `::after` that extends it). */
const small = (page: Page) => page.evaluate(() => {
  const found: string[] = [];
  const controls = 'button, a[href], select, summary, textarea, [role="button"], [role="tab"], input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="range"], [type="file"])';
  for (const el of document.querySelectorAll<HTMLElement>(controls)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[inert], [aria-hidden="true"]')) continue;
    if (r.right <= 0 || r.left >= innerWidth) continue;
    // a link inside a sentence: a min-size does nothing on an inline box, the line is what is aimed at
    if (el.tagName === 'A' && cs.display === 'inline') continue;
    const after = getComputedStyle(el, '::after');
    const extends_ = after.content !== 'none' && after.position === 'absolute';
    const w = Math.max(r.width, extends_ ? parseFloat(after.width) || 0 : 0);
    const h = Math.max(r.height, extends_ ? parseFloat(after.height) || 0 : 0);
    if (w < 43.5 || h < 43.5) found.push(`${el.tagName.toLowerCase()} ${Math.round(w)}×${Math.round(h)} « ${(el.getAttribute('aria-label') || el.textContent || el.title || '').trim().slice(0, 40)} »`);
  }
  return found;
});

test('controls are at least 44 px on a touch screen', async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const n = Date.now() % 100000;
  const slug = `e2e-tactile-${n}`;
  const r = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug, name: `Tactile ${n}`, instanceId: 'fake' } });
  expect(r.status()).toBe(201);

  const check = async (what: string) => {
    await page.waitForTimeout(400); // entrance animation, lists arriving
    expect(await small(page), what).toEqual([]);
  };

  // the home page, then a session with an answer, a step, a cited file and the line of its run
  await page.goto('/');
  const box = page.locator('textarea').first();
  await expect(box).toBeVisible();
  await check('accueil');
  await box.fill(`Bonjour sur téléphone ${n}, regarde le dossier`);
  await box.press('Enter');
  await expect(page.locator('[data-turn="agent"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('[aria-label="Envoyer"]')).toBeVisible({ timeout: 30_000 });
  await check('session');
  const session = page.url();

  // the session's menu, then a dialog opened from it
  await page.click('button[title="Actions de la session"]');
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await check('menu de la session');
  await page.locator('[role="menu"] >> text=Renommer').first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await check('dialogue');
  await page.keyboard.press('Escape');

  // the « Plus » menu of the bottom bar
  await page.getByRole('button', { name: 'Plus' }).first().click();
  await expect(page.locator('nav[aria-label="Plus"]')).toBeVisible();
  await check('menu Plus');

  for (const path of ['/i/fake/agents', '/i/fake/kanban', '/i/fake/crons', '/i/fake/files', '/i/fake/skills', '/i/fake/config', '/i/fake/suivi', '/i/fake/memoire', '/i/fake/acces', '/activite', '/etat', '/reglages', '/aide', '/liens', '/chat', `/w/${slug}`, `/w/${slug}/fichiers`]) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Plus' }).first()).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    await check(path);
  }
  await page.goto(session);
  await expect(page.locator('[data-turn="agent"]')).toHaveCount(1);
});
