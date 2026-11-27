import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

/**
 * The README screenshots (docs/screenshots/*.png): `pnpm shots` from the repository root, after `pnpm build`.
 * Same bench as the tests, with a fake Hermes that answers in English (FAKE_LANG=en, set by the script).
 */
export const SHOTS_DIR = resolve(import.meta.dirname, '../../docs/screenshots');

export default defineConfig({
  ...base,
  testDir: './shots',
  retries: 0,
  timeout: 120_000,
  use: { ...base.use, locale: 'en-US', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, trace: 'off' },
});
