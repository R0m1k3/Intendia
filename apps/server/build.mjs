import { build } from 'esbuild';
import { cpSync } from 'node:fs';

await build({
  entryPoints: ['src/index.ts', 'src/healthcheck.ts', 'src/cli/probe.ts', 'src/cli/hash-password.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
});
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
