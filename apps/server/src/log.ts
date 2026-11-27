// The server's journal: one line per event on the standard outputs (`docker logs intendia`), with its time, its
// level and, inside an HTTP request, the request's identifier. The same identifier is sent to the browser
// (`X-Request-Id`, and `requestId` of a 500 answer), so that an error seen on screen can be found in the journal.
// Nothing here knows about secrets: callers never pass a body, a key or a token.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const isLevel = (v: unknown): v is LogLevel => typeof v === 'string' && (LOG_LEVELS as readonly string[]).includes(v);

// read here too: lines written while the configuration is being read already follow the level
let threshold: LogLevel = isLevel(process.env.INTENDIA_LOG_LEVEL) ? process.env.INTENDIA_LOG_LEVEL : 'info';
let sink: (level: LogLevel, line: string) => void = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

const requests = new AsyncLocalStorage<{ id: string }>();

/** A new request identifier (12 hex characters: enough to find one request in a journal). */
export const newRequestId = (): string => randomBytes(6).toString('hex');
/** Runs `fn` as the request `id`: every line written meanwhile, awaited calls included, carries it. */
export const withRequest = <T>(id: string, fn: () => T): T => requests.run({ id }, fn);
/** Identifier of the request being served, if any. */
export const requestId = (): string | undefined => requests.getStore()?.id;

/**
 * The path of a request as the journal may show it: never its query string, and a share link (`/f/<token>`, read
 * without signing in) without its token, which is the whole secret of the link.
 */
export const safePath = (path: string): string => path.replace(/^\/f\/[^/]+/, '/f/…');

/** One line: `2026-11-27T19:00:00.000Z WARN  message req=ab12cd34ef56`; an error adds its stack below. */
export function formatLine(level: LogLevel, message: string, err?: unknown, now = new Date(), req = requestId()): string {
  const head = `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${req ? ` req=${req}` : ''}`;
  if (err === undefined) return head;
  const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  return `${head}\n${detail}`;
}

function write(level: LogLevel, message: string, err?: unknown): void {
  if (RANK[level] < RANK[threshold]) return;
  sink(level, formatLine(level, message, err));
}

export const log = {
  /** Detail useful when looking for a problem (each request served): hidden unless INTENDIA_LOG_LEVEL=debug. */
  debug: (message: string) => write('debug', message),
  info: (message: string) => write('info', message),
  /** Something went wrong and Intendia carried on. */
  warn: (message: string, err?: unknown) => write('warn', message, err),
  /** Something failed: `err` is written with its stack. */
  error: (message: string, err?: unknown) => write('error', message, err),
};

export function setLogLevel(level: LogLevel): void { threshold = level; }
export function logLevel(): LogLevel { return threshold; }
/** Tests: where the lines go (returns the previous destination). */
export function setLogSink(next: typeof sink): typeof sink { const prev = sink; sink = next; return prev; }
