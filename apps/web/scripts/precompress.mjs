// After `vite build`: a .br and a .gz next to each script and style sheet of dist/assets. The server sends the one
// the browser accepts (serveStatic `precompressed`), so the first display downloads about a third of the bytes
// even without a proxy that compresses. Source maps and fonts (already compressed) are left alone.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const assets = join(import.meta.dirname, '../dist/assets');
let plain = 0;
let br = 0;
let count = 0;
for (const name of readdirSync(assets)) {
  if (!/\.(js|css|svg)$/.test(name)) continue;
  const data = readFileSync(join(assets, name));
  if (data.length < 1024) continue; // not worth a second file
  const brotli = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  writeFileSync(join(assets, `${name}.br`), brotli);
  writeFileSync(join(assets, `${name}.gz`), gzipSync(data, { level: 9 }));
  plain += data.length;
  br += brotli.length;
  count += 1;
}
console.log(`precompressed ${count} files: ${(plain / 1000).toFixed(0)} kB → ${(br / 1000).toFixed(0)} kB (brotli)`);
