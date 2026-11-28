// A phone (touch screen, `pointer: coarse`): every control answers on at least 44 × 44 px (styles.css: the min-size
// of the base layer, or `tap-area` for a control drawn small on purpose), on the main screens, in a session, in the
// « Plus » menu, in a menu and in a dialog.
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/**
 * The controls on screen whose touch area is under 44 px (their drawing, or the `::after` that extends it), and the
 * extended areas that reach another control: an area takes no room in the layout, so the later one would take the
 * finger meant for its neighbour.
 */
const small = (page: Page) => page.evaluate(() => {
  const found: string[] = [];
  const controls = 'button, a[href], select, summary, textarea, [role="button"], [role="tab"], input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="range"], [type="file"])';
  const name = (el: HTMLElement) => `${el.tagName.toLowerCase()} « ${(el.getAttribute('aria-label') || el.textContent || el.title || '').trim().slice(0, 40)} »`;
  type Box = { left: number; top: number; right: number; bottom: number };
  const seen: { el: HTMLElement; own: Box; area: Box; extended: boolean }[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(controls)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[inert], [aria-hidden="true"]')) continue;
    if (r.right <= 0 || r.left >= innerWidth) continue;
    // a link inside a sentence: a min-size does nothing on an inline box, the line is what is aimed at
    if (el.tagName === 'A' && cs.display === 'inline') continue;
    const after = getComputedStyle(el, '::after');
    const extended = after.content !== 'none' && after.position === 'absolute';
    const w = Math.max(r.width, extended ? parseFloat(after.width) || 0 : 0);
    const h = Math.max(r.height, extended ? parseFloat(after.height) || 0 : 0);
    if (w < 43.5 || h < 43.5) found.push(`${name(el)} ${Math.round(w)}×${Math.round(h)}`);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    seen.push({ el, own: r, area: { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 }, extended: extended && (w > r.width || h > r.height) });
  }
  const inside = (a: Box, b: Box) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  for (const a of seen) {
    if (!a.extended) continue;
    for (const b of seen) {
      if (a === b || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // drawn on top of the other on purpose (the × inside a search field): its area is part of that field
      if (inside(a.own, b.own)) continue;
      // where the area of `a` lies over the drawing of `b`
      const left = Math.max(a.area.left, b.own.left);
      const right = Math.min(a.area.right, b.own.right);
      const top = Math.max(a.area.top, b.own.top);
      const bottom = Math.min(a.area.bottom, b.own.bottom);
      if (right - left <= 1 || bottom - top <= 1) continue;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      // on screen: who answers there? (a menu or a dialog drawn over `a` keeps the finger); off screen: not known, refused
      const onScreen = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
      const hit = onScreen ? document.elementFromPoint(x, y) : null;
      if (!onScreen || (hit && a.el.contains(hit))) found.push(`${name(a.el)} reaches ${name(b.el)}`);
    }
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
  // two more cited files on the next lines of the answer: their areas must not reach one another
  await expect(page.locator('button.file-chip')).toHaveCount(1);
  await page.evaluate(() => {
    const chip = document.querySelector('button.file-chip')!;
    for (let i = 0; i < 2; i++) chip.closest('p')!.append(document.createElement('br'), chip.cloneNode(true));
  });
  await check('pastilles de fichier sur des lignes voisines');
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
