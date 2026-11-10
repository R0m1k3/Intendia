import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { Context } from 'hono';
import { mimeOf } from './mime.js';

/** Headers of every response that carries content from the volume (agent-written HTML/SVG included). */
export const FILE_CSP = "sandbox; frame-ancestors 'self'";

export function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Streams a regular file (absPath already checked by files/paths.ts). */
export function sendFile(c: Context, absPath: string, name: string, opts: { download?: boolean } = {}): Response {
  const st = statSync(absPath);
  const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': mimeOf(name),
      'Content-Length': String(st.size),
      'Content-Security-Policy': FILE_CSP,
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': disposition(opts.download ? 'attachment' : 'inline', name),
    },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Small static error page for /f/* (no script, no external resource). */
export function errorPage(c: Context, status: 404 | 410, title: string, detail?: string): Response {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Intendia</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#23251f;background:#f7f6f1}
h1{font-size:1.15rem;margin:0 0 .5rem}p{color:#5b5e55;margin:.25rem 0}a{color:#1f4d3a}code{font:13px ui-monospace,monospace;word-break:break-all}
@media(prefers-color-scheme:dark){body{background:#151613;color:#e8e7e1}p{color:#a5a79e}a{color:#8cc0a3}}</style></head>
<body><h1>${esc(title)}</h1>${detail ? `<p>${esc(detail)}</p>` : ''}<p><a href="/">Intendia</a></p></body></html>`;
  return c.body(body, status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store',
  });
}
