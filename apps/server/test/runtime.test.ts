import { describe, expect, it } from 'vitest';
import { checkInstance } from '../src/compat/engine.js';
import { callOp } from '../src/connectors/runtime.js';
import { createFakeHermes, fakeFetch } from 'fake-hermes';
import { HermesHttp } from '../src/hermes/http.js';
import { FIXTURES, fakeInstance } from './helpers.js';

describe('callOp', () => {
  it('a function body receives the via of the chosen route', async () => {
    for (const [inst, expected] of [[fakeInstance(), 'dash'], [fakeInstance({ dashboard: undefined, dashboardToken: undefined }), 'api']] as const) {
      const fake = createFakeHermes({ fixturesDir: FIXTURES });
      const http = new HermesHttp(inst, fakeFetch(fake));
      const { report } = await checkInstance(http);
      const seen: string[] = [];
      await callOp(http, report, 'crons', 'create', {
        body: (via: 'api' | 'dash') => { seen.push(via); return { name: 'n', prompt: 'p', schedule: 'every 30m' }; },
      });
      expect(seen).toEqual([expected]);
      const sent = fake.requests.findLast((r) => r.method === 'POST');
      expect(sent?.body).toMatchObject({ schedule: 'every 30m' });
    }
  });
});
