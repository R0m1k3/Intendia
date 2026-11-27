import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { tempDir, testApp } from './helpers.js';

function webDir(): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Intendia</title><script type="module" src="/assets/index-abc.js"></script>');
  const script = 'console.log("intendia");'.repeat(100);
  writeFileSync(join(dir, 'assets', 'index-abc.js'), script);
  writeFileSync(join(dir, 'assets', 'index-abc.js.gz'), gzipSync(script));
  writeFileSync(join(dir, 'assets', 'small-def.js'), 'export {};');
  return dir;
}

describe('the web app files', () => {
  it('serves the built files for good, compressed when the browser accepts it', async () => {
    const t = await testApp({ env: { INTENDIA_WEB_DIR: webDir() } });
    const plain = await t.app.request('/assets/index-abc.js');
    expect(plain.status).toBe(200);
    expect(plain.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toContain('console.log("intendia");');

    const packed = await t.app.request('/assets/index-abc.js', { headers: { 'Accept-Encoding': 'gzip, deflate' } });
    expect(packed.status).toBe(200);
    expect(packed.headers.get('content-encoding')).toBe('gzip');
    expect(packed.headers.get('vary')).toContain('Accept-Encoding');
    expect(packed.headers.get('content-type')).toContain('javascript');
    expect(packed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Number(packed.headers.get('content-length'))).toBeLessThan(Number(plain.headers.get('content-length')));

    // no compressed copy next to it: the file as it is
    const small = await t.app.request('/assets/small-def.js', { headers: { 'Accept-Encoding': 'gzip, br' } });
    expect(small.status).toBe(200);
    expect(small.headers.get('content-encoding')).toBeNull();
  });

  it('answers 404 for a file of a previous version, never the page', async () => {
    const t = await testApp({ env: { INTENDIA_WEB_DIR: webDir() } });
    const gone = await t.app.request('/assets/Config-old.js');
    expect(gone.status).toBe(404);
    expect(gone.headers.get('content-type')).not.toContain('html');
    expect(gone.headers.get('cache-control')).toBeNull();
  });

  it('has the page asked again at each load', async () => {
    const t = await testApp({ env: { INTENDIA_WEB_DIR: webDir() } });
    for (const path of ['/', '/i/ref/config']) {
      const page = await t.app.request(path);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('cache-control')).toBe('no-cache');
    }
  });
});
