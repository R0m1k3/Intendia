import type { CompatReport, ModuleId } from './types.js';
import { MODULES } from './index.js';
import { HermesError, type HermesHttp, type RequestOptions } from '../hermes/http.js';

export class ModuleUnavailableError extends Error {
  constructor(readonly module: ModuleId, readonly op: string, readonly reasons: string[]) {
    super(`${module}.${op} indisponible sur cette instance`);
    this.name = 'ModuleUnavailableError';
  }
}

export interface CallOptions extends Omit<RequestOptions, 'body'> {
  params?: Record<string, string>;
  body?: unknown;
}

function fill(path: string, params: Record<string, string> = {}): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(v);
  });
}

/**
 * Runs an operation through the route chosen by the last compatibility report.
 * Reads are validated against the op schema (tolerant: unknown fields are kept);
 * a schema mismatch raises a HermesError of kind "schema" so the caller can trigger a recheck.
 */
export async function callOp<T = unknown>(
  http: HermesHttp,
  report: CompatReport | undefined,
  module: ModuleId,
  op: string,
  opts: CallOptions = {},
): Promise<T> {
  const def = MODULES.find((m) => m.id === module)?.ops[op];
  if (!def) throw new Error(`Unknown operation ${module}.${op}`);
  const resolved = report?.modules.find((m) => m.id === module)?.ops[op];
  if (!resolved?.ok || !resolved.route) throw new ModuleUnavailableError(module, op, resolved?.notes ?? ['pas encore vérifié']);
  const { via, method, path } = resolved.route;
  const data = await http.json(via, method, fill(path, opts.params), opts);
  if (def.schema && def.kind === 'read') {
    const parsed = def.schema.safeParse(data);
    if (!parsed.success) {
      throw new HermesError('schema', `${module}.${op}: unexpected response shape`, { via, method, path });
    }
    return parsed.data as T;
  }
  return data as T;
}

/** Same as callOp but returns the raw Response (SSE streams). */
export async function streamOp(
  http: HermesHttp,
  report: CompatReport | undefined,
  module: ModuleId,
  op: string,
  opts: CallOptions = {},
): Promise<Response> {
  const resolved = report?.modules.find((m) => m.id === module)?.ops[op];
  if (!resolved?.ok || !resolved.route) throw new ModuleUnavailableError(module, op, resolved?.notes ?? ['pas encore vérifié']);
  const { via, method, path } = resolved.route;
  return http.request(via, method, fill(path, opts.params), { ...opts, timeoutMs: opts.timeoutMs ?? 30_000 });
}
