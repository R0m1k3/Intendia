// First-load JavaScript of the web app: the entry of dist/index.html, the app chunk it imports at once
// (main.tsx → import('./app')) and every chunk they import statically. Pages are loaded on demand and not counted.
// Usage: node scripts/bundle-size.mjs [--max=<kB>]   (exit code 1 above the budget)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const dist = join(import.meta.dirname, '../apps/web/dist');
const assets = join(dist, 'assets');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entry) { console.error('no entry script in dist/index.html: build the web app first'); process.exit(2); }

const staticImports = (file) => {
  const src = readFileSync(join(assets, file), 'utf8');
  const out = new Set();
  // `import … from "./x.js"`, `import "./x.js"` and `export … from "./x.js"` (minified: no space before the quote)
  for (const m of src.matchAll(/(?:import|export)\s*(?:[^"'`()]*?\bfrom\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g)) out.add(m[1]);
  return out;
};
const closure = (roots) => {
  const seen = new Set();
  const walk = (f) => { if (seen.has(f)) return; seen.add(f); for (const d of staticImports(f)) walk(d); };
  for (const r of roots) walk(r);
  return seen;
};
// the app chunk: the only dynamic import of the entry that is not the English dictionary
const entrySrc = readFileSync(join(assets, entry), 'utf8');
const dynamic = [...entrySrc.matchAll(/import\(["'`]\.\/([^"'`]+\.js)["'`]\)/g)].map((m) => m[1]);
const app = dynamic.find((f) => /^app-/.test(f));
if (!app) { console.error(`the entry ${entry} does not import the app chunk`); process.exit(2); }

const first = closure([entry, app]);
const size = (f) => statSync(join(assets, f)).size;
const total = [...first].reduce((n, f) => n + size(f), 0);
const all = readdirSync(assets).filter((f) => f.endsWith('.js')).reduce((n, f) => n + size(f), 0);
const kb = (n) => (n / 1000).toFixed(0);
const sent = (pack) => [...first].reduce((n, f) => n + pack(readFileSync(join(assets, f))).length, 0);
console.log(`first load: ${kb(total)} kB in ${first.size} files, sent as ${kb(sent(gzipSync))} kB (gzip) or ${kb(sent(brotliCompressSync))} kB (brotli); all JavaScript: ${kb(all)} kB`);
for (const f of [...first].sort((a, b) => size(b) - size(a)).slice(0, 8)) console.log(`  ${kb(size(f)).padStart(5)} kB  ${f}`);
const max = Number(process.argv.find((a) => a.startsWith('--max='))?.slice(6));
if (max && total > max * 1000) { console.error(`over the budget of ${max} kB`); process.exit(1); }
