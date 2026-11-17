import { resolve } from 'node:path';

/** Ports of the e2e bench, apart from every other bench (override with E2E_PORT, E2E_FAKE_API_PORT, E2E_FAKE_DASH_PORT). */
export const PORT = Number(process.env.E2E_PORT ?? 3480);
export const MCP_PORT = PORT + 2;
export const FAKE_API_PORT = Number(process.env.E2E_FAKE_API_PORT ?? 16842);
export const FAKE_DASH_PORT = Number(process.env.E2E_FAKE_DASH_PORT ?? 16319);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Session cookie written by the globalSetup (playwright.config.ts `storageState`), and the bench's temporary folder. */
export const STATE = resolve(import.meta.dirname, '.state.json');
export const TMP_PATH = resolve(import.meta.dirname, '.tmp-path');
