// Docker HEALTHCHECK: exits 0 when the HTTP server answers /x/health.
const port = process.env.INTENDIA_PORT ?? '3000';
try {
  const res = await fetch(`http://127.0.0.1:${port}/x/health`, { signal: AbortSignal.timeout(4000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
