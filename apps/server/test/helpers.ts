import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFakeHermes, fakeFetch, FAKE_API_KEY, FAKE_DASH_TOKEN, type FakeOptions } from 'fake-hermes';
import { InstanceConfigSchema, type InstanceConfig } from '../src/config.js';
import { HermesHttp } from '../src/hermes/http.js';

export const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/hermes-0.23.0');

export function fakeInstance(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return InstanceConfigSchema.parse({
    id: 'fake',
    label: 'Fake',
    api: 'http://fake-api',
    apiKey: FAKE_API_KEY,
    dashboard: 'http://fake-dash',
    dashboardToken: FAKE_DASH_TOKEN,
    dashboardLink: 'https://dash.example.test',
    ...overrides,
  });
}

export function fakeHttp(opts: Omit<FakeOptions, 'fixturesDir'> = {}, inst = fakeInstance()) {
  const fetchImpl = fakeFetch(createFakeHermes({ fixturesDir: FIXTURES, ...opts }));
  return { http: new HermesHttp(inst, fetchImpl), fetchImpl };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'intendia-test-'));
}
