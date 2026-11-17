import { defineConfig } from '@playwright/test';
import { BASE_URL, STATE } from './ports.js';

export default defineConfig({
  testDir: './tests',
  globalSetup: './bench.ts',
  globalTeardown: './teardown.ts',
  // one bench (fake-hermes + Intendia) shared by every spec
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    viewport: { width: 1360, height: 860 },
    storageState: STATE,
    trace: 'retain-on-failure',
    // local runs on a server without `playwright install`: E2E_CHROMIUM=/path/to/chrome
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
