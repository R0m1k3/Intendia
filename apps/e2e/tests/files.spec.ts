// Ported from shots/files-write.mjs: « Nouveau » file and folder, save, move a folder, a name already taken.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { autoConfirm } from '../confirm.js';

const WS = process.env.E2E_FILES!;

async function newEntry(page: Page, kind: 'Fichier' | 'Dossier', name: string) {
  await page.click('button:has-text("Nouveau")');
  await page.click(`[role=menuitem]:has-text("${kind}")`);
  await page.fill('[role=dialog] input', name);
  await page.click('[role=dialog] button:has-text("Créer")');
}

test('new file and folder, save, move a folder, name taken', async ({ page }) => {
  await autoConfirm(page);
  const slug = `e2e-files-${Date.now() % 100000}`;
  const r = await page.request.post('/x/workspaces', { headers: { 'x-intendia': '1' }, data: { slug, name: 'Fichiers e2e', instanceId: 'fake' } });
  expect(r.status()).toBe(201);
  await page.goto(`/w/${slug}/fichiers`);

  await newEntry(page, 'Fichier', 'notes.md');
  await expect(page.locator('[role=dialog]')).toHaveCount(0);
  await expect(page.locator('.cm-content[contenteditable=true]')).toBeVisible();
  await expect(page).not.toHaveURL(/edit=/);
  await page.click('.cm-content');
  await page.keyboard.type('# Notes\nPremière ligne');
  await page.click('button:has-text("Enregistrer")');
  await expect(page.locator('button[title="Modifier"]')).toBeVisible();
  expect(readFileSync(`${WS}/${slug}/notes.md`, 'utf8')).toBe('# Notes\nPremière ligne');

  await newEntry(page, 'Dossier', 'rapports');
  await expect(page.locator('li button[title="rapports"]')).toBeVisible();
  await newEntry(page, 'Dossier', 'archives');
  await expect(page.locator('li button[title="archives"]')).toBeVisible();

  // a file inside rapports/, then move the folder
  const up = await page.request.put(`/x/workspaces/${slug}/files/upload?dir=rapports&name=mars.txt`, { headers: { 'x-intendia': '1' }, data: 'mars' });
  expect(up.ok()).toBe(true);
  await page.hover('li:has(button[title="rapports"])');
  await page.click('button[aria-label="Renommer ou déplacer rapports"]');
  await page.fill('[role=dialog] input', 'archives/rapports');
  await page.click('[role=dialog] button:has-text("Renommer")');
  await expect(page.locator('li button[title="rapports"]')).toHaveCount(0);
  await expect.poll(() => existsSync(`${WS}/${slug}/archives/rapports/mars.txt`)).toBe(true);
  expect(readFileSync(`${WS}/${slug}/archives/rapports/mars.txt`, 'utf8')).toBe('mars');
  expect(existsSync(`${WS}/${slug}/rapports`)).toBe(false);

  await newEntry(page, 'Fichier', 'notes.md');
  await expect(page.getByText('Existe déjà')).toBeVisible();
});
