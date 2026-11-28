import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** An error the API answers with its own status and JSON: `{ ...body(), error: message }`. */
export abstract class HttpError extends Error {
  /** May be a getter when it depends on the error's code. */
  abstract readonly status: ContentfulStatusCode;

  /** What the answer carries besides `error` (code, field, …). */
  body(): Record<string, unknown> {
    return {};
  }
}
